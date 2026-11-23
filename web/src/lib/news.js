// News: the pieces the public pages, the editor and the API all share.
//
// An article's body is a list of BLOCKS rather than one big HTML string, so
// the editor can offer layouts (an image beside text, a gallery, a quote) and
// the public page can draw each one properly at every screen size:
//
//   text        { html }                       paragraphs, headings, lists, links
//   centered    { html }                       a highlighted, centred passage
//   quote       { html, cite }                 a pull quote
//   image       { image }                      one full-width photo
//   grid        { images: [...] }              2-4 photos side by side
//   stack       { images: [...] }              photos one under another
//   media-left  { image, html }                photo on the left, text beside it
//   media-right { image, html }                photo on the right
//   divider     {}                             a thin rule
//   event       { eventId, slug, title, ... }  a church event as a card with
//                                              "View event" (its details are
//                                              read fresh on the page; the rest
//                                              is a fallback copy)
//   button      { label, url, style }          a link as a button
//
// image = { url, publicId, caption, alt }
//
// Text is stored as HTML from the editor, and every piece of it goes through
// sanitizeHtml() on the server before it is saved AND before it is shown: only
// a short list of tags and styles survives, links must be http(s)/mailto/tel
// or this site's own paths, and nothing that runs script can get through.
// No DOM is used, so this works on the server and in the browser alike.

import { eventImageUrl } from '@/lib/eventImage';

export const NEWS_CATEGORIES = [
  'Church News',
  'Events',
  'Ministries',
  'Testimonies',
  'Missions & Outreach',
  'Youth',
  'ISOM',
  'Announcements',
  'Community',
];

export const BLOCK_LIBRARY = [
  { group: 'Standard blocks', items: [
    { type: 'text', label: 'Text', icon: 'fas fa-align-left', hint: 'Paragraphs, headings and lists' },
    { type: 'image', label: 'Full Image', icon: 'far fa-image', hint: 'One wide photo with a caption' },
    { type: 'centered', label: 'Centered', icon: 'fas fa-align-center', hint: 'A highlighted passage' },
    { type: 'quote', label: 'Quote', icon: 'fas fa-quote-left', hint: 'Words from someone, with a name' },
  ] },
  { group: 'Layout blocks', items: [
    { type: 'grid', label: 'Image Grid', icon: 'fas fa-table-cells-large', hint: '2 to 4 photos side by side' },
    { type: 'media-left', label: 'Left Image', icon: 'fas fa-indent', hint: 'Photo left, text right' },
    { type: 'media-right', label: 'Right Image', icon: 'fas fa-outdent', hint: 'Text left, photo right' },
  ] },
  { group: 'Special layouts', items: [
    { type: 'stack', label: 'Photo Stack', icon: 'fas fa-layer-group', hint: 'Several photos in a row, top to bottom' },
    { type: 'divider', label: 'Divider', icon: 'fas fa-minus', hint: 'A thin line between parts' },
  ] },
  { group: 'Links', items: [
    { type: 'event', label: 'Event', icon: 'fas fa-calendar-check', hint: 'A church event, with a button to view it' },
    { type: 'button', label: 'Button', icon: 'fas fa-arrow-pointer', hint: 'A link as a button: register, watch, read more' },
  ] },
];

export const TEXT_BLOCKS = new Set(['text', 'centered', 'quote', 'media-left', 'media-right']);
export const IMAGE_LIST_BLOCKS = new Set(['grid', 'stack']);
export const SINGLE_IMAGE_BLOCKS = new Set(['image', 'media-left', 'media-right']);

const rid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function newBlock(type) {
  const id = rid();
  switch (type) {
    case 'image': return { id, type, image: null };
    case 'grid': case 'stack': return { id, type, images: [] };
    case 'media-left': case 'media-right': return { id, type, image: null, html: '' };
    case 'quote': return { id, type, html: '', cite: '' };
    case 'divider': return { id, type };
    case 'centered': return { id, type, html: '' };
    case 'event': return { id, type, eventId: null };
    case 'button': return { id, type, label: '', url: '', style: 'gold' };
    default: return { id, type: 'text', html: '' };
  }
}

// "Paddle Park Opens in Bacolod!" -> "paddle-park-opens-in-bacolod"
export const slugify = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90)
  .replace(/-+$/, '');

// ---- Cleaning HTML -----------------------------------------------------------

