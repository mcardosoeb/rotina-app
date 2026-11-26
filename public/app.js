/* Rotina PMSC — app pessoal (rotina, estudo, treino, calorias, peso) */
'use strict';

// ------------------------------------------------------------------
// Plano (mesmo conteúdo do doc "Plano de Rotina e Estudos")
// ------------------------------------------------------------------
const DEFAULTS = {
  kcalTarget: 3000,
  protTarget: 170,
  waterTarget: 3000,
  coffeeMax: 500,
  prova: '2026-12-13',
  provaNome: 'PMSC',
};

const CYCLE = {
  1: { b1: 'Legislação Institucional', b2: 'Língua Portuguesa', b3: 'Erros do simulado de domingo' },
  2: { b1: 'Processo Penal', b2: 'Informática', b3: 'Caderno de erros + flashcards' },
  3: { b1: 'Direito Penal Militar', b2: 'Legislação de Trânsito', b3: 'Caderno de erros + flashcards' },
  4: { b1: 'Direito Constitucional', b2: 'Língua Portuguesa', b3: 'Caderno de erros + flashcards' },
  5: { b1: 'Processo Penal', b2: 'Direito Penal Comum', b3: 'Revisão da semana (caderno de erros)' },
  6: { b1: 'Legislação Institucional', b2: 'Legislação Especial', b3: '' },
  0: { b1: 'Questões mistas', b2: 'Redação (planejar 1 tema)', b3: '' },
};

const TREINO = {
  1: ['Superior A', 'Supino reto, remada curvada, desenvolvimento, barra, tríceps, bíceps'],
  2: ['Inferior A', 'Agachamento, leg press, flexora, panturrilha, abdominal'],
  3: ['Corrida 25 min + core 20 min', 'Prancha, abdominal, flexão de braço'],
  4: ['Superior B', 'Supino inclinado, puxada, remada baixa, elevação lateral, paralelas'],
  5: ['Inferior B', 'Terra romeno, afundo, extensora, panturrilha, abdominal'],
  6: ['Corrida leve 30–40 min', 'Ritmo de conversa'],
  0: ['Descanso', ''],
};

const MEALS = {
  ritual: { title: 'Ritual: limão, gengibre e própolis', sub: '+ 1 copo de água · café preto 150 ml', kcal: 10, prot: 0 },
  cafe: { title: 'Café da manhã', sub: '3 ovos + 1 pão + 1 banana + café com leite', kcal: 560, prot: 28 },
  lanche: { title: 'Lanche', sub: 'Pão com pasta de amendoim + banana', kcal: 330, prot: 12 },
  almoco: { title: 'Almoço (refeitório)', sub: '5–6 col. arroz + feijão + carne/frango (palma da mão) + salada', kcal: 780, prot: 50 },
  pre: { title: 'Pré-treino', sub: '2 pães + 2 ovos (ou banana + aveia + mel)', kcal: 400, prot: 20 },
  whey: { title: 'Whey + creatina', sub: '1 dose de whey · 3–5 g de creatina', kcal: 120, prot: 24 },
  jantar: { title: 'Jantar', sub: 'Arroz + feijão + carne moída ou 3 ovos + legumes', kcal: 550, prot: 40 },
  ceia: { title: 'Ceia', sub: '250 ml de leite + 2 colheres de aveia', kcal: 225, prot: 11 },
};

const DAY_TYPES = [
  ['util', 'Dia útil'],
  ['terca', 'Terça'],
  ['sabado', 'Sábado'],
  ['domingo', 'Domingo'],
  ['servico', 'Serviço'],
];

const CAT_COLOR = {
  estudo: 'var(--estudo)', refeicao: 'var(--refeicao)', treino: 'var(--treino)', familia: 'var(--familia)',
  leitura: 'var(--leitura)', sono: 'var(--sono)', rotina: 'var(--rotina)',
};

function meal(id, t) {
  const m = MEALS[id];
  return { id, t, title: m.title, sub: m.sub, cat: 'refeicao', kcal: m.kcal, prot: m.prot };
}

