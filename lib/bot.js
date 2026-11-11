// Аҳоли томорқаси formasini to'ldiruvchi bot. YARIM-AVTOMAT: bot formani 5-bosqichga (Тасдиқлаш)
// qadar to'ldiradi va to'xtaydi. «Юбориш»ni qurilmada ODAM o'zi bosadi — bot bu tugmani hech qachon
// bosmaydi (`lib/adb.js` → FORBIDDEN). Bot faqat natijani kuzatadi: yozuv yuborilgan bo'lsa
// report.csv ga yozadi va keyingi xonadonga o'tadi.
//
// Tezlik: eng qimmat amal — UI dump (~2.3 s). Shuning uchun ekran o'zgarmagan joyda oxirgi dumpdan
// qayta foydalaniladi (`reuse` / `cached`), tap va matn kiritish bitta shell chaqiruvida bajariladi.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Device, sleep, SUBMIT } = require('./adb');
const { makePlan, fmt, toC } = require('./rules');
const { DATA, RUNS } = require('./platform');

const PKG = 'uz.realsoft.onlinemahalla.assistant';
// AUTO_PHOTO=1 bo'lsa bot kamerada Shutter va Done ni o'zi bosadi. Env — faqat STANDART;
// haqiqiy qiymat har run uchun cfg.autoPhoto da (UI toggle belgilaydi).
const AUTO_PHOTO_ENV = process.env.AUTO_PHOTO === '1';
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const SECTIONS = {
  open: { header: 'Очиқ майдон экинлари', title: 'Очиқ майдон экини қўшиш' },
  greenhouse: { header: 'Иссиқхона экинлари', title: 'Иссиқхона экини қўшиш' },
  trees: { header: 'Дарахтлар', title: 'Экилган дарахтлар қўшиш' },
};
const STEPS = ['Маълумот', 'Экин майдони', 'Сув таъминоти', 'Экинлар', 'Тасдиқлаш'];
// Jurnal/hisobotga shaxsiy ma'lumot tushmasin: uzun raqamlar va lotin bosh harfli ism-familiyalar
const PII_RE = /\d{7,}|^[A-Z'‘ʻ ]{6,}$/;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const num = (s) => parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, ''));
const ymd = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const cell = (v) => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();

class Bot {
  constructor(cfg, emit) {
    this.cfg = cfg;            // { serial, limit, season, submitWaitSec, ghEvery, treeEvery, autoPhoto, autoSubmit, autoSubmitDelayMin, autoSubmitDelayMax, operator }
    this.emit = emit;
    this.d = new Device(cfg.serial);
    // Mustaqil ikki toggle. cfg berilmasa env standart ishlaydi.
    this.autoPhoto = cfg.autoPhoto != null ? !!cfg.autoPhoto : AUTO_PHOTO_ENV;
    this.d.autoSubmit = cfg.autoSubmit != null ? !!cfg.autoSubmit : this.d.autoSubmit;
    this.stopped = false;
    this.lists = readJson(path.join(DATA, 'lists.json'), {});
    this.state = readJson(path.join(DATA, 'state.json'), { ghEligible: 0, ghOffset: Math.floor(Math.random() * 20) });
    this.state.treeEligible ??= 0;
    this.state.treeOffset ??= Math.floor(Math.random() * 10);
    this.forms = {};   // bo'lim → forma maydonlari joylashuvi (kesh)
    this.tabs = {};    // mavsum tabi joylashuvi (kesh)
    // AUTO_SUBMIT uchun tasodifiy kutish oralig'i (soniya): bir xil vaqtda yuborish bo'lmasin
    this.autoDelayMin = Math.max(0, +cfg.autoSubmitDelayMin || 3);
    this.autoDelayMax = Math.max(this.autoDelayMin, +cfg.autoSubmitDelayMax || 8);
    this.operator = (cfg.operator || '').replace(/[\\/:*?"<>|]/g, '').trim();
    // Operator tomonidan to'ldirilgan yozuvlar ro'yxati (reports/<yil>/<n>-xatlov/<operator>.(xlsx|csv))
    this.records = [];
  }
  log(msg, level = 'info') { this.emit({ type: 'log', level, msg, t: Date.now() }); }
  stage(step) { this.emit({ type: 'stage', i: this.cur, step, label: STEPS[step - 1] }); }
  stop() { this.stopped = true; }
  check() { if (this.stopped) throw new Error('STOP'); }
  get listKey() { return this.cfg.season || 'default'; }
  safeText() { return this.d.nodes.filter((n) => n.text && !PII_RE.test(n.text)).map((n) => n.text); }

  // ---------- umumiy yordamchilar ----------
  async init() {
    this.size = await this.d.size();
    const { w, h } = this.size;
    this.view = { top: Math.round(h * 0.27), bottom: Math.round(h * 0.85) }; // stepper ostidan pastki panelgacha
    this.mid = Math.round(w / 2);
    // Gorizontal planshetda forma ikki ustunda va har ustun alohida suriladi; markaz ularning orasida
    this.cols = w > h ? [Math.round(w * 0.25), Math.round(w * 0.75)] : [this.mid];
    [this.scrollX] = this.cols;
  }
  // dir=+1: kontent yuqoriga (pastini ko'rsatadi). x — qaysi ustunni surish (gorizontal planshetda muhim)
  async scrollBy(dir, x = this.scrollX) {
    const { h } = this.size;
    const a = Math.round(h * 0.75), b = Math.round(h * 0.42);
    await this.d.swipe(x, dir > 0 ? a : b, x, dir > 0 ? b : a, 400);
    await sleep(300); // keyingi dump o'zi ham ekran tinchlanishini kutadi
  }
  inView(n) { return n && n.cy > this.view.top && n.cy < this.view.bottom; }
  // reuse: birinchi urinishda oxirgi dumpdan foydalanish (ekran o'zgarmagan bo'lsa)
  // nth: bir xil matn bir nechta bo'lsa, shuncha nusxa render bo'lguncha suriladi
  async scrollTo(text, { filter, reuse = false, nth = 1 } = {}) {
    const get = () => this.d.all(text).filter(filter || (() => true))[nth - 1];
    let first = true;
    // Ekran markazi ustunlar orasidagi bo'sh joyga tushadi va hech narsani surmaydi,
    // shuning uchun har bir ustun o'z x'i bilan suriladi
    for (const x of this.cols) {
      for (const [dir, times] of [[1, 8], [-1, 14]]) {
        for (let i = 0; i <= times; i++) {
          if (!(first && reuse && this.d.nodes.length)) await this.d.dump();
          first = false;
          const n = get();
          if (this.inView(n)) return n;
          if (n) { await this.scrollBy(n.cy < this.view.top ? -1 : 1, n.cx); continue; }
          if (i < times) await this.scrollBy(dir, x);
        }
      }
    }
    throw new Error(`Ekranda topilmadi: "${text}"`);
  }
  // Satr yorlig'i yonidagi "Танлаш" tugmasi.
  // Ikki ustunli maketda yorliq ustunning chap chetida turadi, shuning uchun x bo'yicha filtr yo'q:
  // tugma shu yorliq bilan bir satrda va uning o'ng tomonida bo'lishi bo'yicha topiladi.
  async rowButton(label, nth = 1) {
    // Bir xil matn bo'lim sarlavhasi sifatida ham turadi (butun kenglikka cho'zilgan):
    // unga bog'lanib qolsak, qo'shni qatorning "Танлаш" tugmasi bosiladi
    const isRow = (n) => n.x2 - n.x1 < this.size.w * 0.5;
    for (let i = 0; i < 5; i++) {
      await this.scrollTo(label, { nth, filter: isRow });
      const rows = this.d.all(label).filter(isRow);
      const lab = rows.filter((n) => this.inView(n))[nth - 1] || rows[nth - 1];
      if (!lab) throw new Error(`"${label}" topilmadi`);
      // Bir qatorda ikki ustun bo'lishi mumkin (masalan "Иссиқхона ташкил этилган йили" va
      // "Иссиқхона қоплами"): shuning uchun yorliqdan o'ngdagi ENG YAQIN tugma olinadi, cy emas.
      // Qatorlar bir-biridan ~120 px uzoqlikda: oyna torroq bo'lmasa qo'shni qatorning
      // tugmasi ham mos tushadi va boshqa menyu ochiladi
      const btn = this.d.all('Танлаш')
        .filter((n) => n.x1 > lab.x1 && Math.abs(n.cy - lab.cy) <= 70)
        .sort((a, b) => a.x1 - b.x1)[0];
      if (btn) { await this.d.tapNode(btn); await sleep(250); return; }
      // Yorliq ekran pastida qolgan — uning tugmasi hali render bo'lmagan: bir qadam suramiz
      await this.scrollBy(1, lab.cx);
    }
    throw new Error(`"${label}" uchun Танлаш topilmadi`);
  }
  async menuPick(option) {
    const right = (x) => x.x1 > this.size.w * 0.28; // menyu o'ngda ochiladi; chapdagi bir xil matn — qiymat
    await this.d.waitFor(option, { filter: right, timeout: 5000 });
    const best = this.d.all(option).filter(right).sort((a, b) => b.x1 - a.x1)[0];
    await this.d.tapNode(best);
    await sleep(300);
  }
  // Yorliq ostidagi joriy qiymat
  rowValue(lab) {
    const v = this.d.nodes.find((n) => n.text && n.y1 >= lab.y2 - 5 && n.y1 < lab.y2 + 60 && Math.abs(n.x1 - lab.x1) < 40);
    return v ? v.text : '';
  }
  async choose(label, option, nth = 1) {
    const isRow = (n) => n.x2 - n.x1 < this.size.w * 0.5;
    for (let i = 0; i < 3; i++) {
      await this.rowButton(label, nth);
      await this.menuPick(option);
      await sleep(400);
      await this.d.dump();
      let lab = this.d.all(label).filter(isRow)[nth - 1];
      let v = lab ? this.rowValue(lab) : '';
      if (lab && !v) {
        // Qiymat matni ekran pastida, pastki panel ostida qolgan — ko'rinadigan joyga suramiz
        await this.scrollBy(1, lab.cx);
        await this.d.dump();
        lab = this.d.all(label).filter(isRow)[nth - 1];
        v = lab ? this.rowValue(lab) : '';
      }
      if (!lab || v === option) { this.log(`  ${label}: ${option}`); return; }
      // Oldingi menyu yopilib ulgurmagan bo'lsa bosish eski menyuga tushadi — kutib qayta urinamiz
      await sleep(900);
    }
    throw new Error(`"${label}" tanlanmadi: ${option}`);
  }
  centerTap(text, cached = false) { // dialog o'rtasidagi tugma (Танлаш)
    return this.d.tap(text, { cached, filter: (n) => n.cx > this.size.w * 0.3 && n.cx < this.size.w * 0.7 });
  }
  async fieldBelow(label, cached = false) {
    if (!cached) await this.d.dump();
    const lab = this.d.nodes.find((n) => n.text === label || n.text.startsWith(label));
    if (!lab) throw new Error(`Maydon yorlig'i yo'q: ${label} [ekranda: ${this.safeText().slice(0, 12).join(' · ')}]`);
    const f = this.d.nodes.filter((n) => n.editable && n.y1 >= lab.y2 - 5).sort((a, b) => a.y1 - b.y1)[0];
    if (!f) throw new Error(`Kiritish maydoni yo'q: ${label}`);
    return f;
  }
  async step(cached = false) {
    if (!cached) await this.d.dump();
    const n = this.d.nodes.find((x) => /^\d\/\d қадам$/.test(x.text));
    if (!n) return null;
    const [cur, total] = n.text.match(/\d/g).map(Number);
    return { cur, total };
  }
  // "Кейинги"dan oldin har doim yangi dump: 5-bosqichda shu joyda «Юбориш» turadi
  async next() {
    const before = await this.step();
    await this.d.tap('Кейинги', { cached: true });
    await sleep(400);
    await this.d.dump();
    if (this.d.has('Тушундим')) {
      const msg = this.safeText().filter((t) => !['Тушундим', 'Кейинги', 'Орқага'].includes(t)).slice(-3).join(' ');
      await this.d.tap('Тушундим', { cached: true });
      throw new Error(`Ilova xatosi: ${msg}`);
    }
    let after = await this.step(true);
    if (before && after && after.cur === before.cur) {
      // Sahifa hali yuklanayotgan bo'lsa bosish yutilib ketadi — yangi dumpdagi "Кейинги" bilan bir marta qayta
      await sleep(800);
      await this.d.tap('Кейинги');
      await sleep(600);
      after = await this.step();
      if (after && after.cur === before.cur) throw new Error(`Keyingi bosqichga o'tmadi (${before.cur}/${before.total})`);
    }
    if (after) this.stage(after.cur === after.total ? 5 : after.cur); // 4 bosqichli holatda oxirgisi ham Тасдиқлаш
    return after;
  }

  // ---------- sana g'ildiragi ----------
  // fresh: maydon bo'sh — g'ildirak bugungi sanada ochiladi, boshlang'ich holatni o'qish shart emas
  async setDate(target, fresh = false) {
    const { w } = this.size;
    const known = fresh && this.wheel;
    if (known) await sleep(800); // oyna ochilish animatsiyasi: undan oldin bosish ostidagi formaga tegadi
    else await this.d.waitFor('Санани белгиланг');
    const col = (n) => (n.cx < w * 0.38 ? 'day' : n.cx < w * 0.6 ? 'month' : 'year');
    const read = () => {
      const c = { day: [], month: [], year: [] };
      for (const n of this.d.nodes) {
        if (/^\d{1,2}$/.test(n.text) || /^\d{4}$/.test(n.text) || MONTHS.includes(n.text)) c[col(n)].push(n);
      }
      return c;
    };
    if (!this.wheel) { // kalibrlash: ochilganda bugungi sana markazda
      const c = read(), now = new Date();
      const y = c.year.find((n) => n.text === String(now.getFullYear()));
      const ys = c.year.map((n) => n.cy).sort((a, b) => a - b);
      const rowH = Math.min(...ys.slice(1).map((v, i) => v - ys[i]).filter((v) => v > 20));
      if (!y || !isFinite(rowH)) throw new Error('Sana tanlagichni kalibrlab bo\'lmadi');
      this.wheel = { cy: y.cy, rowH, x: { day: c.day[0]?.cx, month: c.month[0]?.cx, year: y.cx } };
    }
    const W = this.wheel;
    const want = { year: target.getFullYear(), month: target.getMonth(), day: target.getDate() };
    const val = (k, n) => (k === 'month' ? MONTHS.indexOf(n.text) : +n.text);
    // Har bosish g'ildirakni bir qatorga suradi: uchala ustun farqini bir yo'la bosamiz, keyin bitta dump bilan tekshiramiz
    const now = new Date(), trace = [];
    for (let i = 0; ; i++) {
      let cur;
      if (i === 0 && known) cur = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
      else {
        if (i > 0) await this.d.dump();
        if (!this.d.has('Санани белгиланг')) throw new Error('Sana oynasi ochilmadi');
        const c = read();
        cur = {};
        for (const k of ['year', 'month', 'day']) {
          const n = c[k].find((x) => Math.abs(x.cy - W.cy) < W.rowH / 2);
          if (!n) throw new Error(`Sana ustuni o'qilmadi: ${k}`);
          cur[k] = val(k, n);
        }
      }
      const taps = [];
      for (const k of ['year', 'month', 'day']) {
        if (cur[k] === want[k]) continue;
        const y = W.cy + (cur[k] > want[k] ? -W.rowH : W.rowH);
        // 0.35 s: g'ildirak aylanayotganda bosilsa, bosish qadam emas "to'xtatish" bo'lib yo'qoladi
        taps.push(...Array(Math.abs(cur[k] - want[k])).fill(`input tap ${W.x[k]} ${y}; sleep 0.35`));
      }
      if (!taps.length && (i > 0 || !known)) break; // o'qilgan qiymat to'g'ri (taxminiy holat esa albatta tekshiriladi)
      trace.push(`${cur.day}.${cur.month + 1}`);
      if (i === 8) throw new Error(`Sana o'rnatilmadi (kerak ${want.day}.${want.month + 1}.${want.year}; o'qildi ${trace.join(' → ')})`);
      if (taps.length) { await this.d.shell(taps.join('; ')); await sleep(150); }
    }
    await this.centerTap('Танлаш', true);
    await sleep(300);
  }

  // ---------- mahsulot ro'yxati ----------
  async listItems(cached = false) {
    if (!cached) await this.d.dump();
    const search = this.d.nodes.find((n) => n.text === 'Қидириш…');
    const btn = this.d.all('Танлаш').filter((n) => n.cx > this.size.w * 0.3 && n.cx < this.size.w * 0.7).pop();
    const top = search ? search.y2 : 0, bottom = btn ? btn.y1 : this.size.h;
    return this.d.nodes.filter((n) => n.text && n.text !== 'Қидириш…' && n.y1 >= top && n.y2 <= bottom && n.cx < this.size.w * 0.8);
  }
  // Ro'yxat oynasini yopadi. Eski versiyada "Ёпиш" tugmasi bor edi; yangisida
  // oynaning yuqori-o'ng burchagida matnsiz X ikonkasi turadi.
  async closePicker() {
    if (!this.d.nodes.length) await this.d.dump();
    if (this.d.has('Ёпиш')) { await this.d.tap('Ёпиш', { cached: true }); await sleep(400); return; }
    const search = this.d.nodes.find((n) => n.text === 'Қидириш…' || n.editable);
    const x = this.d.nodes.filter((n) => n.clickable && n.x2 - n.x1 <= 120 && n.y2 - n.y1 <= 120
      && (!search || n.y2 <= search.y1 + 40) && n.cx > this.size.w * 0.5)
      .sort((a, b) => b.x1 - a.x1)[0];
    if (x) { await this.d.tapNode(x); await sleep(400); return; }
    await this.d.key(4); // oxirgi chora: Back
    await sleep(400);
  }

  // Ro'yxat oynasi ekranning faqat o'rtasida turadi: surish «Қидириш…» maydoni bilan
  // «Танлаш» tugmasi orasidan boshlanishi kerak, aks holda ro'yxat umuman surilmaydi
  async scrollList(dir = 1) {
    const { h } = this.size;
    if (!this.d.nodes.length) await this.d.dump();
    const items = await this.listItems(true);
    const search = this.d.nodes.find((n) => n.text === 'Қидириш…');
    const btn = this.d.all('Танлаш').filter((n) => n.cx > this.size.w * 0.3 && n.cx < this.size.w * 0.7).pop();
    // Surish aynan ro'yxat bandlari ustida boshlanishi kerak: pastdagi "Танлаш" tugmasi
    // ustidan boshlangan surish ro'yxatni umuman surmaydi. 900 ms — tezrog'i fling bo'lib yo'qoladi.
    const top = items.length ? items[0].y1 : (search ? search.y2 + 40 : Math.round(h * 0.33));
    const bottom = items.length ? items[items.length - 1].y2 : (btn ? btn.y1 - 80 : Math.round(h * 0.8));
    const x = items.length ? items[0].cx : (search ? search.cx : this.mid);
    await this.d.swipe(x, dir > 0 ? bottom : top, x, dir > 0 ? top : bottom, 900);
    await sleep(350);
  }
  // Ro'yxatni oxirigacha o'qiydi (keshlash uchun, har mavsumda bir marta)
  async collectList() {
    const seen = [];
    let last = '';
    for (let i = 0; i < 40; i++) {
      const items = (await this.listItems(i === 0)).map((n) => n.text);
      for (const t of items) if (!seen.includes(t)) seen.push(t);
      const sig = items.join('|');
      if (sig === last) break;
      last = sig;
      await this.scrollList(1);
    }
    return seen;
  }
  async pickProduct(name, cached) {
    await this.d.tap('Танланг…', { cached: true });
    await this.d.waitFor('Қидириш…');
    let items = await this.listItems(true);
    // Keshdagi tartib ma'lum: kerakli joyga dump qilmasdan sakraymiz
    const idx = cached ? cached.indexOf(name) : -1;
    if (idx > 0 && !items.some((n) => n.text === name)) {
      const ys = items.map((n) => n.cy);
      const rowH = ys.length > 1 ? (ys[ys.length - 1] - ys[0]) / (ys.length - 1) : 140;
      const perSwipe = Math.max(1, Math.floor((this.size.h * 0.43) / rowH) - 1);
      const jumps = Math.max(0, Math.floor((idx - items.length + 2) / perSwipe));
      for (let j = 0; j < jumps; j++) await this.scrollList(1);
      if (jumps) items = await this.listItems();
    }
    for (const dir of [1, -1]) { // avval pastga, sakrab o'tib ketgan bo'lsa — yuqoriga
      let last = '';
      for (let i = 0; i < 40; i++) {
        const hit = items.find((n) => n.text === name);
        if (hit) {
          await this.d.tapNode(hit);
          await sleep(200);
          await this.centerTap('Танлаш', true);
          await sleep(400);
          return true;
        }
        const sig = items.map((n) => n.text).join('|');
        if (sig === last) break;
        last = sig;
        await this.scrollList(dir);
        items = await this.listItems();
      }
    }
    await this.closePicker();
    await sleep(100);
    return false;
  }

  // ---------- rasm ----------
  // Rasmni planshetda odam o'zi oladi: bot kamerani ochadi va forma qaytishini kutadi
  // Kamera tugmalarida matn yo'q — faqat content-desc ("Shutter", "Done")
  async waitDesc(desc, timeout = 20000) {
    const end = Date.now() + timeout;
    for (;;) {
      await this.d.dump();
      const n = this.d.nodes.find((x) => x.desc === desc);
      if (n) return n;
      if (Date.now() > end) throw new Error(`Kamera tugmasi topilmadi: ${desc}`);
      await sleep(500);
    }
  }
  // Rasm biriktirilganini «Расмни ўзгартириш» elementi bo'yicha tekshiradi
  async photoAttached() {
    await this.d.dump().catch(() => {});
    return this.d.has('Расмни ўзгартириш');
  }
  async takePhoto() {
    // Rasm allaqachon biriktirilgan bo'lsa — qayta suratga olinmaydi
    if (await this.photoAttached()) { this.photoDone = true; this.log('  Rasm allaqachon biriktirilgan — o\'tkazib yuborildi'); return; }
    if (!this.autoPhoto) {
      await this.d.tapNode(await this.scrollTo('Камерани очиш').catch(() => this.scrollTo('Расмни ўзгартириш')));
      this.log('  Planshetda tomorqa rasmini oling (3 daqiqa kutiladi)…', 'warn');
      await this.d.waitFor('Расмни ўзгартириш', { timeout: 180000 });
      this.photoDone = true;
      return;
    }
    // AUTO_PHOTO: kamerani ochish → Shutter → Done, 2 martaga qadar urinish
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.d.wake(); // kamera uxlab turgan ekranda ochilmaydi
        await this.d.tapNode(await this.scrollTo('Камерани очиш'));
        // 1) kamera ochilganini aniqlaymiz (Shutter paydo bo'lishi) — ochilmasa Shutter bosilmaydi
        const shutter = await this.waitDesc('Shutter', 20000);
        await this.d.tapNode(shutter);
        // 2) surat olinganini tekshiramiz: tasdiq tugmasi (Done) paydo bo'lishi
        const done = await this.waitDesc('Done', 15000);
        await sleep(500);
        await this.d.tapNode(done);
        // 3) formaga qaytib, rasm biriktirilganini tekshiramiz
        await this.d.waitFor('Расмни ўзгартириш', { timeout: 40000 });
        this.photoDone = true;
        this.log(`  Rasm bot tomonidan olindi (AUTO_PHOTO), urinish ${attempt}`);
        return;
      } catch (e) {
        lastErr = e;
        this.log(`  Rasm olish urinishi ${attempt} muvaffaqiyatsiz: ${e.message}`, 'warn');
        // Kamera yoki tasdiq ekranida qolgan bo'lsa — Back bilan formaga qaytamiz
        for (let k = 0; k < 3; k++) {
          if ((await this.d.activity()).includes('HouseholdPlotDetailsActivity') && !(await this.photoAttached())) break;
          if (await this.photoAttached()) { this.photoDone = true; return; } // oxirgi urinishda baribir biriktirilган bo'lsa
          await this.d.key(4); await sleep(1000);
        }
      }
    }
    throw new Error(`Rasm olinmadi (AUTO_PHOTO): ${lastErr ? lastErr.message : 'noma\'lum'}`);
  }

  // ---------- navigatsiya ----------
  async openList() {
    let act = await this.d.activity();
    if (act.includes('HouseholdPlotDetailsActivity')) { await this.exitRecord(); act = await this.d.activity(); }
    if (!act.includes('HouseholdPlotActivity')) {
      await this.d.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
      // Ilova versiyalarida ochilish zanjiri har xil (SplashActivity → dashboard yoki to'g'ridan ro'yxat):
      // "MainActivity" nomiga bog'lanmaymiz — dashboard yoki ro'yxat belgisi chiqishini kutamiz
      for (let i = 0; i < 25; i++) {
        await sleep(1000);
        if ((await this.d.activity()).includes('HouseholdPlotActivity')) break;
        const n = await this.d.dump().catch(() => null);
        if (n && (this.d.has('Аҳоли томорқаси') || this.d.has('БАРЧА МОДУЛЛАР') || this.d.has('Хонадон қўшиш'))) break;
      }
      await sleep(1500);
      if (!(await this.d.activity()).includes('HouseholdPlotActivity')) {
        for (let i = 0; i < 10; i++) {
          await this.d.dump();
          const m = this.d.find('Аҳоли томорқаси');
          // Planshetda karta matni bosilsa modul ochilmaydi — matnni o'z ichiga olgan bosiladigan kartani bosamiz
          const card = m && this.d.nodes.filter((n) => n.clickable && n.x1 <= m.x1 && n.y1 <= m.y1 && n.x2 >= m.x2 && n.y2 >= m.y2)
            .sort((a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1))[0];
          if (m) { await this.d.tapNode(card || m); break; }
          await this.scrollBy(1);
        }
        await this.d.waitActivity('HouseholdPlotActivity', 20000);
      }
      await sleep(2000);
    }
    await this.d.tap('Филтр');
    await this.menuPick('Хатлов қилинмаган');
    await sleep(1200);
  }
  // Keyingi xonadon ochilishidan oldin: faol ekran va filtr to'g'riligini kafolatlash.
  // Avtomatik to'xtab qolishning asosiy sababi — yuborilgandan keyin ilova boshqa ekranga
  // chiqib qoladi yoki filtr tozalanadi. Shu holatlarni fon'da to'g'rilaymiz.
  async ensureList() {
    for (let i = 0; i < 3; i++) {
      const act = await this.d.activity();
      if (!act.includes('HouseholdPlotActivity')) {
        // "Юборилди" kabi qolgan oynani yopib qayta ochamiz
        await this.dismissDialogs().catch(() => {});
        if (act.includes('HouseholdPlotDetailsActivity')) await this.exitRecord().catch(() => {});
        else await this.openList();
        continue;
      }
      await this.d.dump().catch(() => {});
      // Filtr saqlanmagan bo'lsa qayta qo'yamiz
      if (this.d.nodes.length && !this.d.has('Хатлов қилинмаган')) {
        await this.d.tap('Филтр').catch(() => {});
        await this.menuPick('Хатлов қилинмаган').catch(() => {});
        await sleep(1000);
      }
      return;
    }
  }
  // Operator-profil hisoboti: reports/<yil>/<n>-xatlov/<operator>.(xlsx|csv) — har submitdan keyin yangilanadi
  saveOperatorReport() {
    if (!this.operator || !this.records.length) return;
    const today = new Date();
    const year = today.getFullYear();
    const cN = this.cfg.campaign || require('./rules').campaign(today).n;
    const dir = path.join(path.dirname(DATA), 'reports', String(year), `${cN}-xatlov`);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, this.operator);
    const header = ['n', 'kalit', 'umumiy', 'ochiq', 'ekin_maydoni', 'tomorqa_suvi', 'ichimlik_suvi',
      'ochiq_ekinlar', 'issiqxona', 'daraxtlar', 'holat', 'sana', 'soniya'];
    const got = (x) => x.entered ?? x.area;
    const rows = this.records.map((r) => [r.i, r.key, r.p.total, r.p.open, r.p.cropArea,
      `${r.p.water.plot.status}: ${r.p.water.plot.type}`, `${r.p.water.drink.status}: ${r.p.water.drink.type}`,
      r.p.openCrops.map((c) => `${c.name} ${got(c)} ${ymd(c.plantDate)}`).join(' | '),
      r.p.greenhouse ? `${r.p.greenhouse.crop} ${got(r.p.greenhouse)}, ${r.p.greenhouse.heating}, ${r.p.greenhouse.cover}, ${ymd(r.p.greenhouse.builtDate)}` : '',
      (r.p.trees || []).map((t) => `${t.name} ${t.count} dona ${got(t)} ${t.age} yosh`).join(' | '),
      'yuborildi', new Date().toISOString().replace('T', ' ').slice(0, 19), r.sec]);
    // CSV (BOM) — Excel kirillni to'g'ri ochadi; .xlsx yozuvchi kutubxona yo'q
    fs.writeFileSync(base + '.csv', '﻿' + [header.join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\n'));
    // JSON — keyingi xatlovda bot shu kalitlarni "qilingan" sifatida o'qishi uchun
    fs.writeFileSync(base + '.json', JSON.stringify({ operator: this.operator, yil: year, xatlov: cN, rows: this.records.map((r) => ({ n: r.i, kalit: r.key, umumiy: r.p.total, ochiq: r.p.open, ekin_maydoni: r.p.cropArea })) }, null, 1));
    try { require('./xlsx').writeSheet(base + '.xlsx', header, rows); } catch (e) { /* xlsx yozilmasa .csv qoladi */ }
  }
  async stats() {
    await this.d.tap('Хатлов қилинганлик даражаси');
    await this.d.waitFor('Жами хонадонлар сони');
    await sleep(1200);
    await this.d.dump();
    const valUnder = (label) => { // orqadagi kartalarda ham shu matn bor — ostida son turgan yorliqni olamiz
      for (const l of this.d.all(label)) {
        const v = this.d.nodes.find((n) => /^\d+$/.test(n.text) && n.y1 >= l.y2 - 5 && n.y1 < l.y2 + 150 && Math.abs(n.x1 - l.x1) < 120);
        if (v) return +v.text;
      }
      return null;
    };
    const s = { done: valUnder('Хатлов қилинган'), todo: valUnder('Хатлов қилинмаган'), total: valUnder('Жами хонадонлар сони') };
    if (this.d.has('Close sheet')) { await this.d.key(4); await sleep(700); }
    return s;
  }
  // Ro'yxatdagi navbatdagi ishlanmagan kartani ochadi (shu runda ochilganlar — done — qayta ochilmaydi)
  async openNextCard(done) {
    for (let i = 0; i < 80; i++) {
      this.check();
      await this.d.dump();
      const chips = this.d.all('Хатлов қилинмаган').filter((n) => n.x1 < this.size.w * 0.45 && n.cy > this.size.h * 0.18 && n.cy < this.size.h * 0.9);
      for (const c of chips) {
        const id = this.d.nodes.find((n) => /^\d{14}$/.test(n.text) && n.y1 > c.y2 && n.y1 < c.y2 + 200);
        if (!id) continue;
        const key = sha(id.text);
        if (done.has(key)) continue;
        done.add(key);
        await this.d.shell(`input tap ${this.mid} ${c.cy - 90}`);
        await this.d.waitActivity('HouseholdPlotDetailsActivity', 15000);
        await sleep(900);
        return key;
      }
      const sig = chips.map((c) => c.cy).join();
      await this.scrollBy(1);
      await this.d.dump();
      const sig2 = this.d.all('Хатлов қилинмаган').map((c) => c.cy).join();
      if (sig === sig2 && i > 0) return null; // ro'yxat oxiri
    }
    return null;
  }
  // knownStep: bosqich ma'lum bo'lsa (muvaffaqiyatli to'ldirishdan keyin) o'qish uchun dump qilinmaydi
  async exitRecord(knownStep) {
    // Tez yo'l: har "Back" bir bosqich orqaga; 1-bosqichdan keyingisi — chiqishni tasdiqlash dialogi
    const st = knownStep ? { cur: knownStep } : await this.step().catch(() => null);
    if (st && (await this.d.activity()).includes('HouseholdPlotDetailsActivity')) {
      await this.d.hideKeyboard();
      await this.d.shell(Array(st.cur).fill('input keyevent 4; sleep 0.5').join('; '));
      await sleep(500);
    }
    for (let i = 0; i < 10; i++) {
      await this.d.dump();
      if (this.d.has('Чиқишни тасдиқланг')) {
        await this.d.tap('Чиқиш', { cached: true });
        await this.d.waitActivity('HouseholdPlotActivity', 10000);
        await sleep(600);
        return;
      }
      if (this.d.has('Тушундим')) { await this.d.tap('Тушундим', { cached: true }); continue; }
      const act = await this.d.activity();
      if (act.includes('HouseholdPlotActivity')) return;
      if (act.includes('PhotoCaptureActivity')) { await this.d.key(4); await sleep(1000); continue; }
      const back = this.d.nodes.find((n) => n.desc === 'Орқага' && n.cy < this.size.h * 0.15);
      if (back) await this.d.tapNode(back); else await this.d.key(4);
      await sleep(1000);
    }
    throw new Error('Yozuvdan chiqib bo\'lmadi');
  }

  // ---------- 4-bosqich bo'limlari ----------
  async addButton(section, reuse = false) {
    const header = SECTIONS[section].header;
    for (let i = 0; i < 6; i++) {
      const h = await this.scrollTo(header, { reuse: reuse && i === 0 });
      // Ilova versiyasiga qarab tugma nomi content-desc'da yoki matnda bo'ladi
      const btn = this.d.nodes.filter((n) => (n.desc === 'Экин қўшиш' || n.text === 'Экин қўшиш') && n.y1 > h.y2)
        .sort((a, b) => a.y1 - b.y1)[0];
      if (this.inView(btn)) return btn;
      await this.scrollBy(1);
    }
    throw new Error(`"${header}" + tugmasi topilmadi`);
  }
  async ensureLists() {
    const key = this.listKey;
    this.lists[key] = this.lists[key] || {};
    for (const s of Object.keys(SECTIONS)) {
      if (this.lists[key][s]?.length) continue;
      this.check();
      this.log(`  "${SECTIONS[s].header}" ro'yxati o'qilmoqda (bir marta)…`);
      await this.d.tapNode(await this.addButton(s));
      await this.d.waitFor(SECTIONS[s].title);
      await this.d.tap('Танланг…', { cached: true });
      await this.d.waitFor('Қидириш…');
      this.lists[key][s] = await this.collectList();
      await this.closePicker();
      await this.d.tap('Бекор қилиш'); await sleep(700);
      writeJson(path.join(DATA, 'lists.json'), this.lists);
      this.log(`  ${this.lists[key][s].length} ta nom`);
    }
    return this.lists[key];
  }
  // Qaytaradi: ilovaga haqiqatda kiritilgan maydon (string) yoki null (qo'shilmadi)
  async addItem(section, item, reuse = false) {
    await this.d.tapNode(await this.addButton(section, reuse));
    await this.d.waitFor('Танланг…', { filter: () => this.d.has(SECTIONS[section].title) });
    if (!(await this.pickProduct(item.name, this.lists[this.listKey]?.[section]))) {
      await this.d.tap('Бекор қилиш');
      throw new Error(`Ro'yxatda yo'q: ${item.name}`);
    }
    // Forma joylashuvi bo'lim bo'yicha o'zgarmaydi: birinchi marta bitta dumpdan olinib keshlanadi.
    // Qolgan maydon (ilovadagi "Мавжуд майдон") bot tomonida ham hisoblanadi — uni o'qish uchun dump kerak emas.
    const areaLabel = section === 'trees' ? 'Эгаллаган майдони (сотих)' : 'Майдони (сотих)';
    let f = this.forms[section];
    if (f) await sleep(300);
    else {
      await this.d.dump();
      const av = this.d.nodes.find((n) => n.text.startsWith('Мавжуд майдон:'));
      if (av) this.availC = Math.min(this.availC, toC(num(av.text.split(':')[1])));
      if (this.d.has('Бўш ер майдони мавжуд эмас')) this.availC = 0;
      f = { add: this.d.find('Қўшиш'), cancel: this.d.find('Бекор қилиш'), area: await this.fieldBelow(areaLabel, true) };
      if (section === 'trees') Object.assign(f, { count: await this.fieldBelow('Сони (дона)', true), age: await this.fieldBelow('Дарахт ёши (йилда)', true) });
      else f.date = await this.fieldBelow('Экин экилган сана', true);
      if (!f.add || !f.cancel) throw new Error('Forma tugmalari topilmadi');
      this.forms[section] = f;
    }
    if (this.availC <= 0) {
      await this.d.tapNode(f.cancel);
      await sleep(500);
      this.log(`  ${item.name}: bo'sh maydon qolmagan — o'tkazildi`, 'warn');
      return null;
    }
    let area = item.area;
    // Ilova qolgan maydonni double'da hisoblaydi (6.5−5.7 = 0.7999…): qolganiga teng qiymat rad etiladi — 0.01 kam kiritamiz
    if (toC(+area) >= this.availC) area = fmt(this.availC - 1);
    if (section === 'trees') {
      await this.d.typeInto(f.count, item.count);
      await this.d.typeInto(f.area, area);
      await this.d.typeInto(f.age, item.age);
    } else {
      await this.d.typeInto(f.area, area);
      await this.d.tapNode(f.date);
      await this.setDate(item.plantDate, true);
    }
    await this.d.tapNode(f.add);
    await sleep(400);
    await this.d.dump();
    if (this.d.has(SECTIONS[section].title)) { // rad etildi — 0.01 kam bilan bir marta qayta urinish
      area = fmt(toC(+area) - 1);
      await this.d.hideKeyboard();
      await this.d.typeInto(await this.fieldBelow(areaLabel), area);
      await this.d.tap('Қўшиш');
      await sleep(600);
      await this.d.dump();
      if (this.d.has(SECTIONS[section].title)) {
        const form = this.safeText().join(' · ');
        await this.d.tap('Бекор қилиш', { cached: true }).catch(() => {});
        throw new Error(`Qo'shilmadi: ${item.name} (forma: ${form})`);
      }
    }
    this.availC -= toC(+area);
    this.log(section === 'trees'
      ? `  + ${item.name}: ${item.count} dona, ${area} sotix, ${item.age} yosh`
      : `  + ${item.name}: ${area} sotix, ${ymd(item.plantDate)}`);
    return area;
  }

  // ---------- bitta xonadon ----------
  async fillHousehold(idx) {
    const L = (m) => this.log(m);
    this.photoDone = false; // har xonadonda rasm qaytadan tasdiqlanadi
    this.stage(1);
    this.lastStep = null;
    if (this.cfg.season && this.cfg.season !== 'auto') {
      let tab = this.tabs[this.cfg.season];
      if (!tab) {
        await this.d.dump();
        tab = this.tabs[this.cfg.season] = this.d.nodes.find((n) => n.text === this.cfg.season && n.cy < this.size.h * 0.2);
      }
      if (tab) { await this.d.tapNode(tab); await sleep(800); }
    }
    // 1. Маълумот — ikkala qiymat odatda bitta ekranda: ikkinchisi oxirgi dumpdan o'qiladi
    const val = async (label, reuse) => {
      const lab = await this.scrollTo(label, { reuse });
      const v = this.d.nodes.find((n) => n.y1 >= lab.y2 - 5 && n.y1 < lab.y2 + 90 && Math.abs(n.x1 - lab.x1) < 40 && /\d/.test(n.text));
      if (!v) throw new Error(`O'qilmadi: ${label}`);
      return num(v.text);
    };
    const total = await val('Хонадон умумий майдони (сотих)', false);
    const open = await val('Очиқ томорқа майдони (сотих)', true);
    let greenhouse = false;
    if (total > 13) {
      const every = this.cfg.ghEvery || 20;
      greenhouse = this.state.ghEligible % every === this.state.ghOffset % every;
      this.state.ghEligible++;
    }
    // Daraxt: umumiy maydon > 4.5 bo'lgan har treeEvery xonadondan 1 tasiga (har bir mahsulot qatori ~20 s)
    let trees = false;
    if (total > 4.5) {
      const every = this.cfg.treeEvery || 10;
      trees = this.state.treeEligible % every === this.state.treeOffset % every;
      this.state.treeEligible++;
    }
    if (total > 4.5 || total > 13) writeJson(path.join(DATA, 'state.json'), this.state);
    let plan = makePlan({ total, open }, { greenhouse, trees, available: this.lists[this.listKey], campaign: this.cfg.campaign });
    L(`#${idx}: umumiy ${total}, ochiq ${open} sotix → ekin maydoni ${plan.cropArea}${greenhouse ? ', issiqxona' : ''}${trees ? ', daraxt' : ''}`);
    if (plan.skip) throw new Error(plan.skip);
    await this.next();

    // 2. Экин майдони
    this.check();
    await this.d.typeInto(await this.fieldBelow('Экин экиладиган майдон', true), plan.cropArea);
    L(`  Экин экиладиган майдон: ${plan.cropArea}`);
    await this.takePhoto();
    L('  Томорқа жойлашуви: joriy GPS');
    await this.choose('Экин эканганлик ҳолати', 'Экин экилган');
    await this.next();

    // 3. Сув таъминоти
    this.check();
    // Ilova ichimlik suv holati tanlanganda tomorqa suv TURINI "Танланмаган" ga qaytaradi,
    // shuning uchun avval ikkala holat, keyin ikkala tur tanlanadi
    await this.choose('Томорқа сув таъминоти', plan.water.plot.status);
    await this.choose('Хонадон ичимлик сув таъминоти', plan.water.drink.status);
    await this.choose('Сув таъминоти тури', plan.water.plot.type, 1);
    await this.choose('Сув таъминоти тури', plan.water.drink.type, 2);
    await this.next();

    // 4. Экинлар
    this.check();
    const cachedLists = Object.keys(SECTIONS).every((s) => this.lists[this.listKey]?.[s]?.length);
    const lists = await this.ensureLists();
    plan = Object.assign(makePlan({ total, open }, { greenhouse, trees, available: lists, fixedCropArea: +plan.cropArea, campaign: this.cfg.campaign }), { water: plan.water });
    this.availC = toC(+plan.cropArea);
    let reuse = cachedLists; // 3→4 o'tishdagi dump hali yangi (ro'yxat o'qilmagan bo'lsa)
    for (const c of plan.openCrops) { this.check(); c.entered = await this.addItem('open', c, reuse); reuse = true; }
    if (plan.greenhouse) {
      const g = plan.greenhouse;
      g.entered = await this.addItem('greenhouse', { name: g.crop, area: g.area, plantDate: g.plantDate }, reuse);
      await this.choose('Иситиш тизими', g.heating);
      await this.choose('Молиялаштириш манбаи', g.funding);
      await this.rowButton('Иссиқхона ташкил этилган йили');
      await this.setDate(g.builtDate);
      L(`  Иссиқхона ташкил этилган йили: ${ymd(g.builtDate)}`);
      await this.choose('Иссиқхона қоплами', g.cover);
      reuse = false;
    }
    for (const t of plan.trees || []) { this.check(); t.entered = await this.addItem('trees', t, reuse); reuse = true; }
    await this.next();

    // 5. Тасдиқлаш — forma tayyor.
    const st = await this.step(true);
    if (!st || st.cur !== st.total) throw new Error('Тасдиқлаш bosqichiga yetilmadi');
    this.lastStep = st.cur;
    // AUTO_SUBMIT=1 — bot «Юбориш»ni o'zi bosadi; aks holda odam bosishini kutadi
    plan.submit = this.d.autoSubmit ? await this.autoSubmitRecord(idx) : await this.awaitSubmit(idx);
    this.lastStep = null;
    return plan;
  }

  // AUTO_SUBMIT: barcha tekshiruvlardan o'tsa «Юбориш»ni bosadi va natijani aniqlaydi.
  // Qaytaradi: 'submitted' | 'discarded' | 'timeout'. Xato bo'lsa — throw (yuborilmaydi).
  async autoSubmitRecord(idx) {
    this.emit({ type: 'awaiting', i: idx, t: Date.now() });
    // Himoya tekshiruvlari — bittasi buzilsa «Юбориш» bosilmaydi
    await this.d.dump();
    const st = await this.step(true);
    if (!st || st.cur !== st.total) throw new Error('Yuborilmadi: 5/5 Тасдиқлаш bosqichida emas');
    // Rasm 2-bosqichda tasdiqlangan (photoDone). «Расмни ўзгартириш» faqat 2-bosqichda bo'ladi,
    // 5/5 Тасдиқлаш ekranida yo'q — shuning uchun shu yerda tekshirilmaydi.
    if (!this.photoDone) throw new Error('Yuborilmadi: rasm biriktirilmagan');
    if (!this.d.has(SUBMIT)) throw new Error(`Yuborilmadi: "${SUBMIT}" tugmasi ekranda yo'q`);
    // Ilova xatolik ko'rsatayotgan bo'lsa (masalan majburiy maydon) — to'xtaymiz
    const err = this.d.nodes.find((n) => /Хато|мажбурий|тўлдиринг|киритинг/i.test(n.text) && !n.text.includes('Расмни'));
    if (err) throw new Error(`Yuborilmadi: ilova xatosi — ${err.text}`);
    // Bir xil vaqtda joylantirish bo'lmasin: tasodifiy kutish autoDelayMin..autoDelayMax soniya
    const delay = this.autoDelayMin + Math.random() * (this.autoDelayMax - this.autoDelayMin);
    this.log(`  AUTO_SUBMIT: tasodifiy ${delay.toFixed(1)} s kutilmoqda…`, 'warn');
    await sleep(Math.round(delay * 1000));
    this.check();
    this.log('  AUTO_SUBMIT: tekshiruvlar o\'tdi — «Юбориш» bosilmoqda', 'warn');
    // submit() bir marta bosadi va «Юбориш» tugmasi yo'qolishini kutadi (=yuborildi); yo'qolmasa throw.
    await this.d.submit();
    // Yuborilgandan keyin ro'yxatga qaytish 1–2 s oladi — darhol emas, ~15 s kutib tekshiramiz
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      await this.dismissDialogs().catch(() => {});
      if (!(await this.d.activity()).includes('HouseholdPlotDetailsActivity')) {
        this.log('  ✔ Yozuv bot tomonidan yuborildi (AUTO_SUBMIT)');
        return 'submitted';
      }
    }
    // «Юбориш» yo'qoldi, lekin forma hali ochiq — yuborilgan bo'lishi mumkin, qurilmada tekshiring
    throw new Error('«Юбориш» bosildi, lekin forma 15 s ichida yopilmadi — natijani qurilmada tekshiring');
  }

  // 5-bosqichda odam «Юбориш»ni bosishini kutadi. Bot bu vaqtda hech narsani bosmaydi
  // (faqat «Чиқишни тасдиқланг» oynasini ko'radi — u bo'lsa, yozuv bekor qilinayotgan bo'ladi).
  // Qaytaradi: 'submitted' | 'discarded' | 'timeout'
  async awaitSubmit(idx) {
    const started = Date.now();
    const maxMs = Math.max(0, +this.cfg.submitWaitSec || 0) * 1000; // 0 = cheksiz
    let exitSeen = false, note = started, n = 0;
    this.emit({ type: 'awaiting', i: idx, t: started });
    this.log('  ⏸ Тасдиқлаш tayyor — «Юбориш»ni qurilmada o\'zingiz bosing (bot kutmoqda)', 'warn');
    for (;;) {
      this.check();
      const act = await this.d.activity();
      if (!act.includes('HouseholdPlotDetailsActivity')) {
        // Forma yopildi. «Чиқишни тасдиқланг» ko'rilgan bo'lsa — bekor qilindi, aks holda yuborildi
        if (exitSeen) { this.log('  ⚠ Yozuv bekor qilindi («Чиқиш» bosilgan)', 'warn'); return 'discarded'; }
        this.log('  ✔ Yozuv yuborildi — siz «Юбориш»ni bosdingiz');
        await sleep(600);
        await this.dismissDialogs(); // «Юборилди» xabari qolib ketmasin — keyingi xonadon ro'yxati ko'rinsin
        return 'submitted';
      }
      // O'tish paytida dump yiqilishi mumkin — bu xato emas, keyingi aylanishda aniqlanadi
      await this.d.dump().catch(() => {});
      if (this.d.has('Чиқишни тасдиқланг')) exitSeen = true; // bekor qilish oynasi
      const now = Date.now();
      if (maxMs && now - started > maxMs) {
        this.log(`  ⌛ «Юбориш» kutilmadi (${Math.round((now - started) / 1000)} s) — keyingi xonadonga o'tiladi`, 'warn');
        return 'timeout';
      }
      if (now - note > 60000) { // har daqiqada bir marta eslatma
        note = now; n++;
        this.log(`  … hali kutilmoqda (${n} daq). «Юбориш»ni bosing yoki «To'xtatish»ni.`, 'warn');
        this.emit({ type: 'awaiting', i: idx, t: started, waited: Math.round((now - started) / 1000) });
      }
      await sleep(1200);
    }
  }

  // Yuborilgandan keyin ilova ko'rsatgan xabar oynasini yopadi (yozuv allaqachon serverga ketgan,
  // bu yerda hech qanday ma'lumot yo'qolmaydi) — keyingi xonadon kartasi ko'rinishi uchun kerak
  async dismissDialogs() {
    for (let i = 0; i < 4; i++) {
      await this.d.dump().catch(() => {});
      const btn = this.d.find('Тушундим') || this.d.find('ОК') || this.d.find('Ок');
      if (!btn) return;
      await this.d.tapNode(btn).catch(() => {});
      await sleep(600);
    }
  }

  // ---------- asosiy sikl ----------
  async run() {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(RUNS, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const csv = [['#', 'umumiy', 'ochiq', 'ekin_maydoni', 'tomorqa_suvi', 'ichimlik_suvi', 'ochiq_ekinlar', 'issiqxona', 'daraxtlar', 'holat', 'xato', 'soniya'].join(';')];
    const saveCsv = () => fs.writeFileSync(path.join(runDir, 'report.csv'), '﻿' + csv.join('\n')); // BOM — Excel kirillni to'g'ri ochadi
    const got = (x) => x.entered ?? x.area;
    let ok = 0, fail = 0, skip = 0;
    const HOLAT = { submitted: 'yuborildi', discarded: 'bekor_qilindi', timeout: 'kutilmadi' };
    this.emit({ type: 'run', runId });
    try {
      await this.init();
      if (this.d.emulator) throw new Error('Emulator qo\'llab-quvvatlanmaydi — planshetni USB orqali ulang');
      await this.d.wake(); // ekran uxlamagan bo'lsin — aks holda dump lock-pardani o'qiydi
      this.log('Аҳоли томорқаси ochilmoqda…');
      await this.openList();
      const s = await this.stats();
      this.emit({ type: 'stats', ...s });
      this.log(`Хатлов қилинмаган: ${s.todo} / ${s.total}`);
      const done = new Set();
      const limit = Math.min(this.cfg.limit || 1, s.todo ?? Infinity);
      let ok0 = 0, fail0 = 0, skip0 = 0;
      for (let i = 1; i <= limit; i++) {
        this.check();
        // Avtomatik to'xtab qolish fix: har xonadondan oldin faol ekranni tekshirish
        // (muvaffaqiyatli yuborishdan keyin ilova boshqa ekrañga qaytib qolsa, qayta ochiladi)
        if (i > 1) await this.ensureList();
        this.emit({ type: 'counts', done: ok0, skip: skip0, fail: fail0, left: Math.max(0, limit - (i - 1)), limit });
        const key = await this.openNextCard(done);
        if (!key) { this.log('Ro\'yxat tugadi'); break; }
        this.cur = i;
        const t0 = Date.now(), d0 = this.d.dumps || 0;
        this.emit({ type: 'progress', i, limit });
        let p = null;
        try {
          p = await this.fillHousehold(i);
          const submit = p.submit || 'timeout';
          const sec = Math.round((Date.now() - t0) / 1000);
          if (submit === 'submitted') { ok++; ok0++; } else { skip++; skip0++; }
          const row = [i, p.total, p.open, p.cropArea, p.water.plot.type, p.water.drink.type,
            p.openCrops.map((c) => `${c.name} ${got(c)} ${ymd(c.plantDate)}`).join(' | '),
            p.greenhouse ? `${p.greenhouse.crop} ${got(p.greenhouse)}, ${p.greenhouse.heating}, ${p.greenhouse.cover}, ${ymd(p.greenhouse.builtDate)}` : '',
            (p.trees || []).map((t) => `${t.name} ${t.count} dona ${got(t)} ${t.age} yosh`).join(' | '), HOLAT[submit] || submit, '', sec].map(cell);
          csv.push(row.join(';'));
          // Per-operator ro'yxat: faqat yuborilganlar (kelgusi xatlovga foyda)
          if (submit === 'submitted') this.records.push({ i, key, sec, submit, p });
          this.saveOperatorReport();
          this.emit({
            type: 'household', i, ok: submit === 'submitted', submit, sec,
            plan: {
              total: p.total, open: p.open, cropArea: p.cropArea,
              water: [p.water.plot.type, p.water.drink.type],
              crops: p.openCrops.map((c) => ({ name: c.name, area: got(c), date: ymd(c.plantDate) })),
              greenhouse: p.greenhouse && { crop: p.greenhouse.crop, area: got(p.greenhouse), heating: p.greenhouse.heating, cover: p.greenhouse.cover, built: ymd(p.greenhouse.builtDate) },
              trees: (p.trees || []).map((t) => ({ name: t.name, count: t.count, area: got(t), age: t.age })),
            },
          });
        } catch (e) {
          if (e.message === 'STOP') throw e;
          fail++; fail0++;
          const sec = Math.round((Date.now() - t0) / 1000);
          this.log(`#${i}: xato — ${e.message}`, 'error');
          fs.writeFileSync(path.join(runDir, `xato_${i}.png`), await this.d.screenshot().catch(() => Buffer.alloc(0)));
          csv.push([i, '', '', '', '', '', '', '', '', 'xato', e.message, sec].map(cell).join(';'));
          this.emit({ type: 'household', i, ok: false, error: e.message, sec });
        } finally {
          saveCsv();
          const sec = Math.round((Date.now() - t0) / 1000), dumps = (this.d.dumps || 0) - d0;
          if (p && (p.submit === 'submitted' || p.submit === 'discarded')) {
            // Yozuv allaqachon yopilgan (yuborilgan yoki bekor qilingan) — qayta chiqish kerak emas
            this.log(`#${i}: ${HOLAT[p.submit]} (${sec} s, ${dumps} dump)`);
          } else {
            await this.exitRecord(this.lastStep).catch((e) => this.log('Chiqishda xato: ' + e.message, 'error'));
            this.log(`#${i}: saqlanmasdan chiqildi (${sec} s, ${dumps} dump)`);
          }
        }
      }
    } catch (e) {
      if (e.message === 'STOP') { this.log('To\'xtatildi', 'warn'); await this.exitRecord().catch(() => {}); }
      else this.log('Xato: ' + e.message, 'error');
    }
    saveCsv();
    this.log(`Tugadi: ${ok} yuborildi, ${skip} bekor/kutilmadi, ${fail} xato`);
    this.emit({ type: 'done', ok, fail, skip, runId });
  }
}

module.exports = { Bot, STEPS };
