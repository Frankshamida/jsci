// The Midweek Service thumbnails (lib/midweekThumbnails) in the browser.
// BROWSER ONLY.
//
//   outfitReady()        Outfit, loaded once from Google Fonts (the family name
//                        the templates draw in; the site's own copy is under a
//                        Next.js name), and waited for, so titles are measured
//                        with the real font
//   useOutfitReady()     the same as a hook: 0 until ready, then a number that
//                        goes up whenever fonts finish loading, to redraw
//   inlineThumbnail(...) the SVG ready to put in the page: the font import left
//                        out (loaded once instead of once per picture) and the
//                        gradient ids made unique, since the same template can
//                        be on a page several times (poster, list, picker)
//   thumbnailPng(...)    a 1280x720 PNG of a thumbnail, for Facebook

import { useEffect, useState } from 'react';
import { HEIGHT, WIDTH, renderThumbnail } from '@/lib/midweekThumbnails';

const OUTFIT_CSS = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap';
const WEIGHTS = [500, 600, 700, 800];
const FONT_TIMEOUT_MS = 4000;
const IMPORT_STYLE = /<style>@import[^<]*<\/style>/;

let fontsPromise = null;
export function outfitReady() {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (fontsPromise) return fontsPromise;
  fontsPromise = new Promise((resolve) => {
    const done = () => resolve(true);
    const timer = setTimeout(done, FONT_TIMEOUT_MS); // draw anyway; redrawn when it arrives
    let link = document.getElementById('outfit-thumbnails');
    const loadFaces = () => Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 100px Outfit`)))
      .catch(() => {})
      .then(() => { clearTimeout(timer); done(); });
    if (link && link.sheet) { loadFaces(); return; }
    if (!link) {
      link = document.createElement('link');
      link.id = 'outfit-thumbnails';
      link.rel = 'stylesheet';
      link.href = OUTFIT_CSS;
      document.head.appendChild(link);
    }
    link.addEventListener('load', loadFaces, { once: true });
    link.addEventListener('error', () => { clearTimeout(timer); done(); }, { once: true });
  });
  return fontsPromise;
}

export function useOutfitReady() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    outfitReady().then(() => { if (alive) setVersion((v) => v || 1); });
    // A font that finishes later (a weight, a fallback swapped out): redraw.
    const bump = () => { if (alive) setVersion((v) => (v ? v + 1 : v)); };
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => { alive = false; document.fonts?.removeEventListener?.('loadingdone', bump); };
  }, []);
  return version;
}

let seq = 0;
export function inlineThumbnail(template, data, options) {
  const uid = (seq += 1).toString(36);
  let svg = renderThumbnail(template, data, options).replace(IMPORT_STYLE, '');
  const ids = [...new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  for (const id of ids) {
    svg = svg.split(`id="${id}"`).join(`id="${id}-${uid}"`).split(`url(#${id})`).join(`url(#${id}-${uid})`);
  }
  return svg;
}

// ---- PNG ----

// Outfit as @font-face rules with the font files inside them: a picture made
// from an SVG may not load anything from the web, fonts included.
let embeddedCss = null;
function embeddedOutfit() {
  if (!embeddedCss) {
    embeddedCss = (async () => {
      const css = await (await fetch(OUTFIT_CSS)).text();
      const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
      const data = {};
      await Promise.all(urls.map(async (u) => {
        const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        data[u] = `data:font/woff2;base64,${btoa(bin)}`;
      }));
      return css.replace(/url\((https:[^)]+)\)/g, (_, u) => `url(${data[u]})`);
    })().catch((err) => { embeddedCss = null; throw err; });
  }
  return embeddedCss;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// options as for renderThumbnail; for Facebook the template's own play icon
// stays (it is not on our page there).
export async function thumbnailPng(template, data, options = {}) {
  await outfitReady();
  const svg = renderThumbnail(template, data, options).replace(IMPORT_STYLE, `<style>${await embeddedOutfit()}</style>`);
  const img = new Image();
  img.width = WIDTH;
  img.height = HEIGHT;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('The picture could not be drawn.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  try { await img.decode(); } catch { /* drawn below either way */ }
  await nextFrame();
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext('2d').drawImage(img, 0, 0, WIDTH, HEIGHT);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
}
