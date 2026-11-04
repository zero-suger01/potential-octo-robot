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

// Ekish sanasi: oxirgi 150 kun ichida (bugundan kamida 7 kun oldin), oyi ekin oylariga mos
function plantDates(months, today, minBack = 7, maxBack = 150) {
  const out = [];
  for (let k = minBack; k <= maxBack; k++) {
    const d = addDays(today, -k);
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
function makePlan(h, opt = {}) {
  const R = makeRng(opt.rng);
  const today = startOfDay(opt.today || new Date());
  const ghMinTotal = opt.ghMinTotal ?? 13;
  const treeMinTotal = opt.treeMinTotal ?? 4.5;
  const avail = opt.available || {};
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
    const cands = C.GREENHOUSE_CROPS.filter((c) => inList(avail.greenhouse, c.name));
    if (cands.length) {
      G = Math.min(R.int(20, 30) * 10, X - 100);
      const built = addDays(today, -R.int(30, 60));
      const span = Math.round((today - built) / DAY);
      plan.greenhouse = {
        crop: R.weighted(cands.map((c) => [c.name, c.w])),
        area: fmt(G),
        plantDate: addDays(built, R.int(3, Math.max(3, span - 3))),
        heating: R.pick(C.GH_HEATING),
        funding: C.GH_FUNDING,
        builtDate: built,
        cover: R.pick(C.GH_COVER),
      };
    }
  }

  // Daraxtlar: tanlangan va umumiy maydon > 4.5 bo'lsa, ekin maydonining 15–30% (0.3–3 sotix).
  // Tanlanmasa — butun maydon ochiq ekinlarga qoladi
  let T = 0;
  if (opt.trees !== false && h.total > treeMinTotal) {
    T = Math.round((X * R.float(0.15, 0.3)) / 10) * 10;
    T = Math.max(30, Math.min(300, T));
    if (X - G - T < 50) T = Math.floor((X - G - 50) / 10) * 10;
    const cands = C.TREES.filter((t) => h.total >= t.minPlot && inList(avail.trees, t.name));
    if (T >= 30 && cands.length) {
      const k = T < 100 ? 1 : T < 200 ? R.int(1, 2) : R.int(2, 3);
      const kinds = R.sample(cands, k, (t) => t.w);
      const parts = split(T, kinds.length, R, 30);
      plan.trees = kinds.slice(0, parts.length).map((t, i) => ({
        name: t.name,
        area: fmt(parts[i]),
        count: Math.max(1, Math.round(parts[i] / 100 / R.float(...t.perTree))),
        age: R.int(...t.age),
      }));
    } else T = 0;
  }

  // Ochiq maydon ekinlari: qolgan maydon to'liq ishlatiladi
  const P = X - G - T;
  const cands = C.OPEN_CROPS
    .filter((c) => h.total >= c.minPlot && inList(avail.open, c.name))
    .map((c) => ({ c, dates: plantDates(c.months, today) }))
    .filter((x) => x.dates.length);
  if (!cands.length) { plan.skip = 'Mos ochiq maydon ekini topilmadi'; return plan; }
  const n = Math.min(countFor(P, R), cands.length);
  const chosen = R.sample(cands, n, (x) => x.c.w);
  const parts = split(P, chosen.length, R);
  plan.openCrops = chosen.slice(0, parts.length).map((x, i) => ({
    name: x.c.name,
    area: fmt(parts[i]),
    plantDate: R.pick(x.dates),
    fasl: x.c.fasl,
  }));

  plan.sum = { crop: fmt(X), open: fmt(P), greenhouse: fmt(G), trees: fmt(T) };
  return plan;
}

module.exports = { makePlan, mulberry32, fmt, toC, cropAreaC, split };
