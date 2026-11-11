'use strict';
/* BeRail — petit serveur (Render, gratuit) :
   - envoie les notifications sur iPad / iPhone / ordi (Web Push)
   - lance les BeRail automatiquement aux horaires réglés dans l'admin
   - sert l'API de la page admin (protégée par ADMIN_KEY)
   - efface les BeRail de plus de 7 jours
   Une seule variable d'environnement secrète : BERAIL_SECRET (déchiffre secrets.enc).
   Optionnel : PUBLIC_URL (pour rester éveillé sur Render gratuit). */
const http = require('http');
const crypto = require('crypto');
const webpush = require('web-push');
const saToken = require('./sa.js');

const DB = 'https://sync-3626f-default-rtdb.europe-west1.firebasedatabase.app/berail';
const TZ = 'Europe/Paris';
const RETENTION_DAYS = 7;
const SECRETS = (() => {
  const raw = Buffer.from(require('fs').readFileSync(__dirname + '/secrets.enc', 'utf8'), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.BERAIL_SECRET || '', 'base64url'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString());
})();
const SA = SECRETS.sa;
const ADMIN_KEY = SECRETS.adminKey;
const SITE = 'https://berail-lucas.web.app';
webpush.setVapidDetails('mailto:lucas.devtool@gmail.com', SECRETS.vapidPublic, SECRETS.vapidPrivate);

