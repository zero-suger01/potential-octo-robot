// xlsx.js — minimal yozuvchi testi: ZIP tuzilishi va ichidagi xml to'g'riligi
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeSheet, zipStore } = require('../lib/xlsx');

const tmp = path.join(require('os').tmpdir(), `xlsx-test-${Date.now()}.xlsx`);
const header = ['n', 'kalit', 'umumiy', 'ochiq', 'holat'];
const rows = [
  [1, '969ae63a41', 15.2, 13.43, 'yuborildi'],
  [2, 'ab12cd34ef', 7.5, 6.8, 'yuborildi'],
  [3, 'ff00aa11bb', 22.0, 18.5, 'yuborildi'],
];
writeSheet(tmp, header, rows);
const buf = fs.readFileSync(tmp);

// ZIP sarlavhasi
assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'local file header');
// Oxiriga EOCD markeri
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
assert(eocd > 0, 'EOCD topildi');
const nfiles = buf.readUInt16LE(eocd + 10);
assert.strictEqual(nfiles, 5, 'xlsx ichida 5 ta fayl');

// Ichidagi fayllarni ajratib olish (store — compression=0, data xom)
const files = {};
let p = 0;
while (p < buf.length && buf.readUInt32LE(p) === 0x04034b50) {
  const method = buf.readUInt16LE(p + 8);
  const size = buf.readUInt32LE(p + 22);
  const nlen = buf.readUInt16LE(p + 26);
  const xlen = buf.readUInt16LE(p + 28);
  const name = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
  const data = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
  files[name] = { data: data.toString('utf8'), method };
  p += 30 + nlen + xlen + size;
}
for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
  assert(files[f], `${f} kerak`);
  assert.strictEqual(files[f].method, 0, `${f} STORE bo'lishi kerak`);
}
const sheet = files['xl/worksheets/sheet1.xml'].data;
for (const row of rows) for (const v of row) {
  assert(sheet.includes(String(v)), `qiymat yo'q: ${v}`);
}
for (const h of header) assert(sheet.includes(h), `sarlavha yo'q: ${h}`);
assert(sheet.includes('<row r="1">'), 'birinchi satr');
assert(sheet.includes('<row r="4">'), '4-satr (3 ta data + 1 header)');

// 3+ xonadon uchun katta sinov
const big = Array.from({ length: 8 }, (_, i) => [i + 1, `k${i}`, 10 + i, 8 + i, 'yuborildi']);
writeSheet(tmp, header, big);
const buf2 = fs.readFileSync(tmp);
assert(buf2.readUInt32LE(0) === 0x04034b50);

fs.unlinkSync(tmp);
void zlib;
console.log(`OK: xlsx yozuvchi — ${nfiles} fayl, ${rows.length} satr + sarlavha, 8 satr katta sinov`);
