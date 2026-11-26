// Testes de segurança do Rotina PMSC — uso: npm test  (ou node test/security.js .)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const APP = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-sec-'));
const PIN = '246810';
const KEY = crypto.randomBytes(32).toString('base64');
let port = 4100;
let pass = 0, fail = 0;

function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FALHA ' + name + (extra ? ' -> ' + extra : '')); }
}

function start(env) {
  const p = port++;
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: String(p), DATA_DIR: DATA, APP_PIN: PIN, DATA_KEY: KEY, RESET_2FA: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return new Promise((resolve) => {
    const t = setInterval(async () => {
      try { await fetch(`http://localhost:${p}/api/health`); clearInterval(t); resolve({ base: `http://localhost:${p}`, child, log: () => log }); } catch { /* aguarda */ }
    }, 100);
  });
}
const stop = (s) => new Promise((r) => { s.child.on('exit', r); s.child.kill(); });

// Cliente com cookies
function client(base, ip) {
  const jar = {};
  const self = { base };
  async function req(method, url, body, headers = {}) {
    const h = { ...headers };
    if (ip) h['X-Forwarded-For'] = ip;
    const cookies = Object.entries(jar).filter(([n, c]) => url.startsWith(c.path)).map(([n, c]) => `${n}=${c.v}`).join('; ');
    if (cookies) h.Cookie = cookies;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(self.base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const sc of r.headers.getSetCookie()) {
      const [nv, ...attrs] = sc.split(';').map((x) => x.trim());
      const [n, v] = nv.split('=');
      const pth = (attrs.find((a) => a.startsWith('Path=')) || 'Path=/').slice(5);
      if (!v || attrs.includes('Max-Age=0')) delete jar[n]; else jar[n] = { v, path: pth, attrs };
    }
    let data = null;
    try { data = await r.json(); } catch { /* não-json */ }
    return { status: r.status, data, headers: r.headers };
  }
  self.req = req; self.jar = jar;
  return self;
}

// TOTP
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32d(s) { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); }
function totp(secret, offset = 0) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = crypto.createHmac('sha1', b32d(secret)).update(c).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

