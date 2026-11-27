/* Rotina PMSC — app pessoal (rotina editável, estudo, treino, peso e coach) */
'use strict';

const C = window.RotinaCore;

const DEFAULTS = {
  kcalTarget: 3000,
  waterTarget: 3000,
  coffeeMax: 500,
  prova: '2026-12-13',
  provaNome: 'PMSC',
};

const CAT_COLOR = {
  estudo: 'var(--estudo)', refeicao: 'var(--refeicao)', treino: 'var(--treino)', familia: 'var(--familia)',
  leitura: 'var(--leitura)', sono: 'var(--sono)', rotina: 'var(--rotina)',
};

const TPL = Object.fromEntries(C.TEMPLATES.map(([k, short, plural]) => [k, { short, plural }]));

const ICON_EDIT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

// ------------------------------------------------------------------
// Datas
// ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const todayKey = () => dateKey(new Date());
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmtShort = (k) => { const d = parseKey(k); return `${WD[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const fmtDM = (k) => fmtShort(k).slice(5);
const fmtNum = (n, dec = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const weekStart = (k) => { const wd = parseKey(k).getDay(); return addDays(k, wd === 0 ? -6 : 1 - wd); };
const autoType = (k) => C.weekdayKey(k);

// ------------------------------------------------------------------
// Estado
// ------------------------------------------------------------------
const LS_STATE = 'rotina_state_v1';
const LS_AUTH_PENDING = 'rotina_auth_pending';
localStorage.removeItem('rotina_pin'); // versões antigas guardavam o PIN

function emptyState() {
  return { version: 2, updatedAt: 0, settings: { ...DEFAULTS }, templates: C.defaultTemplates(), days: {}, weights: [], coach: { messages: [] } };
}

let state = emptyState();
let current = todayKey();
let tab = 'hoje';
let dirty = false;
let syncTimer = null;
let online = false;
let coachBusy = false;

const LEGACY_TYPES = { terca: 'ter', sabado: 'sab', domingo: 'dom', servico: 'servico' };

// Garante tipos corretos em dados vindos do servidor, do aparelho ou de um backup
// (impede que dados adulterados injetem HTML/script na tela) e migra versões antigas.
function sanitizeState(s) {
  if (!s || typeof s !== 'object' || !s.days || typeof s.days !== 'object') return null;
  const num = (v, d) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
  const defaults = C.defaultTemplates();
  const templates = {};
  for (const k of C.TEMPLATE_KEYS) {
    const list = s.templates && C.sanitizeList(s.templates[k]);
    templates[k] = list || defaults[k];
  }
  const out = {
    version: 2,
    updatedAt: num(s.updatedAt, 0),
    settings: {
      kcalTarget: num(st.kcalTarget, DEFAULTS.kcalTarget),
      waterTarget: num(st.waterTarget, DEFAULTS.waterTarget),
      coffeeMax: num(st.coffeeMax, DEFAULTS.coffeeMax),
      prova: C.isDate(st.prova) ? st.prova : DEFAULTS.prova,
      provaNome: typeof st.provaNome === 'string' ? st.provaNome.slice(0, 40) : DEFAULTS.provaNome,
    },
    templates,
    days: {},
    weights: Array.isArray(s.weights)
      ? s.weights.filter((w) => w && C.isDate(w.date) && Number.isFinite(Number(w.kg))).map((w) => ({ date: w.date, kg: Number(w.kg) }))
      : [],
    coach: { messages: [] },
  };
  for (const [k, d] of Object.entries(s.days)) {
    if (!C.isDate(k) || !d || typeof d !== 'object') continue;
    let type = d.type;
    if (type === 'util') type = autoType(k);
    else if (LEGACY_TYPES[type]) type = LEGACY_TYPES[type];
    if (!C.TEMPLATE_KEYS.includes(type)) type = autoType(k);
    const checks = {};
    if (d.checks && typeof d.checks === 'object') {
      for (const [id, v] of Object.entries(d.checks)) if (/^[\w-]{1,40}$/.test(id) && v) checks[id] = true;
    }
    const times = {};
    if (d.times && typeof d.times === 'object') {
      for (const [id, v] of Object.entries(d.times)) if (/^[\w-]{1,40}$/.test(id) && C.isTime(v)) times[id] = v;
    }
    if (C.isTime(d.wake) && !times.acordar) times.acordar = d.wake; // versão antiga
    const day = { type, checks, times, water: num(d.water, 0), coffee: num(d.coffee, 0), q: num(d.q, ''), a: num(d.a, '') };
    const items = d.items && C.sanitizeList(d.items);
    if (items) day.items = items;
    if (d.coffeeLate) day.coffeeLate = true;
    if (d.checkinSent) day.checkinSent = true;
    if (Number.isInteger(d.dieta) && d.dieta >= 0 && d.dieta <= 10) day.dieta = d.dieta;
    if (Number.isInteger(d.nota) && d.nota >= 0 && d.nota <= 10) day.nota = d.nota;
    if (typeof d.obs === 'string') day.obs = d.obs.slice(0, 1000);
    out.days[k] = day;
  }
  if (s.coach && Array.isArray(s.coach.messages)) {
    out.coach.messages = s.coach.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .slice(-200)
      .map((m) => ({
        role: m.role,
        text: m.text.slice(0, 8000),
        ts: num(m.ts, 0),
        kind: m.kind === 'checkin' ? 'checkin' : undefined,
        changes: Array.isArray(m.changes) ? m.changes.filter((c) => typeof c === 'string').slice(0, 30).map((c) => c.slice(0, 200)) : undefined,
      }));
  }
  return out;
}

// ------------------------------------------------------------------
// Cópia local criptografada (AES-GCM). A chave fica no IndexedDB do
// aparelho como não-exportável: nem o próprio app consegue lê-la em texto.
// ------------------------------------------------------------------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('rotina-sec', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

let localKeyPromise = null;
function getLocalKey() {
  if (!localKeyPromise) {
    localKeyPromise = (async () => {
      let key = await idb('readonly', (st) => st.get('aes'));
      if (!key) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await idb('readwrite', (st) => st.put(key, 'aes'));
      }
      return key;
    })().catch((e) => { localKeyPromise = null; throw e; });
  }
  return localKeyPromise;
}

async function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_STATE));
    if (!raw) return emptyState();
    if (raw.enc) {
      const key = await getLocalKey();
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.data));
      return sanitizeState(JSON.parse(new TextDecoder().decode(plain))) || emptyState();
    }
    state = sanitizeState(raw) || emptyState(); // cópia antiga, sem criptografia
    await saveLocal();
    return state;
  } catch {
    return emptyState();
  }
}

let localChain = Promise.resolve();
function saveLocal() {
  const snapshot = JSON.stringify(state);
  localChain = localChain.then(async () => {
    const key = await getLocalKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(snapshot));
    localStorage.setItem(LS_STATE, JSON.stringify({ enc: 1, iv: b64(iv), data: b64(data) }));
  }).catch(() => {
    localStorage.removeItem(LS_STATE); // sem WebCrypto: não guarda cópia em texto puro
  });
  return localChain;
}

async function wipeLocal() {
  await localChain;
  localStorage.removeItem(LS_STATE);
  localStorage.removeItem(LS_AUTH_PENDING);
  localKeyPromise = null;
  try { await idb('readwrite', (st) => st.delete('aes')); } catch { /* sem IndexedDB */ }
}

function getDay(k) {
  return C.ensureDay(state, k);
}

function save() {
  state.updatedAt = Date.now();
  saveLocal();
  dirty = true;
  setSync('pending');
  clearTimeout(syncTimer);
  if (!coachBusy) syncTimer = setTimeout(push, 800);
}

// ------------------------------------------------------------------
// Sincronização
// ------------------------------------------------------------------
function headers() {
  return { 'Content-Type': 'application/json' };
}

async function push() {
  try {
    const r = await fetch('/api/state', { method: 'PUT', headers: headers(), body: JSON.stringify({ state }), credentials: 'same-origin' });
    if (r.status === 401) { showPin(); return; }
    if (!r.ok) throw new Error();
    dirty = false;
    online = true;
    setSync('ok');
  } catch {
    online = false;
    setSync(dirty ? 'pending' : 'err');
  }
}

async function pull() {
  try {
    const r = await fetch('/api/state', { headers: headers(), credentials: 'same-origin' });
    if (r.status === 401) { showPin(); return false; }
    if (!r.ok) throw new Error();
    const { state: server } = await r.json();
    online = true;
    if (!server || (state.updatedAt || 0) > (server.updatedAt || 0)) {
      await push();
    } else if ((server.updatedAt || 0) > (state.updatedAt || 0)) {
      state = sanitizeState(server) || state;
      saveLocal();
      setSync('ok');
    } else {
      setSync('ok');
    }
    // Dados da versão anterior: grava no servidor já migrados (modelos editáveis etc.)
    if (server && server.version !== 2) save();
    return true;
  } catch {
    online = false;
    setSync(dirty ? 'pending' : 'err');
    return false;
  }
}

function setSync(s) {
  const el = document.getElementById('syncDot');
  el.className = 'sync ' + s;
  el.title = { ok: 'Sincronizado', pending: 'Alterações a enviar', err: 'Offline — salvo no celular' }[s] || '';
}

// ------------------------------------------------------------------
// Login: PIN → (configurar 2FA | código 2FA) → códigos de recuperação
// O passo do 2FA fica salvo no aparelho: se o iPhone recarregar o app ao
// voltar do autenticador, ele continua de onde parou.
// ------------------------------------------------------------------
const $auth = () => document.getElementById('authCard');
let authTicket = null;
let authBusy = false;

function savePending(p) {
  localStorage.setItem(LS_AUTH_PENDING, JSON.stringify({ ...p, exp: Date.now() + 25 * 60 * 1000 }));
}
function loadPending() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_AUTH_PENDING));
    if (p && p.exp > Date.now() && p.ticket) return p;
  } catch { /* nada */ }
  localStorage.removeItem(LS_AUTH_PENDING);
  return null;
}
const clearPending = () => localStorage.removeItem(LS_AUTH_PENDING);

function openAuth() {
  document.body.classList.add('locked');
  document.getElementById('pinModal').classList.remove('hidden');
}

function showPin(msg) {
  authTicket = null;
  clearPending();
  openAuth();
  $auth().innerHTML = `
    <h2>Digite seu PIN</h2>
    <input id="pinInput" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN">
    <label class="remember"><input type="checkbox" id="pinRemember" checked> Lembrar neste aparelho</label>
    <p class="small auth-msg" id="authMsg">${esc(msg || '')}</p>
    <button class="btn primary block" id="authGo">Entrar</button>`;
  bindAuth('pinInput', loginPin);
}

function showCode(msg) {
  openAuth();
  $auth().innerHTML = `
    <h2>Verificação em duas etapas</h2>
    <p class="small muted">Primeiro acesso neste aparelho. Abra o app autenticador, copie o código de 6 dígitos da conta "Rotina" e volte aqui.</p>
    <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="000000">
    <p class="small auth-msg" id="authMsg">${esc(msg || '')}</p>
    <button class="btn primary block" id="authGo">Confirmar</button>
    <p class="small muted" style="margin:10px 0 0">Perdeu o autenticador? Digite um dos códigos de recuperação (ex.: ABCD-EFGH).</p>
    <button class="btn block small" id="authBack" style="margin-top:8px">‹ Voltar</button>`;
  bindAuth('codeInput', verifyCode);
}

function showSetup(data, msg) {
  openAuth();
  $auth().innerHTML = `
    <h2>Ative a verificação em duas etapas</h2>
    <ol class="small setup-steps">
      <li>Toque em <b>Adicionar ao autenticador</b> (abre Ajustes › Senhas no iPhone; também funciona com Google Authenticator ou Authy)
        ou copie a chave e cole no autenticador:
        <code class="secret">${esc(data.secret.replace(/(.{4})/g, '$1 ').trim())}</code>
        <button class="btn small" id="copySecret">Copiar chave</button></li>
      <li>Volte para este app. <b>Se ele reiniciar, tudo bem:</b> esta tela continua daqui, com a mesma chave.</li>
      <li>Digite o código de 6 dígitos que aparece no autenticador.</li>
    </ol>
    <a class="btn block" href="${esc(data.uri)}">Adicionar ao autenticador</a>
    <div style="height:10px"></div>
    <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
    <p class="small auth-msg" id="authMsg">${esc(msg || '')}</p>
    <button class="btn primary block" id="authGo">Ativar</button>
    <button class="btn block small" id="authBack" style="margin-top:8px">‹ Voltar</button>`;
  document.getElementById('copySecret').onclick = () => copyText(data.secret, 'Chave copiada');
  bindAuth('codeInput', verifyCode, false);
}

function showRecovery(codes) {
  openAuth();
  $auth().innerHTML = `
    <h2>Guarde seus códigos de recuperação</h2>
    <p class="small muted">Se perder o celular ou o autenticador, cada código abaixo permite entrar <b>uma vez</b>.
      Guarde num lugar seguro (gerenciador de senhas ou papel). Eles não serão mostrados de novo.</p>
    <pre class="checkin recovery">${codes.map(esc).join('\n')}</pre>
    <button class="btn block" id="copyCodes">Copiar códigos</button>
    <div style="height:8px"></div>
    <button class="btn primary block" id="authDone">Já guardei</button>`;
  document.getElementById('copyCodes').onclick = () => copyText(codes.join('\n'), 'Códigos copiados');
  document.getElementById('authDone').onclick = () => { if (confirm('Confirma que guardou os códigos?')) afterLogin(); };
}

function bindAuth(inputId, action, focus = true) {
  const input = document.getElementById(inputId);
  if (focus) setTimeout(() => { if (input.isConnected) input.focus(); }, 50);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') action(); });
  document.getElementById('authGo').onclick = action;
  const back = document.getElementById('authBack');
  if (back) back.onclick = () => showPin();
}

function authMsg(msg) {
  const el = document.getElementById('authMsg');
  if (el) el.textContent = msg;
}

function hidePin() {
  document.body.classList.remove('locked');
  document.getElementById('pinModal').classList.add('hidden');
  $auth().innerHTML = '';
}

async function copyText(txt, ok) {
  try { await navigator.clipboard.writeText(txt); toast(ok); } catch { toast('Não foi possível copiar'); }
}

const FATAL_MSG = {
  no_pin: 'Servidor sem PIN configurado (variável APP_PIN).',
  no_key: 'Servidor sem chave de criptografia (variável DATA_KEY).',
  bad_key: 'A DATA_KEY do servidor não abre os dados salvos. Restaure a chave correta no Railway.',
};

async function checkAuth() {
  try {
    const r = await fetch('/api/auth', { credentials: 'same-origin' });
    const a = await r.json();
    if (r.status === 503) { showPin(FATAL_MSG[a.error] || 'Servidor indisponível.'); return false; }
    if (a.ok) { clearPending(); return true; }
    // Continua um 2FA em andamento (ex.: o iPhone recarregou o app ao voltar do autenticador)
    const p = loadPending();
    if (p) {
      authTicket = p.ticket;
      if (p.step === 'setup') showSetup(p); else showCode();
      return false;
    }
    showPin();
    return false;
  } catch {
    return true; // offline: segue com os dados do aparelho
  }
}

function fmtWait(sec) {
  return sec >= 3600 ? `${Math.ceil(sec / 3600)} h` : sec >= 60 ? `${Math.ceil(sec / 60)} min` : `${sec} s`;
}

async function authPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: headers(), credentials: 'same-origin', body: JSON.stringify(body) });
  return { r, a: await r.json().catch(() => ({})) };
}

function authError(r, a, what) {
  if (r.status === 429) return `Muitas tentativas erradas. Tente de novo em ${fmtWait(a.retryAfter || 900)}.`;
  if (r.status === 503) return FATAL_MSG[a.error] || 'Servidor indisponível.';
  if (r.status === 401 && (a.error === 'pin' || a.error === 'code')) {
    return `${what} incorreto.` + (a.attemptsLeft > 0 ? ` ${a.attemptsLeft} tentativa(s) antes do bloqueio.` : '');
  }
  return 'Erro ao entrar. Tente de novo.';
}

async function withBusy(fn) {
  if (authBusy) return;
  authBusy = true;
  const go = document.getElementById('authGo');
  if (go) go.disabled = true;
  try { await fn(); } catch { authMsg('Sem internet. Conecte-se para entrar.'); }
  finally {
    authBusy = false;
    const g = document.getElementById('authGo');
    if (g) g.disabled = false;
  }
}

function loginPin() {
  return withBusy(async () => {
    const pin = document.getElementById('pinInput').value.trim();
    const remember = document.getElementById('pinRemember').checked;
    if (!pin) return;
    const { r, a } = await authPost('/api/login', { pin, remember });
    if (r.ok && a.ok) return afterLogin();
    if (r.ok && a.step === 'code') { authTicket = a.ticket; savePending({ step: 'code', ticket: a.ticket }); return showCode(); }
    if (r.ok && a.step === 'setup') {
      authTicket = a.ticket;
      savePending({ step: 'setup', ticket: a.ticket, secret: a.secret, uri: a.uri });
      return showSetup(a);
    }
    authMsg(authError(r, a, 'PIN'));
    document.getElementById('pinInput').value = '';
  });
}

function verifyCode() {
  return withBusy(async () => {
    const code = document.getElementById('codeInput').value.trim();
    if (!code) return;
    const { r, a } = await authPost('/api/login/verify', { ticket: authTicket, code });
    if (r.ok && a.ok) {
      clearPending();
      if (a.recoveryCodes) return showRecovery(a.recoveryCodes);
      if (a.recoveryLeft != null) toast(`Código de recuperação usado. Restam ${a.recoveryLeft}.`);
      return afterLogin();
    }
    if (a.error === 'ticket') return showPin('O tempo para o código acabou. Digite o PIN de novo (a chave do autenticador continua a mesma).');
    if (r.status === 429) return showPin(authError(r, a));
    authMsg(authError(r, a, 'Código'));
    document.getElementById('codeInput').value = '';
  });
}

async function afterLogin() {
  hidePin();
  await pull();
  render();
  autoCheckin();
}

// Sair: envia o que falta, encerra a sessão e apaga a cópia dos dados deste aparelho
async function logout(all) {
  const msg = all
    ? 'Sair de TODOS os aparelhos? Todos vão pedir PIN e código do autenticador de novo. Os dados deste aparelho serão apagados (continuam no servidor).'
    : 'Sair deste aparelho? Os dados daqui serão apagados (continuam no servidor) e o PIN será pedido de novo.';
  if (!confirm(msg)) return;
  if (dirty) await push();
  if (dirty && !confirm('Há alterações que ainda não foram enviadas ao servidor e serão perdidas. Sair mesmo assim?')) return;
  try {
    await fetch(all ? '/api/logout-all' : '/api/logout', { method: 'POST', headers: headers(), credentials: 'same-origin' });
  } catch { /* offline: o cookie expira sozinho */ }
  await wipeLocal();
  state = emptyState();
  dirty = false;
  setTab('hoje');
  showPin();
}

// ------------------------------------------------------------------
// Cálculos
// ------------------------------------------------------------------
const itemsOf = (k) => C.itemsFor(state, k);
const doneTime = (day, i) => (day.times && day.times[i.id]) || i.t;

function dayStats(k) {
  const day = state.days[k];
  if (!day) return null;
  const items = itemsOf(k);
  const checkable = items.filter((i) => !i.info && !i.optional);
  const done = checkable.filter((i) => day.checks[i.id]).length;
  let kcal = 0, kcalPlan = 0, studyDone = 0, studyPlan = 0, leitura = 0, mealsDone = 0, mealsTotal = 0;
  let treinoPlan = 0, treinoDone = 0, familia = false;
  for (const i of items) {
    const on = !!day.checks[i.id];
    if (i.cat === 'refeicao') {
      mealsTotal++;
      kcalPlan += i.kcal || 0;
      if (on) { kcal += i.kcal || 0; mealsDone++; }
    }
    if (i.cat === 'estudo') { studyPlan += i.min || 0; if (on) studyDone += i.min || 0; }
    if (i.cat === 'leitura' && on) leitura += i.min || 0;
    if (i.cat === 'treino') { if (!i.optional) treinoPlan++; if (on) treinoDone++; }
    if (i.cat === 'familia' && on) familia = true;
  }
  return {
    items, total: checkable.length, done, pct: checkable.length ? Math.round((done / checkable.length) * 100) : 0,
    kcal, kcalPlan, studyDone, studyPlan, leitura, mealsDone, mealsTotal, familia,
    treino: treinoPlan || treinoDone ? treinoDone > 0 : null,
    hasFamilia: items.some((i) => i.cat === 'familia'),
    q: Number(day.q) || 0, a: Number(day.a) || 0,
  };
}

function sortedWeights() {
  return [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
}

// ------------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------------
const $view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function ring(pct, size = 84, color = 'var(--accent)') {
  const r = size / 2 - 7, c = 2 * Math.PI * r, off = c * (1 - Math.min(pct, 100) / 100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="${size / 4.2}" font-weight="800">${pct}%</text>
  </svg>`;
}

