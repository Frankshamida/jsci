// Story images from event photos - 1080 x 1920 (9:16), the size Instagram and
// Facebook stories are shown at. Drawn on a canvas in the browser, so the
// preview and the downloaded file are the same pixels, like the ID cards
// (idCard.js), and in the same look: red waves, white panels, the metallic
// red banner the ID's "DELEGATE" sits on.
//
// Instagram lays its own bar over the top ~250px and the reply box over the
// bottom ~150px, so nothing that matters is drawn there.

import { placeName } from '@/lib/eventPublic';

export const STORY_W = 1080;
export const STORY_H = 1920;
export const STORY_MAX = 4;

// The event's logo in white on transparent, cut out of the photo frame
// (public/Frames/Frame_1.png) - the same art the downloaded photos carry.
export const STORY_LOGO_SRC = '/Frames/Frame_1_logo.png';

export const STORY_THEMES = [
  { key: 'red', label: 'Red' },
  { key: 'white', label: 'White' },
];

const RED = '#b3121b';
const FONT = 'Montserrat';
const BORDER = 16; // the white edge round each photo

// Layouts, by how many photos were picked: each a list of slots in the
// 1080 x 1920 story, drawn in order (a later slot lies on top of an earlier
// one). `rot` in degrees. The photo area runs from y 500 (under the logo) to
// ~1565, where the name banner overlaps it a little.
export const STORY_LAYOUTS = {
  1: [
    { key: 'tilt', label: 'Tilted', slots: [{ x: 110, y: 500, w: 860, h: 1060, rot: -1.5 }] },
    { key: 'full', label: 'Full', slots: [{ x: 60, y: 500, w: 960, h: 1065 }] },
    { key: 'wide', label: 'Landscape', slots: [{ x: 40, y: 700, w: 1000, h: 700, rot: -2 }] },
  ],
  2: [
    { key: 'stack', label: 'Stacked', slots: [
      { x: 80, y: 500, w: 900, h: 520, rot: -2.5 },
      { x: 100, y: 1045, w: 900, h: 520, rot: 2 },
    ] },
    { key: 'side', label: 'Side by side', slots: [
      { x: 60, y: 500, w: 468, h: 1065 },
      { x: 552, y: 500, w: 468, h: 1065 },
    ] },
    { key: 'prints', label: 'Prints', slots: [
      { x: 60, y: 510, w: 720, h: 620, rot: -6 },
      { x: 300, y: 930, w: 720, h: 620, rot: 5 },
    ] },
  ],
  3: [
    { key: 'top', label: 'Big top', slots: [
      { x: 60, y: 500, w: 960, h: 580 },
      { x: 60, y: 1105, w: 468, h: 460 },
      { x: 552, y: 1105, w: 468, h: 460 },
    ] },
    { key: 'bottom', label: 'Big bottom', slots: [
      { x: 60, y: 500, w: 468, h: 460 },
      { x: 552, y: 500, w: 468, h: 460 },
      { x: 60, y: 985, w: 960, h: 580 },
    ] },
    { key: 'left', label: 'Big left', slots: [
      { x: 60, y: 500, w: 590, h: 1065 },
      { x: 674, y: 500, w: 346, h: 520 },
      { x: 674, y: 1045, w: 346, h: 520 },
    ] },
    { key: 'rows', label: 'Rows', slots: [
      { x: 60, y: 500, w: 960, h: 340 },
      { x: 60, y: 862, w: 960, h: 340 },
      { x: 60, y: 1224, w: 960, h: 340 },
    ] },
  ],
  4: [
    { key: 'grid', label: 'Grid', slots: [
      { x: 60, y: 500, w: 468, h: 520 },
      { x: 552, y: 500, w: 468, h: 520 },
      { x: 60, y: 1045, w: 468, h: 520 },
      { x: 552, y: 1045, w: 468, h: 520 },
    ] },
    { key: 'hero', label: 'Big top', slots: [
      { x: 60, y: 500, w: 960, h: 620 },
      { x: 60, y: 1145, w: 304, h: 420 },
      { x: 388, y: 1145, w: 304, h: 420 },
      { x: 716, y: 1145, w: 304, h: 420 },
    ] },
    { key: 'scatter', label: 'Scattered', slots: [
      { x: 55, y: 505, w: 520, h: 540, rot: -5 },
      { x: 505, y: 530, w: 520, h: 540, rot: 4 },
      { x: 70, y: 1025, w: 520, h: 540, rot: 3 },
      { x: 495, y: 1015, w: 520, h: 540, rot: -4 },
    ] },
    { key: 'film', label: 'Film strip', slots: [
      { x: 110, y: 500, w: 860, h: 250 },
      { x: 110, y: 772, w: 860, h: 250 },
      { x: 110, y: 1044, w: 860, h: 250 },
      { x: 110, y: 1316, w: 860, h: 250 },
    ] },
  ],
};

