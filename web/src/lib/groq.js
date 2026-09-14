// Talking to Groq, in one place.
//
// SERVER ONLY. Nothing in this file may be imported from a component that runs
// in the browser - it reads the API key, and a key that reaches the client is a
// key anybody can read out of the page source and spend.
//
// WHY THIS FILE EXISTS: the model name used to be written out at each of the
// seventeen places that called Groq. When Groq decommissioned
// `llama-3.3-70b-versatile` every one of them started answering 404, and the
// app had no single AI feature left working - the chatbot, the daily verse, the
// Bible reader, the lyrics tools and moderation all went at once. The name now
// lives here, so the next retirement is a one-line change rather than a hunt.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Read server-side only. NEXT_PUBLIC_GROQ_API_KEY is still accepted because
// that is where the key already lives in existing .env files - but referenced
// from HERE it never reaches the browser, because Next only inlines those vars
// into the client bundle where client code asks for them.
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || '';

// In preference order. The first is what everything uses; the rest are tried
// only when a model has been retired, so a decommission degrades the answers
// for a while instead of taking the whole app's AI down with no warning.
export const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

export const GROQ_MODEL = GROQ_MODELS[0];

// Short classification work - moderation, a yes/no - does not need the big
// model, and the small one answers faster and costs less quota.
export const GROQ_FAST_MODEL = 'openai/gpt-oss-20b';

// These are REASONING models: they think before they answer, and the thinking
// is charged against max_tokens. A request for 200 tokens spent all 200 on
// reasoning and came back with content: "" and finish_reason: "length" - an
// empty answer that looks exactly like a broken assistant.
//
// Two things stop that. The reasoning is kept short, and the caller's budget is
// topped up by the reserve below so the answer they asked for still fits.
const REASONING_EFFORT = 'low';
const REASONING_RESERVE = 512;

export function groqConfigured() {
  return GROQ_API_KEY.length > 0;
}

// Groq says a model is gone in a few shapes depending on how it was retired.
function isRetiredModel(status, payload) {
  if (status !== 404 && status !== 400) return false;
  const code = payload?.error?.code || '';
  const message = String(payload?.error?.message || '').toLowerCase();
  return code === 'model_not_found'
    || message.includes('does not exist')
    || message.includes('decommission')
    || message.includes('has been deprecated');
}

/**
 * One chat completion.
 *
 * Throws on failure rather than returning something empty: every caller used to
 * turn "the request failed" into a cheerful "Sorry, I didn't quite catch that",
 * which is how a dead model went unnoticed - the assistant looked like it was
 * working and simply not understanding anyone.
 *
 * @returns {{ text: string, model: string }}
 */
export async function groqChat({ messages, temperature = 0.7, maxTokens = 800, model, responseFormat }) {
  if (!groqConfigured()) {
    throw new Error('The AI service is not configured on this server (GROQ_API_KEY is missing).');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No messages to send.');
  }

  // A caller may name a model; otherwise the list is walked in order.
  const candidates = model ? [model, ...GROQ_MODELS.filter((m) => m !== model)] : GROQ_MODELS;
  let lastRetired = null;

  for (const candidate of candidates) {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: candidate,
        messages,
        temperature,
        reasoning_effort: REASONING_EFFORT,
        max_tokens: maxTokens + REASONING_RESERVE,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    });

    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }

    if (res.ok) {
      const choice = payload?.choices?.[0];
      const text = choice?.message?.content?.trim() || '';
      if (text) return { text, model: candidate };
      // Empty, having run out of room mid-thought. Worth its own message: this
      // is a budget to raise, not an outage to wait out.
      if (choice?.finish_reason === 'length') {
        throw new Error('The AI ran out of room before it finished answering. Please try a shorter question.');
      }
      throw new Error('The AI returned an empty answer. Please try again.');
    }

    // Retired model: note it and try the next one down the list.
    if (isRetiredModel(res.status, payload)) {
      lastRetired = candidate;
      continue;
    }

    // Anything else is a real failure and is reported as itself - a bad key, a
    // rate limit and a malformed request need three different answers from
    // whoever is reading the logs.
    const detail = payload?.error?.message || `Groq returned ${res.status}.`;
    throw new Error(detail);
  }

  throw new Error(
    `Every configured AI model has been retired (last tried: ${lastRetired}). `
    + 'Update GROQ_MODELS in src/lib/groq.js to a model this account can reach.',
  );
}
