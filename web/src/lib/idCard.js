// Attendee ID cards - drawn on a canvas so the preview and the downloaded file
// are the same pixels.
//
// The card is 250 x 353, the size of the two template images in
// public/id_template. Everything below is in those units; `scale` only
// multiplies the output resolution.
//
// Front: last name over first name, Montserrat, all capitals, 23px, centred
// in the white panel. Weights are LAST_WEIGHT / FIRST_WEIGHT below. Two layouts, taken from the design:
//   Template 1 - both names fit on one line each
//   Template 2 - a name needs a second line; the lines move apart to fit it
// A name is never cut and never ends in "...": when it does not fit at 23px it
// wraps, and only when wrapping is not enough does the type get smaller.
//
// Back: the attendee's check-in QR, with rounded modules, filling the rounded box,
// optionally with the logo in its middle.

import { attendeePageUrl } from '@/lib/eventPublic';

export const ID_W = 250;
export const ID_H = 353;
export const ID_FRONT_SRC = '/id_template/Front_ID_Template.png';

// The template images themselves are 1416 x 2000 - the 250 x 353 card at
// 5.664x. Drawing at this scale uses every pixel of the template, with the
// names in Montserrat drawn at the same resolution: the original quality.
export const ID_TEMPLATE_W = 1416;
export const ID_ORIGINAL_SCALE = ID_TEMPLATE_W / ID_W;
export const ID_BACK_SRC = '/id_template/Back_ID_Template.png';

const FONT = 'Montserrat';
// Font weights from the Figma design (100-900).
const LAST_WEIGHT = 700;
const FIRST_WEIGHT = 400;
const TEXT_LEFT = 0.176 * ID_W;          // left: 17.6%
const TEXT_WIDTH = ID_W - 2 * TEXT_LEFT; // right: 17.6%  -> 162px
const BASE_SIZE = 23;
const MIN_SIZE = 11;

// Vertical centres of the name boxes, from the design's top/bottom percentages.
const LAYOUTS = {
  1: {
    last: { center: ((0.4986 + (1 - 0.4023)) / 2) * ID_H, lineHeight: 0.98 },
    first: { center: ((0.5581 + (1 - 0.3428)) / 2) * ID_H, lineHeight: 0.98 },
  },
  2: {
    last: { center: ((0.4759 + (1 - 0.4249)) / 2) * ID_H, lineHeight: 0.98 },
    first: { center: ((0.5666 + (1 - 0.3343)) / 2) * ID_H, lineHeight: 0.91 },
  },
};

// QR box on the back: the template's own white box, 182 x 176 at (34, 88) -
// nothing drawn outside it, so the card looks exactly as designed.
const QR_BOX = { x: 34.1, y: 88.3, w: 181.6, h: 176.3, r: 28 };
// White kept around the QR inside the box, for scanners. 9 on each side
// makes the QR about 158 - a little bigger than the original 142.
const QR_MARGIN = 9;
// Logo in the middle of the QR. With it on, the QR uses the highest error
// correction (H - 30% of the code can be lost) and only the modules under the
// logo are left out: a third of the width, ~12% of the area - well under
// the 30% H can recover, so it still scans with plenty to spare.
export const ID_QR_LOGO_SRC = '/assets/LOGO.png';
const QR_LOGO_SHARE = 0.33;

