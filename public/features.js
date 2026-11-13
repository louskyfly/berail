'use strict';
/* BeRail — messages, espace Admin, annonces, pause des notifications, « qui a réagi », bouton remonter.
   Chargé après app.js et extras.js : on enrichit leurs fonctions (setView, renderFeed, renderProfile, postCard, refresh). */
(() => {
  const X = window.BerailDB;
  const DBURL = 'https://sync-3626f-default-rtdb.europe-west1.firebasedatabase.app/berail';
  const isSuper = () => !!(S.user && S.user.id === X.SUPER_ID);
  const code = () => S.klass && S.klass.code;
  const fdt = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fhm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const nameOf = (uid) => (S.stats && S.stats[uid] && S.stats[uid].name) || (S.posts.find((p) => p.userId === uid) || {}).userName || (U.keys[uid] && U.keys[uid].n) || 'Quelqu’un';
  async function q(path, query) { const r = await fetch(`${DBURL}/${path}.json?${query}`); if (!r.ok) throw new Error('db'); return r.json(); }
  const U = { keys: {}, mk: null, rk: null, ctl: {}, announce: null, mute: 0, convs: [], invites: [], unread: 0, open: null, timer: null };

  /* ---------- clés de messagerie (RSA par élève) ---------- */
  async function myRecord() { return X.get(`users/${S.token}`); }
  async function ensureKeys() {
    if (U.mk) return;
    const me = await myRecord();
    if (me && me.rk) U.rk = me.rk;
    if (me && me.mk) U.mk = me.mk;
    else {
      const kp = await crypto.subtle.generateKey({ ...X.RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
      U.mk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
      await X.patch(`users/${S.token}`, { mk: U.mk });
    }
    const pubKey = await X.get(`ukeys/${S.user.id}`).catch(() => null);
    if (!pubKey) {
      const j = JSON.parse(U.mk);
      await X.put(`ukeys/${S.user.id}`, { pub: JSON.stringify({ kty: 'RSA', n: j.n, e: j.e, alg: j.alg, ext: true, key_ops: ['encrypt'] }), n: S.user.name, c: code() }).catch(() => {});
    }
  }
  async function seal(pubJson, text) {
    const k = await crypto.subtle.importKey('jwk', JSON.parse(pubJson), X.RSA, false, ['encrypt']);
    return X.b64(await crypto.subtle.encrypt(X.RSA, k, new TextEncoder().encode(text)));
  }
  async function unseal(privJson, c) {
    const k = await crypto.subtle.importKey('jwk', JSON.parse(privJson), X.RSA, false, ['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt(X.RSA, k, X.unb64(c)));
  }
  async function loadKeys() { const all = (await X.get('ukeys').catch(() => null)) || {}; U.keys = all; return all; }

  /* ---------- conversations ---------- */
  const classConv = () => ({ id: 'K' + code(), name: 'Toute la classe', kind: 'class', members: null });
  const seen = () => JSON.parse(localStorage.getItem('berail.seen') || '{}');
  const markSeen = (cid, at) => { const s = seen(); s[cid] = at; localStorage.setItem('berail.seen', JSON.stringify(s)); };
  async function lastMsg(cid) { const r = await q(`msgs/${cid}`, 'orderBy="$key"&limitToLast=1').catch(() => null); return r ? Object.values(r)[0] : null; }

  async function loadConvs() {
    await ensureKeys();
    const inbox = (await X.get(`inbox/${S.user.id}`).catch(() => null)) || {};
    const out = [], inv = [];
    await Promise.all(Object.entries(inbox).map(async ([rid, c]) => {
      let cid; try { cid = await unseal(U.mk, c); } catch (_) { return; }
      const cv = await X.get(`convs/${cid}`).catch(() => null);
      if (!cv) { X.del(`inbox/${S.user.id}/${rid}`).catch(() => {}); return; }
      const v = { id: cid, rid, name: cv.name, by: cv.by, byName: cv.byName, members: cv.members || {}, invited: cv.invited || {}, at: cv.at };
      if (v.invited[S.user.id]) inv.push(v);
      else if (v.members[S.user.id]) out.push(v);
    }));
    const all = [classConv(), ...out];
    await Promise.all(all.map(async (c) => { c.last = await lastMsg(c.id); }));
    all.sort((a, b) => (b.kind === 'class') - (a.kind === 'class') || ((b.last && b.last.at) || b.at || 0) - ((a.last && a.last.at) || a.at || 0));
    U.convs = all; U.invites = inv;
    const s = seen();
    U.unread = inv.length + all.filter((c) => c.last && c.last.u !== S.user.id && c.last.at > (s[c.id] || 0)).length;
    badge();
  }
  function badge() {
    const t = document.querySelector('.tab[data-view="messages"]'); if (!t) return;
    let b = t.querySelector('.tab-badge');
    if (!U.unread) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('i'); b.className = 'tab-badge'; t.appendChild(b); }
    b.textContent = U.unread > 9 ? '9+' : U.unread;
  }

  async function renderMessages() {
    const el = $('#view-messages');
    if (U.open) return renderChat();
    el.innerHTML = `<div class="view-head"><h2>Messages</h2><p class="msg-notice">🔎 L’administrateur peut lire les conversations.</p></div><p class="muted-c">Chargement…</p>`;
    try { await loadConvs(); } catch (_) { el.querySelector('.muted-c').textContent = 'Impossible de charger les messages.'; return; }
    if (S.view !== 'messages' || U.open) return;
    const s = seen();
    el.innerHTML = `<div class="view-head"><h2>Messages</h2><p class="msg-notice">🔎 L’administrateur peut lire les conversations.</p></div>
      <button class="btn btn-primary" style="width:100%;margin-bottom:14px" id="mNew">＋ Nouvelle conversation</button>
      ${U.invites.length ? `<h3 class="day-label"><span>Invitations</span></h3>${U.invites.map((v) => `
        <div class="conv invite"><div class="conv-main"><b>${esc(v.name)}</b><span>${esc(v.byName || 'Quelqu’un')} t’invite · ${Object.keys(v.members).length} membre${Object.keys(v.members).length > 1 ? 's' : ''}</span></div>
        <div class="row"><button class="mini-btn" data-acc="${v.id}">Accepter</button><button class="mini-btn danger" data-ref="${v.id}">Refuser</button></div></div>`).join('')}` : ''}
      <h3 class="day-label"><span>Conversations</span></h3>
      ${U.convs.map((c) => `<button class="conv" data-open="${c.id}">
        <span class="conv-ico">${c.kind === 'class' ? '👥' : '💬'}</span>
        <div class="conv-main"><b>${esc(c.name)}</b><span>${c.last ? esc((c.last.u === S.user.id ? 'Toi' : c.last.n) + ' : ' + c.last.t).slice(0, 70) : 'Aucun message'}</span></div>
        ${c.last && c.last.u !== S.user.id && c.last.at > (s[c.id] || 0) ? '<i class="dot"></i>' : ''}</button>`).join('')}`;
    $('#mNew').onclick = newConvModal;
    $$('[data-open]', el).forEach((b) => b.onclick = () => openChat(U.convs.find((c) => c.id === b.dataset.open)));
    $$('[data-acc]', el).forEach((b) => b.onclick = async () => { const v = U.invites.find((x) => x.id === b.dataset.acc); await X.patch(`convs/${v.id}`, { [`members/${S.user.id}`]: S.user.name, [`invited/${S.user.id}`]: null }); toast('Invitation acceptée'); renderMessages(); });
    $$('[data-ref]', el).forEach((b) => b.onclick = async () => { const v = U.invites.find((x) => x.id === b.dataset.ref); await X.patch('', { [`convs/${v.id}/invited/${S.user.id}`]: null, [`inbox/${S.user.id}/${v.rid}`]: null }); toast('Invitation refusée'); renderMessages(); });
  }

  async function newConvModal() {
    openModal('<div class="sheet"><h3>Nouvelle conversation</h3><p>Chargement…</p></div>');
    const keys = await loadKeys();
    const people = Object.entries(keys).filter(([id, k]) => k && k.c === code() && id !== S.user.id).sort((a, b) => a[1].n.localeCompare(b[1].n));
    openModal(`<div class="sheet"><h3>Nouvelle conversation</h3>
      <input class="inp-c" id="cvName" maxlength="40" placeholder="Nom du groupe (facultatif)">
      <p style="margin:10px 0 6px">Choisis qui inviter. Chacun doit accepter pour rejoindre.</p>
      <div class="pick-list">${people.map(([id, k]) => `<label class="pick"><input type="checkbox" value="${id}"> ${esc(k.n)}</label>`).join('') || '<p>Personne pour l’instant.</p>'}</div>
      <p class="small-note">Les camarades qui n’ont pas encore ouvert BeRail depuis la mise à jour apparaîtront plus tard.</p>
      <div class="row"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="cvGo">Inviter</button></div></div>`);
    $('#cvGo').onclick = async () => {
      const ids = $$('.pick input:checked').map((i) => i.value);
      if (!ids.length) return toast('Choisis au moins une personne');
      $('#cvGo').disabled = true;
      try {
        const cid = X.hex(16);
        const name = ($('#cvName').value.trim() || [S.user.name, ...ids.map((i) => keys[i].n)].join(', ')).slice(0, 40);
        const invited = {}; ids.forEach((i) => { invited[i] = String(keys[i].n).slice(0, 24); });
        await X.put(`convs/${cid}`, { name, by: S.user.id, byName: S.user.name, at: Date.now(), c: code(), members: { [S.user.id]: S.user.name }, invited });
        const upd = {};
        for (const i of [S.user.id, ...ids]) { const pub = i === S.user.id ? (await X.get(`ukeys/${i}`)).pub : keys[i].pub; upd[`inbox/${i}/${X.hex(8)}`] = await seal(pub, cid); }
        const k = await X.get(`classes/${code()}`);
        if (k && k.pub) upd[`convIdx/${code()}/${X.hex(8)}`] = await seal(k.pub, cid);
        await X.patch('', upd);
        X.addLog(code(), 'conv', S.user.name, `Conversation « ${name} » créée`);
        closeModal(); toast('Invitations envoyées'); renderMessages();
      } catch (_) { toast('Impossible de créer la conversation'); $('#cvGo').disabled = false; }
    };
  }

  function openChat(c, readOnly) { U.open = Object.assign({}, c, { readOnly: !!readOnly }); if (S.view !== 'messages') setView('messages'); else renderChat(); }
  async function renderChat() {
    const c = U.open, el = $('#view-messages');
    const r = await q(`msgs/${c.id}`, 'orderBy="$key"&limitToLast=150').catch(() => null);
    if (U.open !== c || S.view !== 'messages') return;
    const msgs = Object.values(r || {}).sort((a, b) => a.at - b.at);
    const members = c.members ? Object.values(c.members).join(', ') : 'Toute la classe';
    const keepInput = $('#chatIn') ? $('#chatIn').value : '';
    const sig = msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].at : 0);
    if (el.dataset.sig === c.id + sig && $('#chatLog')) return;
    el.dataset.sig = c.id + sig;
    el.innerHTML = `<div class="chat-head"><button class="mini-btn" id="chatBack">‹ Retour</button><div><b>${esc(c.name)}</b><span>${esc(members)}</span></div></div>
      <div class="chat-log" id="chatLog">${msgs.map((m) => `<div class="bubble ${m.u === S.user.id ? 'me' : ''}">${m.u === S.user.id ? '' : `<b>${esc(m.n)}</b>`}${esc(m.t)}<small>${fhm(m.at)}</small></div>`).join('') || '<p class="muted-c">Aucun message. Lance la conversation !</p>'}</div>
      ${c.readOnly ? '<p class="small-note" style="text-align:center">Lecture seule (administrateur)</p>' : `<form class="chat-form" id="chatForm"><input id="chatIn" maxlength="1000" placeholder="Message…" autocomplete="off"><button aria-label="Envoyer">➤</button></form>`}`;
    if (msgs.length) markSeen(c.id, msgs[msgs.length - 1].at);
    const log = $('#chatLog'); log.scrollTop = log.scrollHeight;
    $('#views').scrollTop = $('#views').scrollHeight;
    $('#chatBack').onclick = () => { U.open = null; delete el.dataset.sig; renderMessages(); };
    const f = $('#chatForm');
    if (f) {
      $('#chatIn').value = keepInput;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const t = $('#chatIn').value.trim(); if (!t) return;
        $('#chatIn').value = '';
        try { await X.put(`msgs/${c.id}/${Date.now().toString(36)}${X.hex(3)}`, { u: S.user.id, n: S.user.name, t, at: Date.now() }); renderChat(); }
        catch (_) { $('#chatIn').value = t; toast('Message non envoyé'); }
      };
    }
  }

  /* ---------- vue Messages dans la navigation ---------- */
  const baseSetView = setView;
  setView = function (v) {
    const mv = $('#view-messages');
    if (v !== 'messages') { mv.classList.add('hidden'); U.open = null; return baseSetView(v); }
    S.view = 'messages';
    $$('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === 'messages')));
    ['feed', 'memories', 'profile'].forEach((n) => $('#view-' + n).classList.add('hidden'));
    mv.classList.remove('hidden'); $('#views').scrollTop = 0;
    renderMessages();
  };
  setInterval(() => {
    if (!S.token || !S.user || document.hidden) return;
    if (S.view === 'messages' && U.open) renderChat();
    else if (S.view === 'messages') { /* la liste se recharge à l'ouverture */ }
  }, 3000);
  setInterval(() => { if (S.token && S.user && !document.hidden && !(S.view === 'messages')) loadConvs().catch(() => {}); }, 30000);

  /* ---------- annonces de l'administrateur + contrôles ---------- */
  async function loadClassState() {
    if (!code()) return;
    const [a, c, m, st] = await Promise.all([X.get(`announce/${code()}`), X.get(`ctl/${code()}`), X.get(`mute/${code()}/${S.user.id}`), X.get('site/stopped')].map((p) => p.catch(() => null)));
    if (st && (!st.until || st.until > Date.now()) && !isSuper()) { showStopped(); return; }
    if (!$('#screen-stopped').classList.contains('hidden') && !isSuper()) { location.reload(); return; }
    const changed = JSON.stringify(a) !== JSON.stringify(U.announce);
    U.announce = a; U.ctl = c || {}; U.mute = Number(m) || 0;
    if (changed && S.view === 'feed') renderFeed();
  }
  const baseRefresh = refresh;
  let convsOnce = false;
  refresh = async function (rerender) {
    const r = await baseRefresh(rerender); loadClassState().catch(() => {});
    if (!convsOnce && S.user) { convsOnce = true; loadConvs().catch(() => { convsOnce = false; }); }
    return r;
  };
  setInterval(() => { if (S.token && S.user && !document.hidden) loadClassState().catch(() => {}); }, 20000);

  const baseRenderFeed = renderFeed;
  renderFeed = function () {
    baseRenderFeed();
    const el = $('#view-feed'), a = U.announce;
    const head = el.querySelector('.view-head');
    if (U.ctl.postsOff && head) head.insertAdjacentHTML('afterend', '<div class="ann off">⏸ Les posts sont en pause pour l’instant.</div>');
    if (a && a.t && Number(localStorage.getItem('berail.annHide')) !== a.at && head) {
      head.insertAdjacentHTML('afterend', `<div class="ann"><div><b>📣 ${esc(a.by || 'Administrateur')}</b><p>${esc(a.t)}</p><small>${fdt(a.at)}</small></div><button aria-label="Masquer" id="annHide">✕</button></div>`);
      $('#annHide').onclick = () => { localStorage.setItem('berail.annHide', String(a.at)); renderFeed(); };
    }
  };

  /* ---------- qui a réagi ---------- */
  const basePostCard = postCard;
  postCard = function (p) {
    let h = basePostCard(p);
    if (p.reactionTotal) h = h.replace('<div class="reactions">', `<div class="reactions"><button class="react who" data-act="whoreact" data-post="${p.id}" aria-label="Voir qui a réagi">👀 ${p.reactionTotal}</button>`);
    return h;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="whoreact"]'); if (!b) return;
    e.stopPropagation();
    const p = S.posts.find((x) => x.id === b.dataset.post); if (!p) return;
    const rows = (p.reactors || []).map((r) => `<div class="who-row"><span>${esc(r.name || nameOf(r.userId))}</span><b>${r.emoji}</b></div>`).join('');
    openModal(`<div class="sheet"><h3>Réactions</h3><div class="who-list">${rows || '<p>Personne.</p>'}</div><button class="btn btn-primary" style="width:100%;margin-top:12px" data-close>Fermer</button></div>`);
  }, true);

  /* ---------- profil : pause des notifs + section Admin ---------- */
  const baseRenderProfile = renderProfile;
  renderProfile = function () {
    baseRenderProfile();
    const np = $('#notifPanel');
    if (np) np.insertAdjacentHTML('afterend', mutePanel());
    bindMute();
    if (isSuper()) {
      ['#pMoment', '#pAccounts', '#pPurge'].forEach((s) => { const b = $(s); const pn = b && b.closest('.panel'); if (pn && s !== '#pPurge') pn.remove(); else if (b) b.remove(); });
      const vp = $('#view-profile .view-head');
      vp.insertAdjacentHTML('afterend', '<div class="panel admin-panel" id="adminPanel"><h3>Admin</h3><p>Chargement…</p></div>');
      renderAdmin();
    }
  };
  function mutePanel() {
    const on = U.mute > Date.now();
    return `<div class="panel" id="mutePanel"><h3>Pause des notifications</h3>
      <p>${on ? `En pause jusqu’à ${fhm(U.mute)}.` : 'Coupe les notifications pendant un moment, sans les désactiver.'}</p>
      <div class="chips-row">${[[10, '10 min'], [30, '30 min'], [60, '1 h'], [120, '2 h']].map(([m, l]) => `<button class="mini-btn" data-mute="${m}">${l}</button>`).join('')}
      ${on ? '<button class="mini-btn danger" data-mute="0">Reprendre</button>' : ''}</div></div>`;
  }
  function bindMute() {
    $$('[data-mute]').forEach((b) => b.onclick = async () => {
      const m = Number(b.dataset.mute); const until = m ? Date.now() + m * 60000 : 0;
      try { await X.put(`mute/${code()}/${S.user.id}`, until); U.mute = until; toast(m ? `Notifications en pause ${b.textContent}` : 'Notifications reprises'); const p = $('#mutePanel'); p.outerHTML = mutePanel(); bindMute(); }
      catch (_) { toast('Impossible'); }
    });
  }

  async function srv(action, extra = {}) {
    const ctrl = new AbortController(); const kill = setTimeout(() => ctrl.abort(), 90000);
    try {
      const r = await fetch(PUSH_URL + '/admin', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: S.token, action, ...extra }), signal: ctrl.signal });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'error'); return j;
    } finally { clearTimeout(kill); }
  }
  async function ownerWrite(upd) { await X.patch('', Object.assign(upd, X.proof(S.user, S.token))); }
  const LOGI = { join: '👤', post: '📸', delete: '🗑', admin: '🛠', announce: '📣', conv: '💬' };
  const DAYS = [['1', 'L'], ['2', 'M'], ['3', 'M'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['7', 'D']];
  let admTab = 'ctrl';

  async function renderAdmin() {
    const el = $('#adminPanel'); if (!el) return;
    const [site, log] = await Promise.all([X.get('site/stopped').catch(() => null), q(`log/${code()}`, 'orderBy="$key"&limitToLast=80').catch(() => null)]);
    U.ctl = (await X.get(`ctl/${code()}`).catch(() => null)) || {};
    const closed = site && (!site.until || site.until > Date.now());
    const logs = Object.values(log || {}).sort((a, b) => b.at - a.at);
    const tabs = [['ctrl', 'Contrôles'], ['msg', 'Annonce'], ['hours', 'Horaires'], ['hist', 'Historique'], ['convs', 'Conversations'], ['people', 'Membres']];
    el.innerHTML = `<h3>Admin</h3><p>Tu es le seul administrateur. Tout ce qui suit n’est visible que par toi.</p>
      <div class="adm-tabs">${tabs.map(([k, l]) => `<button class="mini-btn ${admTab === k ? 'on' : ''}" data-at="${k}">${l}</button>`).join('')}</div>
      <div id="admBody"></div>`;
    $$('[data-at]', el).forEach((b) => b.onclick = () => { admTab = b.dataset.at; renderAdmin(); });
    const body = $('#admBody');
    if (admTab === 'ctrl') {
      body.innerHTML = `
        <div class="adm-line"><div><b>Notifications</b><span>${U.ctl.notifsOff ? 'Coupées pour toute la classe' : 'Actives'}</span></div><button class="mini-btn ${U.ctl.notifsOff ? '' : 'danger'}" id="aNotif">${U.ctl.notifsOff ? 'Rallumer' : 'Couper'}</button></div>
        <div class="adm-line"><div><b>Posts de BeRail</b><span>${U.ctl.postsOff ? 'En pause' : 'Ouverts'}</span></div><button class="mini-btn ${U.ctl.postsOff ? '' : 'danger'}" id="aPosts">${U.ctl.postsOff ? 'Rouvrir' : 'Couper'}</button></div>
        <div class="adm-line"><div><b>Site</b><span>${closed ? (site.until ? `Fermé jusqu’à ${fhm(site.until)}` : 'Fermé') : 'Ouvert'}</span></div>
          ${closed ? '<button class="mini-btn" id="aOpen">Rouvrir</button>' : `<div class="chips-row">${[[55, '1 cours'], [120, '2 h'], [0, 'Sans limite']].map(([m, l]) => `<button class="mini-btn danger" data-close-site="${m}">${l}</button>`).join('')}</div>`}</div>
        <p class="small-note">Site fermé : tout le monde voit « Cette page n’existe pas », sauf toi.</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="aFire">⚡ Lancer un BeRail</button></div>
        <div class="row" style="margin-top:10px"><button class="btn btn-ghost" id="aAcc">Comptes & codes</button><button class="btn btn-ghost" id="aPurge">Vider les photos</button></div>`;
      $('#aNotif').onclick = async () => { const v = !U.ctl.notifsOff; try { await ownerWrite({ [`ctl/${code()}/notifsOff`]: v, [`ctl/${code()}/by`]: S.user.id }); X.addLog(code(), 'admin', S.user.name, v ? 'Notifications coupées' : 'Notifications rallumées'); toast(v ? 'Notifications coupées' : 'Notifications rallumées'); } catch (_) { toast('Impossible'); } renderAdmin(); };
      $('#aPosts').onclick = async () => { const v = !U.ctl.postsOff; try { await ownerWrite({ [`ctl/${code()}/postsOff`]: v, [`ctl/${code()}/by`]: S.user.id }); X.addLog(code(), 'admin', S.user.name, v ? 'Posts coupés' : 'Posts rouverts'); toast(v ? 'Posts coupés' : 'Posts rouverts'); } catch (_) { toast('Impossible'); } renderAdmin(); };
      $$('[data-close-site]').forEach((b) => b.onclick = async () => {
        const m = Number(b.dataset.closeSite);
        if (!confirm(m ? `Fermer le site pendant ${b.textContent} ?` : 'Fermer le site sans limite ? Il faudra le rouvrir ici.')) return;
        try { await API('/api/admin/stop', { method: 'POST', body: JSON.stringify({ token: S.token, minutes: m }) }); toast('Site fermé'); } catch (_) { toast('Impossible'); } renderAdmin();
      });
      const op = $('#aOpen'); if (op) op.onclick = async () => { try { await API('/api/admin/unstop', { method: 'POST', body: JSON.stringify({ token: S.token }) }); toast('Site rouvert'); } catch (_) { toast('Impossible'); } renderAdmin(); };
      $('#aFire').onclick = async () => {
        if (!confirm('Lancer un BeRail maintenant ? Toute la classe reçoit une notification.')) return;
        try { await API('/api/moment', { method: 'POST', body: JSON.stringify({ token: S.token }) }); const r = await pushServer('/moment', { token: S.token }); X.addLog(code(), 'admin', S.user.name, 'BeRail lancé'); await refresh(true); toast(`⚡ Lancé${r && r.sent != null ? ` · ${r.sent} notif${r.sent > 1 ? 's' : ''}` : ''}`); } catch (_) { toast('Impossible'); }
      };
      $('#aAcc').onclick = accountsModal; $('#aPurge').onclick = purgeModal;
    }
    if (admTab === 'msg') {
      const a = U.announce;
      body.innerHTML = `<p>Le message part en notification à toute la classe et s’affiche en haut du fil.</p>
        <textarea class="inp-c" id="aMsg" rows="3" maxlength="300" placeholder="Ton message à la classe"></textarea>
        <button class="btn btn-primary" style="width:100%;margin-top:10px" id="aSend">📣 Envoyer à toute la classe</button>
        ${a && a.t ? `<div class="adm-line" style="margin-top:14px"><div><b>Annonce affichée</b><span>${esc(a.t).slice(0, 80)}</span></div><button class="mini-btn danger" id="aClear">Retirer</button></div>` : ''}`;
      $('#aSend').onclick = async () => {
        const t = $('#aMsg').value.trim(); if (!t) return toast('Écris un message');
        $('#aSend').disabled = true; toast('Envoi…');
        try { const r = await srv('notify', { code: code(), title: 'Biblio Manuels', body: t, announce: true }); const n = Object.values(r).reduce((s, x) => s + (x.sent || 0), 0); toast(`Envoyé · ${n} notif${n > 1 ? 's' : ''}`); await loadClassState(); renderAdmin(); }
        catch (_) { toast('Envoi impossible'); $('#aSend').disabled = false; }
      };
      const cl = $('#aClear'); if (cl) cl.onclick = async () => { try { await ownerWrite({ [`announce/${code()}`]: null }); U.announce = null; toast('Annonce retirée'); } catch (_) { toast('Impossible'); } renderAdmin(); };
    }
    if (admTab === 'hist') {
      body.innerHTML = `<div class="hist">${logs.map((l) => `<div class="hist-row"><span class="hist-ico">${LOGI[l.k] || '•'}</span><div><b>${esc(l.w || '')}</b> ${esc(l.t || '')}<small>${fdt(l.at)}</small></div></div>`).join('') || '<p>Rien pour l’instant. L’historique se remplit à partir de maintenant.</p>'}</div>`;
    }
    if (admTab === 'convs') {
      body.innerHTML = '<p>Chargement…</p>';
      try {
        const me = await myRecord(); const rk = me && me.rk;
        const idx = (await X.get(`convIdx/${code()}`).catch(() => null)) || {};
        const list = [classConv()];
        for (const c of Object.values(idx)) { try { const cid = await unseal(rk, c); const cv = await X.get(`convs/${cid}`); if (cv) list.push({ id: cid, name: cv.name, members: cv.members || {}, invited: cv.invited || {}, at: cv.at }); } catch (_) {} }
        await Promise.all(list.map(async (c) => { c.last = await lastMsg(c.id); }));
        body.innerHTML = list.map((c) => `<button class="conv" data-ro="${c.id}"><span class="conv-ico">${c.kind === 'class' ? '👥' : '💬'}</span><div class="conv-main"><b>${esc(c.name)}</b><span>${c.members ? esc(Object.values(c.members).join(', ')) + (Object.keys(c.invited || {}).length ? ` · ${Object.keys(c.invited).length} invité(s)` : '') : 'Toute la classe'}${c.last ? ' · ' + fdt(c.last.at) : ''}</span></div></button>`).join('');
        $$('[data-ro]', body).forEach((b) => b.onclick = () => { const c = list.find((x) => x.id === b.dataset.ro); openChat(c, !(c.kind === 'class' || (c.members && c.members[S.user.id]))); });
      } catch (_) { body.innerHTML = '<p>Impossible de charger les conversations.</p>'; }
    }
    if (admTab === 'hours' || admTab === 'people') {
      body.innerHTML = '<p>Chargement… (le serveur peut mettre jusqu’à une minute à se réveiller)</p>';
      let ov; try { ov = await srv('overview'); } catch (_) { body.innerHTML = '<p>Serveur injoignable, réessaie dans une minute.</p>'; return; }
      if (admTab === 'people') renderPeople(body, ov.classes); else renderHours(body, ov.classes.find((c) => c.code === code()));
    }
  }

  function renderPeople(body, classes) {
    const mine = classes.find((c) => c.code === code()) || { members: [], posts: [], subs: 0 };
    const others = classes.filter((c) => c.code !== code());
    body.innerHTML = `<div class="chips-row" style="margin-bottom:12px"><span class="chip">👥 ${mine.members.length} membres</span><span class="chip">🔔 ${mine.subs} avec notifs</span><span class="chip">📸 ${mine.posts.length} BeRail (7 j)</span>
        ${mine.lastPush ? `<span class="chip">Dernière notif ${fdt(Date.parse(mine.lastPush.at))} · ${mine.lastPush.sent} reçue${mine.lastPush.sent > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="who-list">${mine.members.map((m) => `<div class="who-row"><span>${esc(m.name)}${m.owner ? ' ⭐' : ''}${m.notif ? ' 🔔' : ''}</span><small>${m.createdAt ? 'inscrit ' + fdt(Date.parse(m.createdAt)) : ''}</small></div>`).join('')}</div>
      ${others.length ? `<h3 style="margin-top:16px">Autres classes</h3>${others.map((c) => `<div class="adm-line"><div><b>${esc(c.code)}</b><span>${c.members.map((m) => esc(m.name)).join(', ') || 'vide'}</span></div><button class="mini-btn danger" data-delc="${esc(c.code)}">Supprimer</button></div>`).join('')}` : ''}`;
    $$('[data-delc]', body).forEach((b) => b.onclick = async () => {
      const c = b.dataset.delc; const t = prompt(`Tout sera effacé (membres, photos). Tape ${c} pour confirmer :`);
      if ((t || '').trim().toUpperCase() !== c) return;
      try { await srv('deleteClass', { code: c }); X.addLog(code(), 'admin', S.user.name, `Classe ${c} supprimée`); toast('Classe supprimée'); renderAdmin(); } catch (_) { toast('Impossible'); }
    });
  }

  function renderHours(body, c) {
    const s = (c && c.schedule) || { enabled: false, mode: 'random', time: '12:00', from: '10:00', to: '16:00', days: '12345' };
    let mode = s.mode || 'random';
    body.innerHTML = `${c && c.today ? `<p>${c.today.done ? '✓ BeRail du jour lancé' : `Aujourd’hui : BeRail prévu à ${c.today.at}`}</p>` : '<p>Pas de BeRail automatique prévu aujourd’hui.</p>'}
      <label class="pick"><input type="checkbox" id="hEn" ${s.enabled ? 'checked' : ''}> BeRail automatique</label>
      <div class="chips-row" style="margin:10px 0"><button class="mini-btn ${mode !== 'fixed' ? 'on' : ''}" data-hm="random">Au hasard</button><button class="mini-btn ${mode === 'fixed' ? 'on' : ''}" data-hm="fixed">Heure fixe</button></div>
      <div id="hR" class="${mode === 'fixed' ? 'hidden' : ''}">entre <input type="time" id="hFrom" value="${esc(s.from)}"> et <input type="time" id="hTo" value="${esc(s.to)}"></div>
      <div id="hF" class="${mode === 'fixed' ? '' : 'hidden'}">à <input type="time" id="hTime" value="${esc(s.time)}"></div>
      <div class="chips-row" style="margin:10px 0">${DAYS.map(([d, l]) => `<button class="mini-btn ${String(s.days).includes(d) ? 'on' : ''}" data-hd="${d}">${l}</button>`).join('')}</div>
      <button class="btn btn-primary" style="width:100%" id="hSave">Enregistrer les horaires</button>`;
    $$('[data-hm]', body).forEach((b) => b.onclick = () => { mode = b.dataset.hm; $$('[data-hm]', body).forEach((x) => x.classList.toggle('on', x === b)); $('#hR').classList.toggle('hidden', mode === 'fixed'); $('#hF').classList.toggle('hidden', mode !== 'fixed'); });
    $$('[data-hd]', body).forEach((b) => b.onclick = () => b.classList.toggle('on'));
    $('#hSave').onclick = async () => {
      const schedule = { enabled: $('#hEn').checked, mode, time: $('#hTime').value, from: $('#hFrom').value, to: $('#hTo').value, days: $$('[data-hd].on', body).map((b) => b.dataset.hd).join('') };
      if (mode !== 'fixed' && schedule.from >= schedule.to) return toast('La fin doit être après le début');
      if (!schedule.days) return toast('Choisis au moins un jour');
      const resetToday = !!(c && c.today && c.today.done && confirm('Le BeRail d’aujourd’hui est déjà passé. En relancer un aujourd’hui avec ces horaires ?'));
      try { await srv('schedule', { code: code(), schedule, resetToday }); X.addLog(code(), 'admin', S.user.name, 'Horaires modifiés'); toast('Horaires enregistrés'); renderAdmin(); } catch (_) { toast('Impossible'); }
    };
  }

  /* ---------- bouton remonter ---------- */
  const views = $('#views'); const top = $('#toTop');
  if (views && top) {
    views.addEventListener('scroll', () => top.classList.toggle('show', views.scrollTop > 500), { passive: true });
    top.onclick = () => views.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
