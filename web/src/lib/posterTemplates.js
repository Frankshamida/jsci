// News posters (/news-management/poster/<article>): the templates, and the
// rules the editor and the server share.
//
// A template is data, not code. The renderer (lib/posterRender.js) draws
// whatever these objects describe, so a new template is a new entry in
// POSTER_TEMPLATES, usually the shared BASE with a different photo frame.
// Every number is in poster pixels on the 1126 x 1408 canvas, taken from the
// designer's SVGs in public/News_Article_Template.
//
// Blur and shadow sizes are Gaussian standard deviations, as in the SVGs
// (feGaussianBlur stdDeviation). The renderer turns them into canvas units.
//
// No browser or server APIs here: the server imports this to check what is
// saved, the editor to draw it.

export const POSTER_WIDTH = 1126;
export const POSTER_HEIGHT = 1408;
export const POSTER_LOGO = '/Frames/Logo_Stamp.png';
export const POSTER_SETTINGS_KEY = 'news_poster_defaults';
export const POSTER_DEFAULTS = { website: 'jsci.vercel.app', facebook: 'facebook.com/CebuCityJoyfulSound' };
export const POSTER_ZOOM = { min: 1, max: 3 };

// The metallic gold of a highlighted headline word.
const GOLD_TEXT = [[0, '#FFF3C4'], [0.42, '#FFD25C'], [0.52, '#E9A72E'], [0.78, '#FFE39A'], [1, '#F4BE4A']];

const CARD = { x: 50, y: 188, w: 1026, h: 785, r: 30 };

// What every template has: the gold background with the photo blurred into
// it, the logo, the photo card, the credit, the headline and the footer.
const BASE = {
  background: {
    gradient: [[0, '#F3D58E'], [0.45, '#D9A441'], [1, '#8A5A16']],
    photo: { opacity: 0.45, blur: 14 },
    overlay: [[0, 'rgba(255,246,224,0.35)'], [0.55, 'rgba(201,139,42,0.25)'], [0.72, 'rgba(110,69,16,0.7)'], [1, 'rgba(62,38,6,0.92)']],
    glow: { cx: 563, cy: 90, rx: 560, ry: 260, opacity: 0.45 },
  },
  logo: {
    src: POSTER_LOGO,
    width: 330,
    band: [0, 188], // centred in the top 188px
    shadows: [
      { dy: 4, blur: 8, color: 'rgba(110,69,16,0.35)' },
      { dy: 1.5, blur: 1.2, color: 'rgba(90,54,8,0.75)' },
    ],
  },
  card: {
    ...CARD,
    fill: '#F3E2BC',
    shadow: { dy: 16, blur: 22, color: 'rgba(90,58,10,0.35)' },
    frame: { width: 6, stops: [[0, '#FFFFFF'], [0.5, '#F3C25A'], [1, '#FFFFFF']] },
  },
  credit: {
    right: CARD.x + CARD.w,
    baseline: 1005,
    font: { family: 'poppins', weight: 500, size: 20, min: 14 },
    color: 'rgba(255,255,255,0.9)',
    maxWidth: CARD.w,
  },
  headline: {
    zone: [1030, 1300], // the headline (and subtext) sit centred in here
    centerX: POSTER_WIDTH / 2,
    maxWidth: 1000,
    size: [68, 44], // starts at 68px, shrinks to 44px before it wraps further
    maxLines: 3,
    // Fewer, fuller lines win when they cost little size: two lines at 66px
    // over three at 68px, as in the designs (at least 90% of the biggest).
    fewerLines: 0.9,
    lineHeight: 1.04,
    font: { family: 'outfit', weight: 800 },
    color: '#FFFFFF',
    gold: GOLD_TEXT,
    shadow: { dy: 4, blur: 3, color: 'rgba(0,0,0,0.4)' },
  },
  subtextStyle: {
    gap: 46, // from the last headline line's baseline to the subtext's
    font: { family: 'poppins', weight: 600, size: 26, min: 16 },
    color: '#FCD877',
    maxWidth: 1000,
  },
  footer: {
    baseline: 1352,
    centerX: POSTER_WIDTH / 2,
    font: { family: 'poppins', weight: 400, size: 22 },
    color: '#FFFFFF',
    icon: { r: 11.5, stroke: 2, textOffset: 23 }, // text starts 23px right of the icon's centre
    gap: 41, // between the website and the Facebook page
  },
};