(async () => {
  console.log('Pasta de dados de teste:', DATA);

  console.log('\n[1] Configuração obrigatória (falha fechada)');
  let s = await start({ DATA_KEY: '' });
  let c = client(s.base);
  let r = await c.req('POST', '/api/login', { pin: PIN });
  ok(r.status === 503 && r.data.error === 'no_key', 'sem DATA_KEY a API fica bloqueada');
  await stop(s);
  s = await start({ APP_PIN: '' });
  r = await client(s.base).req('GET', '/api/state');
  ok(r.status === 503 && r.data.error === 'no_pin', 'sem APP_PIN a API fica bloqueada');
  await stop(s);

  console.log('\n[2] Migração e criptografia dos dados');
  fs.writeFileSync(path.join(DATA, 'state.json'), JSON.stringify({ updatedAt: 5, days: { '2026-11-26': { obs: 'SEGREDO-ANTIGO' } }, weights: [] }));
  fs.writeFileSync(path.join(DATA, 'sessions.json'), JSON.stringify({ pinId: 'x', list: [] }));
  s = await start({});
  const stateRaw = fs.readFileSync(path.join(DATA, 'state.json'), 'utf8');
  ok(!stateRaw.includes('SEGREDO-ANTIGO') && stateRaw.includes('aes-256-gcm'), 'state.json antigo foi criptografado');
  ok(!fs.existsSync(path.join(DATA, 'sessions.json')), 'sessions.json antigo (sessões da versão anterior) foi apagado');
  ok(fs.existsSync(path.join(DATA, 'auth.json')) && fs.readFileSync(path.join(DATA, 'auth.json'), 'utf8').includes('aes-256-gcm'), 'auth.json criptografado');

  console.log('\n[3] Primeiro acesso: PIN + configuração do 2FA');
  c = client(s.base, '10.0.0.1');
  r = await c.req('GET', '/api/state');
  ok(r.status === 401, 'sem login não lê dados');
  r = await c.req('POST', '/api/login', { pin: '000000', remember: true });
  ok(r.status === 401 && r.data.error === 'pin', 'PIN errado recusado');
  r = await c.req('POST', '/api/login', { pin: PIN, remember: true });
  ok(r.status === 200 && r.data.step === 'setup' && r.data.secret && !c.jar.rotina_sid, 'PIN certo no 1º acesso pede configuração do 2FA (sem sessão ainda)');
  const secret = r.data.secret;
  const setupTicket = r.data.ticket;
  r = await c.req('GET', '/api/state');
  ok(r.status === 401, 'só o PIN não dá acesso aos dados');
  r = await c.req('POST', '/api/login/verify', { ticket: setupTicket, code: '123456' });
  ok(r.status === 401 && r.data.error === 'code', 'código 2FA errado recusado');
  r = await c.req('POST', '/api/login/verify', { ticket: setupTicket, code: totp(secret) });
  ok(r.status === 200 && Array.isArray(r.data.recoveryCodes) && r.data.recoveryCodes.length === 8, '2FA ativado e 8 códigos de recuperação gerados');
  const recovery = r.data.recoveryCodes;
  ok(!!c.jar.rotina_sid && !!c.jar.rotina_dev, 'recebe cookie de sessão e de aparelho confiável');
  ok(c.jar.rotina_sid.attrs.includes('HttpOnly') && c.jar.rotina_sid.attrs.includes('SameSite=Strict'), 'cookie de sessão HttpOnly + SameSite=Strict');
  ok(c.jar.rotina_dev.path === '/api/' && c.jar.rotina_dev.attrs.includes('HttpOnly'), 'cookie de aparelho HttpOnly e restrito a /api/');
  r = await c.req('POST', '/api/login/verify', { ticket: setupTicket, code: totp(secret) });
  ok(r.status === 401, 'ticket não pode ser reutilizado');
  r = await c.req('PUT', '/api/state', { state: { updatedAt: 10, days: { '2026-11-26': { obs: 'NOVO-SEGREDO' } }, weights: [] } });
  ok(r.status === 200, 'grava dados com sessão válida');
  const raw2 = fs.readFileSync(path.join(DATA, 'state.json'), 'utf8') + fs.readFileSync(path.join(DATA, 'auth.json'), 'utf8');
  ok(!raw2.includes('NOVO-SEGREDO') && !raw2.includes(secret) && !raw2.includes(recovery[0]), 'disco não contém dados, chave 2FA nem códigos em texto');
  r = await c.req('GET', '/api/state');
  ok(r.data && r.data.state && r.data.state.days['2026-11-26'].obs === 'NOVO-SEGREDO', 'lê os dados descriptografados com sessão válida');

  console.log('\n[4] Mesmo aparelho: só PIN');
  delete c.jar.rotina_sid;
  r = await c.req('POST', '/api/login', { pin: PIN, remember: true });
  ok(r.status === 200 && r.data.ok === true, 'aparelho confiável entra só com o PIN');
  r = await c.req('POST', '/api/login', { pin: '999999' });
  ok(r.status === 401, 'aparelho confiável ainda exige o PIN certo');

  console.log('\n[5] Outro aparelho: PIN + código');
  const other = client(s.base, '10.0.0.2');
  r = await other.req('POST', '/api/login', { pin: PIN });
  ok(r.status === 200 && r.data.step === 'code' && !other.jar.rotina_sid, 'aparelho novo precisa do código 2FA');
  let t = r.data.ticket;
  r = await other.req('POST', '/api/login/verify', { ticket: t, code: totp(secret) });
  ok(r.status === 401, 'código 2FA já usado não pode ser reutilizado (anti-replay)');
  r = await other.req('POST', '/api/login/verify', { ticket: t, code: recovery[0].toLowerCase() });
  ok(r.status === 200 && r.data.recoveryLeft === 7, 'código de recuperação funciona (restam 7)');
  r = await client(s.base, '10.0.0.3').req('POST', '/api/login', { pin: PIN });
  r = await client(s.base, '10.0.0.3').req('POST', '/api/login/verify', { ticket: r.data.ticket, code: recovery[0] });
  ok(r.status === 401, 'código de recuperação só vale uma vez');
  r = await client(s.base, '10.0.0.4').req('POST', '/api/login/verify', { ticket: 'forjado', code: totp(secret) });
  ok(r.status === 401 && r.data.error === 'ticket', 'ticket forjado recusado');

  console.log('\n[6] Força bruta do código 2FA');
  const bf = client(s.base, '10.0.0.9');
  r = await bf.req('POST', '/api/login', { pin: PIN });
  t = r.data.ticket;
  let last;
  for (let i = 0; i < 6; i++) last = await bf.req('POST', '/api/login/verify', { ticket: t, code: String(100000 + i) });
  ok(last.status === 429 || last.data.error === 'ticket', 'após 5 códigos errados: bloqueio', JSON.stringify(last.data));
  r = await bf.req('POST', '/api/login', { pin: PIN });
  ok(r.status === 429, 'IP bloqueado não consegue nem tentar o PIN');

  console.log('\n[7] Sair de todos os aparelhos');
  r = await c.req('POST', '/api/logout-all');
  ok(r.status === 200, 'logout geral');
  r = await other.req('GET', '/api/state');
  ok(r.status === 401, 'sessão de outro aparelho derrubada');
  r = await c.req('POST', '/api/login', { pin: PIN });
  ok(r.data && r.data.step === 'code', 'aparelho antes confiável volta a pedir código');
  await stop(s);

  console.log('\n[8] Chave errada não destrói os dados');
  const before = fs.readFileSync(path.join(DATA, 'state.json'), 'utf8');
  s = await start({ DATA_KEY: crypto.randomBytes(32).toString('base64') });
  r = await client(s.base).req('POST', '/api/login', { pin: PIN });
  ok(r.status === 503 && r.data.error === 'bad_key', 'DATA_KEY errada: API bloqueada');
  ok(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8') === before, 'arquivo de dados intacto');
  await stop(s);

  console.log('\n[9] Adulteração do arquivo é detectada');
  const box = JSON.parse(before);
  const tampered = Buffer.from(box.data, 'base64'); tampered[0] ^= 1;
  fs.writeFileSync(path.join(DATA, 'state.json'), JSON.stringify({ ...box, data: tampered.toString('base64') }));
  s = await start({});
  r = await client(s.base).req('GET', '/api/auth');
  ok(r.status === 503, 'dados adulterados recusados (GCM)');
  await stop(s);
  fs.writeFileSync(path.join(DATA, 'state.json'), before);

  console.log('\n[10] Trocar o PIN derruba sessões; RESET_2FA');
  s = await start({});
  c = client(s.base, '10.1.0.1');
  r = await c.req('POST', '/api/login', { pin: PIN });
  await new Promise((res) => setTimeout(res, 31000 - (Date.now() % 30000))); // próximo código
  r = await c.req('POST', '/api/login/verify', { ticket: r.data.ticket, code: totp(secret) });
  ok(r.status === 200, 'login com novo código');
  await stop(s);
  s = await start({ APP_PIN: '13579135' });
  c.base = s.base;
  r = await c.req('GET', '/api/state');
  ok(r.status === 401, 'PIN trocado: sessão antiga derrubada');
  r = await c.req('POST', '/api/login', { pin: PIN });
  ok(r.status === 401, 'PIN antigo não funciona mais');
  r = await c.req('POST', '/api/login', { pin: '13579135' });
  ok(r.data && r.data.ok === true, 'aparelho confiável continua confiável com o PIN novo');
  await stop(s);
  s = await start({ APP_PIN: '13579135', RESET_2FA: '1' });
  r = await client(s.base, '10.1.0.2').req('POST', '/api/login', { pin: '13579135' });
  ok(r.data && r.data.step === 'setup', 'RESET_2FA permite configurar de novo');
  await stop(s);

  console.log('\n[11] Superfície web');
  s = await start({});
  c = client(s.base, '10.2.0.1');
  r = await c.req('GET', '/');
  const csp = r.headers.get('content-security-policy') || '';
  ok(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), 'CSP sem script inline e sem iframe');
  ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY', 'nosniff + X-Frame-Options');
  r = await c.req('GET', '/', undefined, { 'X-Forwarded-Proto': 'https' });
  ok((r.headers.get('strict-transport-security') || '').includes('max-age'), 'HSTS em HTTPS');
  r = await c.req('POST', '/api/login', { pin: PIN }, { Origin: 'https://evil.example' });
  ok(r.status === 403, 'POST de outro site bloqueado');
  for (const pth of ['/../server.js', '/..%2fserver.js', '/%2e%2e/%2e%2e/etc/passwd', '/.git/config', '/data/state.json']) {
    const resp = await fetch(s.base + pth);
    const txt = await resp.text();
    ok(!txt.includes('require(') && !txt.includes('aes-256-gcm') && !txt.includes('root:'), `não vaza arquivo: ${pth}`);
  }
  r = await c.req('GET', '/api/state', undefined, { Cookie: 'rotina_sid=' + 'A'.repeat(43) });
  ok(r.status === 401, 'cookie de sessão forjado recusado');
  const big = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(5000) }).then((x) => x.status).catch(() => 'conexão fechada');
  ok(big === 413 || big === 400 || big === 'conexão fechada', 'corpo gigante no login recusado', String(big));
  r = await c.req('GET', '/api/health');
  ok(r.status === 200, 'servidor continua de pé');
  const rb = await fetch(s.base + '/robots.txt').then((x) => x.text());
  ok(rb.includes('Disallow: /'), 'robots.txt bloqueia indexação');
  await stop(s);

  console.log(`\nResultado: ${pass} OK, ${fail} falha(s)`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
