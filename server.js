// Lokal web UI: http://localhost:4173  (npm start)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { listDevices, Device, run: adb } = require('./lib/adb');
const { Bot, CAMFEED } = require('./lib/bot');

const PORT = +process.env.PORT || 4173;
const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const EMULATOR = path.join(SDK, 'emulator/emulator');
const CFG_FILE = path.join(__dirname, 'data', 'config.json');
const RUNS = path.join(__dirname, 'runs');
const IMG_RE = /\.(jpe?g|png|heic|webp)$/i;
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
// "40.8528", "40,8528", "40.8528° N" -> 40.8528
const coord = (v) => { const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
// O'zbekiston chegarasi: kenglik 37–46 N, uzunlik 55–74 E (almashib qolsa ham ushlanadi)
function coords(b) {
  const lat = coord(b.lat), lon = coord(b.lon);
  if (lat == null || lon == null || lat < 37 || lat > 46 || lon < 55 || lon > 74) {
    throw new Error(`Joylashuv noto'g'ri: kenglik ${b.lat || '—'}, uzunlik ${b.lon || '—'} (masalan 40.8528 va 71.7758)`);
  }
  return { lat, lon };
}
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
let photosDir = null; // eskizlar faqat shu (UI tanlagan) papkadan beriladi

const clients = new Set();
const history = [];
let bot = null;
let busy = null; // "Hisoblash" kabi qisqa ishlar

function emit(ev) {
  history.push(ev);
  if (history.length > 3000) history.splice(0, 1000);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(line);
}
const exec = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 120000 }, (e, out) => res(e ? '' : String(out))));

const body = (req) => new Promise((res) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
});
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };

const listAvds = async () => (await exec(EMULATOR, ['-list-avds'])).split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('INFO'));
const photoList = (dir) => (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => IMG_RE.test(f) && !f.startsWith('.')) : []);

// Emulator rasmni papkadan oladimi: AVD jarayoni `-camera-back imagefile:` bilan ishga tushganmi
async function emulatorInfo(serial) {
  const avd = (await adb(['-s', serial, 'emu', 'avd', 'name']).catch(() => '')).split('\n')[0].trim();
  const ps = await exec('ps', ['-axww', '-o', 'command=']);
  const line = ps.split('\n').find((l) => l.includes('qemu-system') && l.includes(`-avd ${avd}`)) || '';
  return { avd, camOk: line.includes(`imagefile:${CAMFEED}`) };
}

function startEmulator(avd) {
  fs.mkdirSync(path.dirname(CAMFEED), { recursive: true });
  if (!fs.existsSync(CAMFEED)) fs.copyFileSync(path.join(__dirname, 'public', 'placeholder.png'), CAMFEED);
  // 2 GB RAM'da ilova + uiautomator xotiraga sig'maydi (dump OOM bilan o'ldiriladi) — 4 GB beramiz
  const p = spawn(EMULATOR, ['-avd', avd, '-memory', '4096', '-no-snapshot-save', '-no-boot-anim', '-camera-back', `imagefile:${CAMFEED}`],
    { detached: true, stdio: 'ignore' });
  p.unref();
}

