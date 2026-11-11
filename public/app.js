// Tomorqa bot — UI mantiqi
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEPS = ['Маълумот', 'Экин майдони', 'Сув таъминоти', 'Экинлар', 'Тасдиқлаш'];
const FIELDS = ['limit', 'submitWaitSec', 'ghEvery', 'treeEvery', 'campaign', 'operator', 'autoSubmitDelayMin', 'autoSubmitDelayMax'];

const S = { devices: [], serial: '', season: 'Тўқсонбости', running: false, busy: false,
  ok: 0, fail: 0, skip: 0, times: [], limit: 0, i: 0, runId: null, step: 0, awaiting: null, left: 0 };

// Xatlov raqamini sana bo'yicha aniqlash (UI yorlig'i uchun; serverdagi hisobga teng)
function autoCampaign(d = new Date()) {
  const m = d.getMonth() + 1;
  if (m <= 4) return 1;
  if (m <= 8) return 2;
  return 3;
}
function campaignLabel() {
  const v = +$('campaign').value || 0;
  const n = v || autoCampaign();
  return `${new Date().getFullYear()}-yilning ${n}-xatlovi`;
}

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
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
};
async function loadDevices() {
  try {
    const r = await api('/api/devices');
    S.devices = r.devices.filter((d) => d.state === 'device');
  } catch (e) { toast('Qurilmalar ro\'yxati olinmadi: ' + e.message, 'error'); }
  if (!S.devices.some((d) => d.serial === S.serial)) S.serial = S.devices[0]?.serial || '';
  renderDevices();
  validate();
  refreshScreen();
}
function renderDevices() {
  const box = $('devices');
  if (!S.devices.length) {
    box.innerHTML = `<div class="empty glass-well small muted">Qurilma topilmadi. Planshetni USB orqali ulang (Developer options → USB debugging).</div>`;
  } else {
    box.innerHTML = S.devices.map((d) => {
      return `<button class="dev ${d.serial === S.serial ? 'glass-chosen' : ''}" data-serial="${esc(d.serial)}">${ICON.phone}
        <span class="grow"><b>${esc((d.model || 'Planshet').replace(/_/g, ' '))}</b><span class="small"><span class="muted">Rasmni planshetda o'zingiz olasiz</span></span></span></button>`;
    }).join('');
  }
  box.querySelectorAll('.dev').forEach((b) => (b.onclick = () => { S.serial = b.dataset.serial; renderDevices(); validate(); refreshScreen(); }));
}
$('refresh').onclick = loadDevices;

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
const CHECKS = ['autoPhoto', 'autoSubmit']; // mustaqil ikki toggle (checkbox)
FIELDS.forEach((f) => $(f).addEventListener('input', saveForm));
CHECKS.forEach((f) => $(f).addEventListener('change', saveForm));
function cfg() {
  const c = { serial: S.serial, season: S.season };
  for (const f of FIELDS) c[f] = $(f).value.trim();
  for (const f of CHECKS) c[f] = $(f).checked;
  return c;
}
function saveForm() { store.set('form', cfg()); validate(); }
function applyForm(c) {
  if (!c) return;
  for (const f of FIELDS) if (c[f] != null && c[f] !== '') $(f).value = c[f];
  for (const f of CHECKS) if (typeof c[f] === 'boolean') $(f).checked = c[f];
  if (c.season) setSeason(c.season);
  if (c.serial) S.serial = c.serial;
}

function validate() {
  const d = S.devices.find((x) => x.serial === S.serial);
  let why = '';
  if (!d) why = 'Qurilma tanlang';
  else if (!(+$('limit').value >= 1)) why = 'Xonadonlar sonini kiriting';
  const mi = +$('autoSubmitDelayMin').value || 0, ma = +$('autoSubmitDelayMax').value || 0;
  if (!why && mi > ma) why = 'AUTO_SUBMIT min max dan katta';
  if (!why && !$('operator').value.trim()) $('reason').textContent = 'Operator bo\'sh — hisobot saqlanmaydi (ixtiyoriy)';
  const blocked = S.running || S.busy;
  $('start').disabled = !!why || blocked;
  $('count').disabled = !d || blocked;
  if (why || blocked) $('reason').textContent = blocked ? '' : why;
  $('curYear').textContent = new Date().getFullYear();
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
    S.ok = 0; S.fail = 0; S.skip = 0; S.times = []; S.i = 0; S.step = 0; S.awaiting = null;
    $('results').innerHTML = '';
    renderRun();
  } catch (e) { toast(e.message, 'error'); }
};
$('stop').onclick = async () => { await api('/api/stop', {}); toast('Joriy xonadondan keyin to\'xtaydi'); $('stop').disabled = true; };
$('reveal').onclick = () => api('/api/reveal', {}).catch((e) => toast(e.message, 'error'));
$('csv').onclick = () => { if (S.runId) location.href = `/api/report?run=${encodeURIComponent(S.runId)}`; };

