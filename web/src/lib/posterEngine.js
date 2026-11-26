// The poster engine. BROWSER ONLY (the poster editor).
//
// One function, buildPosterSvg, takes a template (an SVG that follows the
// contract in lib/posterSvgSanitize.js) and a poster's words, photo and
// style, and returns the finished SVG. Controls only ever touch contract
// ids, so every template - built in or imported - gets every control.
// Layers a control needs and the template lacks (the top gradient, a logo
// glow, the photo filter, a logo shadow) are added with ids of our own.
//
// The finished SVG carries everything inside it - the photo, the logos and
// the Outfit and Poppins fonts as data: URIs - and is drawn as a picture
// (never put into the page), so scripts can never run, and the preview, the
// thumbnail and the 1x / 2x download are the same drawing.

import {
  SVG_NS, XLINK_NS, analyzeTemplate, boxOf, elements, fillGradient, indexIds, inherited, nameOf,
  sanitizeSvgDocument, stopOpacity, styleProp, svgSource, walk,
} from '@/lib/posterSvgSanitize';
import {
  HIGHLIGHT_PRESETS, cropPlacement, formatSubtext, headlineWords, highlightMarks,
} from '@/lib/posterTemplates';

const num = (v, fallback = null) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const fmt = (n) => String(Math.round(n * 100) / 100);

// ---- Pictures ----

const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i;

// A Cloudinary picture at a given width: PNG for logos (to keep them
// transparent - an SVG logo comes back drawn as a PNG), JPEG for the
// preview's photo (a fraction of a PNG's size, so the preview redraws
// quickly), otherwise the picture's own format.
export const sizedImageUrl = (url, width, { png = false, jpg = false } = {}) => {
  const m = String(url || '').match(CLOUDINARY_UPLOAD);
  const format = png ? 'f_png,' : jpg ? 'f_jpg,' : '';
  return m ? `${m[1]}${format}q_auto:good,w_${width},c_limit/${m[2]}` : url;
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const pictures = new Map();

// { dataUrl, width, height } for a picture on Cloudinary, on this site or
// already a data: URI.
export function inlineImage(src) {
  if (!src) return Promise.resolve(null);
  if (!pictures.has(src)) {
    const p = (async () => {
      let dataUrl = src;
      if (!/^data:/i.test(src)) {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('That picture could not be loaded.');
        dataUrl = await blobToDataUrl(await res.blob());
      }
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
    })();
    p.catch(() => pictures.delete(src));
    pictures.set(src, p);
    if (pictures.size > 40) pictures.delete(pictures.keys().next().value);
  }
  return pictures.get(src);
}

// ---- Fonts ----

// The family names next/font gave Outfit (root layout) and Poppins (poster
// layout), read from their CSS variables.
// The family names next/font gave the fonts the app supplies to templates:
// Outfit (root layout), Poppins and Playfair Display (poster layout).
export function readFontFamilies(el) {
  const css = (name) => getComputedStyle(el).getPropertyValue(name).trim();
  return {
    outfit: css('--font-outfit') || 'Outfit, sans-serif',
    poppins: css('--font-poppins') || 'Poppins, sans-serif',
    playfair: css('--font-playfair') || '"Playfair Display", serif',
  };
}

export async function loadFonts(fonts) {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const specs = ['800 60px', '700 60px', '600 60px'].map((s) => `${s} ${fonts.outfit}`)
    .concat(['400 24px', '500 24px', '600 24px', '700 24px'].map((s) => `${s} ${fonts.poppins}`))
    .concat(['400 40px', '700 40px'].map((s) => `${s} ${fonts.playfair}`));
  await Promise.all(specs.map((f) => document.fonts.load(f, 'AZaz09').catch(() => null)));
  await document.fonts.ready;
}

const firstFamily = (list) => String(list || '').split(',')[0].replace(/['"]/g, '').trim();
const latinRange = (range) => !range || String(range).split(',').some((part) => {
  const m = part.trim().match(/^U\+([0-9a-f?]+)/i);
  return m && parseInt(m[1].replace(/\?/g, '0'), 16) <= 0x24f;
});

let fontCssPromise = null;

// @font-face rules for 'Outfit' and 'Poppins' with the font files the site
// already serves, embedded, so the poster SVG draws with the real fonts
// wherever it is drawn. Only the Latin files.
export function embeddedFontCss(fonts) {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const aliases = new Map([
        [firstFamily(fonts.outfit), 'Outfit'], [firstFamily(fonts.poppins), 'Poppins'], [firstFamily(fonts.playfair), 'Playfair Display'],
      ]);
      const faces = [];
      Array.from(document.styleSheets).forEach((sheet) => {
        let rules;
        try { rules = sheet.cssRules; } catch { return; } // another site's stylesheet
        Array.from(rules || []).forEach((rule) => {
          if (typeof CSSFontFaceRule === 'undefined' || !(rule instanceof CSSFontFaceRule)) return;
          const alias = aliases.get(rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim());
          const range = rule.style.getPropertyValue('unicode-range');
          if (!alias || !latinRange(range)) return;
          const m = rule.style.getPropertyValue('src').match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
          if (!m) return;
          faces.push({
            alias,
            url: new URL(m[1], sheet.href || window.location.href).href,
            weight: rule.style.getPropertyValue('font-weight') || '400',
            style: rule.style.getPropertyValue('font-style') || 'normal',
            range,
          });
        });
      });
      const css = await Promise.all(faces.map(async (face) => {
        const res = await fetch(face.url);
        if (!res.ok) return '';
        const data = await blobToDataUrl(await res.blob());
        return `@font-face{font-family:'${face.alias}';src:url(${data}) format('woff2');font-weight:${face.weight};font-style:${face.style};${face.range ? `unicode-range:${face.range};` : ''}}`;
      }));
      return css.join('');
    })();
    fontCssPromise.catch(() => { fontCssPromise = null; });
  }
  return fontCssPromise;
}

