// ============================================================
// JSCI Ministry app - song lyrics
// Lyrics live in the Media team's lyrics library (lyrics_library), the same
// one the website's Lyrics page writes. A lineup song finds its lyrics by its
// YouTube video, else by its title. Saved in the website's format: sections
// ([{ label, content }]), HTML, and plain text with [Label] headings.
// ============================================================

// The website capitalises these (web/src/app/api/lyrics/library/route.js).
const SACRED_WORDS = {
  god: 'God', jesus: 'Jesus', christ: 'Christ', lord: 'Lord', 'holy spirit': 'Holy Spirit', holy: 'Holy', spirit: 'Spirit',
  father: 'Father', savior: 'Savior', saviour: 'Saviour', king: 'King', messiah: 'Messiah', almighty: 'Almighty',
  redeemer: 'Redeemer', creator: 'Creator', lamb: 'Lamb',
  ama: 'Ama', anak: 'Anak', diyos: 'Diyos', panginoon: 'Panginoon', hesus: 'Hesus', kristo: 'Kristo',
  'espiritu santo': 'Espiritu Santo', espiritu: 'Espiritu', tagapagligtas: 'Tagapagligtas', hari: 'Hari',
  manlilikha: 'Manlilikha', makapangyarihan: 'Makapangyarihan',
  ginoo: 'Ginoo', amahan: 'Amahan', 'anak nga lalaki': 'Anak nga Lalaki', 'balaang espiritu': 'Balaang Espiritu',
  balaang: 'Balaang', manluluwas: 'Manluluwas', magbubuhat: 'Magbubuhat', makagagahum: 'Makagagahum', hesukristo: 'HesuKristo',
};
const SACRED_ORDER = Object.keys(SACRED_WORDS).sort((a, b) => b.length - a.length);
const capitalizeSacred = (text) => SACRED_ORDER.reduce((t, w) => t.replace(new RegExp(`\\b${w}\\b`, 'gi'), SACRED_WORDS[w]), text);

const LABEL = /^\[?\(?(Verse\s*\d*|Chorus\s*\d*|Pre[-\s]?Chorus|Bridge|Outro|Intro|Interlude|Hook|Tag|Refrain|Ending)\)?\]?\s*:?\s*$/i;
const INLINE_LABEL = /^(Verse\s*\d*|Chorus\s*\d*|Pre[-\s]?Chorus|Bridge|Outro|Intro|Interlude|Hook|Tag|Refrain|Ending)\s*:\s*(.+)$/i;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Typed or pasted lyrics -> { sections, html, plain }, as the website saves them. */
export function formatLyrics(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { sections: [], html: '', plain: '' };
  const sections = [];
  let current = { label: 'Verse 1', content: '' };
  const push = () => { if (current.content.trim()) sections.push({ label: current.label, content: capitalizeSacred(current.content.trim()) }); };
  for (const line of text.split('\n')) {
    const t = line.trim();
    const head = t.match(LABEL);
    const inline = !head && t.match(INLINE_LABEL);
    if (head || inline) {
      push();
      current = { label: (head || inline)[1].trim().replace(/\s+/g, ' '), content: inline ? `${inline[2]}\n` : '' };
    } else {
      current.content += `${line}\n`;
    }
  }
  push();
  const html = sections.map((s) => `<div class="lyrics-section"><div class="lyrics-section-label">${escapeHtml(s.label)}</div><div class="lyrics-section-content">${escapeHtml(s.content).replace(/\n/g, '<br>')}</div></div>`).join('');
  const plain = sections.map((s) => `[${s.label}]\n${s.content}`).join('\n\n');
  return { sections, html, plain };
}

/** A library row's lyrics as sections, whichever way it was saved. */
export function sectionsOf(row) {
  if (Array.isArray(row?.sections) && row.sections.length) {
    return row.sections.map((s) => ({ label: String(s.label || s.type || '').trim(), content: String(s.content || '').trim() })).filter((s) => s.content);
  }
  if (row?.lyrics_plain) return formatLyrics(row.lyrics_plain).sections;
  if (row?.lyrics_html) {
    const text = row.lyrics_html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    return formatLyrics(text).sections;
  }
  return [];
}

/** The YouTube video id in a link, or null. */
export function videoIdOf(link) {
  const m = String(link || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** A title to compare: lower case, no "(Live)", no punctuation. */
export const titleKey = (title) => String(title || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The best library entry for one song: the same video first, then the same
 * title; linked to this lineup's date and published ones win ties.
 * @param {{ title: string, link?: string }} song
 * @param {object[]} rows - lyrics_library rows (id, title, youtube_link, status, linked_schedule_dates, updated_at)
 */
export function matchLyrics(song, rows, date) {
  const vid = videoIdOf(song.link);
  const key = titleKey(song.title);
  const score = (r) => {
    let s = 0;
    if (vid && videoIdOf(r.youtube_link) === vid) s += 100;
    else if (key && titleKey(r.title) === key) s += 50;
    else return 0;
    if (date && Array.isArray(r.linked_schedule_dates) && r.linked_schedule_dates.includes(date)) s += 10;
    if (r.status === 'Published') s += 5;
    return s;
  };
  let best = null;
  let bestScore = 0;
  for (const r of rows) {
    const s = score(r);
    if (s > bestScore || (s === bestScore && s > 0 && String(r.updated_at) > String(best?.updated_at))) { best = r; bestScore = s; }
  }
  return best;
}
