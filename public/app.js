'use strict';
/* BeRail — client (vanilla JS) */

/* Données : Firebase Realtime Database (voir firebase-api.js) */
const API = (p, opts) => window.BerailAPI(p, opts);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => (n || '?').trim().slice(0, 1).toUpperCase();
function hueOf(n) {
  let h = 0;
  for (const c of String(n || '?')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function avatarStyle(n) {
  const h = hueOf(n);
  return `style="background:hsl(${h} 45% 52%)"`;
}
const PUSH_URL = 'https://berail-push.onrender.com';
const VAPID_PUBLIC = 'BFm4BdMyqnUxIXmhirnYUdmkM_9uIHPqxF6-ZQHKvqsw0GyH5H62ZVs0nPIE8HjwluPzuINItmN2GowGsMx_-BE';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const ICON = {
  dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const imgTag = (p, alt, cls = '') => `<img class="ph ${cls}" src="${p.photo || BLANK}" data-pid="${p.id}" alt="${esc(alt)}">`;
const EMOJIS = ['😂', '😍', '🔥', '😮', '👏', '💀'];

const S = {
  token: localStorage.getItem('berail.token') || null,
  user: null,
  klass: null,
  posts: [],
  myPostId: null,
  moment: null,
  view: 'feed',
  lastPostCount: 0,
  purgeHour: 23,
  retentionDays: 7,
  sharedMode: false
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1900);
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}
function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- écrans ---------- */
const screens = ['screen-auth', 'screen-app', 'screen-capture', 'screen-shared'];
function showScreen(id) {
  screens.forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
  document.body.style.overflow = id === 'screen-capture' ? 'hidden' : '';
}

/* ---------- auth ---------- */
async function join(create) {
  const name = $('#inName').value.trim();
  const code = $('#inCode').value.trim().toUpperCase();
  const err = $('#authError');
  err.classList.add('hidden');
  $('#joinBtn').disabled = true;
  try {
    const r = await API('/api/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code, create })
    });
    S.token = r.token;
    localStorage.setItem('berail.token', r.token);
    S.user = r.user; S.klass = r.klass; S.moment = r.klass.moment;
    await enterApp();
  } catch (e) {
    $('#joinBtn').disabled = false;
    if (e.data && e.data.error === 'unknown_class') {
      err.textContent = `La classe « ${code} » n'existe pas encore.`;
      err.classList.remove('hidden');
      const cb = $('#createBtn');
      cb.classList.remove('hidden');
      cb.textContent = `Créer la classe « ${code} »`;
      cb.dataset.code = code;
    } else if (e.data && e.data.error === 'name_too_short') {
      err.textContent = 'Ton prénom doit faire au moins 2 lettres.';
      err.classList.remove('hidden');
    } else if (e.data && e.data.error === 'bad_code') {
      err.textContent = 'Le code doit faire 3 à 12 caractères (lettres, chiffres, tiret).';
      err.classList.remove('hidden');
    } else {
      err.textContent = 'Connexion impossible. Vérifie le réseau.';
      err.classList.remove('hidden');
    }
  }
}

async function enterApp() {
  showScreen('screen-app');
  S.sharedMode = false;
  $('#classChip').innerHTML = `# ${esc(S.klass.code)}`;
  updateTopAvatar();
  await refresh(true);
  const qv = new URLSearchParams(location.search).get('view');
  setView(['feed', 'memories', 'profile'].includes(qv) ? qv : 'feed');
  startPolling();
}

async function logout() {
  localStorage.removeItem('berail.token');
  location.reload();
}

function updateTopAvatar() {
  const el = $('#topAvatar');
  if (!el || !S.user) return;
  el.textContent = initials(S.user.name);
  el.setAttribute('style', `background:linear-gradient(140deg,hsl(${hueOf(S.user.name)} 85% 64%),hsl(${(hueOf(S.user.name) + 55) % 360} 78% 46%))`);
}

/* ---------- données ---------- */
async function refresh(rerender = false) {
  const r = await API('/api/feed?token=' + encodeURIComponent(S.token));
  S.posts = r.posts || [];
  S.myPostId = r.myPostId;
  S.klass = r.klass || S.klass;
  S.moment = r.klass ? r.klass.moment : null;
  S.lastPostCount = S.posts.length;
  S.purgeHour = r.purgeHour != null ? r.purgeHour : S.purgeHour;
  S.retentionDays = r.retentionDays || S.retentionDays;
  if (rerender) { renderFeed(); }
  renderBanner();
}

async function poll() {
  if (!S.token || S.sharedMode) return;
  if (document.hidden) return;
  try {
    const st = await API('/api/state?token=' + encodeURIComponent(S.token));
    const prev = S.moment && S.moment.at;
    S.moment = st.moment;
    S.myPostId = st.myPostId;
    renderBanner();
    if (st.moment && st.moment.at !== prev && !st.myPostId) {
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      toast('⚡ C\'est l\'heure du BeRail !');
      if (S.view === 'feed') await refresh(true);
    } else if (st.postCount !== S.lastPostCount) {
      await refresh(true);
    }
  } catch (_) { /* réseau */ }
}
let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 15000);
}