function bar(pct, cls = '') {
  return `<div class="bar ${cls}"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

// Janela inferior (editor de evento, horário, confirmações)
function openSheet(html) {
  const m = document.getElementById('sheet');
  document.getElementById('sheetCard').innerHTML = html;
  m.classList.remove('hidden');
  m.onclick = (e) => { if (e.target === m) closeSheet(); };
  return document.getElementById('sheetCard');
}
function closeSheet() {
  document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheetCard').innerHTML = '';
}

function renderHeader() {
  const t = todayKey();
  const s = state.settings;
  const left = diffDays(t, s.prova);
  const cd = document.getElementById('countdown');
  if (left > 1) cd.textContent = `Faltam ${left} dias · ${s.provaNome} ${fmtDM(s.prova)}`;
  else if (left === 1) cd.textContent = `Prova ${s.provaNome} é amanhã · durma cedo`;
  else if (left === 0) cd.textContent = `Hoje é a prova ${s.provaNome} · confie no treino`;
  else cd.textContent = 'Foco: próxima aprovação';

  const lbl = current === t ? 'Hoje' : current === addDays(t, -1) ? 'Ontem' : current === addDays(t, 1) ? 'Amanhã' : '';
  document.getElementById('dateLabel').textContent = lbl ? `${lbl} · ${fmtDM(current)}` : fmtShort(current);
}

// ------------------------------------------------------------------
// Aba: Hoje
// ------------------------------------------------------------------
function renderHoje() {
  const day = getDay(current);
  const st = dayStats(current);
  const s = state.settings;
  const isToday = current === todayKey();
  const now = nowHM();
  let nowId = null;
  if (isToday) for (const i of st.items) if (i.t <= now && i.t >= '04:00') nowId = i.id;

  const rows = st.items.map((i) => {
    const on = !!day.checks[i.id];
    const real = day.times[i.id];
    const kcalTxt = i.cat === 'refeicao' && i.kcal ? ` · ≈ ${fmtNum(i.kcal)} kcal` : '';
    const timeCol = `<div class="time">${i.t}${on && real && real !== i.t ? `<small class="real">✓ ${real}</small>` : ''}</div>`;
    const body = i.info
      ? `<div class="item info" data-row="${esc(i.id)}">${timeCol}<div class="body"><div class="title">${esc(i.title)}</div>${i.sub ? `<div class="sub">${esc(i.sub)}</div>` : ''}</div></div>`
      : `<div class="item ${on ? 'done' : ''} ${i.id === nowId ? 'now' : ''}" data-row="${esc(i.id)}">
          ${timeCol}
          <div class="body"><div class="title"><span class="tag" style="background:${CAT_COLOR[i.cat]}"></span>${esc(i.title)}</div>
            <div class="sub">${esc(i.sub || '')}${kcalTxt}${i.optional ? ' · opcional' : ''}</div></div>
          <button class="check ${on ? 'on' : ''}" data-check="${esc(i.id)}" aria-label="Marcar como feito">${on ? '✓' : ''}</button>
        </div>`;
    return `<div class="swipe" data-swipe="${esc(i.id)}">
      <div class="swipe-actions">
        <button class="sa-edit" data-edit="${esc(i.id)}" aria-label="Editar">${ICON_EDIT}</button>
        <button class="sa-del" data-del="${esc(i.id)}" aria-label="Excluir">${ICON_TRASH}</button>
      </div>${body}</div>`;
  }).join('');

  const acerto = st.q ? Math.round((st.a / st.q) * 100) : null;
  const custom = day.items ? `<div class="small muted" style="margin-top:8px">Este dia tem ajustes só dele. <button class="linklike" id="resetDay">Voltar ao modelo de ${TPL[day.type].plural}</button></div>` : '';

  $view.innerHTML = `
    <div class="card ring-wrap">
      ${ring(st.pct)}
      <div style="flex:1">
        <div class="big" style="font-size:22px">${st.done} de ${st.total} feitos</div>
        <div class="small muted" style="margin:4px 0 8px">Estudo ${st.studyDone}/${st.studyPlan} min · Refeições ${st.mealsDone}/${st.mealsTotal} · ≈ ${fmtNum(st.kcal)} de ~${fmtNum(s.kcalTarget)} kcal</div>
        ${bar(st.studyPlan ? (st.studyDone / st.studyPlan) * 100 : 0, 'blue')}
        <div style="height:6px"></div>
        ${bar(st.mealsTotal ? (st.mealsDone / st.mealsTotal) * 100 : 0)}
      </div>
    </div>

    <div class="card">
      <h3>Tipo de dia</h3>
      <div class="seg">${C.TEMPLATES.map(([id, short]) => `<button data-type="${id}" class="${day.type === id ? 'active' : ''}">${short}</button>`).join('')}</div>
    </div>

    <div class="card"><h3>Rotina</h3>
      <div class="small muted" style="margin:-4px 0 6px">Marque o que fez: vale o horário previsto. Toque no evento para mudar o horário em que fez. Arraste para a esquerda para editar ou excluir.</div>
      ${rows || '<div class="muted small">Nenhum evento neste dia.</div>'}
      <button class="btn block" id="addEvent" style="margin-top:10px">+ Adicionar evento</button>
      ${custom}
    </div>

    <div class="card">
      <h3>Questões do dia</h3>
      <div class="grid2">
        <div class="field"><label>Feitas</label><input type="number" inputmode="numeric" min="0" id="qFeitas" value="${esc(day.q)}"></div>
        <div class="field"><label>Acertos</label><input type="number" inputmode="numeric" min="0" id="qAcertos" value="${esc(day.a)}"></div>
      </div>
      <div class="small muted">${acerto != null ? `Aproveitamento: <b class="${acerto >= 70 ? 'good' : acerto >= 50 ? 'warn-t' : 'bad-t'}">${acerto}%</b> · meta da prova: 50% (ideal 70%+)` : 'Registre ao final de cada bloco.'}</div>
    </div>

    ${hydrationCard(day)}
  `;

  $view.querySelectorAll('[data-check]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.check;
    day.checks[id] = !day.checks[id];
    if (!day.checks[id]) { delete day.checks[id]; delete day.times[id]; }
    if (day.checks[id] && navigator.vibrate) navigator.vibrate(10);
    save(); render();
  });
  $view.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
    if (b.dataset.type === day.type) return;
    if (day.items && !confirm(`Este dia tem ajustes só dele. Trocar para o modelo de ${TPL[b.dataset.type].plural} descarta esses ajustes. Continuar?`)) return;
    C.setDayType(state, current, b.dataset.type);
    save(); render();
  });
  const qf = document.getElementById('qFeitas'), qa = document.getElementById('qAcertos');
  qf.onchange = () => { day.q = qf.value === '' ? '' : Number(qf.value); save(); render(); };
  qa.onchange = () => { day.a = qa.value === '' ? '' : Number(qa.value); save(); render(); };
  document.getElementById('addEvent').onclick = () => openEditor(null);
  const rd = document.getElementById('resetDay');
  if (rd) rd.onclick = () => {
    if (!confirm('Descartar os ajustes deste dia e voltar ao modelo?')) return;
    delete day.items; save(); render();
  };
  bindSwipes(st.items);
  bindHydration(day);
}

// Deslizar para a esquerda revela editar/excluir; toque abre o horário em que fez
const SWIPE_W = 128;
let openSwipe = null;

function bindSwipes(items) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  $view.querySelectorAll('.swipe').forEach((wrap) => {
    const row = wrap.querySelector('.item');
    let startX = 0, startY = 0, dx = 0, base = 0, dragging = false, decided = false, moved = false;
    const setX = (x, anim) => {
      row.style.transition = anim ? 'transform .2s ease' : 'none';
      row.style.transform = `translateX(${x}px)`;
    };
    const close = () => { setX(0, true); if (openSwipe === close) openSwipe = null; };
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-check]')) return;
      if (openSwipe && openSwipe !== close) openSwipe();
      startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; decided = false; moved = false;
      base = openSwipe === close ? -SWIPE_W : 0;
    });
    row.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; } // rolagem vertical
        try { row.setPointerCapture(e.pointerId); } catch { /* ok */ }
      }
      moved = true;
      dx = Math.min(0, Math.max(-SWIPE_W - 30, base + mx));
      setX(dx, false);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      if (dx < -SWIPE_W / 2) { setX(-SWIPE_W, true); openSwipe = close; }
      else close();
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-check]')) return;
      if (moved) { moved = false; return; }
      if (openSwipe === close) { close(); return; }
      const it = byId[wrap.dataset.swipe];
      if (it && !it.info) openTimeSheet(it);
    });
    wrap.querySelector('[data-edit]').onclick = () => { close(); openEditor(byId[wrap.dataset.swipe]); };
    wrap.querySelector('[data-del]').onclick = () => { close(); confirmDelete(byId[wrap.dataset.swipe]); };
  });
}

function openTimeSheet(it) {
  const day = getDay(current);
  const on = !!day.checks[it.id];
  const val = doneTime(day, it);
  const card = openSheet(`
    <h2>${esc(it.title)}</h2>
    <p class="small muted">Previsto para ${it.t}. ${on ? 'Marcado como feito.' : 'Ainda não marcado.'}</p>
    <div class="field"><label>Fiz às</label><input type="time" id="tsTime" value="${val}"></div>
    <button class="btn primary block" id="tsSave">${on ? 'Salvar horário' : 'Marcar como feito neste horário'}</button>
    <div style="height:8px"></div>
    ${on ? `<button class="btn block" id="tsPlanned">Fiz no horário previsto (${it.t})</button><div style="height:8px"></div>
      <button class="btn block danger" id="tsUndo">Desmarcar</button><div style="height:8px"></div>` : ''}
    <button class="btn block small" id="tsCancel">Cancelar</button>`);
  card.querySelector('#tsSave').onclick = () => {
    const t = card.querySelector('#tsTime').value;
    if (!C.isTime(t)) { toast('Horário inválido'); return; }
    day.checks[it.id] = true;
    if (t === it.t) delete day.times[it.id]; else day.times[it.id] = t;
    closeSheet(); save(); render();
  };
  if (on) {
    card.querySelector('#tsPlanned').onclick = () => { delete day.times[it.id]; closeSheet(); save(); render(); };
    card.querySelector('#tsUndo').onclick = () => { delete day.checks[it.id]; delete day.times[it.id]; closeSheet(); save(); render(); };
  }
  card.querySelector('#tsCancel').onclick = closeSheet;
}

function openEditor(it) {
  const day = getDay(current);
  const tpl = TPL[day.type];
  const isNew = !it;
  const v = it || { t: nowHM().slice(0, 3) + '00', title: '', sub: '', cat: 'rotina' };
  const card = openSheet(`
    <h2>${isNew ? 'Novo evento' : 'Editar evento'}</h2>
    <div class="grid2">
      <div class="field"><label>Horário</label><input type="time" id="evT" value="${esc(v.t)}"></div>
      <div class="field"><label>Categoria</label><select id="evCat">${Object.entries(C.CATS).map(([k, n]) => `<option value="${k}" ${v.cat === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Título</label><input type="text" id="evTitle" maxlength="80" value="${esc(v.title)}" placeholder="Ex.: Bloco 1 · 75 min"></div>
    <div class="field"><label>Descrição</label><input type="text" id="evSub" maxlength="160" value="${esc(v.sub)}" placeholder="Opcional"></div>
    <div class="grid2">
      <div class="field"><label>Duração (min)</label><input type="number" inputmode="numeric" id="evMin" value="${esc(v.min || '')}" placeholder="—"></div>
      <div class="field" id="evKcalF"><label>kcal aprox.</label><input type="number" inputmode="numeric" id="evKcal" value="${esc(v.kcal || '')}" placeholder="—"></div>
    </div>
    <label class="remember"><input type="checkbox" id="evOpt" ${v.optional ? 'checked' : ''}> Opcional (não conta no %)</label>
    <label class="remember"><input type="checkbox" id="evInfo" ${v.info ? 'checked' : ''}> Só informativo (sem marcar como feito)</label>
    <div style="height:10px"></div>
    <button class="btn primary block" id="evDay">${isNew ? 'Adicionar' : 'Salvar'} só em ${fmtDM(current)}</button>
    <div style="height:8px"></div>
    <button class="btn primary block" id="evAll">${isNew ? 'Adicionar' : 'Salvar'} em todas as ${tpl.plural}</button>
    <div style="height:8px"></div>
    <button class="btn block small" id="evCancel">Cancelar</button>`);
  const catSel = card.querySelector('#evCat');
  const kcalF = card.querySelector('#evKcalF');
  const toggleKcal = () => { kcalF.style.visibility = catSel.value === 'refeicao' ? 'visible' : 'hidden'; };
  catSel.onchange = toggleKcal; toggleKcal();
  const collect = () => ({
    id: isNew ? C.newId() : it.id,
    t: card.querySelector('#evT').value,
    title: card.querySelector('#evTitle').value,
    sub: card.querySelector('#evSub').value,
    cat: catSel.value,
    min: card.querySelector('#evMin').value,
    kcal: card.querySelector('#evKcal').value,
    optional: card.querySelector('#evOpt').checked,
    info: card.querySelector('#evInfo').checked,
  });
  const apply = (scope) => {
    try {
      C.upsertEvent(state, { scope, template: day.type, date: current, item: collect() });
    } catch { toast('Preencha horário e título'); return; }
    closeSheet(); save(); render();
    toast(scope === 'dia' ? `Salvo só em ${fmtDM(current)}` : `Salvo em todas as ${tpl.plural}`);
  };
  card.querySelector('#evDay').onclick = () => apply('dia');
  card.querySelector('#evAll').onclick = () => apply('modelo');
  card.querySelector('#evCancel').onclick = closeSheet;
  if (isNew) setTimeout(() => { const el = card.querySelector('#evTitle'); if (el) el.focus(); }, 50);
}

function confirmDelete(it) {
  const day = getDay(current);
  const tpl = TPL[day.type];
  const card = openSheet(`
    <h2>Excluir "${esc(it.title)}"?</h2>
    <button class="btn danger block" id="dlDay">Excluir só em ${fmtDM(current)}</button>
    <div style="height:8px"></div>
    <button class="btn danger block" id="dlAll">Excluir de todas as ${tpl.plural}</button>
    <div style="height:8px"></div>
    <button class="btn block small" id="dlCancel">Cancelar</button>`);
  const apply = (scope) => {
    try { C.deleteEvent(state, { scope, template: day.type, date: current, id: it.id }); } catch { /* já não existe */ }
    delete day.checks[it.id];
    delete day.times[it.id];
    closeSheet(); save(); render();
    toast('Evento excluído');
  };
  card.querySelector('#dlDay').onclick = () => apply('dia');
  card.querySelector('#dlAll').onclick = () => apply('modelo');
  card.querySelector('#dlCancel').onclick = closeSheet;
}

function hydrationCard(day) {
  const s = state.settings;
  const late = day.coffeeLate ? '<div class="small warn-t" style="margin-top:6px">Café depois das 14h registrado hoje — atrapalha o sono.</div>' : '';
  return `<div class="card">
    <h3>Água e café</h3>
    <div class="row between" style="margin-bottom:8px">
      <div><b>Água</b> <span class="muted small">${fmtNum(day.water)} / ${fmtNum(s.waterTarget)} ml</span></div>
      <div class="stepper"><button class="btn small" data-water="-250">−</button><button class="btn small primary" data-water="250">+250</button><button class="btn small primary" data-water="500">+500</button></div>
    </div>
    ${bar((day.water / s.waterTarget) * 100, 'blue')}
    <div class="row between" style="margin:14px 0 8px">
      <div><b>Café</b> <span class="muted small">${day.coffee} / ${s.coffeeMax} ml · até 14h</span></div>
      <div class="stepper"><button class="btn small" data-coffee="-50">−</button><button class="btn small primary" data-coffee="50">+50</button><button class="btn small primary" data-coffee="150">+150</button></div>
    </div>
    ${bar((day.coffee / s.coffeeMax) * 100, day.coffee > s.coffeeMax ? 'warn' : '')}
    ${late}
  </div>`;
}

function bindHydration(day) {
  $view.querySelectorAll('[data-water]').forEach((b) => b.onclick = () => {
    day.water = Math.max(0, (day.water || 0) + Number(b.dataset.water)); save(); render();
  });
  $view.querySelectorAll('[data-coffee]').forEach((b) => b.onclick = () => {
    const add = Number(b.dataset.coffee);
    day.coffee = Math.max(0, (day.coffee || 0) + add);
    if (add > 0 && current === todayKey() && new Date().getHours() >= 14) day.coffeeLate = true;
    if (day.coffee > state.settings.coffeeMax) toast('Passou do limite de café de hoje');
    save(); render();
  });
}

// ------------------------------------------------------------------
// Aba: Peso
// ------------------------------------------------------------------
function weightChart(ws) {
  if (ws.length < 2) return '<div class="muted small">Registre pelo menos 2 pesagens para ver o gráfico.</div>';
  const W = 340, H = 180, P = { l: 34, r: 10, t: 12, b: 24 };
  const d0 = ws[0].date, dN = ws[ws.length - 1].date;
  const span = Math.max(diffDays(d0, dN), 7);
  const goalEnd = ws[0].kg + (span / 7) * 0.375; // +0,375 kg/semana a partir da 1ª pesagem
  const kgs = ws.map((w) => w.kg).concat([goalEnd]);
  const min = Math.min(...kgs) - 0.5, max = Math.max(...kgs) + 0.5;
  const x = (k) => P.l + (diffDays(d0, k) / span) * (W - P.l - P.r);
  const y = (kg) => P.t + (1 - (kg - min) / (max - min)) * (H - P.t - P.b);
  const pts = ws.map((w) => `${x(w.date).toFixed(1)},${y(w.kg).toFixed(1)}`).join(' ');
  const ticks = [];
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    ticks.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${P.l - 5}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtNum(v, 1)}</text>`);
  }
  const lastX = x(dN), lastY = y(ws[ws.length - 1].kg);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    ${ticks.join('')}
    <line x1="${x(d0)}" y1="${y(ws[0].kg)}" x2="${P.l + (W - P.l - P.r)}" y2="${y(goalEnd)}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1.5"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${ws.map((w) => `<circle cx="${x(w.date)}" cy="${y(w.kg)}" r="3" fill="var(--accent)"/>`).join('')}
    <circle cx="${lastX}" cy="${lastY}" r="5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>
    <text x="${P.l}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmtDM(d0)}</text>
    <text x="${W - P.r}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDM(dN)}</text>
  </svg>
  <div class="small muted" style="margin-top:6px">Linha verde: seu peso · tracejada: meta de +0,25 a 0,5 kg/semana (ponto médio).</div>`;
}