/* ---------- base de données (accès admin) ---------- */
async function db(method, path, body) {
  const t = await saToken(SA);
  const r = await fetch(`${DB}/${path}.json?access_token=${t}`, {
    method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`db ${method} ${path} ${r.status}`);
  return r.json();
}
const get = (p) => db('GET', p);
const put = (p, v) => db('PUT', p, v);
const patch = (p, v) => db('PATCH', p, v);
const del = (p) => db('DELETE', p);

/* ---------- temps ---------- */
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function parisNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { day: dayKey(), wd, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/* Heure prévue du jour : fixe, ou tirée au hasard (mais la même toute la journée) dans la fenêtre. */
function plannedMin(code, s, day) {
  if (!s) return null;
  if (s.mode === 'fixed') return toMin(s.time);
  const a = toMin(s.from || '10:00'), b = Math.max(a + 1, toMin(s.to || '16:00'));
  const h = crypto.createHash('sha256').update(code + '|' + day).digest().readUInt32BE(0);
  return a + (h % (b - a));
}

/* ---------- notifications ---------- */
async function pushClass(code, payload, onlyUserId) {
  const subs = (await get(`push/${code}`)) || {};
  let sent = 0, gone = 0, failed = 0, err = '';
  await Promise.all(Object.entries(subs).map(async ([userId, s]) => {
    if (onlyUserId && userId !== onlyUserId) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 900, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { gone++; await del(`push/${code}/${userId}`).catch(() => {}); }
      else { failed++; err = String(e.statusCode || e.message || e).slice(0, 120); console.error('push', code, userId, e.statusCode, e.body); }
    }
  }));
  return { sent, gone, failed, err };
}
const VERSION = '2026-11-11b';
const momentMsg = () => ({ title: "⚡ C'est l'heure du BeRail !", body: 'Tu as 2 minutes pour poster ta photo.', url: SITE + '/', tag: 'moment-' + Date.now() });

async function fireMoment(code, by = 'BeRail') {
  await put(`classes/${code}/moment`, { at: Date.now(), by });
  const r = await pushClass(code, momentMsg());
  // les 2 minutes partent de l'arrivée de la notification
  await put(`classes/${code}/moment`, { at: Date.now(), by });
  await logPush(code, 'moment', r);
  return r;
}
async function logPush(code, kind, r) {
  await put(`pushlog/${code}`, { at: new Date().toISOString(), kind, sent: r.sent, gone: r.gone, failed: r.failed || 0, err: r.err || '' }).catch(() => {});
}

/* ---------- tâche régulière ---------- */
let lastPurge = 0, ticking = false;
async function tick() {
  if (ticking) return { busy: true };
  ticking = true;
  const out = { fired: [], purged: 0 };
  try {
    const now = parisNow();
    const [schedules, fired] = await Promise.all([get('schedules'), get('fired')]);
    for (const [code, s] of Object.entries(schedules || {})) {
      if (!s || !s.enabled || !String(s.days || '').includes(String(now.wd))) continue;
      if ((fired || {})[code] === now.day) continue;
      const at = plannedMin(code, s, now.day);
      if (now.min >= at && now.min <= at + 180) {
        await put(`fired/${code}`, now.day);
        const r = await fireMoment(code);
        out.fired.push({ code, ...r });
      }
    }
    if (Date.now() - lastPurge > 3600 * 1000) { lastPurge = Date.now(); out.purged = await purgeOld(); }
  } catch (e) { console.error('tick', e.message); out.error = e.message; }
  finally { ticking = false; }
  return out;
}
function ageDays(iso) {
  return Math.round((Date.parse(dayKey() + 'T00:00:00Z') - Date.parse(dayKey(new Date(iso)) + 'T00:00:00Z')) / 86400000);
}
async function purgeOld() {
  const all = (await get('posts')) || {};
  const upd = {};
  for (const [code, posts] of Object.entries(all)) for (const p of Object.values(posts || {})) {
    if (p && p.createdAt && ageDays(p.createdAt) >= RETENTION_DAYS) {
      upd[`posts/${code}/${p.id}`] = null; upd[`photos/${p.id}`] = null; upd[`photos/${p.id}f`] = null; if (p.shareCode) upd[`shares/${p.shareCode}`] = null;
    }
  }
  const n = Object.keys(upd).length;
  if (n) await patch('', upd);
  return n / 3;
}

/* ---------- admin ---------- */
const fails = { n: 0, until: 0 };
function checkKey(k) {
  if (Date.now() < fails.until) return false;
  const a = Buffer.from(String(k || '')), b = Buffer.from(ADMIN_KEY);
  const ok = ADMIN_KEY && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok && ++fails.n >= 8) { fails.until = Date.now() + 10 * 60 * 1000; fails.n = 0; }
  if (ok) fails.n = 0;
  return ok;
}
async function overview() {
  const [classes, users, posts, push, schedules, fired, pushlog] = await Promise.all(['classes', 'users', 'posts', 'push', 'schedules', 'fired', 'pushlog'].map((p) => get(p)));
  const now = parisNow();
  return Object.values(classes || {}).map((k) => {
    const members = Object.entries(users || {}).filter(([, u]) => u && u.classCode === k.code)
      .map(([token, u]) => ({ token, id: u.id, name: u.name, createdAt: u.createdAt, owner: u.id === k.owner, notif: !!((push || {})[k.code] || {})[u.id] }))
      .sort((a, b) => (b.owner - a.owner) || a.name.localeCompare(b.name));
    const s = (schedules || {})[k.code] || null;
    const ps = Object.values((posts || {})[k.code] || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const at = s ? plannedMin(k.code, s, now.day) : null;
    return {
      code: k.code, name: k.name, ownerName: k.ownerName, owner: k.owner, createdAt: k.createdAt, moment: k.moment || null,
      members, posts: ps.map((p) => ({ id: p.id, userName: p.userName, caption: p.caption || '', createdAt: p.createdAt, late: !!p.late, shareCode: p.shareCode })),
      subs: Object.keys((push || {})[k.code] || {}).length, lastPush: (pushlog || {})[k.code] || null,
      schedule: s, today: s && s.enabled && String(s.days || '').includes(String(now.wd)) ? { at: fmtMin(at), done: (fired || {})[k.code] === now.day } : null
    };
  });
}
const CODE = /^[A-Z0-9-]{3,12}$/;
async function adminAction(b) {
  const code = String(b.code || '').toUpperCase();
  switch (b.action) {
    case 'overview': return { classes: await overview(), serverTime: Date.now() };
    case 'schedule': {
      if (!CODE.test(code)) throw 400;
      const s = b.schedule || {};
      const clean = { enabled: !!s.enabled, mode: s.mode === 'fixed' ? 'fixed' : 'random', time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '12:00',
        from: /^\d{2}:\d{2}$/.test(s.from) ? s.from : '10:00', to: /^\d{2}:\d{2}$/.test(s.to) ? s.to : '16:00', days: String(s.days || '12345').replace(/[^1-7]/g, '') };
      await put(`schedules/${code}`, clean);
      // si on règle une heure plus tard dans la journée, on autorise un nouveau BeRail aujourd'hui
      if (b.resetToday) await del(`fired/${code}`);
      return { ok: true, schedule: clean };
    }
    case 'fire': { if (!CODE.test(code)) throw 400; return fireMoment(code, 'Admin'); }
    case 'notify': {
      const title = String(b.title || 'BeRail').slice(0, 60), body = String(b.body || '').slice(0, 180);
      const codes = code === '*' ? Object.keys((await get('classes')) || {}) : [code];
      const res = {};
      for (const c of codes) { res[c] = await pushClass(c, { title, body, url: SITE + '/', tag: 'msg-' + Date.now() }); await logPush(c, 'message', res[c]); }
      return res;
    }
    case 'createClass': {
      if (!CODE.test(code)) throw 400;
      if (await get(`classes/${code}`)) throw 409;
      const k = { code, name: String(b.name || code).slice(0, 12), owner: 'admin', ownerName: 'Admin', createdAt: new Date().toISOString() };
      await put(`classes/${code}`, k);
      return { ok: true };
    }
    case 'setOwner': {
      const u = await get(`users/${b.token}`);
      if (!u || u.classCode !== code) throw 404;
      await patch(`classes/${code}`, { owner: u.id, ownerName: u.name });
      return { ok: true };
    }
    case 'deleteUser': {
      const u = await get(`users/${b.token}`);
      if (!u) throw 404;
      await patch('', { [`users/${b.token}`]: null, [`push/${u.classCode}/${u.id}`]: null, [`profiles/${u.classCode}/${u.id}`]: null, [`stats/${u.classCode}/${u.id}`]: null });
      return { ok: true };
    }
    case 'deletePost': {
      const p = await get(`posts/${code}/${b.id}`);
      if (!p) throw 404;
      await patch('', { [`posts/${code}/${p.id}`]: null, [`photos/${p.id}`]: null, [`photos/${p.id}f`]: null, [`shares/${p.shareCode}`]: null });
      return { ok: true };
    }
    case 'deleteClass': {
      if (!CODE.test(code)) throw 400;
      const [posts, users] = await Promise.all([get(`posts/${code}`), get('users')]);
      const upd = { [`classes/${code}`]: null, [`pushlog/${code}`]: null, [`posts/${code}`]: null, [`push/${code}`]: null, [`profiles/${code}`]: null, [`stats/${code}`]: null, [`momentDays/${code}`]: null, [`schedules/${code}`]: null, [`fired/${code}`]: null };
      for (const p of Object.values(posts || {})) { upd[`photos/${p.id}`] = null; upd[`photos/${p.id}f`] = null; upd[`shares/${p.shareCode}`] = null; }
      for (const [t, u] of Object.entries(users || {})) if (u && u.classCode === code) upd[`users/${t}`] = null;
      await patch('', upd);
      return { ok: true };
    }
    case 'clearMoment': { await del(`classes/${code}/moment`); return { ok: true }; }
    case 'tick': return tick();
    default: throw 400;
  }
}

/* ---------- HTTP ---------- */
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((ok, ko) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { ko(400); } }); });
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return send(res, 200, { ok: true, service: 'berail-push', version: VERSION });
    if (req.method === 'GET' && url.pathname === '/tick') return send(res, 200, await tick());
    if (req.method !== 'POST') return send(res, 404, { error: 'not_found' });
    const b = await readBody(req);
    if (url.pathname === '/moment' || url.pathname === '/test') {
      const u = /^[a-f0-9]{32}$/.test(b.token || '') ? await get(`users/${b.token}`) : null;
      if (!u) return send(res, 401, { error: 'bad_token' });
      if (url.pathname === '/test') return send(res, 200, await pushClass(u.classCode, { title: 'BeRail 🔔', body: 'Les notifications marchent sur cet appareil !', url: SITE + '/', tag: 'test-' + Date.now() }, u.id));
      const k = await get(`classes/${u.classCode}`);
      if (!k || k.owner !== u.id) return send(res, 403, { error: 'owner_only' });
      const r = await pushClass(u.classCode, momentMsg());
      await put(`classes/${u.classCode}/moment`, { at: Date.now(), by: u.name });
      await logPush(u.classCode, 'moment', r);
      return send(res, 200, r);
    }
    if (url.pathname === '/admin') {
      if (!checkKey(b.key)) return send(res, 401, { error: 'bad_key' });
      return send(res, 200, await adminAction(b));
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    const st = typeof e === 'number' ? e : 500;
    if (st === 500) console.error(e);
    return send(res, st, { error: st === 500 ? 'server_error' : 'bad_request' });
  }
});
server.listen(process.env.PORT || 10000, () => console.log('berail-push prêt'));
setInterval(tick, 60 * 1000);
// Render (gratuit) s'endort après 15 min sans visite : on se réveille nous-mêmes.
// Seulement de 6h à 22h : l'offre gratuite de Render donne 750 h par mois pour tout le compte.
if (process.env.PUBLIC_URL) setInterval(() => {
  const h = Math.floor(parisNow().min / 60);
  if (h >= 6 && h < 22) fetch(process.env.PUBLIC_URL + '/health').catch(() => {});
}, 10 * 60 * 1000);
