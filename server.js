// Rotina PMSC — servidor sem dependências (Node 18+)
// Serve os arquivos de /public e guarda os dados em DATA_DIR/state.json
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_PIN = process.env.APP_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY = 5 * 1024 * 1024; // 5 MB

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
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });
}

function pinOk(req) {
  if (!APP_PIN) return true;
  const given = Buffer.from(String(req.headers['x-pin'] || ''));
  const expected = Buffer.from(APP_PIN);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
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
  if (url.pathname === '/api/health') return json(res, 200, { ok: true });

  if (url.pathname === '/api/auth') {
    return json(res, 200, { pinRequired: !!APP_PIN, ok: pinOk(req) });
  }

  if (!pinOk(req)) return json(res, 401, { error: 'pin' });

  if (url.pathname === '/api/state' && req.method === 'GET') {
    return json(res, 200, { state: readState() });
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body || typeof body.state !== 'object' || body.state === null) {
        return json(res, 400, { error: 'invalid' });
      }
      writeState(body.state);
      return json(res, 200, { ok: true, updatedAt: body.state.updatedAt || null });
    } catch (e) {
      return json(res, e.message === 'too_large' ? 413 : 400, { error: 'invalid' });
    }
  }

  return json(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(target);
    const cache = ext === '.png' ? 'public, max-age=604800' : 'no-cache';
    fs.readFile(target, (err2, data) => {
      if (err2) return send(res, 404, 'Not found');
      send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(() => json(res, 500, { error: 'server' }));
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`Rotina PMSC rodando na porta ${PORT}`);
  console.log(`Dados em: ${STATE_FILE}`);
  if (!APP_PIN) console.log('ATENÇÃO: APP_PIN não definido — qualquer pessoa com o link acessa seus dados.');
});