function weeklyRate(ws) {
  if (ws.length < 2) return null;
  const last = ws[ws.length - 1];
  let ref = null;
  for (let i = ws.length - 2; i >= 0; i--) {
    if (diffDays(ws[i].date, last.date) >= 6) { ref = ws[i]; break; }
  }
  if (!ref) ref = ws[0];
  const dd = diffDays(ref.date, last.date);
  if (dd < 3) return null;
  return ((last.kg - ref.kg) / dd) * 7;
}

function renderPeso() {
  const ws = sortedWeights();
  const last = ws[ws.length - 1];
  const first = ws[0];
  const rate = weeklyRate(ws);
  let coach = 'Pese-se toda segunda, em jejum, depois do banheiro.';
  if (rate != null) {
    if (rate < 0.25) coach = `Ritmo de ${fmtNum(rate, 2)} kg/semana: abaixo da meta. Se continuar assim por 2 semanas, some ~200 kcal por dia (1 pão ou 50 g de arroz a mais por refeição).`;
    else if (rate > 0.5) coach = `Ritmo de ${fmtNum(rate, 2)} kg/semana: acima da meta, risco de ganhar gordura demais. Tire ~200 kcal por dia.`;
    else coach = `Ritmo de ${fmtNum(rate, 2)} kg/semana: dentro da meta (0,25–0,5). Mantenha.`;
  }

  $view.innerHTML = `
    <div class="card">
      <div class="grid3">
        <div class="stat"><div class="v">${last ? fmtNum(last.kg, 1) : '–'}</div><div class="l">Atual (kg)</div></div>
        <div class="stat"><div class="v ${last && first && last.kg - first.kg >= 0 ? 'good' : ''}">${last && first ? (last.kg - first.kg >= 0 ? '+' : '') + fmtNum(last.kg - first.kg, 1) : '–'}</div><div class="l">Desde o início</div></div>
        <div class="stat"><div class="v">${rate != null ? (rate >= 0 ? '+' : '') + fmtNum(rate, 2) : '–'}</div><div class="l">kg / semana</div></div>
      </div>
      <p class="small" style="margin:12px 0 0">${esc(coach)}</p>
    </div>

    <div class="card"><h3>Evolução</h3>${weightChart(ws)}</div>

    <div class="card"><h3>Registrar peso</h3>
      <div class="grid2">
        <div class="field"><label>Data</label><input type="date" id="wDate" value="${esc(current)}"></div>
        <div class="field"><label>Peso (kg)</label><input type="number" inputmode="decimal" step="0.1" id="wKg" placeholder="81,0"></div>
      </div>
      <button class="btn primary block" id="wSave">Salvar pesagem</button>
    </div>

    <div class="card"><h3>Histórico</h3>
      ${ws.slice().reverse().map((w) => `<div class="list-row"><span>${fmtShort(w.date)}</span><span class="row"><b>${fmtNum(w.kg, 1)} kg</b><button class="btn small danger" data-del-w="${esc(w.date)}">✕</button></span></div>`).join('') || '<div class="muted small">Nenhuma pesagem ainda. Comece com o peso de hoje.</div>'}
    </div>
  `;

  document.getElementById('wSave').onclick = () => {
    const date = document.getElementById('wDate').value;
    const kg = Number(String(document.getElementById('wKg').value).replace(',', '.'));
    if (!C.isDate(date) || !kg || kg < 30 || kg > 250) { toast('Peso inválido'); return; }
    state.weights = state.weights.filter((w) => w.date !== date);
    state.weights.push({ date, kg: Math.round(kg * 10) / 10 });
    save(); render(); toast('Pesagem salva');
  };
  $view.querySelectorAll('[data-del-w]').forEach((b) => b.onclick = () => {
    if (!confirm('Apagar esta pesagem?')) return;
    state.weights = state.weights.filter((w) => w.date !== b.dataset.delW); save(); render();
  });
}

