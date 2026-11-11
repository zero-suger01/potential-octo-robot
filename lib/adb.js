// adb orqali qurilmani boshqarish: UI dump, matn bo'yicha topish, bosish, yozish.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ADB, unpacked } = require('./platform');

// Yuborish tugmasi matni
const SUBMIT = 'Юбориш';

// Yarim-avtomat rejim (sukut bo'yicha): «Юбориш»ni faqat odam bosadi, bot bu tugmaga tegmaydi.
// To'liq avtomat rejim uchun ataylab yoqiladi: AUTO_SUBMIT=1 node ...
// Env — faqat STANDART qiymat. Haqiqiy qiymat har run uchun Device.autoSubmit da (UI/config belgilaydi).
const AUTO_SUBMIT_ENV = process.env.AUTO_SUBMIT === '1';

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { maxBuffer: 32 * 1024 * 1024, encoding: opts.binary ? 'buffer' : 'utf8', timeout: opts.timeout || 60000 },
      (err, stdout, stderr) => (err ? reject(new Error(`adb ${args.join(' ')}: ${stderr || err.message}`)) : resolve(stdout)));
  });
}

async function listDevices() {
  const out = await run(['devices', '-l']);
  return out.split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('*')).map((l) => {
    const [serial, state] = l.trim().split(/\s+/);
    const model = (l.match(/model:(\S+)/) || [])[1] || '';
    return { serial, state, model, emulator: serial.startsWith('emulator-') };
  });
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

function parse(xml) {
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = {};
    for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = unescape(v);
    const b = (a.bounds || '').match(/\d+/g)?.map(Number) || [0, 0, 0, 0];
    nodes.push({
      text: (a.text || '').trim(), desc: (a['content-desc'] || '').trim(), cls: a.class || '',
      clickable: a.clickable === 'true', editable: a.class?.endsWith('EditText') || false,
      x1: b[0], y1: b[1], x2: b[2], y2: b[3], cx: (b[0] + b[2]) >> 1, cy: (b[1] + b[3]) >> 1,
    });
  }
  return nodes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Doimiy dump serveri (fastdump/FastDump.java): qurilmadagi uiautomator.jar bilan bir marta ulanadi,
// keyin har dump ~0.05–0.5 s (`uiautomator dump` ~2.3 s). XML aynan bir xil. Ishlamasa — eski usul.
const FD_JAR = unpacked(path.join(__dirname, '..', 'fastdump', 'fastdump.jar'));
const FD_REMOTE = '/data/local/tmp/fastdump.jar';
const FD_CMD = `CLASSPATH=/system/framework/uiautomator.jar:${FD_REMOTE} exec app_process /system/bin FastDump`;
const FD_QUIET = +process.env.FD_QUIET || 300;   // ekran shuncha ms "tinch" tursa o'qiladi (tezroq)
const FD_GAP = +process.env.FD_GAP || 350;     // oxirgi bosish/yozishdan keyin kamida shuncha kutiladi — ekran o'zgarishga ulgursin
const servers = new Map(); // serial → FastDump (bitta qurilmaga bitta ulanish: UiAutomation ikkitasiga ruxsat bermaydi)

