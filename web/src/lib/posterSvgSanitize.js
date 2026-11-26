// Poster templates are SVG files. This file holds the "contract" - the layer
// ids and data- attributes the editor looks for - and makes an uploaded SVG
// safe. It runs in the browser (DOMParser) and on the server
// (@xmldom/xmldom), so it only uses plain DOM methods (no querySelector).
//
// The contract (all optional except the photo and the headline):
//
//   <svg width height viewBox>              the canvas
//   #layer-background  -> grad-background   background gradient
//   <image id="photo" data-photo="main">    the photo (inside #layer-photo,
//                                           which may have a mask)
//   <image data-photo="background">         copies of the same photo
//   #photo-placeholder                      shown until there is a photo
//   #layer-overlay  -> grad-overlay ...     bottom gradient
//   #layer-top-shade                        top gradient (added if missing)
//   #layer-logo-glow                        soft glow behind the logos
//   <g id="brand-logo" data-logo-area="x,y,w,h">  the logo(s)
//   <text id="headline" data-max-lines data-line-height data-max-width
//         data-min-size data-transform>     tspans #headline-line-1..n,
//                                           highlighted words <tspan class="hl">
//   #divider
//   <text id="subtext" data-optional="true" ...>  same attributes
//   #text-block data-anchor="bottom" data-subtext-last-baseline
//         data-divider-no-subtext data-divider-gap data-headline-gap
//         (or data-anchor="middle" data-zone="top,bottom" data-subtext-gap)
//   #photo-credit, #footer-website text, #footer-facebook text
//
// Safety: an uploaded SVG is only ever shown as a picture (an <img> or a
// canvas), where scripts never run. On top of that it is cleaned here, in
// the browser before it is saved and again on the server: only drawing
// elements are kept, every on* attribute and javascript: link goes, links
// may only point inside the file (#id) or be embedded pictures (data:), and
// @import rules are removed (the app supplies the fonts).

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'style', 'switch',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan', 'textPath', 'image',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA',
  'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

const RASTER = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]*$/i;
const LOCAL = /^#[^\s'"()<>]+$/;
const SAFE_CSS_URL = /^(#[^\s'"()<>]+|data:(image\/(png|jpe?g|gif|webp|avif)|font\/[\w.+-]+|application\/(x-)?font[\w.+-]*);base64,[A-Za-z0-9+/=\s]*)$/i;
const CSS_URL = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi;

export const nameOf = (el) => el.localName || el.nodeName;

export function elements(node) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
}

export function walk(node, fn) {
  elements(node).forEach((el) => { fn(el); walk(el, fn); });
}

export function indexIds(root) {
  const ids = new Map();
  const add = (el) => { const id = el.getAttribute('id'); if (id && !ids.has(id)) ids.set(id, el); };
  add(root);
  walk(root, add);
  return ids;
}

// A declaration from a style="" attribute, e.g. styleProp(el, 'fill').
export function styleProp(el, name) {
  const style = el.getAttribute && el.getAttribute('style');
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
}

// An attribute (or style declaration) on the element or the nearest parent.
export function inherited(el, name) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    const v = styleProp(n, name) || n.getAttribute(name);
    if (v) return v;
  }
  return null;
}

// ---- Cleaning ----

export function sanitizeCss(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(CSS_URL, (m, q, target) => (SAFE_CSS_URL.test(target.trim()) ? m : 'none'))
    .replace(/(javascript|vbscript)\s*:/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/-moz-binding|behavior\s*:/gi, '');
}