// ------------------------------------------------------------------
// Aba: Semana
// ------------------------------------------------------------------
function renderSemana() {
  const start = weekStart(current);
  const t = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const stats = days.map((k) => ({ k, s: dayStats(k) }));
  const sum = (f) => stats.reduce((a, x) => a + (x.s ? f(x.s) : 0), 0);
  const studyMin = sum((s) => s.studyDone);
  const studyPlan = days.reduce((a, k) => a + itemsOf(k).filter((i) => i.cat === 'estudo').reduce((b, i) => b + (i.min || 0), 0), 0);
  const treinoPlan = days.reduce((a, k) => a + (itemsOf(k).some((i) => i.cat === 'treino' && !i.optional) ? 1 : 0), 0);
  const q = sum((s) => s.q), a = sum((s) => s.a);
  const treinos = stats.filter((x) => x.s && x.s.treino).length;
  const leitura = sum((s) => s.leitura);
  const mealsDone = sum((s) => s.mealsDone), mealsTotal = sum((s) => s.mealsTotal);
  const tracked = stats.filter((x) => x.s && x.k <= t);
  const avgPct = tracked.length ? Math.round(tracked.reduce((acc, x) => acc + x.s.pct, 0) / tracked.length) : 0;
  const famDays = stats.filter((x) => x.s && x.s.familia).length;

  $view.innerHTML = `
    <div class="card">
      <div class="row between" style="margin-bottom:12px">
        <button class="btn small" id="wPrev">‹ Semana</button>
        <b>${fmtDM(days[0])} – ${fmtDM(days[6])}</b>
        <button class="btn small" id="wNext">Semana ›</button>
      </div>
      <div class="weekbars">
        ${stats.map((x) => {
          const p = x.s ? x.s.pct : 0;
          return `<div class="col" data-go="${x.k}"><div class="p">${x.s ? p + '%' : ''}</div><div class="b ${x.k === t ? 'today' : ''}" style="height:${Math.max(p, 2)}%;${x.s ? '' : 'background:var(--line)'}"></div><div class="d">${WD[parseKey(x.k).getDay()]}</div></div>`;
        }).join('')}
      </div>
      <div class="small muted" style="margin-top:8px">Média de cumprimento: <b>${avgPct}%</b> · toque num dia para abri-lo</div>
    </div>

    <div class="card"><h3>Resumo da semana</h3>
      <div class="grid2">
        <div class="stat"><div class="v">${fmtNum(studyMin / 60, 1)} h</div><div class="l">Estudo (de ${fmtNum(studyPlan / 60, 1)} h planejadas)</div>${bar(studyPlan ? (studyMin / studyPlan) * 100 : 0, 'blue')}</div>
        <div class="stat"><div class="v">${q}</div><div class="l">Questões · ${q ? Math.round((a / q) * 100) + '% de acerto' : 'sem registro'}</div></div>
        <div class="stat"><div class="v">${treinos}/${treinoPlan}</div><div class="l">Treinos feitos</div>${bar(treinoPlan ? (treinos / treinoPlan) * 100 : 0)}</div>
        <div class="stat"><div class="v">${fmtNum(leitura / 60, 1)} h</div><div class="l">Leitura (meta 7 h)</div>${bar((leitura / 420) * 100)}</div>
        <div class="stat"><div class="v">${mealsTotal ? Math.round((mealsDone / mealsTotal) * 100) + '%' : '–'}</div><div class="l">Refeições no horário (${mealsDone}/${mealsTotal})</div>${bar(mealsTotal ? (mealsDone / mealsTotal) * 100 : 0)}</div>
        <div class="stat"><div class="v">${famDays}/7</div><div class="l">Dias com tempo de família</div></div>
      </div>
    </div>
  `;
  document.getElementById('wPrev').onclick = () => { current = addDays(current, -7); render(); };
  document.getElementById('wNext').onclick = () => { current = addDays(current, 7); render(); };
  $view.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => { current = el.dataset.go; setTab('hoje'); });
}

