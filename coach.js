// Coach: conversa com o Claude, que pode ajustar a rotina.
// As alterações usam as mesmas regras de edição do app (public/rotina-core.js).
//
// Dois motores (igual ao projeto Cantos Caminho):
// - 'cli' (padrão): Claude Code em modo não interativo (claude -p) com o token da sua
//   assinatura do Claude (CLAUDE_CODE_OAUTH_TOKEN). Sem custo por mensagem.
// - 'api': só se ANTHROPIC_API_KEY estiver definida (cobra por uso).
const { Anthropic } = require('@anthropic-ai/sdk');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./public/rotina-core.js');

class CoachError extends Error {}

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 8;
const HISTORY = 24; // mensagens anteriores enviadas como contexto

let client = null;
function getClient() {
  if (!client) client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
  return client;
}

const SYSTEM = `Você é o coach pessoal de rotina do usuário, dentro do app "Rotina". Ele se prepara para concursos policiais (PMSC e depois PRF), trabalha, tem plantões de serviço, treina, cuida da alimentação para ganhar massa e valoriza tempo com a esposa, a família e a igreja.

Como responder:
- Português do Brasil, tom de conversa de app de mensagens: direto, caloroso, sem enrolação. Normalmente 2 a 6 frases. Sem markdown pesado (no máximo listas curtas com hífen).
- Baseie-se no contexto enviado em <contexto> (rotina atual, últimos dias, check-ins, peso). Não invente dados.
- Calorias são sempre aproximadas; o usuário não quer contar calorias com precisão.
- Não dê orientação médica arriscada; sugira procurar um profissional quando fizer sentido.

Quando alterar a rotina (use as ferramentas, não apenas descreva):
- Quando o usuário pedir uma mudança, faça a mudança.
- Quando receber um CHECK-IN, analise o dia em poucas linhas (o que foi bem, o que ajustar) e, se algo precisar mudar para o dia seguinte, ajuste o dia seguinte com scope "dia". Mude o modelo permanente só se o problema se repetir ou o usuário pedir.
- scope "dia" = só uma data (AAAA-MM-DD). scope "modelo" = todas as semanas daquele modelo (seg, ter, qua, qui, sex, sab, dom, servico).
- Para editar ou excluir, use exatamente o id mostrado no contexto. Para criar, omita o id.
- Horários em HH:MM (24 h). Mantenha títulos curtos; detalhes vão na descrição.
- Se o pedido for ambíguo e a mudança for grande, pergunte antes de alterar.
- Depois de alterar, diga em uma frase o que mudou.`;

const TEMPLATE_ENUM = core.TEMPLATE_KEYS;
const CAT_ENUM = Object.keys(core.CATS);

const TOOLS = [
  {
    name: 'upsert_event',
    description: 'Cria ou edita um evento da rotina. Para editar, passe o id existente (os campos enviados substituem os atuais). Para criar, omita o id.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['dia', 'modelo'], description: '"dia" altera só a data informada; "modelo" altera todas as semanas do modelo.' },
        date: { type: 'string', description: 'Data AAAA-MM-DD (obrigatória com scope "dia").' },
        template: { type: 'string', enum: TEMPLATE_ENUM, description: 'Modelo (obrigatório com scope "modelo").' },
        id: { type: 'string', description: 'Id do evento a editar. Omita para criar um novo.' },
        time: { type: 'string', description: 'Horário HH:MM.' },
        title: { type: 'string', description: 'Título curto (até 80 caracteres).' },
        description: { type: 'string', description: 'Detalhes (até 160 caracteres).' },
        category: { type: 'string', enum: CAT_ENUM },
        duration_min: { type: 'integer', description: 'Duração em minutos (conta nas horas de estudo/leitura).' },
        kcal: { type: 'integer', description: 'Calorias aproximadas (só para refeição).' },
        optional: { type: 'boolean', description: 'Não conta no % de cumprimento.' },
        info: { type: 'boolean', description: 'Só informativo, sem marcar como feito (ex.: horário de trabalho).' },
      },
      required: ['scope', 'time', 'title', 'category'],
    },
  },
  {
    name: 'delete_event',
    description: 'Exclui um evento da rotina pelo id.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['dia', 'modelo'] },
        date: { type: 'string', description: 'Data AAAA-MM-DD (obrigatória com scope "dia").' },
        template: { type: 'string', enum: TEMPLATE_ENUM, description: 'Modelo (obrigatório com scope "modelo").' },
        id: { type: 'string' },
      },
      required: ['scope', 'id'],
    },
  },
  {
    name: 'set_day_type',
    description: 'Define qual modelo um dia segue (ex.: marcar um dia como "servico", ou um feriado como "dom"). Descarta ajustes próprios daquele dia.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data AAAA-MM-DD.' },
        template: { type: 'string', enum: TEMPLATE_ENUM },
      },
      required: ['date', 'template'],
    },
  },
  {
    name: 'update_settings',
    description: 'Ajusta metas gerais do app.',
    input_schema: {
      type: 'object',
      properties: {
        kcal_target: { type: 'integer', description: 'Meta aproximada de kcal por dia.' },
        water_target_ml: { type: 'integer' },
        coffee_max_ml: { type: 'integer' },
        exam_name: { type: 'string', description: 'Nome da próxima prova.' },
        exam_date: { type: 'string', description: 'Data da próxima prova AAAA-MM-DD.' },
      },
      required: [],
    },
  },
];

