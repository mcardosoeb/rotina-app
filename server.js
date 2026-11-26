// Rotina PMSC — servidor sem dependências (Node 18+)
// Serve os arquivos de /public e guarda os dados em DATA_DIR/state.json
//
// Segurança:
// - PIN obrigatório (APP_PIN). Sem PIN, a API fica bloqueada.
// - Login troca o PIN por uma sessão em cookie HttpOnly (o PIN não fica salvo no celular).
// - "Lembrar neste aparelho": sessão de 90 dias, renovada com o uso. Sem lembrar: 12 h e
//   some ao fechar o app.
// - Bloqueio de tentativas por IP e bloqueio geral contra ataques de vários IPs.
// - Trocar o APP_PIN no Railway derruba todas as sessões.
// - Cabeçalhos de segurança (CSP, HSTS, sem iframe, sem indexação).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_PIN = process.env.APP_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB
const MAX_LOGIN_BODY = 1024;

const COOKIE = 'rotina_sid';
const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_TTL = 90 * DAY;
const SHORT_TTL = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

// Bloqueio de tentativas
const IP_MAX_FAILS = 5; // erros seguidos por IP antes de bloquear
const IP_BASE_LOCK = 15 * 60 * 1000; // 15 min, dobra a cada novo bloqueio (máx. 24 h)
const GLOBAL_WINDOW = 60 * 60 * 1000; // 1 h
const GLOBAL_MAX_FAILS = 30; // erros somando todos os IPs na janela
const GLOBAL_LOCK = 30 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Identifica o PIN atual sem guardá-lo: trocar o PIN invalida as sessões antigas
const PIN_ID = APP_PIN ? sha256('rotina-pin:' + APP_PIN).slice(0, 16) : '';

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function send(req, res, status, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  res.writeHead(status, h);
  res.end(body);
}

function json(req, res, status, obj, headers = {}) {
  send(req, res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], ...headers });
}

function clientIp(req) {
  // Railway fica atrás de proxy, que acrescenta o IP real no fim do X-Forwarded-For.
  // Os primeiros valores podem ser forjados pelo cliente, então usamos o último.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, token, maxAgeMs) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join('; ');
}

function clearCookie(req) {
  return sessionCookie(req, '', 0);
}

