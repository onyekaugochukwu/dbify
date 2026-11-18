import type { ResultSet } from '../engines/types';

/** Normalises values so SQLite 1/0, Postgres '12.50' and DuckDB 12.5 compare equal. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  if (s === 'true' || s === 'false') return s === 'true' ? '1' : '0';
  return s;
}

export interface CheckOutcome {
  ok: boolean;
  message: string;
}

export function compareResults(mine: ResultSet | undefined, expected: ResultSet, ordered: boolean): CheckOutcome {
  if (!mine) return { ok: false, message: 'Your SQL did not return any rows to check. The last statement should be a SELECT.' };
  if (mine.columns.length !== expected.columns.length) {
    return {
      ok: false,
      message: `Your result has ${mine.columns.length} column${mine.columns.length === 1 ? '' : 's'}; the expected result has ${expected.columns.length}. Check which columns you SELECT.`,
    };
  }
  if (mine.totalRows !== expected.totalRows) {
    return { ok: false, message: `Your result has ${mine.totalRows} row${mine.totalRows === 1 ? '' : 's'}; the expected result has ${expected.totalRows}. Check your WHERE, JOIN or LIMIT.` };
  }
  const key = (r: unknown[]) => r.map(norm).join('\u0001');
  const a = mine.rows.map(key);
  const b = expected.rows.map(key);
  if (ordered) {
    const i = a.findIndex((x, k) => x !== b[k]);
    if (i === -1) return { ok: true, message: 'Correct! Your result matches.' };
    const sameSet = [...a].sort().join('\n') === [...b].sort().join('\n');
    return { ok: false, message: sameSet ? 'The right rows, but in the wrong order. Check your ORDER BY.' : `Row ${i + 1} is different from the expected result.` };
  }
  const sa = [...a].sort(), sb = [...b].sort();
  const i = sa.findIndex((x, k) => x !== sb[k]);
  return i === -1 ? { ok: true, message: 'Correct! Your result matches.' } : { ok: false, message: 'Some of your rows are different from the expected result.' };
}
