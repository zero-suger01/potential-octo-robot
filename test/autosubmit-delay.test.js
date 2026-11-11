// AUTO_SUBMIT random kutish: [min, max] oralig'ida har safar boshqa qiymat
const assert = require('assert');
const { Bot } = require('../lib/bot');

const b = new Bot({ serial: 'fake', autoSubmitDelayMin: 2, autoSubmitDelayMax: 8 }, () => {});
assert.strictEqual(b.autoDelayMin, 2);
assert.strictEqual(b.autoDelayMax, 8);

// 50 ta namuna — hammasi oraliqda, va kamida ikkita farqli (random)
const samples = [];
for (let i = 0; i < 50; i++) {
  const d = b.autoDelayMin + Math.random() * (b.autoDelayMax - b.autoDelayMin);
  assert(d >= 2 && d <= 8, `oraliqda: ${d}`);
  samples.push(d);
}
const unique = new Set(samples.map((x) => x.toFixed(2)));
assert(unique.size >= 40, `random: ${unique.size} / 50 farqli`);

// Min>max bo'lsa: max = min bo'lib tekislanadi (cfg qabul qilinmaydi)
const b2 = new Bot({ serial: 'fake', autoSubmitDelayMin: 10, autoSubmitDelayMax: 3 }, () => {});
assert.strictEqual(b2.autoDelayMax, 10, 'max >= min');

// Standart qiymat
const b3 = new Bot({ serial: 'fake' }, () => {});
assert.strictEqual(b3.autoDelayMin, 3);
assert.strictEqual(b3.autoDelayMax, 8);

console.log(`OK: AUTO_SUBMIT random kutish — ${unique.size} farqli qiymat 50 dan`);
