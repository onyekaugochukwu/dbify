import type { EngineId, ImportColumn, LogicalType, TableData } from './types';

/** Converts engine values into something the grid can show and structured-clone can send. */
export function displayValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'bigint':
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    case 'number':
    case 'string':
    case 'boolean':
      return v;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? String(v) : v.toISOString().replace('T', ' ').replace(/(\.000)?Z$/, '');
  if (v instanceof Uint8Array) {
    const hex = Array.from(v.subarray(0, 32), (b) => b.toString(16).padStart(2, '0')).join('');
    return `\\x${hex}${v.length > 32 ? '…' : ''}`;
  }
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    return String(v);
  }
}

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function quoteLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const TYPE_MAP: Record<EngineId, Record<LogicalType, string>> = {
  sqlite: {
    integer: 'INTEGER',
    bigint: 'INTEGER',
    real: 'REAL',
    decimal: 'REAL',
    boolean: 'INTEGER',
    date: 'TEXT',
    timestamp: 'TEXT',
    text: 'TEXT',
  },
  postgres: {
    integer: 'INTEGER',
    bigint: 'BIGINT',
    real: 'DOUBLE PRECISION',
    decimal: 'NUMERIC',
    boolean: 'BOOLEAN',
    date: 'DATE',
    timestamp: 'TIMESTAMP',
    text: 'TEXT',
  },
  duckdb: {
    integer: 'INTEGER',
    bigint: 'BIGINT',
    real: 'DOUBLE',
    decimal: 'DECIMAL(18,2)',
    boolean: 'BOOLEAN',
    date: 'DATE',
    timestamp: 'TIMESTAMP',
    text: 'VARCHAR',
  },
};

export function createTableSql(engine: EngineId, t: { name: string; columns: ImportColumn[] }): string {
  const pks = t.columns.filter((c) => c.pk);
  const lines = t.columns.map((c) => {
    let line = `  ${quoteIdent(c.name)} ${TYPE_MAP[engine][c.type]}`;
    if (pks.length === 1 && c.pk) line += ' PRIMARY KEY';
    else if (c.notNull) line += ' NOT NULL';
    if (c.references) line += ` REFERENCES ${quoteIdent(c.references.table)}(${quoteIdent(c.references.column)})`;
    return line;
  });
  if (pks.length > 1) lines.push(`  PRIMARY KEY (${pks.map((c) => quoteIdent(c.name)).join(', ')})`);
  return `CREATE TABLE ${quoteIdent(t.name)} (\n${lines.join(',\n')}\n)`;
}

/** Orders tables so referenced tables are created (and filled) first. */
export function orderByDependencies(tables: TableData[]): TableData[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const done = new Set<string>();
  const out: TableData[] = [];
  const visit = (t: TableData, stack: Set<string>) => {
    if (done.has(t.name) || stack.has(t.name)) return;
    stack.add(t.name);
    for (const c of t.columns) {
      const dep = c.references && byName.get(c.references.table);
      if (dep && dep !== t) visit(dep, stack);
    }
    done.add(t.name);
    out.push(t);
  };
  tables.forEach((t) => visit(t, new Set()));
  return out;
}

/** RFC 4180 CSV with a header row; null becomes an empty unquoted field. */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    return /[",\r\n]/.test(s) || s === '' ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map(cell).join(',')];
  for (const r of rows) lines.push(r.map(cell).join(','));
  return lines.join('\n') + '\n';
}

/* ---------- tiny promise RPC over postMessage ---------- */

type Handlers = Record<string, (...args: any[]) => any>;

export function serveRpc(handlers: Handlers) {
  self.onmessage = async (e: MessageEvent) => {
    const { id, method, args } = e.data;
    try {
      const value = await handlers[method](...args);
      const transfer = value instanceof Uint8Array ? [value.buffer] : [];
      (self as unknown as Worker).postMessage({ id, value }, transfer);
    } catch (err: any) {
      (self as unknown as Worker).postMessage({ id, error: { message: err?.message ?? String(err), position: err?.position } });
    }
  };
}

export function rpcClient(worker: Worker) {
  let next = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  worker.onmessage = (e) => {
    const { id, value, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(Object.assign(new Error(error.message), { position: error.position }));
    else p.resolve(value);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The database worker crashed.');
    pending.forEach((p) => p.reject(err));
    pending.clear();
  };
  return function call<T = any>(method: string, ...args: any[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      // Arguments are copied, not transferred: callers may keep using their buffers.
      worker.postMessage({ id, method, args });
    });
  };
}