function cleanAttributes(el, report) {
  const attrs = [];
  for (let i = 0; i < el.attributes.length; i += 1) attrs.push(el.attributes[i]);
  const tag = nameOf(el);
  attrs.forEach((a) => {
    const name = a.name || a.nodeName;
    const lower = name.toLowerCase();
    const value = String(a.value ?? '');
    const drop = () => { el.removeAttribute(name); report.attributes += 1; };
    if (lower.startsWith('on')) { drop(); return; }
    if (lower === 'href' || lower.endsWith(':href')) {
      const v = value.trim();
      if (v === '' || LOCAL.test(v)) return;
      if ((tag === 'image' || tag === 'feImage') && RASTER.test(v)) return;
      drop();
      return;
    }
    if (/^\s*(javascript|vbscript|data)\s*:/i.test(value)) { drop(); return; }
    if (lower === 'style') {
      const clean = sanitizeCss(value);
      if (clean !== value) el.setAttribute(name, clean);
      return;
    }
    if (/url\(/i.test(value)) {
      const clean = value.replace(CSS_URL, (m, q, target) => (LOCAL.test(target.trim()) ? m : 'none'));
      if (clean !== value) el.setAttribute(name, clean);
    }
  });
}

// Clean a parsed SVG in place. Returns what was taken out.
export function sanitizeSvgDocument(doc) {
  const root = doc && doc.documentElement;
  if (!root || nameOf(root) !== 'svg') throw new Error('This file is not an SVG (its outer element must be <svg>).');
  const report = { elements: 0, attributes: 0, imports: 0 };
  cleanAttributes(root, report);
  const visit = (node) => {
    let c = node.firstChild;
    while (c) {
      const next = c.nextSibling;
      if (c.nodeType === 1) {
        const ns = c.namespaceURI;
        if (!ALLOWED.has(nameOf(c)) || (ns && ns !== SVG_NS)) {
          node.removeChild(c);
          report.elements += 1;
        } else {
          cleanAttributes(c, report);
          if (nameOf(c) === 'style') {
            const css = c.textContent || '';
            if (/@import/i.test(css)) report.imports += 1;
            while (c.firstChild) c.removeChild(c.firstChild);
            c.appendChild(doc.createTextNode(sanitizeCss(css)));
          } else {
            visit(c);
          }
        }
      } else if (c.nodeType !== 3 && c.nodeType !== 4) {
        node.removeChild(c); // comments, processing instructions
      }
      c = next;
    }
  };
  visit(root);
  return report;
}

// The text of an SVG file, ready to parse: no DOCTYPE (it can define
// entities), within the size limit.
export function svgSource(text) {
  const s = String(text || '');
  if (s.length > MAX_TEMPLATE_BYTES) throw new Error('That SVG is larger than 8 MB. Make its pictures smaller and try again.');
  if (/<!ENTITY/i.test(s)) throw new Error('That SVG defines entities, which are not allowed.');
  return s.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '').trim();
}

// ---- Reading a template ----

const num = (v, fallback = null) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function canvasSize(root) {
  const vb = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const wAttr = root.getAttribute('width') || '';
  const hAttr = root.getAttribute('height') || '';
  // Everything inside is drawn in viewBox units, so that is the poster's size.
  const width = hasVb ? vb[2] : !/%/.test(wAttr) && num(wAttr) > 0 ? num(wAttr) : null;
  const height = hasVb ? vb[3] : !/%/.test(hAttr) && num(hAttr) > 0 ? num(hAttr) : null;
  return { width, height, viewBox: hasVb ? vb : [0, 0, width || 0, height || 0] };
}

// x, y, width, height of simple shapes (and groups of them), in the units
// they are drawn in. Transforms are not followed.
export function boxOf(el, W, H) {
  const tag = nameOf(el);
  const len = (v, full) => (/%$/.test(String(v || '')) ? (num(v, 0) / 100) * full : num(v, null));
  if (tag === 'rect' || tag === 'image' || tag === 'svg' || tag === 'use') {
    const w = len(el.getAttribute('width'), W);
    const h = len(el.getAttribute('height'), H);
    if (!(w > 0 && h > 0)) return tag === 'image' || tag === 'rect' ? { x: num(el.getAttribute('x'), 0), y: num(el.getAttribute('y'), 0), w: W, h: H } : null;
    return { x: len(el.getAttribute('x'), W) || 0, y: len(el.getAttribute('y'), H) || 0, w, h };
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const rx = num(el.getAttribute(tag === 'circle' ? 'r' : 'rx'), 0);
    const ry = num(el.getAttribute(tag === 'circle' ? 'r' : 'ry'), 0);
    return { x: num(el.getAttribute('cx'), 0) - rx, y: num(el.getAttribute('cy'), 0) - ry, w: rx * 2, h: ry * 2 };
  }
  if (tag === 'g') {
    const boxes = elements(el).map((c) => boxOf(c, W, H)).filter(Boolean);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  }
  return null;
}

