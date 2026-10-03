// Bible fun facts, for the wait while event photos download.
//
// A fresh batch comes from the church's own AI (/api/ai/chat - the same
// route the chatbot uses, which keeps the key on the server), once per visit.
// Until it answers - or if it is busy or not set up - these stand in. They
// are checked, plain facts, so the screen is never empty and never wrong.

export const FALLBACK_BIBLE_FACTS = [
  'Psalm 117 is the shortest chapter in the Bible - just two verses long.',
  'Psalm 119 is the longest chapter in the Bible, with 176 verses.',
  '"Jesus wept" (John 11:35) is the shortest verse in most English Bibles.',
  'The Bible was first written in three languages: Hebrew, Aramaic and Greek.',
  'Methuselah is the oldest person in the Bible - he lived 969 years (Genesis 5:27).',
  'The word "Bible" comes from the Greek "biblia", which means "books".',
  "Jesus' first miracle was turning water into wine at a wedding in Cana (John 2).",
  'The Book of Esther never mentions the name of God, yet His care runs all through it.',
  'The Bible has been translated, in full or in part, into more than 3,000 languages.',
  'The Gutenberg Bible, printed around 1455, was one of the first books printed in Europe with movable type.',
  'Paul is traditionally credited with writing 13 of the 27 books of the New Testament.',
  'Psalm 23 begins "The Lord is my shepherd" - written by David, once a shepherd boy himself.',
];

const CACHE_KEY = 'ep-bible-facts';
const CACHE_MS = 30 * 60_000;

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** The built-in facts, in a new order each time. */
export const fallbackFacts = () => shuffle(FALLBACK_BIBLE_FACTS);

// The model is asked for JSON, but a model sometimes wraps it in prose or a
// code fence - so the array is dug out rather than trusted to be the whole
// answer.
const parseFacts = (text) => {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const list = JSON.parse(raw.slice(start, end + 1));
    return (Array.isArray(list) ? list : [])
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim().replace(/\s+/g, ' '))
      .filter((x) => x.length >= 20 && x.length <= 200);
  } catch {
    return [];
  }
};

/**
 * Short, true, delightful Bible facts from the AI - or [] when it cannot be
 * reached. Kept for half an hour in this tab, so a second download does not
 * ask again.
 */
export async function loadBibleFacts() {
  try {
    const hit = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) || 'null');
    if (hit && Date.now() - hit.at < CACHE_MS && Array.isArray(hit.facts) && hit.facts.length) return shuffle(hit.facts);
  } catch { /* no cache */ }
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: 0.9,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: 'You write short, true and delightful Bible trivia for a church\'s event photo page. '
              + 'Accuracy matters more than anything: only state facts that are well established and that you are sure of. '
              + 'Never invent numbers, quotes or verse references.',
          },
          {
            role: 'user',
            content: 'Give me 10 fun facts about the Bible. Each one: surprising or heart-warming, under 22 words, '
              + 'plain English for all ages, and with the book and chapter when it helps. '
              + 'Mix the topics - people, places, animals, food, numbers, languages, and the history of the Bible itself. '
              + 'Reply with ONLY a JSON array of strings, nothing else.',
          },
        ],
      }),
    });
    const data = await res.json();
    const facts = parseFacts(data?.choices?.[0]?.message?.content);
    if (facts.length >= 3) {
      try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), facts })); } catch { /* full */ }
      return facts;
    }
  } catch { /* the built-in facts carry on */ }
  return [];
}