const ALLOWED_TAGS = {
  p: true, br: true, div: true, span: true,
  strong: true, b: true, em: true, i: true, u: true, s: true,
  a: true, ul: true, ol: true, li: true,
  h2: true, h3: true, h4: true, blockquote: true,
};

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const decodeEntities = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&(colon|tab|newline|nbsp);/gi, (_, n) => ({ colon: ':', tab: '\t', newline: '\n', nbsp: ' ' }[n.toLowerCase()]))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const attrOf = (attrs, name) => {
  const m = String(attrs || '').match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

// Only places a reader can safely be sent.
export const safeHref = (raw) => {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]+/g, '');
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v) || /^tel:/i.test(v)) return v;
  if (/^\/(?!\/)/.test(v) || v.startsWith('#')) return v;
  return null;
};

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
const safeStyle = (raw) => {
  const out = [];
  String(decodeEntities(raw) || '').split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim().toLowerCase();
    if (prop === 'color' && COLOR.test(val)) out.push(`color: ${val}`);
    else if (prop === 'text-align' && /^(left|right|center|justify)$/.test(val)) out.push(`text-align: ${val}`);
    else if (prop === 'font-weight' && /^(bold|bolder|[6-9]00)$/.test(val)) out.push('font-weight: 700');
    else if (prop === 'font-style' && val === 'italic') out.push('font-style: italic');
    else if (/^text-decoration(-line)?$/.test(prop) && /^(underline|line-through)$/.test(val)) out.push(`text-decoration: ${val}`);
  });
  return out.join('; ');
};

export function sanitizeHtml(input) {
  let s = String(input || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|head|title|textarea|select|button|form|video|audio)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>?/g, (full, name, attrs) => {
    let tag = name.toLowerCase();
    const closing = full.startsWith('</');
    let style = closing ? '' : safeStyle(attrOf(attrs, 'style'));
    // execCommand('foreColor') can write <font color="...">: keep the colour.
    if (tag === 'font') {
      tag = 'span';
      const c = attrOf(attrs, 'color');
      if (!closing && c && COLOR.test(c.trim())) style = [style, `color: ${c.trim().toLowerCase()}`].filter(Boolean).join('; ');
    }
    if (!ALLOWED_TAGS[tag]) return '';
    if (closing) return tag === 'br' ? '' : `</${tag}>`;
    if (tag === 'br') return '<br>';
    const kept = [];
    if (tag === 'a') {
      const href = safeHref(attrOf(attrs, 'href'));
      if (href) {
        kept.push(`href="${escAttr(href)}"`);
        if (/^https?:/i.test(href)) kept.push('target="_blank" rel="noopener noreferrer"');
      }
    }
    if (style) kept.push(`style="${escAttr(style)}"`);
    return `<${tag}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
  });
  return s.trim();
}

export const htmlToText = (html) => decodeEntities(String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|h2|h3|h4|li|blockquote)>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// Plain paragraphs (from the AI, or typed) -> safe HTML paragraphs.
export const textToHtml = (text) => String(text || '')
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`)
  .join('');

// ---- Blocks ------------------------------------------------------------------

const plain = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanImage = (img) => {
  if (!img || typeof img !== 'object') return null;
  const url = String(img.url || '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return null;
  return {
    url,
    publicId: img.publicId ? plain(img.publicId, 300) : null,
    caption: plain(img.caption, 300),
    alt: plain(img.alt, 200),
  };
};

// Whatever came from the browser, made into blocks this site can trust.
export function normalizeBlocks(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 150) : [];
  const out = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const id = plain(b.id, 40) || rid();
    switch (b.type) {
      case 'text':
      case 'centered':
        out.push({ id, type: b.type, html: sanitizeHtml(b.html).slice(0, 60000) });
        break;
      case 'quote':
        out.push({ id, type: 'quote', html: sanitizeHtml(b.html).slice(0, 4000), cite: plain(b.cite, 160) });
        break;
      case 'image':
        out.push({ id, type: 'image', image: cleanImage(b.image) });
        break;
      case 'grid':
      case 'stack':
        out.push({ id, type: b.type, images: (Array.isArray(b.images) ? b.images : []).slice(0, 12).map(cleanImage).filter(Boolean) });
        break;
      case 'media-left':
      case 'media-right':
        out.push({ id, type: b.type, image: cleanImage(b.image), html: sanitizeHtml(b.html).slice(0, 20000) });
        break;
      case 'divider':
        out.push({ id, type: 'divider' });
        break;
      case 'event': {
        const eventId = /^[0-9a-f-]{36}$/i.test(String(b.eventId || '')) ? String(b.eventId) : null;
        out.push({
          id,
          type: 'event',
          eventId,
          // A copy of what the card showed when it was added, for if the
          // event is later deleted. The page prefers the live event.
          slug: String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 160),
          title: plain(b.title, 200),
          when: plain(b.when, 120),
          place: plain(b.place, 200),
          image: /^https:\/\/[^\s"'<>]+$/i.test(String(b.image || '')) ? String(b.image) : null,
          label: plain(b.label, 40),
        });
        break;
      }
      case 'button': {
        const href = safeHref(b.url);
        out.push({ id, type: 'button', label: plain(b.label, 60), url: href || '', style: b.style === 'outline' ? 'outline' : 'gold' });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export const blockImages = (b) => {
  if (!b) return [];
  if (IMAGE_LIST_BLOCKS.has(b.type)) return b.images || [];
  if (SINGLE_IMAGE_BLOCKS.has(b.type)) return b.image ? [b.image] : [];
  return [];
};

export const imagePublicIds = (blocks) => [...new Set((blocks || [])
  .flatMap(blockImages).map((img) => img?.publicId).filter(Boolean))];

export const blocksToText = (blocks) => (blocks || []).map((b) => {
  const parts = [];
  if (b.html) parts.push(htmlToText(b.html));
  if (b.cite) parts.push(`— ${b.cite}`);
  blockImages(b).forEach((img) => { if (img.caption) parts.push(img.caption); });
  return parts.join('\n');
}).filter(Boolean).join('\n\n');

// Does the article say anything yet? (Publishing an empty one is refused.)
export const hasContent = (blocks) => (blocks || []).some((b) => blockImages(b).length > 0 || htmlToText(b.html || '').length > 0 || (b.type === 'event' && b.eventId) || (b.type === 'button' && b.url));

// ---- Showing an article ----------------------------------------------------

export const readingMinutes = (text) => Math.max(1, Math.round(String(text || '').split(/\s+/).filter(Boolean).length / 200));

export const newsImage = (url, width) => (url ? eventImageUrl(url, width) : null);

export const articlePath = (slug) => `/news/${slug}`;

const TZ = 'Asia/Manila';
export const newsDate = (iso, opts = {}) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ, ...opts });
};

export const timeAgo = (iso, now = Date.now()) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return '';
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return newsDate(iso);
};

