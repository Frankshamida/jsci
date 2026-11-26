// News posters (/news-management/poster/<article>): the rules the editor and
// the server share - headline words and their highlight, the photo crop,
// the style settings, and what a saved poster may hold.
//
// The templates themselves are SVG files (lib/posterBuiltins.js and the
// poster_templates table), read through the "contract" in
// lib/posterSvgSanitize.js and drawn by lib/posterEngine.js.
//
// No browser or server APIs here: both sides import it.

export const POSTER_SETTINGS_KEY = 'news_poster_defaults';
export const POSTER_DEFAULTS = { website: 'jsci.vercel.app', facebook: 'facebook.com/CebuCityJoyfulSound' };
export const POSTER_ZOOM = { min: 1, max: 3 };
export const MAX_LOGOS = 3;

// The two built-in gold card templates. Posters saved before templates were
// SVG files used four keys; the "+ subtext" ones are the same card with the
// subtext switched on.
export const LEGACY_TEMPLATE_KEYS = { landscape_sub: 'landscape', portrait_sub: 'portrait' };
export const TEMPLATE_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;

// Highlight colours offered for the gold words.
export const HIGHLIGHT_PRESETS = {
  gold: { label: 'Gold', stops: [[0, '#FFF3C4'], [0.42, '#FFD25C'], [0.52, '#E9A72E'], [0.78, '#FFE39A'], [1, '#F4BE4A']] },
  joyful: { label: 'Joyful Yellow', stops: [[0, '#FFF6C4'], [0.45, '#FFE066'], [0.55, '#FFC83A'], [1, '#F2A81E']] },
  orange: { label: 'Homes.ph Orange', stops: [[0, '#FFE2BC'], [0.45, '#FFAE45'], [0.55, '#F7931E'], [1, '#E06A00']] },
};

// A wide (or square) photo gets the landscape card, a tall one the portrait.
export const familyForImage = (width, height) => (width >= height ? 'landscape' : 'portrait');

// ---- Headline words and their highlight ----
//
// The highlight is saved as phrases ("8TH ANNIVERSARY"), not word positions,
// so it survives the text being edited around it. A phrase lights up
// wherever its words appear in a row, ignoring case and the punctuation at
// the ends of a word.

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

// Clicking a word turns its highlight on or off.
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

// "A |B|  C" -> "A | B | C".
export const formatSubtext = (text) => String(text || '')
  .split('|').map((s) => s.trim()).filter(Boolean).join(' | ');

// ---- The photo's zoom and position ----
//
// Saved as { zoom, x, y }: zoom 1 is the photo just covering its frame, and
// x, y are the point of the photo (0-1 across and down) at the frame's
// centre. Relative to the photo, so it draws the same at any size, in any
// template, and after a reload.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

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

// Where the whole photo lands, in poster units.
export function cropPlacement(imgW, imgH, frame, crop) {
  const c = clampCrop(imgW, imgH, frame, crop);
  const scale = Math.max(frame.w / imgW, frame.h / imgH) * c.zoom;
  const dw = imgW * scale;
  const dh = imgH * scale;
  return { ...c, scale, dw, dh, dx: frame.x + frame.w / 2 - c.x * dw, dy: frame.y + frame.h / 2 - c.y * dh };
}

// Zoom to `zoom`, keeping the photo point under (px, py) where it is.
export function zoomCropAt(imgW, imgH, frame, crop, zoom, px, py) {
  const before = cropPlacement(imgW, imgH, frame, crop);
  const z = clamp(zoom, POSTER_ZOOM.min, POSTER_ZOOM.max);
  const u = (px - before.dx) / before.dw;
  const v = (py - before.dy) / before.dh;
  const scale = Math.max(frame.w / imgW, frame.h / imgH) * z;
  return clampCrop(imgW, imgH, frame, {
    zoom: z,
    x: u - (px - (frame.x + frame.w / 2)) / (imgW * scale),
    y: v - (py - (frame.y + frame.h / 2)) / (imgH * scale),
  });
}

// ---- Style settings ----
//
// Everything is optional: a setting that is not there means "as the
// template has it". The template's own saved defaults (poster_templates.
// defaults) come first, then the poster's choices on top (mergeStyle).
//
//   text      headlineSize (none = auto), subtextSize, headlineColor,
//             highlight { kind: preset | solid, preset, color },
//             subtextColor, subtextHighlightColor, creditColor, footerColor
//   overlay   the bottom gradient: on, height (% of the poster), color, strength
//   topShade  the top gradient: on, height, color, strength
//   background top, bottom (the background gradient's end colours)
//   filters   brightness, contrast, saturation, warmth, blur, vignette,
//             vignetteStrength, applyToCopies
//   logos     items (1-3: { template: i } or an uploaded { url, ... }),
//             divider, shadow { mode, color, blur, opacity },
//             glow { on, color, strength }