export const storyLayouts = (count) => STORY_LAYOUTS[Math.max(1, Math.min(STORY_MAX, count))] || STORY_LAYOUTS[1];

/** The slots of layout `key` for `count` photos (the first layout if unknown). */
export const storySlots = (count, key) => {
  const list = storyLayouts(count);
  return (list.find((l) => l.key === key) || list[0]).slots;
};

// How a photo sits in its slot: x / y 0..1 (0.5 = centred) say which part of
// the photo shows, z is the zoom (1 = just fills the slot).
export const STORY_POS = { x: 0.5, y: 0.5, z: 1 };
export const STORY_ZOOM_MAX = 3;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The URL of `photo` for the story: the whole photo, uncropped, up to 1600px,
 * so it can be moved and zoomed inside its slot. The server hands out a
 * Cloudinary URL with a placeholder for the transformation (eventPhotos.js);
 * a photo listed before that existed falls back to the framed preview.
 */
export const storyPhotoUrl = (photo) => {
  if (photo?.story && photo.story.includes('__SLOT__')) {
    return photo.story.replace('__SLOT__', 'c_limit,w_1600,h_1600,q_auto:good,f_jpg');
  }
  return photo?.full || photo?.thumb || '';
};

// The size a photo is drawn at in a slot's picture area, and where.
const placement = (img, iw, ih, pos) => {
  const p = pos || STORY_POS;
  const s = Math.max(iw / img.width, ih / img.height) * (p.z || 1);
  const dw = img.width * s;
  const dh = img.height * s;
  return { dw, dh, dx: (iw - dw) * clamp01(p.x), dy: (ih - dh) * clamp01(p.y) };
};

const rad = (slot) => ((slot.rot || 0) * Math.PI) / 180;

/** Which slot is under a point on the story - the topmost - or -1. */
export const storySlotAt = (slots, px, py) => {
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const s = slots[i];
    const a = -rad(s);
    const x = px - (s.x + s.w / 2);
    const y = py - (s.y + s.h / 2);
    const lx = x * Math.cos(a) - y * Math.sin(a);
    const ly = x * Math.sin(a) + y * Math.cos(a);
    if (Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.h / 2) return i;
  }
  return -1;
};

/**
 * `pos` after dragging the photo by (ddx, ddy) story pixels: the photo
 * follows the finger, and stops at its own edge.
 */
export const storyPan = (slot, img, pos, ddx, ddy) => {
  if (!img) return pos;
  const a = -rad(slot);
  const mx = ddx * Math.cos(a) - ddy * Math.sin(a);
  const my = ddx * Math.sin(a) + ddy * Math.cos(a);
  const iw = slot.w - 2 * BORDER;
  const ih = slot.h - 2 * BORDER;
  const { dw, dh } = placement(img, iw, ih, pos);
  return {
    ...pos,
    x: dw - iw > 0.5 ? clamp01(pos.x + mx / (iw - dw)) : 0.5,
    y: dh - ih > 0.5 ? clamp01(pos.y + my / (ih - dh)) : 0.5,
  };
};

/** `pos` zoomed to `z`, kept between 1 and STORY_ZOOM_MAX. */
export const storyZoom = (pos, z) => ({ ...pos, z: Math.max(1, Math.min(STORY_ZOOM_MAX, z)) });

let fontsReady = null;
/** Montserrat, loaded once before anything is drawn with it. */
export function loadStoryFonts() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (fontsReady) return fontsReady;
  const sheet = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${FONT}:wght@600;800&display=block`;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  fontsReady = sheet
    .then(() => Promise.all([document.fonts.load(`600 40px ${FONT}`), document.fonts.load(`800 40px ${FONT}`)]))
    .catch(() => {});
  return fontsReady;
}

/** An image the canvas may read back (Cloudinary sends CORS headers). */
export const loadStoryImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Could not load ${src}`));
  img.src = src;
});

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const ymd = (v) => (String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || []).slice(1).map(Number);

