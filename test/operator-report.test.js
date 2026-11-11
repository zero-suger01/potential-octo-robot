// Operator-profil hisoboti: reports/<yil>/<n>-xatlov/<operator>.(xlsx|csv|json)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Platformani vaqtincha tmp ga yo'naltirish — testdan oldin HOME belgilaymiz
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tomorqa-op-'));
process.env.TOMORQA_HOME = tmpHome;
delete require.cache[require.resolve('../lib/platform')];
const { Bot } = require('../lib/bot');

// Bot ni ADB'ga bog'lanmasdan sinaymiz — faqat records yozish
const b = new Bot({ serial: 'fake', operator: 'SINOV_OP', campaign: 1, limit: 3 }, () => {});
b.records = [
  { i: 1, key: 'aa11', sec: 42, submit: 'submitted', p: {
    total: 15.2, open: 13.4, cropArea: '13.2',
    water: { plot: { status: 'Таъминланган', type: 'Насос кўмагида олиб келинади' }, drink: { status: 'Таъминланган', type: 'Марказлашган (Артизан)' } },
    openCrops: [{ name: 'Пиёз', area: '1.4', plantDate: new Date(2026, 2, 21) }, { name: 'Сабзи', area: '2', plantDate: new Date(2026, 2, 7) }],
    greenhouse: null, trees: [{ name: 'Узум', count: 7, area: '0.59', age: 8 }],
  }},
  { i: 2, key: 'bb22', sec: 55, submit: 'submitted', p: {
    total: 8.0, open: 7.2, cropArea: '7', water: { plot: { status: 'Таъминланган', type: 'Оқар сув (Ариқ)' }, drink: { status: 'Таъминланган', type: 'Тик қудуқ' } },
    openCrops: [{ name: 'Укроп', area: '7', plantDate: new Date(2026, 2, 15) }], greenhouse: null, trees: null,
  }},
  { i: 3, key: 'cc33', sec: 38, submit: 'submitted', p: {
    total: 22.5, open: 19.0, cropArea: '18',
    water: { plot: { status: 'Таъминланган', type: 'Оқар сув (Ариқ)' }, drink: { status: 'Таъминланган', type: 'Марказлашган (Артизан)' } },
    openCrops: [{ name: 'Картошка', area: '10', plantDate: new Date(2026, 2, 10) }, { name: 'Пиёз', area: '5.5', plantDate: new Date(2026, 2, 20) }],
    greenhouse: { crop: 'Помидор', area: '2.5', heating: 'Электр токи', cover: 'Ойнали', plantDate: new Date(2026, 2, 25), builtDate: new Date(2026, 1, 15) }, trees: null,
  }},
];
b.saveOperatorReport();

const dir = path.join(tmpHome, 'reports', String(new Date().getFullYear()), '1-xatlov');
for (const ext of ['csv', 'json', 'xlsx']) {
  const f = path.join(dir, `SINOV_OP.${ext}`);
  assert(fs.existsSync(f), `${ext} yozilmadi: ${f}`);
}
const csv = fs.readFileSync(path.join(dir, 'SINOV_OP.csv'), 'utf8');
assert(csv.startsWith('﻿'), 'CSV BOM bilan (Excel kirillcha o\'qiydi)');
assert(csv.includes('SINOV_OP') || csv.includes('aa11'), 'CSV da yozuvlar bor');
for (const k of ['aa11', 'bb22', 'cc33']) assert(csv.includes(k), `CSV da kalit ${k}`);
assert(csv.includes('Пиёз') && csv.includes('Узум') && csv.includes('Помидор'), 'CSV da ekinlar');

const json = JSON.parse(fs.readFileSync(path.join(dir, 'SINOV_OP.json'), 'utf8'));
assert.strictEqual(json.operator, 'SINOV_OP');
assert.strictEqual(json.xatlov, 1);
assert.strictEqual(json.rows.length, 3);
assert.deepStrictEqual(json.rows.map((r) => r.kalit), ['aa11', 'bb22', 'cc33']);

const xlsx = fs.readFileSync(path.join(dir, 'SINOV_OP.xlsx'));
assert.strictEqual(xlsx.readUInt32LE(0), 0x04034b50, 'xlsx ZIP sarlavhasi');
assert(xlsx.length > 1000, 'xlsx bo\'sh emas');

// Tozalash
fs.rmSync(tmpHome, { recursive: true, force: true });
console.log('OK: operator hisobot — 3 xonadon, csv+json+xlsx saqlandi, kirillcha o\'qildi');
