'use strict';
/* BeRail — séries 🔥, badges et récap de la semaine.
   S'appuie sur S.stats (stats/{classe}/{userId}.days) et S.momentDays. */

function momentDayList() {
  const today = S.today || todayKey();
  return Object.keys(S.momentDays || {}).filter((d) => d <= today).sort();
}
function daysOf(userId) { const s = (S.stats || {})[userId]; return (s && s.days) || {}; }

/* Série en cours : jours de BeRail consécutifs (aujourd'hui ne casse pas la série tant qu'il reste du temps). */
function streakOf(userId) {
  const days = daysOf(userId), list = momentDayList(), today = S.today || todayKey();
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (days[list[i]]) n++;
    else if (list[i] === today) continue;
    else break;
  }
  return n;
}
function bestStreakOf(userId) {
  const days = daysOf(userId);
  let best = 0, cur = 0;
  for (const d of momentDayList()) { if (days[d]) { cur++; best = Math.max(best, cur); } else cur = 0; }
  return best;
}
function countOf(userId, pred) { return Object.values(daysOf(userId)).filter(pred).length; }

function weekStar() {
  const by = {};
  for (const p of S.posts) {
    by[p.userId] = by[p.userId] || { id: p.userId, name: p.userName, n: 0 };
    by[p.userId].n += p.reactionTotal || 0;
  }
  const top = Object.values(by).sort((a, b) => b.n - a.n)[0];
  return top && top.n >= 3 ? top : null;
}

function badgesOf(userId) {
  const best = bestStreakOf(userId);
  const firsts = countOf(userId, (v) => v === 'first');
  const onTime = countOf(userId, (v) => v === 'first' || v === 'ok');
  const total = Object.keys(daysOf(userId)).length;
  const star = weekStar();
  return [
    { icon: '🔥', name: 'En feu', desc: '3 jours de suite', got: best >= 3, prog: `${Math.min(best, 3)}/3` },
    { icon: '☄️', name: 'Inarrêtable', desc: '7 jours de suite', got: best >= 7, prog: `${Math.min(best, 7)}/7` },
    { icon: '🏆', name: 'Légende', desc: '30 jours de suite', got: best >= 30, prog: `${Math.min(best, 30)}/30` },
    { icon: '🥇', name: 'Premier', desc: 'Premier à poster', got: firsts >= 1, prog: firsts > 1 ? `×${firsts}` : '0/1' },
    { icon: '⏱️', name: 'Ponctuel', desc: '5 BeRail à l\'heure', got: onTime >= 5, prog: `${Math.min(onTime, 5)}/5` },
    { icon: '📸', name: 'Fidèle', desc: '20 BeRail', got: total >= 20, prog: `${Math.min(total, 20)}/20` },
    { icon: '⭐', name: 'Star de la semaine', desc: 'Le plus de réactions', got: !!(star && star.id === userId), prog: 'Le plus de réactions' },
  ];
}

function streakChip(userId) {
  const n = streakOf(userId);
  return n >= 2 ? `<span class="streak" title="${n} jours de suite">🔥${n}</span>` : '';
}

function badgesPanel() {
  const b = badgesOf(S.user.id);
  const got = b.filter((x) => x.got).length;
  return `<div class="panel">
    <h3>Badges</h3>
    <p>${got ? `${got} badge${got > 1 ? 's' : ''} sur ${b.length}` : 'Poste à l\'heure pour débloquer tes premiers badges.'}</p>
    <div class="badges">${b.map((x) => `<div class="badge ${x.got ? 'got' : ''}">
      <span class="b-icon">${x.icon}</span><b>${x.name}</b><small>${x.got ? x.desc : x.prog}</small></div>`).join('')}</div>
  </div>`;
}

/* ---------- Récap de la semaine ---------- */
function isRecapDay() { const d = new Date().getDay(); return d === 5 || d === 6 || d === 0; }
function recapCard() {
  if (!S.posts.length) return '';
  const fri = isRecapDay();
  return `<button class="recap-card" id="openRecap"><span class="recap-play">▶</span>
    <span><b>${fri ? 'Le récap de la semaine est prêt' : 'Récap de la semaine'}</b>
    <small>${S.posts.length} BeRail · à revoir avant qu'ils s'effacent</small></span></button>`;
}

function recapStats() {
  const people = {};
  for (const p of S.posts) people[p.userId] = p.userName;
  const ids = Object.keys(people);
  const streaks = ids.map((id) => ({ id, name: people[id], n: streakOf(id) })).sort((a, b) => b.n - a.n);
  const firsts = ids.map((id) => ({ name: people[id], n: S.posts.filter((p) => p.userId === id).length && countOf(id, (v) => v === 'first') })).sort((a, b) => b.n - a.n);
  const ontime = S.posts.filter((p) => !p.late).length;
  return { total: S.posts.length, people: ids.length, star: weekStar(), topStreak: streaks[0], topFirst: firsts[0], ontime };
}

