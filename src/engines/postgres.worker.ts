import { PGlite } from '@electric-sql/pglite';
import { displayValue, serveRpc, createTableSql, orderByDependencies, quoteIdent, toCsv } from './common';
import { splitStatements } from './sql-split';
import { MAX_DISPLAY_ROWS, type StatementResult, type TableData, type TableInfo } from './types';

let pg: PGlite;
let modules: { pglite: WebAssembly.Module; initdb: WebAssembly.Module; data: Blob };

const PG_TYPES: Record<number, string> = {
  16: 'boolean', 17: 'bytea', 18: 'char', 19: 'name', 20: 'bigint', 21: 'smallint', 23: 'integer',
  25: 'text', 26: 'oid', 114: 'json', 700: 'real', 701: 'double precision', 1042: 'char',
  1043: 'varchar', 1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz',
  1186: 'interval', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb',
};

// Keep dates/times as Postgres prints them instead of converting to JS Dates.
const raw = (v: string) => v;
const parsers = { 1082: raw, 1083: raw, 1114: raw, 1184: raw, 1186: raw };

async function open(saved?: Uint8Array | null) {
  if (pg && !pg.closed) await pg.close();
  pg = await PGlite.create({
    pgliteWasmModule: modules.pglite,
    initdbWasmModule: modules.initdb,
    fsBundle: modules.data,
    loadDataDir: saved && saved.length ? new Blob([saved as BlobPart], { type: 'application/x-gzip' }) : undefined,
    parsers,
  });
}

serveRpc({
  async init(pgliteWasm: Uint8Array, initdbWasm: Uint8Array, data: Uint8Array, saved?: Uint8Array | null) {
    modules = {
      pglite: await WebAssembly.compile(pgliteWasm as BufferSource),
      initdb: await WebAssembly.compile(initdbWasm as BufferSource),
      data: new Blob([data as BlobPart]),
    };
    await open(saved);
  },

  async run(text: string): Promise<StatementResult[]> {
    const results: StatementResult[] = [];
    for (const { sql, offset } of splitStatements(text)) {
      const t0 = performance.now();
      try {
        const r = await pg.query<unknown[]>(sql, [], { rowMode: 'array' });
        const ms = performance.now() - t0;
        if (!r.fields.length) {
          results.push({ sql, offset, ms, rowsAffected: r.affectedRows ?? 0 });
        } else {
          const rows = r.rows.slice(0, MAX_DISPLAY_ROWS).map((row) => row.map(displayValue));
          results.push({
            sql,
            offset,
            ms,
            result: {
              columns: r.fields.map((f) => ({ name: f.name, type: PG_TYPES[f.dataTypeID] ?? `oid ${f.dataTypeID}` })),
              rows,
              totalRows: r.rows.length,
              truncated: r.rows.length > rows.length,
            },
          });
        }
      } catch (e: any) {
        results.push({
          sql,
          offset,
          ms: performance.now() - t0,
          error: e?.message ?? String(e),
          errorPosition: e?.position ? Number(e.position) : undefined,
        });
        break;
      }
    }
    return results;
  },

  async schema(): Promise<TableInfo[]> {
    const objects = await pg.query<{ name: string; kind: string }>(
      `SELECT table_name AS name, CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
         FROM information_schema.tables WHERE table_schema = 'public' ORDER BY kind, name`,
    );
    const cols = await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const keys = await pg.query<{ table_name: string; column_name: string; kind: string; ref_table: string; ref_column: string }>(
      `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name,
              CASE c.contype WHEN 'p' THEN 'pk' ELSE 'fk' END AS kind,
              CASE WHEN c.contype = 'f' THEN c.confrelid::regclass::text END AS ref_table,
              CASE WHEN c.contype = 'f' THEN fa.attname END AS ref_column
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace AND n.nspname = 'public'
         CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         LEFT JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[k.ord]
        WHERE c.contype IN ('p', 'f')`,
    );
    const unq = (s: string) => s.replace(/^"|"$/g, '');
    const tables: TableInfo[] = [];
    for (const o of objects.rows) {
      const myKeys = keys.rows.filter((k) => unq(k.table_name) === o.name);
      const pkCols = new Set(myKeys.filter((k) => k.kind === 'pk').map((k) => k.column_name));
      let rowCount: number | undefined;
      if (o.kind === 'table') {
        try {
          rowCount = Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quoteIdent(o.name)}`)).rows[0].n);
        } catch {}
      }
      tables.push({
        name: o.name,
        kind: o.kind as 'table' | 'view',
        rowCount,
        columns: cols.rows
          .filter((c) => c.table_name === o.name)
          .map((c) => ({ name: c.column_name, type: c.data_type, notNull: c.is_nullable === 'NO', pk: pkCols.has(c.column_name) })),
        foreignKeys: myKeys
          .filter((k) => k.kind === 'fk')
          .map((k) => ({ column: k.column_name, refTable: unq(k.ref_table), refColumn: k.ref_column })),
      });
    }
    return tables;
  },

  async createTables(tables: TableData[]) {
    await pg.transaction(async (tx) => {
      for (const t of orderByDependencies(tables)) {
        await tx.exec(createTableSql('postgres', t));
        if (!t.rows.length) continue;
        const csv = toCsv(t.columns.map((c) => c.name), t.rows);
        await tx.query(`COPY ${quoteIdent(t.name)} FROM '/dev/blob' WITH (FORMAT csv, HEADER true)`, [], {
          blob: new Blob([csv]),
        });
      }
    });
  },

  async exportBytes(): Promise<Uint8Array> {
    const blob = await pg.dumpDataDir('gzip');
    return new Uint8Array(await blob.arrayBuffer());
  },

  async importBytes(bytes: Uint8Array) {
    await open(bytes);
  },

  async reset() {
    await open(null);
  },
});
