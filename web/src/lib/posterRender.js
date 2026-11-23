// Drawing a news poster on a canvas. BROWSER ONLY (the poster editor).
//
// The template objects in lib/posterTemplates.js say what goes where; this
// draws them. One function, renderPoster, makes the live preview (1x, shown
// smaller with CSS), the template thumbnails, the saved-version thumbnail and
// the download (1x or 2x), so what is downloaded is exactly what was seen.
//
// Speed: the parts that only change when the photo or template changes - the
// gold background with the blurred photo, the logo, the card and its frame -
// are drawn once into layers and reused, so dragging the photo only redraws
// the photo and the text.
//
// Blur: canvas filters (ctx.filter = 'blur()') where the browser has them,
// otherwise a box blur by hand on a shrunken copy (Safari), which looks the
// same at these sizes.

import {
  POSTER_HEIGHT as H, POSTER_WIDTH as W, cropPlacement, formatSubtext, headlineWords, highlightMarks,
} from '@/lib/posterTemplates';

// ---- Images ----

const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i;

// A Cloudinary photo at a size fit for a 2x poster, in its own format (JPG or
// PNG as uploaded), so the canvas can be read back for the download.
export const posterImageUrl = (url) => {
  const m = String(url || '').match(CLOUDINARY_UPLOAD);
  return m ? `${m[1]}q_auto:good,w_2000,c_limit/${m[2]}` : url;
};

const images = new Map();

// { img, width, height, src, tainted }. Loaded with CORS so the poster can be
// downloaded; a picture from a site that does not allow that still shows,
// but marked `tainted` (the canvas could not be saved with it on).
export function loadPosterImage(src) {
  if (!src) return Promise.resolve(null);
  if (!images.has(src)) {
    const p = new Promise((resolve, reject) => {
      const attempt = (cors) => {
        const img = new Image();
        if (cors) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve({ img, width: img.naturalWidth, height: img.naturalHeight, src, tainted: !cors });
        img.onerror = () => (cors ? attempt(false) : reject(new Error('That photo could not be loaded.')));
        img.src = src;
      };
      attempt(true);
    });
    p.catch(() => images.delete(src));
    images.set(src, p);
  }
  return images.get(src);
}

// ---- Small canvas helpers ----

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

function roundRect(x, left, top, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  x.beginPath();
  x.moveTo(left + rr, top);
  x.lineTo(left + w - rr, top);
  x.arcTo(left + w, top, left + w, top + rr, rr);
  x.lineTo(left + w, top + h - rr);
  x.arcTo(left + w, top + h, left + w - rr, top + h, rr);
  x.lineTo(left + rr, top + h);
  x.arcTo(left, top + h, left, top + h - rr, rr);
  x.lineTo(left, top + rr);
  x.arcTo(left, top, left + rr, top, rr);
  x.closePath();
}

function linear(x, x0, y0, x1, y1, stops) {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  return g;
}

// The photo scaled to cover a w x h box (cropped, never stretched).
function drawCover(x, img, left, top, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  x.drawImage(img, left + (w - dw) / 2, top + (h - dh) / 2, dw, dh);
}

const rgbaOf = (color) => {
  const m = String(color).match(/rgba?\(([^)]+)\)/i);
  if (!m) return [0, 0, 0, 1];
  const [r, g, b, a = 1] = m[1].split(',').map((v) => Number(v.trim()));
  return [r, g, b, a];
};

// ---- Blur ----

let filterWorks = null;
function canvasFilterWorks() {
  if (filterWorks !== null) return filterWorks;
  try {
    const c = makeCanvas(9, 9);
    const x = c.getContext('2d');
    x.filter = 'blur(2px)';
    x.fillStyle = '#000';
    x.fillRect(4, 4, 1, 1);
    filterWorks = x.getImageData(2, 4, 1, 1).data[3] > 0;
  } catch {
    filterWorks = false;
  }
  return filterWorks;
}

// Three box blurs in a row come within a few percent of a Gaussian.
function boxSizes(sigma) {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower -= 1;
  const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map((i) => ((i < m ? lower : lower + 2) - 1) / 2);
}