const refId = (value) => {
  const m = String(value || '').match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
  return m ? m[1] : null;
};

// The gradient an element is filled with, and the element holding its stops
// (a gradient can borrow another's stops through href).
export function fillGradient(ids, el) {
  if (!el) return null;
  const grad = ids.get(refId(styleProp(el, 'fill') || el.getAttribute('fill')));
  if (!grad || !/Gradient$/.test(nameOf(grad))) return null;
  let stopsEl = grad;
  for (let i = 0; i < 4 && !elements(stopsEl).some((c) => nameOf(c) === 'stop'); i += 1) {
    const href = stopsEl.getAttribute('href') || stopsEl.getAttribute('xlink:href');
    const next = href && ids.get(href.replace(/^#/, ''));
    if (!next) break;
    stopsEl = next;
  }
  return { grad, stops: elements(stopsEl).filter((c) => nameOf(c) === 'stop') };
}

export const stopColor = (stop) => styleProp(stop, 'stop-color') || stop.getAttribute('stop-color') || '#000000';
export const stopOpacity = (stop) => num(styleProp(stop, 'stop-opacity') || stop.getAttribute('stop-opacity'), 1);

// "#abc", "#AABBCC", "white", "rgb(1,2,3)" -> "#AABBCC" where it can.
export function toHex(color, fallback = '#FFFFFF') {
  const c = String(color || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c.slice(1).split('').map((d) => d + d).join('')}`.toUpperCase();
  const named = { white: '#FFFFFF', black: '#000000' };
  if (named[c]) return named[c];
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return fallback;
}

const firstImageHref = (el) => el.getAttribute('href') || el.getAttribute('xlink:href') || '';

// What a template has, where things are, and its own values for every
// control (so the editor can show them and reset to them).
export function analyzeTemplate(doc) {
  const root = doc.documentElement;
  const ids = indexIds(root);
  const { width: W, height: H } = canvasSize(root);
  const photo = ids.get('photo');
  const headline = ids.get('headline');
  const subtext = ids.get('subtext');
  const logo = ids.get('brand-logo');
  const glow = ids.get('layer-logo-glow');
  const overlay = ids.get('layer-overlay');
  const top = ids.get('layer-top-shade');
  const background = ids.get('layer-background');
  const block = ids.get('text-block');

  const copies = [];
  walk(root, (el) => { if (nameOf(el) === 'image' && el.getAttribute('data-photo') && el !== photo) copies.push(el); });

  const textInfo = (el) => (el && nameOf(el) === 'text' ? {
    size: num(el.getAttribute('font-size'), num(inherited(el, 'font-size'), 32)),
    color: toHex(styleProp(el, 'fill') || el.getAttribute('fill') || inherited(el, 'fill'), '#FFFFFF'),
    minSize: num(el.getAttribute('data-min-size'), null),
    maxLines: num(el.getAttribute('data-max-lines'), null),
  } : null);

  // Logos: the template's own pictures, and the area they are laid out in.
  let logoInfo = null;
  if (logo) {
    const images = [];
    walk(logo, (el) => {
      if (nameOf(el) !== 'image') return;
      const b = boxOf(el, W, H);
      if (b) images.push({ href: firstImageHref(el), width: b.w, height: b.h, box: b });
    });
    const declared = String(logo.getAttribute('data-logo-area') || '').split(/[\s,]+/).map(Number);
    let area = declared.length === 4 && declared.every(Number.isFinite) && declared[2] > 0 && declared[3] > 0
      ? { x: declared[0], y: declared[1], w: declared[2], h: declared[3] }
      : boxOf(logo, W, H);
    // Only the logo's own box was given: there is room either side of it for
    // a second and third logo, as wide as 60% of the poster.
    if (area && !(declared.length === 4)) {
      const cx = area.x + area.w / 2;
      const w = Math.min(W * 0.9, Math.max(area.w, W * 0.6));
      area = { x: cx - w / 2, y: area.y, w, h: area.h };
    }
    logoInfo = area ? { area, images, filter: Boolean(logo.getAttribute('filter')) } : null;
  }

  const ovGrad = fillGradient(ids, overlay);
  const bgGrad = fillGradient(ids, background);
  const glowGrad = fillGradient(ids, glow);
  const topGrad = fillGradient(ids, top);
  const hl = textInfo(headline);
  const st = textInfo(subtext);
  const credit = ids.get('photo-credit');
  const footer = ids.get('footer');
  const footerText = footer ? (() => { let t = null; walk(footer, (el) => { if (!t && nameOf(el) === 'text') t = el; }); return t; })() : null;

  return {
    width: W,
    height: H,
    photo: photo && nameOf(photo) === 'image' ? boxOf(photo, W, H) : null,
    placeholder: Boolean(ids.get('photo-placeholder')),
    photoCopies: copies.length,
    background: bgGrad && bgGrad.stops.length ? { top: toHex(stopColor(bgGrad.stops[0])), bottom: toHex(stopColor(bgGrad.stops[bgGrad.stops.length - 1])) } : null,
    overlay: overlay ? {
      height: Math.round((num(overlay.getAttribute('height'), H) / H) * 100),
      color: ovGrad?.stops.length ? toHex(stopColor(ovGrad.stops[ovGrad.stops.length - 1]), '#000000') : '#000000',
    } : null,
    topShade: top ? {
      height: Math.round((num(top.getAttribute('height'), H * 0.3) / H) * 100),
      color: topGrad?.stops.length ? toHex(stopColor(topGrad.stops[0]), '#000000') : '#000000',
    } : null,
    logo: logoInfo,
    logoGlow: glow ? { color: glowGrad?.stops.length ? toHex(stopColor(glowGrad.stops[0])) : '#FFFFFF' } : null,
    headline: hl ? { ...hl, preset: headline.getAttribute('data-highlight-preset') || null } : null,
    subtext: st,
    divider: Boolean(ids.get('divider')),
    textBlock: block ? (block.getAttribute('data-anchor') || 'top') : null,
    credit: credit ? { color: toHex(styleProp(credit, 'fill') || credit.getAttribute('fill') || inherited(credit, 'fill')) } : null,
    footer: footer || ids.get('footer-website') || ids.get('footer-facebook') ? {
      website: Boolean(ids.get('footer-website')),
      facebook: Boolean(ids.get('footer-facebook')),
      color: toHex(footerText ? inherited(footerText, 'fill') : '#FFFFFF'),
    } : null,
  };
}

// What is saved with a template (and shown when it is imported).
export const capabilitiesOf = (info) => ({
  width: info.width,
  height: info.height,
  photo: Boolean(info.photo),
  headline: Boolean(info.headline),
  subtext: Boolean(info.subtext),
  logo: Boolean(info.logo),
  logoGlow: Boolean(info.logoGlow),
  background: Boolean(info.background),
  overlay: Boolean(info.overlay),
  topShade: Boolean(info.topShade),
  divider: info.divider,
  textBlock: info.textBlock,
  credit: Boolean(info.credit),
  footerWebsite: Boolean(info.footer?.website),
  footerFacebook: Boolean(info.footer?.facebook),
  photoCopies: info.photoCopies,
});

// Why a template cannot be used, if it cannot.
export function contractProblems(info) {
  const problems = [];
  if (!(info.width > 0 && info.height > 0)) problems.push('the <svg> has no width and height (or viewBox)');
  else if (info.width > 5000 || info.height > 5000) problems.push('the canvas is larger than 5000 px');
  if (!info.photo) problems.push('there is no <image id="photo"> for the main photo');
  if (!info.headline) problems.push('there is no <text id="headline">');
  return problems;
}
