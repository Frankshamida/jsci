// Older poster templates, brought up to the template contract when they are
// imported. BROWSER ONLY (it measures text in the loaded fonts).
//
// The designer's first templates (the Gold, Joyful and Elegant Dark poster
// families) mark their parts differently from the contract in
// lib/posterSvgSanitize.js:
//
//   Photo-Landscape-REPLACE-ME / -Portrait- / -Hero-   a rect filled with a
//                                         sample photo  -> <image id="photo">
//   BG-Photo-REPLACE-ME, Photo-Backdrop-REPLACE-ME   blurred copies of it
//                                                     -> data-photo="background"
//   Headline-Line-1..n (Gold, Joyful), or Headline-1-1, Headline-Gold-1-2 ...
//   (Elegant Dark: one text per piece of a line)       -> <text id="headline">
//   Subtext, Subtext-1..n                              -> <text id="subtext">
//   Church-Logo (an image)                             -> <g id="brand-logo">
//   Photo-Credit, Footer (Footer-Web, Footer-FB), BG, BG-Overlay
//
// The converter reads where everything was, then rewrites those parts with
// the contract's ids and data- attributes, so the editor can flow new words
// into the same places. What it cannot fill (the sample "summary" lines) is
// taken out rather than left to print on every poster.

import {
  SVG_NS, boxOf, canvasSize, elements, indexIds, inherited, nameOf, styleProp, walk,
} from '@/lib/posterSvgSanitize';

