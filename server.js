// Rotina PMSC — servidor sem dependências (Node 18+)
// Serve os arquivos de /public e guarda os dados criptografados em DATA_DIR.
//
// Segurança:
// - PIN obrigatório (APP_PIN) e chave de criptografia obrigatória (DATA_KEY). Sem elas, a API fica bloqueada.
// - Tudo o que é salvo em disco (rotina, sessões, 2FA) é criptografado com AES-256-GCM.
// - 2FA (código de 6 dígitos de app autenticador) no primeiro acesso de cada aparelho.
//   Aparelho confirmado vira "confiável" (cookie de 1 ano): nas próximas vezes pede só o PIN.
// - "Lembrar neste aparelho": sessão de 90 dias renovada com o uso. Sem lembrar: 12 h.
// - Bloqueio de tentativas (PIN e código) por IP e geral.
// - Trocar o APP_PIN derruba as sessões. "Sair de todos os aparelhos" derruba sessões e aparelhos confiáveis.
// - RESET_2FA=1 (temporário) apaga o 2FA para configurar de novo, caso perca o autenticador e os códigos.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const coach = require('./coach.js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_PIN = process.env.APP_PIN || '';
const DATA_KEY = process.env.DATA_KEY || '';
const RESET_2FA = /^(1|true|sim)$/i.test(process.env.RESET_2FA || '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const LEGACY_SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB
const MAX_LOGIN_BODY = 1024;

const COOKIE = 'rotina_sid';
const DEVICE_COOKIE = 'rotina_dev';
const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_TTL = 90 * DAY;
const SHORT_TTL = 12 * 60 * 60 * 1000;
const DEVICE_TTL = 365 * DAY;
const TICKET_TTL = 15 * 60 * 1000; // código 2FA (dá tempo de ir ao autenticador e voltar)
const SETUP_TICKET_TTL = 30 * 60 * 1000;
const PENDING_TOTP_TTL = 60 * 60 * 1000; // chave do 2FA ainda não confirmada continua a mesma por 1 h
const COACH_DAILY_LIMIT = 60;
const TICKET_MAX_TRIES = 5;
const MAX_SESSIONS = 20;
const MAX_DEVICES = 10;
const RECOVERY_CODES = 8;

// Bloqueio de tentativas
const IP_MAX_FAILS = 5;
const IP_BASE_LOCK = 15 * 60 * 1000; // dobra a cada bloqueio (máx. 24 h)
const GLOBAL_WINDOW = 60 * 60 * 1000;
const GLOBAL_MAX_FAILS = 20;
const GLOBAL_LOCK = 30 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

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
const PIN_ID = APP_PIN ? sha256('rotina-pin:' + APP_PIN).slice(0, 16) : '';

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function send(req, res, status, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  const extra = res.getHeader('Set-Cookie');
  if (extra && h['Set-Cookie']) {
    h['Set-Cookie'] = [].concat(extra, h['Set-Cookie']);
    res.removeHeader('Set-Cookie');
  }
  res.writeHead(status, h);
  res.end(body);
}

function json(req, res, status, obj, headers = {}) {
  send(req, res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], ...headers });
}

function clientIp(req) {
  // O proxy do Railway acrescenta o IP real no fim do X-Forwarded-For (os primeiros podem ser forjados)
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch { /* cookie inválido */ }
    }
  }
  return out;
}