// Text measured in the real fonts (a template's "Outfit" and "Poppins" are
// the site's own).
export function makeMeasure(fonts) {
  const ctx = document.createElement('canvas').getContext('2d');
  const resolve = (family) => String(family || 'sans-serif').split(',').map((part) => {
    const name = part.replace(/['"]/g, '').trim();
    if (/^outfit$/i.test(name)) return fonts.outfit;
    if (/^poppins$/i.test(name)) return fonts.poppins;
    if (/^playfair display$/i.test(name)) return fonts.playfair;
    return /\s/.test(name) ? `'${name}'` : name;
  }).join(', ');
  const metricsCache = new Map();
  const width = (text, font) => {
    ctx.font = `${font.weight} ${font.size}px ${resolve(font.family)}`;
    return ctx.measureText(text).width;
  };
  const metrics = (font) => {
    const key = `${font.family}|${font.weight}`;
    if (!metricsCache.has(key)) {
      ctx.font = `${font.weight} 100px ${resolve(font.family)}`;
      const m = ctx.measureText('H');
      metricsCache.set(key, {
        cap: (m.actualBoundingBoxAscent || 71) / 100,
        ascent: (m.fontBoundingBoxAscent || 100) / 100,
        descent: (m.fontBoundingBoxDescent || 26) / 100,
      });
    }
    return metricsCache.get(key);
  };
  return { width, metrics };
}

// ---- Templates ----

export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(svgSource(text), 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || nameOf(doc.documentElement) !== 'svg') {
    throw new Error('That file is not a valid SVG.');
  }
  return doc;
}

const refId = (value) => {
  const m = String(value || '').match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
  return m ? m[1] : null;
};

const fraction = (v, fallback) => {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  return /%$/.test(s) ? num(s, fallback * 100) / 100 : num(s, fallback);
};

// A mask or clip measured against its element's box ("objectBoundingBox")
// would stretch once the photo is zoomed past its frame, so it is pinned to
// the box the frame had.
function pinToBox(ref, box) {
  const kind = nameOf(ref);
  const pinChildren = () => elements(ref).forEach((c) => {
    c.setAttribute('transform', `translate(${fmt(box.x)} ${fmt(box.y)}) scale(${fmt(box.w)} ${fmt(box.h)}) ${c.getAttribute('transform') || ''}`.trim());
  });
  if (kind === 'mask') {
    if ((ref.getAttribute('maskUnits') || 'objectBoundingBox') === 'objectBoundingBox') {
      const fx = fraction(ref.getAttribute('x'), -0.1);
      const fy = fraction(ref.getAttribute('y'), -0.1);
      const fw = fraction(ref.getAttribute('width'), 1.2);
      const fh = fraction(ref.getAttribute('height'), 1.2);
      ref.setAttribute('maskUnits', 'userSpaceOnUse');
      ref.setAttribute('x', fmt(box.x + fx * box.w));
      ref.setAttribute('y', fmt(box.y + fy * box.h));
      ref.setAttribute('width', fmt(fw * box.w));
      ref.setAttribute('height', fmt(fh * box.h));
    }
    if (ref.getAttribute('maskContentUnits') === 'objectBoundingBox') {
      ref.setAttribute('maskContentUnits', 'userSpaceOnUse');
      pinChildren();
    }
  } else if (kind === 'clipPath' && ref.getAttribute('clipPathUnits') === 'objectBoundingBox') {
    ref.setAttribute('clipPathUnits', 'userSpaceOnUse');
    pinChildren();
  }
}

// A template, ready to draw: parsed (and cleaned, unless it is one of ours),
// its own pictures embedded, read, and its photo masks pinned.
export async function prepareTemplate(svgText, { trusted = false } = {}) {
  const doc = parseSvg(svgText);
  if (!trusted) sanitizeSvgDocument(doc);
  const root = doc.documentElement;

  // Our built-in templates point at pictures on this site.
  const local = [];
  walk(root, (el) => {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
    if (trusted && nameOf(el) === 'image' && href.startsWith('/')) local.push([el, href]);
  });
  await Promise.all(local.map(async ([el, href]) => {
    const pic = await inlineImage(href).catch(() => null);
    setHref(el, pic ? pic.dataUrl : '');
  }));
  // A picture linked twice (href and xlink:href) is kept once.
  walk(root, (el) => {
    const a = el.getAttribute('href');
    const b = el.getAttribute('xlink:href');
    if (a !== null && b !== null && (a === b || !b)) setHref(el, a);
    else if (!a && b) setHref(el, b);
  });

  const info = analyzeTemplate(doc);
  const ids = indexIds(root);
  const photo = ids.get('photo');
  for (let el = photo; el && el.nodeType === 1 && el !== root; el = el.parentNode) {
    ['mask', 'clip-path'].forEach((attr) => {
      const ref = ids.get(refId(styleProp(el, attr) || el.getAttribute(attr)));
      const box = el === photo ? info.photo : boxOf(el, info.width, info.height);
      if (ref && box) pinToBox(ref, box);
    });
  }
  return { doc, info };
}

// ---- Small DOM helpers ----

function make(doc, tag, attrs = {}) {
  const el = doc.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null) el.setAttribute(k, typeof v === 'number' ? fmt(v) : String(v)); });
  return el;
}

// One link per picture (href; the old xlink:href copy would embed it twice).
function setHref(el, value) {
  el.setAttribute('href', value);
  if (el.hasAttribute('xlink:href')) el.removeAttribute('xlink:href');
  if (el.hasAttributeNS && el.hasAttributeNS(XLINK_NS, 'href')) el.removeAttributeNS(XLINK_NS, 'href');
}

function setStyleProp(el, name, value) {
  const parts = String(el.getAttribute('style') || '').split(';').map((s) => s.trim())
    .filter((p) => p && !new RegExp(`^${name}\\s*:`, 'i').test(p));
  if (value !== null && value !== undefined) parts.push(`${name}:${value}`);
  if (parts.length) el.setAttribute('style', parts.join(';'));
  else el.removeAttribute('style');
}

const hide = (el) => setStyleProp(el, 'display', 'none');
const paint = (el, prop, color) => { el.setAttribute(prop, color); setStyleProp(el, prop, color); };

