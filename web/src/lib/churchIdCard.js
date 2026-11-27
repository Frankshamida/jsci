// The church ID card (My Profile > My ID, and the /id/<code> check page).
//
// The card designs are the church's own SVG templates in
// public/user-id-template (ministry / pastor / member, front and back, light
// and dark). fillIdCard below is that folder's fillIdCard.js, unchanged except
// for being a module: it fills the {{fields}} of a template with one person's
// details and the colours for their card and theme.
//
// Pure: safe on the server and in the browser.

export const ID_TEMPLATE_DIR = '/user-id-template';
export const ID_KINDS = ['ministry', 'pastor', 'member'];
export const ID_CARD_TITLE = { ministry: 'Ministry Team ID', pastor: 'Pastor ID', member: 'Church Member ID' };

// A ministry role (lib/userRoles MINISTRY_ROLES key) -> its template colours.
export const ID_MINISTRY_FOR_ROLE = { singer: 'praise-worship', musician: 'praise-worship', dancer: 'dancers', media: 'media', usher: 'ushers' };

// ---------------------------------------------------------------------------
// From public/user-id-template/fillIdCard.js
// ---------------------------------------------------------------------------
export const MINISTRIES = {
  'praise-worship': { ministry_name: 'Praise & Worship', ministry_label: 'PRAISE & WORSHIP', accent: '#C9970F' },
  media: { ministry_name: 'Media', ministry_label: 'MEDIA MINISTRY', accent: '#2B5FD9' },
  ushers: { ministry_name: 'Ushers', ministry_label: 'USHERING MINISTRY', accent: '#1E8A4C' },
  dancers: { ministry_name: 'Dancers', ministry_label: 'DANCE MINISTRY', accent: '#C2407A' },
};

export const THEMES = {
  light: { bg_a: '#FFFFFF', bg_b: '#FAF5E9', ink: '#141B34', muted: '#6B7080', line: '#E8E3D8', brand_sub: '#B8892A', qr_border: '#E6E0D2', silk_opacity: 0.16, line_opacity: 0.22, mark_opacity: 0.07 },
  dark: { bg_a: '#18203D', bg_b: '#0B1024', ink: '#F5F1E6', muted: '#9DA6C4', line: '#2A3357', brand_sub: '#E9B23A', qr_border: '#FFFFFF', silk_opacity: 0.22, line_opacity: 0.28, mark_opacity: 0.09 },
};

const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const IMAGE_FIELDS = ['photo', 'qr_code', 'signature_holder', 'signature_officer'];

const rgb = (h0) => { const h = h0.replace('#', ''); const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (a) => `#${a.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return hex(x.map((c, i) => c + (y[i] - c) * t)); };
const lum = (h) => { const [r, g, b] = rgb(h); return 0.299 * r + 0.587 * g + 0.114 * b; };
const inkFor = (h) => (lum(h) > 150 ? '#141B34' : '#FFFFFF');
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, max = 40, lines = 4) {
  const out = [''];
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const cur = out[out.length - 1];
    if ((`${cur} ${word}`).trim().length <= max) out[out.length - 1] = (`${cur} ${word}`).trim();
    else if (out.length < lines) out.push(word);
    else { out[out.length - 1] = `${cur}…`; break; }
  }
  while (out.length < lines) out.push('');
  return out;
}

// Colours for each card type, in light or dark mode.
function cardColours(card, dark, d) {
  if (card === 'pastor') {
    const gold = '#E9B23A';
    return {
      accent: gold, accent_text: dark ? gold : '#A8770C',
      accent_soft: dark ? mix(d.bg_a, gold, 0.18) : '#F3E7C6',
      panel_a: '#22305F', panel_b: '#0B1130', panel_ink: gold, ring: gold,
      pill_bg: gold, pill_ink: '#0D1330', panel_line: gold, sub_color: dark ? gold : '#A8770C',
      ...(dark ? {} : { bg_a: '#FFFDF7', bg_b: '#F6ECD3' }),
    };
  }
  if (card === 'member') {
    const gold = '#C99419';
    return {
      accent: gold, accent_text: dark ? '#E9B23A' : gold,
      accent_soft: dark ? mix(d.bg_a, gold, 0.18) : '#F7EDD2',
      panel_a: '#F2C75E', panel_b: '#B8860B', panel_ink: '#141B34', ring: '#FFFFFF',
      panel_line: '#FFFFFF',
      pill_bg: dark ? '#E9B23A' : '#141B34', pill_ink: dark ? '#141B34' : '#F2B632',
      sub_color: d.muted,
    };
  }
  const a = d.accent || '#C9970F';
  return {
    accent: a, accent_text: dark ? mix(a, '#FFFFFF', 0.35) : a,
    accent_soft: dark ? mix(d.bg_a, a, 0.22) : mix(a, '#FFFFFF', 0.86),
    panel_a: mix(a, '#FFFFFF', 0.12), panel_b: mix(a, '#000000', 0.28), panel_ink: inkFor(a), ring: '#FFFFFF',
    panel_line: '#FFFFFF',
    pill_bg: dark ? mix(a, '#FFFFFF', 0.08) : a, pill_ink: inkFor(a), sub_color: d.muted,
  };
}

export function fillIdCard(template, input = {}) {
  const card = (template.match(/data-card="(\w+)"/) || [])[1] || 'ministry';
  const dark = input.theme === 'dark';
  const data = { ...THEMES[dark ? 'dark' : 'light'] };

  const preset = MINISTRIES[input.ministry] || {};
  Object.assign(data, preset, input);
  Object.assign(data, cardColours(card, dark, data), input.overrides || {});

  const len = String(data.full_name || '').length;
  data.name_size = input.name_size || (len <= 17 ? 54 : Math.max(32, Math.floor((54 * 17) / len)));

  if (data.life_verse != null) wrap(`“${data.life_verse}”`, 40, 4).forEach((l, i) => { data[`life_verse_${i + 1}`] = l; });
  for (const f of IMAGE_FIELDS) if (!data[f]) data[f] = BLANK;

  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (data[k] == null ? '' : escapeXml(data[k])));
}
// ---------------------------------------------------------------------------

/**
 * Two cards on one page share element ids ("bg", "card", "emGold"…), so the
 * second would borrow the first one's gradients. Prefix every id and the
 * references to it.
 */
export function scopeSvgIds(svg, prefix) {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  let out = svg;
  ids.forEach((id) => {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`id="${e}"`, 'g'), `id="${prefix}-${id}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, 'g'), `url(#${prefix}-${id})`)
      .replace(new RegExp(`href="#${e}"`, 'g'), `href="#${prefix}-${id}"`);
  });
  return out;
}

/** "Nov 2028" / "Dec 1, 2026" in Manila time ('' when there is no date). */
export function idDate(value, style = 'long') {
  if (!value) return '';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', style === 'month'
    ? { timeZone: 'Asia/Manila', month: 'short', year: 'numeric' }
    : { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
}

/** An emergency contact number as typed: digits, spaces, +, - and brackets. */
export const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