function cookie(req, name, value, maxAgeMs, cookiePath = '/') {
  const parts = [`${name}=${value}`, `Path=${cookiePath}`, 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join('; ');
}

const sessionCookie = (req, token, ttl) => cookie(req, COOKIE, token, ttl);
const clearSessionCookie = (req) => cookie(req, COOKIE, '', 0);
const deviceCookie = (req, token) => cookie(req, DEVICE_COOKIE, token, DEVICE_TTL, '/api/');
const clearDeviceCookie = (req) => cookie(req, DEVICE_COOKIE, '', 0, '/api/');

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const pinMatches = (given) => safeEqual(given, APP_PIN);

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // o cookie SameSite=Strict já protege o navegador
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Criptografia em disco (AES-256-GCM)
// ------------------------------------------------------------------
const KEY = DATA_KEY.length >= 32
  ? Buffer.from(crypto.hkdfSync('sha256', DATA_KEY, 'rotina-pmsc', 'rotina-data-v1', 32))
  : null;

function encrypt(obj, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { enc: 'aes-256-gcm', v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(box, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(box.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}

function writeFileAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Lê um arquivo criptografado. Retorna { value, legacy } ou lança erro se a chave estiver errada.
function readSecure(file, aad) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { value: null, legacy: false };
  }
  const parsed = JSON.parse(raw);
  if (parsed && parsed.enc === 'aes-256-gcm') return { value: decrypt(parsed, aad), legacy: false };
  return { value: parsed, legacy: true }; // arquivo antigo, sem criptografia
}

function writeSecure(file, aad, obj) {
  writeFileAtomic(file, JSON.stringify(encrypt(obj, aad)));
}

// ------------------------------------------------------------------
// Inicialização: valida a chave e migra arquivos antigos
// ------------------------------------------------------------------
let fatal = null; // 'no_pin' | 'no_key' | 'bad_key'
let auth = null;

function emptyAuth() {
  return { v: 2, pinId: PIN_ID, totp: null, recovery: [], sessions: [], devices: [] };
}

function init() {
  if (!APP_PIN) return (fatal = 'no_pin');
  if (!KEY) return (fatal = 'no_key');
  try {
    const st = readSecure(STATE_FILE, 'state');
    if (st.legacy && st.value) {
      writeSecure(STATE_FILE, 'state', st.value);
      if (JSON.stringify(readSecure(STATE_FILE, 'state').value) !== JSON.stringify(st.value)) throw new Error('migração falhou');
      console.log('Dados antigos criptografados com sucesso.');
    }
    const a = readSecure(AUTH_FILE, 'auth');
    auth = a.value && a.value.v === 2 ? a.value : emptyAuth();
  } catch (e) {
    console.error('ERRO: não foi possível ler os dados com a DATA_KEY atual. Nada será gravado até a chave correta voltar.', e.message);
    return (fatal = 'bad_key');
  }
  try { fs.unlinkSync(LEGACY_SESSIONS_FILE); } catch { /* não existia */ }
  if (auth.pinId !== PIN_ID) {
    // PIN trocado: derruba sessões (aparelhos confiáveis e 2FA continuam)
    auth.pinId = PIN_ID;
    auth.sessions = [];
  }
  if (RESET_2FA) {
    auth.totp = null;
    delete auth.pendingTotp;
    auth.recovery = [];
    auth.devices = [];
    auth.sessions = [];
    console.warn('RESET_2FA ativo: 2FA apagado. Configure de novo no app e REMOVA a variável RESET_2FA no Railway.');
  }
  const now = Date.now();
  auth.sessions = auth.sessions.filter((x) => x.exp > now);
  auth.devices = auth.devices.filter((x) => x.exp > now);
  saveAuth();
}

function saveAuth() {
  writeSecure(AUTH_FILE, 'auth', auth);
}

// ------------------------------------------------------------------
// TOTP (RFC 6238) — compatível com Senhas do iPhone, Google Authenticator, Authy etc.
// ------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secretB32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Aceita o código atual e o de 30 s antes/depois. Retorna o "step" usado ou -1.
function verifyTotp(secretB32, code, lastStep = -1) {
  const now = Math.floor(Date.now() / 30000);
  for (const w of [0, -1, 1]) {
    const step = now + w;
    if (step <= lastStep) continue; // impede reutilizar um código já usado
    if (safeEqual(totpAt(secretB32, step), code)) return step;
  }
  return -1;
}

function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODES; i++) {
    const s = base32Encode(crypto.randomBytes(5)); // 8 caracteres
    codes.push(s.slice(0, 4) + '-' + s.slice(4, 8));
  }
  return codes;
}

const normRecovery = (c) => String(c).toUpperCase().replace(/[^A-Z2-7]/g, '');

// ------------------------------------------------------------------
// Sessões e aparelhos confiáveis (guardados só como hash)
// ------------------------------------------------------------------
function createSession(remember, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const ttl = remember ? REMEMBER_TTL : SHORT_TTL;
  auth.sessions = auth.sessions.filter((x) => x.exp > now);
  auth.sessions.push({ h: sha256(token), remember, created: now, seen: now, exp: now + ttl, ua: String(req.headers['user-agent'] || '').slice(0, 120) });
  if (auth.sessions.length > MAX_SESSIONS) auth.sessions = auth.sessions.slice(-MAX_SESSIONS);
  return { token, ttl };
}

function findSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const h = sha256(token);
  const s = auth.sessions.find((x) => x.h === h);
  if (!s) return null;
  if (s.exp <= Date.now()) {
    auth.sessions = auth.sessions.filter((x) => x !== s);
    saveAuth();
    return null;
  }
  return { s, token };
}

function touchSession(found, req, res) {
  const { s, token } = found;
  const now = Date.now();
  if (now - s.seen < DAY) return;
  s.seen = now;
  if (s.remember) {
    s.exp = now + REMEMBER_TTL;
    res.setHeader('Set-Cookie', sessionCookie(req, token, REMEMBER_TTL));
  }
  saveAuth();
}

function trustedDevice(req) {
  const token = parseCookies(req)[DEVICE_COOKIE];
  if (!token || token.length > 100) return null;
  const h = sha256(token);
  return auth.devices.find((x) => x.h === h && x.exp > Date.now()) || null;
}

function createDevice(req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  auth.devices = auth.devices.filter((x) => x.exp > now);
  auth.devices.push({ h: sha256(token), created: now, seen: now, exp: now + DEVICE_TTL, ua: String(req.headers['user-agent'] || '').slice(0, 120) });
  if (auth.devices.length > MAX_DEVICES) auth.devices = auth.devices.slice(-MAX_DEVICES);
  return token;
}

// Tickets: PIN correto aguardando o código 2FA (só em memória, 5 min)
const tickets = new Map();

function newTicket(data, ttl = TICKET_TTL) {
  const t = crypto.randomBytes(24).toString('base64url');
  tickets.set(sha256(t), { ...data, exp: Date.now() + ttl, tries: 0 });
  return t;
}

function getTicket(t) {
  if (typeof t !== 'string' || t.length > 100) return null;
  const k = sha256(t);
  const v = tickets.get(k);
  if (!v) return null;
  if (v.exp < Date.now() || v.tries >= TICKET_MAX_TRIES) {
    tickets.delete(k);
    return null;
  }
  return { k, v };
}

// ------------------------------------------------------------------
// Bloqueio de tentativas
// ------------------------------------------------------------------
const ipFails = new Map();
let globalFails = [];
let globalUntil = 0;

function lockStatus(ip) {
  const now = Date.now();
  if (globalUntil > now) return globalUntil - now;
  const r = ipFails.get(ip);
  if (r && r.until > now) return r.until - now;
  return 0;
}

function registerFail(ip, what) {
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
    console.warn('ALERTA: muitas tentativas erradas. Novos logins bloqueados por 30 min.');
  }
  console.warn(`${what} errado vindo de ${ip}`);
  return IP_MAX_FAILS - r.fails;
}

function failResponse(req, res, ip, what, extra = {}) {
  const left = registerFail(ip, what);
  const locked = lockStatus(ip);
  if (locked) return json(req, res, 429, { error: 'locked', retryAfter: Math.ceil(locked / 1000) });
  return json(req, res, 401, { error: what === 'PIN' ? 'pin' : 'code', attemptsLeft: left, ...extra });
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of ipFails) if (r.until < now - DAY) ipFails.delete(ip);
  for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
}, 10 * 60 * 1000).unref();

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

