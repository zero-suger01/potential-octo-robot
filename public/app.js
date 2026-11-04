// Tomorqa bot — UI mantiqi
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEPS = ['Маълумот', 'Экин майдони', 'Сув таъминоти', 'Экинлар', 'Тасдиқлаш'];
const FIELDS = ['photosDir', 'limit', 'lat', 'lon', 'reviewSec', 'ghEvery', 'treeEvery'];

const S = { devices: [], avds: [], serial: '', season: 'Тўқсонбости', photos: 0, running: false, busy: false,
  ok: 0, fail: 0, times: [], limit: 0, i: 0, runId: null, step: 0, savedAvd: '' };

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast glass-popover animate-float-in ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('tomorqa:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('tomorqa:' + k, JSON.stringify(v)); } catch {} },
};
const fmtSec = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} daq` : `${(s / 3600).toFixed(1)} soat`);

// ---------- mavzu ----------
$('theme').onclick = () => {
  const dark = document.documentElement.classList.toggle('dark');
  store.set('theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
};

// ---------- qurilmalar ----------
const ICON = {
  emu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
};
async function loadDevices() {
  try {
    const r = await api('/api/devices');
    S.devices = r.devices.filter((d) => d.state === 'device');
    S.avds = r.avds;
  } catch (e) { toast('Qurilmalar ro\'yxati olinmadi: ' + e.message, 'error'); }
  if (!S.devices.some((d) => d.serial === S.serial)) S.serial = S.devices[0]?.serial || '';
  renderDevices();
  validate();
  refreshScreen();
}
function renderDevices() {
  const box = $('devices');
  if (!S.devices.length) {
    box.innerHTML = `<div class="empty glass-well small muted">Qurilma topilmadi. Emulatorni ishga tushiring yoki telefonni USB orqali ulang (Developer options → USB debugging).</div>`;
  } else {
    box.innerHTML = S.devices.map((d) => {
      const sub = d.emulator
        ? (d.camOk ? '<span class="tag ok" style="padding:0">● Kamera papkadan oladi</span>' : '<span class="tag warn" style="padding:0">● Kamera papkaga ulanmagan</span>')
        : '<span class="muted">Rasmni telefonda o\'zingiz olasiz</span>';
      return `<button class="dev ${d.serial === S.serial ? 'glass-chosen' : ''}" data-serial="${esc(d.serial)}">${d.emulator ? ICON.emu : ICON.phone}
        <span class="grow"><b>${esc(d.emulator ? (d.avd || 'Emulator') : (d.model || 'Telefon').replace(/_/g, ' '))}</b><span class="small">${sub}</span></span></button>`;
    }).join('');
    const cur = S.devices.find((d) => d.serial === S.serial);
    if (cur?.emulator && !cur.camOk) {
      box.insertAdjacentHTML('beforeend', `<div class="small muted" style="margin:8px 4px">Emulator oddiy kamera bilan ochilgan. Rasmlar ishlashi uchun uni qayta ishga tushirish kerak.</div>
        <button class="glass-control" id="restartEmu" style="width:100%">Kamera bilan qayta ishga tushirish</button>`);
      $('restartEmu').onclick = () => startEmulator(cur.avd, cur.serial);
    }
  }
  box.querySelectorAll('.dev').forEach((b) => (b.onclick = () => { S.serial = b.dataset.serial; renderDevices(); validate(); refreshScreen(); refreshGeo(); }));
  $('avd').innerHTML = S.avds.map((a) => `<option>${esc(a)}</option>`).join('');
  const want = [S.savedAvd, 'Tomorqa_Play'].find((a) => S.avds.includes(a));
  if (want) $('avd').value = want;
  $('emuBox').hidden = S.devices.some((d) => d.emulator) || !S.avds.length;
}
async function startEmulator(avd, restart) {
  try {
    await api('/api/emulator', { avd, restart });
    toast(restart ? 'Emulator qayta ishga tushirilmoqda… (~1–2 daqiqa)' : 'Emulator ishga tushirilmoqda… (~1–2 daqiqa)');
    let n = 0;
    const t = setInterval(async () => { await loadDevices(); if (S.devices.some((d) => d.emulator && d.camOk) || ++n > 20) clearInterval(t); }, 8000);
  } catch (e) { toast(e.message, 'error'); }
}
$('refresh').onclick = loadDevices;
$('emu').onclick = () => startEmulator($('avd').value);

// ---------- rasmlar ----------
async function checkPhotos() {
  const dir = $('photosDir').value.trim();
  $('thumbs').innerHTML = '';
  S.photos = 0;
  if (!dir) { $('phint').innerHTML = 'Emulatorda har xonadonga papkadan tasodifiy rasm qo\'yiladi.'; validate(); return; }
  try {
    const r = await api('/api/photos', { dir });
    S.photos = r.count;
    $('phint').innerHTML = !r.ok ? '<span class="danger">Papka topilmadi</span>'
      : r.count ? `<span style="color:var(--success)">${r.count} ta rasm</span> <span class="muted">· jpg, png, heic</span>` : '<span class="danger">Papkada rasm yo\'q</span>';
    $('thumbs').innerHTML = r.sample.map((n) => `<img loading="lazy" alt="" src="/api/thumb?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(n)}">`).join('');
  } catch (e) { $('phint').textContent = e.message; }
  validate();
}
$('photosDir').addEventListener('change', () => { saveForm(); checkPhotos(); });
$('pick').onclick = async () => {
  try {
    const { dir } = await api('/api/pick-folder', {});
    if (dir) { $('photosDir').value = dir; saveForm(); checkPhotos(); }
  } catch (e) { toast(e.message, 'error'); }
};

// ---------- sozlamalar ----------
function setSeason(v) {
  S.season = v;
  $('season').querySelectorAll('button').forEach((b) => {
    const on = b.dataset.v === v;
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('glass-chosen', on);
  });
}
$('season').querySelectorAll('button').forEach((b) => (b.onclick = () => { setSeason(b.dataset.v); saveForm(); }));
document.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => {
  $('limit').value = Math.max(1, (+$('limit').value || 1) + +b.dataset.step);
  saveForm();
}));
FIELDS.forEach((f) => $(f).addEventListener('input', saveForm));
function cfg() {
  const c = { serial: S.serial, season: S.season, avd: $('avd').value };
  for (const f of FIELDS) c[f] = $(f).value.trim();
  return c;
}
function saveForm() { store.set('form', cfg()); validate(); }
function applyForm(c) {
  if (!c) return;
  for (const f of FIELDS) if (c[f] != null && c[f] !== '') $(f).value = c[f];
  if (c.season) setSeason(c.season);
  if (c.serial) S.serial = c.serial;
  if (c.avd) S.savedAvd = c.avd;
}

const coord = (v) => { const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : NaN; };
const coordOk = () => { const a = coord($('lat').value), o = coord($('lon').value); return a >= 37 && a <= 46 && o >= 55 && o <= 74; };
function validate() {
  const d = S.devices.find((x) => x.serial === S.serial);
  let why = '';
  if (!d) why = 'Qurilma tanlang';
  else if (d.emulator && !d.camOk) why = 'Emulatorni kamera bilan qayta ishga tushiring';
  else if (d.emulator && !S.photos) why = 'Rasmlar papkasini tanlang';
  else if (!(+$('limit').value >= 1)) why = 'Xonadonlar sonini kiriting';
  else if (d.emulator && !coordOk()) why = 'Joylashuvni kiriting: kenglik 37–46, uzunlik 55–74 (masalan 40.8528 va 71.7758)';
  const blocked = S.running || S.busy;
  $('start').disabled = !!why || blocked;
  $('count').disabled = !d || blocked;
  $('reason').textContent = blocked ? '' : why;
}

// ---------- amallar ----------
$('count').onclick = async () => {
  S.busy = true; validate(); setStatus('Hisoblanmoqda');
  try { await api('/api/count', cfg()); toast('Mahalla holati yangilandi'); } catch (e) { toast(e.message, 'error'); }
  S.busy = false; validate(); setStatus();
};
$('start').onclick = async () => {
  try {
    await api('/api/start', cfg());
    S.ok = 0; S.fail = 0; S.times = []; S.i = 0; S.step = 0;
    $('results').innerHTML = '';
    renderRun();
  } catch (e) { toast(e.message, 'error'); }
};
$('stop').onclick = async () => { await api('/api/stop', {}); toast('Joriy xonadondan keyin to\'xtaydi'); $('stop').disabled = true; };
$('reveal').onclick = () => api('/api/reveal', {}).catch((e) => toast(e.message, 'error'));
$('csv').onclick = () => { if (S.runId) location.href = `/api/report?run=${encodeURIComponent(S.runId)}`; };

// ---------- joylashuv ----------
async function refreshGeo() {
  const el = $('geoNow');
  const d = S.devices.find((x) => x.serial === S.serial);
  $('geoSet').disabled = !d?.emulator || S.running;
  if (!d) return;
  if (!d.emulator) { el.textContent = 'Telefonda — telefonning haqiqiy GPS\'i ishlatiladi.'; el.className = 'small muted'; return; }
  const g = await api(`/api/geo?serial=${encodeURIComponent(S.serial)}`).catch(() => null);
  if (!g?.lat) { el.textContent = 'Emulator joylashuvi o\'qilmadi — «↻ Qo\'yish»ni bosing.'; el.className = 'small warn'; return; }
  const same = Math.abs(g.lat - coord($('lat').value)) < 1e-3 && Math.abs(g.lon - coord($('lon').value)) < 1e-3;
  el.textContent = same ? `✓ Emulatorda hozir: ${g.lat}, ${g.lon} — formadagi nuqta` : `Emulatorda hozir: ${g.lat}, ${g.lon} — formadagidan farq qiladi, «↻ Qo'yish»ni bosing`;
  el.className = same ? 'small ok' : 'small warn';
}
$('geoSet').onclick = async () => {
  $('geoSet').disabled = true;
  try {
    const g = await api('/api/geo', { serial: S.serial, lat: $('lat').value, lon: $('lon').value });
    toast(`Emulator joylashuvi: ${g.lat}, ${g.lon}`);
  } catch (e) { toast(e.message, 'error'); }
  await refreshGeo();
};
['lat', 'lon'].forEach((f) => $(f).addEventListener('change', refreshGeo));