const APP_FONTS = /font-family\s*:\s*['"]?(Outfit|Poppins|Playfair Display)['"]?/i;
const num = (v, fallback = null) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
const fmt = (n) => String(Math.round(n * 100) / 100);

// Does this look like one of the older templates?
export function isLegacyTemplate(doc) {
  const ids = indexIds(doc.documentElement);
  return !ids.has('photo') && [...ids.keys()].some((id) => /^Photo-.*REPLACE-ME$/i.test(id));
}

function make(doc, tag, attrs = {}) {
  const el = doc.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') el.setAttribute(k, typeof v === 'number' ? fmt(v) : String(v)); });
  return el;
}

const fillOf = (el) => styleProp(el, 'fill') || el.getAttribute('fill') || '';
const goldRef = (fill) => { const m = String(fill).match(/url\(\s*['"]?#([^'")\s]+)/); return m ? m[1] : null; };
const plainText = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim();

// The box a path's points span (M L H V C S Q T Z, absolute or relative;
// curve control points count, which is close enough here).
function pathBox(d) {
  const tokens = String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const xs = [];
  const ys = [];
  let cx = 0;
  let cy = 0;
  let cmd = 'M';
  let i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) { cmd = tokens[i]; i += 1; if (/z/i.test(cmd)) continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = (x, y) => { xs.push(x); ys.push(y); };
    if (C === 'H') { cx = (rel ? cx : 0) + next(); pt(cx, cy); } else if (C === 'V') { cy = (rel ? cy : 0) + next(); pt(cx, cy); } else {
      const count = { M: 1, L: 1, T: 1, S: 2, Q: 2, C: 3, A: 0 }[C];
      if (count === undefined || count === 0) { i += C === 'A' ? 7 : 1; continue; }
      const bx = cx;
      const by = cy;
      for (let j = 0; j < count; j += 1) {
        const x = (rel ? bx : 0) + next();
        const y = (rel ? by : 0) + next();
        pt(x, y);
        if (j === count - 1) { cx = x; cy = y; }
      }
    }
  }
  if (!xs.length) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// Where a shape is (for the decorations that follow the text).
function topOf(el, W, H) {
  if (nameOf(el) === 'path') return pathBox(el.getAttribute('d'));
  return boxOf(el, W, H);
}

// Text pieces grouped into lines (by baseline), each with its measured extent.
function linesOf(pieces, measure) {
  const segs = pieces.map((el) => {
    const font = {
      family: inherited(el, 'font-family') || 'sans-serif',
      weight: inherited(el, 'font-weight') || '400',
      size: num(inherited(el, 'font-size'), 16),
    };
    const tspan = elements(el).find((c) => nameOf(c) === 'tspan');
    const y = num(el.getAttribute('y'), num(tspan?.getAttribute('y'), 0));
    const x = num(el.getAttribute('x'), num(tspan?.getAttribute('x'), 0));
    const text = plainText(el);
    const ls = num(inherited(el, 'letter-spacing'), 0);
    const w = measure.width(text, font) + ls * [...text].length;
    // Gold pieces: the text's own fill, or the fill of its tspans.
    const fills = [fillOf(el), ...elements(el).filter((c) => nameOf(c) === 'tspan').map(fillOf)].filter(Boolean);
    return { el, font, x, y, w, text, fills };
  });
  const lines = [];
  segs.sort((a, b) => a.y - b.y || a.x - b.x).forEach((s) => {
    const line = lines.find((l) => Math.abs(l.y - s.y) < 2);
    if (line) line.segs.push(s); else lines.push({ y: s.y, segs: [s] });
  });
  lines.forEach((l) => {
    l.left = Math.min(...l.segs.map((s) => s.x));
    l.right = Math.max(...l.segs.map((s) => s.x + s.w));
    l.center = (l.left + l.right) / 2;
    l.width = l.right - l.left;
  });
  return { segs, lines };
}

// One <text> in place of many: anchored and measured like the original.
function textFrom(doc, id, info, W, k, { optional = false, minScale = 0.65, extraLines = 0 } = {}) {
  const { segs, lines } = info;
  const first = segs[0];
  const size = Math.max(...segs.map((s) => s.font.size));
  const centred = lines.every((l) => Math.abs(l.center - W / 2) < W * 0.035);
  const sameLeft = lines.every((l) => Math.abs(l.left - lines[0].left) < 3);
  const anchor = centred ? 'middle' : sameLeft ? 'start' : 'middle';
  const x = anchor === 'middle' ? (centred ? W / 2 : lines.reduce((a, l) => a + l.center, 0) / lines.length) : lines[0].left;
  const widest = Math.max(...lines.map((l) => l.width));
  const minLeft = Math.min(...lines.map((l) => l.left));
  const room = anchor === 'middle' ? W - 2 * Math.max(40 * k, minLeft - 4) : W - x - 70 * k;
  const lh = lines.length > 1 ? (lines[lines.length - 1].y - lines[0].y) / (lines.length - 1) : size * 1.25;
  const letters = segs.map((s) => s.text).join(' ').replace(/[^A-Za-z]/g, '');
  const upper = letters.length > 0 && letters === letters.toUpperCase();
  const allFills = segs.flatMap((s) => s.fills);
  const gold = allFills.map(goldRef).find(Boolean) || null;
  const plain = allFills.find((f) => f && !/url\(/.test(f)) || '#FFFFFF';
  const filter = segs.map((s) => s.el.getAttribute('filter')).find(Boolean)
    || (segs[0].el.parentNode && segs[0].el.parentNode.getAttribute && segs[0].el.parentNode.getAttribute('filter')) || null;
  const t = make(doc, 'text', {
    id,
    x,
    'text-anchor': anchor,
    'font-family': first.font.family,
    'font-weight': first.font.weight,
    'font-size': size,
    fill: plain,
    'fill-opacity': first.el.getAttribute('fill-opacity'),
    'letter-spacing': inherited(first.el, 'letter-spacing'),
    filter,
    'data-max-lines': Math.max(1, lines.length + extraLines),
    'data-line-height': lh,
    'data-max-width': Math.max(widest + 2, room),
    'data-min-size': Math.round(size * minScale),
    'data-transform': upper ? 'uppercase' : null,
    'data-highlight-gradient': gold,
    'data-optional': optional ? 'true' : null,
  });
  lines.forEach((l, i) => {
    const tsp = make(doc, 'tspan', { id: `${id}-line-${i + 1}`, x, y: l.y });
    tsp.appendChild(doc.createTextNode(l.segs.map((s) => s.text).join(' ')));
    t.appendChild(tsp);
  });
  return { el: t, anchor, size, lines };
}

// Convert in place. Returns notes for the import summary.
export function convertLegacyTemplate(doc, measure) {
  const root = doc.documentElement;
  const { width: W, height: H } = canvasSize(root);
  const k = W / 1080;
  const notes = [];
  let ids = indexIds(root);
  let n = 0;
  const uid = (name) => { n += 1; return `lg-${name}-${n}`; };
  let defs = elements(root).find((e) => nameOf(e) === 'defs');
  if (!defs) { defs = make(doc, 'defs'); root.insertBefore(defs, root.firstChild); }

  // The app brings full Outfit, Poppins and Playfair Display; the small
  // subsets embedded in these files would leave letters missing.
  walk(root, (el) => {
    if (nameOf(el) !== 'style') return;
    const css = el.textContent || '';
    const cleaned = css.replace(/@font-face\s*\{[^}]*\}/gi, (rule) => (APP_FONTS.test(rule) ? '' : rule));
    if (cleaned !== css) {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(doc.createTextNode(cleaned));
    }
  });

  // ---- The photo and its copies ----
  const background = ids.get('BG');
  const dark = (() => {
    const g = background && ids.get(goldRef(fillOf(background)));
    const stop = g && elements(g).find((c) => nameOf(c) === 'stop');
    const c = stop ? (styleProp(stop, 'stop-color') || stop.getAttribute('stop-color') || '') : '';
    const m = c.match(/^#([0-9a-f]{6})$/i);
    if (!m) return false;
    const v = parseInt(m[1], 16);
    return (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255 < 0.35;
  })();
  let mainDone = false;
  [...ids.entries()].filter(([id]) => /REPLACE-ME$/i.test(id)).forEach(([id, el]) => {
    const box = boxOf(el, W, H);
    if (!box) return;
    const isMain = !mainDone && /^Photo-(Landscape|Portrait|Hero|Square|Main)/i.test(id);
    const rx = num(el.getAttribute('rx'), 0);
    const img = make(doc, 'image', {
      x: box.x, y: box.y, width: box.w, height: box.h, preserveAspectRatio: 'xMidYMid slice', href: '',
      opacity: el.getAttribute('opacity'), filter: el.getAttribute('filter'), mask: el.getAttribute('mask'), transform: el.getAttribute('transform'),
    });
    let clipId = null;
    if (rx > 0) {
      clipId = uid('clip');
      const clip = make(doc, 'clipPath', { id: clipId });
      clip.appendChild(make(doc, 'rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx }));
      defs.appendChild(clip);
    }
    let node = img;
    if (isMain) {
      mainDone = true;
      img.setAttribute('id', 'photo');
      img.setAttribute('data-photo', 'main');
      node = make(doc, 'g', { id: 'layer-photo', 'clip-path': clipId ? `url(#${clipId})` : null });
      node.appendChild(make(doc, 'rect', { id: 'photo-placeholder', x: box.x, y: box.y, width: box.w, height: box.h, rx: rx || null, fill: dark ? '#2E271D' : '#EAD5A6' }));
      node.appendChild(img);
    } else {
      img.setAttribute('data-photo', 'background');
      if (clipId) { node = make(doc, 'g', { 'clip-path': `url(#${clipId})` }); node.appendChild(img); }
    }
    el.parentNode.replaceChild(node, el);
  });
  if (mainDone) notes.push('photo');

  // Sample photos nothing points at any more.
  const used = new Set();
  walk(root, (el) => {
    for (let i = 0; i < el.attributes.length; i += 1) {
      String(el.attributes[i].value || '').replace(/#([\w.:-]+)/g, (m, id) => { used.add(id); return m; });
    }
    if (nameOf(el) === 'style') String(el.textContent || '').replace(/#([\w.:-]+)/g, (m, id) => { used.add(id); return m; });
  });
  elements(defs).filter((e) => nameOf(e) === 'pattern' && e.getAttribute('id') && !used.has(e.getAttribute('id'))).forEach((e) => defs.removeChild(e));
  ids = indexIds(root);

  // ---- Background and gradients ----
  if (background && !ids.has('layer-background')) background.setAttribute('id', 'layer-background');
  const overlay = ids.get('BG-Overlay');
  if (overlay && !ids.has('layer-overlay')) overlay.setAttribute('id', 'layer-overlay');

  // ---- Logo ----
  const logo = [...ids.entries()].find(([id, el]) => /logo/i.test(id) && nameOf(el) === 'image')?.[1];
  let logoBox = null;
  if (logo && !ids.has('brand-logo')) {
    logoBox = boxOf(logo, W, H);
    const g = make(doc, 'g', { id: 'brand-logo', filter: logo.getAttribute('filter') });
    logo.removeAttribute('filter');
    logo.removeAttribute('id');
    logo.parentNode.replaceChild(g, logo);
    g.appendChild(logo);
    notes.push('logo');
    // The soft light behind it: an ellipse with a radial gradient around the logo.
    const glow = [];
    walk(root, (el) => {
      if (nameOf(el) !== 'ellipse' || el.getAttribute('id')) return;
      const ref = ids.get(goldRef(fillOf(el)));
      const cy = num(el.getAttribute('cy'), 0);
      if (ref && nameOf(ref) === 'radialGradient' && logoBox && cy <= logoBox.y + logoBox.h + 80) glow.push(el);
    });
    if (glow[0]) glow[0].setAttribute('id', 'layer-logo-glow');
  }

  // ---- Headline and subtext ----
  const headPieces = [];
  const subPieces = [];
  const summary = [];
  walk(root, (el) => {
    if (nameOf(el) !== 'text') return;
    const id = el.getAttribute('id') || '';
    if (/^Headline(-Gold)?-\d+(-\d+)?$|^Headline-Line-\d+$/i.test(id)) headPieces.push(el);
    else if (/^Subtext(-\d+)?$/i.test(id)) subPieces.push(el);
    else if (/^Summary(-\d+)?$/i.test(id)) summary.push(el);
  });
  if (!headPieces.length) return { notes };

  const flowing = headPieces.some((el) => /^Headline-Line-/i.test(el.getAttribute('id')));
  const head = linesOf(headPieces, measure);
  const sub = subPieces.length ? linesOf(subPieces, measure) : null;
  const headline = textFrom(doc, 'headline', head, W, k, { extraLines: flowing ? Math.max(0, 3 - head.lines.length) : 0 });
  const subtext = sub ? textFrom(doc, 'subtext', sub, W, k, { optional: true, minScale: 0.7 }) : null;
  notes.push(`headline (${head.lines.length} line${head.lines.length === 1 ? '' : 's'})`);
  if (subtext) notes.push('subtext');

  const firstY = head.lines[0].y;
  const lastY = head.lines[head.lines.length - 1].y;
  let block;
  if (flowing) {
    // Gold and Joyful: the words sit centred in the band under the photo.
    const top = firstY - headline.size * 0.7;
    const bottom = sub ? sub.lines[sub.lines.length - 1].y : lastY;
    const centre = (top + bottom) / 2;
    block = make(doc, 'g', {
      id: 'text-block',
      'data-anchor': 'middle',
      'data-zone': `${fmt(centre - 130)},${fmt(centre + 130)}`,
      'data-subtext-gap': sub ? sub.lines[0].y - lastY : Math.round(headline.size * 0.7),
    });
  } else {
    // Elegant Dark: the words run down from where the headline starts, and
    // the ornaments below follow them.
    block = make(doc, 'g', { id: 'text-block', 'data-anchor': 'top' });
  }
  // The text block goes where the headline was (inside its group, if any).
  const firstPiece = headPieces[0];
  const wrapper = firstPiece.parentNode && nameOf(firstPiece.parentNode) === 'g' && /^Headline$/i.test(firstPiece.parentNode.getAttribute('id') || '')
    ? firstPiece.parentNode : null;
  const anchorNode = wrapper || firstPiece;
  const container = anchorNode.parentNode;
  container.insertBefore(block, anchorNode);
  block.appendChild(headline.el);
  if (subtext) block.appendChild(subtext.el);
  headPieces.forEach((el) => el.parentNode && el.parentNode.removeChild(el));
  subPieces.forEach((el) => el.parentNode && el.parentNode.removeChild(el));
  if (wrapper && !elements(wrapper).length) wrapper.parentNode.removeChild(wrapper);
  if (summary.length) {
    summary.forEach((el) => el.parentNode.removeChild(el));
    notes.push('the sample summary lines were taken out (they cannot be filled from the article)');
  }

  // ---- Photo credit ----
  ids = indexIds(root);
  const credit = ids.get('Photo-Credit');
  if (credit && !ids.has('photo-credit')) {
    const font = { family: inherited(credit, 'font-family') || 'sans-serif', weight: inherited(credit, 'font-weight') || '400', size: num(inherited(credit, 'font-size'), 16) };
    const x = num(credit.getAttribute('x'), 0);
    const w = measure.width(plainText(credit), font);
    const centre = x + w / 2;
    const anchor = Math.abs(centre - W / 2) < W * 0.04 ? 'middle' : x > W * 0.5 ? 'end' : 'start';
    credit.setAttribute('id', 'photo-credit');
    credit.setAttribute('text-anchor', anchor);
    credit.setAttribute('x', fmt(anchor === 'middle' ? centre : anchor === 'end' ? x + w : x));
    const letters = plainText(credit).replace(/[^A-Za-z]/g, '');
    if (letters && letters === letters.toUpperCase()) credit.setAttribute('data-transform', 'uppercase');
    notes.push('photo credit');
  }

  // ---- Footer: each text with the icon drawn just before it ----
  const footer = ids.get('Footer');
  let footerTop = H;
  if (footer && !ids.has('footer')) {
    footer.setAttribute('id', 'footer');
    const kids = elements(footer);
    const texts = kids.filter((c) => nameOf(c) === 'text');
    const xOf = (el) => {
      const tag = nameOf(el);
      if (tag === 'circle' || tag === 'ellipse') return num(el.getAttribute('cx'), 0);
      return topOf(el, W, H)?.x ?? 0;
    };
    texts.forEach((t, i) => {
      const tid = t.getAttribute('id') || '';
      const role = /web|site|globe/i.test(tid) ? 'footer-website' : /fb|facebook/i.test(tid) ? 'footer-facebook' : i === 0 ? 'footer-website' : 'footer-facebook';
      const tx = num(t.getAttribute('x'), 0);
      const prevX = i > 0 ? num(texts[i - 1].getAttribute('x'), 0) : -Infinity;
      const icons = kids.filter((c) => nameOf(c) !== 'text' && xOf(c) < tx && xOf(c) > prevX);
      const g = make(doc, 'g', { id: role });
      footer.insertBefore(g, icons[0] || t);
      icons.forEach((c) => g.appendChild(c));
      t.removeAttribute('id');
      g.appendChild(t);
    });
    walk(footer, (el) => { const b = topOf(el, W, H); if (b) footerTop = Math.min(footerTop, b.y); });
    notes.push('footer');
  }

  // Elegant Dark: the dividers and ornaments between the headline and the
  // footer move down with the headline when it takes more room.
  if (!flowing) {
    const skip = new Set(['photo-credit', 'footer', 'text-block', 'layer-photo', 'brand-logo']);
    elements(container).forEach((el) => {
      if (skip.has(el.getAttribute('id') || '') || el === block) return;
      const b = topOf(el, W, H);
      if (!b || b.y <= firstY || b.y >= footerTop - 8 || b.h > 140 || b.w > W * 0.9) return;
      el.setAttribute('data-follow-headline', 'true');
    });
  }

  return { notes };
}