// ---------- holat ko'rinishi ----------
function setStatus(text) {
  const el = $('status');
  if (S.running) {
    const t = text || (S.awaiting ? `#${S.awaiting.i} · «Юбориш»ni o'zingiz bosing` : S.i ? `#${S.i} / ${S.limit} · ${STEPS[S.step - 1] || 'ochilmoqda'}` : 'Tayyorlanmoqda');
    el.innerHTML = `<span class="dot-loader" style="color:var(--status-running)"><i></i><i></i><i></i></span><span class="status-shimmer">${esc(t)}</span>`;
  } else if (text) {
    el.innerHTML = `<span class="dot-loader"><i></i><i></i><i></i></span><span class="status-shimmer">${esc(text)}</span>`;
  } else el.innerHTML = '<span class="muted">Tayyor</span>';
}
function renderRun() {
  const n = S.ok + S.fail + S.skip;
  const avg = S.times.length ? S.times.reduce((a, b) => a + b, 0) / S.times.length : 0;
  $('kOk').textContent = S.ok;
  $('kLimit').textContent = S.limit || '—';
  $('kLeft').textContent = Math.max(0, S.limit - n);
  $('kSkip').textContent = S.skip;
  $('kFail').textContent = S.fail;
  $('kAvg').textContent = avg ? fmtSec(avg) : '—';
  $('kEta').textContent = S.running && avg && S.limit ? fmtSec(avg * Math.max(0, S.limit - n)) : '—';
  $('pBar').style.width = S.limit ? `${Math.min(100, (n / S.limit) * 100)}%` : '0';
  $('pBar').classList.toggle('progress-glow', S.running);
  $('runTitle').innerHTML = S.running
    ? (S.awaiting ? `#${S.awaiting.i} tayyor — <b>«Юбориш»ni qurilmada o'zingiz bosing</b>` : S.i ? `Xonadon <b>${S.i}</b> / ${S.limit} · ${campaignLabel()}` : `Аҳоли томорқаси ochilmoqda… · ${campaignLabel()}`)
    : n ? `Tugadi: <b>${S.ok}</b> yuborildi${S.skip ? `, ${S.skip} bekor` : ''}${S.fail ? `, <span class="danger">${S.fail} xato</span>` : ''}` : 'Ish boshlanmagan';
  const aw = $('await');
  aw.hidden = !(S.running && S.awaiting);
  if (S.awaiting) aw.querySelector('b').textContent = `«Юбориш» bosilishini kutmoqda${S.awaiting.i ? ` — #${S.awaiting.i}` : ''}${S.awaiting.waited ? ` · ${fmtSec(S.awaiting.waited)}` : ''}`;
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
  const secs = `<span class="muted small" style="margin-left:auto">${fmtSec(ev.sec)}</span>`;
  let html;
  if (ev.error) {
    html = `<div class="res glass-control fail animate-float-in"><div class="res-head"><b>#${ev.i}</b><span>Xato</span>${secs}</div><div class="err">${esc(ev.error)}</div></div>`;
  } else {
    const ok = ev.submit === 'submitted';
    const badge = ok ? '<span class="tag ok" style="padding:0">✓ yuborildi</span>'
      : `<span class="tag warn" style="padding:0">${ev.submit === 'discarded' ? '⚠ bekor qilindi' : '⌛ kutilmadi'}</span>`;
    html = `<div class="res glass-control animate-float-in"${ok ? '' : ' style="opacity:.72"'}>
      <div class="res-head"><b>#${ev.i}</b>${badge}<span class="muted">umumiy ${esc(p.total)} · ochiq ${esc(p.open)} · ekin <b>${esc(p.cropArea)}</b> sotix</span>${secs}</div>
       <div class="chips">${chips}</div><div class="small muted" style="margin-top:6px">Suv: ${esc((p.water || []).join(' · '))}</div></div>`;
  }
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
      case 'log': if (ev.level === 'error' && S.running && Date.now() - ev.t < 5000) toast(ev.msg, 'error'); break;
      case 'running': S.running = ev.running; if (!ev.running) { S.step = 0; S.awaiting = null; } renderRun(); break;
      case 'run': S.runId = ev.runId; $('csv').disabled = false; break;
      case 'stats': setStats(ev); break;
      case 'progress': S.i = ev.i; S.limit = ev.limit; S.step = 1; S.awaiting = null; renderRun(); break;
      case 'counts': S.limit = ev.limit; renderRun(); break;
      case 'stage': S.step = ev.step; renderRun(); break;
      case 'awaiting': S.awaiting = ev; S.step = 5; renderRun(); toast(`#${ev.i}: forma tayyor — «Юбориш»ni o'zingiz bosing`); break;
      case 'household':
        if (ev.error) S.fail++; else if (ev.submit === 'submitted') S.ok++; else S.skip++;
        S.awaiting = null;
        if (ev.sec) S.times.push(ev.sec);
        addResult(ev); renderRun(); break;
      case 'done': S.runId = ev.runId; toast(`Tugadi: ${ev.ok} yuborildi${ev.skip ? `, ${ev.skip} bekor` : ''}, ${ev.fail} xato`); break;
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
})();