const routes = {
  'GET /api/devices': async () => {
    const devices = await listDevices().catch(() => []);
    for (const d of devices) if (d.emulator && d.state === 'device') Object.assign(d, await emulatorInfo(d.serial));
    return { devices, avds: await listAvds(), running: !!bot, busy: !!busy };
  },
  'GET /api/config': async () => JSON.parse(fs.existsSync(CFG_FILE) ? fs.readFileSync(CFG_FILE, 'utf8') : '{}'),
  'POST /api/emulator': async (b) => {
    if (b.restart) { await adb(['-s', b.restart, 'emu', 'kill']).catch(() => {}); await new Promise((r) => setTimeout(r, 4000)); }
    startEmulator(b.avd);
    return { ok: true };
  },
  'POST /api/photos': async (b) => {
    const files = photoList(b.dir);
    if (files.length) photosDir = path.resolve(b.dir);
    return { ok: !!b.dir && fs.existsSync(b.dir), count: files.length, sample: files.slice(0, 6) };
  },
  'GET /api/thumb': async (b, req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const dir = path.resolve(q.get('dir') || ''), name = path.basename(q.get('name') || '');
    const file = path.join(dir, name);
    if (dir !== photosDir || !IMG_RE.test(name) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return undefined; }
    const out = path.join(os.tmpdir(), `tomorqa-thumb-${Buffer.from(file).toString('base64url').slice(-40)}.jpg`);
    if (!fs.existsSync(out)) await exec('sips', ['-s', 'format', 'jpeg', '-Z', '240', file, '--out', out]);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
    fs.createReadStream(out).pipe(res);
    return undefined;
  },
  'POST /api/pick-folder': async () => {
    const p = (await exec('osascript', ['-e', 'POSIX path of (choose folder with prompt "Tomorqa rasmlari papkasini tanlang")'])).trim();
    return { dir: p.replace(/\/$/, '') };
  },
  'POST /api/count': async (b) => {
    if (bot || busy) throw new Error('Bot band — avval joriy ishni tugating');
    busy = new Bot({ serial: b.serial, season: b.season }, emit);
    try {
      await busy.init();
      await busy.openList();
      const s = await busy.stats();
      emit({ type: 'stats', ...s });
      return s;
    } finally { busy = null; }
  },
  'POST /api/start': async (b) => {
    if (bot || busy) throw new Error('Bot allaqachon ishlayapti');
    if (!b.serial) throw new Error('Qurilma tanlanmagan');
    const { lat, lon } = coords(b);
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(b, null, 1));
    bot = new Bot({
      serial: b.serial, photosDir: b.photosDir, limit: +b.limit || 1, season: b.season,
      lat, lon, reviewSec: +(b.reviewSec ?? 3), ghEvery: +b.ghEvery || 20, treeEvery: +b.treeEvery || 10,
    }, emit);
    emit({ type: 'running', running: true });
    bot.run().finally(() => { bot = null; emit({ type: 'running', running: false }); });
    return { ok: true };
  },
  // Emulatorning hozirgi GPS nuqtasi
  'GET /api/geo': async (b, req) => {
    const d = new Device(new URL(req.url, 'http://x').searchParams.get('serial') || '');
    return d.emulator ? { emulator: true, ...(await d.location()) } : { emulator: false };
  },
  // Formadagi nuqtani emulatorga qo'yish (qurilma qayta o'qib tasdiqlaydi)
  'POST /api/geo': async (b) => {
    if (bot) throw new Error('Bot ishlayapti — joylashuv har xonadon oldidan formadagidan qo\'yiladi');
    const d = new Device(b.serial || '');
    if (!d.emulator) throw new Error('Joylashuvni faqat emulatorda o\'zgartirish mumkin — telefonda haqiqiy GPS');
    const { lat, lon } = coords(b);
    return d.geo(lat, lon);
  },
  'POST /api/stop': async () => { bot?.stop(); return { ok: true }; },
  'POST /api/reveal': async () => { fs.mkdirSync(RUNS, { recursive: true }); spawn('open', [RUNS], { stdio: 'ignore' }); return { ok: true }; },
  'GET /api/report': async (b, req, res) => {
    const id = path.basename(new URL(req.url, 'http://x').searchParams.get('run') || '');
    const file = path.join(RUNS, id, 'report.csv');
    if (!id || !fs.existsSync(file)) { res.writeHead(404); res.end('Hisobot topilmadi'); return undefined; }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tomorqa-${id}.csv"` });
    fs.createReadStream(file).pipe(res);
    return undefined;
  },
  'GET /api/screen': async (b, req, res) => {
    const serial = new URL(req.url, 'http://x').searchParams.get('serial');
    const png = await new Device(serial).screenshot();
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png);
    return undefined;
  },
};

http.createServer(async (req, res) => {
  // DNS rebinding: begona domen 127.0.0.1 ga yo'naltirilsa ham Host sarlavhasi boshqa bo'ladi —
  // aks holda qurilma ekrani (fuqarolar ma'lumoti) va sozlamalar GET orqali o'qilishi mumkin edi
  if (!HOSTS.has(req.headers.host)) { res.writeHead(403); res.end('Forbidden'); return; }
  const url = req.url.split('?')[0];
  if (url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const ev of history.slice(-500)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'running', running: !!bot })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const route = routes[`${req.method} ${url}`];
  if (route) {
    // Boshqa saytlar brauzer orqali lokal API'ni chaqira olmasin (CSRF)
    if (req.method === 'POST' && ((req.headers.origin && !ORIGINS.has(req.headers.origin)) || !/application\/json/.test(req.headers['content-type'] || ''))) {
      return json(res, 403, { error: 'Ruxsat yo\'q' });
    }
    try {
      const out = await route(req.method === 'POST' ? await body(req) : {}, req, res);
      if (out !== undefined) json(res, 200, out);
    } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }
  const rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
  const file = path.resolve(__dirname, 'public', rel);
  if (file.startsWith(path.join(__dirname, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  } else { res.writeHead(404); res.end('404'); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Tomorqa bot UI: http://localhost:${PORT}`);
  if (!process.env.NO_OPEN) spawn('open', [`http://localhost:${PORT}`], { stdio: 'ignore' });
});
