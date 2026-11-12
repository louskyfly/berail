'use strict';
/* BeRail — couche de données Firebase Realtime Database (REST, zéro dépendance). */
(function () {
  const DB = 'https://sync-3626f-default-rtdb.europe-west1.firebasedatabase.app/berail';
  const TZ = 'Europe/Paris';
  const RETENTION_DAYS = 7;
  const PURGE_HOUR = 23;
  const LATE_MS = 2 * 60 * 1000;

  async function req(method, path, body) {
    const r = await fetch(`${DB}/${path}.json`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!r.ok) { const e = new Error('server_error'); e.status = r.status; throw e; }
    return r.json();
  }
  const get = (p) => req('GET', p);
  const put = (p, v) => req('PUT', p, v);
  const patch = (p, v) => req('PATCH', p, v);
  const del = (p) => req('DELETE', p);

  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const uid = (n = 8) => hex(n);
  const shortCode = () => hex(3).toUpperCase();
  const nowIso = () => new Date().toISOString();
  const normalizeCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
  const cleanName = (n) => String(n || '').trim().slice(0, 24);
  const normUser = (u) => String(u || '').trim().toLowerCase().replace(/^@/, '').replace(/\./g, '~').replace(/[^a-z0-9_~-]/g, '');
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (d = new Date()) => dayFmt.format(d);

  function fail(status, error) { const e = new Error(error); e.status = status; e.data = { error }; throw e; }

  const photoCache = new Map();
  const idb = new Promise((res) => {
    try { const r = indexedDB.open('berail-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
    catch (_) { res(null); }
  });
  async function idbGet(id) { const d = await idb; if (!d) return null; return new Promise((res) => { try { const q = d.transaction('p').objectStore('p').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (_) { res(null); } }); }
  async function idbSet(id, v) { const d = await idb; if (!d) return; try { const t = d.transaction('p', 'readwrite').objectStore('p'); v == null ? t.delete(id) : t.put(v, id); } catch (_) {} }
  const inflight = new Map();
  async function photoOf(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    if (inflight.has(id)) return inflight.get(id);
    const job = (async () => { let p = await idbGet(id); if (!p) { p = (await get(`photos/${id}`)) || ''; if (p) idbSet(id, p); } if (p) photoCache.set(id, p); return p; })();
    inflight.set(id, job); try { return await job; } finally { inflight.delete(id); }
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => { for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); hydrate(en.target); } }, { rootMargin: '600px 0px' }) : null;
  async function hydrate(img) { const id = img.dataset.pid; if (!id || img.dataset.loaded) return; img.dataset.loaded = '1'; const src = await photoOf(id).catch(() => ''); if (src) { img.src = src; img.classList.add('ready'); } }
  function scan(root) { (root.querySelectorAll ? root.querySelectorAll('img[data-pid]:not([data-loaded])') : []).forEach((img) => { if (photoCache.has(img.dataset.pid) || !io) hydrate(img); else io.observe(img); }); }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n.parentNode || n)))).observe(document.documentElement, { childList: true, subtree: true });
  window.BerailPhoto = photoOf;

  let meCache = null; let stoppedCache = null;
  async function isStopped() { if (stoppedCache !== null) return stoppedCache; stoppedCache = !!(await get('site/stopped')); return stoppedCache; }

  async function userFromToken(token) {
    if (!token || !/^[a-f0-9]{32}$/.test(token)) fail(401, 'unauthorized');
    if (meCache && meCache.token === token) return meCache.user;
    const u = await get(`users/${token}`);
    if (!u) fail(401, 'unauthorized');
    meCache = { token, user: u }; return u;
  }
  const klassOf = async (code) => (await get(`classes/${code}`)) || { code, owner: null, moment: null };
  const klassView = (k) => ({ code: k.code, owner: k.owner || null, moment: k.moment || null, ownerName: k.ownerName || null });
  const publicUser = (u, k) => ({ id: u.id, name: u.name, username: u.username || null, classCode: u.classCode, owner: !!(k && k.owner === u.id), role: u.role || (k && k.owner === u.id ? 'admin' : 'student') });
  async function listPosts(code) { const obj = (await get(`posts/${code}`)) || {}; return Object.values(obj).filter((p) => p && p.id); }

  function ageDays(iso) { const a = Date.parse(dayKey(new Date(iso)) + 'T00:00:00Z'); const b = Date.parse(dayKey() + 'T00:00:00Z'); return Math.round((b - a) / 86400000); }
  let lastClean = 0;
  async function cleanup(code, force = false) {
    if (!force && Date.now() - lastClean < 5 * 60 * 1000) return 0;
    lastClean = Date.now(); const today = dayKey(); const k = await klassOf(code); const posts = await listPosts(code);
    const stale = posts.filter((p) => force || ageDays(p.createdAt) >= RETENTION_DAYS); const upd = {};
    for (const p of stale) { upd[`posts/${code}/${p.id}`] = null; upd[`photos/${p.id}`] = null; upd[`photos/${p.id}f`] = null; upd[`shares/${p.shareCode}`] = null; photoCache.delete(p.id); idbSet(p.id, null); }
    if (k.moment && dayKey(new Date(k.moment.at)) !== today) upd[`classes/${code}/moment`] = null;
    if (Object.keys(upd).length) await patch('', upd); return stale.length;
  }

  async function postView(p, viewer) {
    const reactions = {}; let total = 0, myReaction = null;
    for (const [userId, emoji] of Object.entries(p.reactions || {})) { reactions[emoji] = (reactions[emoji] || 0) + 1; total++; if (viewer && userId === viewer.id) myReaction = emoji; }
    const comments = Object.values(p.comments || {}).sort((a, b) => String(a.at).localeCompare(String(b.at))).map((c) => ({ name: c.name, text: c.text, at: c.at }));
    return { id: p.id, shareCode: p.shareCode, userName: p.userName, userId: p.userId, photo: photoCache.get(p.id) || '', caption: p.caption || '', late: !!p.late, flip: !!p.flip, createdAt: p.createdAt, mine: !!(viewer && viewer.id === p.userId), reactions, myReaction, reactionTotal: total, comments, commentCount: comments.length };
  }

  function genPin() { return String(1000 + Math.floor(Math.random() * 9000)); }
  function validPin(pin) { return /^\d{4}$/.test(String(pin || '').trim()); }
  function validUsername(u) { return /^[a-z0-9_~-]{2,20}$/.test(normUser(u)); }
  async function findAccount(un) { const a = await get(`accounts/${un}`); return a && a.token ? a : null; }
  async function listClassAccounts(code) {
    const usersObj = (await get(`usersByClass/${code}`)) || {};
    const rows = [];
    for (const tok of Object.keys(usersObj)) {
      const u = await get(`users/${tok}`);
      if (!u) continue;
      const acc = u.usernameNorm ? await get(`accounts/${u.usernameNorm}`) : null;
      rows.push({ id: u.id, token: tok, name: u.name, username: u.username || null, pin: acc ? (acc.pin || '') : (u.pin || ''), role: u.role || 'student', createdAt: u.createdAt || null });
    }
    rows.sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1) || String(a.name).localeCompare(String(b.name)));
    return rows;
  }

  async function api(path, opts = {}) {
    const url = new URL(path, location.origin);
    const route = url.pathname; const q = url.searchParams; const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};

    if (route !== '/api/site' && route !== '/api/admin/unstop') { if (await isStopped()) fail(410, 'site_stopped'); }
    if (method === 'GET' && route === '/api/site') return { stopped: !!(await get('site/stopped')) };
    if (method === 'POST' && route === '/api/admin/stop') {
      const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      await put('site/stopped', { at: nowIso(), by: u.id }); stoppedCache = true; return { ok: true };
    }
    if (method === 'POST' && route === '/api/admin/unstop') {
      const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      await put('site/stopped', null); stoppedCache = false; return { ok: true };
    }

    if (method === 'POST' && route === '/api/setup') {
      const username = String(body.username || '').trim().replace(/^@/, ''); const un = normUser(username);
      const pin = String(body.pin || '').trim(); const classCode = normalizeCode(body.classCode);
      if (!validUsername(username)) fail(400, 'bad_username');
      if (!validPin(pin)) fail(400, 'bad_pin');
      if (!/^[A-Z0-9-]{3,12}$/.test(classCode)) fail(400, 'bad_code');
      if (await findAccount(un)) fail(409, 'username_taken');
      let k = await get(`classes/${classCode}`);
      const token = uid(16); const userId = uid(6);
      const name = cleanName(body.name || username) || username;
      const role = k && k.owner ? 'student' : 'admin';
      if (!k) { k = { code: classCode, name: classCode, owner: userId, ownerName: name, createdAt: nowIso() }; await put(`classes/${classCode}`, k); }
      const user = { id: userId, name, username, usernameNorm: un, classCode, role, pin, createdAt: nowIso() };
      await put(`users/${token}`, user); await put(`usersByClass/${classCode}/${token}`, true);
      await put(`accounts/${un}`, { username, usernameNorm: un, pin, token, userId, classCode, role, name, createdAt: nowIso() });
      meCache = { token, user }; return { token, user: publicUser(user, k), klass: klassView(k) };
    }

    if (method === 'POST' && route === '/api/login-pin') {
      const un = normUser(body.username); const pin = String(body.pin || '').trim();
      const a = await findAccount(un);
      if (!a || String(a.pin) !== pin) fail(401, 'bad_login');
      meCache = null; const u = await userFromToken(a.token).catch(() => fail(410, 'account_gone'));
      const k = await klassOf(u.classCode); return { token: a.token, user: publicUser(u, k), klass: klassView(k) };
    }

    if (route === '/api/admin/accounts' && method === 'GET') {
      const u = await userFromToken(q.get('token')); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      return { accounts: await listClassAccounts(u.classCode) };
    }
    if (route === '/api/admin/accounts' && method === 'POST') {
      const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      const username = String(body.username || '').trim().replace(/^@/, ''); const un = normUser(username);
      const pin = validPin(body.pin) ? String(body.pin).trim() : genPin(); const name = cleanName(body.name || username) || username;
      if (!validUsername(username)) fail(400, 'bad_username'); if (await findAccount(un)) fail(409, 'username_taken');
      const token = uid(16); const userId = uid(6);
      const nu = { id: userId, name, username, usernameNorm: un, classCode: u.classCode, role: 'student', pin, createdAt: nowIso() };
      await put(`users/${token}`, nu); await put(`usersByClass/${u.classCode}/${token}`, true);
      await put(`accounts/${un}`, { username, usernameNorm: un, pin, token, userId, classCode: u.classCode, role: 'student', name, createdAt: nowIso() });
      return { account: { id: userId, name, username, pin, role: 'student', token } };
    }
    if (method === 'POST' && /^\/api\/admin\/accounts\/[^/]+\/reset-pin$/.test(route)) {
      const targetToken = decodeURIComponent(route.split('/')[4]); const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      const tu = await get(`users/${targetToken}`); if (!tu || tu.classCode !== u.classCode) fail(404, 'not_found');
      const pin = validPin(body.pin) ? String(body.pin).trim() : genPin(); tu.pin = pin; await put(`users/${targetToken}`, tu);
      if (tu.usernameNorm) { const a = await get(`accounts/${tu.usernameNorm}`); if (a) { a.pin = pin; await put(`accounts/${tu.usernameNorm}`, a); } }
      return { pin };
    }
    if (method === 'DELETE' && /^\/api\/admin\/accounts\/[^/]+$/.test(route)) {
      const targetToken = decodeURIComponent(route.split('/')[4]); const u = await userFromToken(q.get('token') || body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      const tu = await get(`users/${targetToken}`); if (!tu || tu.classCode !== u.classCode) fail(404, 'not_found');
      if (tu.id === k.owner) fail(400, 'cannot_delete_owner');
      await del(`users/${targetToken}`); await del(`usersByClass/${u.classCode}/${targetToken}`);
      if (tu.usernameNorm) { await del(`accounts/${tu.usernameNorm}`); }
      return { ok: true };
    }

    // compat/anciens
    if (method === 'POST' && route === '/api/join') fail(403, 'use_setup');
    if (method === 'POST' && route === '/api/register') fail(403, 'use_setup');
    if (method === 'POST' && route === '/api/login') fail(403, 'use_login_pin');
    if (method === 'POST' && route === '/api/secure') return { ok: true };

    if (method === 'GET' && route === '/api/me') { const u = await userFromToken(q.get('token')); const k = await klassOf(u.classCode); return { user: publicUser(u, k), klass: klassView(k), serverTime: Date.now() }; }
    if (method === 'GET' && route === '/api/state') {
      const u = await userFromToken(q.get('token')); await cleanup(u.classCode); const k = await klassOf(u.classCode);
      const posts = await listPosts(u.classCode); const mine = posts.filter((p) => p.userId === u.id && dayKey(new Date(p.createdAt)) === dayKey()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return { moment: k.moment || null, myPostId: mine ? mine.id : null, postCount: posts.length, serverTime: Date.now() };
    }
    if (method === 'GET' && route === '/api/feed') {
      const u = await userFromToken(q.get('token')); await cleanup(u.classCode); const k = await klassOf(u.classCode);
      const raw = (await listPosts(u.classCode)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400);
      const posts = await Promise.all(raw.map((p) => postView(p, u)));
      const [profiles, stats, momentDays] = await Promise.all([get(`profiles/${u.classCode}`), get(`stats/${u.classCode}`), get(`momentDays/${u.classCode}`)]);
      const md = momentDays || {};
      if (k.moment && dayKey(new Date(k.moment.at)) === dayKey() && !md[dayKey()]) { md[dayKey()] = true; put(`momentDays/${u.classCode}/${dayKey()}`, true).catch(() => {}); }
      return { klass: klassView(k), posts, profiles: profiles || {}, stats: stats || {}, momentDays: md, today: dayKey(), myPostId: posts.find((p) => p.mine && dayKey(new Date(p.createdAt)) === dayKey())?.id || null, purgeHour: PURGE_HOUR, retentionDays: RETENTION_DAYS, serverTime: Date.now() };
    }
    if (method === 'POST' && route === '/api/moment') {
      const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      const moment = { at: Date.now(), by: u.name }; await put(`classes/${u.classCode}/moment`, moment); return { moment };
    }
    if (method === 'POST' && route === '/api/profile') {
      const u = await userFromToken(body.token); const p = body.profile || {};
      const out = { mode: ['initial', 'emoji', 'photo'].includes(p.mode) ? p.mode : 'initial', at: nowIso() };
      if (p.emoji) out.emoji = String(p.emoji).slice(0, 16); if (p.bg) out.bg = String(p.bg).slice(0, 12); if (p.ring) out.ring = String(p.ring).slice(0, 12);
      if (out.mode === 'photo') { const ph = String(p.photo || ''); if (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 90000) fail(400, 'bad_photo'); out.photo = ph; }
      await put(`profiles/${u.classCode}/${u.id}`, out); return { profile: out };
    }
    if (method === 'POST' && route === '/api/push-sub') {
      const u = await userFromToken(body.token);
      if (body.off) { await del(`push/${u.classCode}/${u.id}`); return { ok: true }; }
      if (!/^https:\/\//.test(body.endpoint || '')) fail(400, 'bad_endpoint');
      await put(`push/${u.classCode}/${u.id}`, { endpoint: String(body.endpoint).slice(0, 800), p256dh: String(body.p256dh).slice(0, 200), auth: String(body.auth).slice(0, 60), name: u.name, at: nowIso() }); return { ok: true };
    }
    if (method === 'POST' && route === '/api/purge') {
      const u = await userFromToken(body.token); const k = await klassOf(u.classCode);
      if (!(k.owner === u.id || u.role === 'admin')) fail(403, 'owner_only');
      return { removed: await cleanup(u.classCode, true), purgeHour: PURGE_HOUR };
    }
    if (method === 'POST' && route === '/api/post') {
      const u = await userFromToken(body.token); const photo = String(body.photo || '');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) fail(400, 'bad_photo'); if (photo.length > 1400000) fail(413, 'too_large');
      const k = await klassOf(u.classCode);
      const p = { id: uid(8), shareCode: shortCode(), userId: u.id, userName: u.name, classCode: u.classCode, caption: String(body.caption || '').slice(0, 140), late: !!(k.moment && Date.now() - k.moment.at > LATE_MS), createdAt: nowIso() };
      const flip = String(body.photoFlip || ''); if (/^data:image\/(jpeg|png|webp);base64,/.test(flip) && flip.length <= 1400000) p.flip = true;
      await put(`photos/${p.id}`, photo); if (p.flip) await put(`photos/${p.id}f`, flip);
      await put(`posts/${u.classCode}/${p.id}`, p); await put(`shares/${p.shareCode}`, { classCode: u.classCode, postId: p.id }); photoCache.set(p.id, photo);
      try { const today = dayKey(); if (k.moment && dayKey(new Date(k.moment.at)) === today) { const mineDay = await get(`stats/${u.classCode}/${u.id}/days/${today}`); if (!mineDay) { const others = (await listPosts(u.classCode)).filter((x) => x.id !== p.id && x.userId !== u.id && Date.parse(x.createdAt) >= k.moment.at); const status = p.late ? 'late' : (others.length ? 'ok' : 'first'); await patch(`stats/${u.classCode}/${u.id}`, { name: u.name, [`days/${today}`]: status }); await put(`momentDays/${u.classCode}/${today}`, true); } } } catch (_) {}
      return { post: await postView(p, u) };
    }
    if (method === 'POST' && route === '/api/react') {
      const u = await userFromToken(body.token); const pathP = `posts/${u.classCode}/${body.postId}`; const p = await get(pathP); if (!p) fail(404, 'not_found');
      const emoji = String(body.emoji || '').slice(0, 4); const already = (p.reactions || {})[u.id] === emoji; await put(`${pathP}/reactions/${u.id}`, already ? null : emoji);
      p.reactions = Object.assign({}, p.reactions); if (already) delete p.reactions[u.id]; else p.reactions[u.id] = emoji; return { post: await postView(p, u) };
    }
    if (method === 'POST' && route === '/api/comment') {
      const u = await userFromToken(body.token); const pathP = `posts/${u.classCode}/${body.postId}`; const p = await get(pathP); if (!p) fail(404, 'not_found');
      const text = String(body.text || '').trim().slice(0, 160); if (!text) fail(400, 'empty');
      const c = { name: u.name, text, at: nowIso() }; const cid = Date.now().toString(36) + hex(3); await put(`${pathP}/comments/${cid}`, c); p.comments = Object.assign({}, p.comments, { [cid]: c }); return { post: await postView(p, u) };
    }
    if (method === 'GET' && route.startsWith('/api/p/')) {
      const code = normalizeCode(decodeURIComponent(route.slice('/api/p/'.length))); if (!/^[A-F0-9]{6}$/.test(code)) fail(404, 'not_found');
      const s = await get(`shares/${code}`); if (!s) fail(404, 'not_found'); const p = await get(`posts/${s.classCode}/${s.postId}`); if (!p) fail(404, 'not_found');
      return { post: await postView(p, null), klass: { code: p.classCode } };
    }
    fail(404, 'not_found');
  }

  window.BerailAPI = api; window.BerailDayKey = dayKey;
})();