/* ---------- bandeau moment ---------- */
function renderBanner() {
  const el = $('#momentBanner');
  if (!S.moment || S.myPostId) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const left = S.moment.at + 2 * 60 * 1000 - Date.now();
  el.classList.toggle('urgent', left <= 0);
  el.innerHTML = `<div class="moment-txt">${left > 0 ? '⚡ C\'est l\'heure du BeRail !' : '⏰ Tu as raté le moment…'}
      <small>${left > 0 ? `Encore ${mmss(left)} pour être à l'heure` : 'Tu peux encore publier, mais tu seras en retard'}</small></div>
    <button id="bannerGo">${left > 0 ? 'Prendre' : 'Publier'}</button>`;
  $('#bannerGo').onclick = openCapture;
}

/* ---------- feed ---------- */
const todayKey = () => window.BerailDayKey(new Date());
function dayLabel(iso) {
  const k = window.BerailDayKey(new Date(iso));
  const t = todayKey();
  const y = window.BerailDayKey(new Date(Date.now() - 86400000));
  if (k === t) return "Aujourd'hui";
  if (k === y) return 'Hier';
  const s = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function hhmm(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}
function daysLeft(iso) {
  const a = Date.parse(window.BerailDayKey(new Date(iso)) + 'T00:00:00Z');
  const b = Date.parse(todayKey() + 'T00:00:00Z');
  return Math.max(0, S.retentionDays - Math.round((b - a) / 86400000));
}

function postCard(p) {
  const reactBtns = EMOJIS.map((e) => {
    const n = p.reactions[e] || 0;
    return `<button class="react ${p.myReaction === e ? 'on' : ''}" data-act="react" data-post="${p.id}" data-emoji="${e}">${e}${n ? `<b>${n}</b>` : ''}</button>`;
  }).join('');
  const comments = (p.comments || []).slice(-3).map((c) =>
    `<div class="comment"><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join('');
  const more = p.commentCount > 3 ? `<div class="comment more">+ ${p.commentCount - 3} autre${p.commentCount - 3 > 1 ? 's' : ''} commentaire${p.commentCount - 3 > 1 ? 's' : ''}</div>` : '';
  const left = daysLeft(p.createdAt);

  return `<article class="post ${p.mine ? 'mine' : ''}" data-post="${p.id}">
    <div class="post-media">
      ${imgTag(p, 'BeRail de ' + p.userName)}
      <div class="media-top">
        <div class="avatar" ${avatarStyle(p.userName)}>${initials(p.userName)}</div>
        <div class="post-who">
          <b>${esc(p.userName)}${p.mine ? ' <i>· toi</i>' : ''}</b>
          <span>${hhmm(p.createdAt)} · ${left <= 1 ? "s'efface ce soir" : `encore ${left} j`}${p.late ? '<span class="badge-late">En retard</span>' : ''}</span>
        </div>
      </div>
      <div class="media-actions">
        <button class="glass-btn" data-act="download" data-post="${p.id}" aria-label="Télécharger">${ICON.dl}</button>
        <button class="glass-btn" data-act="share" data-post="${p.id}" aria-label="Partager">${ICON.share}</button>
      </div>
    </div>
    ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ''}
    <div class="reactions">${reactBtns}</div>
    <div class="comments">${comments}${more}</div>
    <form class="comment-form" data-act="comment" data-post="${p.id}">
      <input maxlength="160" placeholder="Ajouter un commentaire…" autocomplete="off">
      <button type="submit" aria-label="Envoyer">↑</button>
    </form>
  </article>`;
}