function boxPass(src, dst, w, h, r, horizontal, channels) {
  const k = 1 / (2 * r + 1);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const at = horizontal ? (o, i) => (o * w + i) * 4 : (o, i) => (i * w + o) * 4;
  const clampI = (i) => (i < 0 ? 0 : i >= inner ? inner - 1 : i);
  for (let o = 0; o < outer; o += 1) {
    for (const c of channels) {
      let sum = 0;
      for (let i = -r; i <= r; i += 1) sum += src[at(o, clampI(i)) + c];
      for (let i = 0; i < inner; i += 1) {
        dst[at(o, i) + c] = sum * k;
        sum += src[at(o, clampI(i + r + 1)) + c] - src[at(o, clampI(i - r)) + c];
      }
    }
  }
}

// Blur ImageData pixels in place. `tint`: only the alpha is blurred and every
// pixel takes that colour (a shadow).
function blurPixels(data, w, h, sigma, tint) {
  const channels = tint ? [3] : [0, 1, 2, 3];
  let a = Float32Array.from(data);
  let b = new Float32Array(a.length);
  boxSizes(sigma).forEach((r) => {
    if (r < 1) return;
    boxPass(a, b, w, h, Math.round(r), true, channels);
    boxPass(b, a, w, h, Math.round(r), false, channels);
  });
  for (let i = 0; i < data.length; i += 4) {
    if (tint) { data[i] = tint[0]; data[i + 1] = tint[1]; data[i + 2] = tint[2]; data[i + 3] = a[i + 3]; } else {
      data[i] = a[i]; data[i + 1] = a[i + 1]; data[i + 2] = a[i + 2]; data[i + 3] = a[i + 3];
    }
  }
  a = null; b = null;
}

