// Lokal server + UI: http://localhost:4173. Odatda desktop ilova ichida ishlaydi (npm start); faqat brauzerda: npm run web
const http = require('http');
const fs = require('fs');
const path = require('path');
const { listDevices, Device } = require('./lib/adb');
const { Bot } = require('./lib/bot');
const { DATA, RUNS, openExternal } = require('./lib/platform');

const PORT = +process.env.PORT || 4173;
const CFG_FILE = path.join(DATA, 'config.json');
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

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

const body = (req) => new Promise((res) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
});
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };

const routes = {
  'GET /api/devices': async () => {
    // Faqat USB orqali ulangan haqiqiy qurilmalar (emulatorlar ko'rsatilmaydi)
    const devices = (await listDevices().catch(() => [])).filter((d) => !d.emulator);
    return { devices, running: !!bot, busy: !!busy };
  },
  'GET /api/config': async () => JSON.parse(fs.existsSync(CFG_FILE) ? fs.readFileSync(CFG_FILE, 'utf8') : '{}'),
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
    if (new Device(b.serial).emulator) throw new Error('Emulator qo\'llab-quvvatlanmaydi — planshetni USB orqali ulang');
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(b, null, 1));
    bot = new Bot({
      serial: b.serial, limit: +b.limit || 1, season: b.season,
      submitWaitSec: Math.max(0, +b.submitWaitSec || 0), ghEvery: +b.ghEvery || 20, treeEvery: +b.treeEvery || 10,
      // Ikki mustaqil toggle (UI checkbox). Berilmasa env standart (AUTO_PHOTO / AUTO_SUBMIT).
      autoPhoto: b.autoPhoto != null ? !!b.autoPhoto : undefined,
      autoSubmit: b.autoSubmit != null ? !!b.autoSubmit : undefined,
      // AUTO_SUBMIT tasodifiy kutish oralig'i (soniya) — bir xil vaqtda joylantirish bo'lmasin
      autoSubmitDelayMin: Math.max(0, +b.autoSubmitDelayMin || 3),
      autoSubmitDelayMax: Math.max(0, +b.autoSubmitDelayMax || 8),
      // Operator profili — reports/<yil>/<n>-xatlov/<operator>.xlsx uchun
      operator: String(b.operator || '').trim(),
      // Xatlov: 1|2|3 qo'lda tanlangan, 0/bo'sh — sanadan avtomatik
      campaign: +b.campaign || 0,
    }, emit);
    emit({ type: 'running', running: true });
    bot.run().finally(() => { bot = null; emit({ type: 'running', running: false }); });
    return { ok: true };
  },
  'POST /api/stop': async () => { bot?.stop(); return { ok: true }; },
  'POST /api/reveal': async () => { fs.mkdirSync(RUNS, { recursive: true }); openExternal(RUNS); return { ok: true }; },
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
  if (!process.env.NO_OPEN) openExternal(`http://localhost:${PORT}`);
});
