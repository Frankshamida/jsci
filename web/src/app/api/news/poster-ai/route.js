import { NextResponse } from 'next/server';
import { groqChat, groqConfigured } from '@/lib/groq';
import { limit, tooManyRequests } from '@/lib/rateLimiter';
import { CHURCH_FULL_NAME } from '@/lib/branding';
import { supabaseAdmin } from '@/lib/supabase';
import { NEWS_MIGRATION_NOTE, NEWS_TABLE, newsEditor, newsTableMissing } from '@/lib/newsServer';
import { headlineWords, normWord, phraseInHeadline } from '@/lib/posterTemplates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/news/poster-ai  { actorId, articleId, mode, headline?, subtext? }
// Admin and Super Admin only. The words for a news poster, from the article:
//
//   all        -> { headline, highlight, subtext }
//   headline   -> { headline, highlight }   a different headline
//   highlight  -> { highlight }             for the headline sent
//   subtext    -> { subtext }
//
// The article is read here, not sent by the browser. What comes back is
// checked before it goes to the editor:
//   - each highlight phrase must be in the headline, word for word (others
//     are dropped), 4 words at most in all;
//   - every name, number and place in the subtext must be in the article
//     (a part that is not, is dropped), so the AI cannot invent a date or a
//     venue; and a headline with a number the article does not have is not
//     used;
//   - an answer that cannot be read falls back to the article's own title,
//     no highlight and no subtext.

const MODES = ['all', 'headline', 'highlight', 'subtext'];
const TZ = 'Asia/Manila';

const SYSTEM = `You write the words for Facebook posters of ${CHURCH_FULL_NAME}, a church in Cebu City, Philippines. A poster shows one church news article: a short headline in big capital letters with one or two key phrases in gold, and under it a short line of facts.
Facts: use ONLY what the article says. Never invent or guess names, titles, dates, times, places or numbers, and never use placeholders.
Words: plain, clear and warm. No emojis, no hashtags, no quotation marks, no full stop at the end.
Reply with one JSON object only, in exactly the shape asked for.`;

const RULES = {
  headline: '"headline": the poster headline - at most 12 words, with the same meaning as the title, specific about who or what and what happened. It is shown in capital letters.',
  highlight: '"highlight": 1 or 2 phrases copied word for word from the headline, at most 4 words in all - the words that matter most: a name, a number, the event or the milestone (for example "8TH ANNIVERSARY" or "FEEDING PROGRAM"). Never only small words like "the", "of" or "and".',
  subtext: '"subtext": 2 or 3 short facts from the article in capital letters, joined with " | ", at most 60 characters in all - the date, the place, the event or the group - for example "NOVEMBER 15, 2026 | BARANGAY BASAK SAN NICOLAS". Only facts the article states; if it gives none, use "".',
};

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const clip = (v, max) => String(v ?? '').trim().slice(0, max);
const cleanLine = (v, max) => String(v ?? '')
  .replace(/[*#_`"“”]+/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[.。]+$/, '')
  .slice(0, max);

const parseJson = (text) => {
  try { return JSON.parse(text); } catch { /* look for the object inside */ }
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* not JSON */ } }
  return null;
};

// ---- Is it in the article? ----

const MONTHS = {
  jan: 'january', feb: 'february', mar: 'march', apr: 'april', jun: 'june', jul: 'july', aug: 'august',
  sep: 'september', sept: 'september', oct: 'october', nov: 'november', dec: 'december',
};
const SMALL = new Set(['the', 'and', 'for', 'with', 'from', 'our', 'all', 'its', 'his', 'her', 'their', 'this', 'that']);

// Lower-case words, with "15th" read as "15" and "Nov" as "november".
const tokens = (text) => (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map((t) => {
  const ordinal = t.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinal) return ordinal[1];
  return MONTHS[t] || t;
});

const meaningful = (t) => /\d/.test(t) || (t.length >= 3 && !SMALL.has(t));

// A part of the subtext counts only if every name, word and number in it
// appears somewhere in the article.
const grounded = (part, source) => tokens(part).filter(meaningful).every((t) => source.has(t));

function cleanSubtext(value, source) {
  const parts = cleanLine(value, 240).toUpperCase().split('|').map((p) => p.trim()).filter(Boolean)
    .filter((p) => grounded(p, source))
    .slice(0, 3);
  while (parts.length && parts.join(' | ').length > 60) parts.pop();
  return parts.join(' | ');
}

function cleanHighlight(list, headline) {
  const out = [];
  let words = 0;
  (Array.isArray(list) ? list : [list]).forEach((p) => {
    const phrase = cleanLine(p, 80).toUpperCase();
    const n = headlineWords(phrase).length;
    if (!phrase || out.length >= 2 || words + n > 4) return;
    if (headlineWords(phrase).every((w) => SMALL.has(normWord(w).toLowerCase()) || normWord(w).length < 3)) return;
    if (!phraseInHeadline(headline, phrase) || out.includes(phrase)) return;
    out.push(phrase);
    words += n;
  });
  return out;
}

