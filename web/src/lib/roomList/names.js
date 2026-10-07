// Names as people write them on a rooming list, matched to the names the
// system has.
//
// The rule this file keeps: a name is only ever taken as somebody when it is
// THEIR name - the same words, in any order, with titles and punctuation
// ignored. "Ptr. Cruz, Juan" is Juan Cruz. "Juan Cruz" is NOT Juan Dela Cruz:
// that is offered as a suggestion, and a person at the screen says yes or no.
// A rooming list that quietly puts the wrong Juan in 308 is worse than one
// that asks.

// Words that are a title, not a name. Jr / Sr / III stay: Juan Cruz and Juan
// Cruz Jr. are a father and a son, and both may be on the list.
const TITLES = new Set([
  'ptr', 'pastor', 'ps', 'bro', 'brother', 'sis', 'sister', 'mr', 'mrs', 'ms', 'miss', 'mx',
  'dr', 'rev', 'reverend', 'atty', 'engr', 'hon', 'elder', 'deacon', 'dcn', 'apostle', 'apo',
  'bishop', 'evangelist', 'evang', 'sir', 'maam', 'madam', 'kuya', 'ate',
]);

/** "Ptr. Juan  DELA-Cruz" -> "juan dela cruz". Titles, accents and punctuation go. */
export function nameKey(raw) {
  return String(raw ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !TITLES.has(t))
    .join(' ');
}

// The words of a name without its initials, in a fixed order, so "Cruz, Juan
// D." and "Juan D Cruz" come out the same.
const wordsOf = (key) => key.split(' ').filter((t) => t.length > 1);
const orderFree = (key) => wordsOf(key).sort().join(' ');

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const alike = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);

/**
 * How close two names are, 0..1, for suggestions only - never for taking
 * somebody without asking.
 */
function closeness(fileWords, personWords) {
  if (!fileWords.length || !personWords.length) return 0;
  // Every word written is one of theirs: "Juan Cruz" for Juan Dela Cruz.
  const inside = (xs, ys) => xs.every((x) => ys.includes(x));
  if (fileWords.length >= 2 && (inside(fileWords, personWords) || inside(personWords, fileWords))) return 0.9;
  // Every word written is nearly one of theirs: "Jaun Cruz".
  if (fileWords.length >= 2) {
    const best = fileWords.map((w) => Math.max(...personWords.map((p) => alike(w, p))));
    if (best.every((s) => s >= 0.75)) return 0.85 * (best.reduce((a, b) => a + b, 0) / best.length);
  }
  // The name run together: "Delacruz Juan" for Juan Dela Cruz.
  const run = (ws) => [...ws].sort().join('');
  const whole = alike(run(fileWords), run(personWords));
  return whole >= 0.85 ? whole * 0.8 : 0;
}

/**
 * Prepare the people a list can name: everybody on the event who is not
 * cancelled. entitled says whether they paid for a bed.
 *
 * @param {Array<{id, name, entitled}>} people
 */
export function nameIndex(people) {
  const rows = (people || []).map((p) => {
    const key = nameKey(p.name);
    return { ...p, key, free: orderFree(key), words: wordsOf(key) };
  });
  const byKey = new Map();
  const byFree = new Map();
  rows.forEach((p) => {
    if (p.key) (byKey.get(p.key) || byKey.set(p.key, []).get(p.key)).push(p);
    if (p.free) (byFree.get(p.free) || byFree.set(p.free, []).get(p.free)).push(p);
  });
  return { rows, byKey, byFree };
}

const SUGGEST = 4;

/**
 * One name off the list, against the people on the event.
 *
 *   matched           exactly one person paid for a bed has this name
 *   ambiguous         more than one does - somebody chooses
 *   no_accommodation  it is somebody's name, but they did not pay for a bed
 *   check             nobody has this name; options are close ones
 *   not_found         nobody has a name like it
 *
 * @returns {{status, regId: string|null, options: Array<{id, name, score}>}}
 */
export function matchName(text, index) {
  const key = nameKey(text);
  if (!key) return { status: 'empty', regId: null, options: [] };

  const same = index.byKey.get(key) || index.byFree.get(orderFree(key)) || [];
  if (same.length) {
    const paid = same.filter((p) => p.entitled);
    if (paid.length === 1) return { status: 'matched', regId: paid[0].id, options: [] };
    if (paid.length > 1) {
      return { status: 'ambiguous', regId: null, options: paid.map((p) => ({ id: p.id, name: p.name, score: 1 })) };
    }
    return { status: 'no_accommodation', regId: null, options: same.map((p) => ({ id: p.id, name: p.name, score: 1 })) };
  }

  const words = wordsOf(key);
  let options = index.rows
    .filter((p) => p.entitled)
    .map((p) => ({ id: p.id, name: p.name, score: closeness(words, p.words) }))
    .filter((o) => o.score >= 0.7);
  // One word is too little to go on, so it only offers the people who have
  // that word in their name - "Juan" lists the Juans and picks none of them.
  if (!options.length && words.length === 1) {
    options = index.rows
      .filter((p) => p.entitled && p.words.includes(words[0]))
      .map((p) => ({ id: p.id, name: p.name, score: 0.5 }));
  }
  options.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  options = options.slice(0, SUGGEST);
  return { status: options.length ? 'check' : 'not_found', regId: null, options };
}

// How several names get written into one box: "Juan Cruz / Maria Cruz",
// one per line, or with commas. Only tried when the whole box is not a name -
// "Cruz, Juan" is one person and must not become two.
const SEPARATORS = /\s*(?:\r?\n|;|\/|\||\s&\s|\sand\s|,)\s*/i;

/**
 * The people written in one box of the list. Usually one; a box with several
 * names on it gives one entry per name.
 *
 * @returns {Array<{text, status, regId, options}>}
 */
export function readBox(text, index) {
  const whole = String(text ?? '').trim();
  if (!whole) return [];
  const one = matchName(whole, index);
  if (one.status === 'matched' || one.status === 'ambiguous' || one.status === 'no_accommodation') {
    return [{ text: whole, ...one }];
  }
  const parts = whole.split(SEPARATORS).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [{ text: whole, ...one }];
  return parts.map((part) => ({ text: part, ...matchName(part, index) }));
}

/** What the box used between names, so the export writes them back the same way. */
export function boxSeparator(text) {
  const s = String(text ?? '');
  if (/\r?\n/.test(s)) return '\n';
  if (/;/.test(s)) return '; ';
  if (/\s\/\s|\//.test(s)) return ' / ';
  return ', ';
}