// ------------------------------------------------------------------
// Contexto enviado a cada mensagem
// ------------------------------------------------------------------
const TPL = Object.fromEntries(core.TEMPLATES.map(([k, s, p]) => [k, { short: s, plural: p }]));
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const wdName = (k) => { const [y, m, d] = k.split('-').map(Number); return WD[new Date(y, m - 1, d).getDay()]; };
const dm = (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;

function itemLine(i) {
  const extra = [i.min ? `${i.min} min` : '', i.kcal ? `≈${i.kcal} kcal` : '', i.optional ? 'opcional' : '', i.info ? 'informativo' : ''].filter(Boolean).join(', ');
  return `  [${i.id}] ${i.t} (${i.cat}) ${i.title}${i.sub ? ' — ' + i.sub : ''}${extra ? ' {' + extra + '}' : ''}`;
}

function buildContext(state, today, now) {
  const s = state.settings || {};
  const out = [];
  out.push(`Hoje: ${today} (${wdName(today)}), agora ${now}.`);
  out.push(`Metas: ≈${s.kcalTarget} kcal/dia, água ${s.waterTarget} ml, café até ${s.coffeeMax} ml. Próxima prova: ${s.provaNome} em ${s.prova}.`);
  out.push('', 'MODELOS DA ROTINA (cada dia segue um modelo; por padrão o do dia da semana):');
  for (const k of core.TEMPLATE_KEYS) {
    out.push(`Modelo "${k}" (${TPL[k].plural}):`);
    for (const i of state.templates[k] || []) out.push(itemLine(i));
  }
  out.push('', 'PRÓXIMOS 7 DIAS:');
  for (let n = 0; n < 7; n++) {
    const k = addDays(today, n);
    const day = state.days[k];
    const type = day ? day.type : core.weekdayKey(k);
    out.push(`${k} (${wdName(k)}): modelo "${type}"${day && day.items ? ' com ajustes só deste dia:' : ''}`);
    if (day && day.items) for (const i of day.items) out.push(itemLine(i));
  }
  out.push('', 'ÚLTIMOS 7 DIAS:');
  for (let n = 7; n >= 1; n--) {
    const k = addDays(today, -n);
    const day = state.days[k];
    if (!day) { out.push(`${k} (${wdName(k)}): sem registro`); continue; }
    const items = core.itemsFor(state, k).filter((i) => !i.info && !i.optional);
    const done = items.filter((i) => day.checks && day.checks[i.id]);
    const missed = items.filter((i) => !(day.checks && day.checks[i.id])).map((i) => i.title);
    const late = done.filter((i) => day.times && day.times[i.id] && day.times[i.id] !== i.t).map((i) => `${i.title} às ${day.times[i.id]} (prev. ${i.t})`);
    out.push(`${k} (${wdName(k)}, modelo ${day.type}): ${done.length}/${items.length} feitos` +
      (missed.length ? `; não feitos: ${missed.slice(0, 12).join(', ')}` : '') +
      (late.length ? `; fora do horário: ${late.slice(0, 6).join(', ')}` : '') +
      (day.q ? `; questões ${day.q} (acertos ${day.a || 0})` : '') +
      (day.dieta != null ? `; dieta ${day.dieta}/10` : '') +
      (day.nota != null ? `; nota ${day.nota}/10` : '') +
      (day.obs ? `; atrapalhou: ${day.obs}` : ''));
  }
  const ws = (state.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-8);
  out.push('', 'PESO (últimas pesagens): ' + (ws.length ? ws.map((w) => `${dm(w.date)} ${w.kg} kg`).join(', ') : 'sem registros'));
  return out.join('\n');
}

// ------------------------------------------------------------------
// Ferramentas
// ------------------------------------------------------------------
function where(input) {
  return input.scope === 'dia' ? `em ${dm(input.date)}` : `em todas as ${TPL[input.template] ? TPL[input.template].plural : input.template}`;
}

function checkScope(input) {
  if (input.scope === 'dia' && !core.isDate(input.date)) throw new Error('Com scope "dia", informe date no formato AAAA-MM-DD.');
  if (input.scope === 'modelo' && !core.TEMPLATE_KEYS.includes(input.template)) throw new Error('Com scope "modelo", informe template válido.');
  if (input.scope !== 'dia' && input.scope !== 'modelo') throw new Error('scope deve ser "dia" ou "modelo".');
}

function findExisting(state, input) {
  if (!input.id) return null;
  const list = input.scope === 'dia' ? core.itemsFor(state, input.date) : state.templates[input.template] || [];
  return list.find((i) => i.id === input.id) || null;
}

function runTool(state, name, input) {
  if (!input || typeof input !== 'object') throw new Error('Entrada inválida.');
  if (name === 'upsert_event') {
    checkScope(input);
    const existing = findExisting(state, input);
    if (input.id && !existing) throw new Error(`Evento ${input.id} não encontrado nesse ${input.scope}. Para criar, omita o id.`);
    const item = {
      ...(existing || {}),
      id: existing ? existing.id : core.newId(),
      t: input.time,
      title: input.title,
      sub: input.description !== undefined ? input.description : existing ? existing.sub : '',
      cat: input.category,
    };
    if (input.duration_min !== undefined) item.min = input.duration_min;
    if (input.kcal !== undefined) item.kcal = input.kcal;
    if (input.optional !== undefined) item.optional = input.optional;
    if (input.info !== undefined) item.info = input.info;
    const saved = core.upsertEvent(state, { scope: input.scope, template: input.template, date: input.date, item });
    const change = `${existing ? 'Editado' : 'Adicionado'} "${saved.title}" às ${saved.t} ${where(input)}`;
    return { result: `OK: ${change}. id=${saved.id}`, change };
  }
  if (name === 'delete_event') {
    checkScope(input);
    const removed = core.deleteEvent(state, { scope: input.scope, template: input.template, date: input.date, id: input.id });
    const change = `Removido "${removed.title}" (${removed.t}) ${where(input)}`;
    return { result: 'OK: ' + change, change };
  }
  if (name === 'set_day_type') {
    core.setDayType(state, input.date, input.template);
    const change = `${dm(input.date)} passa a seguir o modelo de ${TPL[input.template].plural}`;
    return { result: 'OK: ' + change, change };
  }
  if (name === 'update_settings') {
    const s = state.settings;
    const parts = [];
    const n = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    if (input.kcal_target !== undefined) { if (!n(input.kcal_target, 1000, 6000)) throw new Error('kcal_target fora do intervalo'); s.kcalTarget = input.kcal_target; parts.push(`meta ≈${input.kcal_target} kcal`); }
    if (input.water_target_ml !== undefined) { if (!n(input.water_target_ml, 500, 8000)) throw new Error('water_target_ml fora do intervalo'); s.waterTarget = input.water_target_ml; parts.push(`água ${input.water_target_ml} ml`); }
    if (input.coffee_max_ml !== undefined) { if (!n(input.coffee_max_ml, 0, 2000)) throw new Error('coffee_max_ml fora do intervalo'); s.coffeeMax = input.coffee_max_ml; parts.push(`café até ${input.coffee_max_ml} ml`); }
    if (input.exam_name !== undefined) { s.provaNome = String(input.exam_name).slice(0, 40); parts.push(`prova ${s.provaNome}`); }
    if (input.exam_date !== undefined) { if (!core.isDate(input.exam_date)) throw new Error('exam_date inválida'); s.prova = input.exam_date; parts.push(`data da prova ${dm(input.exam_date)}`); }
    if (!parts.length) throw new Error('Nenhuma meta informada.');
    const change = 'Metas: ' + parts.join(', ');
    return { result: 'OK: ' + change, change };
  }
  throw new Error('Ferramenta desconhecida: ' + name);
}

// ------------------------------------------------------------------
// Conversa
// ------------------------------------------------------------------
function historyMessages(state) {
  const msgs = [];
  for (const m of (state.coach && state.coach.messages ? state.coach.messages : []).slice(-HISTORY)) {
    let text = m.text;
    if (m.role === 'assistant' && m.changes && m.changes.length) text += `\n[Alterações feitas: ${m.changes.join('; ')}]`;
    msgs.push({ role: m.role, content: text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

async function runCoachApi({ state, message, today, now, isCheckin }) {
  const messages = historyMessages(state);
  const intro = isCheckin
    ? 'Check-in automático do dia (enviado pelo app). Analise e ajuste o dia seguinte se precisar.'
    : 'Mensagem do usuário:';
  messages.push({ role: 'user', content: `<contexto>\n${buildContext(state, today, now)}\n</contexto>\n\n${intro}\n${message}` });

  const changes = [];
  let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) reply = text;

    if (response.stop_reason === 'refusal') {
      reply = 'Não consigo ajudar com esse pedido. Pode reformular?';
      break;
    }
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const { result, change } = runTool(state, block.name, block.input);
        changes.push(change);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Erro: ' + e.message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  if (!reply) reply = changes.length ? 'Pronto, ajustei sua rotina.' : 'Certo!';
  return { reply, changes };
}

// ------------------------------------------------------------------
// Motor 'cli': Claude Code com o token da assinatura (sem custo por mensagem)
// ------------------------------------------------------------------
function motor() {
  const m = process.env.COACH_MOTOR;
  if (m === 'api' || m === 'cli') return m;
  return process.env.ANTHROPIC_API_KEY ? 'api' : 'cli';
}

// Executável do Claude Code instalado pelo npm (node_modules), ou CLAUDE_CLI.
function cliCommand() {
  const custom = process.env.CLAUDE_CLI;
  if (custom) return custom.endsWith('.js') || custom.endsWith('.cjs') ? [process.execPath, custom] : [custom];
  const dir = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code');
  const bin = path.join(dir, 'bin', 'claude.exe');
  try {
    // O postinstall copia o binário nativo para bin/claude.exe; sem ele, usa o lançador de reserva
    if (fs.statSync(bin).size > 1024 * 1024) return [bin];
    const wrapper = path.join(dir, 'cli-wrapper.cjs');
    if (fs.existsSync(wrapper)) return [process.execPath, wrapper];
  } catch { /* não instalado */ }
  return null;
}

function coachStatus() {
  const m = motor();
  if (m === 'api') return { ok: true, motor: m };
  if (!cliCommand()) return { ok: false, motor: m, message: 'Claude Code não está instalado no servidor (rode npm install).' };
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.RAILWAY_ENVIRONMENT) {
    return { ok: false, motor: m, message: 'Coach ainda não configurado: crie a variável CLAUDE_CODE_OAUTH_TOKEN no Railway (gere com "claude setup-token").' };
  }
  return { ok: true, motor: m };
}

// As ferramentas viram "ações" numa resposta em JSON estruturado
const ACTION_FIELDS = {};
for (const t of TOOLS) for (const [k, v] of Object.entries(t.input_schema.properties)) ACTION_FIELDS[k] = v;
const CLI_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Mensagem para o usuário.' },
    actions: {
      type: 'array',
      description: 'Alterações na rotina, aplicadas na ordem. Vazio se nada mudar.',
      items: {
        type: 'object',
        properties: { tool: { type: 'string', enum: TOOLS.map((t) => t.name) }, ...ACTION_FIELDS },
        required: ['tool'],
      },
    },
  },
  required: ['reply', 'actions'],
};

const ACTIONS_DOC = TOOLS.map((t) => {
  const req = t.input_schema.required.length ? ` Obrigatórios: ${t.input_schema.required.join(', ')}.` : '';
  const fields = Object.keys(t.input_schema.properties).join(', ');
  return `- tool "${t.name}": ${t.description}${req} Campos: ${fields}.`;
}).join('\n');

const SYSTEM_CLI = SYSTEM.replace('(use as ferramentas, não apenas descreva)', '(coloque cada alteração em "actions"; não apenas descreva)') + `

Formato da resposta: JSON com "reply" (a mensagem para o usuário) e "actions" (lista de alterações). Ações disponíveis:
${ACTIONS_DOC}`;

function loginMessage() {
  return process.env.RAILWAY_ENVIRONMENT
    ? 'O token do Claude é inválido ou expirou. Gere outro com "claude setup-token" e atualize CLAUDE_CODE_OAUTH_TOKEN no Railway.'
    : 'O Claude Code não está conectado à sua conta. Rode "claude setup-token" (ou "claude auth login") neste computador.';
}

function runCli(prompt) {
  const cmd = cliCommand();
  if (!cmd) return Promise.reject(new CoachError('Claude Code não está instalado no servidor.'));
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', process.env.COACH_MODEL || 'opus',
    '--effort', process.env.COACH_EFFORT || 'medium',
    '--tools', '',
    '--json-schema', JSON.stringify(CLI_SCHEMA),
    '--system-prompt', SYSTEM_CLI,
    '--no-session-persistence',
    '--disable-slash-commands',
    '--strict-mcp-config',
  ];
  // Garante o login da assinatura: sem chave de API nem proxy herdados do ambiente
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: os.tmpdir(), env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new CoachError('O coach demorou demais para responder. Tente de novo.')); }, 5 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new CoachError('Não foi possível iniciar o Claude Code: ' + e.message)); });
    child.on('close', () => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch {
        const detail = (err || out).trim();
        if (/login|auth|token|credential/i.test(detail)) return reject(new CoachError(loginMessage()));
        return reject(new CoachError('Resposta inesperada do Claude Code: ' + detail.slice(0, 200)));
      }
      if (res.is_error) {
        const msg = String(res.result || res.error || 'erro desconhecido');
        if (/login|auth|token|credential|401/i.test(msg)) return reject(new CoachError(loginMessage()));
        if (/limit|quota|usage/i.test(msg)) return reject(new CoachError('Limite de uso da sua assinatura do Claude atingido. Tente mais tarde.'));
        return reject(new CoachError('Claude Code: ' + msg.slice(0, 200)));
      }
      if (res.structured_output && typeof res.structured_output === 'object') return resolve(res.structured_output);
      const txt = String(res.result || '');
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      try { return resolve(JSON.parse(txt.slice(a, b + 1))); } catch { /* segue */ }
      resolve({ reply: txt.trim() || 'Certo!', actions: [] });
    });
    child.stdin.on('error', () => { /* processo encerrou antes de ler */ });
    child.stdin.end(prompt);
  });
}

