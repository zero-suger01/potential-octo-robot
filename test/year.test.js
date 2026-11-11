// Kalendar g'ildiragi otkan yilni tanlamasligi testi.
// Qo'lda tanlangan xatlov (maxBack=400) uchun ham plantDate joriy yildan oldinga tushmaydi.
const assert = require('assert');
const { makePlan, mulberry32, plantDates, campaign } = require('../lib/rules');
const { TREES, OPEN_CROPS } = require('../lib/catalog');

const AVAIL = { open: OPEN_CROPS.map((c) => c.name), greenhouse: ['Помидор', 'Бодринг', 'Булғор қалампир', 'Лимон', 'Ер тути (қулупнай)', 'Кўкпиёз', 'Укроп'], trees: TREES.map((t) => t.name) };

// 1) Joriy yil = 2026, xatlov qo'lda = 1 (mart): maxBack 400 → o'tgan yilga tushishi mumkin edi.
// Bot plantDate joriy yildan OLDINGA tushmasligi kerak.
{
  const today = new Date(2026, 1, 10); // fevral boshi — mart xatlov yaqin, lekin hali boshqa yil g'ildiragi xavfli
  for (let seed = 1; seed <= 500; seed++) {
    const rng = mulberry32(seed);
    const total = 10 + rng() * 10, open = Math.min(total - 0.1, 2 + rng() * total);
    const p = makePlan({ total: +total.toFixed(2), open: +open.toFixed(2) },
      { today, greenhouse: true, trees: true, rng, campaign: 1, available: AVAIL });
    if (p.skip) continue;
    for (const c of (p.openCrops || [])) {
      assert(c.plantDate.getFullYear() === today.getFullYear(),
        `ekin sanasi joriy yilda: ${c.name} ${c.plantDate.toISOString()}`);
    }
    if (p.greenhouse) {
      assert(p.greenhouse.plantDate.getFullYear() === today.getFullYear(),
        `issiqxona ekish sanasi joriy yilda: ${p.greenhouse.plantDate.toISOString()}`);
      assert(p.greenhouse.builtDate.getFullYear() === today.getFullYear(),
        `issiqxona qurilish sanasi joriy yilda: ${p.greenhouse.builtDate.toISOString()}`);
    }
  }
}

// 2) plantDates to'g'ridan-to'g'ri: joriy yildan oldingi sana qaytarmasligi
{
  const today = new Date(2026, 0, 20); // yanvar — oldingi yilga tushish ehtimoli yuqori
  const dates = plantDates([3], today, 7, 400, 2026);
  for (const d of dates) assert(d.getFullYear() === 2026, `yil 2026: ${d.toISOString()}`);
  const noClamp = plantDates([3], today, 7, 400);
  // minYear ko'rsatilmasa — bugungi yil olinadi (standart)
  for (const d of noClamp) assert(d.getFullYear() === 2026);
}

// 3) 3 xonadon sinovi: har xil umumiy maydon, hammasi joriy yilda
{
  const today = new Date(2026, 6, 15); // iyul — 2-xatlov
  const totals = [5.2, 12.8, 20.0];
  for (const total of totals) {
    const p = makePlan({ total, open: total - 1 }, { today, greenhouse: total > 13, trees: total > 4.5, rng: mulberry32(total * 100), campaign: 2, available: AVAIL });
    assert(!p.skip, `skip bo'lmasin (${total}): ${p.skip}`);
    for (const c of p.openCrops) assert(c.plantDate.getFullYear() === 2026, `${total}: ${c.name}`);
    if (p.trees) for (const t of p.trees) assert(t.count >= 1);
  }
}

console.log('OK: yil g\'ildiragi joriy yildan oldinga tushmaydi, 3 xonadon');