// The fields a list of articles needs - never the body.
export const LIST_FIELDS = 'id, title, slug, summary, category, tags, featured_image_url, author_name, is_featured, views, published_at, updated_at';

// ---- Text the AI can work on without losing the formatting ----
//
// The AI tools (rewrite, make natural, translate) get the text in a small
// plain format, and give it back the same way:
//   ## Heading      ### Subheading      - bullet      1. numbered
//   **bold**        [words](https://link)
// so a rewritten paragraph keeps its headings, lists, bold words and links,
// instead of coming back as one flat block of text.

const inlineToMarkup = (html) => String(html || '')
  .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inner.replace(/<[^>]+>/g, '')}](${decodeEntities(href)})`)
  .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, t, inner) => {
    // "**word**", with any space that was inside the bold kept outside it.
    const txt = inner.replace(/<[^>]+>/g, '');
    if (!txt.trim()) return inner;
    return `${txt.match(/^\s*/)[0]}**${txt.trim()}**${txt.match(/\s*$/)[0]}`;
  })
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '');

export function htmlToMarkup(html) {
  const s = sanitizeHtml(html);
  const out = [];
  const re = /<(h2|h3|h4|p|div|blockquote|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    const loose = s.slice(last, m.index);
    if (loose.replace(/<[^>]+>/g, '').trim()) out.push(decodeEntities(inlineToMarkup(loose)).trim());
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((x, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${decodeEntities(inlineToMarkup(x[1])).trim()}`);
      if (items.length) out.push(items.join('\n'));
    } else {
      const text = decodeEntities(inlineToMarkup(inner)).trim();
      if (text) out.push(tag === 'h2' ? `## ${text}` : (tag === 'h3' || tag === 'h4') ? `### ${text}` : text);
    }
    last = m.index + m[0].length;
  }
  const tail = s.slice(last);
  if (tail.replace(/<[^>]+>/g, '').trim()) out.push(decodeEntities(inlineToMarkup(tail)).trim());
  return out.filter(Boolean).join('\n\n');
}

const markupInline = (text) => escHtml(text)
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const safe = safeHref(decodeEntities(href));
    return safe ? `<a href="${escAttr(safe)}">${label}</a>` : label;
  });

