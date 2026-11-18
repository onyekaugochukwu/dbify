import { toCsv } from '../engines/common';
import type { ResultSet } from '../engines/types';

export function downloadBytes(bytes: Uint8Array | string, fileName: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export async function exportResult(r: ResultSet, format: 'csv' | 'json' | 'xlsx', base = 'result') {
  const names = r.columns.map((c) => c.name);
  if (format === 'csv') return downloadBytes(toCsv(names, r.rows), `${base}.csv`, 'text/csv');
  if (format === 'json') {
    const objs = r.rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
    return downloadBytes(JSON.stringify(objs, null, 2), `${base}.json`, 'application/json');
  }
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([names, ...r.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Result');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  downloadBytes(new Uint8Array(out), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
