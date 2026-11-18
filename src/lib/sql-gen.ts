// Builds the SQL behind the table editor: filtered/sorted/paged SELECTs and
// the UPDATE / INSERT / DELETE statements for edited rows. The generated SQL
// is shown to students, so it is kept readable.
import type { ColumnInfo, EngineId } from '../engines/types';

export function ident(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name) ? name : '"' + name.replace(/"/g, '""') + '"';
}

const RESERVED = new Set(['select', 'from', 'where', 'order', 'group', 'table', 'user', 'limit', 'offset', 'key', 'default', 'column', 'check', 'primary', 'references', 'end', 'case', 'when', 'all', 'and', 'or', 'not', 'null', 'to', 'in', 'is', 'as', 'by', 'on', 'desc', 'asc', 'union', 'join', 'having', 'distinct', 'values', 'into', 'set', 'update', 'delete', 'insert', 'create', 'drop', 'index', 'unique', 'true', 'false']);

const NUMERIC = /int|real|double|float|numeric|decimal|number|serial/i;
const BOOL = /bool/i;

export const isNumericType = (t: string) => NUMERIC.test(t);

/** Turns what the user typed into a SQL literal suited to the column. */
export function literal(value: unknown, type: string, engine: EngineId): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return engine === 'sqlite' ? (value ? '1' : '0') : value ? 'TRUE' : 'FALSE';
  const s = String(value);
  if (NUMERIC.test(type) && /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(s)) return s.trim();
  if (BOOL.test(type) && /^(true|false|t|f|yes|no|1|0)$/i.test(s.trim())) {
    const v = /^(true|t|yes|1)$/i.test(s.trim());
    return engine === 'sqlite' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE';
  }
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Column filters as students would write them in the filter box:
 *   text        contains (case-insensitive)
 *   =x  !=x  >x  >=x  <x  <=x
 *   null / not null / empty
 */
export function filterCondition(col: ColumnInfo, raw: string, engine: EngineId): string | null {
  const f = raw.trim();
  if (!f) return null;
  const c = ident(col.name);
  if (/^null$/i.test(f)) return `${c} IS NULL`;
  if (/^not\s+null$/i.test(f)) return `${c} IS NOT NULL`;
  if (/^empty$/i.test(f)) return `(${c} IS NULL OR CAST(${c} AS TEXT) = '')`;
  const m = /^(!=|<>|>=|<=|=|>|<)\s*(.*)$/.exec(f);
  if (m) {
    const op = m[1] === '<>' ? '!=' : m[1];
    return `${c} ${op} ${literal(m[2], col.type, engine)}`;
  }
  if (NUMERIC.test(col.type) && /^-?\d+(\.\d+)?$/.test(f)) return `${c} = ${f}`;
  const like = "'%" + f.toLowerCase().replace(/'/g, "''") + "%'";
  return `LOWER(CAST(${c} AS TEXT)) LIKE ${like}`;
}

export interface PageQuery {
  table: string;
  /** Hidden row-id expression for tables without a primary key (rowid / ctid). */
  rowIdExpr?: string;
  where: string[];
  orderBy?: { column: string; dir: 'ASC' | 'DESC' };
  limit: number;
  offset: number;
}

export function selectSql(q: PageQuery): string {
  const cols = q.rowIdExpr ? `${q.rowIdExpr} AS dbify_rowid, *` : '*';
  let s = `SELECT ${cols}\nFROM ${ident(q.table)}`;
  if (q.where.length) s += `\nWHERE ${q.where.join('\n  AND ')}`;
  if (q.orderBy) s += `\nORDER BY ${ident(q.orderBy.column)} ${q.orderBy.dir}`;
  s += `\nLIMIT ${q.limit}`;
  if (q.offset) s += ` OFFSET ${q.offset}`;
  return s;
}

/** The same query a student would write, without dbify's hidden row id. */
export function displaySql(q: PageQuery): string {
  return selectSql({ ...q, rowIdExpr: undefined }) + ';';
}

export function countSql(table: string, where: string[]): string {
  return `SELECT COUNT(*) AS n FROM ${ident(table)}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
}

/** Hidden row identifier for tables without a primary key. */
export function rowIdExpression(engine: EngineId): string {
  return engine === 'postgres' ? 'ctid::text' : 'rowid';
}