let recapTimer = null;
function openRecap() {
  const posts = [...S.posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!posts.length) return;
  const st = recapStats();
  const slides = posts.map((p) => `<div class="rc-slide">${imgTag(p, 'BeRail de ' + p.userName, 'rc-img')}
      <div class="rc-cap"><div class="rc-who">${avatarHTML(p.userName, p.userId, 'sm')}<b>${esc(p.userName)}</b>${streakChip(p.userId)}<span>${esc(dayLabel(p.createdAt))} · ${hhmm(p.createdAt)}</span></div>
      ${p.caption ? `<p>${esc(p.caption)}</p>` : ''}</div></div>`);
  slides.push(`<div class="rc-slide rc-end"><div class="rc-endin">
      <p class="rc-kicker">La semaine de la ${esc(S.klass.code)}</p>
      <div class="rc-big">${st.total}<small>BeRail</small></div>
      <ul>
        <li><span>👥</span>${st.people} participant${st.people > 1 ? 's' : ''}</li>
        <li><span>⏱️</span>${st.ontime} à l'heure</li>
        ${st.star ? `<li><span>⭐</span>Star : <b>${esc(st.star.name)}</b> (${st.star.n} réactions)</li>` : ''}
        ${st.topStreak && st.topStreak.n >= 2 ? `<li><span>🔥</span>Plus longue série : <b>${esc(st.topStreak.name)}</b> (${st.topStreak.n} j)</li>` : ''}
        ${st.topFirst && st.topFirst.n ? `<li><span>🥇</span>Le plus rapide : <b>${esc(st.topFirst.name)}</b></li>` : ''}
      </ul>
      <button class="btn btn-primary" id="rcCollage">${ICON.dl} Télécharger le collage</button>
      <button class="btn btn-ghost" id="rcAgain">Revoir</button>
    </div></div>`);
  openModal(`<div class="recap" id="recap">
    <div class="rc-bars">${slides.map(() => '<i><b></b></i>').join('')}</div>
    <button class="rc-close" data-close aria-label="Fermer">✕</button>
    <div class="rc-stage">${slides.join('')}</div>
    <button class="rc-nav rc-prev" aria-label="Précédent"></button><button class="rc-nav rc-next" aria-label="Suivant"></button>
  </div>`);
  $('#modal').classList.add('modal-full');
  const close = () => { clearTimeout(recapTimer); $('#modal').classList.remove('modal-full'); closeModal(); };
  $('#recap [data-close]').onclick = close;
  $('#modal').onclick = null;
  let i = 0;
  const els = $$('#recap .rc-slide'), bars = $$('#recap .rc-bars i');
  const show = (n) => {
    clearTimeout(recapTimer);
    i = Math.max(0, Math.min(els.length - 1, n));
    els.forEach((e, k) => e.classList.toggle('on', k === i));
    $('#recap').classList.toggle('at-end', i === els.length - 1);
    bars.forEach((b, k) => { b.className = k < i ? 'done' : (k === i ? 'run' : ''); });
    if (i < els.length - 1) recapTimer = setTimeout(() => show(i + 1), 3500);
  };
  $('#recap .rc-next').onclick = () => show(i + 1);
  $('#recap .rc-prev').onclick = () => show(i - 1);
  $('#rcAgain').onclick = () => show(0);
  $('#rcCollage').onclick = () => downloadCollage(posts, st);
  show(0);
}

async function downloadCollage(posts, st) {
  try {
    toast('Préparation du collage…');
    const list = posts.slice(-12);
    const srcs = await Promise.all(list.map((p) => p.photo || window.BerailPhoto(p.id)));
    const imgs = await Promise.all(srcs.map((s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = s || BLANK; })));
    const cols = list.length <= 4 ? 2 : 3, rows = Math.ceil(list.length / cols);
    const W = 1080, gap = 12, pad = 48, cw = (W - pad * 2 - gap * (cols - 1)) / cols, ch = cw * 4 / 3, head = 170;
    const H = head + rows * ch + (rows - 1) * gap + pad + 40;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--bg').trim() || '#121417', fg = css.getPropertyValue('--fg').trim() || '#fff';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.font = '900 64px Helvetica, Arial, sans-serif'; g.fillText('BeRail · ' + S.klass.code, pad, 100);
    g.globalAlpha = .65; g.font = '600 30px Helvetica, Arial, sans-serif';
    g.fillText(`La semaine · ${st.total} BeRail · ${st.people} participant${st.people > 1 ? 's' : ''}`, pad, 145); g.globalAlpha = 1;
    imgs.forEach((im, k) => {
      const x = pad + (k % cols) * (cw + gap), y = head + Math.floor(k / cols) * (ch + gap);
      g.save(); g.beginPath(); g.roundRect ? g.roundRect(x, y, cw, ch, 18) : g.rect(x, y, cw, ch); g.clip();
      if (im) { const r = Math.max(cw / im.width, ch / im.height), w = im.width * r, h = im.height * r; g.drawImage(im, x + (cw - w) / 2, y + (ch - h) / 2, w, h); }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, y + ch - 56, cw, 56);
      g.fillStyle = '#fff'; g.font = '700 26px Helvetica, Arial, sans-serif'; g.fillText(list[k].userName, x + 16, y + ch - 20);
      g.restore();
    });
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .9));
    const file = new File([blob], `BeRail-recap-${S.klass.code}-${todayKey()}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Récap BeRail' }); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Collage téléchargé');
  } catch (e) { if (!e || e.name !== 'AbortError') toast('Collage impossible'); }
}
