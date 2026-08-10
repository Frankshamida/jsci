import { NextResponse } from 'next/server';
import { cached, rateLimit } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

// Prefer the server-only key. NEXT_PUBLIC_* is only a temporary fallback so this
// keeps working before the env var is renamed — it should be removed, because anything
// NEXT_PUBLIC_ is inlined into the browser bundle where the key can be lifted.
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Small/fast model — moderation is a short classification, so the large model is waste.
const MODEL = 'llama-3.1-8b-instant';

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
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Check this message: "${content}"` },
      ],
      temperature: 0.3,
      max_tokens: 120,
      response_format: { type: 'json_object' },
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    // Fail open: moderation is a best-effort assist on top of the word-list check,
    // so an upstream outage must not block users from posting.
    console.warn('Groq moderation call failed:', res.status);
    return SAFE;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim();
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
    if (!GROQ_API_KEY) {
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
