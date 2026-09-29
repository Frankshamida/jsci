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

// The Miracle Working God conference's own artwork, cut into pieces from
// public/Template_Generator/Design For Template*.png so each can be placed on
// its own: the emblem, the conference line, the title (with the crown of thorns
// as the O, or plain), and the Luke 5:17 verse.
export const STORY_ART = {
  emblem: '/Template_Generator/parts/emblem.png',
  conference: '/Template_Generator/parts/conference.png',
  titleCrown: '/Template_Generator/parts/title-crown.png',
  title: '/Template_Generator/parts/title.png',
  verse: '/Template_Generator/parts/verse.png',
};

// The moving background a story can have instead of the theme's own - the
// home page's hero video, darkened (drawVideoBackground) so the story's colours
// still stand out on it.
export const STORY_VIDEO_SRC = '/Videos/Hero_Mobile_Web.mp4';

// Themes drawn from that artwork, and which title each one uses.
const ART_THEMES = { crown: 'titleCrown', classic: 'title' };
const isArtTheme = (theme) => Object.prototype.hasOwnProperty.call(ART_THEMES, theme);

const ART_EVENT = /miracle\s*working\s*god/i;

/** The styles on offer for `event` - the conference's own art first, where it is theirs. */
export const storyThemes = (event) => (ART_EVENT.test(String(event?.title || ''))
  ? [{ key: 'crown', label: 'Crown' }, { key: 'classic', label: 'Classic' }, ...STORY_THEMES]
  : STORY_THEMES);

const RED = '#b3121b';
const FONT = 'Montserrat';

// Layouts, by how many photos were picked: each a list of slots in the
// 1080 x 1920 story, drawn in order (a later slot lies on top of an earlier
// one). `rot` in degrees. The photo area runs from y 500 (under the logo) to
// ~1565, just above the name banner.
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

// The art themes put the title above the photos, so their photo area is
// shorter: y 700 to 1515 instead of 500 to 1565. The same layouts, squeezed
// into it.
const ART_TOP = 700;
const ART_SCALE = 815 / 1065;
const artLayouts = {};
const toArtLayouts = (list, count) => {
  if (!artLayouts[count]) {
    artLayouts[count] = list.map((l) => ({
      ...l,
      slots: l.slots.map((sl) => ({
        ...sl,
        y: Math.round(ART_TOP + (sl.y - 500) * ART_SCALE),
        h: Math.round(sl.h * ART_SCALE),
      })),
    }));
  }
  return artLayouts[count];
};

export const storyLayouts = (count, theme) => {
  const n = Math.max(1, Math.min(STORY_MAX, count || 1));
  const list = STORY_LAYOUTS[n];
  return isArtTheme(theme) ? toArtLayouts(list, n) : list;
};

/** The slots of layout `key` for `count` photos (the first layout if unknown). */
export const storySlots = (count, key, theme) => {
  const list = storyLayouts(count, theme);
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
  const iw = slot.w;
  const ih = slot.h;
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

// The ID's "DELEGATE" banner: a metallic red band, wider than the photos,
// with the attendee's name - or "I WAS THERE!" - in white. Just under the
// photos, so their lifted-corner shadows stay in view.
function drawBanner(ctx, text) {
  const y = 1592;
  const h = 112;
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
  let size = 72;
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
  ctx.fillText(line, STORY_W / 2, 1752);
  ctx.restore();
}

// ---- The conference's own artwork (the 'crown' and 'classic' themes) ----

const artImages = new Map();
/** The art pieces, loaded once; a piece that fails to load is null. */
export function loadStoryArt() {
  const keys = Object.keys(STORY_ART);
  return Promise.all(keys.map((k) => {
    if (!artImages.has(k)) artImages.set(k, loadStoryImage(STORY_ART[k]).catch(() => { artImages.delete(k); return null; }));
    return artImages.get(k);
  })).then((imgs) => Object.fromEntries(keys.map((k, i) => [k, imgs[i]])));
}

const VERSE_TEXT = '...And the power of the Lord was present to heal them.';
const VERSE_REF = 'LUKE 5:17';
const ART_RED = '#c8161f';

// `img` in one flat colour, for art that must read on a dark video.
const tinted = (img, w, h, color) => {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const t = c.getContext('2d');
  t.drawImage(img, 0, 0, w, h);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, w, h);
  return c;
};

