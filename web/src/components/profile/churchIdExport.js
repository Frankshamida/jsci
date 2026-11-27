'use client';

// The church ID in the browser: its templates, its QR code, and saving or
// printing it (components/profile/MyIdCard.jsx). The designs are the SVG
// templates in public/user-id-template; lib/churchIdCard fills them.

import { ID_TEMPLATE_DIR, fillIdCard, scopeSvgIds } from '@/lib/churchIdCard';

const templates = new Map(); // 'ministry-front' -> Promise<string>

export function loadIdTemplate(kind, side) {
  const k = `${kind}-${side}`;
  if (!templates.has(k)) {
    templates.set(k, fetch(`${ID_TEMPLATE_DIR}/${kind}-id-${side}.svg`).then((r) => {
      if (!r.ok) throw new Error('The ID design could not be loaded.');
      return r.text();
    }).catch((e) => { templates.delete(k); throw e; }));
  }
  return templates.get(k);
}

const qrs = new Map();
/** A QR code as a PNG data URL (the `qrcode` package, as the template's filler uses). */
export function qrDataUrl(value) {
  if (!value) return Promise.resolve('');
  if (!qrs.has(value)) {
    qrs.set(value, import('qrcode').then((m) => (m.default || m).toDataURL(String(value), {
      margin: 0, width: 600, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' },
    })));
  }
  return qrs.get(value);
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An image URL as a data URL, so a saved or printed card keeps its photo ('' if it cannot be read). */
export async function imageDataUrl(url) {
  if (!url || url.startsWith('data:')) return url || '';
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return '';
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${base64(await res.arrayBuffer())}`;
  } catch {
    return '';
  }
}

// The app's Outfit font (self-hosted by next/font) as @font-face rules with the
// font inside, for a card drawn as an image, where page fonts do not reach.
let fontCss = null;
function outfitFontCss() {
  if (fontCss) return fontCss;
  fontCss = (async () => {
    const faces = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // another site's sheet
      for (const rule of Array.from(rules || [])) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family');
        if (!/outfit/i.test(family) || /fallback/i.test(family)) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
        if (!m) continue;
        faces.push({ url: new URL(m[1], sheet.href || window.location.href).href, weight: rule.style.getPropertyValue('font-weight') || '100 900', range: rule.style.getPropertyValue('unicode-range') });
      }
    }
    const css = await Promise.all(faces.map(async (f) => {
      try {
        const res = await fetch(f.url);
        if (!res.ok) return '';
        return `@font-face{font-family:'Outfit';src:url(data:font/woff2;base64,${base64(await res.arrayBuffer())}) format('woff2');font-weight:${f.weight};font-style:normal;${f.range ? `unicode-range:${f.range};` : ''}}`;
      } catch { return ''; }
    }));
    return css.join('');
  })();
  return fontCss;
}

/** Both sides, light design, with photo, QR and font inside: ready to save or print. */
export async function exportIdSvgs(kind, fill) {
  const [front, back, photo, qr, font] = await Promise.all([
    loadIdTemplate(kind, 'front'), loadIdTemplate(kind, 'back'),
    imageDataUrl(fill.photo), fill.qr_code ? Promise.resolve(fill.qr_code) : qrDataUrl(fill.qr_value), outfitFontCss(),
  ]);
  const data = { ...fill, theme: 'light', photo, qr_code: qr };
  const withFont = (svg) => (font ? svg.replace(/<svg([^>]*)>/, `<svg$1><style>${font}</style>`) : svg);
  return { front: withFont(fillIdCard(front, data)), back: withFont(fillIdCard(back, data)) };
}

function drawSvg(svg, width, height) {
  return new Promise((resolve, reject) => {
    const sized = svg.replace(/width="85\.6mm" height="54mm"/, `width="${width}" height="${height}"`);
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The ID could not be drawn.')); };
    img.src = url;
  });
}

/** Saves the front over the back as one PNG, at 1.5x print resolution (about 450 dpi). */
export async function downloadIdPng(kind, fill, fileName) {
  const { front, back } = await exportIdSvgs(kind, fill);
  const W = 1517;
  const H = 957;
  const GAP = 45;
  const [a, b] = await Promise.all([drawSvg(front, W, H), drawSvg(back, W, H)]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H * 2 + GAP;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(a, 0, 0, W, H);
  ctx.drawImage(b, 0, H + GAP, W, H);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The ID could not be saved.');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

/**
 * Prints both sides at real card size (85.6 x 54 mm). The window is opened
 * at once, inside the click, so a popup blocker lets it through; the card is
 * written into it when ready.
 */
export async function printId(kind, fill, title) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Please allow pop-ups for SanctuaryHub to print your ID.');
  win.document.write('<!doctype html><title>Preparing your ID…</title><p style="font:16px system-ui;padding:24px">Preparing your ID…</p>');
  try {
    const { front, back } = await exportIdSvgs(kind, fill);
    const safeTitle = String(title || 'Church ID').replace(/[<>&"]/g, '');
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>@page{size:A4;margin:15mm}html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card{width:85.6mm;height:54mm;margin:0 0 8mm}.card svg{width:85.6mm;height:54mm;display:block}
p{font:12px system-ui;color:#555;margin:0 0 6mm}@media print{p{display:none}}</style></head>
<body><p>Cut along the card edges. Front first, then back.</p>
<div class="card">${scopeSvgIds(front, 'pf')}</div><div class="card">${scopeSvgIds(back, 'pb')}</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);};<\/script></body></html>`);
    win.document.close();
  } catch (e) {
    win.close();
    throw e;
  }
}
