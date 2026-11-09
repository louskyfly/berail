'use strict';
/* BeRail — serveur de démo (Node natif, zéro dépendance) */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEDIA = path.join(DATA, 'media');
const DB_FILE = path.join(DATA, 'db.json');
const CERTS = path.join(ROOT, 'certs');

fs.mkdirSync(MEDIA, { recursive: true });

let db = { classes: {}, users: {}, posts: [] };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (_) { /* première fois */ }
if (!db.classes) db.classes = {};
if (!db.users) db.users = {};
if (!db.posts) db.posts = [];

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 1), () => {});
  }, 120);
}

/* ---------- utils ---------- */
function uid(n = 8) { return crypto.randomBytes(n).toString('hex'); }
function shortCode(n = 3) { return crypto.randomBytes(n).toString('hex').toUpperCase(); }
function nowIso() { return new Date().toISOString(); }
function normalizeCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }
function cleanName(n) { return String(n || '').trim().slice(0, 24); }

function send(res, status, body, headers) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(data);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function userFromToken(token) {
  if (!token) return null;
  const u = db.users[token];
  if (!u) return null;
  return u;
}
function publicUser(u) {
  return { id: u.id, name: u.name, classCode: u.classCode, owner: !!(db.classes[u.classCode] && db.classes[u.classCode].owner === u.id) };
}

function saveDataUrl(dataUrl, name) {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return null;
  const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
  const file = `${name}.${ext}`;
  fs.writeFileSync(path.join(MEDIA, file), buf);
  return '/media/' + file;
}

function postView(p, viewer) {
  const reactions = {};
  let total = 0;
  for (const [emoji, users] of Object.entries(p.reactions || {})) {
    if (users.length) { reactions[emoji] = users.length; total += users.length; }
  }
  return {
    id: p.id,
    shareCode: p.shareCode,
    userName: p.userName,
    userId: p.userId,
    photo: p.photo,
    caption: p.caption,
    late: p.late,
    createdAt: p.createdAt,
    mine: !!(viewer && viewer.id === p.userId),
    reactions,
    myReaction: viewer ? (Object.entries(p.reactions || {}).find(([, us]) => us.includes(viewer.id)) || [null])[0] : null,
    reactionTotal: total,
    comments: (p.comments || []).map(c => ({ name: c.name, text: c.text, at: c.at })),
    commentCount: (p.comments || []).length
  };
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const route = url.pathname;
  const q = url.searchParams;

  if (req.method === 'POST' && route === '/api/join') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    const code = normalizeCode(body.code);
    if (name.length < 2) return send(res, 400, { error: 'name_too_short' });
    if (!/^[A-Z0-9-]{3,12}$/.test(code)) return send(res, 400, { error: 'bad_code' });
    let klass = db.classes[code];
    if (!klass) {
      if (!body.create) return send(res, 404, { error: 'unknown_class' });
      klass = db.classes[code] = { code, name: code, owner: null, createdAt: nowIso(), moment: null };
    }
    const token = uid(16);
    const user = { id: uid(6), name, classCode: code, createdAt: nowIso() };
    db.users[token] = user;
    if (!klass.owner) klass.owner = user.id;
    save();
    return send(res, 200, { token, user: publicUser(user), klass: { code, owner: klass.owner, moment: klass.moment } });
  }

  if (req.method === 'GET' && route === '/api/me') {
    const u = userFromToken(q.get('token'));
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const k = db.classes[u.classCode];
    return send(res, 200, { user: publicUser(u), klass: { code: k.code, owner: k.owner, moment: k.moment }, serverTime: Date.now() });
  }

  if (req.method === 'GET' && route === '/api/state') {
    const u = userFromToken(q.get('token'));
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const k = db.classes[u.classCode];
    const mine = db.posts.filter(p => p.userId === u.id && p.classCode === u.classCode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return send(res, 200, {
      moment: k.moment,
      myPostId: mine ? mine.id : null,
      postCount: db.posts.filter(p => p.classCode === u.classCode).length,
      serverTime: Date.now()
    });
  }

  if (req.method === 'GET' && route === '/api/feed') {
    const u = userFromToken(q.get('token'));
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const k = db.classes[u.classCode];
    const posts = db.posts.filter(p => p.classCode === u.classCode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80)
      .map(p => postView(p, u));
    const mine = posts.find(p => p.mine);
    const others = posts.filter(p => !p.mine);
    return send(res, 200, {
      klass: { code: k.code, owner: k.owner, moment: k.moment, ownerName: (db.users[Object.keys(db.users).find(t => db.users[t].id === k.owner)] || {}).name || null },
      posts: mine ? [mine, ...others] : others,
      myPostId: mine ? mine.id : null,
      serverTime: Date.now()
    });
  }

  if (req.method === 'POST' && route === '/api/moment') {
    const body = await readBody(req);
    const u = userFromToken(body.token);
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const k = db.classes[u.classCode];
    if (k.owner !== u.id) return send(res, 403, { error: 'owner_only' });
    k.moment = { at: Date.now(), by: u.name };
    save();
    return send(res, 200, { moment: k.moment });
  }

  if (req.method === 'POST' && route === '/api/post') {
    const body = await readBody(req);
    const u = userFromToken(body.token);
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const k = db.classes[u.classCode];
    const photo = saveDataUrl(body.photo, uid(10));
    if (!photo) return send(res, 400, { error: 'bad_photo' });
    const createdAt = new Date().toISOString();
    const late = !!(k.moment && (Date.now() - k.moment.at) > 2 * 60 * 1000);
    const p = {
      id: uid(8),
      shareCode: shortCode(3),
      userId: u.id,
      userName: u.name,
      classCode: u.classCode,
      photo,
      caption: String(body.caption || '').slice(0, 140),
      late,
      createdAt,
      reactions: {},
      comments: []
    };
    db.posts.push(p);
    save();
    return send(res, 200, { post: postView(p, u) });
  }

  if (req.method === 'POST' && route === '/api/react') {
    const body = await readBody(req);
    const u = userFromToken(body.token);
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const p = db.posts.find(x => x.id === body.postId && x.classCode === u.classCode);
    if (!p) return send(res, 404, { error: 'not_found' });
    const emoji = String(body.emoji || '').slice(0, 4);
    p.reactions = p.reactions || {};
    const already = (p.reactions[emoji] || []).includes(u.id);
    for (const key of Object.keys(p.reactions)) {
      p.reactions[key] = p.reactions[key].filter(id => id !== u.id);
      if (!p.reactions[key].length) delete p.reactions[key];
    }
    if (!already) p.reactions[emoji] = (p.reactions[emoji] || []).concat(u.id);
    save();
    return send(res, 200, { post: postView(p, u) });
  }

  if (req.method === 'POST' && route === '/api/comment') {
    const body = await readBody(req);
    const u = userFromToken(body.token);
    if (!u) return send(res, 401, { error: 'unauthorized' });
    const p = db.posts.find(x => x.id === body.postId && x.classCode === u.classCode);
    if (!p) return send(res, 404, { error: 'not_found' });
    const text = String(body.text || '').trim().slice(0, 160);
    if (!text) return send(res, 400, { error: 'empty' });
    p.comments = p.comments || [];
    p.comments.push({ name: u.name, text, at: nowIso() });
    save();
    return send(res, 200, { post: postView(p, u) });
  }

  // Post partagé via son code — accessible sans compte
  if (req.method === 'GET' && route.startsWith('/api/p/')) {
    const code = normalizeCode(route.slice('/api/p/'.length));
    const p = db.posts.find(x => x.shareCode === code);
    if (!p) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { post: postView(p, null), klass: { code: p.classCode } });
  }

  return send(res, 404, { error: 'not_found' });
}