export function markupToHtml(text) {
  const parts = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const html = parts.map((p) => {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${markupInline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${markupInline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    if (/^###\s+/.test(p)) return `<h3>${markupInline(p.replace(/^###\s+/, ''))}</h3>`;
    if (/^##\s+/.test(p)) return `<h2>${markupInline(p.replace(/^##\s+/, ''))}</h2>`;
    return `<p>${lines.map(markupInline).join('<br>')}</p>`;
  }).join('');
  return sanitizeHtml(html);
}

// ---- Translations ----
//
// An article can carry Tagalog and Bisaya (Cebuano) versions next to the
// English one, in news_articles.translations:
//   { tl: { fields: { "<key>": "<text>" }, sourceHash, at, reviewed }, ceb: {...} }
// Every piece of text in the article has a key (title, summary, b:<block>:html,
// b:<block>:cite, b:<block>:cap, b:<block>:cap:<n>, b:<block>:label). The
// translations are written by the AI in the editor, where they can be read
// and corrected before readers see them; the page shows the English for
// anything a translation lacks.

export const NEWS_LANGS = [
  { code: 'en', label: 'English', short: 'EN', note: '' },
  { code: 'tl', label: 'Tagalog', short: 'TL', note: 'Isinalin sa Tagalog sa tulong ng AI.' },
  { code: 'ceb', label: 'Bisaya', short: 'CEB', note: 'Gihubad sa Bisaya sa tabang sa AI.' },
];
export const TRANSLATION_LANGS = ['tl', 'ceb'];

// Every translatable piece of an article, in reading order.
export function translatableItems({ title, summary, content }) {
  const items = [];
  if (title) items.push({ key: 'title', text: String(title) });
  if (summary) items.push({ key: 'summary', text: String(summary) });
  (content || []).forEach((b) => {
    if (b.html && htmlToText(b.html)) items.push({ key: `b:${b.id}:html`, text: htmlToMarkup(b.html) });
    if (b.cite) items.push({ key: `b:${b.id}:cite`, text: b.cite });
    if (b.image?.caption) items.push({ key: `b:${b.id}:cap`, text: b.image.caption });
    (b.images || []).forEach((img, i) => { if (img?.caption) items.push({ key: `b:${b.id}:cap:${i}`, text: img.caption }); });
    if (b.type === 'button' && b.label) items.push({ key: `b:${b.id}:label`, text: b.label });
  });
  return items;
}

// A short fingerprint of the English, so the editor can tell when the
// article has changed since it was translated.
export function sourceHash(article) {
  const str = translatableItems(article).map((i) => `${i.key}=${i.text}`).join('\n');
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// The article as it reads in `lang`: the translated text where there is one,
// the English where there is not.
export function articleIn(article, lang) {
  const t = lang && lang !== 'en' ? article?.translations?.[lang] : null;
  if (!t) return { title: article.title, summary: article.summary, content: article.content || [] };
  const f = t.fields || {};
  const pick = (key, fallback) => (typeof f[key] === 'string' && f[key].trim() ? f[key] : fallback);
  return {
    title: pick('title', article.title),
    summary: pick('summary', article.summary),
    content: (article.content || []).map((b) => {
      const next = { ...b };
      if (b.html && f[`b:${b.id}:html`]) next.html = markupToHtml(f[`b:${b.id}:html`]);
      if (b.cite) next.cite = pick(`b:${b.id}:cite`, b.cite);
      if (b.image?.caption) next.image = { ...b.image, caption: pick(`b:${b.id}:cap`, b.image.caption) };
      if (b.images) next.images = b.images.map((img, i) => (img?.caption ? { ...img, caption: pick(`b:${b.id}:cap:${i}`, img.caption) } : img));
      if (b.type === 'button' && b.label) next.label = pick(`b:${b.id}:label`, b.label);
      return next;
    }),
  };
}

// The languages an article can be read in: English, and each translation it has.
export const articleLangs = (article) => NEWS_LANGS.filter((l) => l.code === 'en' || article?.translations?.[l.code]?.fields);

// Translations from the browser, made safe to store: known languages, known
// keys, plain strings of sensible length.
export function normalizeTranslations(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const lang of TRANSLATION_LANGS) {
    const t = raw[lang];
    if (!t || typeof t !== 'object' || !t.fields || typeof t.fields !== 'object') continue;
    const fields = {};
    Object.entries(t.fields).slice(0, 400).forEach(([k, v]) => {
      if (/^(title|summary|b:[A-Za-z0-9_-]{1,40}:(html|cite|label|cap(:\d{1,2})?))$/.test(k) && typeof v === 'string' && v.trim()) {
        fields[k] = v.replace(/<[^>]*>/g, '').slice(0, k.endsWith(':html') ? 60000 : 2000);
      }
    });
    if (Object.keys(fields).length) {
      out[lang] = {
        fields,
        sourceHash: String(t.sourceHash || '').slice(0, 20),
        at: typeof t.at === 'string' ? t.at.slice(0, 40) : new Date().toISOString(),
        reviewed: t.reviewed === true,
      };
    }
  }
  return out;
}
