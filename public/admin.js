'use strict';
/* BeRail — page admin. Parle au serveur berail-push (protégé par le mot de passe admin). */
const SERVER = 'https://berail-push.onrender.com';
const DB = 'https://sync-3626f-default-rtdb.europe-west1.firebasedatabase.app/berail';
const SITE = 'https://berail-lucas.web.app';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const hue = (n) => [...String(n)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (n) => `<span class="avatar" style="background:hsl(${hue(n)} 70% 56%)">${esc(initials(n))}</span>`;
const fdate = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let KEY = localStorage.getItem('berail.adminKey') || '';
let DATA = null;
const openCls = new Set(JSON.parse(localStorage.getItem('berail.adminOpen') || '[]'));

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400); }
function copy(t, msg) { navigator.clipboard.writeText(t).then(() => toast(msg || 'Copié'), () => prompt('Copie :', t)); }

async function call(action, extra = {}) {
  const ctrl = new AbortController();
  const slow = setTimeout(() => toast('Réveil du serveur… (jusqu\'à 1 min)'), 3500);
  const kill = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(SERVER + '/admin', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: KEY, action, ...extra }), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error('bad_key'); e.status = 401; throw e; }
    if (!r.ok) { const e = new Error(j.error || 'error'); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(slow); clearTimeout(kill); }
}

/* ---------- connexion ---------- */
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  KEY = $('#key').value.trim();
  $('#loginBtn').disabled = true; $('#loginErr').classList.add('hidden');
  try { await load(); localStorage.setItem('berail.adminKey', KEY); }
  catch (err) {
    $('#loginErr').textContent = err.status === 401 ? 'Mot de passe incorrect (après 8 essais, blocage 10 min).' : 'Serveur injoignable, réessaie dans une minute.';
    $('#loginErr').classList.remove('hidden');
  } finally { $('#loginBtn').disabled = false; }
};
$('#logout').onclick = () => { localStorage.removeItem('berail.adminKey'); location.reload(); };
$('#reload').onclick = () => load().then(() => toast('À jour'));

async function load() {
  DATA = await call('overview');
  $('#login').classList.add('hidden'); $('#dash').classList.remove('hidden');
  render();
}