let fontsReady = null;
/** Montserrat in the card's weights, loaded once, before anything is drawn with it. */
export function loadIdFonts() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (fontsReady) return fontsReady;
  const weights = [...new Set([LAST_WEIGHT, FIRST_WEIGHT])].sort((a, b) => a - b);
  // The stylesheet has to be in before document.fonts.load() - until then the
  // browser has no @font-face for Montserrat and the canvas falls back silently.
  const sheet = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=Montserrat:wght@${weights.join(';')}&display=block`;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  fontsReady = sheet
    .then(() => Promise.all(weights.map((w) => document.fonts.load(`${w} ${BASE_SIZE}px ${FONT}`))))
    .then(() => document.fonts.ready)
    .catch(() => undefined);
  return fontsReady;
}

const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(src); reject(new Error(`Could not load ${src}`)); };
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

// Greedy word wrap. Returns null if a single word is wider than the box.
function wrap(ctx, text, maxWidth) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (ctx.measureText(word).width > maxWidth) return null;
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// The largest size (from 23px down) at which the text fits in `maxLines`
// lines, never smaller than `floor`. null if it does not fit at all.
function fitText(ctx, text, weight, maxLines, floor = MIN_SIZE) {
  for (let size = BASE_SIZE; size >= floor; size -= 0.5) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, text, TEXT_WIDTH);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  return null;
}

// One line if it fits at a comfortable size; otherwise two lines, shrinking
// only as far as needed. Last resort: very small, as many lines as it takes -
// still whole, never cut.
function fitName(ctx, text, weight) {
  return fitText(ctx, text, weight, 1, 18)
    || fitText(ctx, text, weight, 2)
    || fitText(ctx, text, weight, 4, 6)
    || { size: MIN_SIZE, lines: [String(text || '')] };
}

/** How the front will be laid out - which template, and each name's lines. */
export function layoutIdNames(ctx, { lastName, firstName }) {
  const last = fitName(ctx, String(lastName || '').toUpperCase(), LAST_WEIGHT);
  const first = fitName(ctx, String(firstName || '').toUpperCase(), FIRST_WEIGHT);
  const template = last.lines.length === 1 && first.lines.length === 1 ? 1 : 2;
  return { template, last, first };
}

function drawLines(ctx, fit, weight, center, lineHeight) {
  ctx.font = `${weight} ${fit.size}px ${FONT}`;
  const lh = fit.size * lineHeight;
  const top = center - ((fit.lines.length - 1) * lh) / 2;
  fit.lines.forEach((line, i) => ctx.fillText(line, ID_W / 2, top + i * lh));
}

function prepare(canvas, scale) {
  canvas.width = Math.round(ID_W * scale);
  canvas.height = Math.round(ID_H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Draws the front onto `canvas`. Resolves with the layout it used. */
export async function drawIdFront(canvas, { lastName, firstName }, scale = 1) {
  await loadIdFonts();
  const bg = await loadImage(ID_FRONT_SRC);
  const ctx = prepare(canvas, scale);
  ctx.drawImage(bg, 0, 0, ID_W, ID_H);

  const layout = layoutIdNames(ctx, { lastName, firstName });
  const spec = LAYOUTS[layout.template];
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // A last name on two lines grows upwards, so it never runs into the first name.
  let lastCenter = spec.last.center;
  if (layout.last.lines.length > 1) {
    lastCenter -= ((layout.last.lines.length - 1) * layout.last.size * spec.last.lineHeight) / 2;
  }
  let firstCenter = spec.first.center;
  if (layout.first.lines.length > 2) {
    firstCenter += ((layout.first.lines.length - 2) * layout.first.size * spec.first.lineHeight) / 2;
  }
  drawLines(ctx, layout.last, LAST_WEIGHT, lastCenter, spec.last.lineHeight);
  drawLines(ctx, layout.first, FIRST_WEIGHT, firstCenter, spec.first.lineHeight);
  return layout;
}

function roundRect(ctx, x, y, w, h, r) {
  roundRectCorners(ctx, x, y, w, h, [r, r, r, r]);
}

// Rounded rectangle as a sub-path, one radius per corner (tl, tr, br, bl).
function roundRectCorners(ctx, x, y, w, h, [tl, tr, br, bl]) {
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

// Rounded QR: modules join into smooth shapes - a corner is rounded only where
// neither neighbour touching it is dark - and the three finder eyes are drawn
// as rounded squares. The module grid is unchanged, so it scans like a plain one.
// `hole` (in modules, centred) is left white for the logo.
function drawRoundedQr(ctx, modules, x, y, cell, hole = 0) {
  const n = modules.size;
  const h0 = (n - hole) / 2, h1 = h0 + hole;
  const inHole = (r, c) => hole > 0 && r >= h0 && r < h1 && c >= h0 && c < h1;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && !inHole(r, c) && !!modules.get(r, c);
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const rad = cell * 0.5;

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!dark(r, c) || inFinder(r, c)) continue;
      const up = dark(r - 1, c), down = dark(r + 1, c), left = dark(r, c - 1), right = dark(r, c + 1);
      roundRectCorners(ctx, x + c * cell, y + r * cell, cell, cell, [
        !up && !left ? rad : 0,
        !up && !right ? rad : 0,
        !down && !right ? rad : 0,
        !down && !left ? rad : 0,
      ]);
    }
  }
  ctx.fill();

  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const fx = x + c * cell, fy = y + r * cell;
    ctx.fillStyle = '#000000';
    ctx.beginPath(); roundRect(ctx, fx, fy, 7 * cell, 7 * cell, 2.2 * cell); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); roundRect(ctx, fx + cell, fy + cell, 5 * cell, 5 * cell, 1.5 * cell); ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath(); roundRect(ctx, fx + 2 * cell, fy + 2 * cell, 3 * cell, 3 * cell, 1 * cell); ctx.fill();
  }
}

/** Draws the back, with `qrText` as the QR in the rounded box, and the logo in its middle when `logo`. */
export async function drawIdBack(canvas, { qrText, logo = false }, scale = 1) {
  const bg = await loadImage(ID_BACK_SRC);
  const logoImg = logo && qrText ? await loadImage(ID_QR_LOGO_SRC) : null;
  const ctx = prepare(canvas, scale);
  ctx.drawImage(bg, 0, 0, ID_W, ID_H);

  // White card in place of the grey placeholder, QR centred in it.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  roundRect(ctx, QR_BOX.x, QR_BOX.y, QR_BOX.w, QR_BOX.h, QR_BOX.r);
  ctx.fill();

  if (qrText) {
    const QRCode = (await import('qrcode')).default;
    const { modules } = QRCode.create(qrText, { errorCorrectionLevel: logoImg ? 'H' : 'M' });
    const n = modules.size;
    // As large as the box allows while keeping a white margin for scanners.
    // Each module is a whole number of output pixels, so no seams show.
    const target = Math.min(QR_BOX.w, QR_BOX.h) - 2 * QR_MARGIN;
    const cell = Math.floor((target * scale) / n) / scale;
    const size = cell * n;
    const snap = (v) => Math.round(v * scale) / scale;
    const qx = snap(QR_BOX.x + (QR_BOX.w - size) / 2), qy = snap(QR_BOX.y + (QR_BOX.h - size) / 2);

    // The hole has the same parity as the grid, so it sits exactly on modules.
    let hole = 0;
    if (logoImg) {
      hole = Math.round(n * QR_LOGO_SHARE);
      if ((n - hole) % 2) hole += 1;
    }
    drawRoundedQr(ctx, modules, qx, qy, cell, hole);

    if (logoImg) {
      // Logo inside the hole, half a module of white kept around it.
      const room = (hole - 1) * cell;
      const ratio = logoImg.width / logoImg.height;
      const lw = ratio >= 1 ? room : room * ratio;
      const lh = ratio >= 1 ? room / ratio : room;
      ctx.drawImage(logoImg, qx + (size - lw) / 2, qy + (size - lh) / 2, lw, lh);
    }
  }
}

/**
 * What the QR on the back holds: the conference chooser, /conference - the
 * SAME code on every ID, of every event. It opens one button per conference
 * (Leyte Conference, Cebu Conference), each to that event's own page,
 * /events/<province>-<event>. The programme there is for anybody; the photos
 * and the profile need the attendee's own password (LASTNAME@YEAR) or card,
 * and only open the event they are registered in.
 *
 * `eventSlug` is still taken, for a QR that should open one event directly:
 * pass `direct: true`.
 */
export const idQrText = ({ origin, eventSlug, direct = false }) => (direct && eventSlug
  ? attendeePageUrl(origin, eventSlug)
  : `${String(origin || '').replace(/\/+$/, '')}/conference`);

/**
 * `source` scaled down to width x height in halving steps. One big jump (1416
 * -> 250 px) skips most of the pixels and the small file looks rough; halving
 * each step averages all of them, so the small card stays smooth and sharp.
 */
export function downscaleCanvas(source, width, height) {
  let current = source;
  while (current.width / 2 >= width) {
    const step = document.createElement('canvas');
    step.width = Math.round(current.width / 2);
    step.height = Math.round(current.height / 2);
    const ctx = step.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, step.width, step.height);
    current = step;
  }
  if (current.width === width && current.height === height) return current;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, width, height);
  return out;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
