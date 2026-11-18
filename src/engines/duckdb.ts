import * as duckdb from '@duckdb/duckdb-wasm';
import { loadAsset } from '../lib/assets';
import { gunzip, gzip, isGzip, tar, untar } from '../lib/tar';
import { createTableSql, displayValue, orderByDependencies, quoteIdent, quoteLiteral, toCsv } from './common';
import { leadingKeyword, splitStatements } from './sql-split';
import { MAX_DISPLAY_ROWS, type Engine, type StatementResult, type TableData, type TableInfo } from './types';

type Conn = duckdb.AsyncDuckDBConnection;

function formatValue(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  const t = type.toLowerCase();
  if (typeof v === 'number' || typeof v === 'bigint') {
    if (t.startsWith('date')) return new Date(Number(v)).toISOString().slice(0, 10);
    // Arrow JS reports timestamps as milliseconds since the epoch.
    if (t.startsWith('timestamp')) return new Date(Number(v)).toISOString().replace('T', ' ').replace(/(\.000)?Z$/, '');
  }
  if (v && typeof v === 'object' && 'toJSON' in (v as object) && !(v instanceof Date) && !(v instanceof Uint8Array)) {
    return displayValue((v as { toJSON(): unknown }).toJSON());
  }
  return displayValue(v);
}

export class DuckDBEngine implements Engine {
  readonly id = 'duckdb' as const;
  private db!: duckdb.AsyncDuckDB;
  private conn!: Conn;
  private fileCounter = 0;