function storiesRow() {
  const today = S.posts.filter((p) => window.BerailDayKey(new Date(p.createdAt)) === todayKey());
  const seen = new Set();
  const people = [];
  for (const p of today) if (!seen.has(p.userId)) { seen.add(p.userId); people.push(p); }
  const meDone = today.some((p) => p.mine);
  const me = `<button class="story ${meDone ? 'done' : 'todo'}" ${meDone ? `data-jump="${today.find((p) => p.mine).id}"` : 'id="storyMe"'}>
      <span class="story-ring"><span class="avatar" ${avatarStyle(S.user.name)}>${meDone ? initials(S.user.name) : '+'}</span></span>
      <span class="story-name">Toi</span></button>`;
  const others = people.filter((p) => !p.mine).map((p) => `<button class="story done" data-jump="${p.id}">
      <span class="story-ring"><span class="avatar" ${avatarStyle(p.userName)}>${initials(p.userName)}</span></span>
      <span class="story-name">${esc(p.userName)}</span></button>`).join('');
  return `<div class="stories">${me}${others}</div>`;
}

function renderFeed() {
  const el = $('#view-feed');
  const week = S.posts.length;
  const head = `<div class="view-head feed-head">
      <div><p class="eyebrow">Classe # ${esc(S.klass.code)}</p><h2>Le fil</h2>
      <p>${week ? `${week} BeRail${week > 1 ? 's' : ''} cette semaine` : 'Rien cette semaine'} · gardés ${S.retentionDays} jours</p></div>
    </div>`;
  if (!week) {
    el.innerHTML = head + `
      <div class="empty">
        <div class="empty-icon">⚡</div>
        <b>Aucun BeRail pour l'instant.</b><br>
        Lance le premier : photo arrière, photo avant, et c'est parti.
        <button class="btn btn-primary" id="emptyTake">Prendre le premier</button>
      </div>`;
    const b = $('#emptyTake');
    if (b) b.onclick = openCapture;
    return;
  }
  // aujourd'hui : mon BeRail en premier ; ensuite par jour, du plus récent au plus ancien
  const sorted = [...S.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = [];
  for (const p of sorted) {
    const k = window.BerailDayKey(new Date(p.createdAt));
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) groups.push(g = { key: k, label: dayLabel(p.createdAt), posts: [] });
    g.posts.push(p);
  }
  for (const g of groups) g.posts.sort((a, b) => (b.mine - a.mine) || b.createdAt.localeCompare(a.createdAt));
  el.innerHTML = head + storiesRow() + groups.map((g) => `
    <section class="day">
      <h3 class="day-label"><span>${esc(g.label)}</span><small>${g.posts.length} BeRail${g.posts.length > 1 ? 's' : ''}</small></h3>
      ${g.posts.map(postCard).join('')}
    </section>`).join('');
  const sm = $('#storyMe'); if (sm) sm.onclick = openCapture;
  $$('#view-feed [data-jump]').forEach((b) => b.onclick = () => {
    const t = $(`#view-feed article[data-post="${b.dataset.jump}"]`);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------- téléchargement ---------- */
async function downloadPost(p) {
  try {
    toast('Préparation…');
    const dataUrl = p.photo || await window.BerailPhoto(p.id);
    if (!dataUrl) throw new Error('no_photo');
    const blob = await (await fetch(dataUrl)).blob();
    const d = new Date(p.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }).replace(/\//g, '-');
    const name = `BeRail-${(p.userName || 'photo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '')}-${d}.jpg`;
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // iPad / iPhone : la feuille de partage propose « Enregistrer l'image »
      await navigator.share({ files: [file], title: 'BeRail de ' + p.userName });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Photo téléchargée');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Téléchargement impossible');
  }
}

/* ---------- interactions feed ---------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const postId = btn.dataset.post;
  if (act === 'react') {
    try {
      const r = await API('/api/react', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: S.token, postId, emoji: btn.dataset.emoji })
      });
      const idx = S.posts.findIndex((p) => p.id === postId);
      if (idx >= 0) S.posts[idx] = { ...S.posts[idx], ...r.post };
      renderFeed();
      if (S.view === 'memories') renderMemories();
    } catch (_) { toast('Impossible pour le moment'); }
  }
  if (act === 'share') {
    const p = S.posts.find((x) => x.id === postId);
    if (p) shareModal(p);
  }
  if (act === 'download') {
    const p = S.posts.find((x) => x.id === postId) || S.sharedPost;
    if (p) downloadPost(p);
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-act="comment"]');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  try {
    const r = await API('/api/comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: S.token, postId: form.dataset.post, text })
    });
    const idx = S.posts.findIndex((p) => p.id === form.dataset.post);
    if (idx >= 0) S.posts[idx] = { ...S.posts[idx], ...r.post };
    renderFeed();
    if (S.view === 'memories') renderMemories();
    toast('Commentaire envoyé');
  } catch (_) { toast('Impossible pour le moment'); }
});

/* ---------- partage par code ---------- */
function shareModal(p) {
  const link = location.origin + '/?p=' + p.shareCode;
  openModal(`<div class="sheet">
    <h3>Partager ce BeRail</h3>
    <p>Donne ce code à qui tu veux : il ouvrira directement ton BeRail, même sans compte.</p>
    <div class="share-code">${esc(p.shareCode)}</div>
    <div class="row" style="flex-direction:column">
      <button class="btn btn-primary" id="copyShare">Copier le code</button>
      <button class="btn btn-ghost" id="dlShare">${ICON.dl} Télécharger la photo</button>
      ${navigator.share ? '<button class="btn btn-ghost" id="nativeShare">Partager le lien…</button>' : '<button class="btn btn-ghost" id="copyLink">Copier le lien</button>'}
    </div>
  </div>`);
  $('#copyShare').onclick = () => copy(p.shareCode, 'Code copié');
  $('#dlShare').onclick = () => downloadPost(p);
  const ns = $('#nativeShare');
  if (ns) ns.onclick = () => navigator.share({ title: 'BeRail de ' + p.userName, text: p.caption || 'Regarde mon BeRail', url: link }).catch(() => {});
  const cl = $('#copyLink');
  if (cl) cl.onclick = () => copy(link, 'Lien copié');
}

function copy(text, msg) {
  const done = () => toast(msg);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (_) { toast(text); }
  ta.remove();
}

function classModal() {
  openModal(`<div class="sheet">
    <h3>Inviter dans la classe</h3>
    <p>Tes camarades ouvrent BeRail et entrent ce code. Ils voient alors le même fil.</p>
    <div class="share-code">${esc(S.klass.code)}</div>
    <div class="row" style="flex-direction:column">
      <button class="btn btn-primary" id="copyClass">Copier le code de classe</button>
      <button class="btn btn-ghost" id="copyClassLink">Copier le lien d'invitation</button>
    </div>
  </div>`);
  $('#copyClass').onclick = () => copy(S.klass.code, 'Code copié');
  $('#copyClassLink').onclick = () => copy(location.origin, 'Lien copié');
}

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.classList.remove('hidden');
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  const close = m.querySelector('[data-close]');
  if (close) close.onclick = closeModal;
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

/* ---------- vues ---------- */
function setView(v) {
  S.view = v;
  $$('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  ['feed', 'memories', 'profile'].forEach((name) => $('#view-' + name).classList.toggle('hidden', name !== v));
  $('#views').scrollTop = 0;
  window.scrollTo(0, 0);
  if (v === 'feed') renderFeed();
  if (v === 'memories') renderMemories();
  if (v === 'profile') renderProfile();
}

function renderMemories() {
  const mine = S.posts.filter((p) => p.mine);
  const el = $('#view-memories');
  el.innerHTML = `
    <div class="view-head"><p class="eyebrow">Les ${S.retentionDays} derniers jours</p><h2>Mémoires</h2><p>${mine.length} BeRail${mine.length > 1 ? 's' : ''} posté${mine.length > 1 ? 's' : ''} · télécharge ceux que tu veux garder</p></div>
    ${mine.length ? `<div class="grid">${mine.map((p) => `
      <figure data-open="${p.id}">
        ${imgTag(p, 'BeRail')}
        <span class="g-date">${esc(dayLabel(p.createdAt))}</span>
        ${p.late ? '<span class="g-late">En retard</span>' : ''}
      </figure>`).join('')}</div>`
      : `<div class="empty">Tes BeRail de la semaine apparaîtront ici.<br><br><span style="color:var(--muted)">Ils restent ${S.retentionDays} jours : télécharge ceux que tu veux garder.</span></div>`}`;

  $$('#view-memories figure').forEach((f) => {
    f.onclick = () => {
      const p = S.posts.find((x) => x.id === f.dataset.open);
      if (!p) return;
      openModal(`<div class="sheet" style="padding:0;overflow:hidden;max-width:520px">
        ${imgTag(p, 'BeRail', 'modal-img')}
        <div style="padding:16px">
          <h3>${esc(p.userName)} · ${new Date(p.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</h3>
          <p style="margin:6px 0 14px">${p.caption ? esc(p.caption) : '<span style="color:var(--muted)">Sans légende</span>'}</p>
          <div class="row">
            <button class="btn btn-primary" id="memDl">${ICON.dl} Télécharger</button>
            <button class="btn btn-ghost" id="memShare">Code</button>
          </div>
        </div>
      </div>`);
      $('#memShare').onclick = () => shareModal(p);
      $('#memDl').onclick = () => downloadPost(p);
    };
  });
}

function renderProfile() {
  const mine = S.posts.filter((p) => p.mine);
  const reactions = mine.reduce((n, p) => n + (p.reactionTotal || 0), 0);
  const isOwner = !!(S.user && S.user.owner);
  $('#view-profile').innerHTML = `
    <div class="view-head"><h2>Profil</h2><p>Ton identité dans cette classe</p></div>
    <div class="profile-card">
      <div class="avatar" ${avatarStyle(S.user.name)}>${initials(S.user.name)}</div>
      <div><h2>${esc(S.user.name)}</h2><p>Classe # ${esc(S.klass.code)}${isOwner ? ' · organisateur' : ''}</p></div>
    </div>
    <div class="stat-row">
      <div class="stat"><b>${mine.length}</b><span>BeRail postés</span></div>
      <div class="stat"><b>${reactions}</b><span>réactions reçues</span></div>
      <div class="stat"><b>${S.posts.length}</b><span>cette semaine</span></div>
    </div>
    <div class="panel">
      <h3>Code de la classe</h3>
      <p>Partage-le pour que tes camarades rejoignent le fil.</p>
      <div class="code-big">${esc(S.klass.code)}</div>
      <div class="row"><button class="btn btn-primary" id="pShare">Partager</button><button class="btn btn-ghost" id="pCopy">Copier</button></div>
    </div>
    ${isOwner ? `<div class="panel">
      <h3>Moment du jour</h3>
      <p>Tu es l'organisateur : lance le BeRail quand tu veux. Toute la classe reçoit une notification.</p>
      <button class="btn btn-primary" style="width:100%" id="pMoment">${S.moment ? 'Relancer le moment' : '⚡ Lancer le moment'}</button>
    </div>` : ''}
    <div class="panel" id="notifPanel"></div>
    <div class="panel">
      <h3>Espace & nettoyage</h3>
      <p>Chaque BeRail reste ${S.retentionDays} jours, puis il est effacé automatiquement pour libérer la place. Télécharge ceux que tu veux garder.</p>
      ${isOwner ? '<button class="btn btn-ghost" style="width:100%;color:var(--danger)" id="pPurge">Vider les photos maintenant</button>' : ''}
    </div>
    <div class="panel">
      <h3>Mon compte</h3>
      <p>Chaque BeRail publié possède son propre code à 6 caractères. Tu peux changer de compte sans perdre tes publications.</p>
      <button class="btn btn-ghost" style="width:100%" id="pLogout">Changer de compte</button>
    </div>`;

  $('#pCopy').onclick = () => copy(S.klass.code, 'Code copié');
  $('#pShare').onclick = classModal;
  if (isOwner) {
    $('#pMoment').onclick = async () => {
      try {
        await API('/api/moment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.token }) });
        pushServer('/moment', { token: S.token });
        await refresh(true);
        toast('⚡ Moment lancé');
      } catch (_) { toast('Impossible de lancer le moment'); }
    };
  }
  if (isOwner) $('#pPurge').onclick = purgeModal;
  renderNotifPanel();
  $('#pLogout').onclick = logout;
}

/* ---------- notifications ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then((r) => { swReg = r; }).catch(() => {});

async function notifState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !isStandalone() ? 'install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}
function b64ToU8(b) {
  const p = '='.repeat((4 - b.length % 4) % 4);
  const raw = atob((b + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enableNotifs() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications refusées'); return false; }
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
  const j = sub.toJSON();
  await window.BerailAPI('/api/push-sub', { method: 'POST', body: JSON.stringify({ token: S.token, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }) });
  toast('🔔 Notifications activées');
  return true;
}
async function disableNotifs() {
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await window.BerailAPI('/api/push-sub', { method: 'POST', body: JSON.stringify({ token: S.token, off: true }) });
  toast('Notifications coupées');
}
function pushServer(path, body) {
  return fetch(PUSH_URL + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => null);
}
async function renderNotifPanel() {
  const el = $('#notifPanel');
  if (!el) return;
  const st = await notifState().catch(() => 'unsupported');
  const txt = {
    install: "Sur iPad : touche Partager ⬆︎ puis « Sur l'écran d'accueil », et ouvre BeRail depuis la nouvelle icône. Le bouton pour activer les notifications apparaîtra ici.",
    unsupported: "Ce navigateur ne gère pas les notifications. Sur iPad, ajoute BeRail à l'écran d'accueil (iPadOS 16.4 ou plus).",
    denied: "Les notifications sont bloquées. Va dans Réglages → Notifications → BeRail pour les autoriser.",
    off: "Reçois une alerte dès que c'est l'heure du BeRail, même quand l'app est fermée.",
    on: "Activées sur cet appareil : tu seras prévenu à chaque BeRail."
  }[st];
  el.innerHTML = `<h3>Notifications</h3><p>${txt}</p>
    ${st === 'off' ? '<button class="btn btn-primary" style="width:100%" id="nOn">🔔 Activer les notifications</button>' : ''}
    ${st === 'on' ? '<div class="row"><button class="btn btn-primary" id="nTest">Tester</button><button class="btn btn-ghost" id="nOff">Couper</button></div>' : ''}`;
  const on = $('#nOn'), off = $('#nOff'), test = $('#nTest');
  if (on) on.onclick = async () => { on.disabled = true; try { await enableNotifs(); } catch (_) { toast('Impossible d\'activer'); } renderNotifPanel(); };
  if (off) off.onclick = async () => { try { await disableNotifs(); } catch (_) {} renderNotifPanel(); };
  if (test) test.onclick = async () => { toast('Envoi du test…'); const r = await pushServer('/test', { token: S.token }); if (!r || !r.sent) toast('Test pas encore arrivé, réessaie dans une minute'); };
}

function purgeModal() {
  openModal(`<div class="sheet">
    <h3>Vider les photos ?</h3>
    <p>Tous les BeRail de la semaine et leurs photos seront supprimés tout de suite. Les comptes et la classe restent en place.</p>
    <div class="row" style="flex-direction:column">
      <button class="btn btn-primary" id="purgeYes">Oui, tout supprimer</button>
      <button class="btn btn-ghost" data-close>Annuler</button>
    </div>
  </div>`);
  $('#purgeYes').onclick = async () => {
    const btn = $('#purgeYes');
    btn.disabled = true; btn.textContent = 'Suppression…';
    try {
      const r = await API('/api/purge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: S.token })
      });
      closeModal();
      await refresh(true);
      setView('profile');
      toast(r.removed ? `${r.removed} photo${r.removed > 1 ? 's' : ''} supprimée${r.removed > 1 ? 's' : ''}` : 'Rien à supprimer');
    } catch (_) {
      btn.disabled = false; btn.textContent = 'Oui, tout supprimer';
      toast('Suppression impossible');
    }
  };
}

/* ---------- capture ---------- */
const cap = { phase: 'back', stream: null, back: null, front: null, photo: null };

async function openCapture() {
  showScreen('screen-capture');
  cap.phase = 'back'; cap.back = null; cap.front = null; cap.photo = null;
  $('#review').classList.add('hidden');
  $('#camError').classList.add('hidden');
  $('#captionInput').value = '';
  setPhaseUI();
  try { await startCam('environment'); }
  catch (e) { showCamError(); }
}

function setPhaseUI() {
  $('#stepLabel').textContent = cap.phase === 'back' ? 'Caméra arrière' : 'Caméra avant';
  $('#captureHint').textContent = cap.phase === 'back' ? 'Photo arrière' : 'Maintenant, ton visage';
  $('#captureSub').textContent = cap.phase === 'back' ? '1 / 2' : '2 / 2';
}

async function startCam(facing) {
  stopCam();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no_camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }
  });
  cap.stream = stream;
  const v = $('#cam');
  v.srcObject = stream;
  try { await v.play(); } catch (_) {}
}
function stopCam() {
  if (cap.stream) { cap.stream.getTracks().forEach((t) => t.stop()); cap.stream = null; }
  $('#cam').srcObject = null;
}

function grab() {
  const v = $('#cam');
  const w = v.videoWidth || 1280, h = v.videoHeight || 960;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  return c;
}

async function shutter() {
  if (cap.phase === 'back') {
    cap.back = grab();
    cap.phase = 'front';
    setPhaseUI();
    try { await startCam('user'); }
    catch (_) { stopCam(); finishCapture(); }
  } else {
    cap.front = grab();
    stopCam();
    finishCapture();
  }
}

function finishCapture() {
  const front = cap.front || cap.back;
  cap.photo = compose(cap.back, front);
  $('#reviewImg').src = cap.photo;
  $('#reviewLate').classList.toggle('hidden', !(S.moment && Date.now() - S.moment.at > 2 * 60 * 1000));
  $('#review').classList.remove('hidden');
  showScreen('screen-capture');
}

function compose(back, front) {
  const W = 960, H = 1280;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  drawCover(x, back, 0, 0, W, H);

  const fw = Math.round(W * 0.33), fh = Math.round(fw * 1.3);
  const fx = Math.round(W * 0.055), fy = Math.round(W * 0.055), r = 26;
  roundRect(x, fx, fy, fw, fh, r); x.save(); x.clip();
  drawCover(x, front, fx, fy, fw, fh);
  x.restore();
  x.lineWidth = 7; x.strokeStyle = '#fff';
  roundRect(x, fx, fy, fw, fh, r); x.stroke();
  return c.toDataURL('image/jpeg', 0.8);
}
function drawCover(ctx, src, x, y, w, h) {
  const iw = src.width, ih = src.height;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function showCamError() {
  stopCam();
  $('#camErrorText').textContent = (location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname))
    ? "La caméra d'iPad nécessite une connexion sécurisée. Ouvre plutôt la version HTTPS, ou ajoute les photos depuis la pellicule."
    : "Caméra indisponible ou refusée. Tu peux choisir des photos dans la pellicule.";
  $('#camError').classList.remove('hidden');
}

async function loadFile(input) {
  const file = input.files && input.files[0];
  if (!file) return null;
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return c;
}

async function publish() {
  if (!cap.photo) return;
  const btn = $('#publishBtn');
  btn.disabled = true; btn.textContent = 'Publication…';
  try {
    const caption = $('#captionInput').value.trim();
    const r = await API('/api/post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: S.token, photo: cap.photo, caption })
    });
    closeCapture();
    await refresh(false);
    setView('feed');
    toast(r.post.late ? 'Publié — mais en retard 😅' : 'BeRail publié ⚡');
  } catch (e) {
    toast(e.data && e.data.error === 'too_large' ? 'Photo trop lourde' : 'Publication impossible');
  } finally {
    btn.disabled = false; btn.textContent = 'Publier';
  }
}

