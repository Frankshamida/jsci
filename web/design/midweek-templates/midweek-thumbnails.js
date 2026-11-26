const OUTFIT_800 = {" ":185,"!":297,"\"":471,"#":673,"$":613,"%":698,"&":701,"'":254,"(":315,")":315,"*":489,"+":571,",":287,"-":463,".":304,"/":376,"0":671,"1":390,"2":576,"3":569,"4":613,"5":568,"6":579,"7":530,"8":569,"9":579,":":300,";":286,"<":571,"=":571,">":571,"?":496,"@":766,"A":742,"B":650,"C":692,"D":761,"E":627,"F":602,"G":791,"H":739,"I":305,"J":550,"K":721,"L":567,"M":866,"N":748,"O":812,"P":640,"Q":819,"R":663,"S":596,"T":649,"U":708,"V":722,"W":1012,"X":724,"Y":694,"Z":617,"[":352,"\\":376,"]":352,"^":474,"_":517,"`":338,"a":603,"b":603,"c":501,"d":603,"e":554,"f":452,"g":588,"h":583,"i":275,"j":288,"k":563,"l":276,"m":879,"n":583,"o":582,"p":603,"q":603,"r":453,"s":471,"t":410,"u":550,"v":550,"w":800,"x":550,"y":541,"z":495,"{":349,"|":308,"}":349,"~":571,"’":266,"‘":266,"“":502,"”":502,"–":576,"—":870,"…":874,"Ñ":748,"ñ":583,"É":627,"é":554,"Á":742,"á":603,"Í":305,"í":276,"Ó":812,"ó":582,"Ú":708,"ú":550};

/* ============================================================
   Midweek Service thumbnail templates — Joyful Sound Church International
   1280×720 SVG. The title is auto-fitted into ONE or TWO lines (never more),
   choosing the line break + font size that fills the title area best.

   Usage:
     import { renderThumbnail, TEMPLATES } from './midweek-thumbnails.js';
     const svg = renderThumbnail('spotlight', {
       title: 'Midweek Service',
       date: '2026-11-25',                 // YYYY-MM-DD
       label: 'Midweek Service',           // optional
       speaker: 'Ptr. Juan Dela Cruz',     // optional
       church: 'Joyful Sound Church International'
     });
   In the browser, call `await document.fonts.ready` (with Outfit loaded) before
   rendering so measuring uses the real font. In Node it uses the built-in
   Outfit width table, so results match.
   ============================================================ */

export const WIDTH = 1280;
export const HEIGHT = 720;
const FONT = "'Outfit','Segoe UI',Arial,sans-serif";
const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&amp;display=swap');";

const C = {
  ink: '#14151F', night: '#0A0A0F', navy: '#1B1D2B',
  gold: '#FFD43B', amber: '#F5B800', deepGold: '#C98F00',
  paper: '#F5F3EE', violet: '#1E1640',
};

/* ---------------- text measuring ---------------- */
let _ctx = null;
function measure(text, size, weight = 800, letterSpacing = 0) {
  let w;
  if (typeof document !== 'undefined') {
    _ctx = _ctx || document.createElement('canvas').getContext('2d');
    _ctx.font = `${weight} ${size}px ${FONT}`;
    w = _ctx.measureText(text).width;
  } else {
    const scale = weight >= 800 ? 1 : weight >= 700 ? 0.985 : 0.95;
    w = 0;
    for (const ch of text) w += (OUTFIT_800[ch] ?? 580) * scale;
    w = (w / 1000) * size;
  }
  return w + Math.max(0, [...text].length - 1) * letterSpacing * size;
}

/**
 * Fit a title into at most two lines inside a box.
 * Tries every possible break point and keeps the one giving the largest,
 * best-balanced type. Falls back to ellipsis only if even minSize overflows.
 */