// A blurred copy of a canvas (same size). sigma in canvas pixels.
function blurCanvas(src, sigma, tint) {
  if (sigma < 0.4) return src;
  const out = makeCanvas(src.width, src.height);
  const ox = out.getContext('2d');
  if (canvasFilterWorks()) {
    ox.filter = `blur(${sigma}px)`;
    ox.drawImage(src, 0, 0);
    ox.filter = 'none';
    return out;
  }
  // By hand, on a copy a few times smaller: just as soft at this blur, and fast.
  const f = Math.max(1, sigma / 3);
  const small = makeCanvas(src.width / f, src.height / f);
  const sx = small.getContext('2d');
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(src, 0, 0, small.width, small.height);
  const pixels = sx.getImageData(0, 0, small.width, small.height);
  blurPixels(pixels.data, small.width, small.height, sigma / f, tint);
  sx.putImageData(pixels, 0, 0);
  ox.imageSmoothingEnabled = true;
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

// The photo covering a w x h box, blurred, with no faded edges (it is drawn
// past the box first, then cut back).
function blurredCover(img, w, h, sigma) {
  const m = Math.ceil(sigma * 3);
  const big = makeCanvas(w + 2 * m, h + 2 * m);
  drawCover(big.getContext('2d'), img, 0, 0, big.width, big.height);
  const soft = blurCanvas(big, sigma);
  const out = makeCanvas(w, h);
  out.getContext('2d').drawImage(soft, -m, -m);
  return out;
}

// ---- Cached layers ----

const layers = new Map();
const LAYER_LIMIT = 12;
function layer(key, make) {
  if (layers.has(key)) {
    const hit = layers.get(key);
    layers.delete(key);
    layers.set(key, hit);
    return hit;
  }
  const made = make();
  layers.set(key, made);
  while (layers.size > LAYER_LIMIT) layers.delete(layers.keys().next().value);
  return made;
}

// The logo with its two soft brown shadows.
function drawLogo(x, cfg, logo, s) {
  const w = cfg.width;
  const h = (w * logo.height) / logo.width;
  const left = W / 2 - w / 2;
  const top = cfg.band[0] + (cfg.band[1] - cfg.band[0] - h) / 2;
  cfg.shadows.forEach((sh) => {
    const [r, g, b, a] = rgbaOf(sh.color);
    const m = Math.ceil(sh.blur * s * 3) + 2;
    const sil = makeCanvas(w * s + 2 * m, h * s + 2 * m);
    const sx = sil.getContext('2d');
    sx.drawImage(logo.img, m, m, w * s, h * s);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = `rgb(${r},${g},${b})`;
    sx.fillRect(0, 0, sil.width, sil.height);
    const soft = blurCanvas(sil, sh.blur * s, [r, g, b]);
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = a;
    x.drawImage(soft, left * s - m, (top + sh.dy) * s - m);
    x.restore();
  });
  x.drawImage(logo.img, left, top, w, h);
}

// Background, glow, logo, the card and (portrait) the blurred card backdrop.
function drawBase(t, photo, logo, s) {
  const c = makeCanvas(W * s, H * s);
  const x = c.getContext('2d');
  x.setTransform(s, 0, 0, s, 0, 0);
  const bg = t.background;

  x.fillStyle = linear(x, 0, 0, 0, H, bg.gradient);
  x.fillRect(0, 0, W, H);

  if (photo) {
    const soft = blurredCover(photo.img, c.width, c.height, bg.photo.blur * s);
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = bg.photo.opacity;
    x.drawImage(soft, 0, 0);
    x.restore();
  }

  x.fillStyle = linear(x, 0, 0, 0, H, bg.overlay);
  x.fillRect(0, 0, W, H);

  const g = bg.glow;
  x.save();
  x.translate(g.cx, g.cy);
  x.scale(g.rx, g.ry);
  const glow = x.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, `rgba(255,255,255,${g.opacity})`);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = glow;
  x.fillRect(-g.cx / g.rx, -g.cy / g.ry, W / g.rx, H / g.ry);
  x.restore();

  if (logo) drawLogo(x, t.logo, logo, s);

  const cd = t.card;
  x.save();
  x.shadowColor = cd.shadow.color;
  x.shadowBlur = cd.shadow.blur * 2 * s;
  x.shadowOffsetY = cd.shadow.dy * s;
  x.fillStyle = cd.fill;
  roundRect(x, cd.x, cd.y, cd.w, cd.h, cd.r);
  x.fill();
  x.restore();

  const bd = t.photo.backdrop;
  if (bd && photo) {
    x.save();
    roundRect(x, cd.x, cd.y, cd.w, cd.h, cd.r);
    x.clip();
    const soft = blurredCover(photo.img, cd.w * s, cd.h * s, bd.blur * s);
    x.globalAlpha = bd.opacity;
    x.drawImage(soft, cd.x, cd.y, cd.w, cd.h);
    x.globalAlpha = 1;
    x.fillStyle = bd.tint;
    x.fillRect(cd.x, cd.y, cd.w, cd.h);
    x.restore();
  }
  return c;
}

// The gold frame round the card (its gradient runs corner to corner of the
// card, as in the SVG) and, for a portrait photo, the thin lines at its sides.
function drawFrame(t, s) {
  const c = makeCanvas(W * s, H * s);
  const x = c.getContext('2d');
  x.setTransform(s, 0, 0, s, 0, 0);
  const cd = t.card;
  const f = cd.frame;
  const half = f.width / 2;
  const box = { x: cd.x + half, y: cd.y + half, w: cd.w - f.width, h: cd.h - f.width };

  x.lineWidth = f.width;
  x.strokeStyle = '#fff';
  roundRect(x, box.x, box.y, box.w, box.h, Math.max(0, cd.r - half));
  x.stroke();
  x.globalCompositeOperation = 'source-in';
  x.save();
  x.translate(box.x, box.y);
  x.scale(box.w, box.h);
  x.fillStyle = linear(x, 0, 0, 1, 1, f.stops);
  x.fillRect(-0.1, -0.1, 1.2, 1.2);
  x.restore();

  const e = t.photo.edges;
  if (e) {
    const fr = t.photo.frame;
    x.globalCompositeOperation = 'destination-over';
    x.strokeStyle = e.color;
    x.lineWidth = e.width;
    x.beginPath();
    x.moveTo(fr.x, cd.y); x.lineTo(fr.x, cd.y + cd.h);
    x.moveTo(fr.x + fr.w, cd.y); x.lineTo(fr.x + fr.w, cd.y + cd.h);
    x.stroke();
  }
  x.globalCompositeOperation = 'source-over';
  return c;
}

