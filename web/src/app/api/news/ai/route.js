import { NextResponse } from 'next/server';
import { groqChat, groqConfigured } from '@/lib/groq';
import { limit, tooManyRequests } from '@/lib/rateLimiter';
import { CHURCH_FULL_NAME } from '@/lib/branding';
import { NEWS_CATEGORIES } from '@/lib/news';
import { newsEditor } from '@/lib/newsServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/news/ai  { actorId, action, ... }   Admin and Super Admin only.
//
//   draft    { topic, notes, source, tone, length }  -> { title, summary, category, tags, sections: [{ heading, paragraphs }] }
//   title    { title, summary, text }                -> { titles: [3 options] }
//   summary  { title, text }                         -> { summary }
//   rewrite  { text, mode: polish|natural|shorten|expand|simplify } -> { text }
//            (text in the editor's small markup - ## headings, - bullets,
//            **bold**, [links](url) - which comes back the same way)
//   highlight { items: [{ key, text }] }             -> { highlights: [{ key, phrases }] }
//            the words worth making bold; only exact words from the text,
//            so nothing is ever rewritten
//   translate { lang: tl|ceb, items: [{ key, text }] } -> { items: [{ key, text }] }
//            the editor sends an article in a few small batches
//
// The one rule that matters: the AI writes ONLY from what it was given. A
// church news story with an invented date, name or quote is worse than no
// story, so it is told never to fill a gap, and the editor tells the writer
// that what comes back is a draft to check.

const TONES = {
  news: 'a news report: the most important facts first (who, what, when, where), then the details, in the third person',
  feature: 'a warm feature story that brings the people and the moment to life, still factual',
  announcement: 'a clear announcement: what is happening, when, where, who it is for and what to do',
  reflection: 'a short devotional reflection, warm and encouraging, grounded in the notes given',
};
const LENGTHS = { short: '250 to 350 words', medium: '450 to 650 words', long: '800 to 1,000 words' };
const MODES = {
  polish: 'Correct grammar and spelling and make it read smoothly and professionally. Keep the length about the same.',
  natural: 'Rewrite it so it sounds like a person from the church wrote it for their own church family, not like an AI: plain everyday words, a mix of short and longer sentences, specific rather than grand, warm but not gushing. Remove filler and stock phrases. Keep the length about the same and keep every fact.',
  shorten: 'Make it about half as long, keeping the most important facts.',
  expand: 'Make it fuller and smoother, up to one and a half times as long, by explaining and connecting what is already there. Do NOT add any new facts, names, numbers, dates, quotes, reactions or outcomes.',
  simplify: 'Rewrite it in plain, simple English that anyone can follow.',
};

const RULES = `You write for the news page of ${CHURCH_FULL_NAME}, a Spirit-filled church in Cebu City, Philippines.
Style: clear, warm, professional English for a church news site. Short paragraphs of 2 to 4 sentences. No emojis, no hashtags, no ALL CAPS, and no markdown beyond the small markup described below when the text already uses it.
Facts: use ONLY the facts in the material you are given. Never invent names, titles, dates, times, places, numbers, prices or quotations. If a detail is missing, write around it - never use placeholders like [Name] or "TBA".
Never invent what happened beyond the material either: no made-up reactions ("attendees expressed gratitude"), feelings, outcomes, results, plans ("organizers hope to..."), or what a sermon or message said. You may explain or connect the facts given; you may not add new ones.
If the material is too thin for the length asked, write a shorter article. Never pad.
Do not quote Bible verses unless the verse text is in the material.
Write like a person, not like an AI. Plain, concrete words; vary the sentence length; say a thing once. Never use these or anything like them: "a testament to", "tapestry", "underscored", "showcasing", "fostering", "vibrant", "delve", "embark", "journey" (unless it was a trip), "in a world where", "not only ... but also", "it is worth noting", "moreover", "furthermore", "in conclusion", "a reminder that", "truly", "heartwarming". No dramatic openings and no closing line that sums the story up again. Use dashes sparingly.
Reply with one JSON object only, exactly in the shape asked for.`;

