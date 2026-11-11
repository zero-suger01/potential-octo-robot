// Qoidalar testi: node test/rules.test.js
const assert = require('assert');
const { makePlan, mulberry32, toC, campaign } = require('../lib/rules');
const { TREES, OPEN_CROPS } = require('../lib/catalog');

const today = new Date(2026, 10, 4); // 4-noyabr 2026 — kuz xatlovi (uchinchi xatlov)
const KAMPANIYA = campaign(today); // ekish sanalari faqat shu oylarda bo'lishi kerak
assert.strictEqual(KAMPANIYA.n, 3, 'noyabr — uchinchi xatlov');
assert.strictEqual(campaign(new Date(2026, 2, 15)).n, 1, 'mart — birinchi xatlov');
assert.strictEqual(campaign(new Date(2026, 6, 28)).n, 2, 'iyul oxiri — ikkinchi xatlov');
// 1 sotix = 100 m²: har ekin o'z eng kichik maydonidan kichik maydonga tushmasligi kerak
const minArea = (name) => (OPEN_CROPS.find((c) => c.name === name) || {}).minArea;
// Yuqori chegara: alohida ko'rsatilmasa minimumning 10 barobari, lekin kamida 2 sotix
const maxArea = (name) => {
  const c = OPEN_CROPS.find((x) => x.name === name) || {};
  return c.maxArea != null ? c.maxArea : Math.max(2, c.minArea * 10);
};
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
    assert(KAMPANIYA.months.includes(c.plantDate.getMonth() + 1),
      `ekish oyi xatlov davrida: ${c.name} ${c.plantDate.toISOString().slice(0, 10)}`);
    assert(c.fasl.includes(KAMPANIYA.fasl), `ekin fasli xatlovga mos: ${c.name}`);
    assert(+c.area + 1e-9 >= minArea(c.name),
      `ekin maydoni o'z minimumidan kichik emas: ${c.name} ${c.area} < ${minArea(c.name)} sotix`);
    assert(+c.area <= maxArea(c.name) + 1e-9,
      `ekin maydoni yuqori chegaradan oshmaydi: ${c.name} ${c.area} > ${maxArea(c.name)} sotix`);
    assert(toC(+c.area) > 0);
  }
  if (p.greenhouse) {
    assert(total > 13, 'issiqxona faqat >13 sotix');
    const g = toC(+p.greenhouse.area);
    assert(g >= 200 && g <= 300, 'issiqxona 2–3 sotix');
    assert(p.greenhouse.heating !== 'Газ');
    assert(p.greenhouse.funding === 'Ўз маблағлари ҳисобидан');
    assert(KAMPANIYA.months.includes(p.greenhouse.plantDate.getMonth() + 1),
      `issiqxona ekish oyi xatlov davrida: ${p.greenhouse.plantDate.toISOString().slice(0, 10)}`);
    const days = (today - p.greenhouse.builtDate) / 86400000;
    assert(days >= 27 && days <= 140, 'issiqxona ekishdan oldin qurilgan');
    assert(p.greenhouse.plantDate >= p.greenhouse.builtDate && p.greenhouse.plantDate < today);
  }
  if (p.trees) {
    assert(total > 4.5, 'daraxt faqat >4.5 sotix');
    assert(tr, 'daraxt faqat tanlangan xonadonga');
    for (const t of p.trees) {
      assert(t.count >= 1 && t.age >= 2 && t.age <= 10, `daraxt yoshi 2–10: ${t.age}`);
      assert(t.count <= Math.floor(total), `daraxt soni umumiy sotixdan oshmaydi: ${t.count} > ${total}`);
      const per = TREES.find((x) => x.name === t.name).perTree[0];
      assert(+t.area / t.count >= per - 1e-9, `daraxt juda zich: ${t.name} ${t.count} dona ${t.area} sotixda`);
    }
    const count = p.trees.reduce((s, t) => s + t.count, 0);
    assert(count <= Math.min(12, Math.floor(total)), `daraxt ko'p: ${count} dona, umumiy ${total} sotix`);
  }
  if (total < 3) assert(!p.openCrops.some((c) => c.name === 'Маккажўхори'));
}
console.log(`OK: ${n} ta reja tekshirildi`);
console.log(JSON.stringify(makePlan({ total: 16.3, open: 12.4 }, { today, greenhouse: true, rng: mulberry32(7), available: { open: TOKSON } }), null, 1));