// ---- Text ----

const fontOf = (fonts, f, size) => `${f.weight} ${size}px ${fonts?.[f.family] || 'sans-serif'}`;

const lineWidth = (w100, from, to, k, space) => {
  let w = 0;
  for (let i = from; i < to; i += 1) w += w100[i] * k;
  return w + space * (to - from - 1);
};

// The line breaks that make the longest line as short as possible.
function balancedLines(w100, space, k, count, maxWidth) {
  const n = w100.length;
  let best = null;
  let bestWidest = Infinity;
  const picked = [];
  const walk = (start, left) => {
    if (left === 1) {
      const lines = [...picked, [start, n]];
      const widest = Math.max(...lines.map(([a, b]) => lineWidth(w100, a, b, k, space)));
      if (widest <= maxWidth && widest < bestWidest - 0.01) { bestWidest = widest; best = lines; }
      return;
    }
    for (let end = start + 1; end <= n - (left - 1); end += 1) {
      picked.push([start, end]);
      walk(end, left - 1);
      picked.pop();
    }
  };
  walk(0, count);
  return best;
}

function greedyLines(w100, space, k, maxWidth) {
  const lines = [];
  let start = 0;
  for (let i = 1; i <= w100.length; i += 1) {
    if (i === w100.length || lineWidth(w100, start, i + 1, k, space) > maxWidth) {
      lines.push([start, i]);
      start = i;
    }
  }
  return lines;
}

// For one, two and three lines: the biggest size (68 down to 44) at which the
// headline fits with no line wider than 1000px, broken evenly. The fewest
// lines win unless that costs more than `fewerLines` of the size. Past all
// that: the smallest size in as many lines as needed, marked `overflow`.
function fitHeadline(w100, space100, cfg) {
  const [maxSize, minSize] = cfg.size;
  if (!w100.length) return { size: maxSize, lines: [], overflow: false };
  const widest = Math.max(...w100);
  const options = [];
  for (let count = 1; count <= Math.min(cfg.maxLines, w100.length); count += 1) {
    for (let size = maxSize; size >= minSize; size -= 1) {
      const k = size / 100;
      const lines = widest * k <= cfg.maxWidth ? balancedLines(w100, space100 * k, k, count, cfg.maxWidth) : null;
      if (lines) { options.push({ size, lines }); break; }
    }
  }
  if (options.length) {
    const biggest = Math.max(...options.map((o) => o.size));
    const pick = options.find((o) => o.size >= biggest * (cfg.fewerLines || 1));
    return { ...pick, overflow: false };
  }
  const k = minSize / 100;
  return { size: minSize, lines: greedyLines(w100, space100 * k, k, cfg.maxWidth), overflow: true };
}

// Every word measured once, in the real font, at 100px (widths scale with the
// size), and the fit worked out from those.
const headlineMemo = new Map();
function headlineLayout(x, t, words, fonts) {
  const key = `${fonts?.outfit}|${JSON.stringify([t.headline.size, t.headline.maxWidth, t.headline.maxLines, t.headline.fewerLines])}|${words.join(' ')}`;
  if (headlineMemo.has(key)) return headlineMemo.get(key);
  x.save();
  x.font = fontOf(fonts, t.headline.font, 100);
  const w100 = words.map((w) => x.measureText(w).width);
  const space100 = x.measureText(' ').width;
  const m = x.measureText('H');
  x.restore();
  const out = {
    ...fitHeadline(w100, space100, t.headline),
    w100,
    space100,
    cap: (m.actualBoundingBoxAscent || 70) / 100,
    ascent: (m.fontBoundingBoxAscent || 100) / 100,
    descent: (m.fontBoundingBoxDescent || 26) / 100,
  };
  if (headlineMemo.size > 200) headlineMemo.clear();
  headlineMemo.set(key, out);
  return out;
}

