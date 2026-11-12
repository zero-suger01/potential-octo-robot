// Bitta xonadon uchun to'ldirish rejasini tuzadi. Maydonlar ichkarida 0.01 sotix (yuzdan bir) birligida.
const C = require('./catalog');

const DAY = 86400000;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(rng = Math.random) {
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const float = (a, b) => a + rng() * (b - a);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const weighted = (pairs) => { // [[value, weight], ...]
    const sum = pairs.reduce((s, p) => s + p[1], 0);
    let r = rng() * sum;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  const sample = (items, n, weightOf) => { // vaznli, takrorsiz
    const pool = items.slice(), out = [];
    while (out.length < n && pool.length) {
      const v = weighted(pool.map((it) => [it, weightOf(it)]));
      out.push(v); pool.splice(pool.indexOf(v), 1);
    }
    return out;
  };
  return { rng, int, float, pick, weighted, sample };
}

const toC = (sotix) => Math.round(sotix * 100);
// 3.5 -> "3.5", 2 -> "2", 1.25 -> "1.25" (ilovaga yoziladigan ko'rinish)
const fmt = (c) => String(+(c / 100).toFixed(2));
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(startOfDay(d).getTime() + n * DAY);

// "Экин экиладиган майдон": ochiq maydondan qat'iy kichik — butun qismi yoki 0.1–0.3 kam
function cropAreaC(openC, R) {
  if (openC <= 0) return 0;
  if (openC <= 50) {
    const x = Math.max(10, Math.floor((openC * 0.8) / 10) * 10);
    return x < openC ? x : Math.floor(openC / 2);
  }
  const opts = [];
  const whole = Math.floor(openC / 100) * 100;
  if (whole >= 50 && whole < openC) opts.push(whole);
  const minus = Math.floor((openC - R.int(10, 30)) / 10) * 10;
  if (minus > 0 && minus < openC) opts.push(minus);
  return opts.length ? R.pick(opts) : openC - 10;
}

// Xatlov yiliga uch marta o'tkaziladi: mart; iyul oxiri — avgust boshi; oktyabr oxiri — noyabr.
// Ekish sanasi faqat joriy xatlov davriga tegishli oylardan olinadi: kuz xatlovida mart yoki
// iyul sanasi qo'yilmaydi. fasl — shu xatlovda ekilgan hisoblanadigan ekin fasli.
// 1-xatlov — mart; 2-xatlov — iyul oxiri va avgust; 3-xatlov — oktyabr oxiri va noyabr.
// inMonths: bugungi sana shu oylarga tushsa, shu xatlov hisoblanadi (xatlov oyidan keyin ham
// hisobot to'ldirilishi mumkin). months: ekish sanasi olinadigan oylar.
const CAMPAIGNS = [
  { n: 1, fasl: 'bahor', inMonths: [1, 2, 3, 4], months: [2, 3, 4] },
  { n: 2, fasl: 'yoz', inMonths: [5, 6, 7, 8], months: [6, 7, 8] },
  { n: 3, fasl: 'kuz', inMonths: [9, 10, 11, 12], months: [9, 10, 11] },
];
// forced: 1|2|3 — xatlov qo'lda tanlangan (UI). Belgilanmasa bugungi sanadan aniqlanadi.
// Qo'lda tanlanganda bugungi sana o'sha xatlov oyidan tashqarida bo'lishi mumkin, shuning uchun
// ekish sanasi oxirgi 400 kungача izlanadi (o'sha xatlov oylariga tushsin, baribir bugundan oldin).
function campaign(today, forced) {
  const m = today.getMonth() + 1;
  const c = (forced >= 1 && forced <= 3) ? CAMPAIGNS[forced - 1]
    : (CAMPAIGNS.find((k) => k.inMonths.includes(m)) || CAMPAIGNS[2]);
  return { n: c.n, fasl: c.fasl, months: c.months, maxBack: (forced >= 1 && forced <= 3) ? 400 : 75 };
}

// Ekish sanasi: xatlov davri ichida (bugundan kamida 7 kun oldin), oyi ekin oylariga mos.
// minYear (odatda joriy yil): shu yildan OLDINGI yilga tushgan sanalar olinmaydi — qo'lda tanlangan
// xatlov uchun ham ilgari o'tgan yilga tushib ketmasin (year wheel otkan yilni tanlamasin)
function plantDates(months, today, minBack = 7, maxBack = 75, minYear) {
  const out = [];
  const Y = minYear == null ? today.getFullYear() : minYear;
  for (let k = minBack; k <= maxBack; k++) {
    const d = addDays(today, -k);
    if (d.getFullYear() < Y) break;
    if (months.includes(d.getMonth() + 1)) out.push(d);
  }
  return out;
}

// Maydonni n bo'lakka 0.1 qadam bilan taqsimlash; yig'indi aynan total
function split(totalC, n, R, minEach = 20) {
  if (n <= 1) return [totalC];
  const w = Array.from({ length: n }, () => R.float(1, 3));
  const ws = w.reduce((a, b) => a + b, 0);
  const parts = w.map((x) => Math.max(minEach, Math.floor((totalC * x) / ws / 10) * 10));
  let diff = totalC - parts.reduce((a, b) => a + b, 0);
  const big = parts.indexOf(Math.max(...parts));
  parts[big] += diff;
  if (parts[big] < minEach) return [totalC]; // juda kichik — bitta ekin
  return parts;
}

// Maydonni ekinlar orasida taqsimlaydi: har biriga kamida o'z minimumi tegadi (0.1 sotix qadam),
// yig'indi aynan totalC bo'ladi. Minimumlar yig'indisi sig'masa null qaytaradi.
function splitMin(totalC, mins, R) {
  const need = mins.reduce((a, b) => a + b, 0);
  if (need > totalC) return null;
  const w = mins.map(() => R.float(1, 3));
  const ws = w.reduce((a, b) => a + b, 0);
  const extra = totalC - need;
  const parts = mins.map((m, i) => m + Math.floor((extra * w[i]) / ws / 10) * 10);
  const diff = totalC - parts.reduce((a, b) => a + b, 0);
  parts[parts.indexOf(Math.max(...parts))] += diff;
  return parts;
}

// Maydonni berilgan quyi va yuqori chegaralar ichida taqsimlaydi (0.1 sotix qadam), yig'indi aynan totalC.
// Chegaralarga sig'masa null: chaqiruvchi ekin sonini o'zgartirib qayta urinadi.
function splitRange(totalC, mins, maxs, R) {
  const need = mins.reduce((a, b) => a + b, 0);
  const cap = maxs.reduce((a, b) => a + b, 0);
  if (need > totalC || cap < totalC) return null;
  const parts = mins.slice();
  let extra = totalC - need;
  const order = mins.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  while (extra > 0) {
    let moved = 0;
    for (const i of order) {
      if (extra <= 0) break;
      const room = maxs[i] - parts[i];
      if (room <= 0) continue;
      const step = Math.min(room, extra, Math.max(10, Math.floor((extra * R.float(0.2, 0.6)) / 10) * 10));
      parts[i] += step; extra -= step; moved += step;
    }
    if (!moved) break;
  }
  return extra > 0 ? null : parts;
}

function countFor(areaC, R) {
  if (areaC < 150) return 1;
  if (areaC < 300) return R.int(1, 2);
  if (areaC < 600) return R.int(2, 3);
  if (areaC < 1000) return R.int(3, 4);
  return R.int(4, 5);
}

/**
 * @param {object} h          { total, open } sotix (1-bosqichdan o'qilgan)
 * @param {object} opt
 *   today        Date (ro'yxatga olish sanasi = bugun)
 *   greenhouse   boolean — bu xonadonga issiqxona tushdimi (1/20 qoidasi bot tomonida)
 *   trees        boolean — bu xonadonga daraxt tushdimi (1/10 qoidasi bot tomonida; default true)
 *   ghMinTotal   issiqxona uchun umumiy maydon chegarasi (default 13)
 *   treeMinTotal daraxt uchun umumiy maydon chegarasi (default 4.5)
 *   available    { open: string[], greenhouse: string[], trees: string[] } — ilovadagi ro'yxatlar (bo'lsa)
 *   rng          () => [0,1)
 */
// Namangan viloyati Norin tumani oylik o'rtacha harorat (°C) — 1 yil oldingi real ma'lumot.
// Ekin tanlashda: oy haroratiga mos ekinlarning vazni ko'paytiriladi, nomuvofiqlari pasaytiriladi.
const NORIN_TEMP = [1, 4, 10, 17, 22, 27, 29, 27, 21, 14, 7, 2];
function weatherFactor(crop, monthIdx) {
  const t = NORIN_TEMP[monthIdx - 1];
  // Ekin fasli bo'yicha mos harorat oralig'i: bahor 10-22, yoz 20-30, kuz 7-18, qish 0-10
  const faslT = { bahor: [10, 22], yoz: [20, 32], kuz: [5, 18], qish: [-5, 10] };
  let best = 0;
  for (const f of crop.fasl || []) {
    const [lo, hi] = faslT[f] || [0, 40];
    const mid = (lo + hi) / 2, half = (hi - lo) / 2 + 2;
    const d = Math.abs(t - mid);
    const s = d <= half ? 1.5 - d / (half * 2) : 0.3; // mos — 1.0-1.5, nomos — 0.3
    if (s > best) best = s;
  }
  return best || 1;
}

function makePlan(h, opt = {}) {
  const R = makeRng(opt.rng);
  const today = startOfDay(opt.today || new Date());
  const K = campaign(today, opt.campaign); // xatlov: qo'lda (opt.campaign 1|2|3) yoki sanadan
  const ghMinTotal = opt.ghMinTotal ?? 13;
  const treeMinTotal = opt.treeMinTotal ?? 4.5;
  const avail = opt.available || {};
  const avoidOpen = new Set(opt.avoidOpen || []);
  const inList = (list, name) => !list || list.includes(name);

  const totalC = toC(h.total), openC = toC(h.open);
  const plan = { total: h.total, open: h.open, notes: [] };
  if (openC <= 0) { plan.skip = 'Очиқ томорқа майдони 0'; return plan; }

  // fixedCropArea: 2-bosqichda allaqachon kiritilgan qiymat (4-bosqichda qayta rejalashtirishda)
  const X = opt.fixedCropArea != null ? toC(opt.fixedCropArea) : cropAreaC(openC, R);
  plan.cropArea = fmt(X);

  plan.water = {
    plot: { status: 'Таъминланган', type: R.weighted(C.WATER_PLOT_TYPES) },
    drink: { status: 'Таъминланган', type: R.weighted(C.WATER_DRINK_TYPES) },
  };

  // Issiqxona: faqat umumiy maydon > 13 va bot tanlagan bo'lsa; 2–3 sotix, ochiq ekinga kamida 1 sotix qolsin
  let G = 0;
  if (opt.greenhouse && h.total > ghMinTotal && X >= 300) {
    G = Math.min(R.int(20, 30) * 10, X - 100);
    // Issiqxona maydoniga sig'adigan ekinlar (1 sotix = 100 m²)
    const cands = C.GREENHOUSE_CROPS.filter((c) => inList(avail.greenhouse, c.name) && toC(c.minArea || 0) <= G);
    if (!cands.length) G = 0; // mos ekin yo'q — maydon ochiq ekinlarga qoladi
    if (cands.length) {
      // Ekish sanasi joriy xatlov davrida bo'lishi kerak; issiqxona ekishdan oldin qurilgan.
      // minYear = joriy yil — kalendar g'ildiragida otkan yil tanlanmasin
      const Y = today.getFullYear();
      const win = plantDates(K.months, today, 7, K.maxBack, Y);
      const planted = win.length ? R.pick(win) : addDays(today, -R.int(7, 40));
      // Issiqxona qurilishi ekishdan ~20–60 kun oldin; shu yildan oldinga tushsa bugunga yaqin surariladi
      let built = addDays(planted, -R.int(20, 60));
      if (built.getFullYear() < Y) built = new Date(Y, 0, 1);
      plan.greenhouse = {
        crop: R.weighted(cands.map((c) => [c.name, c.w])),
        area: fmt(G),
        plantDate: planted,
        heating: R.pick(C.GH_HEATING),
        funding: C.GH_FUNDING,
        builtDate: built,
        cover: R.pick(C.GH_COVER),
      };
    }
  }

  // Daraxtlar: tanlangan va umumiy maydon > 4.5 bo'lsa, ekin maydonining 15–30% gacha (0.3–3 sotix).
  // Son maydondan kelib chiqadi: har daraxtga kamida perTree tegadi, jami soni umumiy maydon
  // sotixidan oshmaydi (≤ 12) — kichik tomorqaga ko'p daraxt tushmasin. Ortgan maydon ochiq ekinlarga qoladi.
  // Tanlanmasa — butun maydon ochiq ekinlarga qoladi
  let T = 0;
  if (opt.trees !== false && h.total > treeMinTotal) {
    let budget = Math.round((X * R.float(0.15, 0.3)) / 10) * 10;
    budget = Math.max(30, Math.min(300, budget));
    if (X - G - budget < 50) budget = Math.floor((X - G - 50) / 10) * 10;
    const cands = C.TREES.filter((t) => h.total >= t.minPlot && inList(avail.trees, t.name) && toC(t.perTree[0]) <= budget);
    if (budget >= 30 && cands.length) {
      const k = budget < 100 ? 1 : budget < 200 ? R.int(1, 2) : R.int(2, 3);
      let kinds = R.sample(cands, k, (t) => t.w);
      // Har turga kamida bitta daraxt sig'adigan maydon kerak (perTree — bitta daraxtning maydoni),
      // aks holda bo'lak bo'sh qoladi; sig'maguncha turlar soni kamaytiriladi
      const minsOf = (list) => list.map((t) => Math.max(30, Math.ceil(toC(t.perTree[0]) / 10) * 10));
      let parts = splitMin(budget, minsOf(kinds), R);
      while (!parts && kinds.length > 1) {
        kinds = kinds.slice(0, -1);
        parts = splitMin(budget, minsOf(kinds), R);
      }
      if (!parts) parts = [budget];
      let left = Math.min(12, Math.floor(h.total));
      plan.trees = [];
      kinds.slice(0, parts.length).forEach((t, i) => {
        const per = toC(R.float(...t.perTree));
        const fit = Math.floor(parts[i] / per);
        const count = Math.min(fit, left - (parts.length - 1 - i));
        if (count < 1) return;
        left -= count;
        // Son cheklangan bo'lsa maydon ham daraxtlar egallaganicha qisqaradi
        const area = count < fit ? Math.ceil((count * per) / 10) * 10 : parts[i];
        T += area;
        plan.trees.push({ name: t.name, area: fmt(area), count, age: R.int(...t.age) });
      });
      if (!plan.trees.length) delete plan.trees;
    }
  }

  // Ochiq maydon ekinlari: qolgan maydon to'liq ishlatiladi
  const P = X - G - T;
  // Joriy xatlov davrida ekilishi mumkin bo'lgan ekinlar (K yuqorida aniqlangan): fasli mos, oyi mos
  // Ekin tanlash sharti: shu xatlov davrida ekiladigan bo'lsin va maydoni yetsin.
  // 1 sotix = 100 m², shuning uchun har ekinning o'z eng kichik maydoni bor (catalog → minArea):
  // masalan buğdoy 5 sotixdan, tarvuz 2 sotixdan kichik maydonga tushmaydi.
  const Y = today.getFullYear();
  // Ob-havo omili: xatlov markaziy oyining Norin haroratiga mos ekinlar vazni ko'tariladi;
  // avvalgi xatlov tanlagan ekinlar (avoidOpen) kamaytiriladi (lekin butunlay chiqarilmaydi — minimumni buzmaslik uchun)
  const midMonth = K.months[Math.floor(K.months.length / 2)];
  const adjW = (c) => {
    const base = c.w * weatherFactor(c, midMonth);
    return avoidOpen.has(c.name) ? base * 0.2 : base;
  };
  const fits = (faslFilter) => C.OPEN_CROPS
    .filter((c) => h.total >= c.minPlot && toC(c.minArea) <= P && inList(avail.open, c.name)
      && (!faslFilter || c.fasl.includes(K.fasl)))
    .map((c) => ({ c: { ...c, w: adjW(c) }, dates: plantDates(c.months.filter((m) => K.months.includes(m)), today, 7, K.maxBack, Y) }))
    .filter((x) => x.dates.length);
  // Fasli mos ekin topilmasa, oy chegarasi saqlanadi (sana hech qachon davradan tashqariga chiqmaydi)
  const cands = fits(true).length ? fits(true) : fits(false);
  if (!cands.length) { plan.skip = 'Mos ochiq maydon ekini topilmadi'; return plan; }
  // Yuqori chegara: bitta ekin turi cheksiz kattalashmasin (12 sotix ko'kat real emas).
  // Alohida ko'rsatilmasa — eng kichik maydonning 10 barobari, lekin kamida 2 sotix.
  const maxOf = (c) => toC(c.maxArea != null ? c.maxArea : Math.max(2, c.minArea * 10));
  const minsOf = (list) => list.map((x) => toC(x.c.minArea));
  const maxsOf = (list) => list.map((x) => maxOf(x.c));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  let chosen = R.sample(cands, Math.min(countFor(P, R), cands.length), (x) => x.c.w);
  // Minimumlar sig'maguncha eng ko'p joy talab qilgan ekin chiqariladi
  while (chosen.length > 1 && sum(minsOf(chosen)) > P) {
    const worst = chosen.reduce((a, b) => (b.c.minArea > a.c.minArea ? b : a));
    chosen = chosen.filter((x) => x !== worst);
  }
  // Yuqori chegaralar maydonni qoplamasa — yana ekin qo'shiladi
  const rest = cands.filter((x) => !chosen.includes(x));
  while (sum(maxsOf(chosen)) < P && rest.length) {
    const add = R.weighted(rest.map((x) => [x, x.c.w]));
    rest.splice(rest.indexOf(add), 1);
    if (sum(minsOf(chosen)) + toC(add.c.minArea) <= P) chosen.push(add);
  }
  const parts = splitRange(P, minsOf(chosen), maxsOf(chosen), R)
    || splitMin(P, minsOf(chosen), R); // chegaralarga sig'masa: minimumlar kafolati saqlanadi
  if (!parts) { plan.skip = 'Ekin maydoni eng kichik ekin uchun ham kichik'; return plan; }
  plan.openCrops = chosen.map((x, i) => ({
    name: x.c.name,
    area: fmt(parts[i]),
    plantDate: R.pick(x.dates),
    fasl: x.c.fasl,
  }));

  plan.sum = { crop: fmt(X), open: fmt(P), greenhouse: fmt(G), trees: fmt(T) };
  return plan;
}

module.exports = { makePlan, mulberry32, fmt, toC, cropAreaC, split, splitMin, splitRange, campaign, plantDates };
