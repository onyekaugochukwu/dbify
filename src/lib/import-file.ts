// Turns CSV, TSV, JSON, NDJSON, Parquet and Excel files into typed tables.
import Papa from 'papaparse';
import type { ImportColumn, LogicalType, TableData } from '../engines/types';

export const IMPORT_ACCEPT = '.csv,.tsv,.txt,.json,.ndjson,.jsonl,.parquet,.xlsx,.xls,.xlsm,.ods';

export function tableNameFromFile(fileName: string): string {
  return safeIdentifier(fileName.replace(/\.[^.]+$/, ''), 'imported');
}

/** snake_case, lower-case identifier that never needs quoting in any engine. */
export function safeIdentifier(raw: string, fallback: string): string {
  let s = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = '_' + s;
  if (RESERVED.has(s)) s = s + '_';
  return s.slice(0, 60);
}

const RESERVED = new Set(
  'all and any as asc between by case cast check column constraint create cross default delete desc distinct drop else end except exists false fetch for foreign from full group having in inner insert intersect into is join key left like limit natural not null offset on or order outer primary references right select set table then to true union unique update using values when where window with'.split(' '),
);

function uniqueNames(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let n = safeIdentifier(String(h ?? ''), `column_${i + 1}`);
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    if (count) n = `${n}_${count + 1}`;
    return n;
  });
}

/* ---------------- type inference ---------------- */

const INT_RE = /^[-+]?(0|[1-9]\d*)$/;
const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const BOOL_TRUE = new Set(['true', 'yes', 't', 'y']);
const BOOL_FALSE = new Set(['false', 'no', 'f', 'n']);

function inferType(values: unknown[]): LogicalType {
  let sawAny = false;
  let isBool = true, isInt = true, isNum = true, isDate = true, isTs = true, moneyLike = true, big = false;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    sawAny = true;
    if (typeof v === 'boolean') {
      isInt = isNum = isDate = isTs = false;
      continue;
    }
    if (v instanceof Date) {
      isBool = isInt = isNum = false;
      if (v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()) isDate = false;
      continue;
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
      isBool = isDate = isTs = false;
      const n = Number(v);
      if (!Number.isInteger(n)) {
        isInt = false;
        if (!/^-?\d+(\.\d{1,4})?$/.test(String(v))) moneyLike = false;
      } else if (Math.abs(n) > 2147483647) big = true;
      continue;
    }
    const s = String(v).trim();
    const low = s.toLowerCase();
    if (!BOOL_TRUE.has(low) && !BOOL_FALSE.has(low)) isBool = false;
    // Leading zeros (phone numbers, IDs like 007) must stay text.
    if (!INT_RE.test(s)) isInt = false;
    else if (Math.abs(Number(s)) > 2147483647) big = true;
    if (!NUM_RE.test(s) || /^[-+]?0\d/.test(s)) isNum = false;
    else if (s.includes('.') && !/^[-+]?\d+\.\d{1,4}$/.test(s)) moneyLike = false;
    if (!DATE_RE.test(s)) isDate = false;
    if (!TS_RE.test(s) && !DATE_RE.test(s)) isTs = false;
    if (!(isBool || isInt || isNum || isDate || isTs)) return 'text';
  }
  if (!sawAny) return 'text';
  if (isBool) return 'boolean';
  if (isInt) return big ? 'bigint' : 'integer';
  if (isNum) return moneyLike ? 'decimal' : 'real';
  if (isDate) return 'date';
  if (isTs) return 'timestamp';
  return 'text';
}

function convert(v: unknown, t: LogicalType): unknown {
  if (v === null || v === undefined) return null;
  if (v === '' && t !== 'text') return null;
  switch (t) {
    case 'boolean':
      return typeof v === 'boolean' ? v : BOOL_TRUE.has(String(v).trim().toLowerCase());
    case 'integer':
    case 'bigint':
    case 'real':
    case 'decimal':
      return typeof v === 'number' ? v : Number(String(v).trim());
    case 'date':
      return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
    case 'timestamp':
      return v instanceof Date ? v.toISOString().replace('T', ' ').replace(/(\.000)?Z$/, '') : String(v).trim().replace('T', ' ');
    default:
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
      return String(v);
  }
}

export function buildTable(name: string, header: unknown[], rows: unknown[][]): TableData {
  const names = uniqueNames(header);
  const sample = (i: number) => rows.map((r) => r[i]);
  const columns: ImportColumn[] = names.map((n, i) => ({ name: n, type: inferType(sample(i)) }));
  const data = rows
    .filter((r) => r.some((v) => v !== null && v !== undefined && v !== ''))
    .map((r) => columns.map((c, i) => convert(r[i], c.type)));
  return { name, columns, rows: data };
}

function fromObjects(name: string, objects: Record<string, unknown>[]): TableData {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const o of objects) for (const k of Object.keys(o ?? {})) if (!seen.has(k)) seen.add(k), keys.push(k);
  return buildTable(name, keys, objects.map((o) => keys.map((k) => (o ?? {})[k])));
}

/* ---------------- readers ---------------- */

export async function parseFile(file: File, baseName = tableNameFromFile(file.name)): Promise<TableData[]> {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
      skipEmptyLines: 'greedy',
      delimiter: ext === 'tsv' ? '\t' : '',
    });
    if (!parsed.data.length) throw new Error('The file is empty.');
    const [header, ...rows] = parsed.data;
    return [buildTable(baseName, header, rows)];
  }
  if (['json', 'ndjson', 'jsonl'].includes(ext)) {
    const text = (await file.text()).trim();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    }
    if (data && !Array.isArray(data) && typeof data === 'object') {
      const arrays = Object.entries(data as object).filter(([, v]) => Array.isArray(v));
      if (arrays.length) return arrays.map(([k, v]) => fromObjects(arrays.length === 1 ? baseName : `${baseName}_${safeIdentifier(k, 'data')}`, v));
      data = [data];
    }
    if (!Array.isArray(data)) throw new Error('Expected a JSON array of objects.');
    if (data.length && Array.isArray(data[0])) {
      const [header, ...rows] = data as unknown[][];
      return [buildTable(baseName, header, rows)];
    }
    return [fromObjects(baseName, data as Record<string, unknown>[])];
  }
  if (ext === 'parquet') {
    const { parquetReadObjects } = await import('hyparquet');
    const objects = await parquetReadObjects({ file: await file.arrayBuffer() });
    return [fromObjects(baseName, objects as Record<string, unknown>[])];
  }
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
    const sheets = wb.SheetNames.map((s) => ({
      sheet: s,
      rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s], { header: 1, raw: true, blankrows: false, defval: null }),
    })).filter((s) => s.rows.length > 0);
    if (!sheets.length) throw new Error('The workbook has no data.');
    return sheets.map(({ sheet, rows }) => {
      const [header, ...rest] = rows;
      const name = sheets.length === 1 ? baseName : `${baseName}_${safeIdentifier(sheet, 'sheet')}`;
      return buildTable(name, header, rest);
    });
  }
  throw new Error(`dbify can't import .${ext} files. Try CSV, JSON, Parquet or Excel.`);
}