// ---------- holat ko'rinishi ----------
function setStatus(text) {
  const el = $('status');
  if (S.running) {
    const t = text || (S.i ? `#${S.i} / ${S.limit} · ${STEPS[S.step - 1] || 'ochilmoqda'}` : 'Tayyorlanmoqda');
    el.innerHTML = `<span class="dot-loader" style="color:var(--status-running)"><i></i><i></i><i></i></span><span class="status-shimmer">${esc(t)}</span>`;
  } else if (text) {
    el.innerHTML = `<span class="dot-loader"><i></i><i></i><i></i></span><span class="status-shimmer">${esc(text)}</span>`;
  } else el.innerHTML = '<span class="muted">Tayyor</span>';
}
function renderRun() {
  const n = S.ok + S.fail;
  const avg = S.times.length ? S.times.reduce((a, b) => a + b, 0) / S.times.length : 0;
  $('kOk').textContent = S.ok;
  $('kFail').textContent = S.fail;
  $('kAvg').textContent = avg ? fmtSec(avg) : '—';
  $('kEta').textContent = S.running && avg && S.limit ? fmtSec(avg * Math.max(0, S.limit - n)) : '—';
  $('pBar').style.width = S.limit ? `${Math.min(100, (n / S.limit) * 100)}%` : '0';
  $('pBar').classList.toggle('progress-glow', S.running);
  $('runTitle').innerHTML = S.running
    ? (S.i ? `Xonadon <b>${S.i}</b> / ${S.limit}` : 'Аҳоли томорқаси ochilmoqda…')
    : n ? `Tugadi: <b>${S.ok}</b> muvaffaqiyatli${S.fail ? `, <span class="danger">${S.fail} xato</span>` : ''}` : 'Ish boshlanmagan';
  $('stop').hidden = !S.running;
  $('stop').disabled = false;
  $('steps').innerHTML = STEPS.map((s, k) => {
    const cls = !S.running || !S.step ? '' : k + 1 < S.step ? 'done' : k + 1 === S.step ? 'now glass-chosen' : '';
    return `<div class="${cls}"><span>${k + 1}</span>${k + 1 === S.step && S.running ? `<span class="status-shimmer" style="display:inline;font-weight:400">${s}</span>` : s}</div>`;
  }).join('');
  setStatus();
  validate();
}
function addResult(ev) {
  const box = $('results');
  if (box.querySelector('.empty')) box.innerHTML = '';
  const p = ev.plan || {};
  const chips = [
    ...(p.crops || []).map((c) => `<span class="chip glass-control" title="${esc(c.date)}">${esc(c.name)} · ${esc(c.area)}</span>`),
    p.greenhouse ? `<span class="chip glass-control gh" title="${esc(`${p.greenhouse.heating}, ${p.greenhouse.cover}, ${p.greenhouse.built}`)}">Issiqxona: ${esc(p.greenhouse.crop)} · ${esc(p.greenhouse.area)}</span>` : '',
    ...(p.trees || []).map((t) => `<span class="chip glass-control tree" title="${esc(t.age)} yosh">${esc(t.name)} ${esc(t.count)} dona · ${esc(t.area)}</span>`),
  ].join('');
  const html = ev.ok
    ? `<div class="res glass-control animate-float-in"><div class="res-head"><b>#${ev.i}</b><span class="muted">umumiy ${esc(p.total)} · ochiq ${esc(p.open)} · ekin <b>${esc(p.cropArea)}</b> sotix</span><span class="muted small" style="margin-left:auto">${fmtSec(ev.sec)}</span></div>
       <div class="chips">${chips}</div><div class="small muted" style="margin-top:6px">Suv: ${esc((p.water || []).join(' · '))}</div></div>`
    : `<div class="res glass-control fail animate-float-in"><div class="res-head"><b>#${ev.i}</b><span>Xato</span><span class="muted small" style="margin-left:auto">${fmtSec(ev.sec)}</span></div><div class="err">${esc(ev.error)}</div></div>`;
  box.insertAdjacentHTML('afterbegin', html);
}
function setStats(ev) {
  $('sDone').textContent = ev.done ?? '—';
  $('sTodo').textContent = ev.todo ?? '—';
  $('sTotal').textContent = ev.total ?? '—';
  $('sBar').style.width = ev.total ? `${(ev.done / ev.total) * 100}%` : '0';
  $('statsAt').textContent = `yangilandi ${new Date().toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- jonli hodisalar ----------
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    switch (ev.type) {
      case 'gps': toast(`Emulator joylashuvi: ${ev.lat}, ${ev.lon}`); refreshGeo(); break;
      case 'log': if (ev.level === 'error' && S.running && Date.now() - ev.t < 5000) toast(ev.msg, 'error'); break;
      case 'running': S.running = ev.running; if (!ev.running) S.step = 0; renderRun(); break;
      case 'run': S.runId = ev.runId; $('csv').disabled = false; break;
      case 'stats': setStats(ev); break;
      case 'progress': S.i = ev.i; S.limit = ev.limit; S.step = 1; renderRun(); break;
      case 'stage': S.step = ev.step; renderRun(); break;
      case 'household': ev.ok ? S.ok++ : S.fail++; if (ev.sec) S.times.push(ev.sec); addResult(ev); renderRun(); break;
      case 'done': S.runId = ev.runId; toast(`Tugadi: ${ev.ok} muvaffaqiyatli, ${ev.fail} xato`); break;
    }
  };
  es.onerror = () => { setStatus('Server bilan aloqa uzildi — qayta ulanmoqda'); };
  es.onopen = () => setStatus();
}

// ---------- ekran ----------
let scrBusy = false;
function refreshScreen(force = true) {
  if (!S.serial || scrBusy || (!force && document.hidden)) return;
  scrBusy = true;
  const img = new Image();
  img.onload = () => { $('scr').src = img.src; scrBusy = false; $('scrHint').textContent = new Date().toLocaleTimeString('uz'); };
  img.onerror = () => { scrBusy = false; };
  img.src = `/api/screen?serial=${encodeURIComponent(S.serial)}&t=${Date.now()}`;
}
$('scrBtn').onclick = () => refreshScreen();
setInterval(() => { if (S.running || S.busy) refreshScreen(false); }, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshScreen(); });

// ---------- boshlash ----------
(async () => {
  const server = await api('/api/config').catch(() => ({}));
  applyForm(Object.assign({}, server, store.get('form') || {}));
  if (!S.season) setSeason('Тўқсонбости'); else setSeason(S.season);
  renderRun();
  connect();
  await loadDevices();
  checkPhotos();
  refreshGeo();
})();