class FastDump {
  constructor(serial) { this.serial = serial; this.proc = null; this.failedAt = 0; this.queue = Promise.resolve(); }
  get usable() { return fs.existsSync(FD_JAR) && Date.now() - this.failedAt > 60000; }
  async start() {
    // Avvalgi Node jarayonidan qolgan server UiAutomation'ni band qilib turadi — avval o'chiramiz
    await run(['-s', this.serial, 'shell', "pkill -f 'bin [F]astDump'; true"]).catch(() => {});
    await run(['-s', this.serial, 'push', FD_JAR, FD_REMOTE], { timeout: 15000 });
    const p = spawn(ADB, ['-s', this.serial, 'shell', '-T', FD_CMD]);
    this.proc = p; this.buf = ''; this.wait = null;
    p.stdout.on('data', (d) => { this.buf += d; this.drain(); });
    p.on('exit', () => { if (this.proc === p) { this.proc = null; this.wait?.reject(new Error('fastdump to\'xtadi')); } });
    await this.read('<<READY>>\n', 8000);
  }
  drain() {
    if (!this.wait) return;
    const i = this.buf.indexOf(this.wait.end);
    if (i < 0) return;
    const msg = this.buf.slice(0, i);
    this.buf = this.buf.slice(i + this.wait.end.length);
    const w = this.wait; this.wait = null; w.resolve(msg);
  }
  read(end, timeout) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.wait = null; reject(new Error('fastdump javob bermadi')); }, timeout);
      this.wait = { end, resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
      this.drain();
    });
  }
  dump() {
    const job = this.queue.then(async () => {
      if (!this.proc) await this.start();
      this.proc.stdin.write(`d ${FD_QUIET}\n`);
      const xml = await this.read('\n<<END>>\n', 15000);
      if (xml.startsWith('<<ERR>>')) throw new Error(xml.slice(8).trim());
      return xml;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async stop() {
    const p = this.proc; this.proc = null;
    if (p) { p.stdin.end('q\n'); p.kill(); }
    await run(['-s', this.serial, 'shell', "pkill -f 'bin [F]astDump'; true"]).catch(() => {});
  }
}
process.on('exit', () => { for (const s of servers.values()) s.proc?.kill(); });

class Device {
  constructor(serial) {
    this.serial = serial;
    this.emulator = serial.startsWith('emulator-');
    this.nodes = [];
    // Standart — env'dan; bot har run uchun qayta belgilaydi (UI toggle). false — «Юбориш» taqiqlanadi.
    this.autoSubmit = AUTO_SUBMIT_ENV;
  }
  // autoSubmit o'chiq bo'lsa «Юбориш» taqiqlangan tugmalar ro'yxatida
  get forbidden() { return this.autoSubmit ? [] : [SUBMIT]; }
  adb(args, opts) { return run(['-s', this.serial, ...args], opts); }
  async shell(cmd) {
    const out = await this.adb(['shell', cmd]);
    if (/\b(input|monkey)\b/.test(cmd)) this.actedAt = Date.now(); // ekranni o'zgartiruvchi amal
    return out;
  }

  // Avval doimiy server (~0.05–0.5 s); u ishlamasa — `uiautomator dump` (~2.3 s)
  async dump() {
    const fd = servers.get(this.serial) || servers.set(this.serial, new FastDump(this.serial)).get(this.serial);
    if (fd.usable) {
      // Eski dump jarayon ishga tushguncha ~1 s o'tardi — shu vaqtda ekran bosishga javob berib ulgurardi
      const gap = FD_GAP - (Date.now() - (this.actedAt || 0));
      if (gap > 0) await sleep(gap);
      let err;
      for (let i = 0; i < 4; i++) {
        if (i) await sleep(400 * i);
        try {
          const xml = await fd.dump();
          this.nodes = parse(xml);
          this.dumps = (this.dumps || 0) + 1;
          return this.nodes;
        } catch (e) {
          err = e;
          if (!/null root/.test(e.message)) break; // bo'sh ekran (oyna almashish payti) — qayta urinamiz
        }
      }
      if (/null root/.test(err.message)) throw new Error(`Ekranni o'qib bo'lmadi (fastdump): ${err.message}`);
      // Server buzildi — o'chiramiz (u UiAutomation'ni band qiladi) va bir daqiqa eski usulda ishlaymiz
      fd.failedAt = Date.now();
      await fd.stop();
    }
    return this.slowDump();
  }
  // ~2–3 s: uiautomator har safar jarayonni ishga tushiradi va 1 s "idle" kutadi
  async slowDump() {
    let xml = '', err;
    // uiautomator ba'zan "idle" holatni kutib ulgurmaydi yoki xotira yetmasa o'ldiriladi — qayta urinamiz
    for (let i = 0; i < 4 && !xml.includes('<hierarchy'); i++) {
      if (i) await sleep(800 * i);
      xml = await this.adb(['exec-out', 'rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml 2>/dev/null; true'], { timeout: 30000 })
        .catch((e) => { err = e; return ''; });
    }
    if (!xml.includes('<hierarchy')) throw new Error(`Ekranni o'qib bo'lmadi (uiautomator dump)${err ? ': ' + err.message.split('\n')[0].slice(-80) : ''}`);
    this.nodes = parse(xml);
    this.dumps = (this.dumps || 0) + 1;
    return this.nodes;
  }
  async activity() {
    const out = await this.shell('dumpsys activity activities | grep topResumedActivity || true');
    return (out.match(/\/([\w.]+)/) || [])[1] || '';
  }
  async screenshot() { return this.adb(['exec-out', 'screencap', '-p'], { binary: true }); }

  // --- topish ---
  is(n, t) { return n.text === t || n.desc === t; }
  all(t, nodes = this.nodes) { return nodes.filter((n) => this.is(n, t)); }
  find(t, nth = 1, nodes = this.nodes) { return this.all(t, nodes)[nth - 1]; }
  has(t) { return this.nodes.some((n) => this.is(n, t)); }

  // --- harakatlar ---
  guard(x, y) {
    const F = this.forbidden;
    if (!F.length) return;
    const bad = this.nodes.find((n) => (F.includes(n.text) || F.includes(n.desc)) && x >= n.x1 - 40 && x <= n.x2 + 40 && y >= n.y1 - 60 && y <= n.y2 + 60);
    if (bad) throw new Error(`XAVFSIZLIK: "${bad.text || bad.desc}" tugmasi ustiga bosish taqiqlangan`);
  }
  async tapNode(n) {
    if (this.forbidden.includes(n.text) || this.forbidden.includes(n.desc)) throw new Error(`XAVFSIZLIK: "${n.text}" bosilmaydi`);
    this.guard(n.cx, n.cy);
    await this.shell(`input tap ${n.cx} ${n.cy}`);
  }
  // cached: oxirgi dumpda bo'lsa qayta dump qilmaydi (dump ~2 s oladi)
  async tap(t, { nth = 1, timeout = 8000, filter, cached = false } = {}) {
    if (this.forbidden.includes(t)) throw new Error(`XAVFSIZLIK: "${t}" bosilmaydi`);
    const n = (cached && this.all(t).filter(filter || (() => true))[nth - 1]) || await this.waitFor(t, { timeout, nth, filter });
    await this.tapNode(n);
    return n;
  }

  // «Юбориш»ni bosadi va forma yuborilganini tekshiradi (tugma ekrandan yo'qolishi).
  // Ikki marta yuborilmasligi uchun tugma faqat BIR MARTA bosiladi — qayta urinilmaydi.
  async submit({ timeout = 10000, confirmTimeout = 20000 } = {}) {
    if (!this.autoSubmit) throw new Error(`Yarim-avtomat rejim: "${SUBMIT}"ni qurilmada o'zingiz bosing (to'liq avtomat uchun AUTO_SUBMIT=1)`);
    await this.hideKeyboard(); // klaviatura tugmani yopib qo'ymasin
    const n = await this.waitFor(SUBMIT, { timeout });
    await this.shell(`input tap ${n.cx} ${n.cy}`);
    const end = Date.now() + confirmTimeout;
    while (Date.now() < end) {
      await sleep(700);
      try { await this.dump(); } catch { continue; }
      if (!this.has(SUBMIT)) return true;
    }
    throw new Error(`"${SUBMIT}" bosildi, lekin ekran o'zgarmadi — natijani qurilmada qo'lda tekshiring (qayta bosilmadi)`);
  }

  async waitFor(t, { timeout = 10000, nth = 1, filter } = {}) {
    const end = Date.now() + timeout;
    while (true) {
      await this.dump();
      let list = this.all(t);
      if (filter) list = list.filter(filter);
      if (list[nth - 1]) return list[nth - 1];
      if (Date.now() > end) throw new Error(`Topilmadi: "${t}"`);
      await sleep(400);
    }
  }
  async waitActivity(part, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if ((await this.activity()).includes(part)) return true;
      await sleep(500);
    }
    throw new Error(`Ekran ochilmadi: ${part}`);
  }
  async swipe(x1, y1, x2, y2, ms = 450) { await this.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`); }
  async key(k) { await this.shell(`input keyevent ${k}`); }
  // Ekran uxlab qolsa dump lock-pardani o'qiydi va kamera ochilmaydi: uyg'otib, qulfni ochib,
  // USB ulanganida ekranni yoniq ushlab turamiz.
  async wake() {
    await this.shell('input keyevent KEYCODE_WAKEUP').catch(() => {});
    await this.shell('wm dismiss-keyguard').catch(() => {});
    await this.shell('svc power stayon usb').catch(() => {});
    await sleep(400);
  }
  async keyboardShown() { return /mInputShown=true/.test(await this.shell('dumpsys input_method')); }
  async hideKeyboard() { if (await this.keyboardShown()) { await this.key(4); await sleep(250); } }
  // Bitta shell chaqiruvida: bosish, tozalash, yozish (har adb chaqiruvi ~80 ms)
  async typeInto(n, value) {
    if (this.forbidden.includes(n.text)) throw new Error(`XAVFSIZLIK: "${n.text}" bosilmaydi`);
    this.guard(n.cx, n.cy);
    const v = String(value).replace(/[^0-9.]/g, '');
    await this.shell(`input tap ${n.cx} ${n.cy}; sleep 0.2; input keyevent KEYCODE_MOVE_END; input keyevent ${Array(12).fill('KEYCODE_DEL').join(' ')}; input text ${v}`);
    await sleep(80);
    await this.hideKeyboard();
  }
  // Planshet gorizontal turishi mumkin: `wm size` fizik o'lchamni beradi va aylanishni hisobga olmaydi
  // (1200x1920), shuning uchun avval displey joriy o'lchami o'qiladi (cur=1920x1200)
  async size() {
    const disp = await this.shell('dumpsys window displays').catch(() => '');
    const cur = disp.match(/cur=(\d+)x(\d+)/);
    if (cur) return { w: +cur[1], h: +cur[2] };
    const m = (await this.shell('wm size')).match(/(\d+)x(\d+)/);
    return { w: +m[1], h: +m[2] };
  }
}

module.exports = { Device, listDevices, sleep, run, SUBMIT, AUTO_SUBMIT_ENV };