// Desktop ilova: o'sha server.js ni shu jarayon ichida ishga tushiradi va o'sha public/ UI'ni oynada ochadi.
// Mantiq va ko'rinish web versiya bilan 1:1 — farqi faqat brauzer o'rniga Electron oynasi.
//   npm start
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit(); // ikki nusxa bitta qurilmani boshqarmasin

// Qadoqlangan ilovada (.dmg / Windows) ilova papkasi faqat o'qiladi: sozlama va hisobot
// foydalanuvchi papkasida saqlanadi. Birinchi ishga tushishda mahsulot ro'yxatlari keshi nusxalanadi.
if (app.isPackaged) {
  const home = path.join(app.getPath('appData'), 'tomorqa-bot');
  process.env.TOMORQA_HOME = home;
  const lists = path.join(home, 'data', 'lists.json');
  if (!fs.existsSync(lists)) {
    fs.mkdirSync(path.dirname(lists), { recursive: true });
    fs.writeFileSync(lists, fs.readFileSync(path.join(__dirname, '..', 'data', 'lists.json')));
  }
}

// Web versiya (npm run web) 4173 da ishlab turgan bo'lsa — bo'sh portni olamiz
const freePort = (want) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => {
    const r = net.createServer().listen(0, '127.0.0.1', () => { const p = r.address().port; r.close(() => resolve(p)); });
  }).listen(want, '127.0.0.1', () => s.close(() => resolve(want)));
});

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s)); }).on('error', reject);
});

let win = null, base = '', quitting = false;

async function start() {
  const port = await freePort(+process.env.PORT || 4173);
  process.env.PORT = String(port);
  process.env.NO_OPEN = '1';
  require(path.join(__dirname, '..', 'server.js'));
  base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { // server tinglay boshlaguncha
    try { await get(`${base}/api/config`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 900, minHeight: 600,
    title: 'Tomorqa bot', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Faqat lokal UI ochiladi; tashqi havolalar tizim brauzerida
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(base)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(base)) e.preventDefault(); });
  // Bot ishlayotgan bo'lsa — oynani yopishdan oldin so'raymiz (yopilsa bot to'xtaydi, yozuv saqlanmaydi)
  win.on('close', async (e) => {
    if (quitting) return;
    e.preventDefault();
    const st = await get(`${base}/api/devices`).then(JSON.parse).catch(() => ({}));
    if (st.running || st.busy) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Bekor qilish', 'To\'xtatib chiqish'], defaultId: 0, cancelId: 0,
        message: 'Bot hali ishlayapti',
        detail: 'Chiqilsa bot to\'xtaydi, ochiq yozuv saqlanmaydi.',
      });
      if (response !== 1) return;
    }
    quitting = true;
    app.quit();
  });
  win.loadURL(base);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.whenReady().then(start).catch((e) => { dialog.showErrorBox('Tomorqa bot', e.message); app.quit(); });