/* ---------- rendu ---------- */
const DAYS = [['1', 'L'], ['2', 'M'], ['3', 'M'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['7', 'D']];
function render() {
  const cls = DATA.classes.sort((a, b) => a.code.localeCompare(b.code));
  const totalMembers = cls.reduce((n, c) => n + c.members.length, 0);
  const totalSubs = cls.reduce((n, c) => n + c.subs, 0);
  $('#main').innerHTML = `
  <div class="view-head"><p class="eyebrow">Tableau de bord</p><h2>Admin BeRail</h2>
    <p>${cls.length} classe${cls.length > 1 ? 's' : ''} · ${totalMembers} membre${totalMembers > 1 ? 's' : ''} · ${totalSubs} appareil${totalSubs > 1 ? 's' : ''} avec notifications</p></div>
  <div class="adm-grid two">
    <div class="panel"><h3>Liens</h3>
      <p>Le lien public est pour la classe. Le lien admin est pour toi seul.</p>
      <div class="linkrow"><code>${SITE}</code><button class="btn btn-ghost btn-sm" data-copy="${SITE}">Copier</button></div>
      <div class="linkrow"><code>${SITE}/admin</code><button class="btn btn-ghost btn-sm" data-copy="${SITE}/admin">Copier</button></div>
    </div>
    <div class="panel"><h3>Envoyer une notification</h3>
      <select class="inp" id="nClass"><option value="*">Toutes les classes</option>${cls.map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}</select>
      <input class="inp" id="nTitle" maxlength="60" placeholder="Titre" value="BeRail">
      <textarea class="inp" id="nBody" maxlength="180" rows="2" placeholder="Message"></textarea>
      <button class="btn btn-primary" style="width:100%" id="nSend">Envoyer</button>
    </div>
  </div>
  ${cls.map(classCard).join('')}
  <div class="panel"><h3>Créer une classe</h3>
    <div class="row"><input class="inp" id="newCode" placeholder="Code (ex : 1G3)" maxlength="12" style="text-transform:uppercase"><input class="inp" id="newName" placeholder="Nom" maxlength="12"></div>
    <button class="btn btn-ghost" style="width:100%" id="newBtn">Créer</button>
  </div>`;
  bind();
}

function classCard(c) {
  const s = c.schedule || { enabled: false, mode: 'random', time: '12:00', from: '10:00', to: '16:00', days: '12345' };
  const momentOn = c.moment && Date.now() - c.moment.at < 2 * 60 * 1000;
  const today = !s.enabled ? '<p class="today">Horaires automatiques désactivés</p>'
    : c.today ? `<p class="today ${c.today.done ? 'ok' : 'wait'}">${c.today.done ? '✓ BeRail du jour lancé' : `Aujourd'hui : BeRail prévu à ${c.today.at}`}</p>`
    : '<p class="today">Pas de BeRail prévu aujourd\'hui</p>';
  const open = openCls.has(c.code);
  const invite = `${SITE}/?code=${encodeURIComponent(c.code)}`;
  return `<div class="panel class-card" data-code="${esc(c.code)}">
    <div class="class-head">
      <div><p class="eyebrow">Classe</p><h2>${esc(c.name)}</h2></div>
      <div style="text-align:right"><div class="code-big">${esc(c.code)}</div><span class="muted">code d'accès</span></div>
    </div>
    <div class="kv">
      <span class="chip">👥 <b>${c.members.length}</b> membres</span>
      <span class="chip">🔔 <b>${c.subs}</b> notifs</span>
      <span class="chip">📸 <b>${c.posts.length}</b> BeRail (7 j)</span>
      <span class="chip">⭐ ${esc(c.ownerName || '—')}</span>
      ${c.lastPush ? `<span class="chip">Dernière notif : ${esc(fdate(c.lastPush.at))} · ${c.lastPush.sent} reçue${c.lastPush.sent > 1 ? 's' : ''}${c.lastPush.failed ? ` · ${c.lastPush.failed} échec` : ''}</span>` : ''}
      ${momentOn ? '<span class="chip">⚡ moment en cours</span>' : ''}
    </div>
    <div class="linkrow"><code>${esc(invite)}</code><button class="btn btn-ghost btn-sm" data-copy="${esc(invite)}">Lien d'invitation</button></div>

    <div class="sec"><h4>Heure des photos</h4>
      ${today}
      <label class="switch"><input type="checkbox" class="sEnabled" ${s.enabled ? 'checked' : ''}> BeRail automatique</label>
      <div class="seg"><button class="sMode ${s.mode !== 'fixed' ? 'on' : ''}" data-mode="random">Au hasard</button><button class="sMode ${s.mode === 'fixed' ? 'on' : ''}" data-mode="fixed">Heure fixe</button></div>
      <div class="times sRandom ${s.mode === 'fixed' ? 'hidden' : ''}">entre <input type="time" class="sFrom" value="${esc(s.from)}"> et <input type="time" class="sTo" value="${esc(s.to)}"></div>
      <div class="times sFixed ${s.mode === 'fixed' ? '' : 'hidden'}">à <input type="time" class="sTime" value="${esc(s.time)}"></div>
      <div class="days">${DAYS.map(([d, l]) => `<button class="sDay ${String(s.days).includes(d) ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</div>
      <div class="row"><button class="btn btn-primary sSave">Enregistrer les horaires</button></div>
      <p class="muted" style="margin-top:8px">L'heure au hasard change chaque jour. La notification part à l'heure prévue (à une minute près).</p>
    </div>

    <div class="sec"><h4>Maintenant</h4>
      <div class="row"><button class="btn btn-primary cFire">⚡ Lancer un BeRail</button>${momentOn ? '<button class="btn btn-ghost cStop">Arrêter le moment</button>' : ''}</div>
    </div>

    <div class="sec"><h4>Membres et photos</h4>
      <button class="btn btn-ghost btn-sm cToggle">${open ? 'Masquer' : `Voir les ${c.members.length} membres et ${c.posts.length} photos`}</button>
      ${open ? `
      <div class="members" style="margin-top:12px">${c.members.map((m) => `
        <div class="member">${avatar(m.name)}<div class="who"><b>${esc(m.name)}${m.owner ? '<span class="tag">Organisateur</span>' : ''}${m.notif ? ' 🔔' : ''}</b><span>inscrit ${m.createdAt ? fdate(m.createdAt) : ''}</span></div>
          ${m.owner ? '' : `<button class="btn btn-ghost btn-sm mOwner" data-t="${m.token}">⭐</button>`}
          <button class="btn btn-danger btn-sm mDel" data-t="${m.token}" data-n="${esc(m.name)}">Retirer</button></div>`).join('') || '<p class="muted">Personne pour l\'instant.</p>'}
      </div>
      <div class="adm-photos" style="margin-top:14px">${c.posts.map((p) => `
        <figure><img data-pid="${p.id}" alt=""><figcaption>${esc(p.userName)} · ${fdate(p.createdAt)}</figcaption>
        <button class="x pDel" data-id="${p.id}">✕</button></figure>`).join('') || '<p class="muted">Aucune photo cette semaine.</p>'}</div>` : ''}
    </div>

    <div class="sec"><button class="btn btn-danger btn-sm cDel">Supprimer la classe…</button></div>
  </div>`;
}

function bind() {
  $$('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
  $('#nSend').onclick = async () => {
    const body = $('#nBody').value.trim();
    if (!body) return toast('Écris un message');
    try { const r = await call('notify', { code: $('#nClass').value, title: $('#nTitle').value, body }); const n = Object.values(r).reduce((a, x) => a + x.sent, 0); toast(`Envoyée à ${n} appareil${n > 1 ? 's' : ''}`); $('#nBody').value = ''; }
    catch (_) { toast('Échec de l\'envoi'); }
  };
  $('#newBtn').onclick = async () => {
    const code = $('#newCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,12}$/.test(code)) return toast('Code : 3 à 12 lettres ou chiffres');
    try { await call('createClass', { code, name: $('#newName').value.trim() || code }); await load(); toast('Classe créée'); }
    catch (e) { toast(e.status === 409 ? 'Ce code existe déjà' : 'Impossible'); }
  };
  $$('.class-card').forEach((card) => {
    const code = card.dataset.code;
    const c = DATA.classes.find((x) => x.code === code);
    let mode = (c.schedule && c.schedule.mode) || 'random';
    $$('.sMode', card).forEach((b) => b.onclick = () => {
      mode = b.dataset.mode;
      $$('.sMode', card).forEach((x) => x.classList.toggle('on', x === b));
      $('.sRandom', card).classList.toggle('hidden', mode === 'fixed');
      $('.sFixed', card).classList.toggle('hidden', mode !== 'fixed');
    });
    $$('.sDay', card).forEach((b) => b.onclick = () => b.classList.toggle('on'));
    $('.sSave', card).onclick = async () => {
      const schedule = { enabled: $('.sEnabled', card).checked, mode, time: $('.sTime', card).value, from: $('.sFrom', card).value, to: $('.sTo', card).value,
        days: $$('.sDay.on', card).map((b) => b.dataset.d).join('') };
      if (mode !== 'fixed' && schedule.from >= schedule.to) return toast('La fin doit être après le début');
      if (!schedule.days) return toast('Choisis au moins un jour');
      const resetToday = c.today && c.today.done && confirm('Le BeRail d\'aujourd\'hui est déjà passé. En relancer un aujourd\'hui avec ces nouveaux horaires ?');
      try { await call('schedule', { code, schedule, resetToday }); await load(); toast('Horaires enregistrés'); } catch (_) { toast('Impossible'); }
    };
    $('.cFire', card).onclick = async () => {
      if (!confirm(`Lancer un BeRail maintenant pour ${c.name} ? Tout le monde reçoit une notification.`)) return;
      try { const r = await call('fire', { code }); await load(); toast(`⚡ Lancé · ${r.sent} notification${r.sent > 1 ? 's' : ''}`); } catch (_) { toast('Impossible'); }
    };
    const stop = $('.cStop', card); if (stop) stop.onclick = async () => { await call('clearMoment', { code }); await load(); toast('Moment arrêté'); };
    $('.cToggle', card).onclick = () => { openCls.has(code) ? openCls.delete(code) : openCls.add(code); localStorage.setItem('berail.adminOpen', JSON.stringify([...openCls])); render(); };
    $$('.mOwner', card).forEach((b) => b.onclick = async () => { await call('setOwner', { code, token: b.dataset.t }); await load(); toast('Nouvel organisateur'); });
    $$('.mDel', card).forEach((b) => b.onclick = async () => { if (!confirm(`Retirer ${b.dataset.n} de la classe ?`)) return; await call('deleteUser', { token: b.dataset.t }); await load(); toast('Membre retiré'); });
    $$('.pDel', card).forEach((b) => b.onclick = async () => { if (!confirm('Supprimer cette photo ?')) return; await call('deletePost', { code, id: b.dataset.id }); await load(); toast('Photo supprimée'); });
    $$('img[data-pid]', card).forEach(async (img) => {
      try { const r = await fetch(`${DB}/photos/${img.dataset.pid}.json`); const src = await r.json(); if (src) img.src = src; } catch (_) {}
      img.onclick = () => { $('#modal').innerHTML = `<div class="sheet" style="padding:0;overflow:hidden"><img src="${img.src}" style="width:100%;display:block"></div>`; $('#modal').classList.remove('hidden'); };
    });
    $('.cDel', card).onclick = async () => {
      const t = prompt(`Tout sera effacé (membres, photos, horaires). Tape ${code} pour confirmer :`);
      if ((t || '').trim().toUpperCase() !== code) return;
      await call('deleteClass', { code }); await load(); toast('Classe supprimée');
    };
  });
}
$('#modal').onclick = () => $('#modal').classList.add('hidden');

if (KEY) load().catch(() => { $('#key').value = ''; });