// ------------------------------------------------------------------
// Aba: Coach (check-in + conversa com o Claude)
// ------------------------------------------------------------------
function checkinText(k) {
  const day = getDay(k);
  const st = dayStats(k);
  const fmt = (i) => {
    const on = !!day.checks[i.id];
    const real = day.times[i.id];
    return `${on ? '✓' : '✗'} ${i.t} ${i.title}${on && real && real !== i.t ? ` (fez às ${real})` : ''}`;
  };
  const tomorrow = state.days[addDays(k, 1)];
  const acordar = st.items.find((i) => i.id === 'acordar' || /acordar/i.test(i.title));
  const wake = acordar && day.checks[acordar.id] ? doneTime(day, acordar) : '—';
  return [
    `CHECK-IN ${fmtShort(k)} (modelo: ${TPL[day.type].short})`,
    `Acordei às: ${wake}`,
    `Cumprimento da rotina: ${st.pct}% (${st.done}/${st.total})`,
    `Estudo: ${st.studyDone}/${st.studyPlan} min · Questões ${st.q}, acertos ${st.a}${st.q ? ` (${Math.round((st.a / st.q) * 100)}%)` : ''}`,
    `Treino: ${st.treino == null ? 'não previsto' : st.treino ? 'feito' : 'não feito'} · Leitura: ${st.leitura} min`,
    `Dieta (0 a 10): ${day.dieta ?? '—'} · refeições ${st.mealsDone}/${st.mealsTotal} (≈ ${fmtNum(st.kcal)} kcal) · água ${fmtNum(day.water)} ml · café ${day.coffee} ml`,
    `Tempo com a família: ${st.hasFamilia ? (st.familia ? 'ok' : 'faltou') : 'n/a'}`,
    `Nota do dia: ${day.nota ?? '—'} · O que atrapalhou: ${day.obs || 'nada a relatar'}`,
    `Amanhã tenho serviço? ${tomorrow && tomorrow.type === 'servico' ? 'sim' : 'não'}`,
    '',
    'Eventos:',
    ...st.items.filter((i) => !i.info).map(fmt),
  ].join('\n');
}

