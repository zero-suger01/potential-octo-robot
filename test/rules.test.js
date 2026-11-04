// Qoidalar testi: node test/rules.test.js
const assert = require('assert');
const { makePlan, mulberry32, toC } = require('../lib/rules');

const today = new Date(2026, 10, 4); // 4-noyabr 2026
const TOKSON = ['Сабзи', 'Пиёз', 'Саримсоқпиёз', 'Карам', 'Гул карам', 'Колраби', 'Оқ бошли карам', 'Қизил бошли карам',
  'Пекин карами', 'Баргли хитой карами', 'Салат руколла', 'Салат айсберг', 'Селдрей', 'Айсберг', 'Укроп', 'Петрушка',
  'Кашнич', 'Кўкпиёз', 'Отқулоқ', 'Исмалоқ', 'Редиска', 'Ош лавлаги', 'Шолғом', 'Турп', 'Қўзиқорин',
  'Ер тути (қулупнай)', 'Олтинсимон қорағат (смародина)', 'Брокколи'];

let n = 0;
for (let seed = 1; seed <= 3000; seed++) {
  const rng = mulberry32(seed);
  const total = +(0.5 + rng() * 25).toFixed(2);
  const open = +(Math.min(total, 0.2 + rng() * total)).toFixed(2);
  const gh = rng() < 0.3, tr = rng() < 0.5;
  const p = makePlan({ total, open }, { today, greenhouse: gh, trees: tr, rng, available: { open: TOKSON } });
  if (p.skip) continue;
  n++;
  const X = toC(+p.cropArea), O = toC(open);
  assert(X > 0 && X < O, `ekin maydoni ochiqdan kichik bo'lsin: ${p.cropArea} vs ${open}`);
  const sum = p.openCrops.reduce((s, c) => s + toC(+c.area), 0)
    + (p.greenhouse ? toC(+p.greenhouse.area) : 0)
    + (p.trees || []).reduce((s, t) => s + toC(+t.area), 0);
  assert.strictEqual(sum, X, `yig'indi ekin maydoniga teng: ${sum} vs ${X}`);
  for (const c of p.openCrops) {
    assert(TOKSON.includes(c.name));
    assert(c.plantDate < today, 'sana bugundan oldin');
    assert(toC(+c.area) > 0);
  }
  if (p.greenhouse) {
    assert(total > 13, 'issiqxona faqat >13 sotix');
    const g = toC(+p.greenhouse.area);
    assert(g >= 200 && g <= 300, 'issiqxona 2–3 sotix');
    assert(p.greenhouse.heating !== 'Газ');
    assert(p.greenhouse.funding === 'Ўз маблағлари ҳисобидан');
    const days = (today - p.greenhouse.builtDate) / 86400000;
    assert(days >= 30 && days <= 60, 'issiqxona 1–2 oy oldin');
    assert(p.greenhouse.plantDate >= p.greenhouse.builtDate && p.greenhouse.plantDate < today);
  }
  if (p.trees) {
    assert(total > 4.5, 'daraxt faqat >4.5 sotix');
    assert(tr, 'daraxt faqat tanlangan xonadonga');
    for (const t of p.trees) assert(t.count >= 1 && t.age >= 2 && t.age <= 10, `daraxt yoshi 2–10: ${t.age}`);
  }
  if (total < 3) assert(!p.openCrops.some((c) => c.name === 'Маккажўхори'));
}
console.log(`OK: ${n} ta reja tekshirildi`);
console.log(JSON.stringify(makePlan({ total: 16.3, open: 12.4 }, { today, greenhouse: true, rng: mulberry32(7), available: { open: TOKSON } }), null, 1));
