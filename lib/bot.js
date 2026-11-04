// Аҳоли томорқаси formasini to'ldiruvchi bot. SINOV REJIMI: 5-bosqichda "Юбориш" bosilmaydi,
// yozuvdan "Чиқиш" orqali saqlamasdan chiqiladi — ilova ma'lumotni faqat Юбориш'da serverga yuboradi.
//
// Tezlik: eng qimmat amal — UI dump (~2.3 s). Shuning uchun ekran o'zgarmagan joyda oxirgi dumpdan
// qayta foydalaniladi (`reuse` / `cached`), tap va matn kiritish bitta shell chaqiruvida bajariladi.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Device, sleep } = require('./adb');
const { makePlan, fmt, toC } = require('./rules');

const PKG = 'uz.realsoft.onlinemahalla.assistant';
const ROOT = path.join(__dirname, '..');
const CAMFEED = path.join(ROOT, '..', 'camfeed', 'current.png');
const DATA = path.join(ROOT, 'data');
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const SECTIONS = {
  open: { header: 'Очиқ майдон экинлари', title: 'Очиқ майдон экини қўшиш' },
  greenhouse: { header: 'Иссиқхона экинлари', title: 'Иссиқхона экини қўшиш' },
  trees: { header: 'Дарахтлар', title: 'Экилган дарахтлар қўшиш' },
};
const STEPS = ['Маълумот', 'Экин майдони', 'Сув таъминоти', 'Экинлар', 'Тасдиқлаш'];
const IMG_RE = /\.(jpe?g|png|heic|webp)$/i;
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
    this.cfg = cfg;            // { serial, photosDir, limit, season, lat, lon, reviewSec, ghEvery, treeEvery }
    this.emit = emit;
    this.d = new Device(cfg.serial);
    this.stopped = false;
    this.lists = readJson(path.join(DATA, 'lists.json'), {});
    this.state = readJson(path.join(DATA, 'state.json'), { ghEligible: 0, ghOffset: Math.floor(Math.random() * 20) });
    this.state.treeEligible ??= 0;
    this.state.treeOffset ??= Math.floor(Math.random() * 10);
    this.forms = {};   // bo'lim → forma maydonlari joylashuvi (kesh)
    this.tabs = {};    // mavsum tabi joylashuvi (kesh)
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
  }
  async scrollBy(dir) { // dir=+1: kontent yuqoriga (pastini ko'rsatadi)
    const { h } = this.size;
    const a = Math.round(h * 0.75), b = Math.round(h * 0.42);
    await this.d.swipe(this.mid, dir > 0 ? a : b, this.mid, dir > 0 ? b : a, 400);
    await sleep(300); // keyingi dump o'zi ham ekran tinchlanishini kutadi
  }
  inView(n) { return n && n.cy > this.view.top && n.cy < this.view.bottom; }
  // reuse: birinchi urinishda oxirgi dumpdan foydalanish (ekran o'zgarmagan bo'lsa)
  async scrollTo(text, { filter, reuse = false } = {}) {
    const get = () => this.d.all(text).filter(filter || (() => true))[0];
    let first = true;
    for (const [dir, times] of [[1, 8], [-1, 14]]) {
      for (let i = 0; i <= times; i++) {
        if (!(first && reuse && this.d.nodes.length)) await this.d.dump();
        first = false;
        const n = get();
        if (this.inView(n)) return n;
        if (n) { await this.scrollBy(n.cy < this.view.top ? -1 : 1); continue; }
        if (i < times) await this.scrollBy(dir);
      }
    }
    throw new Error(`Ekranda topilmadi: "${text}"`);
  }
  // Satr yorlig'i yonidagi "Танлаш" tugmasi
  async rowButton(label, nth = 1) {
    const isRow = (n) => n.x1 > this.size.w * 0.15;
    await this.scrollTo(label, { filter: isRow });
    const lab = this.d.all(label).filter(isRow).filter((n) => this.inView(n))[nth - 1] || this.d.all(label).filter(isRow)[nth - 1];
    const btn = this.d.all('Танлаш')
      .filter((n) => n.x1 > this.size.w * 0.6)
      .sort((a, b) => Math.abs(a.cy - lab.cy - 25) - Math.abs(b.cy - lab.cy - 25))[0];
    if (!btn || Math.abs(btn.cy - lab.cy) > 120) throw new Error(`"${label}" uchun Танлаш topilmadi`);
    await this.d.tapNode(btn);
    await sleep(250);
  }
  async menuPick(option) {
    const right = (x) => x.x1 > this.size.w * 0.28; // menyu o'ngda ochiladi; chapdagi bir xil matn — qiymat
    await this.d.waitFor(option, { filter: right, timeout: 5000 });
    const best = this.d.all(option).filter(right).sort((a, b) => b.x1 - a.x1)[0];
    await this.d.tapNode(best);
    await sleep(300);
  }
  async choose(label, option, nth = 1) {
    await this.rowButton(label, nth);
    await this.menuPick(option);
    this.log(`  ${label}: ${option}`);
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
  async scrollList(dir = 1) {
    const { h } = this.size;
    await this.d.swipe(this.mid, Math.round(h * (dir > 0 ? 0.78 : 0.35)), this.mid, Math.round(h * (dir > 0 ? 0.35 : 0.78)), 500);
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
    await this.d.tap('Ёпиш', { cached: true });
    await sleep(500);
    return false;
  }

  // ---------- rasm ----------
  photos() {
    const dir = this.cfg.photosDir;
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => IMG_RE.test(f)).map((f) => path.join(dir, f));
  }
  async preparePhoto() {
    const list = this.photos();
    if (!list.length) throw new Error('Rasm papkasi bo\'sh yoki topilmadi');
    let p;
    do { p = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && p === this.lastPhoto);
    this.lastPhoto = p;
    fs.mkdirSync(path.dirname(CAMFEED), { recursive: true });
    await new Promise((res, rej) => execFile('sips', ['-s', 'format', 'png', '-Z', '1600', p, '--out', CAMFEED],
      (e) => (e ? rej(new Error('Rasmni o\'girib bo\'lmadi: ' + path.basename(p))) : res())));
    return path.basename(p);
  }
  async takePhoto() {
    if (this.d.emulator) this.log(`  Rasm: ${await this.preparePhoto()}`);
    // Scroll inersiyasi tufayli tap tegmasligi mumkin — kamera ekrani ochilguncha 3 marta urinamiz
    for (let k = 0; ; k++) {
      const btn = await this.scrollTo('Камерани очиш').catch(() => this.scrollTo('Расмни ўзгартириш'));
      await this.d.tapNode(btn);
      let opened = false;
      for (let t = 0; t < 10 && !opened; t++) {
        await sleep(400);
        const act = await this.d.activity();
        opened = act.includes('PhotoCaptureActivity') || /permission|Grant/i.test(act);
      }
      if (opened || !this.d.emulator) break;
      if (k === 2) throw new Error('Kamera ochilmadi');
    }
    if (!this.d.emulator) {
      this.log('  Telefonda tomorqa rasmini oling (3 daqiqa kutiladi)…', 'warn');
      await this.d.waitFor('Расмни ўзгартириш', { timeout: 180000 });
      return;
    }
    // Ruxsat so'ralsa (birinchi marta) — tasdiqlaymiz; shutter joyi keshlanadi, keyingi safar dump kerak emas
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const act = await this.d.activity();
      if (act.includes('PhotoCaptureActivity') && this.shutter) {
        await sleep(2000); // kamera preview yuklanishi
        await this.d.shell(`input tap ${this.shutter.cx} ${this.shutter.cy}`);
        break;
      }
      await this.d.dump();
      const allow = this.d.nodes.find((n) => /While using the app|Ilovadan foydalanish|Иловадан фойдаланиш/i.test(n.text));
      if (allow) { await this.d.tapNode(allow); await sleep(1200); continue; }
      const shot = this.d.find('Расмга олиш');
      if (shot) {
        this.shutter = shot;
        await sleep(1200);
        await this.d.tapNode(shot);
        break;
      }
      await sleep(300);
    }
    if (Date.now() >= end) throw new Error('Kamera ochilmadi');
    // Rasm olingach ilova formaga qaytadi; preview tayyor bo'lmagan bo'lsa shutter qayta bosiladi.
    // Rasm yo'qligi keyingi "Кейинги"da ilova xatosi sifatida ham ushlanadi.
    for (let k = 0; ; k++) {
      try { await this.d.waitActivity('HouseholdPlotDetailsActivity', 6000); break; } catch (e) {
        if (k === 2 || !(await this.d.activity()).includes('PhotoCaptureActivity')) throw new Error('Rasm olinmadi');
        await this.d.shell(`input tap ${this.shutter.cx} ${this.shutter.cy}`);
      }
    }
    await sleep(500);
  }

  // ---------- navigatsiya ----------
  async openList() {
    let act = await this.d.activity();
    if (act.includes('HouseholdPlotDetailsActivity')) { await this.exitRecord(); act = await this.d.activity(); }
    if (!act.includes('HouseholdPlotActivity')) {
      await this.d.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
      await this.d.waitActivity('MainActivity', 30000);
      await sleep(2000);
      for (let i = 0; i < 10; i++) {
        await this.d.dump();
        const m = this.d.find('Аҳоли томорқаси');
        if (m) { await this.d.tapNode(m); break; }
        await this.scrollBy(1);
      }
      await this.d.waitActivity('HouseholdPlotActivity', 20000);
      await sleep(2000);
    }
    await this.d.tap('Филтр');
    await this.menuPick('Хатлов қилинмаган');
    await sleep(2000);
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
      const btn = this.d.nodes.filter((n) => n.desc === 'Экин қўшиш' && n.y1 > h.y2).sort((a, b) => a.y1 - b.y1)[0];
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
      await this.d.tap('Ёпиш', { cached: true }); await sleep(500);
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
    let plan = makePlan({ total, open }, { greenhouse, trees, available: this.lists[this.listKey] });
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
    await this.choose('Томорқа сув таъминоти', plan.water.plot.status);
    await this.choose('Сув таъминоти тури', plan.water.plot.type, 1);
    await this.choose('Хонадон ичимлик сув таъминоти', plan.water.drink.status);
    await this.choose('Сув таъминоти тури', plan.water.drink.type, 2);
    await this.next();

    // 4. Экинлар
    this.check();
    const cachedLists = Object.keys(SECTIONS).every((s) => this.lists[this.listKey]?.[s]?.length);
    const lists = await this.ensureLists();
    plan = Object.assign(makePlan({ total, open }, { greenhouse, trees, available: lists, fixedCropArea: +plan.cropArea }), { water: plan.water });
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

    // 5. Тасдиқлаш — Юбориш BOSILMAYDI
    const st = await this.step(true);
    if (!st || st.cur !== st.total) throw new Error('Тасдиқлаш bosqichiga yetilmadi');
    this.lastStep = st.cur;
    L(`  ✔ Тасдиқлаш (${st.cur}/${st.total}) — Юбориш bosilmaydi`);
    await sleep((this.cfg.reviewSec ?? 3) * 1000);
    return plan;
  }

  // ---------- asosiy sikl ----------
  async run() {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(ROOT, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const csv = [['#', 'umumiy', 'ochiq', 'ekin_maydoni', 'tomorqa_suvi', 'ichimlik_suvi', 'ochiq_ekinlar', 'issiqxona', 'daraxtlar', 'holat', 'xato', 'soniya'].join(';')];
    const saveCsv = () => fs.writeFileSync(path.join(runDir, 'report.csv'), '﻿' + csv.join('\n')); // BOM — Excel kirillni to'g'ri ochadi
    const got = (x) => x.entered ?? x.area;
    let ok = 0, fail = 0;
    this.emit({ type: 'run', runId });
    try {
      await this.init();
      if (this.d.emulator && this.cfg.lat && this.cfg.lon) {
        const g = await this.d.geo(this.cfg.lat, this.cfg.lon);
        this.log(`GPS: ${g.lat}, ${g.lon}`);
        this.emit({ type: 'gps', lat: g.lat, lon: g.lon });
      }
      if (this.d.emulator && !this.photos().length) throw new Error('Rasm papkasida rasm yo\'q');
      this.log('Аҳоли томорқаси ochilmoqda…');
      await this.openList();
      const s = await this.stats();
      this.emit({ type: 'stats', ...s });
      this.log(`Хатлов қилинмаган: ${s.todo} / ${s.total}`);
      const done = new Set();
      const limit = Math.min(this.cfg.limit || 1, s.todo ?? Infinity);
      for (let i = 1; i <= limit; i++) {
        this.check();
        if (this.d.emulator && this.cfg.lat) await this.d.geo(this.cfg.lat, this.cfg.lon);
        const key = await this.openNextCard(done);
        if (!key) { this.log('Ro\'yxat tugadi'); break; }
        this.cur = i;
        const t0 = Date.now(), d0 = this.d.dumps || 0;
        this.emit({ type: 'progress', i, limit });
        try {
          const p = await this.fillHousehold(i);
          ok++;
          const sec = Math.round((Date.now() - t0) / 1000);
          csv.push([i, p.total, p.open, p.cropArea, p.water.plot.type, p.water.drink.type,
            p.openCrops.map((c) => `${c.name} ${got(c)} ${ymd(c.plantDate)}`).join(' | '),
            p.greenhouse ? `${p.greenhouse.crop} ${got(p.greenhouse)}, ${p.greenhouse.heating}, ${p.greenhouse.cover}, ${ymd(p.greenhouse.builtDate)}` : '',
            (p.trees || []).map((t) => `${t.name} ${t.count} dona ${got(t)} ${t.age} yosh`).join(' | '), 'tasdiqlashgacha', '', sec].map(cell).join(';'));
          this.emit({
            type: 'household', i, ok: true, sec,
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
          fail++;
          const sec = Math.round((Date.now() - t0) / 1000);
          this.log(`#${i}: xato — ${e.message}`, 'error');
          fs.writeFileSync(path.join(runDir, `xato_${i}.png`), await this.d.screenshot().catch(() => Buffer.alloc(0)));
          csv.push([i, '', '', '', '', '', '', '', '', 'xato', e.message, sec].map(cell).join(';'));
          this.emit({ type: 'household', i, ok: false, error: e.message, sec });
        } finally {
          saveCsv();
          await this.exitRecord(this.lastStep).catch((e) => this.log('Chiqishda xato: ' + e.message, 'error'));
          this.log(`#${i}: saqlanmasdan chiqildi (${Math.round((Date.now() - t0) / 1000)} s, ${(this.d.dumps || 0) - d0} dump)`);
        }
      }
    } catch (e) {
      if (e.message === 'STOP') { this.log('To\'xtatildi', 'warn'); await this.exitRecord().catch(() => {}); }
      else this.log('Xato: ' + e.message, 'error');
    }
    saveCsv();
    this.log(`Tugadi: ${ok} muvaffaqiyatli, ${fail} xato`);
    this.emit({ type: 'done', ok, fail, runId });
  }
}

module.exports = { Bot, CAMFEED, STEPS };