function pinMatches(given) {
  // Compara hashes de tamanho fixo: não vaza o tamanho do PIN nem o tempo de comparação
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(APP_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Bloqueia requisições que mudam dados vindas de outro site
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // apps nativos/curl; o cookie SameSite=Strict já protege o navegador
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Dados
// ------------------------------------------------------------------
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------------
// Sessões (guardadas como hash do token: quem ler o arquivo não consegue entrar)
// ------------------------------------------------------------------
let sessions = loadSessions();

function loadSessions() {
  const s = readJson(SESSIONS_FILE);
  if (!s || s.pinId !== PIN_ID || !Array.isArray(s.list)) return []; // PIN trocado: derruba todos
  const now = Date.now();
  return s.list.filter((x) => x.exp > now);
}

function saveSessions() {
  writeJson(SESSIONS_FILE, { pinId: PIN_ID, list: sessions });
}

function createSession(remember, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const ttl = remember ? REMEMBER_TTL : SHORT_TTL;
  sessions = sessions.filter((x) => x.exp > now);
  sessions.push({ h: sha256(token), remember, created: now, seen: now, exp: now + ttl, ua: String(req.headers['user-agent'] || '').slice(0, 120) });
  if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
  saveSessions();
  return { token, ttl };
}

function findSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const h = sha256(token);
  const now = Date.now();
  const s = sessions.find((x) => x.h === h);
  if (!s) return null;
  if (s.exp <= now) {
    sessions = sessions.filter((x) => x !== s);
    saveSessions();
    return null;
  }
  return { s, token };
}

// Sessões lembradas são renovadas com o uso (no máx. 1 gravação por dia)
function touchSession(found, req, res) {
  const { s, token } = found;
  const now = Date.now();
  if (now - s.seen < DAY) return;
  s.seen = now;
  if (s.remember) {
    s.exp = now + REMEMBER_TTL;
    res.setHeader('Set-Cookie', sessionCookie(req, token, REMEMBER_TTL));
  }
  saveSessions();
}

// ------------------------------------------------------------------
// Bloqueio de tentativas
// ------------------------------------------------------------------
const ipFails = new Map(); // ip -> { fails, locks, until }
let globalFails = [];
let globalUntil = 0;

function lockStatus(ip) {
  const now = Date.now();
  if (globalUntil > now) return globalUntil - now;
  const r = ipFails.get(ip);
  if (r && r.until > now) return r.until - now;
  return 0;
}

function registerFail(ip) {
  const now = Date.now();
  const r = ipFails.get(ip) || { fails: 0, locks: 0, until: 0 };
  r.fails++;
  if (r.fails >= IP_MAX_FAILS) {
    r.until = now + Math.min(IP_BASE_LOCK * 2 ** r.locks, DAY);
    r.locks++;
    r.fails = 0;
  }
  ipFails.set(ip, r);

  globalFails = globalFails.filter((t) => now - t < GLOBAL_WINDOW);
  globalFails.push(now);
  if (globalFails.length >= GLOBAL_MAX_FAILS) {
    globalUntil = now + GLOBAL_LOCK;
    globalFails = [];
    console.warn('ALERTA: muitas tentativas de PIN erradas. Login bloqueado por 30 min.');
  }
  console.warn(`PIN errado vindo de ${ip}`);
  return IP_MAX_FAILS - r.fails;
}

function registerSuccess(ip) {
  ipFails.delete(ip);
}

// Limpa registros antigos de tempos em tempos
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of ipFails) if (r.until < now - DAY) ipFails.delete(ip);
}, 60 * 60 * 1000).unref();

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health') return json(req, res, 200, { ok: true });

  if (!APP_PIN) return json(req, res, 503, { error: 'no_pin' });

  if (req.method !== 'GET' && !sameOrigin(req)) return json(req, res, 403, { error: 'origin' });

  if (p === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = lockStatus(ip);
    if (wait) return json(req, res, 429, { error: 'locked', retryAfter: Math.ceil(wait / 1000) }, { 'Retry-After': String(Math.ceil(wait / 1000)) });
    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_LOGIN_BODY));
    } catch {
      return json(req, res, 400, { error: 'invalid' });
    }
    // Pequeno atraso fixo: deixa tentativas automáticas mais lentas
    await new Promise((r) => setTimeout(r, 400));
    if (!body || typeof body.pin !== 'string' || !pinMatches(body.pin)) {
      const left = registerFail(ip);
      const locked = lockStatus(ip);
      if (locked) return json(req, res, 429, { error: 'locked', retryAfter: Math.ceil(locked / 1000) });
      return json(req, res, 401, { error: 'pin', attemptsLeft: left });
    }
    registerSuccess(ip);
    const remember = body.remember === true;
    const { token, ttl } = createSession(remember, req);
    // Sem "lembrar": cookie de sessão (some ao fechar o app); o servidor ainda expira em 12 h
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, remember ? ttl : null) });
  }

  const found = findSession(req);

  if (p === '/api/auth') {
    if (found) touchSession(found, req, res);
    return json(req, res, 200, { ok: !!found });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    if (found) {
      sessions = sessions.filter((x) => x !== found.s);
      saveSessions();
    }
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
  }

  if (!found) return json(req, res, 401, { error: 'auth' }, { 'Set-Cookie': clearCookie(req) });
  touchSession(found, req, res);

  if (p === '/api/logout-all' && req.method === 'POST') {
    sessions = [];
    saveSessions();
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
  }

  if (p === '/api/sessions' && req.method === 'GET') {
    return json(req, res, 200, { count: sessions.length });
  }

  if (p === '/api/state' && req.method === 'GET') {
    return json(req, res, 200, { state: readJson(STATE_FILE) });
  }

  if (p === '/api/state' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body || typeof body.state !== 'object' || body.state === null || Array.isArray(body.state)) {
        return json(req, res, 400, { error: 'invalid' });
      }
      writeJson(STATE_FILE, body.state);
      return json(req, res, 200, { ok: true, updatedAt: body.state.updatedAt || null });
    } catch (e) {
      return json(req, res, e.message === 'too_large' ? 413 : 400, { error: 'invalid' });
    }
  }

  return json(req, res, 404, { error: 'not_found' });
}

// ------------------------------------------------------------------
// Arquivos estáticos
// ------------------------------------------------------------------
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(req, res, 400, 'Bad request');
  }
  if (rel === '/') rel = '/index.html';
  if (rel === '/robots.txt') return send(req, res, 200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': MIME['.txt'] });
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(req, res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(target);
    const cache = ext === '.png' ? 'public, max-age=604800' : 'no-cache';
    fs.readFile(target, (err2, data) => {
      if (err2) return send(req, res, 404, 'Not found');
      send(req, res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    });
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(req, res, 400, 'Bad request');
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(() => json(req, res, 500, { error: 'server' }));
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`Rotina PMSC rodando na porta ${PORT}`);
  console.log(`Dados em: ${STATE_FILE}`);
  if (!APP_PIN) console.log('ATENÇÃO: APP_PIN não definido — a API fica bloqueada até você criar a variável APP_PIN.');
  else if (APP_PIN.length < 6) console.log('AVISO: use um APP_PIN com pelo menos 6 dígitos.');
});