export function fitTitle(title, o) {
  const { width, height, maxSize = 160, minSize = 44, lineHeight = 1.0,
    weight = 800, uppercase = false, letterSpacing = -0.01, preferTwoLines = true } = o;
  let t = String(title || '').trim().replace(/\s+/g, ' ') || 'Midweek Service';
  if (uppercase) t = t.toUpperCase();
  const words = t.split(' ');
  const w100 = (s) => measure(s, 100, weight, letterSpacing) / 100;

  const candidates = [[t]];
  for (let i = 1; i < words.length; i++)
    candidates.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);

  let best = null;
  for (const lines of candidates) {
    const widths = lines.map(w100);
    const widest = Math.max(...widths);
    const size = Math.min(maxSize, width / widest, height / (lines.length * lineHeight));
    const balance = lines.length === 2 ? Math.min(...widths) / widest : 1;
    const bonus = lines.length === 2 && preferTwoLines ? 1.1 : 1;
    const score = size * bonus * (0.85 + 0.15 * balance);
    if (!best || score > best.score) best = { lines, size, score };
  }

  let { lines, size } = best;
  if (size < minSize) {
    // Very long title: lock to minSize, wrap greedily, ellipsize line 2.
    size = minSize;
    const fits = (s) => w100(s) * size <= width;
    let l1 = '', i = 0;
    while (i < words.length && fits((l1 ? l1 + ' ' : '') + words[i])) l1 += (l1 ? ' ' : '') + words[i++];
    if (!l1) { l1 = words[0]; i = 1; size = Math.min(size, width / w100(l1)); }
    let l2 = words.slice(i).join(' ');
    if (l2 && !fits(l2)) {
      while (l2.length && !fits(l2 + '…')) l2 = l2.slice(0, -1).trimEnd();
      l2 += '…';
    }
    lines = l2 ? [l1, l2] : [l1];
  }
  size = Math.floor(size);
  return { lines, size, lineHeight: size * lineHeight, weight, letterSpacing,
    widths: lines.map((l) => w100(l) * size) };
}