/** "OCTOBER 2-4, 2026 · CEBU" under the banner. */
export const storyDateLine = (event) => {
  const [y, m, d] = ymd(event?.event_date);
  let date = '';
  if (y) {
    const [y2, m2, d2] = ymd(event?.end_date);
    if (!y2 || (y2 === y && m2 === m && d2 === d)) date = `${MONTHS[m - 1]} ${d}, ${y}`;
    else if (y2 === y && m2 === m) date = `${MONTHS[m - 1]} ${d}–${d2}, ${y}`;
    else if (y2 === y) date = `${MONTHS[m - 1].slice(0, 3)} ${d} – ${MONTHS[m2 - 1].slice(0, 3)} ${d2}, ${y}`;
    else date = `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y} – ${MONTHS[m2 - 1].slice(0, 3)} ${d2}, ${y2}`;
  }
  return [date, placeName(event).toUpperCase()].filter(Boolean).join('  ·  ');
};

const rounded = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// The ID's background: deep red, lit in the middle, with tall soft ribbons
// running down it. On the white theme the same ribbons, faint, in red.
function drawBackground(ctx, theme) {
  const red = theme === 'red';
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  if (red) {
    bg.addColorStop(0, '#4d0005');
    bg.addColorStop(0.45, '#a30f18');
    bg.addColorStop(1, '#5a0006');
  } else {
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.6, '#fff6f6');
    bg.addColorStop(1, '#fde3e4');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const glow = ctx.createRadialGradient(STORY_W / 2, 1000, 60, STORY_W / 2, 1000, 900);
  glow.addColorStop(0, red ? 'rgba(255,70,70,0.35)' : 'rgba(179,18,27,0.08)');
  glow.addColorStop(1, 'rgba(255,70,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Ribbons: wide bands, each starting at a different height with a rounded
  // shoulder - the folded strips behind the ID's white panel.
  const bands = [
    { x: -60, w: 190, top: 120 }, { x: 150, w: 170, top: 380 }, { x: 340, w: 180, top: 40 },
    { x: 540, w: 170, top: 300 }, { x: 730, w: 180, top: 90 }, { x: 930, w: 190, top: 420 },
  ];
  bands.forEach((b, i) => {
    const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
    const a = red ? (i % 2 ? 0.16 : 0.1) : (i % 2 ? 0.06 : 0.035);
    g.addColorStop(0, red ? `rgba(255,120,120,${a})` : `rgba(179,18,27,${a})`);
    g.addColorStop(1, red ? 'rgba(80,0,0,0.12)' : 'rgba(179,18,27,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(b.x, STORY_H);
    ctx.lineTo(b.x, b.top + b.w);
    ctx.quadraticCurveTo(b.x, b.top, b.x + b.w, b.top - 60);
    ctx.lineTo(b.x + b.w, STORY_H);
    ctx.closePath();
    ctx.fill();
  });

  // The metallic strip along the ID's bottom edge.
  const strip = ctx.createLinearGradient(0, 0, STORY_W, 0);
  strip.addColorStop(0, '#7a0a10');
  strip.addColorStop(0.35, '#e6868b');
  strip.addColorStop(0.5, '#ffffff');
  strip.addColorStop(0.65, '#e6868b');
  strip.addColorStop(1, '#7a0a10');
  ctx.fillStyle = strip;
  ctx.fillRect(0, STORY_H - 26, STORY_W, 26);
}

// The logo, white on red; on white, recoloured red.
function drawLogo(ctx, logo, theme, event) {
  const maxW = 640;
  const maxH = 300;
  const top = 170;
  if (logo) {
    const s = Math.min(maxW / logo.width, maxH / logo.height);
    const w = logo.width * s;
    const h = logo.height * s;
    const x = (STORY_W - w) / 2;
    const y = top + (maxH - h) / 2;
    if (theme === 'red') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 24;
      ctx.drawImage(logo, x, y, w, h);
      ctx.restore();
    } else {
      const tint = document.createElement('canvas');
      tint.width = Math.ceil(w);
      tint.height = Math.ceil(h);
      const t = tint.getContext('2d');
      t.drawImage(logo, 0, 0, w, h);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = RED;
      t.fillRect(0, 0, w, h);
      ctx.drawImage(tint, x, y);
    }
    return;
  }
  // No logo image: the event's name in its place.
  ctx.fillStyle = theme === 'red' ? '#fff' : RED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const title = String(event?.title || '').toUpperCase();
  let size = 92;
  do { ctx.font = `800 ${size}px ${FONT}`; size -= 4; } while (size > 40 && ctx.measureText(title).width > 900);
  ctx.fillText(title, STORY_W / 2, top + maxH / 2);
}

// One photo in its white card, filling it, placed by `pos`. `active` (the
// preview only) rings the photo being moved.
function drawPhoto(ctx, img, slot, pos, active) {
  const { x, y, w, h } = slot;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(((slot.rot || 0) * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  rounded(ctx, 0, 0, w, h, 38);
  ctx.fill();
  ctx.restore();

  const iw = w - 2 * BORDER;
  const ih = h - 2 * BORDER;
  rounded(ctx, BORDER, BORDER, iw, ih, 26);
  ctx.clip();
  if (img) {
    const { dw, dh, dx, dy } = placement(img, iw, ih, pos);
    ctx.drawImage(img, BORDER + dx, BORDER + dy, dw, dh);
  } else {
    ctx.fillStyle = '#eee';
    ctx.fillRect(BORDER, BORDER, iw, ih);
  }
  ctx.restore();

  if (active) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rad(slot));
    ctx.strokeStyle = '#ffc300';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 18]);
    rounded(ctx, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 42);
    ctx.stroke();
    ctx.restore();
  }
}