function buildItems(day, key) {
  const wd = parseKey(key).getDay();
  const c = CYCLE[wd];
  const [tr, trSub] = TREINO[wd];
  const S = (id, t, title, sub, min) => ({ id, t, title, sub, cat: 'estudo', min });
  const I = (t, title) => ({ id: 'info_' + t, t, title, cat: 'rotina', info: true });

  if (day.type === 'sabado') {
    return [
      { id: 'acordar', t: '05:45', title: 'Acordar', sub: 'Sono de recuperação', cat: 'sono' },
      meal('ritual', '05:45'),
      meal('cafe', '06:00'),
      S('s1', '06:30', 'Estudo S1 · 90 min', 'Legislação Institucional', 90),
      S('s2', '08:15', 'Estudo S2 · 60 min', 'Redação: 1 texto completo (20–30 linhas), cronometrado', 60),
      meal('lanche', '09:15'),
      S('s3', '09:30', 'Estudo S3 · 60 min', 'Legislação Especial', 60),
      { id: 'treino', t: '10:45', title: 'Corrida leve 30–40 min', sub: 'Ritmo de conversa', cat: 'treino' },
      meal('whey', '11:30'),
      meal('almoco', '12:00'),
      { id: 'prep', t: '13:00', title: 'Preparar base dos jantares', sub: 'Arroz, feijão e carne moída', cat: 'rotina' },
      { id: 'leitura', t: '15:00', title: 'Leitura · 1h', sub: 'Livro pessoal', cat: 'leitura', min: 60 },
      { ...meal('pre', '16:00'), title: 'Lanche da tarde' },
      { id: 'familia', t: '16:00', title: 'Família / livre', sub: '16h–18h e à noite', cat: 'familia' },
      { id: 'igreja', t: '18:15', title: 'Igreja', sub: '', cat: 'familia' },
      meal('jantar', '19:30'),
      meal('ceia', '21:30'),
      { id: 'dormir', t: '22:30', title: 'Dormir até 22h30', sub: '', cat: 'sono' },
    ];
  }

  if (day.type === 'domingo') {
    return [
      { id: 'acordar', t: '06:30', title: 'Acordar', sub: '', cat: 'sono' },
      meal('ritual', '06:30'),
      meal('cafe', '07:00'),
      { id: 'missa', t: '08:00', title: 'Missa', sub: '', cat: 'familia' },
      meal('lanche', '10:00'),
      { id: 'familia', t: '10:00', title: 'Família', sub: '10h–12h e 19h–21h', cat: 'familia' },
      meal('almoco', '12:00'),
      S('simulado', '13:00', 'Simulado completo · 5h', '60 questões + redação, cronometrado', 300),
      { ...meal('pre', '15:30'), title: 'Lanche durante o simulado' },
      S('correcao', '18:00', 'Correção do simulado · 45 min', 'Anotar cada erro e o motivo', 45),
      meal('whey', '18:45'),
      meal('jantar', '19:00'),
      { id: 'leitura', t: '21:00', title: 'Leitura · 1h', sub: 'Livro pessoal', cat: 'leitura', min: 60 },
      meal('ceia', '21:30'),
      { id: 'dormir', t: '22:15', title: 'Dormir às 22h15', sub: 'Amanhã acorda 04h45', cat: 'sono' },
    ];
  }

  if (day.type === 'servico') {
    return [
      { id: 'acordar', t: '05:45', title: 'Acordar', sub: '', cat: 'sono' },
      meal('ritual', '05:45'),
      meal('cafe', '06:15'),
      I('07:30', 'Serviço 07h30–09h30'),
      meal('lanche', '09:45'),
      S('b1', '10:00', 'Bloco 1 · 60 min', c.b1, 60),
      S('b2', '11:10', 'Bloco 2 · 60 min', c.b2, 60),
      meal('almoco', '12:15'),
      { id: 'cochilo', t: '13:00', title: 'Cochilo de 90 min', sub: 'Repor a noite partida', cat: 'sono' },
      meal('pre', '14:45'),
      { id: 'treino', t: '15:15', title: 'Treino (opcional): ' + tr, sub: trSub, cat: 'treino', optional: true },
      meal('whey', '16:30'),
      { id: 'leitura', t: '17:00', title: 'Leitura · 1h', sub: 'Livro pessoal', cat: 'leitura', min: 60 },
      meal('jantar', '18:15'),
      I('19:00', 'Serviço 19h00–19h30'),
      { id: 'sono1', t: '19:45', title: 'Sono parte 1 (até 22h40)', sub: '', cat: 'sono' },
      { ...meal('ceia', '22:45'), title: 'Ceia (antes do serviço)' },
      I('23:00', 'Serviço 23h00–00h00'),
      { id: 'sono2', t: '00:15', title: 'Sono parte 2 (até 05h30)', sub: '06h00 volta ao serviço', cat: 'sono' },
    ];
  }

  // Dia útil (seg, qua, qui, sex) e terça
  const terca = day.type === 'terca';
  const list = [
    { id: 'acordar', t: '04:45', title: 'Acordar às 04h45', sub: 'Celular longe, sem redes sociais', cat: 'sono' },
    meal('ritual', '04:45'),
    S('b1', '05:00', 'Bloco 1 · 75 min', c.b1 + ' · lei seca + questões', 75),
    meal('cafe', '06:15'),
    I('07:45', 'Trabalho 07h45–12h00'),
    meal('lanche', '09:30'),
    meal('almoco', '12:00'),
    S('b2', '12:30', 'Bloco 2 · 40 min', c.b2 + ' · só questões', 40),
    { id: 'cochilo', t: '13:10', title: 'Cochilo de 15 min', sub: 'Último café do dia ao acordar', cat: 'sono' },
    I('13:30', 'Trabalho 13h30–16h45'),
    meal('pre', '15:45'),
    { id: 'treino', t: '17:05', title: 'Treino: ' + tr, sub: trSub, cat: 'treino' },
    meal('whey', '18:20'),
    S('b3', '18:30', 'Bloco 3 · 30 min', c.b3 || 'Caderno de erros', 30),
  ];
  if (terca) {
    list.push(
      { ...meal('jantar', '19:00'), title: 'Jantar com sua esposa' },
      { id: 'familia', t: '19:00', title: 'Tempo com a família', sub: '19h00–19h45', cat: 'familia' },
      { id: 'igreja', t: '20:00', title: 'Igreja (Caminho)', sub: '20h–21h', cat: 'familia' },
      meal('ceia', '21:10'),
      { id: 'leitura', t: '21:15', title: 'Leitura · 50 min', sub: 'Livro pessoal', cat: 'leitura', min: 50 },
    );
  } else {
    list.push(
      { ...meal('jantar', '19:00'), title: 'Jantar com sua esposa' },
      { id: 'familia', t: '19:00', title: 'Tempo com a família', sub: '19h–21h, sem celular na mesa', cat: 'familia' },
      { id: 'leitura', t: '21:00', title: 'Leitura · 1h', sub: 'Livro pessoal', cat: 'leitura', min: 60 },
      meal('ceia', '21:30'),
    );
  }
  list.push({ id: 'dormir', t: '22:15', title: 'Dormir às 22h15', sub: 'Roupa e material separados', cat: 'sono' });
  return list;
}

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
const fmtNum = (n, dec = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const weekStart = (k) => { const wd = parseKey(k).getDay(); return addDays(k, wd === 0 ? -6 : 1 - wd); };

function autoType(k) {
  const wd = parseKey(k).getDay();
  return wd === 0 ? 'domingo' : wd === 6 ? 'sabado' : wd === 2 ? 'terca' : 'util';
}

// ------------------------------------------------------------------
// Estado + sincronização
// ------------------------------------------------------------------
const LS_STATE = 'rotina_state_v1';
const LS_PIN = 'rotina_pin';

function emptyState() {
  return { version: 1, updatedAt: 0, settings: { ...DEFAULTS }, days: {}, weights: [] };
}

let state = loadLocal();
let current = todayKey();
let tab = 'hoje';
let dirty = false;
let syncTimer = null;
let online = false;

function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_STATE));
    if (s && s.days) { s.settings = { ...DEFAULTS, ...s.settings }; return s; }
  } catch { /* ignora */ }
  return emptyState();
}