async function runCoachCli({ state, message, today, now, isCheckin }) {
  const hist = historyMessages(state).map((m) => `${m.role === 'user' ? 'USUÁRIO' : 'COACH'}: ${m.content}`).join('\n\n');
  const intro = isCheckin
    ? 'Check-in automático do dia (enviado pelo app). Analise e ajuste o dia seguinte se precisar.'
    : 'Nova mensagem do usuário:';
  const prompt = (hist ? `CONVERSA ANTERIOR:\n${hist}\n\n==========\n\n` : '') +
    `<contexto>\n${buildContext(state, today, now)}\n</contexto>\n\n${intro}\n${message}\n\n` +
    'Responda somente com o JSON no formato do schema (reply + actions), sem texto fora dele.';
  const out = await runCli(prompt);
  const changes = [];
  const failed = [];
  for (const action of Array.isArray(out.actions) ? out.actions.slice(0, 20) : []) {
    try {
      const { change } = runTool(state, action && action.tool, action);
      changes.push(change);
    } catch (e) {
      failed.push(e.message);
    }
  }
  let reply = typeof out.reply === 'string' && out.reply.trim() ? out.reply.trim() : (changes.length ? 'Pronto, ajustei sua rotina.' : 'Certo!');
  if (failed.length) reply += `\n\n(Não consegui aplicar ${failed.length} alteração(ões): ${failed.join('; ').slice(0, 300)})`;
  return { reply, changes };
}

function runCoach(args) {
  return motor() === 'api' ? runCoachApi(args) : runCoachCli(args);
}

function friendlyError(e) {
  if (e instanceof CoachError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'A chave da API do Claude é inválida (variável ANTHROPIC_API_KEY no Railway).';
  if (e instanceof Anthropic.PermissionDeniedError) return 'A chave da API do Claude não tem permissão para este modelo.';
  if (e instanceof Anthropic.RateLimitError) return 'Limite de uso da API do Claude atingido. Tente de novo em alguns minutos.';
  if (e instanceof Anthropic.BadRequestError) return 'O Claude recusou a requisição: ' + (e.message || '').slice(0, 200);
  if (e instanceof Anthropic.APIConnectionError) return 'Não foi possível falar com o Claude agora. Tente de novo.';
  if (e instanceof Anthropic.APIError) return `Erro do Claude (${e.status || '?'}). Tente de novo.`;
  return 'O coach teve um erro inesperado. Tente de novo.';
}

module.exports = { runCoach, coachStatus, friendlyError, buildContext, runTool, TOOLS, SYSTEM, CLI_SCHEMA };