// A headline the article supports: 1 to 14 words, and no number that is not
// in the article.
function cleanHeadline(value, source) {
  const h = cleanLine(value, 140);
  const count = headlineWords(h).length;
  if (!count || count > 14) return null;
  if (tokens(h).filter((t) => /\d/.test(t)).some((t) => !source.has(t))) return null;
  return h;
}

export async function POST(request) {
  try {
    if (!groqConfigured()) return fail('The AI is not set up on this server (GROQ_API_KEY is missing).', 503);
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    const mode = MODES.includes(body.mode) ? body.mode : 'all';

    // The same allowance as the editor's other AI tools.
    const gate = await limit(`news:ai:${who.user.id}`, 20, 60 * 1000);
    if (!gate.allowed) return tooManyRequests(gate.retryAfterSec, 'That is a lot of AI requests in a minute. Please wait a moment.');

    const { data: a, error } = await supabaseAdmin
      .from(NEWS_TABLE)
      .select('id, title, summary, content_text, category, tags, published_at')
      .eq('id', String(body.articleId || '')).maybeSingle();
    if (error) return newsTableMissing(error) ? fail(NEWS_MIGRATION_NOTE, 503) : fail(error.message, 500);
    if (!a) return fail('That article is not there any more.', 404);

    const published = a.published_at
      ? new Date(a.published_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })
      : '';
    const tags = Array.isArray(a.tags) ? a.tags : [];
    const text = clip(a.content_text, 6000);
    const source = new Set(tokens([a.title, a.summary, text, a.category, tags.join(' '), published, CHURCH_FULL_NAME, 'Cebu City Philippines'].join(' ')));

    const current = cleanLine(body.headline, 200);
    const currentSub = cleanLine(body.subtext, 200);
    const material = `TITLE: ${a.title}
SUMMARY: ${clip(a.summary, 600) || '(none)'}
TOPIC: ${a.category || '(none)'}
TAGS: ${tags.join(', ') || '(none)'}
PUBLISHED ON: ${published || '(not published yet)'} (the day the article went up - not always the day of the event)
ARTICLE:
${text || '(no body text yet)'}`;

    let ask;
    let temperature = 0.5;
    if (mode === 'all') {
      ask = `Write the poster for this church news article.

${material}

Reply as JSON: {"headline": "", "highlight": [""], "subtext": ""}
${RULES.headline}
${RULES.highlight}
${RULES.subtext}`;
    } else if (mode === 'headline') {
      temperature = 0.85;
      ask = `Write a new poster headline for this church news article${current ? `, different from "${current}"` : ''}, and pick its highlight.

${material}

Reply as JSON: {"headline": "", "highlight": [""]}
${RULES.headline}
${RULES.highlight}`;
    } else if (mode === 'highlight') {
      if (!headlineWords(current).length) return fail('Write a headline first.');
      temperature = 0.2;
      ask = `This is the poster headline: "${current}"
Pick the words in it to show in gold.

${material}

Reply as JSON: {"highlight": [""]}
${RULES.highlight}`;
    } else {
      temperature = 0.4;
      ask = `Write the line of facts that goes under the poster headline${currentSub ? ` (something other than "${currentSub}" if the article allows)` : ''}.

${material}

Reply as JSON: {"subtext": ""}
${RULES.subtext}`;
    }

    const { text: answer } = await groqChat({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: ask }],
      temperature,
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    });
    const json = parseJson(answer);
    const out = {};
    let note = null;

    if (mode === 'all' || mode === 'headline') {
      const headline = json ? cleanHeadline(json.headline, source) : null;
      out.headline = headline || cleanLine(a.title, 140);
      out.highlight = headline ? cleanHighlight(json.highlight, headline) : [];
      if (!headline) note = 'The AI did not give a headline it could back up, so the article title is used.';
    }
    if (mode === 'highlight') out.highlight = json ? cleanHighlight(json.highlight, current) : [];
    if (mode === 'all' || mode === 'subtext') {
      out.subtext = json ? cleanSubtext(json.subtext, source) : '';
      if (!out.subtext && !note) note = 'The article has no date, place or other fact the AI could use for a subtext.';
    }
    if (!json) {
      note = mode === 'all' || mode === 'headline'
        ? 'The AI did not answer properly, so the article title is used. Try again for new words.'
        : 'The AI did not answer properly. Please try again.';
    }

    return NextResponse.json({ success: true, data: { ...out, note } });
  } catch (error) {
    console.error('[news poster ai]', error.message);
    return fail(error.message || 'The AI could not finish that. Please try again.', 502);
  }
}