function setStop(stop, { color, opacity }) {
  if (color) { stop.setAttribute('stop-color', color); setStyleProp(stop, 'stop-color', null); }
  if (opacity !== undefined) { stop.setAttribute('stop-opacity', fmt(Math.max(0, Math.min(1, opacity)))); setStyleProp(stop, 'stop-opacity', null); }
}

function gradient(doc, tag, id, attrs, stops) {
  const g = make(doc, tag, { id, ...attrs });
  stops.forEach(([offset, color, opacity = 1]) => g.appendChild(make(doc, 'stop', { offset, 'stop-color': color, 'stop-opacity': opacity })));
  return g;
}

const insertAfter = (node, ref) => ref.parentNode.insertBefore(node, ref.nextSibling);

// ---- Text layout ----

const transformText = (s, how) => (how === 'uppercase' ? s.toUpperCase() : how === 'lowercase' ? s.toLowerCase() : s);

function balancedLines(n, count, widthOf, maxWidth) {
  let best = null;
  let bestWidest = Infinity;
  const picked = [];
  const walkBreaks = (start, left) => {
    if (left === 1) {
      const lines = [...picked, [start, n]];
      const widest = Math.max(...lines.map(([a, b]) => widthOf(a, b)));
      if (widest <= maxWidth && widest < bestWidest - 0.01) { bestWidest = widest; best = lines; }
      return;
    }
    for (let end = start + 1; end <= n - (left - 1); end += 1) {
      picked.push([start, end]);
      walkBreaks(end, left - 1);
      picked.pop();
    }
  };
  walkBreaks(0, count);
  return best;
}

function greedyLines(n, widthOf, maxWidth) {
  const lines = [];
  let start = 0;
  for (let i = 1; i <= n; i += 1) {
    if (i === n || widthOf(start, i + 1) > maxWidth) { lines.push([start, i]); start = i; }
  }
  return lines;
}

const firstTspanY = (el) => {
  const t = elements(el).find((c) => nameOf(c) === 'tspan' && c.getAttribute('y'));
  return num(t?.getAttribute('y'), num(el.getAttribute('y'), 0));
};
const lastTspanY = (el) => {
  const list = elements(el).filter((c) => nameOf(c) === 'tspan' && c.getAttribute('y'));
  return num(list[list.length - 1]?.getAttribute('y'), num(el.getAttribute('y'), 0));
};
const anchorX = (el) => num(el.getAttribute('x'), num(elements(el).find((c) => nameOf(c) === 'tspan')?.getAttribute('x'), 0));

// Words into lines: the template's size shrinking to data-min-size (or the
// size chosen), no line wider than data-max-width, at most data-max-lines,
// in as few lines as it fits nicely.
function layoutText(el, text, phrases, manualSize, measure, W) {
  const font = {
    family: inherited(el, 'font-family') || 'sans-serif',
    weight: inherited(el, 'font-weight') || '400',
    size: num(el.getAttribute('font-size'), num(inherited(el, 'font-size'), 32)),
  };
  const ls = num(inherited(el, 'letter-spacing'), 0);
  const raw = headlineWords(text);
  const words = raw.map((w) => transformText(w, el.getAttribute('data-transform')));
  const marks = highlightMarks(raw, phrases);
  const base = font.size;
  const minSize = Math.min(base, num(el.getAttribute('data-min-size'), base));
  const maxLines = Math.max(1, Math.round(num(el.getAttribute('data-max-lines'), 3)));
  const maxWidth = num(el.getAttribute('data-max-width'), W * 0.9);
  const lhRatio = num(el.getAttribute('data-line-height'), base * 1.2) / base;
  const prefer = num(el.getAttribute('data-prefer-fewer-lines'), 0.9);
  const g100 = words.map((w) => measure.width(w, { ...font, size: 100 }));
  const sp100 = measure.width(' ', { ...font, size: 100 });
  const lens = words.map((w) => [...w].length);
  const lineWidth = (a, b, size) => {
    let w = 0;
    for (let i = a; i < b; i += 1) w += (g100[i] * size) / 100 + ls * lens[i];
    return w + ((sp100 * size) / 100 + ls) * (b - a - 1);
  };
  const n = words.length;
  let size = manualSize || base;
  let lines = [];
  let overflow = false;
  if (n && manualSize) {
    for (let count = 1; count <= maxLines && !lines.length; count += 1) lines = balancedLines(n, count, (a, b) => lineWidth(a, b, size), maxWidth) || [];
    if (!lines.length) { lines = greedyLines(n, (a, b) => lineWidth(a, b, size), maxWidth); overflow = lines.length > maxLines; }
  } else if (n) {
    const options = [];
    for (let count = 1; count <= Math.min(maxLines, n); count += 1) {
      for (let s = base; s >= minSize; s -= 1) {
        const fit = balancedLines(n, count, (a, b) => lineWidth(a, b, s), maxWidth);
        if (fit) { options.push({ size: s, lines: fit }); break; }
      }
    }
    if (options.length) {
      const biggest = Math.max(...options.map((o) => o.size));
      ({ size, lines } = options.find((o) => o.size >= biggest * prefer));
    } else {
      size = minSize;
      lines = greedyLines(n, (a, b) => lineWidth(a, b, size), maxWidth);
      overflow = true;
    }
  }
  return {
    el, font, ls, words, marks, size, lines, overflow, lh: size * lhRatio, g100, sp100, lens, lineWidth,
    anchor: inherited(el, 'text-anchor') || 'start',
    x: anchorX(el),
    m: measure.metrics(font),
  };
}

// The laid-out lines back into the <text>, as #id-line-1..n tspans with the
// highlighted words in <tspan class="hl">.
function writeLines(doc, L, baselines, idBase, hlFill) {
  const { el } = L;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.setAttribute('font-size', fmt(L.size));
  L.lines.forEach(([from, to], j) => {
    const line = make(doc, 'tspan', { id: `${idBase}-line-${j + 1}`, x: L.x, y: baselines[j] });
    let buf = '';
    const flush = () => { if (buf) { line.appendChild(doc.createTextNode(buf)); buf = ''; } };
    for (let i = from; i < to; i += 1) {
      if (i > from) buf += ' ';
      if (L.marks[i]) {
        flush();
        const hl = make(doc, 'tspan', { class: 'hl' });
        const fill = hlFill(j, baselines[j]);
        if (fill) hl.setAttribute('style', `fill:${fill}`);
        hl.appendChild(doc.createTextNode(L.words[i]));
        line.appendChild(hl);
      } else {
        buf += L.words[i];
      }
    }
    flush();
    el.appendChild(line);
  });
}