function closeCapture() {
  stopCam();
  $('#review').classList.add('hidden');
  showScreen('screen-app');
}

/* ---------- post partagé via code ---------- */
async function showShared(code) {
  S.sharedMode = true;
  showScreen('screen-shared');
  const el = $('#screen-shared');
  el.innerHTML = `<div class="shared-head"><span class="brand"><span class="brand-dot"></span>BeRail</span><span class="chip">Code ${esc(code)}</span></div>
    <div class="empty">Chargement…</div>`;
  try {
    const r = await API('/api/p/' + encodeURIComponent(code));
    const p = r.post;
    S.sharedPost = p;
    el.innerHTML = `
      <div class="shared-head"><span class="brand"><span class="brand-dot"></span>BeRail</span><span class="chip">Code ${esc(code)}</span></div>
      <div class="shared-card">
        ${imgTag(p, 'BeRail de ' + p.userName)}
        <div class="shared-body">
          <h3>${esc(p.userName)}${p.late ? '<span class="badge-late">⚠️ En retard</span>' : ''}</h3>
          <p>${p.caption ? esc(p.caption) : '<span style="color:var(--muted)">Sans légende</span>'} · ${ago(p.createdAt)}</p>
          <p style="color:var(--muted);font-size:12px;margin-top:10px">Classe # ${esc(r.klass.code)}</p>
        </div>
      </div>
      <div class="shared-cta">
        <button class="btn btn-primary" data-act="download" data-post="${p.id}">${ICON.dl} Télécharger la photo</button>
        <button class="btn btn-ghost" id="sharedJoin">Rejoindre la classe</button>
        <button class="btn btn-ghost" id="sharedCopy">Copier le lien</button>
      </div>`;
    $('#sharedJoin').onclick = () => { S.sharedMode = false; location.href = '/'; };
    $('#sharedCopy').onclick = () => copy(location.origin + '/?p=' + code, 'Lien copié');
  } catch (_) {
    el.innerHTML = `<div class="shared-head"><span class="brand"><span class="brand-dot"></span>BeRail</span></div>
      <div class="empty"><b>Ce code ne correspond à aucun BeRail.</b><br>Vérifie les 6 caractères et réessaie.</div>
      <button class="btn btn-primary" style="width:100%" onclick="location.href='/'">Ouvrir BeRail</button>`;
  }
}