// The ID's "DELEGATE" banner: a metallic red band, wider than the photos,
// with the attendee's name - or "I WAS THERE!" - in white.
function drawBanner(ctx, text) {
  const y = 1545;
  const h = 128;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  const g = ctx.createLinearGradient(0, 0, STORY_W, 0);
  g.addColorStop(0, '#6e0a10');
  g.addColorStop(0.2, '#b3121b');
  g.addColorStop(0.48, '#e04a52');
  g.addColorStop(0.56, '#f7b3b6');
  g.addColorStop(0.66, '#c21a23');
  g.addColorStop(1, '#6e0a10');
  ctx.fillStyle = g;
  ctx.fillRect(24, y, STORY_W - 48, h);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(24, y, STORY_W - 48, 3);

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(80,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  let size = 80;
  do { ctx.font = `800 ${size}px ${FONT}`; size -= 2; } while (size > 36 && ctx.measureText(text).width > 920);
  ctx.fillText(text, STORY_W / 2, y + h / 2 + 3);
  ctx.restore();
}

function drawDateLine(ctx, line, theme) {
  if (!line) return;
  ctx.save();
  ctx.fillStyle = theme === 'red' ? 'rgba(255,255,255,0.92)' : RED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  let size = 34;
  do { ctx.font = `600 ${size}px ${FONT}`; size -= 1; } while (size > 20 && ctx.measureText(line).width > 960);
  ctx.fillText(line, STORY_W / 2, 1735);
  ctx.restore();
}

// The background and logo do not change while a photo is dragged, so they are
// drawn once per theme and reused - dragging stays smooth on a phone.
const backdrops = new Map();
const backdrop = (theme, logo, event) => {
  const key = `${theme}|${logo ? logo.src : event?.title || ''}`;
  if (!backdrops.has(key)) {
    const c = document.createElement('canvas');
    c.width = STORY_W;
    c.height = STORY_H;
    const ctx = c.getContext('2d');
    drawBackground(ctx, theme);
    drawLogo(ctx, logo, theme, event);
    backdrops.set(key, c);
  }
  return backdrops.get(key);
};

/**
 * Draws the story onto `canvas` (sized 1080 x 1920 here).
 *   images   the photos, loaded, in slot order (null for one that failed)
 *   logo     the logo image, or null
 *   theme    'red' | 'white'
 *   name     the attendee's name for the banner, or '' for "I WAS THERE!"
 *   layout   a layout key from STORY_LAYOUTS (the first one if unknown)
 *   positions  per photo, how it sits in its slot (STORY_POS)
 *   active   the slot to ring in the preview; -1 (the saved file) for none
 */
export function drawStory(canvas, {
  images, logo, theme = 'red', name = '', event, layout, positions = [], active = -1,
}) {
  if (canvas.width !== STORY_W) canvas.width = STORY_W;
  if (canvas.height !== STORY_H) canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(backdrop(theme, logo, event), 0, 0);
  storySlots(images.length, layout).forEach((slot, i) => drawPhoto(ctx, images[i], slot, positions[i], i === active));
  drawBanner(ctx, String(name || '').trim().toUpperCase() || 'I WAS THERE!');
  drawDateLine(ctx, storyDateLine(event), theme);
}
