// adb orqali qurilmani boshqarish: UI dump, matn bo'yicha topish, bosish, yozish.
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');

const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const ADB = path.join(SDK, 'platform-tools/adb');

// Bu matnli tugma hech qachon bosilmaydi (sinov rejimi)
const FORBIDDEN = ['Юбориш'];

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

class Device {
  constructor(serial) {
    this.serial = serial;
    this.emulator = serial.startsWith('emulator-');
    this.nodes = [];
  }
  adb(args, opts) { return run(['-s', this.serial, ...args], opts); }
  shell(cmd) { return this.adb(['shell', cmd]); }

  // ~2–3 s: uiautomator har safar jarayonni ishga tushiradi va 1 s "idle" kutadi — shuning uchun dump kam chaqiriladi
  async dump() {
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
    const bad = this.nodes.find((n) => (FORBIDDEN.includes(n.text) || FORBIDDEN.includes(n.desc)) && x >= n.x1 - 40 && x <= n.x2 + 40 && y >= n.y1 - 60 && y <= n.y2 + 60);
    if (bad) throw new Error(`XAVFSIZLIK: "${bad.text || bad.desc}" tugmasi ustiga bosish taqiqlangan`);
  }
  async tapNode(n) {
    if (FORBIDDEN.includes(n.text) || FORBIDDEN.includes(n.desc)) throw new Error(`XAVFSIZLIK: "${n.text}" bosilmaydi`);
    this.guard(n.cx, n.cy);
    await this.shell(`input tap ${n.cx} ${n.cy}`);
  }
  // cached: oxirgi dumpda bo'lsa qayta dump qilmaydi (dump ~2 s oladi)
  async tap(t, { nth = 1, timeout = 8000, filter, cached = false } = {}) {
    if (FORBIDDEN.includes(t)) throw new Error(`XAVFSIZLIK: "${t}" bosilmaydi`);
    const n = (cached && this.all(t).filter(filter || (() => true))[nth - 1]) || await this.waitFor(t, { timeout, nth, filter });
    await this.tapNode(n);
    return n;
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
  async keyboardShown() { return /mInputShown=true/.test(await this.shell('dumpsys input_method')); }
  async hideKeyboard() { if (await this.keyboardShown()) { await this.key(4); await sleep(250); } }
  // Bitta shell chaqiruvida: bosish, tozalash, yozish (har adb chaqiruvi ~80 ms)
  async typeInto(n, value) {
    if (FORBIDDEN.includes(n.text)) throw new Error(`XAVFSIZLIK: "${n.text}" bosilmaydi`);
    this.guard(n.cx, n.cy);
    const v = String(value).replace(/[^0-9.]/g, '');
    await this.shell(`input tap ${n.cx} ${n.cy}; sleep 0.3; input keyevent KEYCODE_MOVE_END; input keyevent ${Array(12).fill('KEYCODE_DEL').join(' ')}; input text ${v}`);
    await sleep(100);
    await this.hideKeyboard();
  }
  async size() {
    const m = (await this.shell('wm size')).match(/(\d+)x(\d+)/);
    return { w: +m[1], h: +m[2] };
  }
  // Emulator GPS'ini qo'yadi va qurilma shu nuqtani olganini tekshiradi (geo fix: avval uzunlik, keyin kenglik)
  async geo(lat, lon) {
    if (!this.emulator) return null;
    await this.adb(['emu', 'geo', 'fix', String(lon), String(lat)]);
    let got = null;
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      got = await this.location();
      if (got && Math.abs(got.lat - lat) < 1e-3 && Math.abs(got.lon - lon) < 1e-3) return got;
    }
    throw new Error(`Emulator GPS o'rnatilmadi: kutilgan ${lat}, ${lon}, qurilmada ${got ? `${got.lat}, ${got.lon}` : "yo'q"}`);
  }
  async location() {
    const m = (await this.shell('dumpsys location | grep -m1 "last location=Location\\[gps" || true')).match(/gps (-?[\d.]+),(-?[\d.]+)/);
    return m ? { lat: +m[1], lon: +m[2] } : null;
  }
}

module.exports = { Device, listDevices, sleep, run, FORBIDDEN };