/* ---------- statique ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  let base = PUB;
  if (p.startsWith('/media/')) { base = MEDIA; p = p.slice('/media/'.length); }
  else if (p === '/' || p === '') p = 'index.html';
  else p = p.replace(/^\/+/, '');

  const file = path.join(base, p);
  if (!file.startsWith(base)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (base === PUB) { // SPA fallback
        return fs.readFile(path.join(PUB, 'index.html'), (e2, buf) => {
          if (e2) return send(res, 404, { error: 'not_found' });
          send(res, 200, buf, { 'Content-Type': MIME['.html'] });
        });
      }
      return send(res, 404, { error: 'not_found' });
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': base === MEDIA ? 'public, max-age=31536000' : 'no-cache',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => {
      console.error('[api]', e.message);
      if (!res.headersSent) send(res, e.message === 'too_large' ? 413 : 500, { error: e.message || 'server_error' });
    });
    return;
  }
  serveStatic(req, res, url);
}

const HTTP_PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const os = require('os');
const LAN = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

http.createServer(handler).listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`HTTP  http://localhost:${HTTP_PORT}`);
  LAN.forEach((ip) => console.log(`      http://${ip}:${HTTP_PORT}`));
});

const keyFile = path.join(CERTS, 'key.pem');
const certFile = path.join(CERTS, 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`HTTPS https://localhost:${HTTPS_PORT}  (caméra iPad)`);
      LAN.forEach((ip) => console.log(`      https://${ip}:${HTTPS_PORT}  ← iPad`));
    });
} else {
  console.log('Pas de certificat : HTTPS désactivé (la caméra iPad en a besoin).');
}
