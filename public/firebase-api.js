'use strict';
/* BeRail — couche de données Firebase Realtime Database (REST, zéro dépendance).
   Remplace l'ancien serveur Node : mêmes routes /api/..., mêmes réponses,
   mais tout est stocké dans Firebase sous le nœud /berail. */
(function () {
  const DB = 'https://sync-3626f-default-rtdb.europe-west1.firebasedatabase.app/berail';
  const TZ = 'Europe/Paris';
  const RETENTION_DAYS = 7;   // les BeRail restent 7 jours
  const PURGE_HOUR = 23;      // (ancien réglage, gardé pour l'affichage)
  const LATE_MS = 2 * 60 * 1000;

  /* ---------- REST ---------- */
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

  /* ---------- utils ---------- */
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const uid = (n = 8) => hex(n);
  const shortCode = () => hex(3).toUpperCase();
  const nowIso = () => new Date().toISOString();
  const normalizeCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
  const cleanName = (n) => String(n || '').trim().slice(0, 24);
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
  const dayKey = (d = new Date()) => dayFmt.format(d);
  const hourNow = () => Number(hourFmt.format(new Date())) % 24;

  function fail(status, error) {
    const e = new Error(error); e.status = status; e.data = { error }; throw e;
  }

  /* Cache des photos (data URL) : en mémoire + IndexedDB, pour ne pas
     retélécharger les photos à chaque ouverture (quota gratuit Firebase). */
  const photoCache = new Map();
  const idb = new Promise((res) => {
    try {
      const r = indexedDB.open('berail-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (_) { res(null); }
  });
  async function idbGet(id) {
    const d = await idb; if (!d) return null;
    return new Promise((res) => { try { const q = d.transaction('p').objectStore('p').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (_) { res(null); } });
  }
  async function idbSet(id, v) {
    const d = await idb; if (!d) return;
    try { const t = d.transaction('p', 'readwrite').objectStore('p'); v == null ? t.delete(id) : t.put(v, id); } catch (_) {}
  }
  const inflight = new Map();
  async function photoOf(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    if (inflight.has(id)) return inflight.get(id);
    const job = (async () => {
      let p = await idbGet(id);
      if (!p) { p = (await get(`photos/${id}`)) || ''; if (p) idbSet(id, p); }
      if (p) photoCache.set(id, p);
      return p;
    })();
    inflight.set(id, job);
    try { return await job; } finally { inflight.delete(id); }
  }

  /* Chargement paresseux : toute <img data-pid="…"> reçoit sa photo
     quand elle approche de l'écran. */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); hydrate(en.target); }
  }, { rootMargin: '600px 0px' }) : null;
  async function hydrate(img) {
    const id = img.dataset.pid;
    if (!id || img.dataset.loaded) return;
    img.dataset.loaded = '1';
    const src = await photoOf(id).catch(() => '');
    if (src) { img.src = src; img.classList.add('ready'); }
  }
  function scan(root) {
    (root.querySelectorAll ? root.querySelectorAll('img[data-pid]:not([data-loaded])') : []).forEach((img) => {
      if (photoCache.has(img.dataset.pid) || !io) hydrate(img); else io.observe(img);
    });
  }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n.parentNode || n))))
    .observe(document.documentElement, { childList: true, subtree: true });
  window.BerailPhoto = photoOf;

  let meCache = null;
  async function userFromToken(token) {
    if (!token || !/^[a-f0-9]{32}$/.test(token)) fail(401, 'unauthorized');
    if (meCache && meCache.token === token) return meCache.user;
    const u = await get(`users/${token}`);
    if (!u) fail(401, 'unauthorized');
    meCache = { token, user: u };
    return u;
  }
  const klassOf = async (code) => (await get(`classes/${code}`)) || { code, owner: null, moment: null };
  const klassView = (k) => ({ code: k.code, owner: k.owner || null, moment: k.moment || null, ownerName: k.ownerName || null });
  const publicUser = (u, k) => ({ id: u.id, name: u.name, classCode: u.classCode, owner: !!(k && k.owner === u.id) });

  async function listPosts(code) {
    const obj = (await get(`posts/${code}`)) || {};
    return Object.values(obj).filter((p) => p && p.id);
  }

  /* Nettoyage : les BeRail de plus de RETENTION_DAYS jours sont effacés
     (photo comprise). Le « moment » du prof, lui, repart à zéro chaque jour. */
  function ageDays(iso) {
    const a = Date.parse(dayKey(new Date(iso)) + 'T00:00:00Z');
    const b = Date.parse(dayKey() + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }
  let lastClean = 0;
  async function cleanup(code, force = false) {
    if (!force && Date.now() - lastClean < 5 * 60 * 1000) return 0;
    lastClean = Date.now();
    const today = dayKey();
    const k = await klassOf(code);
    const posts = await listPosts(code);
    const stale = posts.filter((p) => force || ageDays(p.createdAt) >= RETENTION_DAYS);
    const upd = {};
    for (const p of stale) {
      upd[`posts/${code}/${p.id}`] = null;
      upd[`photos/${p.id}`] = null;
      upd[`shares/${p.shareCode}`] = null;
      photoCache.delete(p.id); idbSet(p.id, null);
    }
    if (k.moment && dayKey(new Date(k.moment.at)) !== today) upd[`classes/${code}/moment`] = null;
    if (Object.keys(upd).length) await patch('', upd);
    return stale.length;
  }

  async function postView(p, viewer) {
    const reactions = {};
    let total = 0, myReaction = null;
    for (const [userId, emoji] of Object.entries(p.reactions || {})) {
      reactions[emoji] = (reactions[emoji] || 0) + 1; total++;
      if (viewer && userId === viewer.id) myReaction = emoji;
    }
    const comments = Object.values(p.comments || {}).sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((c) => ({ name: c.name, text: c.text, at: c.at }));
    return {
      id: p.id, shareCode: p.shareCode, userName: p.userName, userId: p.userId,
      photo: photoCache.get(p.id) || '', caption: p.caption || '', late: !!p.late, createdAt: p.createdAt,
      mine: !!(viewer && viewer.id === p.userId),
      reactions, myReaction, reactionTotal: total, comments, commentCount: comments.length
    };
  }

  /* ---------- routes ---------- */
  async function api(path, opts = {}) {
    const url = new URL(path, location.origin);
    const route = url.pathname;
    const q = url.searchParams;
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};

    if (method === 'POST' && route === '/api/join') {
      const name = cleanName(body.name);
      const code = normalizeCode(body.code);
      if (name.length < 2) fail(400, 'name_too_short');
      if (!/^[A-Z0-9-]{3,12}$/.test(code)) fail(400, 'bad_code');
      let k = await get(`classes/${code}`);
      const token = uid(16);
      const user = { id: uid(6), name, classCode: code, createdAt: nowIso() };
      await put(`users/${token}`, user);
      if (!k) {
        if (!body.create) { await del(`users/${token}`); fail(404, 'unknown_class'); }
        k = { code, name: code, owner: user.id, ownerName: name, createdAt: nowIso() };
        await put(`classes/${code}`, k);
      }
      meCache = { token, user };
      return { token, user: publicUser(user, k), klass: klassView(k) };
    }

    if (method === 'GET' && route === '/api/me') {
      const u = await userFromToken(q.get('token'));
      const k = await klassOf(u.classCode);
      return { user: publicUser(u, k), klass: klassView(k), serverTime: Date.now() };
    }

    if (method === 'GET' && route === '/api/state') {
      const u = await userFromToken(q.get('token'));
      await cleanup(u.classCode);
      const k = await klassOf(u.classCode);
      const posts = await listPosts(u.classCode);
      const mine = posts.filter((p) => p.userId === u.id && dayKey(new Date(p.createdAt)) === dayKey()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return { moment: k.moment || null, myPostId: mine ? mine.id : null, postCount: posts.length, serverTime: Date.now() };
    }

    if (method === 'GET' && route === '/api/feed') {
      const u = await userFromToken(q.get('token'));
      await cleanup(u.classCode);
      const k = await klassOf(u.classCode);
      const raw = (await listPosts(u.classCode)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400);
      const posts = await Promise.all(raw.map((p) => postView(p, u)));
      const mine = posts.find((p) => p.mine && dayKey(new Date(p.createdAt)) === dayKey());
      const profiles = (await get(`profiles/${u.classCode}`)) || {};
      return { klass: klassView(k), posts, profiles, myPostId: mine ? mine.id : null, purgeHour: PURGE_HOUR, retentionDays: RETENTION_DAYS, serverTime: Date.now() };
    }

    if (method === 'POST' && route === '/api/moment') {
      const u = await userFromToken(body.token);
      const k = await klassOf(u.classCode);
      if (k.owner !== u.id) fail(403, 'owner_only');
      const moment = { at: Date.now(), by: u.name };
      await put(`classes/${u.classCode}/moment`, moment);
      return { moment };
    }

    if (method === 'POST' && route === '/api/profile') {
      const u = await userFromToken(body.token);
      const p = body.profile || {};
      const out = { mode: ['initial', 'emoji', 'photo'].includes(p.mode) ? p.mode : 'initial', at: nowIso() };
      if (p.emoji) out.emoji = String(p.emoji).slice(0, 16);
      if (p.bg) out.bg = String(p.bg).slice(0, 12);
      if (p.ring) out.ring = String(p.ring).slice(0, 12);
      if (out.mode === 'photo') {
        const ph = String(p.photo || '');
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 90000) fail(400, 'bad_photo');
        out.photo = ph;
      }
      await put(`profiles/${u.classCode}/${u.id}`, out);
      return { profile: out };
    }

    if (method === 'POST' && route === '/api/push-sub') {
      const u = await userFromToken(body.token);
      if (body.off) { await del(`push/${u.classCode}/${u.id}`); return { ok: true }; }
      if (!/^https:\/\//.test(body.endpoint || '')) fail(400, 'bad_endpoint');
      await put(`push/${u.classCode}/${u.id}`, { endpoint: String(body.endpoint).slice(0, 800), p256dh: String(body.p256dh).slice(0, 200), auth: String(body.auth).slice(0, 60), name: u.name, at: nowIso() });
      return { ok: true };
    }

    if (method === 'POST' && route === '/api/purge') {
      const u = await userFromToken(body.token);
      const k = await klassOf(u.classCode);
      if (k.owner !== u.id) fail(403, 'owner_only');
      const removed = await cleanup(u.classCode, true);
      return { removed, purgeHour: PURGE_HOUR };
    }

    if (method === 'POST' && route === '/api/post') {
      const u = await userFromToken(body.token);
      const photo = String(body.photo || '');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) fail(400, 'bad_photo');
      if (photo.length > 1400000) fail(413, 'too_large');
      const k = await klassOf(u.classCode);
      const p = {
        id: uid(8), shareCode: shortCode(), userId: u.id, userName: u.name, classCode: u.classCode,
        caption: String(body.caption || '').slice(0, 140),
        late: !!(k.moment && Date.now() - k.moment.at > LATE_MS),
        createdAt: nowIso()
      };
      await put(`photos/${p.id}`, photo);
      await put(`posts/${u.classCode}/${p.id}`, p);
      await put(`shares/${p.shareCode}`, { classCode: u.classCode, postId: p.id });
      photoCache.set(p.id, photo);
      return { post: await postView(p, u) };
    }

    if (method === 'POST' && route === '/api/react') {
      const u = await userFromToken(body.token);
      const path = `posts/${u.classCode}/${body.postId}`;
      const p = await get(path);
      if (!p) fail(404, 'not_found');
      const emoji = String(body.emoji || '').slice(0, 4);
      const already = (p.reactions || {})[u.id] === emoji;
      await put(`${path}/reactions/${u.id}`, already ? null : emoji);
      p.reactions = Object.assign({}, p.reactions);
      if (already) delete p.reactions[u.id]; else p.reactions[u.id] = emoji;
      return { post: await postView(p, u) };
    }

    if (method === 'POST' && route === '/api/comment') {
      const u = await userFromToken(body.token);
      const path = `posts/${u.classCode}/${body.postId}`;
      const p = await get(path);
      if (!p) fail(404, 'not_found');
      const text = String(body.text || '').trim().slice(0, 160);
      if (!text) fail(400, 'empty');
      const c = { name: u.name, text, at: nowIso() };
      const cid = Date.now().toString(36) + hex(3);
      await put(`${path}/comments/${cid}`, c);
      p.comments = Object.assign({}, p.comments, { [cid]: c });
      return { post: await postView(p, u) };
    }

    if (method === 'GET' && route.startsWith('/api/p/')) {
      const code = normalizeCode(decodeURIComponent(route.slice('/api/p/'.length)));
      if (!/^[A-F0-9]{6}$/.test(code)) fail(404, 'not_found');
      const s = await get(`shares/${code}`);
      if (!s) fail(404, 'not_found');
      const p = await get(`posts/${s.classCode}/${s.postId}`);
      if (!p) fail(404, 'not_found');
      return { post: await postView(p, null), klass: { code: p.classCode } };
    }

    fail(404, 'not_found');
  }

  window.BerailAPI = api;
  window.BerailDayKey = dayKey;
})();