const LANDSCAPE_PHOTO = { frame: { ...CARD } };

const PORTRAIT_W = (CARD.h * 9) / 16;
const PORTRAIT_PHOTO = {
  frame: { x: POSTER_WIDTH / 2 - PORTRAIT_W / 2, y: CARD.y, w: PORTRAIT_W, h: CARD.h, r: 0 },
  // The card behind a portrait photo: the same photo, blurred, with a cream tint.
  backdrop: { blur: 22, opacity: 0.7, tint: 'rgba(255,246,224,0.15)' },
  edges: { width: 2, color: 'rgba(234,164,58,0.6)' },
};

export const POSTER_TEMPLATES = [
  { key: 'landscape', label: 'Landscape photo', family: 'landscape', subtext: false, photo: LANDSCAPE_PHOTO },
  { key: 'landscape_sub', label: 'Landscape + subtext', family: 'landscape', subtext: true, photo: LANDSCAPE_PHOTO },
  { key: 'portrait', label: 'Portrait photo', family: 'portrait', subtext: false, photo: PORTRAIT_PHOTO },
  { key: 'portrait_sub', label: 'Portrait + subtext', family: 'portrait', subtext: true, photo: PORTRAIT_PHOTO },
].map((t) => ({ ...BASE, ...t }));

export const TEMPLATE_KEYS = POSTER_TEMPLATES.map((t) => t.key);

export const posterTemplate = (key) => POSTER_TEMPLATES.find((t) => t.key === key) || POSTER_TEMPLATES[0];

// The template of a family ("landscape", "portrait") with or without subtext.
export const templateFor = (family, subtext) => POSTER_TEMPLATES.find((t) => t.family === family && t.subtext === !!subtext)
  || POSTER_TEMPLATES.find((t) => t.family === family)
  || POSTER_TEMPLATES[0];

// A wide (or square) photo gets the landscape card, a tall one the portrait.
export const familyForImage = (width, height) => (width >= height ? 'landscape' : 'portrait');

// ---- Headline words and their gold highlight ----
//
// The highlight is saved as phrases ("8TH ANNIVERSARY"), not word positions,
// so it survives the headline being edited around it. A phrase lights up
// wherever its words appear in a row in the headline, ignoring case and the
// punctuation at the ends of a word.

export const headlineWords = (text) => String(text || '').split(/\s+/).filter(Boolean);

export const normWord = (word) => String(word || '').toUpperCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const phraseWords = (phrase) => headlineWords(phrase).map(normWord).filter(Boolean);

export function highlightMarks(words, phrases) {
  const norm = words.map(normWord);
  const marks = norm.map(() => false);
  (phrases || []).forEach((phrase) => {
    const pw = phraseWords(phrase);
    if (!pw.length) return;
    for (let i = 0; i + pw.length <= norm.length; i += 1) {
      if (pw.every((w, k) => norm[i + k] === w)) for (let k = 0; k < pw.length; k += 1) marks[i + k] = true;
    }
  });
  return marks;
}

// Runs of highlighted words, back into phrases.
export function phrasesFromMarks(words, marks) {
  const out = [];
  let run = [];
  words.forEach((w, i) => {
    const n = normWord(w);
    if (marks[i] && n) run.push(n);
    else if (run.length) { out.push(run.join(' ')); run = []; }
  });
  if (run.length) out.push(run.join(' '));
  return [...new Set(out)];
}

// Clicking a word turns its gold on or off.
export function toggleHighlight(text, phrases, index) {
  const words = headlineWords(text);
  const marks = highlightMarks(words, phrases);
  if (index < 0 || index >= words.length) return phrases || [];
  marks[index] = !marks[index];
  return phrasesFromMarks(words, marks);
}

// Does the phrase appear in the headline, word for word?
export const phraseInHeadline = (headline, phrase) => {
  const pw = phraseWords(phrase);
  return pw.length > 0 && highlightMarks(headlineWords(headline), [phrase]).some(Boolean);
};

