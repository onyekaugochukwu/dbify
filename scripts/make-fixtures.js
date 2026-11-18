// Creates the sample import files used by scripts/test.js (CSV, Excel, JSON, Parquet).
import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parquetWriteBuffer } from 'hyparquet-writer';

const dir = 'test-output/files';
mkdirSync(dir, { recursive: true });
const rows = [['Transaction ID', 'Amount', 'Hour', 'Merchant Category', 'Is Foreign', 'Date']];
for (let i = 0; i < 50; i++) {
  rows.push([`TXN${100000 + i}`, Math.round(((i * 7919) % 10000)) / 100, i % 24, ['grocery', 'fuel', 'online'][i % 3], i % 7 === 0, new Date(Date.UTC(2025, 0, 1 + i))]);
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Fraud');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 'x'], [2, 'y']]), 'Other');
writeFileSync(`${dir}/fraud.xlsx`, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
writeFileSync(`${dir}/fraud_data.csv`, rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)).join(',')).join('\n'));
writeFileSync(`${dir}/people.json`, JSON.stringify([{ name: 'Ada', age: 31, city: 'Lagos', phone: '08031234567' }, { name: 'Bayo', age: null, city: 'Ibadan', phone: '08099999999', extra: { x: 1 } }]));
writeFileSync(
  `${dir}/scores.parquet`,
  new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'id', data: [1, 2, 3], type: 'INT32' },
        { name: 'score', data: [9.5, 7.25, 8], type: 'DOUBLE' },
        { name: 'label', data: ['a', 'b', null], type: 'STRING' },
      ],
    }),
  ),
);
console.log('fixtures written to', dir);