let coachError = '';

function renderCoach() {
  const day = getDay(current);
  const tk = addDays(current, 1);
  const serv = state.days[tk] && state.days[tk].type === 'servico';
  const chips = (field) => Array.from({ length: 11 }, (_, n) => `<button class="chip ${day[field] === n ? 'on' : ''}" data-${field}="${n}">${n}</button>`).join('');
  const msgs = state.coach.messages;
  const bubbles = msgs.map((m) => `
    <div class="msg ${m.role === 'user' ? 'me' : 'coach'} ${m.kind === 'checkin' ? 'ck' : ''}">
      <div class="bubble">${m.kind === 'checkin' ? `<b>📋 ${esc(m.text.split('\n')[0])}</b><details><summary>ver detalhes</summary><pre>${esc(m.text)}</pre></details>` : esc(m.text).replace(/\n/g, '<br>')}</div>
      ${m.changes && m.changes.length ? `<div class="changes"><b>Alterações na rotina:</b><ul>${m.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      <div class="ts">${m.ts ? new Date(m.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
    </div>`).join('');

  $view.innerHTML = `
    <details class="card ck-card" ${day.checkinSent ? '' : 'open'}>
      <summary><h3 style="display:inline">Check-in de ${current === todayKey() ? 'hoje' : fmtDM(current)}</h3>
        <span class="small muted"> · ${day.checkinSent ? 'enviado ao coach ✓' : 'vai sozinho ao coach na manhã seguinte'}</span></summary>
      <div class="field" style="margin-top:10px"><label>Dieta (0 a 10)</label><div class="chips">${chips('dieta')}</div></div>
      <div class="field"><label>Nota do dia (0 a 10)</label><div class="chips">${chips('nota')}</div></div>
      <div class="field"><label>O que atrapalhou?</label><textarea id="ciObs" placeholder="Ex.: dormi tarde, serviço puxado...">${esc(day.obs || '')}</textarea></div>
      <div class="row between"><span>Amanhã tenho serviço</span><button class="chip ${serv ? 'on' : ''}" id="ciServ">${serv ? 'Sim' : 'Não'}</button></div>
      <div style="height:10px"></div>
      <button class="btn block" id="ciSend" ${coachBusy ? 'disabled' : ''}>${day.checkinSent ? 'Enviar check-in de novo' : 'Enviar check-in agora'}</button>
    </details>

    <div class="card chat">
      <h3>Conversar com meu coach</h3>
      <div class="msgs" id="msgs">
        ${bubbles || '<div class="muted small">Peça mudanças na rotina, tire dúvidas sobre o plano ou conte como foi o dia. Ex.: "Amanhã tenho dentista às 15h, reorganize meu estudo".</div>'}
        ${coachBusy ? '<div class="msg coach"><div class="bubble typing"><span></span><span></span><span></span></div></div>' : ''}
        ${coachError ? `<div class="small bad-t" style="margin-top:8px">${esc(coachError)}</div>` : ''}
      </div>
      <div class="composer">
        <textarea id="coachInput" rows="1" maxlength="2000" placeholder="Mensagem para o coach" ${coachBusy ? 'disabled' : ''}></textarea>
        <button class="btn primary" id="coachSend" ${coachBusy ? 'disabled' : ''} aria-label="Enviar">➤</button>
      </div>
    </div>
  `;

  $view.querySelectorAll('[data-dieta]').forEach((b) => b.onclick = () => { day.dieta = Number(b.dataset.dieta); save(); render(); });
  $view.querySelectorAll('[data-nota]').forEach((b) => b.onclick = () => { day.nota = Number(b.dataset.nota); save(); render(); });
  document.getElementById('ciObs').onchange = (e) => { day.obs = e.target.value.trim(); save(); };
  document.getElementById('ciServ').onclick = () => {
    C.setDayType(state, tk, serv ? autoType(tk) : 'servico');
    save(); render();
  };
  document.getElementById('ciSend').onclick = () => sendCheckin(current);
  const input = document.getElementById('coachInput');
  const send = () => {
    const txt = input.value.trim();
    if (!txt) return;
    sendCoach({ message: txt });
  };
  document.getElementById('coachSend').onclick = send;
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  const box = document.getElementById('msgs');
  box.scrollTop = box.scrollHeight;
}

async function sendCoach(body) {
  if (coachBusy) return;
  coachError = '';
  coachBusy = true;
  clearTimeout(syncTimer);
  // O texto aparece na hora; a resposta do servidor substitui pelo histórico oficial
  const optimistic = { role: 'user', text: body.message, ts: Date.now(), kind: body.checkinDate ? 'checkin' : undefined };
  state.coach.messages.push(optimistic);
  if (tab === 'coach') render();
  let restore = null;
  try {
    if (dirty) await push();
    if (dirty) throw new Error('offline');
    const r = await fetch('/api/coach', { method: 'POST', headers: headers(), credentials: 'same-origin', body: JSON.stringify({ ...body, today: todayKey(), now: nowHM() }) });
    const a = await r.json().catch(() => ({}));
    if (r.status === 401) { showPin(); throw new Error('auth'); }
    if (!r.ok) throw new Error(a.message || 'O coach não respondeu. Tente de novo.');
    state = sanitizeState(a.state) || state;
    saveLocal();
    dirty = false;
    setSync('ok');
    if (a.changes && a.changes.length) toast('Rotina ajustada pelo coach');
  } catch (e) {
    state.coach.messages = state.coach.messages.filter((m) => m !== optimistic);
    coachError = e.message === 'offline' ? 'Sem internet: a mensagem não foi enviada.' : e.message === 'auth' ? '' : e.message;
    if (!body.checkinDate) restore = body.message;
  } finally {
    coachBusy = false;
  }
  if (tab === 'coach') {
    render();
    const input = document.getElementById('coachInput');
    if (restore && input) input.value = restore;
  }
}

function sendCheckin(k) {
  return sendCoach({ message: checkinText(k), checkinDate: k });
}

// Envia sozinho o check-in de ontem na primeira abertura do dia
async function autoCheckin() {
  const y = addDays(todayKey(), -1);
  const day = state.days[y];
  if (!day || day.checkinSent || coachBusy) return;
  const st = dayStats(y);
  const touched = st.done > 0 || day.dieta != null || day.nota != null || day.obs || day.water > 0;
  if (!touched) return;
  await sendCheckin(y);
}

// ------------------------------------------------------------------
// Ajustes
// ------------------------------------------------------------------
function renderAjustes() {
  const s = state.settings;
  $view.innerHTML = `
    <div class="card"><h3>Metas</h3>
      <div class="grid2">
        <div class="field"><label>Calorias/dia (aprox.)</label><input type="number" id="sK" value="${esc(s.kcalTarget)}"></div>
        <div class="field"><label>Água/dia (ml)</label><input type="number" id="sW" value="${esc(s.waterTarget)}"></div>
        <div class="field"><label>Café máx. (ml)</label><input type="number" id="sC" value="${esc(s.coffeeMax)}"></div>
      </div>
    </div>
    <div class="card"><h3>Próxima prova</h3>
      <div class="grid2">
        <div class="field"><label>Nome</label><input type="text" id="sN" value="${esc(s.provaNome)}"></div>
        <div class="field"><label>Data</label><input type="date" id="sD" value="${esc(s.prova)}"></div>
      </div>
    </div>
    <button class="btn primary block" id="sSave">Salvar ajustes</button>
    <div style="height:12px"></div>
    <div class="card"><h3>Rotina</h3>
      <div class="small muted" style="margin-bottom:8px">Para mudar a rotina, arraste um evento para a esquerda na aba Hoje ou peça ao coach.</div>
      <button class="btn block danger" id="sResetRoutine">Restaurar a rotina padrão</button>
    </div>
    <div class="card"><h3>Backup</h3>
      <div class="grid2">
        <button class="btn" id="sExport">Exportar dados</button>
        <label class="btn" style="text-align:center">Importar<input type="file" id="sImport" accept="application/json" class="hidden"></label>
      </div>
      <div class="small muted" style="margin-top:8px">O arquivo exportado <b>não</b> é criptografado: guarde em local seguro e apague depois de usar.</div>
      <div class="small muted" style="margin-top:4px">Status: ${online ? 'sincronizado com o servidor' : 'offline — dados salvos no celular'}.</div>
    </div>
    <div class="card"><h3>Sessão</h3>
      <button class="btn danger block" id="sLogout">Sair deste aparelho</button>
      <div style="height:8px"></div>
      <button class="btn danger block" id="sLogoutAll">Sair de todos os aparelhos</button>
      <div class="small muted" style="margin-top:8px">Use "todos os aparelhos" se perdeu o celular ou acha que alguém viu seu PIN: todos voltam a pedir o código do autenticador. Depois troque o APP_PIN no Railway.</div>
      <div class="small muted" style="margin-top:4px" id="secInfo"></div>
    </div>
    <button class="btn block" id="sBack">‹ Voltar</button>
  `;
  document.getElementById('sSave').onclick = () => {
    s.kcalTarget = Number(document.getElementById('sK').value) || DEFAULTS.kcalTarget;
    s.waterTarget = Number(document.getElementById('sW').value) || DEFAULTS.waterTarget;
    s.coffeeMax = Number(document.getElementById('sC').value) || DEFAULTS.coffeeMax;
    s.provaNome = document.getElementById('sN').value.trim().slice(0, 40) || 'Prova';
    s.prova = document.getElementById('sD').value || DEFAULTS.prova;
    save(); toast('Ajustes salvos'); setTab('hoje');
  };
  document.getElementById('sResetRoutine').onclick = () => {
    if (!confirm('Voltar todos os modelos para a rotina padrão? Os dias com ajustes próprios continuam como estão.')) return;
    state.templates = C.defaultTemplates();
    save(); toast('Rotina padrão restaurada');
  };
  document.getElementById('sExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rotina-backup-${todayKey()}.json`;
    a.click();
  };
  document.getElementById('sImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const s2 = sanitizeState(JSON.parse(await f.text()));
      if (!s2) throw new Error();
      if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
      state = s2;
      save(); toast('Backup importado'); setTab('hoje');
    } catch { toast('Arquivo inválido'); }
  };
  fetch('/api/security', { credentials: 'same-origin' }).then((r) => r.ok && r.json()).then((x) => {
    const el = document.getElementById('secInfo');
    if (x && el) el.textContent = `Sessões ativas: ${x.sessions} · aparelhos confiáveis: ${x.devices} · códigos de recuperação restantes: ${x.recoveryLeft}`;
  }).catch(() => {});
  document.getElementById('sLogout').onclick = () => logout(false);
  document.getElementById('sLogoutAll').onclick = () => logout(true);
  document.getElementById('sBack').onclick = () => setTab('hoje');
}

// ------------------------------------------------------------------
// Navegação
// ------------------------------------------------------------------
function render() {
  renderHeader();
  ({ hoje: renderHoje, peso: renderPeso, semana: renderSemana, coach: renderCoach, ajustes: renderAjustes })[tab]();
}

function setTab(t) {
  tab = t;
  openSwipe = null;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  window.scrollTo(0, 0);
  render();
}

document.querySelectorAll('.tabbar button').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
document.getElementById('openSettings').onclick = () => setTab('ajustes');
document.getElementById('prevDay').onclick = () => { current = addDays(current, -1); render(); };
document.getElementById('nextDay').onclick = () => { current = addDays(current, 1); render(); };
const picker = document.getElementById('datePicker');
document.getElementById('dateLabel').onclick = () => {
  picker.value = current;
  if (picker.showPicker) { try { picker.showPicker(); return; } catch { /* segue */ } }
  current = todayKey(); render();
};
picker.onchange = () => { if (picker.value) { current = picker.value; render(); } };

// Volta ao dia de hoje e sincroniza ao reabrir o app
let lastSeenDay = todayKey();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || coachBusy) return;
  if (document.body.classList.contains('locked')) return; // na tela de login/2FA, não mexe
  if (todayKey() !== lastSeenDay) { lastSeenDay = todayKey(); current = lastSeenDay; }
  if (dirty) await push(); else await pull();
  render();
  autoCheckin();
});
window.addEventListener('online', () => { if (dirty && !coachBusy) push(); });

// ------------------------------------------------------------------
// Início
// ------------------------------------------------------------------
(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  setSync('err');
  state = await loadLocal();
  render();
  if (await checkAuth()) { await pull(); render(); autoCheckin(); }
})();