/** SVG <text> for a fitted title. valign: top | middle | bottom (within box). */
function titleSVG(fit, { x, y, height, align = 'start', valign = 'middle', fill, extra = '' }) {
  const block = fit.lines.length * fit.lineHeight;
  const top = valign === 'top' ? y : valign === 'bottom' ? y + height - block : y + (height - block) / 2;
  // Center cap-height (0.71em) inside each line slot.
  const first = top + (fit.lineHeight - fit.size * 0.71) / 2 + fit.size * 0.71;
  const tspans = fit.lines.map((l, i) =>
    `<tspan x="${x}" y="${(first + i * fit.lineHeight).toFixed(1)}">${esc(l)}</tspan>`).join('');
  return `<text font-family="${FONT}" font-weight="${fit.weight}" font-size="${fit.size}" letter-spacing="${(fit.letterSpacing * fit.size).toFixed(2)}" text-anchor="${align}" fill="${fill}" ${extra}>${tspans}</text>`;
}
function titleBottom(fit, box) {
  const block = fit.lines.length * fit.lineHeight;
  const top = box.valign === 'top' ? box.y : box.valign === 'bottom' ? box.y + box.height - block : box.y + (box.height - block) / 2;
  return top + block - (fit.lineHeight - fit.size * 0.71) / 2;
}

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parseDate(d) {
  if (d instanceof Date) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
}
function dateParts(d) {
  const dt = parseDate(d);
  const weekday = DAYS[dt.getDay()], month = MONTHS[dt.getMonth()];
  return { weekday, month, day: dt.getDate(), year: dt.getFullYear(),
    wk3: weekday.slice(0, 3).toUpperCase(), mo3: month.slice(0, 3).toUpperCase(),
    long: `${weekday}, ${month} ${dt.getDate()}, ${dt.getFullYear()}` };
}
function frame(defs, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">
<defs><style>${FONT_IMPORT}</style>${defs}</defs>
${body}
</svg>`;
}
const txt = (x, y, s, size, fill, { weight = 600, anchor = 'start', ls = 0, opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="${weight}" font-size="${size}" letter-spacing="${ls}" text-anchor="${anchor}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
const playIcon = (cx, cy, r, ring, tri) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ring}"/><path d="M${cx - r * 0.28} ${cy - r * 0.42} L${cx + r * 0.46} ${cy} L${cx - r * 0.28} ${cy + r * 0.42} Z" fill="${tri}" stroke="${tri}" stroke-width="${r * 0.08}" stroke-linejoin="round"/>`;

function normalize(data = {}) {
  return {
    title: data.title || 'Midweek Service',
    label: data.label ?? 'Midweek Service',
    speaker: data.speaker || '',
    church: data.church ?? 'Joyful Sound Church International',
    d: dateParts(data.date),
  };
}

/* ================= TEMPLATES ================= */

// 1. SPOTLIGHT — the site's own look: dark stage, gold title, warm halo.
function spotlight(data) {
  const { title, label, speaker, church, d } = normalize(data);
  const box = { x: 88, y: 150, width: 780, height: 330, valign: 'bottom' };
  const fit = fitTitle(title, { width: box.width, height: box.height, maxSize: 150, lineHeight: 0.98 });
  const below = titleBottom(fit, box);
  const defs = `
<linearGradient id="sp-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1D1E2C"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
<radialGradient id="sp-glow" cx="0.78" cy="0.35" r="0.55"><stop offset="0" stop-color="${C.amber}" stop-opacity="0.38"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient>
<linearGradient id="sp-title" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset="1" stop-color="${C.amber}"/></linearGradient>
<linearGradient id="sp-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.35" stop-color="${C.night}" stop-opacity="0.85"/><stop offset="1" stop-color="${C.night}" stop-opacity="0"/></linearGradient>`;
  const rings = [170, 240, 310, 380].map((r, i) =>
    `<circle cx="1010" cy="300" r="${r}" fill="none" stroke="${C.gold}" stroke-opacity="${0.22 - i * 0.045}" stroke-width="${i === 0 ? 3 : 1.5}"/>`).join('');
  const body = `
<rect width="1280" height="720" fill="url(#sp-bg)"/>
<rect width="1280" height="720" fill="url(#sp-glow)"/>
${rings}
<g opacity="0.16" fill="${C.gold}"><rect x="996" y="160" width="28" height="280" rx="6"/><rect x="920" y="230" width="180" height="28" rx="6"/></g>
<rect width="760" height="720" fill="url(#sp-fade)"/>
<rect x="88" y="104" width="56" height="5" rx="2.5" fill="${C.gold}"/>
${txt(160, 112, label.toUpperCase(), 24, C.gold, { weight: 700, ls: 4 })}
${titleSVG(fit, { ...box, fill: 'url(#sp-title)' })}
${txt(88, below + 62, d.long, 34, '#FFFFFF', { weight: 500, opacity: 0.78 })}
${speaker ? txt(88, below + 108, speaker, 28, C.gold, { weight: 600, opacity: 0.9 }) : ''}
<line x1="88" y1="630" x2="1192" y2="630" stroke="#FFFFFF" stroke-opacity="0.12"/>
${txt(88, 676, church, 24, '#FFFFFF', { weight: 600, opacity: 0.65 })}
${playIcon(1160, 666, 26, C.gold, C.ink)}
${txt(1118, 675, 'Watch the service', 24, '#FFFFFF', { weight: 600, anchor: 'end', opacity: 0.8 })}`;
  return frame(defs, body, title);
}

// 2. CALENDAR — gold date block on the left, the title on dark navy.
function calendar(data) {
  const { title, label, speaker, church, d } = normalize(data);
  const box = { x: 500, y: 170, width: 700, height: 300, valign: 'middle' };
  const fit = fitTitle(title, { width: box.width, height: box.height, maxSize: 140, lineHeight: 1.0 });
  const below = titleBottom(fit, box);
  const defs = `
<linearGradient id="ca-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.amber}"/></linearGradient>
<pattern id="ca-lines" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="22" fill="${C.ink}" opacity="0.07"/></pattern>
<linearGradient id="ca-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.navy}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>`;
  const body = `
<rect width="1280" height="720" fill="url(#ca-bg)"/>
<circle cx="1280" cy="0" r="340" fill="${C.gold}" opacity="0.05"/>
<path d="M0 0 H420 L380 720 H0 Z" fill="url(#ca-gold)"/>
<path d="M0 0 H420 L380 720 H0 Z" fill="url(#ca-lines)"/>
${txt(200, 230, d.weekday.toUpperCase(), 40, C.ink, { weight: 700, anchor: 'middle', ls: 6 })}
${txt(200, 430, String(d.day), 220, C.ink, { weight: 800, anchor: 'middle', ls: -6 })}
<rect x="150" y="468" width="100" height="5" rx="2.5" fill="${C.ink}"/>
${txt(200, 530, `${d.month.toUpperCase()} ${d.year}`, 32, C.ink, { weight: 700, anchor: 'middle', ls: 3 })}
${txt(500, 140, label, 30, C.gold, { weight: 600 })}
${titleSVG(fit, { ...box, fill: '#FFFFFF' })}
<rect x="500" y="${(below + 34).toFixed(1)}" width="120" height="8" rx="4" fill="${C.gold}"/>
${speaker ? txt(640, below + 46, speaker, 28, '#FFFFFF', { weight: 500, opacity: 0.8 }) : ''}
${txt(500, 664, church, 24, '#FFFFFF', { weight: 600, opacity: 0.55 })}
${playIcon(1172, 654, 34, C.gold, C.ink)}`;
  return frame(defs, body, title);
}

// 3. SANCTUARY LIGHT — cinematic beams from above, centered uppercase title.
function sanctuary(data) {
  const { title, label, speaker, church, d } = normalize(data);
  const box = { x: 640, y: 220, width: 1020, height: 270, valign: 'middle' };
  const fit = fitTitle(title, { width: box.width, height: box.height, maxSize: 132, lineHeight: 1.02, uppercase: true, letterSpacing: 0.01 });
  const below = titleBottom(fit, box);
  const beams = [[-40, 0.20], [-18, 0.14], [0, 0.26], [18, 0.14], [40, 0.20]].map(([a, o]) =>
    `<path d="M640 -60 L590 760 L690 760 Z" fill="url(#sa-beam)" opacity="${o}" transform="rotate(${a} 640 -60)"/>`).join('');
  const corner = (x, y, sx, sy) => `<path d="M${x} ${y + sy * 60} V${y} H${x + sx * 60}" fill="none" stroke="${C.gold}" stroke-width="4"/>`;
  const defs = `
<radialGradient id="sa-bg" cx="0.5" cy="0" r="1"><stop offset="0" stop-color="#2A2416"/><stop offset="0.55" stop-color="#12121A"/><stop offset="1" stop-color="#050507"/></radialGradient>
<linearGradient id="sa-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
<filter id="sa-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
<linearGradient id="sa-title" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F3E3B0"/></linearGradient>`;
  const body = `
<rect width="1280" height="720" fill="url(#sa-bg)"/>
<g filter="url(#sa-blur)">${beams}</g>
<rect x="36" y="36" width="1208" height="648" fill="none" stroke="${C.gold}" stroke-opacity="0.25" stroke-width="1.5"/>
${corner(36, 36, 1, 1)}${corner(1244, 36, -1, 1)}${corner(36, 684, 1, -1)}${corner(1244, 684, -1, -1)}
<line x1="470" y1="170" x2="540" y2="170" stroke="${C.gold}" stroke-width="2"/><line x1="740" y1="170" x2="810" y2="170" stroke="${C.gold}" stroke-width="2"/>
${txt(640, 179, label, 28, C.gold, { weight: 600, anchor: 'middle', ls: 1 })}
${titleSVG(fit, { ...box, align: 'middle', fill: 'url(#sa-title)' })}
${txt(640, below + 66, d.long, 32, C.gold, { weight: 500, anchor: 'middle' })}
${speaker ? txt(640, below + 110, speaker, 26, '#FFFFFF', { weight: 500, anchor: 'middle', opacity: 0.75 }) : ''}
${txt(640, 646, church.toUpperCase(), 20, '#FFFFFF', { weight: 600, anchor: 'middle', ls: 5, opacity: 0.55 })}`;
  return frame(defs, body, title);
}

// 4. BULLETIN — warm paper, navy type, the weekday as a giant watermark.
function bulletin(data) {
  const { title, label, speaker, church, d } = normalize(data);
  const box = { x: 88, y: 180, width: 860, height: 300, valign: 'bottom' };
  const fit = fitTitle(title, { width: box.width, height: box.height, maxSize: 150, lineHeight: 0.98 });
  const below = titleBottom(fit, box);
  const defs = `
<linearGradient id="bu-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.amber}"/></linearGradient>`;
  const body = `
<rect width="1280" height="720" fill="${C.paper}"/>
<circle cx="1190" cy="720" r="300" fill="url(#bu-gold)"/>
<circle cx="1190" cy="720" r="360" fill="none" stroke="${C.amber}" stroke-width="2" opacity="0.5"/>
<text x="-12" y="700" font-family="${FONT}" font-weight="800" font-size="250" letter-spacing="-6" fill="none" stroke="${C.ink}" stroke-opacity="0.07" stroke-width="3">${esc(d.weekday.toUpperCase())}</text>
<rect x="88" y="84" width="${Math.round(measure(label, 24, 700) + 48)}" height="48" rx="24" fill="${C.ink}"/>
${txt(112, 116, label, 24, C.gold, { weight: 700 })}
${txt(1192, 106, d.mo3, 26, C.ink, { weight: 700, anchor: 'end', ls: 4, opacity: 0.6 })}
${txt(1192, 170, String(d.day), 72, C.ink, { weight: 800, anchor: 'end' })}
${titleSVG(fit, { ...box, fill: C.ink })}
<rect x="88" y="${(below + 30).toFixed(1)}" width="140" height="12" rx="6" fill="${C.amber}"/>
${txt(88, below + 96, speaker ? `${d.long}  |  ${speaker}` : d.long, 30, C.ink, { weight: 500, opacity: 0.7 })}
${txt(88, 664, church, 24, C.ink, { weight: 700, opacity: 0.8 })}
${playIcon(1140, 600, 46, C.ink, C.gold)}`;
  return frame(defs, body, title);
}

// 5. JOYFUL SOUND — violet night with a golden sound wave (the church's name, drawn).
function joyfulSound(data) {
  const { title, label, speaker, church, d } = normalize(data);
  const box = { x: 640, y: 150, width: 1040, height: 280, valign: 'middle' };
  const fit = fitTitle(title, { width: box.width, height: box.height, maxSize: 140, lineHeight: 1.0 });
  const below = titleBottom(fit, box);
  const n = 72, gap = 1180 / n;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.sin(Math.PI * t);
    const h = 10 + env * (40 + 70 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21 + 1)));
    const x = 50 + i * gap;
    bars += `<rect x="${x.toFixed(1)}" y="${(620 - h / 2).toFixed(1)}" width="${(gap * 0.5).toFixed(1)}" height="${h.toFixed(1)}" rx="${(gap * 0.25).toFixed(1)}" fill="url(#js-bar)" opacity="${(0.35 + 0.65 * env).toFixed(2)}"/>`;
  }
  const sparkles = [[180, 120, 3], [1100, 90, 4], [1180, 300, 2.5], [120, 420, 2.5], [960, 210, 2], [300, 260, 2]].map(([x, y, r]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.gold}" opacity="0.7"/>`).join('');
  const defs = `
<radialGradient id="js-bg" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#3A2A7A"/><stop offset="0.6" stop-color="${C.violet}"/><stop offset="1" stop-color="#0C0920"/></radialGradient>
<linearGradient id="js-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE48A"/><stop offset="1" stop-color="${C.amber}"/></linearGradient>`;
  const body = `
<rect width="1280" height="720" fill="url(#js-bg)"/>
${sparkles}
<rect x="${640 - (measure(label, 24, 700) + 56) / 2}" y="78" width="${measure(label, 24, 700) + 56}" height="48" rx="24" fill="none" stroke="${C.gold}" stroke-width="2"/>
${txt(640, 110, label, 24, C.gold, { weight: 700, anchor: 'middle' })}
${titleSVG(fit, { ...box, align: 'middle', fill: '#FFFFFF' })}
${txt(640, below + 58, speaker ? `${d.long}  |  ${speaker}` : d.long, 30, '#E9E3FF', { weight: 500, anchor: 'middle', opacity: 0.85 })}
${bars}
${txt(640, 694, church, 22, '#FFFFFF', { weight: 600, anchor: 'middle', opacity: 0.6 })}`;
  return frame(defs, body, title);
}

export const TEMPLATES = {
  spotlight: { name: 'Spotlight', render: spotlight },
  calendar: { name: 'Calendar', render: calendar },
  sanctuary: { name: 'Sanctuary Light', render: sanctuary },
  bulletin: { name: 'Bulletin', render: bulletin },
  joyfulSound: { name: 'Joyful Sound', render: joyfulSound },
};

export function renderThumbnail(templateId, data) {
  const t = TEMPLATES[templateId] || TEMPLATES.spotlight;
  return t.render(data);
}
