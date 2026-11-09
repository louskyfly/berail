'use strict';
/* Génère quelques BeRail de démo dans la classe DEMO (visuel de départ) */
const zlib = require('zlib');

const W = 900, H = 1200;

/* --- encodeur PNG minimal --- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
const mix = (a, b, t) => a + (b - a) * t;

function photo(backA, backB, frontA, frontB) {
  const fx = 52, fy = 52, fw = 300, fh = 390, bw = 9;
  return encodePNG(W, H, (x, y) => {
    const insideFront = x >= fx && x < fx + fw && y >= fy && y < fy + fh;
    let r, g, b;
    if (insideFront) {
      const t = (x - fx) / fw * 0.45 + (y - fy) / fh * 0.55;
      r = mix(frontA[0], frontB[0], t); g = mix(frontA[1], frontB[1], t); b = mix(frontA[2], frontB[2], t);
      const nearBorder = x < fx + bw || x >= fx + fw - bw || y < fy + bw || y >= fy + fh - bw;
      if (nearBorder) { r = g = b = 255; }
    } else if (x >= fx - bw && x < fx + fw + bw && y >= fy - bw && y < fy + fh + bw) {
      r = g = b = 255;
    } else {
      const t = (x / W) * 0.5 + (y / H) * 0.5;
      r = mix(backA[0], backB[0], t); g = mix(backA[1], backB[1], t); b = mix(backA[2], backB[2], t);
      // léger vignettage
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
      const v = Math.max(0, 1 - 0.35 * (dx * dx + dy * dy));
      r *= v; g *= v; b *= v;
    }
    return [r | 0, g | 0, b | 0];
  }).toString('base64');
}

const shots = [
  {
    name: 'Léa', caption: 'La cour sous la pluie ☔️',
    late: false, minutesAgo: 3,
    img: photo([245, 150, 70], [120, 55, 40], [255, 214, 190], [196, 130, 100])
  },
  {
    name: 'Noah', caption: 'Fin du contrôle de maths 🫠',
    late: true, minutesAgo: 26,
    img: photo([60, 120, 190], [20, 45, 90], [240, 200, 180], [170, 120, 110])
  },
  {
    name: 'Inès', caption: '', late: false, minutesAgo: 7,
    img: photo([110, 90, 200], [35, 30, 80], [250, 210, 195], [185, 140, 130])
  }
];

(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:3000';
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; });

  const owner = await post('/api/join', { name: 'Moi', code: 'DEMO', create: true });
  await post('/api/moment', { token: owner.token });
  await new Promise(r => setTimeout(r, 100));

  for (const s of shots) {
    const u = await post('/api/join', { name: s.name, code: 'DEMO', create: true });
    const r = await post('/api/post', { token: u.token, photo: 'data:image/png;base64,' + s.img, caption: s.caption });
    console.log(`${s.name} → code ${r.post.shareCode}`);
  }
  console.log('Classe DEMO prête.');
})().catch((e) => { console.error(e); process.exit(1); });