async function readJsonBody(req, limit) {
  try {
    const b = JSON.parse(await readBody(req, limit));
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function finishLogin(req, res, remember, extra = {}, newDevice = false) {
  const { token, ttl } = createSession(remember, req);
  const cookies = [sessionCookie(req, token, remember ? ttl : null)];
  if (newDevice) cookies.push(deviceCookie(req, createDevice(req)));
  saveAuth();
  return json(req, res, 200, { ok: true, ...extra }, { 'Set-Cookie': cookies });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health') return json(req, res, 200, { ok: true });
  if (fatal) return json(req, res, 503, { error: fatal });
  if (req.method !== 'GET' && !sameOrigin(req)) return json(req, res, 403, { error: 'origin' });

  // Passo 1: PIN
  if (p === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = lockStatus(ip);
    if (wait) return json(req, res, 429, { error: 'locked', retryAfter: Math.ceil(wait / 1000) });
    const body = await readJsonBody(req, MAX_LOGIN_BODY);
    if (!body) return json(req, res, 400, { error: 'invalid' });
    await delay(400);
    if (typeof body.pin !== 'string' || !pinMatches(body.pin)) return failResponse(req, res, ip, 'PIN');
    const remember = body.remember === true;

    // Aparelho já confirmado com 2FA: só o PIN basta
    const dev = auth.totp && trustedDevice(req);
    if (dev) {
      dev.seen = Date.now();
      dev.exp = Date.now() + DEVICE_TTL;
      return finishLogin(req, res, remember);
    }
    if (!auth.totp) {
      // A chave pendente é reaproveitada: se o app reiniciar no meio da configuração,
      // o autenticador já cadastrado continua valendo.
      const now = Date.now();
      if (!auth.pendingTotp || auth.pendingTotp.exp < now) {
        auth.pendingTotp = { secret: base32Encode(crypto.randomBytes(20)), exp: now + PENDING_TOTP_TTL };
        saveAuth();
      }
      const secret = auth.pendingTotp.secret;
      const ticket = newTicket({ remember, setupSecret: secret }, SETUP_TICKET_TTL);
      const uri = `otpauth://totp/Rotina:Rotina%20App?secret=${secret}&issuer=Rotina&algorithm=SHA1&digits=6&period=30`;
      return json(req, res, 200, { step: 'setup', ticket, secret, uri });
    }
    return json(req, res, 200, { step: 'code', ticket: newTicket({ remember }) });
  }

  // Passo 2: código do autenticador (ou código de recuperação)
  if (p === '/api/login/verify' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = lockStatus(ip);
    if (wait) return json(req, res, 429, { error: 'locked', retryAfter: Math.ceil(wait / 1000) });
    const body = await readJsonBody(req, MAX_LOGIN_BODY);
    if (!body) return json(req, res, 400, { error: 'invalid' });
    const t = getTicket(body.ticket);
    if (!t) return json(req, res, 401, { error: 'ticket' });
    await delay(400);
    const code = String(body.code || '').replace(/\s/g, '');

    if (t.v.setupSecret) {
      if (auth.totp) { tickets.delete(t.k); return json(req, res, 409, { error: 'already_setup' }); }
      const step = /^\d{6}$/.test(code) ? verifyTotp(t.v.setupSecret, code) : -1;
      if (step < 0) { t.v.tries++; return failResponse(req, res, ip, 'Código 2FA'); }
      tickets.delete(t.k);
      const codes = newRecoveryCodes();
      auth.totp = { secret: t.v.setupSecret, lastStep: step, created: Date.now() };
      delete auth.pendingTotp;
      auth.recovery = codes.map((c) => sha256(normRecovery(c)));
      console.log('2FA configurado.');
      return finishLogin(req, res, t.v.remember, { recoveryCodes: codes }, true);
    }

    if (!auth.totp) { tickets.delete(t.k); return json(req, res, 401, { error: 'ticket' }); }
    let ok = false, usedRecovery = false;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(auth.totp.secret, code, auth.totp.lastStep);
      if (step >= 0) { auth.totp.lastStep = step; ok = true; }
    } else {
      const h = sha256(normRecovery(code));
      const i = auth.recovery.indexOf(h);
      if (i >= 0 && normRecovery(code).length === 8) {
        auth.recovery.splice(i, 1); // cada código de recuperação vale uma vez
        ok = usedRecovery = true;
      }
    }
    if (!ok) { t.v.tries++; return failResponse(req, res, ip, 'Código 2FA'); }
    tickets.delete(t.k);
    return finishLogin(req, res, t.v.remember, usedRecovery ? { recoveryLeft: auth.recovery.length } : {}, true);
  }

  const found = findSession(req);

  if (p === '/api/auth') {
    if (found) touchSession(found, req, res);
    return json(req, res, 200, { ok: !!found });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    if (found) {
      auth.sessions = auth.sessions.filter((x) => x !== found.s);
      saveAuth();
    }
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  if (!found) return json(req, res, 401, { error: 'auth' }, { 'Set-Cookie': clearSessionCookie(req) });
  touchSession(found, req, res);

  if (p === '/api/logout-all' && req.method === 'POST') {
    auth.sessions = [];
    auth.devices = [];
    saveAuth();
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': [clearSessionCookie(req), clearDeviceCookie(req)] });
  }

  if (p === '/api/security' && req.method === 'GET') {
    return json(req, res, 200, { sessions: auth.sessions.length, devices: auth.devices.length, recoveryLeft: auth.recovery.length });
  }

  if (p === '/api/coach' && req.method === 'POST') return handleCoach(req, res);

  if (p === '/api/state' && req.method === 'GET') {
    return json(req, res, 200, { state: readSecure(STATE_FILE, 'state').value });
  }

  if (p === '/api/state' && req.method === 'PUT') {
    const body = await readJsonBody(req, MAX_BODY).catch(() => null);
    if (!body || typeof body.state !== 'object' || body.state === null || Array.isArray(body.state)) {
      return json(req, res, 400, { error: 'invalid' });
    }
    writeSecure(STATE_FILE, 'state', body.state);
    return json(req, res, 200, { ok: true, updatedAt: body.state.updatedAt || null });
  }

  return json(req, res, 404, { error: 'not_found' });
}

// ------------------------------------------------------------------
// Coach (Claude)
// ------------------------------------------------------------------
let coachCalls = [];
let coachRunning = false;

async function handleCoach(req, res) {
  const status = coach.coachStatus();
  if (!status.ok) return json(req, res, 503, { error: 'coach_not_ready', message: status.message });
  const now = Date.now();
  coachCalls = coachCalls.filter((t) => now - t < DAY);
  if (coachCalls.length >= COACH_DAILY_LIMIT) {
    return json(req, res, 429, { error: 'coach_limit', message: `Limite de ${COACH_DAILY_LIMIT} mensagens ao coach por dia atingido.` });
  }
  if (coachRunning) return json(req, res, 409, { error: 'busy', message: 'O coach ainda está respondendo a mensagem anterior.' });
  const body = await readJsonBody(req, 64 * 1024);
  const message = body && typeof body.message === 'string' ? body.message.trim().slice(0, 6000) : '';
  if (!message) return json(req, res, 400, { error: 'invalid', message: 'Mensagem vazia.' });
  const today = body.today, hm = body.now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '') || !/^\d{2}:\d{2}$/.test(hm || '')) {
    return json(req, res, 400, { error: 'invalid', message: 'Data do aparelho inválida.' });
  }
  const checkinDate = /^\d{4}-\d{2}-\d{2}$/.test(body.checkinDate || '') ? body.checkinDate : null;
  const state = readSecure(STATE_FILE, 'state').value;
  if (!state || state.version !== 2 || !state.templates) {
    return json(req, res, 409, { error: 'sync', message: 'Feche e abra o app para sincronizar a rotina antes de falar com o coach.' });
  }
  coachRunning = true;
  coachCalls.push(now);
  try {
    const { reply, changes } = await coach.runCoach({ state, message, today, now: hm, isCheckin: !!checkinDate });
    if (!state.coach || !Array.isArray(state.coach.messages)) state.coach = { messages: [] };
    const ts = Date.now();
    state.coach.messages.push({ role: 'user', text: message, ts, ...(checkinDate ? { kind: 'checkin' } : {}) });
    state.coach.messages.push({ role: 'assistant', text: reply, ts: ts + 1, changes });
    state.coach.messages = state.coach.messages.slice(-200);
    if (checkinDate) {
      if (!state.days[checkinDate]) state.days[checkinDate] = { type: 'seg', checks: {}, times: {}, water: 0, coffee: 0, q: '', a: '' };
      state.days[checkinDate].checkinSent = true;
    }
    state.updatedAt = Date.now();
    writeSecure(STATE_FILE, 'state', state);
    return json(req, res, 200, { ok: true, reply, changes, state });
  } catch (e) {
    console.error('Coach:', e && e.message);
    return json(req, res, 502, { error: 'coach', message: coach.friendlyError(e) });
  } finally {
    coachRunning = false;
  }
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

init();

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(req, res, 400, 'Bad request');
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      console.error('Erro na API:', e.message);
      json(req, res, 500, { error: 'server' });
    });
  } else {
    serveStatic(req, res, url);
  }
});
server.headersTimeout = 20000;
server.requestTimeout = 30000;

server.listen(PORT, () => {
  console.log(`Rotina PMSC rodando na porta ${PORT}`);
  if (fatal === 'no_pin') console.log('ATENÇÃO: APP_PIN não definido — a API fica bloqueada.');
  if (fatal === 'no_key') console.log('ATENÇÃO: DATA_KEY ausente ou com menos de 32 caracteres — a API fica bloqueada.');
  if (APP_PIN && APP_PIN.length < 6) console.log('AVISO: use um APP_PIN com pelo menos 6 dígitos.');
  if (!fatal) console.log(`Dados criptografados em: ${DATA_DIR} · 2FA ${auth.totp ? 'ativo' : 'aguardando configuração'}`);
});