/* ---------- démarrage ---------- */
async function boot() {
  const shared = new URLSearchParams(location.search).get('p');
  if (shared) { showShared(shared.trim().toUpperCase()); return; }

  if (!S.token) {
    showScreen('screen-auth');
    const qs = new URLSearchParams(location.search);
    const asName = qs.get('as'), asCode = qs.get('code');
    if (asCode && !asName) $('#inCode').value = asCode.toUpperCase();
    if (asName && asCode) {
      $('#inName').value = asName;
      $('#inCode').value = asCode.toUpperCase();
      await join(true);
    }
    return;
  }
  try {
    const r = await API('/api/me?token=' + encodeURIComponent(S.token));
    S.user = r.user; S.klass = r.klass; S.moment = r.klass.moment;
    await enterApp();
  } catch (_) {
    localStorage.removeItem('berail.token');
    S.token = null;
    showScreen('screen-auth');
  }
}

/* ---------- écouteurs ---------- */
$('#joinForm').addEventListener('submit', (e) => { e.preventDefault(); join(false); });
$('#createBtn').addEventListener('click', () => join(true));
$('#classChip').addEventListener('click', classModal);
$('#openCapture').addEventListener('click', openCapture);
$('#closeCapture').addEventListener('click', closeCapture);
$('#closeCapture2').addEventListener('click', closeCapture);
$('#shutter').addEventListener('click', shutter);
$('#retake').addEventListener('click', openCapture);
$('#publishBtn').addEventListener('click', publish);
$('#flipCam').addEventListener('click', async () => {
  cap.phase = cap.phase === 'back' ? 'front' : 'back';
  setPhaseUI();
  try { await startCam(cap.phase === 'back' ? 'environment' : 'user'); } catch (_) { showCamError(); }
});
$('#fileBack').addEventListener('change', async (e) => {
  const c = await loadFile(e.target);
  if (c) { cap.back = c; cap.phase = 'front'; setPhaseUI(); toast('Photo arrière ajoutée'); }
});
$('#fileFront').addEventListener('change', async (e) => {
  const c = await loadFile(e.target);
  if (c) { cap.front = c; finishCapture(); }
});
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab[data-view]');
  if (tab) setView(tab.dataset.view);
});
$('#shareTab').addEventListener('click', () => {
  const mine = S.posts.find((p) => p.id === S.myPostId) || S.posts.find((p) => p.mine);
  if (mine) shareModal(mine);
  else classModal();
});
$('#topAvatar').addEventListener('click', () => setView('profile'));
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(renderBanner, 100); });
setInterval(() => { if (S.moment && !S.myPostId) renderBanner(); }, 1000);

boot();