// Headline and subtext, centred together in the headline zone. Returns where
// each word is, so a click on the preview can toggle its highlight.
function drawHeadline(x, t, data, fonts, s, withSubtext) {
  const h = t.headline;
  const raw = headlineWords(data.headline);
  const words = raw.map((w) => w.toUpperCase());
  const marks = highlightMarks(raw, data.highlights);
  const L = headlineLayout(x, t, words, fonts);
  const size = L.size;
  const k = size / 100;
  const lh = size * h.lineHeight;
  const cap = L.cap * size;
  const sub = withSubtext ? formatSubtext(data.subtext) : '';
  const st = t.subtextStyle;

  let subSize = st.font.size;
  if (sub) {
    x.font = fontOf(fonts, st.font, subSize);
    const w = x.measureText(sub).width;
    if (w > st.maxWidth) subSize = Math.max(st.font.min, (subSize * st.maxWidth) / w);
  }
  const subCap = subSize * 0.7;

  const count = L.lines.length;
  const headH = count ? cap + (count - 1) * lh : 0;
  const total = headH + (sub ? (count ? st.gap : subCap) : 0);
  const center = (h.zone[0] + h.zone[1]) / 2;
  const firstBaseline = center - total / 2 + cap;

  const boxes = [];
  x.save();
  x.font = fontOf(fonts, h.font, size);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.shadowColor = h.shadow.color;
  x.shadowBlur = h.shadow.blur * 2 * s;
  x.shadowOffsetY = h.shadow.dy * s;
  L.lines.forEach(([from, to], j) => {
    const baseline = firstBaseline + j * lh;
    const space = L.space100 * k;
    let left = h.centerX - lineWidth(L.w100, from, to, k, space) / 2;
    const gold = linear(x, 0, baseline - L.ascent * size, 0, baseline + L.descent * size, h.gold);
    for (let i = from; i < to; i += 1) {
      const w = L.w100[i] * k;
      x.fillStyle = marks[i] ? gold : h.color;
      x.fillText(words[i], left, baseline);
      boxes.push({ i, x: left - space / 2, y: baseline - cap - lh * 0.18, w: w + space, h: lh });
      left += w + space;
    }
  });
  x.restore();

  if (sub) {
    const baseline = count ? firstBaseline + (count - 1) * lh + st.gap : center + subCap / 2;
    x.save();
    x.font = fontOf(fonts, st.font, subSize);
    x.textAlign = 'center';
    x.fillStyle = st.color;
    x.fillText(sub, h.centerX, baseline);
    x.restore();
  }
  return { words: boxes, size, lines: count, overflow: L.overflow };
}

function drawCredit(x, t, data, fonts) {
  if (!data.showCredit || !data.credit) return;
  const c = t.credit;
  let size = c.font.size;
  x.save();
  x.font = fontOf(fonts, c.font, size);
  const w = x.measureText(data.credit).width;
  if (w > c.maxWidth) { size = Math.max(c.font.min, (size * c.maxWidth) / w); x.font = fontOf(fonts, c.font, size); }
  x.textAlign = 'right';
  x.fillStyle = c.color;
  x.fillText(data.credit, c.right, c.baseline);
  x.restore();
}

function drawIcon(x, kind, cx, cy, ic) {
  x.beginPath();
  x.arc(cx, cy, ic.r, 0, Math.PI * 2);
  if (kind === 'globe') {
    x.moveTo(cx + 5, cy);
    x.ellipse(cx, cy, 5, ic.r, 0, 0, Math.PI * 2);
    x.moveTo(cx - ic.r, cy);
    x.lineTo(cx + ic.r, cy);
  } else {
    // The "f" of the Facebook mark, as drawn in the template.
    x.moveTo(cx + 2, cy + 11); x.lineTo(cx + 2, cy + 1); x.lineTo(cx + 5.5, cy + 1);
    x.moveTo(cx - 2.5, cy + 1); x.lineTo(cx + 5.5, cy + 1);
    x.moveTo(cx + 2, cy + 1); x.lineTo(cx + 2, cy - 2.5);
    x.bezierCurveTo(cx + 2, cy - 5, cx + 3.5, cy - 6, cx + 6, cy - 6);
  }
  x.stroke();
}