// "A |B|  C" -> "A | B | C", in capitals.
export const formatSubtext = (text) => String(text || '')
  .split('|').map((s) => s.trim()).filter(Boolean).join(' | ').toUpperCase();

// ---- The photo's zoom and position ----
//
// Saved as { zoom, x, y }: zoom 1 is the photo just covering its frame, and
// x, y are the point of the photo (0-1 across and down) at the frame's
// centre. Relative to the photo, so it draws the same at any size and after
// a reload.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const DEFAULT_CROP = { zoom: 1, x: 0.5, y: 0.5 };

// The crop, moved back inside the photo so the frame never shows an edge.
export function clampCrop(imgW, imgH, frame, crop) {
  const zoom = clamp(num(crop?.zoom, 1), POSTER_ZOOM.min, POSTER_ZOOM.max);
  if (!imgW || !imgH) return { zoom, x: clamp(num(crop?.x, 0.5), 0, 1), y: clamp(num(crop?.y, 0.5), 0, 1) };
  const scale = Math.max(frame.w / imgW, frame.h / imgH) * zoom;
  const halfW = Math.min(0.5, frame.w / (scale * imgW) / 2);
  const halfH = Math.min(0.5, frame.h / (scale * imgH) / 2);
  return {
    zoom,
    x: clamp(num(crop?.x, 0.5), halfW, 1 - halfW),
    y: clamp(num(crop?.y, 0.5), halfH, 1 - halfH),
  };
}

// Where the whole photo lands, in poster pixels, for drawImage.
export function cropPlacement(imgW, imgH, frame, crop) {
  const c = clampCrop(imgW, imgH, frame, crop);
  const scale = Math.max(frame.w / imgW, frame.h / imgH) * c.zoom;
  const dw = imgW * scale;
  const dh = imgH * scale;
  return {
    ...c,
    scale,
    dw,
    dh,
    dx: frame.x + frame.w / 2 - c.x * dw,
    dy: frame.y + frame.h / 2 - c.y * dh,
  };
}

// Zoom to `zoom`, keeping the photo point under (px, py) where it is.
export function zoomCropAt(imgW, imgH, frame, crop, zoom, px, py) {
  const before = cropPlacement(imgW, imgH, frame, crop);
  const z = clamp(zoom, POSTER_ZOOM.min, POSTER_ZOOM.max);
  const u = (px - before.dx) / before.dw;
  const v = (py - before.dy) / before.dh;
  const scale = Math.max(frame.w / imgW, frame.h / imgH) * z;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return clampCrop(imgW, imgH, frame, {
    zoom: z,
    x: u - (px - cx) / (imgW * scale),
    y: v - (py - cy) / (imgH * scale),
  });
}

// ---- What is saved ----

const text = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizePosterData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const url = String(d.imageUrl || '').trim();
  return {
    headline: text(d.headline, 200),
    highlights: [...new Set((Array.isArray(d.highlights) ? d.highlights : []).map((p) => text(p, 80).toUpperCase()).filter(Boolean))].slice(0, 12),
    subtext: text(d.subtext, 140),
    showSubtext: d.showSubtext === true,
    credit: text(d.credit, 90),
    showCredit: d.showCredit !== false,
    website: text(d.website, 80),
    facebook: text(d.facebook, 80),
    imageUrl: /^https:\/\/[^\s"'<>]+$/i.test(url) ? url.slice(0, 700) : null,
    imagePublicId: d.imagePublicId ? text(d.imagePublicId, 300) : null,
    crop: {
      zoom: clamp(num(d.crop?.zoom, 1), POSTER_ZOOM.min, POSTER_ZOOM.max),
      x: clamp(num(d.crop?.x, 0.5), 0, 1),
      y: clamp(num(d.crop?.y, 0.5), 0, 1),
    },
    templateLocked: d.templateLocked === true,
  };
}

export function normalizePosterDefaults(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    website: text(d.website, 80) || POSTER_DEFAULTS.website,
    facebook: text(d.facebook, 80) || POSTER_DEFAULTS.facebook,
  };
}
