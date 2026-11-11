'use strict';
/* BeRail — photo mystère, photo retournable, stickers et texte. */

/* ---------- Photo mystère ---------- */
function isLocked(p) {
  if (!p || p.mine || !S.user) return false;
  const today = window.BerailDayKey(new Date());
  if (window.BerailDayKey(new Date(p.createdAt)) !== today) return false;
  return !S.posts.some((x) => x.mine && window.BerailDayKey(new Date(x.createdAt)) === today);
}

/* ---------- Retourner la photo ---------- */
async function flipPost(media) {
  const id = media.dataset.flip, img = media.querySelector('img');
  if (!img || media.dataset.busy) return;
  media.dataset.busy = '1';
  const toBack = media.classList.contains('flipped');
  try {
    const src = await window.BerailPhoto(toBack ? id : id + 'f');
    if (!src) throw new Error('no_photo');
    media.classList.add('flipping');
    await new Promise((r) => setTimeout(r, 160));
    img.src = src;
    media.classList.toggle('flipped', !toBack);
    media.setAttribute('aria-pressed', String(!toBack));
    media.classList.remove('flipping');
  } catch (_) { toast('Autre photo indisponible'); }
  delete media.dataset.busy;
}

/* ---------- Stickers et texte ---------- */
const STK_EMOJIS = ['😂', '🔥', '😍', '💀', '🎉', '⭐', '👀', '💯', '📚', '☕', '😴', '❤️', '👍', '🤯', '🍕', '⚽'];
const STK_COLORS = ['#ffffff', '#111111', '#ffd60a', '#ff4f8b', '#5b4bff', '#22c3b5', '#ff7a1a'];
const stk = { items: [], sel: null, color: '#ffffff' };

function stkLayout() {
  const img = $('#reviewImg'), layer = $('#stkLayer'), stage = $('#reviewStage');
  if (!img.naturalWidth || !stage) return;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const r = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  const w = img.naturalWidth * r, h = img.naturalHeight * r;
  Object.assign(layer.style, { width: w + 'px', height: h + 'px', left: (sw - w) / 2 + 'px', top: (sh - h) / 2 + 'px' });
  stkRender();
}
function stkRender() {
  const layer = $('#stkLayer'), W = layer.clientWidth || 1;
  layer.innerHTML = stk.items.map((it, i) => `<div class="stk ${it.type} ${stk.sel === i ? 'sel' : ''}" data-i="${i}"
    style="left:${it.x * 100}%;top:${it.y * 100}%;font-size:${it.size * W}px;${it.type === 'text' ? `color:${it.color}` : ''}">${esc(it.text)}</div>`).join('');
  $('#stkSel').classList.toggle('hidden', stk.sel == null);
  $('#stkEmojis').classList.toggle('hidden', stk.sel != null);
}
function resetStickers() {
  stk.items = []; stk.sel = null;
  $('#stkTextRow').classList.add('hidden');
  const img = $('#reviewImg');
  img.onload = stkLayout;
  stkRender();
  requestAnimationFrame(() => setTimeout(stkLayout, 30));
}
function stkClamp() {
  const layer = $('#stkLayer'), W = layer.clientWidth, H = layer.clientHeight; if (!W) return;
  layer.querySelectorAll('.stk').forEach((el) => {
    const it = stk.items[+el.dataset.i]; if (!it) return;
    const hx = Math.min(.5, el.offsetWidth / 2 / W), hy = Math.min(.5, el.offsetHeight / 2 / H);
    it.x = Math.max(hx, Math.min(1 - hx, it.x)); it.y = Math.max(hy, Math.min(1 - hy, it.y));
    el.style.left = it.x * 100 + '%'; el.style.top = it.y * 100 + '%';
  });
}
function stkAdd(it) { stk.items.push(Object.assign({ x: .5, y: .5 }, it)); stk.sel = stk.items.length - 1; stkRender(); }

function bakeStickers(canvas) {
  if (!stk.items.length) return canvas;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const it of stk.items) {
    const fs = it.size * W;
    g.save();
    g.font = `${it.type === 'text' ? 800 : 400} ${fs}px -apple-system, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    if (it.type === 'text') {
      g.shadowColor = it.color === '#111111' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.6)';
      g.shadowBlur = fs * .18; g.fillStyle = it.color;
    }
    g.fillText(it.text, it.x * W, it.y * H);
    g.restore();
  }
  return canvas;
}

(function initStickers() {
  const layer = $('#stkLayer');
  if (!layer) return;
  $('#stkEmojis').innerHTML = STK_EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  $('#stkColors').innerHTML = STK_COLORS.map((c) => `<button data-c="${c}" style="background:${c}" class="${c === stk.color ? 'on' : ''}"></button>`).join('');
  $('#stkEmojis').onclick = (e) => { const b = e.target.closest('[data-e]'); if (b) stkAdd({ type: 'emoji', text: b.dataset.e, size: .16 }); };
  $('#stkText').onclick = () => { stk.sel = null; stkRender(); $('#stkTextRow').classList.toggle('hidden'); $('#stkTextIn').focus(); };
  $('#stkColors').onclick = (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    stk.color = b.dataset.c;
    $$('#stkColors button').forEach((x) => x.classList.toggle('on', x === b));
  };
  const addText = () => {
    const t = $('#stkTextIn').value.trim();
    if (t) stkAdd({ type: 'text', text: t, size: .075, color: stk.color });
    $('#stkTextIn').value = ''; $('#stkTextRow').classList.add('hidden');
  };
  $('#stkTextOk').onclick = addText;
  $('#stkTextIn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addText(); } };
  const resize = (f) => { if (stk.sel == null) return; const it = stk.items[stk.sel]; it.size = Math.max(.03, Math.min(.5, it.size * f)); stkRender(); stkClamp(); };
  $('#stkBigger').onclick = () => resize(1.2);
  $('#stkSmaller').onclick = () => resize(1 / 1.2);
  $('#stkDel').onclick = () => { if (stk.sel == null) return; stk.items.splice(stk.sel, 1); stk.sel = null; stkRender(); };

  let drag = null;
  layer.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.stk');
    if (!el) { stk.sel = null; stkRender(); return; }
    e.preventDefault();
    stk.sel = +el.dataset.i; stkRender();
    const r = layer.getBoundingClientRect(), it = stk.items[stk.sel];
    drag = { id: e.pointerId, dx: e.clientX - (r.left + it.x * r.width), dy: e.clientY - (r.top + it.y * r.height) };
    layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || stk.sel == null) return;
    const r = layer.getBoundingClientRect(), it = stk.items[stk.sel];
    const el = layer.querySelector(`.stk[data-i="${stk.sel}"]`);
    const hx = el ? Math.min(.5, el.offsetWidth / 2 / r.width) : 0, hy = el ? Math.min(.5, el.offsetHeight / 2 / r.height) : 0;
    it.x = Math.max(hx, Math.min(1 - hx, (e.clientX - drag.dx - r.left) / r.width));
    it.y = Math.max(hy, Math.min(1 - hy, (e.clientY - drag.dy - r.top) / r.height));
    if (el) { el.style.left = it.x * 100 + '%'; el.style.top = it.y * 100 + '%'; }
  });
  const end = () => { drag = null; };
  layer.addEventListener('pointerup', end); layer.addEventListener('pointercancel', end);
  window.addEventListener('resize', stkLayout);
})();