  async init(saved?: Uint8Array | null) {
    const [workerJs, wasm] = await Promise.all([loadAsset('duckdb_worker'), loadAsset('duckdb_wasm')]);
    // Workers started from a page opened from disk cannot fetch blob: URLs, so
    // the WASM binary is posted to the worker and served to DuckDB's own
    // fetch() call from memory.
    const shim = `
      const __dbifyWasm = new Promise((resolve) => { self.__dbifyResolveWasm = resolve; });
      const __dbifyFetch = self.fetch.bind(self);
      self.fetch = (url, opts) => String(url && url.url ? url.url : url).startsWith('dbify-wasm:')
        ? __dbifyWasm.then((b) => new Response(b, { headers: { 'Content-Type': 'application/wasm' } }))
        : __dbifyFetch(url, opts);
      self.addEventListener('message', (e) => {
        if (e.data && e.data.__dbifyWasm) { self.__dbifyResolveWasm(e.data.__dbifyWasm); e.stopImmediatePropagation(); }
      });
    `;
    const workerUrl = URL.createObjectURL(new Blob([shim, '\n', workerJs as BlobPart], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    worker.postMessage({ __dbifyWasm: wasm });
    this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await this.db.instantiate('dbify-wasm:duckdb-eh.wasm');
    await this.db.open({
      path: ':memory:',
      query: { castBigIntToDouble: true, castDecimalToDouble: true },
    });
    this.conn = await this.db.connect();
    // Extensions would be downloaded from the internet; keep everything offline.
    await this.conn.query("SET autoinstall_known_extensions = false; SET autoload_known_extensions = false;").catch(() => {});
    if (saved && saved.length) await this.importBytes(saved);
  }

  async run(text: string): Promise<StatementResult[]> {
    const results: StatementResult[] = [];
    for (const { sql, offset } of splitStatements(text)) {
      const t0 = performance.now();
      try {
        const table = await this.conn.query(sql);
        const ms = performance.now() - t0;
        const fields = table.schema.fields;
        const verb = leadingKeyword(sql);
        const isCommand = !['SELECT', 'WITH', 'VALUES', 'FROM', 'TABLE', 'SHOW', 'DESCRIBE', 'SUMMARIZE', 'EXPLAIN', 'PRAGMA', 'CALL'].includes(verb);
        if (fields.length === 0 || (isCommand && table.numRows === 0)) {
          results.push({ sql, offset, ms, rowsAffected: 0 });
        } else if (['INSERT', 'UPDATE', 'DELETE'].includes(verb) && fields.length === 1 && fields[0].name === 'Count') {
          results.push({ sql, offset, ms, rowsAffected: Number(table.getChildAt(0)?.get(0) ?? 0) });
        } else {
          const types = fields.map((f) => String(f.type));
          const n = Math.min(table.numRows, MAX_DISPLAY_ROWS);
          const cols = fields.map((_, i) => table.getChildAt(i)!);
          const rows: unknown[][] = new Array(n);
          for (let r = 0; r < n; r++) rows[r] = cols.map((c, i) => formatValue(c.get(r), types[i]));
          results.push({
            sql,
            offset,
            ms,
            result: {
              columns: fields.map((f, i) => ({ name: f.name, type: simplifyType(types[i]) })),
              rows,
              totalRows: table.numRows,
              truncated: table.numRows > n,
            },
          });
        }
      } catch (e: any) {
        results.push({ sql, offset, ms: performance.now() - t0, error: e?.message ?? String(e) });
        break;
      }
    }
    return results;
  }

  private async rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const t = await this.conn.query(sql);
    return t.toArray().map((r: any) => r.toJSON()) as T[];
  }

  async schema(): Promise<TableInfo[]> {
    const objects = await this.rows<{ name: string; kind: string }>(
      `SELECT table_name AS name, CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
         FROM information_schema.tables
        WHERE table_schema = 'main' AND table_catalog = current_database()
        ORDER BY kind, name`,
    );
    const cols = await this.rows<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'main' AND table_catalog = current_database()
        ORDER BY table_name, ordinal_position`,
    );
    let cons: { table_name: string; constraint_type: string; constraint_column_names: string[]; referenced_table: string | null; referenced_column_names: string[] | null }[] = [];
    try {
      cons = await this.rows(
        `SELECT table_name, constraint_type, constraint_column_names, referenced_table, referenced_column_names
           FROM duckdb_constraints()
          WHERE schema_name = 'main' AND database_name = current_database()
            AND constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`,
      );
    } catch {}
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? Array.from(v as Iterable<unknown>, String) : []);
    const out: TableInfo[] = [];
    for (const o of objects) {
      const mine = cons.filter((c) => c.table_name === o.name);
      const pk = new Set(mine.filter((c) => c.constraint_type === 'PRIMARY KEY').flatMap((c) => list(c.constraint_column_names)));
      let rowCount: number | undefined;
      if (o.kind === 'table') {
        try {
          rowCount = Number((await this.rows<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM ${quoteIdent(o.name)}`))[0].n);
        } catch {}
      }
      out.push({
        name: o.name,
        kind: o.kind as 'table' | 'view',
        rowCount,
        columns: cols
          .filter((c) => c.table_name === o.name)
          .map((c) => ({ name: c.column_name, type: c.data_type, notNull: c.is_nullable === 'NO', pk: pk.has(c.column_name) })),
        foreignKeys: mine
          .filter((c) => c.constraint_type === 'FOREIGN KEY')
          .flatMap((c) => {
            const from = list(c.constraint_column_names);
            const to = list(c.referenced_column_names);
            return from.map((col, i) => ({ column: col, refTable: String(c.referenced_table ?? ''), refColumn: to[i] ?? '' }));
          }),
      });
    }
    return out;
  }

  private tempName(ext: string) {
    return `dbify_${Date.now()}_${this.fileCounter++}${ext}`;
  }

  async createTables(tables: TableData[]) {
    for (const t of orderByDependencies(tables)) {
      await this.conn.query(createTableSql('duckdb', t));
      if (!t.rows.length) continue;
      const file = this.tempName('.csv');
      const csv = toCsv(t.columns.map((c) => c.name), t.rows);
      await this.db.registerFileText(file, csv);
      try {
        await this.conn.query(`COPY ${quoteIdent(t.name)} FROM ${quoteLiteral(file)} (FORMAT csv, HEADER true)`);
      } finally {
        await this.db.dropFile(file);
      }
    }
  }

  /**
   * CSV and TSV go through DuckDB's own fast reader. (Parquet and JSON readers
   * are separate DuckDB downloads, so dbify parses those in JavaScript.)
   */
  async importNative(file: File, tableName: string): Promise<boolean> {
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
    if (!['csv', 'tsv', 'txt'].includes(ext)) return false;
    const name = this.tempName('.' + ext);
    await this.db.registerFileBuffer(name, new Uint8Array(await file.arrayBuffer()));
    try {
      await this.conn.query(`CREATE TABLE ${quoteIdent(tableName)} AS SELECT * FROM read_csv_auto(${quoteLiteral(name)}, normalize_names = true)`);
    } finally {
      await this.db.dropFile(name);
    }
    return true;
  }

  /**
   * COPY FROM DATABASE copies table data alphabetically, which breaks foreign
   * keys, so copy the schema first and then fill tables parents-first.
   */
  private async copyDatabase(from: string, to: string) {
    await this.conn.query(`COPY FROM DATABASE ${from} TO ${to} (SCHEMA)`);
    const tables = await this.rows<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_catalog = ${quoteLiteral(from)} AND table_schema = 'main' AND table_type = 'BASE TABLE'`,
    );
    const fks = await this.rows<{ t: string; r: string }>(
      `SELECT table_name AS t, referenced_table AS r FROM duckdb_constraints()
        WHERE database_name = ${quoteLiteral(from)} AND constraint_type = 'FOREIGN KEY'`,
    ).catch(() => []);
    const ordered = orderByDependencies(
      tables.map((t) => ({
        name: t.name,
        rows: [],
        columns: fks.filter((f) => f.t === t.name).map((f) => ({ name: '', type: 'text' as const, references: { table: f.r, column: '' } })),
      })),
    );
    for (const t of ordered) {
      await this.conn.query(`INSERT INTO ${to}.main.${quoteIdent(t.name)} SELECT * FROM ${from}.main.${quoteIdent(t.name)}`);
    }
  }

  /**
   * Saves the database as EXPORT DATABASE output (schema.sql, load.sql and one
   * CSV per table) in a .tar.gz. DuckDB's CLI can restore it with
   * IMPORT DATABASE after extracting.
   */
  async exportBytes(): Promise<Uint8Array> {
    const dir = this.tempName('');
    await this.conn.query(`EXPORT DATABASE ${quoteLiteral(dir)} (FORMAT csv)`);
    const files = await this.db.globFiles(`${dir}/*`);
    const entries = [];
    try {
      for (const f of files) {
        entries.push({ name: f.fileName.slice(dir.length + 1), data: await this.db.copyFileToBuffer(f.fileName) });
      }
    } finally {
      for (const f of files) await this.db.dropFile(f.fileName).catch(() => {});
    }
    return gzip(tar(entries));
  }

  async importBytes(bytes: Uint8Array) {
    await this.reset();
    if (isGzip(bytes)) {
      const entries = untar(await gunzip(bytes));
      if (!entries.some((e) => e.name.endsWith('schema.sql'))) throw new Error('This file is not a dbify DuckDB export.');
      // Files inside may sit in a folder; IMPORT DATABASE wants them in one directory.
      const base = entries.find((e) => e.name.endsWith('schema.sql'))!.name.replace(/schema\.sql$/, '');
      const dir = this.tempName('');
      const registered: string[] = [];
      try {
        for (const e of entries) {
          if (!e.name.startsWith(base)) continue;
          const name = `${dir}/${e.name.slice(base.length)}`;
          await this.db.registerFileBuffer(name, e.data);
          registered.push(name);
        }
        await this.conn.query(`IMPORT DATABASE ${quoteLiteral(dir)}`);
      } finally {
        for (const n of registered) await this.db.dropFile(n).catch(() => {});
      }
      return;
    }
    // A native .duckdb database file.
    const name = this.tempName('.duckdb');
    await this.db.registerFileBuffer(name, bytes.slice());
    try {
      await this.conn.query(`ATTACH ${quoteLiteral(name)} AS dbify_import (READ_ONLY)`);
      await this.copyDatabase('dbify_import', 'memory');
    } finally {
      await this.conn.query(`DETACH DATABASE IF EXISTS dbify_import`).catch(() => {});
      await this.db.dropFile(name).catch(() => {});
    }
  }

  async reset() {
    const objs = await this.rows<{ name: string; kind: string }>(
      `SELECT table_name AS name, table_type AS kind FROM information_schema.tables
        WHERE table_schema = 'main' AND table_catalog = 'memory'`,
    );
    // Drop in several passes so tables referenced by foreign keys go last.
    let remaining = objs;
    for (let pass = 0; pass < 10 && remaining.length; pass++) {
      const failed: typeof objs = [];
      for (const o of remaining) {
        const what = o.kind === 'VIEW' ? 'VIEW' : 'TABLE';
        await this.conn.query(`DROP ${what} IF EXISTS ${quoteIdent(o.name)}`).catch(() => failed.push(o));
      }
      remaining = failed;
    }
    const seqs = await this.rows<{ name: string }>(`SELECT sequence_name AS name FROM duckdb_sequences() WHERE database_name = 'memory'`).catch(() => []);
    for (const s of seqs) await this.conn.query(`DROP SEQUENCE IF EXISTS ${quoteIdent(s.name)} CASCADE`).catch(() => {});
  }
}

function simplifyType(t: string): string {
  return t
    .replace(/^Int32$/, 'INTEGER')
    .replace(/^Int64$/, 'BIGINT')
    .replace(/^Int16$/, 'SMALLINT')
    .replace(/^Int8$/, 'TINYINT')
    .replace(/^Float64$/, 'DOUBLE')
    .replace(/^Float32$/, 'FLOAT')
    .replace(/^Utf8$/, 'VARCHAR')
    .replace(/^Bool$/, 'BOOLEAN')
    .replace(/^Date32<DAY>$/, 'DATE')
    .replace(/^Timestamp<.*>$/, 'TIMESTAMP')
    .replace(/^Decimal.*$/, 'DECIMAL');
}