// Text that carries the editor's markup must come back with it intact.
const MARKUP_RULE = 'The text uses a small markup: "## " starts a heading, "### " a subheading, "- " a bullet, "1. " a numbered item, **double asterisks** mark bold words and [words](address) is a link. Keep this markup exactly where it belongs (keep link addresses unchanged), and separate paragraphs with a blank line. Never add a heading, bullet, bold word or link that was not in the text, and do not add a title.';

const LANG_GUIDE = {
  tl: 'Tagalog (Filipino) as it is naturally spoken and written in Philippine churches today: clear, warm and respectful (use "po" only where it is natural), not stiff or overly formal. Common English church words that Filipinos use as they are (for example "worship", "fellowship", "outreach", "pastor") may stay in English where that is how people actually say them.',
  ceb: 'Bisaya (Cebuano) as it is naturally spoken and written in churches in Cebu today: clear, warm and simple, the way a Cebuano pastor would write to the congregation. Use Cebuano, not Tagalog words. Common English church words that Cebuanos use as they are (for example "worship", "fellowship", "outreach", "pastor") may stay in English where that is how people actually say them.',
};

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

const parseJson = (text) => {
  try { return JSON.parse(text); } catch { /* look for the object inside */ }
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* not JSON */ } }
  return null;
};

async function ask(user, maxTokens, temperature = 0.6) {
  const { text } = await groqChat({
    messages: [{ role: 'system', content: RULES }, { role: 'user', content: user }],
    temperature,
    maxTokens,
    responseFormat: { type: 'json_object' },
  });
  const json = parseJson(text);
  if (!json) throw new Error('The AI did not return a usable answer. Please try again.');
  return json;
}

