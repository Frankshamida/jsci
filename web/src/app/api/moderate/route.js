import { NextResponse } from 'next/server';
import { GROQ_FAST_MODEL, groqChat, groqConfigured } from '@/lib/groq';
import { cached, rateLimit } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';


// Small/fast model — moderation is a short classification, so the large model is waste.
// Named in src/lib/groq.js, which is the one place a retired model gets replaced.
const MODEL = GROQ_FAST_MODEL;

// Identical text gets one upstream call; repeats are served from cache.
const RESULT_TTL_MS = 10 * 60 * 1000;

// Quota backstop. Groq's free tier is limited per-minute and per-day, so cap what a
// single user can trigger and keep a global ceiling in case something loops.
const PER_USER_LIMIT = 10;
const PER_USER_WINDOW_MS = 60 * 1000;
const GLOBAL_LIMIT = 60;
const GLOBAL_WINDOW_MS = 60 * 1000;

const SAFE = { isSafe: true, reason: null, suggestion: null };

const SYSTEM_PROMPT = `You are a content moderation classifier. Analyse the message for:
1. Profanity/abuse in English, Tagalog, Bisaya, or Gen Z slang
2. Self-harm or suicide ideation (direct or indirect)
3. Harassment or bullying
4. Emotionally harmful intent

Respond ONLY with JSON: {"isSafe": boolean, "reason": "brief reason if unsafe", "suggestion": "cleaner rewording if applicable"}
If the message is fine, respond exactly: {"isSafe": true, "reason": null, "suggestion": null}`;

async function callGroq(content) {
  let raw;
  try {
    // Through the shared helper, so the reasoning-token budget and the
    // retired-model fallback are handled the same way here as everywhere else.
    const out = await groqChat({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Check this message: "${content}"` },
      ],
      temperature: 0.3,
      maxTokens: 120,
      responseFormat: { type: 'json_object' },
    });
    raw = out.text;
  } catch (error) {
    // Fail open: moderation is a best-effort assist on top of the word-list check,
    // so an upstream outage must not block users from posting.
    console.warn('Groq moderation call failed:', error.message);
    return SAFE;
  }

  if (!raw) return SAFE;

  try {
    const parsed = JSON.parse(raw);
    return {
      isSafe: parsed.isSafe !== false,
      reason: parsed.reason || null,
      suggestion: parsed.suggestion || null,
    };
  } catch {
    return SAFE;
  }
}

export async function POST(request) {
  try {
    const { content, userId } = await request.json();

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ success: true, data: SAFE });
    }
    if (!groqConfigured()) {
      // Not configured — the client-side word list still applies.
      return NextResponse.json({ success: true, data: SAFE, skipped: 'not-configured' });
    }

    const global = rateLimit('groq:moderate:global', GLOBAL_LIMIT, GLOBAL_WINDOW_MS);
    const perUser = rateLimit(`groq:moderate:${userId || 'anon'}`, PER_USER_LIMIT, PER_USER_WINDOW_MS);
    if (!global.allowed || !perUser.allowed) {
      // Over budget: fall back to the word-list verdict rather than spending quota.
      return NextResponse.json({ success: true, data: SAFE, skipped: 'rate-limited' });
    }

    const key = `groq:moderate:${content.trim().toLowerCase().slice(0, 500)}`;
    const data = await cached(key, RESULT_TTL_MS, () => callGroq(content));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    // Never block posting because moderation itself errored.
    console.warn('Moderation route error:', error?.message);
    return NextResponse.json({ success: true, data: SAFE, skipped: 'error' });
  }
}