const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : undefined);
const within = (v, lo, hi) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : clamp(Number(v), lo, hi));
const flag = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);

// Drop what is not set; an empty group is no group.
function prune(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined) return;
    if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
    out[k] = v;
  });
  return Object.keys(out).length ? out : undefined;
}

const text = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanLogo(l) {
  if (!l || typeof l !== 'object') return null;
  if (l.template !== undefined) {
    const i = Math.round(Number(l.template));
    return Number.isFinite(i) && i >= 0 && i < 10 ? { template: i } : null;
  }
  const url = String(l.url || '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return null;
  return {
    url: url.slice(0, 700),
    publicId: l.publicId ? text(l.publicId, 300) : null,
    width: within(l.width, 1, 20000) || null,
    height: within(l.height, 1, 20000) || null,
  };
}

export function normalizeStyle(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const t = s.text && typeof s.text === 'object' ? s.text : {};
  const hl = t.highlight && typeof t.highlight === 'object' ? t.highlight : {};
  const ov = s.overlay || {};
  const ts = s.topShade || {};
  const bg = s.background || {};
  const f = s.filters || {};
  const lg = s.logos || {};
  const sh = lg.shadow || {};
  const gl = lg.glow || {};
  return prune({
    text: prune({
      headlineSize: within(t.headlineSize, 40, 110),
      subtextSize: within(t.subtextSize, 18, 48),
      headlineColor: hex(t.headlineColor),
      highlight: prune({
        kind: oneOf(hl.kind, ['preset', 'solid']),
        preset: HIGHLIGHT_PRESETS[hl.preset] ? hl.preset : undefined,
        color: hex(hl.color),
      }),
      subtextColor: hex(t.subtextColor),
      subtextHighlightColor: hex(t.subtextHighlightColor),
      creditColor: hex(t.creditColor),
      footerColor: hex(t.footerColor),
    }),
    overlay: prune({ on: flag(ov.on), height: within(ov.height, 20, 80), color: hex(ov.color), strength: within(ov.strength, 0, 100) }),
    topShade: prune({ on: flag(ts.on), height: within(ts.height, 0, 50), color: hex(ts.color), strength: within(ts.strength, 0, 100) }),
    background: prune({ top: hex(bg.top), bottom: hex(bg.bottom) }),
    filters: prune({
      brightness: within(f.brightness, 50, 150),
      contrast: within(f.contrast, 50, 150),
      saturation: within(f.saturation, 0, 200),
      warmth: within(f.warmth, 0, 100),
      blur: within(f.blur, 0, 20),
      vignette: flag(f.vignette),
      vignetteStrength: within(f.vignetteStrength, 0, 100),
      applyToCopies: flag(f.applyToCopies),
    }),
    logos: prune({
      items: Array.isArray(lg.items) ? lg.items.map(cleanLogo).filter(Boolean).slice(0, MAX_LOGOS) : undefined,
      divider: flag(lg.divider),
      shadow: prune({ mode: oneOf(sh.mode, ['none', 'soft', 'strong']), color: hex(sh.color), blur: within(sh.blur, 0, 20), opacity: within(sh.opacity, 0, 100) }),
      glow: prune({ on: flag(gl.on), color: hex(gl.color), strength: within(gl.strength, 0, 100) }),
    }),
  }) || {};
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

// a, with b on top (arrays are replaced, not merged).
export function mergeStyle(a, b) {
  if (!isPlain(a)) return isPlain(b) ? { ...b } : (b ?? a);
  if (!isPlain(b)) return b === undefined ? { ...a } : b;
  const out = { ...a };
  Object.entries(b).forEach(([k, v]) => { out[k] = isPlain(v) && isPlain(a[k]) ? mergeStyle(a[k], v) : v; });
  return out;
}

// ---- What is saved ----

export function normalizePosterData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const url = String(d.imageUrl || '').trim();
  const phrases = (list) => [...new Set((Array.isArray(list) ? list : []).map((p) => text(p, 80).toUpperCase()).filter(Boolean))].slice(0, 12);
  return {
    headline: text(d.headline, 200),
    highlights: phrases(d.highlights),
    subtext: text(d.subtext, 200),
    subtextHighlights: phrases(d.subtextHighlights),
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
    style: normalizeStyle(d.style),
  };
}

// A saved poster's template, with the old "+ subtext" keys read as the card
// with the subtext on.
export function resolveTemplateKey(key, data) {
  const k = String(key || '');
  if (LEGACY_TEMPLATE_KEYS[k]) return { key: LEGACY_TEMPLATE_KEYS[k], data: { ...data, showSubtext: true } };
  return { key: TEMPLATE_KEY.test(k) ? k : 'landscape', data };
}

export function normalizePosterDefaults(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    website: text(d.website, 80) || POSTER_DEFAULTS.website,
    facebook: text(d.facebook, 80) || POSTER_DEFAULTS.facebook,
  };
}