// Where each word is, so a click on the preview can toggle its highlight.
function wordBoxes(L, baselines, target) {
  const out = [];
  const sp = (L.sp100 * L.size) / 100 + L.ls;
  L.lines.forEach(([from, to], j) => {
    const lw = L.lineWidth(from, to, L.size);
    let left = L.anchor === 'middle' ? L.x - lw / 2 : L.anchor === 'end' ? L.x - lw : L.x;
    for (let i = from; i < to; i += 1) {
      const w = (L.g100[i] * L.size) / 100 + L.ls * L.lens[i];
      out.push({ target, i, x: left - sp / 2, y: baselines[j] - L.m.cap * L.size - L.lh * 0.12, w: w + sp, h: L.lh });
      left += w + sp;
    }
  });
  return out;
}

// ---- The poster ----

// Logos laid out in the logo area: centred as a group, 100% / 80% / 66% of
// the area's height for 1 / 2 / 3 logos, a 24px gap, all scaled down
// together if the row would be wider than the area.
export function layoutLogos(area, items, k) {
  const n = items.length;
  if (!n) return [];
  const gap = 24 * k;
  let h = area.h * (n === 1 ? 1 : n === 2 ? 0.8 : 0.66);
  let widths = items.map((it) => (h * it.width) / it.height);
  const room = area.w - gap * (n - 1);
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum > room && room > 0) { const s = room / sum; h *= s; widths = widths.map((w) => w * s); }
  const total = widths.reduce((a, b) => a + b, 0) + gap * (n - 1);
  let x = area.x + (area.w - total) / 2;
  const y = area.y + (area.h - h) / 2;
  return widths.map((w) => { const box = { x, y, w, h }; x += w + gap; return box; });
}

function photoFilter(doc, id, F, k) {
  const b = (F.brightness ?? 100) / 100;
  const c = (F.contrast ?? 100) / 100;
  const s = (F.saturation ?? 100) / 100;
  const w = (F.warmth ?? 0) / 100;
  const blur = (F.blur ?? 0) * k;
  const filter = make(doc, 'filter', { id, x: '-5%', y: '-5%', width: '110%', height: '110%', 'color-interpolation-filters': 'sRGB' });
  if (b !== 1 || c !== 1) {
    const ct = make(doc, 'feComponentTransfer');
    ['R', 'G', 'B'].forEach((ch) => ct.appendChild(make(doc, `feFunc${ch}`, { type: 'linear', slope: b * c, intercept: (1 - c) / 2 })));
    filter.appendChild(ct);
  }
  if (s !== 1) filter.appendChild(make(doc, 'feColorMatrix', { type: 'saturate', values: s }));
  if (w > 0) {
    // Warmth: part of the way to sepia, nudged towards orange.
    const a = w * 0.45;
    const m = [
      1 - a + a * 0.393, a * 0.769, a * 0.189, 0, 0,
      a * 0.349, 1 - a + a * 0.686, a * 0.168, 0, 0,
      a * 0.272, a * 0.534, 1 - a + a * 0.131, 0, 0,
      0, 0, 0, 1, 0,
    ].map((v) => fmt(v)).join(' ');
    filter.appendChild(make(doc, 'feColorMatrix', { type: 'matrix', values: m }));
    filter.appendChild(make(doc, 'feColorMatrix', { type: 'hueRotate', values: -6 * w }));
  }
  if (blur > 0) filter.appendChild(make(doc, 'feGaussianBlur', { stdDeviation: blur, edgeMode: 'duplicate' }));
  return filter.firstChild ? filter : null;
}

