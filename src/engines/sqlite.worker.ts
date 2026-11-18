import initSqlJs from 'sql.js';
import { displayValue, serveRpc, createTableSql, orderByDependencies, quoteIdent } from './common';
import { splitStatements } from './sql-split';
import { MAX_DISPLAY_ROWS, type StatementResult, type TableData, type TableInfo } from './types';

let SQL: any;
let db: any;

function open(bytes?: Uint8Array | null) {
  db?.close();
  db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
}

function typeOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return 'INTEGER';
  if (typeof v === 'number') return Number.isInteger(v) ? 'INTEGER' : 'REAL';
  if (v instanceof Uint8Array) return 'BLOB';
  return 'TEXT';
}

serveRpc({
  async init(wasm: Uint8Array, saved?: Uint8Array | null) {
    SQL = await initSqlJs({ wasmBinary: wasm });
    open(saved);
  },

  run(text: string): StatementResult[] {
    const results: StatementResult[] = [];
    for (const { sql, offset } of splitStatements(text)) {
      const t0 = performance.now();
      let stmt: any;
      try {
        stmt = db.prepare(sql);
        const names: string[] = stmt.getColumnNames();
        if (names.length === 0) {
          stmt.step();
          results.push({ sql, offset, ms: performance.now() - t0, rowsAffected: db.getRowsModified() });
        } else {
          const rows: unknown[][] = [];
          const types: string[] = names.map(() => '');
          let total = 0;
          while (stmt.step()) {
            total++;
            if (rows.length < MAX_DISPLAY_ROWS) {
              const raw: unknown[] = stmt.get(null, { useBigInt: true });
              raw.forEach((v, i) => {
                if (!types[i]) types[i] = typeOf(v);
              });
              rows.push(raw.map(displayValue));
            }
          }
          results.push({
            sql,
            offset,
            ms: performance.now() - t0,
            result: {
              columns: names.map((name, i) => ({ name, type: types[i] })),
              rows,
              totalRows: total,
              truncated: total > rows.length,
            },
          });
        }
      } catch (e: any) {
        results.push({ sql, offset, ms: performance.now() - t0, error: e?.message ?? String(e) });
        break;
      } finally {
        stmt?.free();
      }
    }
    return results;
  },

  schema(): TableInfo[] {
    const q = (sql: string) => {
      const r = db.exec(sql);
      return r.length ? (r[0].values as unknown[][]) : [];
    };
    const objects = q(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    return objects.map(([name, type]) => {
      const n = String(name);
      const columns = q(`PRAGMA table_info(${quoteIdent(n)})`).map((c) => ({
        name: String(c[1]),
        type: String(c[2] || ''),
        notNull: !!c[3],
        pk: Number(c[5]) > 0,
      }));
      const foreignKeys = q(`PRAGMA foreign_key_list(${quoteIdent(n)})`).map((f) => ({
        column: String(f[3]),
        refTable: String(f[2]),
        refColumn: String(f[4] ?? ''),
      }));
      let rowCount: number | undefined;
      if (type === 'table') {
        try {
          rowCount = Number(q(`SELECT count(*) FROM ${quoteIdent(n)}`)[0][0]);
        } catch {}
      }
      return { name: n, kind: type === 'view' ? 'view' : 'table', columns, foreignKeys, rowCount } as TableInfo;
    });
  },

  createTables(tables: TableData[]) {
    db.run('BEGIN');
    try {
      for (const t of orderByDependencies(tables)) {
        db.run(createTableSql('sqlite', t));
        const ph = t.columns.map(() => '?').join(', ');
        const stmt = db.prepare(`INSERT INTO ${quoteIdent(t.name)} VALUES (${ph})`);
        for (const row of t.rows) {
          stmt.run(row.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)));
        }
        stmt.free();
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
  },

  exportBytes(): Uint8Array {
    const bytes: Uint8Array = db.export();
    db.run('PRAGMA foreign_keys = ON');
    return bytes;
  },

  importBytes(bytes: Uint8Array) {
    open(bytes);
  },

  reset() {
    open(null);
  },
});