function saveLocal() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch { /* cheio */ }
}

function getDay(k) {
  if (!state.days[k]) {
    state.days[k] = { type: autoType(k), checks: {}, kcal: {}, extras: [], water: 0, coffee: 0, q: '', a: '' };
  }
  return state.days[k];
}

function save() {
  state.updatedAt = Date.now();
  saveLocal();
  dirty = true;
  setSync('pending');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(push, 800);
}

function headers() {
  return { 'Content-Type': 'application/json', 'x-pin': localStorage.getItem(LS_PIN) || '' };
}

async function push() {
  try {
    const r = await fetch('/api/state', { method: 'PUT', headers: headers(), body: JSON.stringify({ state }) });
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
    const r = await fetch('/api/state', { headers: headers() });
    if (r.status === 401) { showPin(); return false; }
    if (!r.ok) throw new Error();
    const { state: server } = await r.json();
    online = true;
    if (!server || (state.updatedAt || 0) > (server.updatedAt || 0)) {
      await push();
    } else if ((server.updatedAt || 0) > (state.updatedAt || 0)) {
      state = server;
      state.settings = { ...DEFAULTS, ...state.settings };
      saveLocal();
      setSync('ok');
    } else {
      setSync('ok');
    }
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
// PIN
// ------------------------------------------------------------------
function showPin(msg) {
  document.getElementById('pinModal').classList.remove('hidden');
  document.getElementById('pinError').textContent = msg || '';
  setTimeout(() => document.getElementById('pinInput').focus(), 50);
}

async function checkAuth() {
  try {
    const r = await fetch('/api/auth', { headers: headers() });
    const a = await r.json();
    if (a.pinRequired && !a.ok) { showPin(localStorage.getItem(LS_PIN) ? 'PIN incorreto.' : ''); return false; }
    return true;
  } catch {
    return true; // offline: segue com dados locais
  }
}

document.getElementById('pinOk').onclick = async () => {
  localStorage.setItem(LS_PIN, document.getElementById('pinInput').value.trim());
  if (await checkAuth()) {
    document.getElementById('pinModal').classList.add('hidden');
    await pull();
    render();
  }
};
document.getElementById('pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('pinOk').click(); });

// ------------------------------------------------------------------
// Cálculos
// ------------------------------------------------------------------
function dayStats(k) {
  const day = state.days[k];
  if (!day) return null;
  const items = buildItems(day, k);
  const checkable = items.filter((i) => !i.info && !i.optional);
  const done = checkable.filter((i) => day.checks[i.id]).length;
  let kcal = 0, prot = 0, studyDone = 0, studyPlan = 0, leitura = 0, mealsDone = 0;
  for (const i of items) {
    if (i.cat === 'refeicao' && day.checks[i.id]) {
      kcal += day.kcal[i.id] != null ? day.kcal[i.id] : i.kcal;
      prot += i.prot || 0;
      mealsDone++;
    }
    if (i.cat === 'estudo') { studyPlan += i.min; if (day.checks[i.id]) studyDone += i.min; }
    if (i.cat === 'leitura' && day.checks[i.id]) leitura += i.min;
  }
  for (const e of day.extras || []) { kcal += Number(e.kcal) || 0; prot += Number(e.prot) || 0; }
  const treinoItem = items.find((i) => i.id === 'treino');
  return {
    items, total: checkable.length, done, pct: checkable.length ? Math.round((done / checkable.length) * 100) : 0,
    kcal, prot, studyDone, studyPlan, leitura, mealsDone,
    treino: treinoItem ? !!day.checks.treino : null,
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
  toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
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

function renderHeader() {
  const t = todayKey();
  const s = state.settings;
  const left = diffDays(t, s.prova);
  const cd = document.getElementById('countdown');
  if (left > 1) cd.textContent = `Faltam ${left} dias · ${s.provaNome} ${fmtShort(s.prova).slice(5)}`;
  else if (left === 1) cd.textContent = `Prova ${s.provaNome} é amanhã · durma cedo`;
  else if (left === 0) cd.textContent = `Hoje é a prova ${s.provaNome} · confie no treino`;
  else cd.textContent = 'Foco: próxima aprovação';

  const lbl = current === t ? 'Hoje' : current === addDays(t, -1) ? 'Ontem' : current === addDays(t, 1) ? 'Amanhã' : '';
  document.getElementById('dateLabel').textContent = lbl ? `${lbl} · ${fmtShort(current).slice(5)}` : fmtShort(current);
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
  if (isToday) {
    for (const i of st.items) if (i.t <= now && i.t >= '04:00') nowId = i.id;
  }

  const items = st.items.map((i) => {
    const on = !!day.checks[i.id];
    const color = CAT_COLOR[i.cat];
    const kcalTxt = i.cat === 'refeicao' ? ` · ${day.kcal[i.id] != null ? day.kcal[i.id] : i.kcal} kcal` : '';
    if (i.info) {
      return `<div class="item info"><div class="time">${i.t}</div><div class="body"><div class="title">${esc(i.title)}</div></div></div>`;
    }
    return `<div class="item ${on ? 'done' : ''} ${i.id === nowId ? 'now' : ''}">
      <div class="time">${i.t}</div>
      <div class="body"><div class="title"><span class="tag" style="background:${color}"></span>${esc(i.title)}</div>
        <div class="sub">${esc(i.sub || '')}${kcalTxt}${i.optional ? ' · opcional' : ''}</div></div>
      <button class="check ${on ? 'on' : ''}" data-check="${i.id}" aria-label="Marcar">${on ? '✓' : ''}</button>
    </div>`;
  }).join('');

  const kpct = Math.round((st.kcal / s.kcalTarget) * 100);
  const acerto = st.q ? Math.round((st.a / st.q) * 100) : null;

  $view.innerHTML = `
    <div class="card ring-wrap">
      ${ring(st.pct)}
      <div style="flex:1">
        <div class="big" style="font-size:22px">${st.done} de ${st.total} feitos</div>
        <div class="small muted" style="margin:4px 0 8px">Estudo ${st.studyDone}/${st.studyPlan} min · ${fmtNum(st.kcal)}/${fmtNum(s.kcalTarget)} kcal</div>
        ${bar(st.studyPlan ? (st.studyDone / st.studyPlan) * 100 : 0, 'blue')}
        <div style="height:6px"></div>
        ${bar(kpct, kpct > 110 ? 'warn' : '')}
      </div>
    </div>

    <div class="card">
      <h3>Tipo de dia</h3>
      <div class="seg">${DAY_TYPES.map(([id, n]) => `<button data-type="${id}" class="${day.type === id ? 'active' : ''}">${n}</button>`).join('')}</div>
    </div>

    <div class="card"><h3>Rotina</h3>${items}</div>

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

  $view.querySelectorAll('[data-check]').forEach((b) => b.onclick = () => {
    const id = b.dataset.check;
    day.checks[id] = !day.checks[id];
    if (id === 'acordar' && day.checks[id] && !day.wake && current === todayKey()) day.wake = nowHM();
    if (day.checks[id] && navigator.vibrate) navigator.vibrate(10);
    save(); render();
  });
  $view.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { day.type = b.dataset.type; save(); render(); });
  const qf = document.getElementById('qFeitas'), qa = document.getElementById('qAcertos');
  qf.onchange = () => { day.q = qf.value; save(); render(); };
  qa.onchange = () => { day.a = qa.value; save(); render(); };
  bindHydration(day);
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
// Aba: Comida
// ------------------------------------------------------------------
function renderComida() {
  const day = getDay(current);
  const st = dayStats(current);
  const s = state.settings;
  const meals = st.items.filter((i) => i.cat === 'refeicao');
  const planned = meals.reduce((a, m) => a + (day.kcal[m.id] != null ? day.kcal[m.id] : m.kcal), 0);
  const left = s.kcalTarget - st.kcal;

  $view.innerHTML = `
    <div class="card">
      <div class="row between"><div><div class="big">${fmtNum(st.kcal)}</div><div class="muted small">de ${fmtNum(s.kcalTarget)} kcal</div></div>
        <div style="text-align:right"><div class="big" style="font-size:22px">${fmtNum(st.prot)} g</div><div class="muted small">de ${s.protTarget} g de proteína</div></div></div>
      <div style="height:10px"></div>
      ${bar((st.kcal / s.kcalTarget) * 100, st.kcal > s.kcalTarget * 1.1 ? 'warn' : '')}
      <div style="height:6px"></div>
      ${bar((st.prot / s.protTarget) * 100, 'blue')}
      <div class="small muted" style="margin-top:8px">${left > 0 ? `Faltam ${fmtNum(left)} kcal` : `Meta batida (+${fmtNum(-left)} kcal)`} · plano do dia soma ${fmtNum(planned)} kcal</div>
    </div>

    <div class="card"><h3>Refeições do plano</h3>
      ${meals.map((m) => {
        const on = !!day.checks[m.id];
        const k = day.kcal[m.id] != null ? day.kcal[m.id] : m.kcal;
        return `<div class="meal">
          <button class="check ${on ? 'on' : ''}" data-check="${m.id}">${on ? '✓' : ''}</button>
          <div style="flex:1;min-width:0"><div class="title" style="font-weight:600">${m.t} · ${esc(m.title)}</div><div class="small muted">${esc(m.sub)}</div></div>
          <button class="kcal" data-kcal="${m.id}" title="Toque para ajustar">${k}</button>
        </div>`;
      }).join('')}
      <div class="small muted" style="margin-top:8px">Toque no número para ajustar as calorias se comeu diferente.</div>
    </div>

    <div class="card"><h3>Extras / fora do plano</h3>
      ${(day.extras || []).map((e, idx) => `<div class="list-row"><span>${esc(e.name)} <span class="muted small">${e.prot ? e.prot + ' g prot.' : ''}</span></span>
        <span class="row"><b>${fmtNum(e.kcal)} kcal</b><button class="btn small danger" data-del-extra="${idx}">✕</button></span></div>`).join('') || '<div class="muted small">Nada extra hoje.</div>'}
      <div style="height:10px"></div>
      <div class="field"><input type="text" id="exName" placeholder="Ex.: açaí, pizza, salgado"></div>
      <div class="grid2">
        <input type="number" inputmode="numeric" id="exKcal" placeholder="kcal">
        <input type="number" inputmode="numeric" id="exProt" placeholder="proteína (g)">
      </div>
      <div style="height:10px"></div>
      <div class="chips" style="margin-bottom:10px">
        ${[['Pão francês', 135, 4], ['Banana', 90, 1], ['Ovo', 70, 6], ['Whey (dose)', 120, 24], ['Pasta amendoim (col.)', 95, 4], ['Leite 200 ml', 120, 6]].map(([n, k, p]) => `<button class="chip" data-quick="${esc(n)}|${k}|${p}">${n}</button>`).join('')}
      </div>
      <button class="btn primary block" id="exAdd">Adicionar</button>
    </div>
  `;

  $view.querySelectorAll('[data-check]').forEach((b) => b.onclick = () => { day.checks[b.dataset.check] = !day.checks[b.dataset.check]; save(); render(); });
  $view.querySelectorAll('[data-kcal]').forEach((b) => b.onclick = () => {
    const id = b.dataset.kcal;
    const v = prompt('Calorias desta refeição (deixe vazio para voltar ao padrão):', day.kcal[id] != null ? day.kcal[id] : MEALS[id].kcal);
    if (v === null) return;
    if (v.trim() === '') delete day.kcal[id]; else if (!isNaN(Number(v))) day.kcal[id] = Math.max(0, Math.round(Number(v)));
    save(); render();
  });
  $view.querySelectorAll('[data-del-extra]').forEach((b) => b.onclick = () => { day.extras.splice(Number(b.dataset.delExtra), 1); save(); render(); });
  $view.querySelectorAll('[data-quick]').forEach((b) => b.onclick = () => {
    const [n, k, p] = b.dataset.quick.split('|');
    day.extras.push({ name: n, kcal: Number(k), prot: Number(p) }); save(); render(); toast(`+${k} kcal`);
  });
  document.getElementById('exAdd').onclick = () => {
    const name = document.getElementById('exName').value.trim();
    const kcal = Number(document.getElementById('exKcal').value);
    const prot = Number(document.getElementById('exProt').value) || 0;
    if (!name || !kcal) { toast('Informe o nome e as kcal'); return; }
    day.extras.push({ name, kcal: Math.round(kcal), prot: Math.round(prot) }); save(); render();
  };
}

// ------------------------------------------------------------------
// Aba: Peso
// ------------------------------------------------------------------
function weightChart(ws) {
  if (ws.length < 2) return '<div class="muted small">Registre pelo menos 2 pesagens para ver o gráfico.</div>';
  const W = 340, H = 180, P = { l: 34, r: 10, t: 12, b: 24 };
  const d0 = ws[0].date, dN = ws[ws.length - 1].date;
  const span = Math.max(diffDays(d0, dN), 7);
  // linha-meta: +0,375 kg/semana a partir da 1ª pesagem
  const goalEnd = ws[0].kg + (span / 7) * 0.375;
  const kgs = ws.map((w) => w.kg).concat([goalEnd]);
  let min = Math.min(...kgs) - 0.5, max = Math.max(...kgs) + 0.5;
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
    <text x="${P.l}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmtShort(d0).slice(5)}</text>
    <text x="${W - P.r}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtShort(dN).slice(5)}</text>
  </svg>
  <div class="small muted" style="margin-top:6px">Linha verde: seu peso · tracejada: meta de +0,25 a 0,5 kg/semana (ponto médio).</div>`;
}

function weeklyRate(ws) {
  if (ws.length < 2) return null;
  const last = ws[ws.length - 1];
  // pesagem mais próxima de 7–14 dias antes
  let ref = null;
  for (let i = ws.length - 2; i >= 0; i--) {
    const dd = diffDays(ws[i].date, last.date);
    if (dd >= 6) { ref = ws[i]; break; }
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
        <div class="field"><label>Data</label><input type="date" id="wDate" value="${current}"></div>
        <div class="field"><label>Peso (kg)</label><input type="number" inputmode="decimal" step="0.1" id="wKg" placeholder="81,0"></div>
      </div>
      <button class="btn primary block" id="wSave">Salvar pesagem</button>
    </div>

    <div class="card"><h3>Histórico</h3>
      ${ws.slice().reverse().map((w) => `<div class="list-row"><span>${fmtShort(w.date)}</span><span class="row"><b>${fmtNum(w.kg, 1)} kg</b><button class="btn small danger" data-del-w="${w.date}">✕</button></span></div>`).join('') || '<div class="muted small">Nenhuma pesagem ainda. Comece com o peso de hoje.</div>'}
    </div>
  `;

  document.getElementById('wSave').onclick = () => {
    const date = document.getElementById('wDate').value;
    const kg = Number(String(document.getElementById('wKg').value).replace(',', '.'));
    if (!date || !kg || kg < 30 || kg > 250) { toast('Peso inválido'); return; }
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
  const studyPlan = days.reduce((a, k) => a + (state.days[k] ? dayStats(k).studyPlan : buildItems({ type: autoType(k) }, k).filter((i) => i.cat === 'estudo').reduce((b, i) => b + i.min, 0)), 0);
  const q = sum((s) => s.q), a = sum((s) => s.a);
  const treinos = stats.filter((x) => x.s && x.s.treino).length;
  const leitura = sum((s) => s.leitura);
  const kcalDays = stats.filter((x) => x.s && x.s.kcal > 0);
  const kcalAvg = kcalDays.length ? Math.round(kcalDays.reduce((acc, x) => acc + x.s.kcal, 0) / kcalDays.length) : 0;
  const tracked = stats.filter((x) => x.s && x.k <= t);
  const avgPct = tracked.length ? Math.round(tracked.reduce((acc, x) => acc + x.s.pct, 0) / tracked.length) : 0;
  const famDays = stats.filter((x) => x.s && x.s.items.some((i) => i.id === 'familia') && state.days[x.k].checks.familia).length;

  $view.innerHTML = `
    <div class="card">
      <div class="row between" style="margin-bottom:12px">
        <button class="btn small" id="wPrev">‹ Semana</button>
        <b>${fmtShort(days[0]).slice(5)} – ${fmtShort(days[6]).slice(5)}</b>
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
        <div class="stat"><div class="v">${treinos}/6</div><div class="l">Treinos feitos</div>${bar((treinos / 6) * 100)}</div>
        <div class="stat"><div class="v">${fmtNum(leitura / 60, 1)} h</div><div class="l">Leitura (meta 7 h)</div>${bar((leitura / 420) * 100)}</div>
        <div class="stat"><div class="v">${kcalAvg ? fmtNum(kcalAvg) : '–'}</div><div class="l">kcal média/dia (meta ${fmtNum(state.settings.kcalTarget)})</div></div>
        <div class="stat"><div class="v">${famDays}/7</div><div class="l">Dias com tempo de família</div></div>
      </div>
    </div>
  `;
  document.getElementById('wPrev').onclick = () => { current = addDays(current, -7); render(); };
  document.getElementById('wNext').onclick = () => { current = addDays(current, 7); render(); };
  $view.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => { current = el.dataset.go; setTab('hoje'); });
}

// ------------------------------------------------------------------
// Aba: Check-in
// ------------------------------------------------------------------
function checkinText(k) {
  const day = getDay(k);
  const st = dayStats(k);
  const blocos = st.items.filter((i) => i.cat === 'estudo').map((i) => (day.checks[i.id] ? '✓' : '✗') + ' ' + i.id.toUpperCase()).join(' ');
  const tomorrow = state.days[addDays(k, 1)];
  const serv = tomorrow ? tomorrow.type === 'servico' : false;
  const fam = st.items.some((i) => i.id === 'familia') ? (day.checks.familia ? 'ok' : 'faltou') : 'n/a';
  return [
    `CHECK-IN ${fmtShort(k)}`,
    `1. Acordei às: ${day.wake || '—'}`,
    `2. Blocos de estudo: ${blocos} (${st.studyDone}/${st.studyPlan} min)`,
    `3. Questões / acertos: ${st.q} / ${st.a}${st.q ? ` (${Math.round((st.a / st.q) * 100)}%)` : ''}`,
    `4. Treino: ${st.treino == null ? 'não previsto' : st.treino ? 'feito' : 'não feito'}`,
    `5. Dieta (0 a 10): ${day.dieta ?? '—'} · ${fmtNum(st.kcal)} kcal · ${st.prot} g prot. · água ${fmtNum(day.water)} ml`,
    `6. Leitura: ${st.leitura} min`,
    `7. Tempo com a família: ${fam}`,
    `8. Nota do dia: ${day.nota ?? '—'} · ${day.obs ? 'O que atrapalhou: ' + day.obs : 'nada a relatar'}`,
    `9. Amanhã tenho serviço? ${serv ? 'sim' : 'não'}`,
    `Cumprimento da rotina: ${st.pct}% (${st.done}/${st.total})`,
  ].join('\n');
}

function renderCheckin() {
  const day = getDay(current);
  const tk = addDays(current, 1);
  const serv = state.days[tk] && state.days[tk].type === 'servico';
  const chips = (field) => Array.from({ length: 11 }, (_, n) => `<button class="chip ${day[field] === n ? 'on' : ''}" data-${field}="${n}">${n}</button>`).join('');

  $view.innerHTML = `
    <div class="card"><h3>Preencha antes de dormir</h3>
      <div class="field"><label>Acordei às</label><input type="time" id="ciWake" value="${esc(day.wake || '')}"></div>
      <div class="field"><label>Dieta (0 a 10)</label><div class="chips">${chips('dieta')}</div></div>
      <div class="field"><label>Nota do dia (0 a 10)</label><div class="chips">${chips('nota')}</div></div>
      <div class="field"><label>O que atrapalhou?</label><textarea id="ciObs" placeholder="Ex.: dormi tarde, serviço puxado...">${esc(day.obs || '')}</textarea></div>
      <div class="row between"><span>Amanhã tenho serviço</span><button class="chip ${serv ? 'on' : ''}" id="ciServ">${serv ? 'Sim' : 'Não'}</button></div>
    </div>
    <div class="card"><h3>Mensagem para o coach</h3>
      <pre class="checkin" id="ciText">${esc(checkinText(current))}</pre>
      <button class="btn primary block" id="ciCopy">Copiar check-in</button>
      <div class="small muted" style="margin-top:8px">Cole na conversa com o Claude para ajustar o dia seguinte.</div>
    </div>
  `;

  document.getElementById('ciWake').onchange = (e) => { day.wake = e.target.value; save(); render(); };
  document.getElementById('ciObs').onchange = (e) => { day.obs = e.target.value.trim(); save(); render(); };
  $view.querySelectorAll('[data-dieta]').forEach((b) => b.onclick = () => { day.dieta = Number(b.dataset.dieta); save(); render(); });
  $view.querySelectorAll('[data-nota]').forEach((b) => b.onclick = () => { day.nota = Number(b.dataset.nota); save(); render(); });
  document.getElementById('ciServ').onclick = () => {
    const td = getDay(tk);
    td.type = td.type === 'servico' ? autoType(tk) : 'servico';
    save(); render();
  };
  document.getElementById('ciCopy').onclick = async () => {
    const txt = checkinText(current);
    try { await navigator.clipboard.writeText(txt); toast('Check-in copiado'); }
    catch {
      const r = document.createRange(); r.selectNodeContents(document.getElementById('ciText'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Texto selecionado — toque em Copiar');
    }
  };
}

// ------------------------------------------------------------------
// Ajustes
// ------------------------------------------------------------------
function renderAjustes() {
  const s = state.settings;
  $view.innerHTML = `
    <div class="card"><h3>Metas</h3>
      <div class="grid2">
        <div class="field"><label>Calorias/dia</label><input type="number" id="sK" value="${s.kcalTarget}"></div>
        <div class="field"><label>Proteína/dia (g)</label><input type="number" id="sP" value="${s.protTarget}"></div>
        <div class="field"><label>Água/dia (ml)</label><input type="number" id="sW" value="${s.waterTarget}"></div>
        <div class="field"><label>Café máx. (ml)</label><input type="number" id="sC" value="${s.coffeeMax}"></div>
      </div>
    </div>
    <div class="card"><h3>Próxima prova</h3>
      <div class="grid2">
        <div class="field"><label>Nome</label><input type="text" id="sN" value="${esc(s.provaNome)}"></div>
        <div class="field"><label>Data</label><input type="date" id="sD" value="${s.prova}"></div>
      </div>
    </div>
    <button class="btn primary block" id="sSave">Salvar ajustes</button>
    <div style="height:12px"></div>
    <div class="card"><h3>Backup</h3>
      <div class="grid2">
        <button class="btn" id="sExport">Exportar dados</button>
        <label class="btn" style="text-align:center">Importar<input type="file" id="sImport" accept="application/json" class="hidden"></label>
      </div>
      <div class="small muted" style="margin-top:8px">Status: ${online ? 'sincronizado com o servidor' : 'offline — dados salvos no celular'}.</div>
    </div>
    <div class="card"><h3>Sessão</h3>
      <button class="btn danger block" id="sLogout">Sair (pedir PIN de novo)</button>
    </div>
    <button class="btn block" id="sBack">‹ Voltar</button>
  `;
  document.getElementById('sSave').onclick = () => {
    s.kcalTarget = Number(document.getElementById('sK').value) || DEFAULTS.kcalTarget;
    s.protTarget = Number(document.getElementById('sP').value) || DEFAULTS.protTarget;
    s.waterTarget = Number(document.getElementById('sW').value) || DEFAULTS.waterTarget;
    s.coffeeMax = Number(document.getElementById('sC').value) || DEFAULTS.coffeeMax;
    s.provaNome = document.getElementById('sN').value.trim() || 'Prova';
    s.prova = document.getElementById('sD').value || DEFAULTS.prova;
    save(); toast('Ajustes salvos'); setTab('hoje');
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
      const s2 = JSON.parse(await f.text());
      if (!s2.days) throw new Error();
      if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
      state = s2; state.settings = { ...DEFAULTS, ...state.settings };
      save(); toast('Backup importado'); setTab('hoje');
    } catch { toast('Arquivo inválido'); }
  };
  document.getElementById('sLogout').onclick = () => { localStorage.removeItem(LS_PIN); showPin(); };
  document.getElementById('sBack').onclick = () => setTab('hoje');
}

// ------------------------------------------------------------------
// Navegação
// ------------------------------------------------------------------
function render() {
  renderHeader();
  ({ hoje: renderHoje, comida: renderComida, peso: renderPeso, semana: renderSemana, checkin: renderCheckin, ajustes: renderAjustes })[tab]();
}

function setTab(t) {
  tab = t;
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
  if (document.visibilityState !== 'visible') return;
  if (todayKey() !== lastSeenDay) { lastSeenDay = todayKey(); current = lastSeenDay; }
  if (dirty) await push(); else await pull();
  render();
});
window.addEventListener('online', () => { if (dirty) push(); });

// ------------------------------------------------------------------
// Início
// ------------------------------------------------------------------
(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  setSync(dirty ? 'pending' : 'err');
  render();
  if (await checkAuth()) { await pull(); render(); }
})();
