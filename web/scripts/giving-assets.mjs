// The giving pictures, made web-sized: the jar and the hearts that drop into
// it on /giving (components/giving/GivingJar). Reads the originals in
// public/giving-assets and writes small WebP files to public/giving-assets/web.
//
//   node scripts/giving-assets.mjs
//
// The five-colour sheet is cut into one heart per file: each heart is found by
// its own outline (the see-through pixels around it), so no corner of the
// heart beside it comes along.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.resolve('public/giving-assets');
const out = path.join(dir, 'web');
mkdirSync(out, { recursive: true });

const webp = (img, name, width) => img
  .resize({ width, withoutEnlargement: true })
  .webp({ quality: 82, alphaQuality: 88, effort: 6 })
  .toFile(path.join(out, name));

// The jar: shown up to ~320px wide, so 640 covers a sharp phone screen.
await webp(sharp(path.join(dir, 'Luxurious Blue Ribbon Glass Jar.png')).trim(), 'jar.webp', 640);

// The big blue heart.
await webp(sharp(path.join(dir, 'Glossy Blue Glass Heart.png')).trim(), 'heart-blue.webp', 200);

// ---- The sheet ----
const sheet = path.join(dir, 'Glossy Glass Heart Sticker Collection.png');
const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const solid = (i) => data[i * 4 + 3] > 24;

// Label each separate shape (4-connected), keeping the five largest.
const label = new Int32Array(W * H);
const shapes = [];
const stack = new Int32Array(W * H);
for (let start = 0; start < W * H; start += 1) {
  if (label[start] || !solid(start)) continue;
  const id = shapes.length + 1;
  let top = 0;
  stack[top++] = start;
  label[start] = id;
  let n = 0; let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
  while (top) {
    const p = stack[--top];
    const x = p % W; const y = (p / W) | 0;
    n += 1;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (q >= 0 && !label[q] && solid(q)) { label[q] = id; stack[top++] = q; }
    }
  }
  shapes.push({ id, n, x0, y0, x1, y1 });
}
const hearts = shapes.sort((a, b) => b.n - a.n).slice(0, 5)
  // Top row left to right, then the bottom row.
  .sort((a, b) => (Math.abs(a.y0 - b.y0) > 150 ? a.y0 - b.y0 : a.x0 - b.x0));
const NAMES = ['sapphire', 'gold', 'red', 'purple', 'sky'];

// The soft glow at a heart's edge is below the threshold; a few pixels of
// margin, and any pixel nearer this heart than another one, keep it.
const PAD = 6;
for (const [i, h] of hearts.entries()) {
  const left = Math.max(0, h.x0 - PAD); const top = Math.max(0, h.y0 - PAD);
  const w = Math.min(W, h.x1 + PAD + 1) - left; const hh = Math.min(H, h.y1 + PAD + 1) - top;
  const px = Buffer.alloc(w * hh * 4);
  for (let y = 0; y < hh; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = (top + y) * W + (left + x);
      const own = label[src] === h.id || (label[src] === 0 && nearest(src, h.id));
      const o = (y * w + x) * 4;
      data.copy(px, o, src * 4, src * 4 + 4);
      if (!own) px[o + 3] = 0;
    }
  }
  await webp(sharp(px, { raw: { width: w, height: hh, channels: 4 } }), `heart-${NAMES[i]}.webp`, 200);
}

// A faint pixel between shapes belongs to the closest one within a few pixels.
function nearest(p, id) {
  const x = p % W; const y = (p / W) | 0;
  for (let r = 1; r <= PAD; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const l = label[yy * W + xx];
        if (l) return l === id;
      }
    }
  }
  return false;
}

console.log('Giving pictures written to', out);