const cleanLine = (v, max) => String(v ?? '').replace(/[*#_`]+/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function POST(request) {
  try {
    if (!groqConfigured()) return fail('The AI is not set up on this server (GROQ_API_KEY is missing).', 503);
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);

    const gate = await limit(`news:ai:${who.user.id}`, 20, 60 * 1000);
    if (!gate.allowed) return tooManyRequests(gate.retryAfterSec, 'That is a lot of AI requests in a minute. Please wait a moment.');

    if (body.action === 'draft') {
      const topic = clip(body.topic, 300);
      const notes = clip(body.notes, 8000);
      const source = clip(body.source, 12000);
      if (!topic && !notes && !source) return fail('Tell the AI what the article is about, or paste your notes.');
      const tone = TONES[body.tone] ? body.tone : 'news';
      const length = LENGTHS[body.length] ? body.length : 'medium';
      const json = await ask(`Write ${TONES[tone]}, up to ${LENGTHS[length]} long (shorter if the material is thin). Use one to three short subheadings when it runs past about 350 words.

TOPIC: ${topic || '(see the notes)'}

NOTES FROM THE CHURCH:
${notes || '(none)'}

SOURCE MATERIAL:
${source || '(none)'}

Reply as JSON:
{"title": "a headline under 90 characters, no clickbait",
 "summary": "one or two sentences under 220 characters that say what happened",
 "category": one of ${JSON.stringify(NEWS_CATEGORIES)},
 "tags": ["2 to 5 short topic tags"],
 "sections": [{"heading": "a short subheading, or empty for the opening part", "paragraphs": ["paragraph", "paragraph"]}]}`, 3000, 0.35);

      const sections = (Array.isArray(json.sections) ? json.sections : [])
        .map((s) => ({
          heading: cleanLine(s?.heading, 120),
          paragraphs: (Array.isArray(s?.paragraphs) ? s.paragraphs : []).map((p) => String(p ?? '').replace(/[*#`]+/g, '').trim()).filter(Boolean).slice(0, 12),
        }))
        .filter((s) => s.paragraphs.length);
      if (!sections.length) return fail('The AI did not write an article from that. Add a few more details and try again.', 502);
      return NextResponse.json({
        success: true,
        data: {
          title: cleanLine(json.title, 200),
          summary: cleanLine(json.summary, 400),
          category: NEWS_CATEGORIES.includes(json.category) ? json.category : null,
          tags: (Array.isArray(json.tags) ? json.tags : []).map((t) => cleanLine(t, 30)).filter(Boolean).slice(0, 5),
          sections,
        },
      });
    }

    if (body.action === 'title') {
      const text = clip(body.text, 8000);
      if (!text && !body.summary) return fail('Write some of the article first, then generate a title from it.');
      const json = await ask(`Suggest three headlines for this church news article. Each under 90 characters, clear and specific, no clickbait, no ending period.

CURRENT TITLE: ${clip(body.title, 200) || '(none)'}
SUMMARY: ${clip(body.summary, 500) || '(none)'}
ARTICLE:
${text || '(not written yet)'}

Reply as JSON: {"titles": ["", "", ""]}`, 400, 0.8);
      const titles = (Array.isArray(json.titles) ? json.titles : []).map((t) => cleanLine(t, 200)).filter(Boolean).slice(0, 3);
      if (!titles.length) return fail('The AI did not suggest a title. Please try again.', 502);
      return NextResponse.json({ success: true, data: { titles } });
    }

    if (body.action === 'summary') {
      const text = clip(body.text, 8000);
      if (!text) return fail('Write some of the article first, then generate a summary from it.');
      const json = await ask(`Write the summary that appears under the headline and when this article is shared: one or two sentences, under 220 characters, saying what happened and why it matters.

TITLE: ${clip(body.title, 200) || '(none)'}
ARTICLE:
${text}

Reply as JSON: {"summary": ""}`, 400, 0.5);
      const summary = cleanLine(json.summary, 400);
      if (!summary) return fail('The AI did not write a summary. Please try again.', 502);
      return NextResponse.json({ success: true, data: { summary } });
    }

    // Several paragraphs at once ("make the whole article natural"): one
    // request instead of one per paragraph.
    if (body.action === 'rewrite' && Array.isArray(body.items)) {
      const mode = MODES[body.mode] ? body.mode : 'polish';
      const items = body.items
        .map((i) => ({ key: clip(i?.key, 80), text: clip(i?.text, 5000) }))
        .filter((i) => i.key && i.text)
        .slice(0, 20);
      if (!items.length) return fail('There is no text to rewrite yet.');
      const json = await ask(`${MODES[mode]}
Rewrite the "text" of every item; keep each "key" exactly as it is. Keep every fact as it is. ${MARKUP_RULE}

ITEMS:
${JSON.stringify(items)}

Reply as JSON: {"items": [{"key": "", "text": ""}]}`, 6000, mode === 'natural' ? 0.7 : 0.5);
      const wanted = new Set(items.map((i) => i.key));
      const out = (Array.isArray(json.items) ? json.items : [])
        .map((i) => ({ key: String(i?.key || ''), text: String(i?.text ?? '').replace(/`+/g, '').trim() }))
        .filter((i) => wanted.has(i.key) && i.text);
      if (!out.length) return fail('The AI did not return any text. Please try again.', 502);
      return NextResponse.json({ success: true, data: { items: out } });
    }

    if (body.action === 'rewrite') {
      const text = clip(body.text, 6000);
      const mode = MODES[body.mode] ? body.mode : 'polish';
      if (!text) return fail('There is no text in that block to rewrite.');
      const json = await ask(`${MODES[mode]}
Keep every fact as it is. ${MARKUP_RULE}

TEXT:
${text}

Reply as JSON: {"text": ""}`, 2200, mode === 'natural' ? 0.7 : 0.5);
      const out = String(json.text ?? '').replace(/`+/g, '').trim();
      if (!out) return fail('The AI did not return any text. Please try again.', 502);
      return NextResponse.json({ success: true, data: { text: out } });
    }

    if (body.action === 'highlight') {
      const items = (Array.isArray(body.items) ? body.items : [])
        .map((i) => ({ key: clip(i?.key, 80), text: clip(i?.text, 4000) }))
        .filter((i) => i.key && i.text)
        .slice(0, 40);
      if (!items.length) return fail('There is no text to highlight yet.');
      const json = await ask(`Pick the words a reader skimming this church news article should see first, to be shown in bold: names of people and groups, dates and times, places, numbers, and the one or two key terms of each paragraph.
For each item pick 1 to 4 short phrases (1 to 5 words each). Copy each phrase EXACTLY as it appears in that item's text - same spelling, same capitals - and never change the text. Do not pick whole sentences, and skip an item that has nothing worth highlighting.

ITEMS:
${JSON.stringify(items)}

Reply as JSON: {"highlights": [{"key": "", "phrases": [""]}]}`, 1500, 0.2);
      const byKey = new Map(items.map((i) => [i.key, i.text]));
      const highlights = (Array.isArray(json.highlights) ? json.highlights : [])
        .map((h) => {
          const text = byKey.get(String(h?.key || ''));
          if (!text) return null;
          // Only phrases that really are in the text, so nothing is invented.
          const phrases = [...new Set((Array.isArray(h.phrases) ? h.phrases : [])
            .map((p) => String(p || '').trim())
            .filter((p) => p.length >= 2 && p.length <= 60 && p.split(/\s+/).length <= 6 && text.includes(p)))].slice(0, 5);
          return phrases.length ? { key: h.key, phrases } : null;
        })
        .filter(Boolean);
      return NextResponse.json({ success: true, data: { highlights } });
    }

    if (body.action === 'translate') {
      const lang = LANG_GUIDE[body.lang] ? body.lang : null;
      if (!lang) return fail('Choose Tagalog or Bisaya.');
      const items = (Array.isArray(body.items) ? body.items : [])
        .map((i) => ({ key: clip(i?.key, 80), text: clip(i?.text, 9000) }))
        .filter((i) => i.key && i.text)
        .slice(0, 30);
      if (!items.length) return fail('There is nothing to translate.');
      const { text } = await groqChat({
        messages: [
          {
            role: 'system',
            content: `You are a careful translator for ${CHURCH_FULL_NAME}, a church in Cebu City, Philippines. Translate church news from English into ${LANG_GUIDE[lang]}
Translate the meaning faithfully and completely: no adding, no leaving out, no summarising. Keep names of people, the church, ministries, events and places as they are. Keep numbers, dates and times correct (write dates the way they are normally written in that language). Translate Bible verses faithfully.
${MARKUP_RULE}
Reply with one JSON object only.`,
          },
          {
            role: 'user',
            content: `Translate the "text" of every item. Keep each "key" exactly as it is.

ITEMS:
${JSON.stringify(items)}

Reply as JSON: {"items": [{"key": "", "text": ""}]}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 6000,
        responseFormat: { type: 'json_object' },
      });
      const json = parseJson(text);
      const wanted = new Set(items.map((i) => i.key));
      const out = (Array.isArray(json?.items) ? json.items : [])
        .map((i) => ({ key: String(i?.key || ''), text: String(i?.text ?? '').replace(/`+/g, '').trim() }))
        .filter((i) => wanted.has(i.key) && i.text);
      if (!out.length) return fail('The AI did not return a translation. Please try again.', 502);
      return NextResponse.json({ success: true, data: { items: out } });
    }

    return fail('Unknown AI action.');
  } catch (error) {
    console.error('[news ai]', error.message);
    return fail(error.message || 'The AI could not finish that. Please try again.', 502);
  }
}