function drawFooter(x, t, data, fonts) {
  const f = t.footer;
  const items = [
    data.website ? { kind: 'globe', text: data.website } : null,
    data.facebook ? { kind: 'facebook', text: data.facebook } : null,
  ].filter(Boolean);
  if (!items.length) return;
  x.save();
  x.font = fontOf(fonts, f.font, f.font.size);
  const lead = f.icon.r + f.icon.textOffset;
  items.forEach((it) => { it.w = x.measureText(it.text).width; });
  const total = items.reduce((n, it) => n + lead + it.w, 0) + f.gap * (items.length - 1);
  let left = f.centerX - total / 2;
  x.fillStyle = f.color;
  x.strokeStyle = f.color;
  x.lineWidth = f.icon.stroke;
  x.lineCap = 'round';
  items.forEach((it) => {
    const cx = left + f.icon.r;
    drawIcon(x, it.kind, cx, f.baseline - 7, f.icon);
    x.fillText(it.text, cx + f.icon.textOffset, f.baseline);
    left += lead + it.w + f.gap;
  });
  x.restore();
}

function drawPhoto(x, t, data, photo, fonts, placeholder) {
  const fr = t.photo.frame;
  if (!photo) {
    if (!placeholder) return;
    x.save();
    x.fillStyle = 'rgba(110,69,16,0.55)';
    x.font = fontOf(fonts, { family: 'poppins', weight: 600 }, 30);
    x.textAlign = 'center';
    x.fillText('Choose a photo', fr.x + fr.w / 2, fr.y + fr.h / 2);
    x.restore();
    return;
  }
  const p = cropPlacement(photo.width, photo.height, fr, data.crop);
  x.save();
  roundRect(x, fr.x, fr.y, fr.w, fr.h, fr.r);
  x.clip();
  x.imageSmoothingQuality = 'high';
  x.drawImage(photo.img, p.dx, p.dy, p.dw, p.dh);
  x.restore();
}

// ---- The poster ----
//
// assets: { fonts: { outfit, poppins } (CSS font-family lists, loaded),
//           logo, photo } (from loadPosterImage)
// Returns { words, size, lines, overflow, frame }.
export function renderPoster(canvas, { template: t, data, scale = 1, assets = {}, placeholder = false, cache = true }) {
  const s = scale;
  const w = Math.round(W * s);
  const h = Math.round(H * s);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const x = canvas.getContext('2d');
  const { photo = null, logo = null, fonts } = assets;

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  const base = cache
    ? layer(`base|${t.key}|${s}|${photo?.src || '-'}|${logo ? 1 : 0}`, () => drawBase(t, photo, logo, s))
    : drawBase(t, photo, logo, s);
  x.drawImage(base, 0, 0);

  x.setTransform(s, 0, 0, s, 0, 0);
  drawPhoto(x, t, data, photo, fonts, placeholder);

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(cache ? layer(`frame|${t.key}|${s}`, () => drawFrame(t, s)) : drawFrame(t, s), 0, 0);

  x.setTransform(s, 0, 0, s, 0, 0);
  drawCredit(x, t, data, fonts);
  const text = drawHeadline(x, t, data, fonts, s, t.subtext);
  drawFooter(x, t, data, fonts);
  x.setTransform(1, 0, 0, 1, 0, 0);
  return { ...text, frame: t.photo.frame };
}

// A canvas made into a file. Fails (SecurityError) if a photo without CORS
// is on it.
export const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The poster could not be made into a file.'))), type, quality);
  } catch (err) {
    reject(err);
  }
});
