'use strict';
/* BeRail — client (vanilla JS) */

const API = (p, opts) => fetch(p, opts).then(async (r) => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'error'); e.data = data; e.status = r.status; throw e; }
  return data;
});
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
  return `style="background:linear-gradient(140deg,hsl(${h} 85% 64%),hsl(${(h + 55) % 360} 78% 46%))"`;
}
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
function postCard(p) {
  const reactBtns = EMOJIS.map((e) => {
    const n = p.reactions[e] || 0;
    return `<button class="react ${p.myReaction === e ? 'on' : ''}" data-act="react" data-post="${p.id}" data-emoji="${e}">${e}${n ? `<b>${n}</b>` : ''}</button>`;
  }).join('');
  const comments = (p.comments || []).slice(-3).map((c) =>
    `<div class="comment"><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join('');
  const more = p.commentCount > 3 ? `<div class="comment" style="color:#7d7d7d">+ ${p.commentCount - 3} autre${p.commentCount - 3 > 1 ? 's' : ''} commentaire${p.commentCount - 3 > 1 ? 's' : ''}</div>` : '';

  return `<article class="post ${p.mine ? 'mine' : ''}" data-post="${p.id}">
    <header class="post-head">
      <div class="avatar" ${avatarStyle(p.userName)}>${initials(p.userName)}</div>
      <div class="post-who">
        <b>${esc(p.userName)}${p.mine ? ' <span style="color:#8a8a8a;font-weight:600">· toi</span>' : ''}</b>
        <span>${ago(p.createdAt)}${p.late ? '<span class="badge-late">⚠️ En retard</span>' : ''}</span>
      </div>
      <div class="spacer"></div>
      <button class="mini-btn" data-act="share" data-post="${p.id}">Code</button>
    </header>
    <div class="post-media">
      <img src="${p.photo}" alt="BeRail de ${esc(p.userName)}" loading="lazy">
      ${p.mine ? '<span class="mine-tag">Ton BeRail</span>' : ''}
    </div>
    ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ''}
    <div class="reactions">${reactBtns}</div>
    <div class="comments">${comments}${more}
      <form class="comment-form" data-act="comment" data-post="${p.id}">
        <input maxlength="160" placeholder="Ajouter un commentaire…" autocomplete="off">
        <button type="submit" aria-label="Envoyer">↑</button>
      </form>
    </div>
  </article>`;
}

function renderFeed() {
  const el = $('#view-feed');
  if (!S.posts.length) {
    el.innerHTML = `
      <div class="view-head"><h2>Fil de la classe</h2><p>La classe #${esc(S.klass.code)} est prête</p></div>
      <div class="empty">
        <div style="font-size:40px;line-height:1;margin-bottom:12px">⚡</div>
        <b>Aucun BeRail pour l'instant.</b><br>
        Lance le premier : photo arrière, photo avant, et c'est parti.<br><br>
        <span style="color:rgba(255,255,255,.45);font-size:12px">Le fil repart à zéro chaque jour.</span>
        <button class="btn btn-primary" style="display:block;margin:18px auto 0;width:100%;max-width:280px" id="emptyTake">Prendre le premier</button>
      </div>`;
    const b = $('#emptyTake');
    if (b) b.onclick = openCapture;
    return;
  }
  const others = S.posts.filter((p) => !p.mine);
  const mine = S.posts.find((p) => p.mine);
  el.innerHTML = `
    <div class="view-head" style="display:flex;align-items:flex-end;justify-content:space-between">
      <div><h2>Fil de la classe</h2><p>${S.posts.length} BeRail${S.posts.length > 1 ? 's' : ''} dans la classe</p></div>
      <span class="chip" style="font-size:11px"># ${esc(S.klass.code)}</span>
    </div>
    ${mine ? postCard(mine) : ''}
    ${others.map(postCard).join('')}`;
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
      ${navigator.share ? '<button class="btn btn-ghost" id="nativeShare">Partager le lien…</button>' : '<button class="btn btn-ghost" id="copyLink">Copier le lien</button>'}
    </div>
  </div>`);
  $('#copyShare').onclick = () => copy(p.shareCode, 'Code copié');
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
    <div class="view-head"><h2>Mémoires</h2><p>${mine.length} BeRail${mine.length > 1 ? 's' : ''} posté${mine.length > 1 ? 's' : ''}</p></div>
    ${mine.length ? `<div class="grid">${mine.map((p) => `
      <figure data-open="${p.id}">
        <img src="${p.photo}" alt="BeRail" loading="lazy">
        ${p.late ? '<span class="g-late">En retard</span>' : ''}
      </figure>`).join('')}</div>`
      : `<div class="empty">Tes BeRail de la classe apparaîtront ici.<br><br><span style="color:#777">Un seul par moment, garde-les précieusement.</span></div>`}`;

  $$('#view-memories figure').forEach((f) => {
    f.onclick = () => {
      const p = S.posts.find((x) => x.id === f.dataset.open);
      if (!p) return;
      openModal(`<div class="sheet" style="padding:0;overflow:hidden;max-width:520px">
        <img src="${p.photo}" style="width:100%;display:block" alt="BeRail">
        <div style="padding:16px">
          <h3>${esc(p.userName)} · ${new Date(p.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</h3>
          <p style="margin:6px 0 14px">${p.caption ? esc(p.caption) : '<span style="color:#777">Sans légende</span>'}</p>
          <div class="row">
            <button class="btn btn-primary" id="memShare">Code de partage</button>
            <button class="btn btn-ghost" data-close>Fermer</button>
          </div>
        </div>
      </div>`);
      $('#memShare').onclick = () => shareModal(p);
      const c = $('#modal [data-close]'); if (c) c.onclick = closeModal;
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
      <div class="stat"><b>${S.posts.length}</b><span>dans la classe</span></div>
    </div>
    <div class="panel">
      <h3>Code de la classe</h3>
      <p>Partage-le pour que tes camarades rejoignent le fil.</p>
      <div class="code-big">${esc(S.klass.code)}</div>
      <div class="row"><button class="btn btn-primary" id="pShare">Partager</button><button class="btn btn-ghost" id="pCopy">Copier</button></div>
    </div>
    ${isOwner ? `<div class="panel">
      <h3>Moment du jour</h3>
      <p>Tu es l'organisateur : lance le BeReal quand tu veux. Tout le monde voit la notification dans les 15 secondes.</p>
      <button class="btn btn-primary" style="width:100%" id="pMoment">${S.moment ? 'Relancer le moment' : '⚡ Lancer le moment'}</button>
    </div>` : ''}
    <div class="panel">
      <h3>Espace & nettoyage</h3>
      <p>Les photos sont effacées automatiquement chaque soir à ${S.purgeHour}h pour libérer la place. Le fil repart à zéro chaque jour, rien ne s'accumule.</p>
      ${isOwner ? '<button class="btn btn-ghost" style="width:100%;color:#ff8a80;border-color:#3d1414" id="pPurge">Vider les photos maintenant</button>' : ''}
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
        await refresh(true);
        toast('⚡ Moment lancé');
      } catch (_) { toast('Impossible de lancer le moment'); }
    };
  }
  if (isOwner) $('#pPurge').onclick = purgeModal;
  $('#pLogout').onclick = logout;
}

function purgeModal() {
  openModal(`<div class="sheet">
    <h3>Vider les photos ?</h3>
    <p>Tous les BeRail et toutes les photos du jour seront supprimés tout de suite. Les comptes et la classe restent en place.</p>
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
  const W = 1080, H = 1440;
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
  return c.toDataURL('image/jpeg', 0.85);
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
    el.innerHTML = `
      <div class="shared-head"><span class="brand"><span class="brand-dot"></span>BeRail</span><span class="chip">Code ${esc(code)}</span></div>
      <div class="shared-card">
        <img src="${p.photo}" alt="BeRail de ${esc(p.userName)}">
        <div class="shared-body">
          <h3>${esc(p.userName)}${p.late ? '<span class="badge-late">⚠️ En retard</span>' : ''}</h3>
          <p>${p.caption ? esc(p.caption) : '<span style="color:#777">Sans légende</span>'} · ${ago(p.createdAt)}</p>
          <p style="color:#777;font-size:12px;margin-top:10px">Classe # ${esc(r.klass.code)}</p>
        </div>
      </div>
      <div class="shared-cta">
        <button class="btn btn-primary" id="sharedJoin">Rejoindre la classe</button>
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
  const mine = S.posts.find((p) => p.mine);
  if (mine) shareModal(mine);
  else classModal();
});
$('#topAvatar').addEventListener('click', () => setView('profile'));
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(renderBanner, 100); });
setInterval(() => { if (S.moment && !S.myPostId) renderBanner(); }, 1000);

boot();