// `img` without its faint parts, and with its white glints turned a soft red
// (or, with `sparkles: false`, left out). The title's lens glows and glints
// were painted for a white page; on the dark video they turn into grey haze
// and white smudges over the letters.
const solidOnly = (img, { sparkles = true } = {}) => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const t = c.getContext('2d');
  t.drawImage(img, 0, 0);
  const px = t.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const hi = Math.max(d[i], d[i + 1], d[i + 2]);
    const lo = Math.min(d[i], d[i + 1], d[i + 2]);
    const glint = lo > 150 && hi - lo < 50;
    if (d[i + 3] < 110 || (glint && !sparkles)) d[i + 3] = 0;
    else if (glint) {
      d[i] = 255;
      d[i + 1] = 120 + (lo - 150) * 0.5;
      d[i + 2] = 125 + (lo - 150) * 0.5;
      d[i + 3] *= 0.7;
    }
  }
  t.putImageData(px, 0, 0);
  return c;
};

// `img` centred at width `w` with its top at `y`, optionally in one colour.
const drawCentred = (ctx, img, w, y, tint) => {
  const h = (img.height * w) / img.width;
  ctx.drawImage(tint ? tinted(img, w, h, tint) : img, (STORY_W - w) / 2, y, w, h);
};

// A warm white page, as the artwork was made on, with the red lit softly
// behind the photos and faint red ribbons down the sides - the ID's folds.
function drawArtBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.55, '#fff8f7');
  bg.addColorStop(1, '#fbe9e8');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const glow = ctx.createRadialGradient(STORY_W / 2, 1120, 80, STORY_W / 2, 1120, 820);
  glow.addColorStop(0, 'rgba(200,22,31,0.13)');
  glow.addColorStop(0.6, 'rgba(200,22,31,0.05)');
  glow.addColorStop(1, 'rgba(200,22,31,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Ribbons only at the edges, so the title keeps a clean page behind it.
  [{ x: -70, w: 170, top: 560 }, { x: 60, w: 110, top: 900 }, { x: 910, w: 110, top: 820 }, { x: 980, w: 170, top: 480 }]
    .forEach((b) => {
      const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
      g.addColorStop(0, 'rgba(200,22,31,0.07)');
      g.addColorStop(1, 'rgba(200,22,31,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(b.x, STORY_H);
      ctx.lineTo(b.x, b.top + b.w);
      ctx.quadraticCurveTo(b.x, b.top, b.x + b.w, b.top - 60);
      ctx.lineTo(b.x + b.w, STORY_H);
      ctx.closePath();
      ctx.fill();
    });

  const strip = ctx.createLinearGradient(0, 0, STORY_W, 0);
  strip.addColorStop(0, '#7a0a10');
  strip.addColorStop(0.35, '#d83a42');
  strip.addColorStop(0.5, '#ffd6d8');
  strip.addColorStop(0.65, '#d83a42');
  strip.addColorStop(1, '#7a0a10');
  ctx.fillStyle = strip;
  ctx.fillRect(0, STORY_H - 18, STORY_W, 18);
}

// Emblem, "CHRISTIAN HEALING CONFERENCE 2026" and the title, top to bottom.
function drawArtHeader(ctx, art, theme, event, dark) {
  const ink = dark ? '#ffffff' : undefined;
  if (art?.emblem) drawCentred(ctx, art.emblem, 92, 150, ink);
  if (art?.conference) drawCentred(ctx, art.conference, 700, 262, ink);
  const title = art?.[ART_THEMES[theme]] || art?.title;
  if (title) {
    if (dark) {
      // The title keeps its red and its glints, without the haze, and a tight
      // white edge round the letters alone - so their dark red does not sink
      // into the video, and the glints do not bloom into blobs.
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.75)';
      ctx.shadowBlur = 7;
      drawCentred(ctx, solidOnly(title, { sparkles: false }), 580, 312);
      ctx.restore();
      drawCentred(ctx, solidOnly(title), 580, 312);
      return;
    }
    drawCentred(ctx, title, 580, 312);
    return;
  }
  ctx.fillStyle = dark ? '#ffffff' : ART_RED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 96px ${FONT}`;
  String(event?.title || 'MIRACLE WORKING GOD').toUpperCase().split(/\s+/).slice(0, 3)
    .forEach((word, i) => ctx.fillText(word, STORY_W / 2, 400 + i * 100));
}

// Luke 5:17 under the photos. The artwork's own lettering when it loaded,
// typed out when it did not - the verse is never left off.
function drawArtVerse(ctx, art, dark) {
  const y = 1648;
  if (art?.verse) {
    drawCentred(ctx, art.verse, 980, y, dark ? '#ffffff' : undefined);
    return;
  }
  ctx.save();
  ctx.fillStyle = dark ? '#ffffff' : ART_RED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.font = `600 29px ${FONT}`;
  ctx.fillText(VERSE_TEXT, STORY_W / 2, y + 22);
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(VERSE_REF, STORY_W / 2, y + 62);
  ctx.restore();
}

// Only the blurred shadow of `path`, never its hard edge: the shape is filled
// far off to the left and its shadow thrown back into place. Shadow offsets
// ignore the canvas transform, so the throw is turned by the photo's angle.
const FAR = 10000;
function shadowOnly(ctx, angle, path, { color, blur, oy = 0 }) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = FAR * Math.cos(angle) - oy * Math.sin(angle);
  ctx.shadowOffsetY = FAR * Math.sin(angle) + oy * Math.cos(angle);
  ctx.translate(-FAR, 0);
  ctx.fillStyle = '#000';
  path();
  ctx.fill();
  ctx.restore();
}

// A photo laid on the page like a sheet of paper, with no border: a crisp
// contact shadow all round, and a deeper one under the lower-left corner that
// thins out along the bottom edge - the corner lifting off the page.
function drawPhoto(ctx, img, slot, pos, active) {
  const { x, y, w, h } = slot;
  const angle = rad(slot);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);

  const box = () => { ctx.beginPath(); ctx.rect(0, 0, w, h); };
  // The lifted corner: along the left edge and the bottom, deepest at the
  // bottom-left, fading out towards the right.
  const lift = () => {
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.1);
    ctx.lineTo(-13, h * 0.9);
    ctx.quadraticCurveTo(-15, h + 20, w * 0.12, h + 18);
    ctx.quadraticCurveTo(w * 0.55, h + 11, w * 0.97, h + 1);
    ctx.lineTo(w * 0.97, h * 0.6);
    ctx.closePath();
  };
  shadowOnly(ctx, angle, box, { color: 'rgba(70,0,6,0.16)', blur: 46, oy: 16 });
  shadowOnly(ctx, angle, lift, { color: 'rgba(0,0,0,0.58)', blur: 18 });
  shadowOnly(ctx, angle, box, { color: 'rgba(0,0,0,0.28)', blur: 3, oy: 1 });

  ctx.save();
  box();
  ctx.clip();
  if (img) {
    const { dw, dh, dx, dy } = placement(img, w, h, pos);
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = '#eee';
    ctx.fillRect(0, 0, w, h);
  }
  // The lifted corner catches a little less light than the rest.
  const shade = ctx.createLinearGradient(0, h, w * 0.35, h * 0.65);
  shade.addColorStop(0, 'rgba(0,0,0,0.10)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.restore();

  if (active) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.strokeStyle = '#ffc300';
    ctx.lineWidth = 8;
    ctx.setLineDash([26, 16]);
    ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
    ctx.restore();
  }
}

// The name on a slim metallic red ribbon just under the photos, leaving their
// lifted-corner shadows in view.
function drawArtBanner(ctx, text) {
  const w = 760;
  const h = 84;
  const x = (STORY_W - w) / 2;
  const y = 1542;
  ctx.save();
  ctx.shadowColor = 'rgba(70,0,4,0.40)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#6e0a10');
  g.addColorStop(0.22, '#b3121b');
  g.addColorStop(0.47, '#e04a52');
  g.addColorStop(0.55, '#f7b3b6');
  g.addColorStop(0.66, '#c21a23');
  g.addColorStop(1, '#6e0a10');
  ctx.fillStyle = g;
  rounded(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  rounded(ctx, x, y, w, h, h / 2);
  ctx.clip();
  const shine = ctx.createLinearGradient(0, y, 0, y + h);
  shine.addColorStop(0, 'rgba(255,255,255,0.35)');
  shine.addColorStop(0.45, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = shine;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(80,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  let size = 54;
  do { ctx.font = `800 ${size}px ${FONT}`; size -= 2; } while (size > 30 && ctx.measureText(text).width > w - 90);
  ctx.fillText(text, STORY_W / 2, y + h / 2 + 2);
  ctx.restore();
}

function drawArtDateLine(ctx, line, dark) {
  if (!line) return;
  ctx.save();
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(122,10,16,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  let size = 26;
  do { ctx.font = `600 ${size}px ${FONT}`; size -= 1; } while (size > 18 && ctx.measureText(line).width > 900);
  ctx.fillText(line, STORY_W / 2, 1768);
  ctx.restore();
}

// The video, filling the story, under black: heaviest at the top and bottom
// where the title, verse and date sit, lighter through the photos. The story's
// own colours are drawn over this, so they stand out rather than compete.
function drawVideoBackground(ctx, video) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const s = Math.max(STORY_W / video.videoWidth, STORY_H / video.videoHeight);
  const w = video.videoWidth * s;
  const h = video.videoHeight * s;
  ctx.drawImage(video, (STORY_W - w) / 2, (STORY_H - h) / 2, w, h);

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const g = ctx.createLinearGradient(0, 0, 0, STORY_H);
  g.addColorStop(0, 'rgba(0,0,0,0.88)');
  g.addColorStop(0.36, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.2)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const strip = ctx.createLinearGradient(0, 0, STORY_W, 0);
  strip.addColorStop(0, '#7a0a10');
  strip.addColorStop(0.35, '#d83a42');
  strip.addColorStop(0.5, '#ffd6d8');
  strip.addColorStop(0.65, '#d83a42');
  strip.addColorStop(1, '#7a0a10');
  ctx.fillStyle = strip;
  ctx.fillRect(0, STORY_H - 18, STORY_W, 18);
}

// The background, and the logo / title / verse above it, do not change while a
// photo is dragged or the video plays, so each is drawn once and reused -
// dragging stays smooth on a phone, and a video frame costs three copies.
const layers = new Map();
const layer = (key, paint) => {
  if (!layers.has(key)) {
    const c = document.createElement('canvas');
    c.width = STORY_W;
    c.height = STORY_H;
    paint(c.getContext('2d'));
    layers.set(key, c);
  }
  return layers.get(key);
};
const backgroundLayer = (theme) => layer(`bg|${isArtTheme(theme) ? 'art' : theme}`, (ctx) => {
  if (isArtTheme(theme)) drawArtBackground(ctx);
  else drawBackground(ctx, theme);
});
const headerLayer = (theme, logo, event, art, dark) => {
  const artKey = art ? Object.values(art).map((img) => (img ? 1 : 0)).join('') : '';
  const key = `head|${theme}|${logo ? logo.src : event?.title || ''}|${artKey}|${dark ? 1 : 0}`;
  return layer(key, (ctx) => {
    if (isArtTheme(theme)) {
      drawArtHeader(ctx, art, theme, event, dark);
      drawArtVerse(ctx, art, dark);
    } else {
      // On the dark video the white theme draws its logo white, as the red one does.
      drawLogo(ctx, logo, dark ? 'red' : theme, event);
    }
  });
};

/** Whether `video` has a frame to draw. */
const hasFrame = (video) => !!video && video.readyState >= 2 && video.videoWidth > 0;

/**
 * Draws the story onto `canvas` (sized 1080 x 1920 here).
 *   images   the photos, loaded, in slot order (null for one that failed)
 *   logo     the logo image, or null
 *   theme    'crown' | 'classic' (the conference artwork) | 'red' | 'white'
 *   art      the pieces from loadStoryArt(), for the artwork themes
 *   video    a playing <video> to use as the background instead, or null
 *   name     the attendee's name for the banner, or '' for "I WAS THERE!"
 *   layout   a layout key from STORY_LAYOUTS (the first one if unknown)
 *   positions  per photo, how it sits in its slot (STORY_POS)
 *   active   the slot to ring in the preview; -1 (the saved file) for none
 */
export function drawStory(canvas, {
  images, logo, art, video, theme = 'red', name = '', event, layout, positions = [], active = -1,
}) {
  if (canvas.width !== STORY_W) canvas.width = STORY_W;
  if (canvas.height !== STORY_H) canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const dark = hasFrame(video);
  if (dark) drawVideoBackground(ctx, video);
  else ctx.drawImage(backgroundLayer(theme), 0, 0);
  ctx.drawImage(headerLayer(theme, logo, event, art, dark), 0, 0);
  const slots = storySlots(images.length, layout, theme);
  slots.forEach((slot, i) => drawPhoto(ctx, images[i], slot, positions[i], i === active));
  if (isArtTheme(theme)) {
    drawArtBanner(ctx, String(name || '').trim().toUpperCase() || 'I WAS THERE!');
    drawArtDateLine(ctx, storyDateLine(event), dark);
    return;
  }
  drawBanner(ctx, String(name || '').trim().toUpperCase() || 'I WAS THERE!');
  drawDateLine(ctx, storyDateLine(event), dark ? 'red' : theme);
}

// ---- Saving a story with a video background ----

/** Whether this browser can record the canvas to a video file. */
export const canRecordStory = () => typeof window !== 'undefined'
  && typeof window.MediaRecorder !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined'
  && typeof HTMLCanvasElement.prototype.captureStream === 'function';

// MP4 first - it is what phone galleries, Instagram and Facebook all take.
// Chrome on older versions only records WebM.
const RECORD_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export const STORY_VIDEO_MAX_S = 15;

/**
 * Records the story as a video: `video` is played once from the start (up to
 * STORY_VIDEO_MAX_S seconds) while `render(canvas)` draws each frame.
 * Resolves with the file.
 *
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas   drawn on and recorded
 * @param {HTMLVideoElement}  o.video    the background video
 * @param {(canvas: HTMLCanvasElement) => void} o.render
 * @param {string} o.name                file name without extension
 * @param {(seconds: number, total: number) => void} [o.onProgress]
 */
export async function recordStory({ canvas, video, render, name, onProgress }) {
  const mimeType = RECORD_TYPES.find((t) => window.MediaRecorder.isTypeSupported(t)) || '';
  const total = Math.min(STORY_VIDEO_MAX_S, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : STORY_VIDEO_MAX_S);

  video.pause();
  await new Promise((resolve) => {
    if (video.currentTime === 0) { resolve(); return; }
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = 0;
  });
  render(canvas);

  const stream = canvas.captureStream(30);
  const recorder = new window.MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e.error || new Error('Recording failed'));
  });

  recorder.start(250);
  await video.play();
  const started = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      render(canvas);
      onProgress?.(Math.min(t, total), total);
      if (t >= total) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return new File(chunks, `${name}.${ext}`, { type });
}