// env: {
//   photo:   { dataUrl, width, height } | null   the main photo
//   logos:   Map(url -> { dataUrl, width, height })  uploaded logos, loaded
//   measure: from makeMeasure()      fontCss: from embeddedFontCss()
//   scale:   1 or 2 (the download)   hideLogos: true to leave the logos out
// }
// Returns { svg, layout: { words, overflow, headlineSize, subtextSize, logoBox } }.
export function buildPosterSvg(tpl, data, style, env) {
  const S = style || {};
  const T = S.text || {};
  const info = tpl.info;
  const W = info.width;
  const H = info.height;
  const k = W / 1080;
  const doc = tpl.doc.cloneNode(true);
  const root = doc.documentElement;
  const ids = indexIds(root);
  const taken = new Set(ids.keys());
  const uid = (name) => { let id = `pe-${name}`; for (let i = 2; taken.has(id); i += 1) id = `pe-${name}-${i}`; taken.add(id); return id; };
  let defs = elements(root).find((e) => nameOf(e) === 'defs');
  if (!defs) { defs = make(doc, 'defs'); root.insertBefore(defs, root.firstChild); }

  // Big data: URIs are swapped in after the SVG is written out.
  const tokens = new Map();
  const asset = (dataUrl) => { const t = `pe-asset:${tokens.size + 1}:`; tokens.set(t, dataUrl); return t; };

  const scale = env.scale || 1;
  root.setAttribute('width', fmt(W * scale));
  root.setAttribute('height', fmt(H * scale));
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const fontStyle = make(doc, 'style');
  fontStyle.appendChild(doc.createTextNode('pe-fonts-here'));
  defs.insertBefore(fontStyle, defs.firstChild);

  // ---- Background ----
  const bg = fillGradient(ids, ids.get('layer-background'));
  if (bg && bg.stops.length && S.background) {
    if (S.background.top) setStop(bg.stops[0], { color: S.background.top });
    if (S.background.bottom) setStop(bg.stops[bg.stops.length - 1], { color: S.background.bottom });
  }

  // ---- Bottom gradient ----
  const overlay = ids.get('layer-overlay');
  const ov = S.overlay || {};
  if (overlay) {
    if (ov.on === false) hide(overlay);
    else {
      const g = fillGradient(ids, overlay);
      if (ov.height !== undefined) {
        const oy = num(overlay.getAttribute('y'), 0);
        const oh = num(overlay.getAttribute('height'), H);
        const h = (H * ov.height) / 100;
        const y = H - h;
        overlay.setAttribute('y', fmt(y));
        overlay.setAttribute('height', fmt(h));
        if (g && g.grad.getAttribute('gradientUnits') === 'userSpaceOnUse') {
          const y1 = num(g.grad.getAttribute('y1'), oy);
          const y2 = num(g.grad.getAttribute('y2'), oy + oh);
          g.grad.setAttribute('y1', fmt(y + ((y1 - oy) / oh) * h));
          g.grad.setAttribute('y2', fmt(y + ((y2 - oy) / oh) * h));
        }
      }
      if (g && (ov.color || ov.strength !== undefined)) {
        g.stops.forEach((stop) => setStop(stop, {
          color: ov.color,
          opacity: ov.strength !== undefined ? stopOpacity(stop) * (ov.strength / 100) : undefined,
        }));
      }
    }
  }

  // ---- Top gradient (added when the template has none) ----
  let topShade = ids.get('layer-top-shade');
  const ts = S.topShade || {};
  const topOn = ts.on ?? Boolean(topShade);
  if (!topOn) {
    if (topShade) hide(topShade);
  } else if (!topShade || Object.keys(ts).some((key) => key !== 'on')) {
    const h = (H * (ts.height ?? info.topShade?.height ?? 30)) / 100;
    const color = ts.color || info.topShade?.color || '#000000';
    const strength = (ts.strength ?? 60) / 100;
    const gid = uid('grad-top-shade');
    defs.appendChild(gradient(doc, 'linearGradient', gid, { gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: Math.max(1, h) }, [
      [0, color, strength], [0.55, color, strength * 0.45], [1, color, 0],
    ]));
    if (!topShade) {
      topShade = make(doc, 'rect', { id: 'layer-top-shade' });
      const after = overlay || (() => { let a = ids.get('layer-photo') || ids.get('photo'); while (a && a.parentNode && a.parentNode !== root && a.parentNode.parentNode) a = a.parentNode; return a; })();
      if (after && after.parentNode) insertAfter(topShade, after); else root.appendChild(topShade);
    }
    topShade.setAttribute('x', '0');
    topShade.setAttribute('y', '0');
    topShade.setAttribute('width', fmt(W));
    topShade.setAttribute('height', fmt(h));
    paint(topShade, 'fill', `url(#${gid})`);
    setStyleProp(topShade, 'display', null);
  }

  // ---- The photo ----
  // The photo is embedded once and drawn by reference wherever the template
  // uses it (the frame, blurred background copies).
  const photoEl = ids.get('photo');
  const frame = info.photo;
  const F = S.filters || {};
  const filterId = uid('photo-fx');
  const fx = env.photo ? photoFilter(doc, filterId, F, k) : null;
  if (fx) defs.appendChild(fx);
  if (photoEl && frame && env.photo) {
    const ph = env.photo;
    const srcId = uid('photo-src');
    const src = make(doc, 'image', { id: srcId, width: ph.width, height: ph.height, preserveAspectRatio: 'none' });
    setHref(src, asset(ph.dataUrl));
    defs.appendChild(src);
    const photoAt = (box, slice = true) => {
      const s = slice ? Math.max(box.w / ph.width, box.h / ph.height) : Math.min(box.w / ph.width, box.h / ph.height);
      const u = make(doc, 'use', { transform: `translate(${fmt(box.x + (box.w - ph.width * s) / 2)} ${fmt(box.y + (box.h - ph.height * s) / 2)}) scale(${s})` });
      setHref(u, `#${srcId}`);
      return u;
    };
    // Copies: the same photo, covering their own box.
    const copies = [];
    walk(root, (el) => { if (nameOf(el) === 'image' && el.getAttribute('data-photo') && el !== photoEl) copies.push(el); });
    copies.forEach((el) => {
      const box = boxOf(el, W, H);
      const clipId = uid('copy-clip');
      const clip = make(doc, 'clipPath', { id: clipId });
      clip.appendChild(make(doc, 'rect', { x: box.x, y: box.y, width: box.w, height: box.h }));
      defs.appendChild(clip);
      const g = make(doc, 'g');
      ['opacity', 'filter', 'mask', 'class', 'style', 'transform'].forEach((a) => { if (el.getAttribute(a)) g.setAttribute(a, el.getAttribute(a)); });
      const inner = make(doc, 'g', { 'clip-path': `url(#${clipId})` });
      inner.appendChild(photoAt(box));
      g.appendChild(inner);
      let node = g;
      if (fx && F.applyToCopies) { node = make(doc, 'g', { filter: `url(#${filterId})` }); node.appendChild(g); }
      el.parentNode.replaceChild(node, el);
    });

    // The main photo: zoomed and moved as the crop says, filtered, then cut
    // to its frame (so a blurred photo never spills out of it).
    // With a blur, the photo is laid a little past its frame on every side,
    // so the blur has photo to draw from and the edges do not fade.
    const reach = (F.blur || 0) * k * 3;
    const laid = reach ? { x: frame.x - reach, y: frame.y - reach, w: frame.w + reach * 2, h: frame.h + reach * 2 } : frame;
    const p = cropPlacement(ph.width, ph.height, laid, env.crop || data.crop);
    const clipId = uid('photo-clip');
    const clip = make(doc, 'clipPath', { id: clipId });
    clip.appendChild(make(doc, 'rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h }));
    defs.appendChild(clip);
    const g = make(doc, 'g');
    ['opacity', 'mask', 'class', 'style', 'transform'].forEach((a) => { if (photoEl.getAttribute(a)) g.setAttribute(a, photoEl.getAttribute(a)); });
    g.appendChild(photoAt({ x: p.dx, y: p.dy, w: p.dw, h: p.dh }));
    let inner = g;
    if (photoEl.getAttribute('filter')) { inner = make(doc, 'g', { filter: photoEl.getAttribute('filter') }); inner.appendChild(g); }
    if (fx) { const f2 = make(doc, 'g', { filter: `url(#${filterId})` }); f2.appendChild(inner); inner = f2; }
    const node = make(doc, 'g', { id: 'photo', 'clip-path': `url(#${clipId})` });
    node.appendChild(inner);
    photoEl.parentNode.replaceChild(node, photoEl);
    const placeholder = ids.get('photo-placeholder');
    if (placeholder) hide(placeholder);

    if (F.vignette) {
      const vid = uid('vignette');
      const a = (F.vignetteStrength ?? 50) / 100;
      defs.appendChild(gradient(doc, 'radialGradient', vid, { cx: 0.5, cy: 0.5, r: 0.72 }, [[0, '#000000', 0], [0.55, '#000000', 0], [1, '#000000', 0.9 * a]]));
      insertAfter(make(doc, 'rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: `url(#${vid})`, 'pointer-events': 'none' }), node);
    }
  }

  // ---- Logos ----
  const logoGroup = ids.get('brand-logo');
  const glowEl = ids.get('layer-logo-glow');
  const L = S.logos || {};
  let logoBox = info.logo?.area || null;
  if (env.hideLogos) {
    if (logoGroup) hide(logoGroup);
    if (glowEl) hide(glowEl);
  } else if (logoGroup && info.logo) {
    if (L.items) {
      const items = L.items.map((it) => {
        if (it.template !== undefined) {
          const t = info.logo.images[it.template];
          return t && t.href ? { href: /^data:/i.test(t.href) ? asset(t.href) : t.href, width: t.width, height: t.height } : null;
        }
        const pic = env.logos?.get(it.url);
        return pic ? { href: asset(pic.dataUrl), width: pic.width, height: pic.height } : null;
      }).filter(Boolean);
      const old = [];
      walk(logoGroup, (el) => { if (nameOf(el) === 'image') old.push(el); });
      old.forEach((el) => el.parentNode.removeChild(el));
      const boxes = layoutLogos(info.logo.area, items, k);
      boxes.forEach((b, i) => {
        const img = make(doc, 'image', { x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'xMidYMid meet' });
        setHref(img, items[i].href);
        logoGroup.appendChild(img);
        if (i > 0 && (L.divider ?? true)) {
          const prev = boxes[i - 1];
          logoGroup.appendChild(make(doc, 'rect', {
            x: (prev.x + prev.w + b.x) / 2 - 0.5 * k, y: b.y + b.h * 0.15, width: Math.max(1, k), height: b.h * 0.7, fill: '#FFFFFF', 'fill-opacity': 0.4,
          }));
        }
      });
      if (boxes.length) {
        const x = boxes[0].x;
        logoBox = { x, y: boxes[0].y, w: boxes[boxes.length - 1].x + boxes[boxes.length - 1].w - x, h: boxes[0].h };
      }
    } else if (info.logo.images.length) {
      const bs = info.logo.images.map((i) => i.box);
      const x = Math.min(...bs.map((b) => b.x));
      const y = Math.min(...bs.map((b) => b.y));
      logoBox = { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
    }

    const sh = L.shadow || {};
    if (sh.mode === 'none') logoGroup.removeAttribute('filter');
    else if (sh.mode === 'soft' || sh.mode === 'strong') {
      const preset = sh.mode === 'strong' ? { blur: 14, opacity: 65, dy: 4 } : { blur: 8, opacity: 35, dy: 2 };
      const id = uid('logo-shadow');
      const filter = make(doc, 'filter', { id, x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' });
      filter.appendChild(make(doc, 'feDropShadow', {
        dx: 0, dy: preset.dy * k, stdDeviation: ((sh.blur ?? preset.blur) * k) / 2, 'flood-color': sh.color || '#000000', 'flood-opacity': (sh.opacity ?? preset.opacity) / 100,
      }));
      defs.appendChild(filter);
      logoGroup.setAttribute('filter', `url(#${id})`);
    }

    const gl = L.glow || {};
    const glowOn = gl.on ?? Boolean(glowEl);
    if (!glowOn) {
      if (glowEl) hide(glowEl);
    } else if (glowEl) {
      setStyleProp(glowEl, 'display', null);
      const g = fillGradient(ids, glowEl);
      if (g && (gl.color || gl.strength !== undefined)) {
        g.stops.forEach((stop) => setStop(stop, { color: gl.color, opacity: gl.strength !== undefined ? stopOpacity(stop) * (gl.strength / 100) : undefined }));
      }
    } else if (logoBox) {
      const gid = uid('grad-logo-glow');
      const a = (gl.strength ?? 60) / 100;
      defs.appendChild(gradient(doc, 'radialGradient', gid, { cx: 0.5, cy: 0.5, r: 0.5 }, [[0, gl.color || '#FFFFFF', 0.75 * a], [1, gl.color || '#FFFFFF', 0]]));
      logoGroup.parentNode.insertBefore(make(doc, 'ellipse', {
        id: 'layer-logo-glow', cx: logoBox.x + logoBox.w / 2, cy: logoBox.y + logoBox.h / 2, rx: logoBox.w / 2 + 150 * k, ry: logoBox.h / 2 + 90 * k, fill: `url(#${gid})`,
      }), logoGroup);
    }
  }

  // ---- Headline, divider and subtext ----
  const head = ids.get('headline');
  const sub = ids.get('subtext');
  const block = ids.get('text-block');
  const divider = ids.get('divider');
  const subText = formatSubtext(data.subtext);
  const showSub = Boolean(sub) && data.showSubtext !== false && Boolean(subText);
  const HL = head ? layoutText(head, data.headline, data.highlights, T.headlineSize, env.measure, W) : null;
  const ST = showSub ? layoutText(sub, subText, data.subtextHighlights, T.subtextSize, env.measure, W) : null;
  if (sub && !showSub) hide(sub);
  const n = HL ? HL.lines.length : 0;
  const m = ST ? ST.lines.length : 0;
  const headBase = [];
  const subBase = [];
  let dividerY = null;
  const anchor = block ? block.getAttribute('data-anchor') || 'top' : 'top';
  if (anchor === 'bottom') {
    const hGap = num(block.getAttribute('data-headline-gap'), 24);
    const dGap = num(block.getAttribute('data-divider-gap'), 0);
    if (m) {
      const last = num(block.getAttribute('data-subtext-last-baseline'), lastTspanY(sub));
      for (let j = 0; j < m; j += 1) subBase[j] = last - (m - 1 - j) * ST.lh;
      dividerY = subBase[0] - ST.size * ST.m.cap - dGap;
    } else {
      dividerY = num(block.getAttribute('data-divider-no-subtext'), divider ? num(divider.getAttribute('y'), 0) : (head ? lastTspanY(head) : 0) + hGap);
    }
    for (let j = 0; j < n; j += 1) headBase[j] = dividerY - hGap - (n - 1 - j) * HL.lh;
  } else if (anchor === 'middle') {
    const zone = String(block.getAttribute('data-zone') || '').split(/[\s,]+/).map(Number);
    const [z0, z1] = zone.length === 2 && zone.every(Number.isFinite) ? zone : [firstTspanY(head) - 60, firstTspanY(head) + 60];
    const gap = num(block.getAttribute('data-subtext-gap'), 46);
    const hCap = HL ? HL.m.cap * HL.size : 0;
    const sCap = ST ? ST.m.cap * ST.size : 0;
    const total = (n ? hCap + (n - 1) * HL.lh : 0) + (m ? (n ? gap : sCap) + (m - 1) * ST.lh : 0);
    const top = (z0 + z1) / 2 - total / 2;
    for (let j = 0; j < n; j += 1) headBase[j] = top + hCap + j * HL.lh;
    const s0 = n ? headBase[n - 1] + gap : top + sCap;
    for (let j = 0; j < m; j += 1) subBase[j] = s0 + j * ST.lh;
  } else {
    // Top-anchored: the headline starts where the template's does; the
    // subtext and divider move down with any extra headline lines.
    const h0 = head ? firstTspanY(head) : 0;
    for (let j = 0; j < n; j += 1) headBase[j] = h0 + j * HL.lh;
    const shift = n && head ? headBase[n - 1] - lastTspanY(head) : 0;
    if (m) { const s0 = firstTspanY(sub) + shift; for (let j = 0; j < m; j += 1) subBase[j] = s0 + j * ST.lh; }
    if (divider) dividerY = num(divider.getAttribute('y'), num(divider.getAttribute('y1'), 0)) + shift;
    // Ornaments marked to follow the headline move with it too.
    if (shift) {
      walk(root, (el) => {
        if (el.getAttribute('data-follow-headline') !== 'true') return;
        el.setAttribute('transform', `translate(0 ${fmt(shift)}) ${el.getAttribute('transform') || ''}`.trim());
      });
    }
  }
  if (divider && dividerY !== null) {
    if (nameOf(divider) === 'line') { divider.setAttribute('y1', fmt(dividerY)); divider.setAttribute('y2', fmt(dividerY)); } else divider.setAttribute('y', fmt(dividerY));
  }

  // Highlight colour: the template's own (its .hl style), a preset gradient
  // (one per line, so every line gets the full metallic sweep) or a colour.
  // A template can also name its own gradient (data-highlight-gradient).
  const ownGradient = head && fillGradient(ids, { getAttribute: (a) => (a === 'fill' ? `url(#${head.getAttribute('data-highlight-gradient') || ''})` : null) });
  const ownStops = ownGradient?.stops.length
    ? ownGradient.stops.map((st) => [num(st.getAttribute('offset'), 0), styleProp(st, 'stop-color') || st.getAttribute('stop-color') || '#FFFFFF', stopOpacity(st)])
    : null;
  const hlChoice = T.highlight?.kind ? T.highlight
    : info.headline?.preset ? { kind: 'preset', preset: info.headline.preset }
      : ownStops ? { kind: 'own' } : null;
  const headFill = (L2) => (j, baseline) => {
    if (!hlChoice) return null;
    if (hlChoice.kind === 'solid') return hlChoice.color || null;
    const stops = hlChoice.kind === 'own' ? ownStops : (HIGHLIGHT_PRESETS[hlChoice.preset] || HIGHLIGHT_PRESETS.gold).stops.map(([o, c]) => [o, c, 1]);
    const gid = uid('hl');
    defs.appendChild(gradient(doc, 'linearGradient', gid, {
      gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: baseline - L2.m.ascent * L2.size, y2: baseline + L2.m.descent * L2.size,
    }, stops));
    return `url(#${gid})`;
  };
  const words = [];
  if (HL) {
    writeLines(doc, HL, headBase, 'headline', headFill(HL));
    if (T.headlineColor) paint(head, 'fill', T.headlineColor);
    words.push(...wordBoxes(HL, headBase, 'headline'));
  }
  if (ST) {
    writeLines(doc, ST, subBase, 'subtext', () => T.subtextHighlightColor || null);
    if (T.subtextColor) paint(sub, 'fill', T.subtextColor);
    words.push(...wordBoxes(ST, subBase, 'subtext'));
  }

  // ---- Photo credit ----
  const credit = ids.get('photo-credit');
  if (credit) {
    const value = transformText(String(data.credit || '').trim(), credit.getAttribute('data-transform'));
    if (!data.showCredit || !value) hide(credit);
    else {
      const decor = elements(credit).find((c) => nameOf(c) === 'tspan');
      while (credit.firstChild) credit.removeChild(credit.firstChild);
      const colon = value.indexOf(':');
      if (decor && colon > 0 && colon < value.length - 1) {
        // "PHOTO: <tspan underline>NAME</tspan>" keeps the template's styling.
        credit.appendChild(doc.createTextNode(`${value.slice(0, colon + 1)} `));
        const t = decor.cloneNode(false);
        t.appendChild(doc.createTextNode(value.slice(colon + 1).trim()));
        credit.appendChild(t);
      } else {
        credit.appendChild(doc.createTextNode(value));
      }
      if (T.creditColor) paint(credit, 'fill', T.creditColor);
    }
  }

  // ---- Footer ----
  const footerItems = [['footer-website', data.website], ['footer-facebook', data.facebook]].map(([id, value]) => {
    const g = ids.get(id);
    if (!g) return null;
    let t = null;
    walk(g, (el) => { if (!t && nameOf(el) === 'text') t = el; });
    return t ? { g, t, value: String(value || '').trim() } : null;
  }).filter(Boolean);
  if (footerItems.length) {
    const fontOf = (t) => ({ family: inherited(t, 'font-family') || 'sans-serif', weight: inherited(t, 'font-weight') || '400', size: num(inherited(t, 'font-size'), 22) });
    // Where an item's icon starts: a circle, moved by a translate(x y)
    // scale(s) group around it or drawn where it is.
    const iconLeft = (it) => {
      let left = num(it.t.getAttribute('x'), 0);
      const visit = (node, tx, sc) => elements(node).forEach((el) => {
        if (el === it.t) return;
        const mt = (el.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)(?:\s*scale\(\s*([-\d.]+))?/);
        const nx = mt ? tx + num(mt[1], 0) * sc : tx;
        const ns = mt ? sc * num(mt[3], 1) : sc;
        const tag = nameOf(el);
        if (tag === 'circle' || tag === 'ellipse') {
          const r = num(el.getAttribute(tag === 'circle' ? 'r' : 'rx'), 0);
          left = Math.min(left, nx + (num(el.getAttribute('cx'), 0) - r) * ns);
        }
        visit(el, nx, ns);
      });
      visit(it.g, 0, 1);
      return left;
    };
    footerItems.forEach((it) => {
      it.left = iconLeft(it);
      it.textX = num(it.t.getAttribute('x'), 0);
      it.oldW = env.measure.width(it.t.textContent || '', fontOf(it.t));
      it.newW = it.value ? env.measure.width(it.value, fontOf(it.t)) : 0;
    });
    const oldLeft = footerItems[0].left;
    const lastOld = footerItems[footerItems.length - 1];
    const oldRight = lastOld.textX + lastOld.oldW;
    const gap = footerItems.length > 1 ? Math.max(16 * k, footerItems[1].left - (footerItems[0].textX + footerItems[0].oldW)) : 40 * k;
    const centred = Math.abs((oldLeft + oldRight) / 2 - W / 2) < W * 0.06;
    const shown = footerItems.filter((it) => it.value);
    const total = shown.reduce((s, it) => s + (it.textX - it.left) + it.newW, 0) + gap * Math.max(0, shown.length - 1);
    let x = centred ? W / 2 - total / 2 : oldLeft;
    footerItems.forEach((it) => {
      if (!it.value) { hide(it.g); return; }
      while (it.t.firstChild) it.t.removeChild(it.t.firstChild);
      it.t.appendChild(doc.createTextNode(it.value));
      const dx = x - it.left;
      it.g.setAttribute('transform', `translate(${fmt(dx)} 0) ${it.g.getAttribute('transform') || ''}`.trim());
      x += (it.textX - it.left) + it.newW + gap;
    });
    const footer = ids.get('footer');
    if (!shown.length && footer) hide(footer);
    if (T.footerColor) {
      const scope = footer || footerItems[0].g.parentNode;
      walk(scope, (el) => {
        const tag = nameOf(el);
        if (tag === 'text' || tag === 'tspan') { paint(el, 'fill', T.footerColor); return; }
        const stroke = el.getAttribute('stroke');
        const fill = el.getAttribute('fill');
        if (stroke && stroke !== 'none') paint(el, 'stroke', T.footerColor);
        if (fill && fill !== 'none' && !/url\(/.test(fill)) paint(el, 'fill', T.footerColor);
      });
      if (footer && footer.getAttribute('fill')) paint(footer, 'fill', T.footerColor);
    }
  }

  let svg = new XMLSerializer().serializeToString(doc);
  svg = svg.replace('pe-fonts-here', env.fontCss || '');
  tokens.forEach((value, token) => { svg = svg.split(token).join(value); });
  return {
    svg,
    layout: {
      words,
      overflow: Boolean(HL?.overflow || ST?.overflow),
      headlineSize: HL ? Math.round(HL.size) : null,
      subtextSize: ST ? Math.round(ST.size) : null,
      logoBox,
    },
  };
}

// The template as it is, with the fonts - for its thumbnail.
export function rawTemplateSvg(tpl, fontCss) {
  const doc = tpl.doc.cloneNode(true);
  const root = doc.documentElement;
  root.setAttribute('width', fmt(tpl.info.width));
  root.setAttribute('height', fmt(tpl.info.height));
  const style = make(doc, 'style');
  style.appendChild(doc.createTextNode('pe-fonts-here'));
  root.insertBefore(style, root.firstChild);
  return new XMLSerializer().serializeToString(doc).replace('pe-fonts-here', fontCss || '');
}

// ---- Drawing ----

const isSafari = () => typeof navigator !== 'undefined' && /apple/i.test(navigator.vendor || '') && !/chrome|crios|android/i.test(navigator.userAgent);

// An SVG drawn as a picture (no scripts, no outside requests) onto a canvas.
export async function rasterize(svg, width, height, canvas = document.createElement('canvas')) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // Safari applies an SVG picture's embedded fonts a moment after it loads.
    if (isSafari()) await new Promise((r) => setTimeout(r, 60));
    const w = Math.round(width);
    const h = Math.round(height);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The poster could not be made into a file.'))), type, quality);
  } catch (err) {
    reject(err);
  }
});

// How bright a part of a drawn poster is (0 dark - 1 bright). box is in
// poster units; the canvas may be smaller than the poster.
export function averageLuminance(canvas, box, W) {
  const s = canvas.width / W;
  const x = Math.max(0, Math.floor(box.x * s));
  const y = Math.max(0, Math.floor(box.y * s));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.w * s)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.h * s)));
  const d = canvas.getContext('2d').getImageData(x, y, w, h).data;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    count += 1;
  }
  return count ? sum / count : 0.5;
}
