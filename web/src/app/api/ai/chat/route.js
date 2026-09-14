import { NextResponse } from 'next/server';
import { groqChat, groqConfigured } from '@/lib/groq';

export const dynamic = 'force-dynamic';

// The browser's way to the AI.
//
// WHY IT EXISTS: the chatbot, the daily verse and the Bible reader used to call
// Groq straight from the page, with the key in an Authorization header built in
// the browser. That key was in the public site's own JavaScript, readable by
// anyone who opened the dev tools, and spendable by anyone who copied it. The
// key now stays on the server and the page asks this route instead.
//
// The response keeps Groq's own shape - { choices: [{ message: { content } }] }
// - so the pages that already read `data.choices[0].message.content` did not
// have to learn a new one.

// A reply is a few paragraphs, not a book. Capped here as well as at each call
// site, because the cap at the call site is now something a browser can edit.
const MAX_TOKENS_CEILING = 4000;
const MAX_MESSAGES = 24;
const MAX_CHARS = 24000;

const ROLES = new Set(['system', 'user', 'assistant']);

export async function POST(request) {
  try {
    if (!groqConfigured()) {
      return NextResponse.json({
        success: false,
        message: 'The AI assistant is not set up on this server yet. Please add GROQ_API_KEY to the environment.',
      }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const raw = Array.isArray(body?.messages) ? body.messages : [];

    // Only the last few turns, and only the three roles the API knows. Anything
    // else arriving from a browser is dropped rather than forwarded.
    const messages = raw
      .filter((m) => m && ROLES.has(m.role) && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (messages.length === 0) {
      return NextResponse.json({ success: false, message: 'Nothing to ask.' }, { status: 400 });
    }

    const temperature = Math.min(2, Math.max(0, Number(body?.temperature ?? 0.7) || 0));
    const maxTokens = Math.min(MAX_TOKENS_CEILING, Math.max(1, Number(body?.max_tokens ?? body?.maxTokens ?? 800) || 800));

    const { text, model } = await groqChat({ messages, temperature, maxTokens });

    return NextResponse.json({
      success: true,
      model,
      // Groq's shape, kept on purpose - see the note above.
      choices: [{ message: { role: 'assistant', content: text } }],
    });
  } catch (error) {
    // Said out loud rather than returned as an empty answer. A model that has
    // been retired looks exactly like an assistant that cannot understand you,
    // and that is how this went unnoticed for as long as it did.
    console.error('[AI chat]', error.message);
    return NextResponse.json({ success: false, message: error.message }, { status: 502 });
  }
}
