import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { groqChat, groqConfigured } from '@/lib/groq';
import { limit, tooManyRequests } from '@/lib/rateLimiter';
import { CARE_ROLES, CARE_MIGRATION_NOTE, STEP_KINDS, URGENCY } from '@/lib/joyfulCares';
import { loadCare, aiInput, basisOf, careTablesMissing } from '@/lib/joyfulCaresServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// ============================================================
// POST /api/cares/ai  { actorId, memberId, refresh? }
// A caring next step for one member, and a short message a Pastor could send,
// in English, Tagalog and Cebuano. The AI (Groq, as Joy uses) is given the
// numbers and the member's own excuse notes - never their name, never what the
// Pastors wrote. The drafts say {name}; the page puts the first name in.
// The answer is kept (care_people.ai_*) and asked for again only when what it
// rests on has changed, or a Pastor asks for a fresh one.
// ============================================================

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

const SYSTEM = `You help the pastors of Joyful Sound Church International, a church in Cebu, Philippines, care for the members who serve in its ministries (singers, musicians, dancers, media, ushers).

You are given what the church's app has noticed about one member, called "Member A": Sunday check-ins, lineup duties, practices, the excuses they sent in their own words, and substitute requests. Suggest one caring next step for a pastor, and write a short message the pastor could send.

Rules:
- Assume the best. Absences have many reasons: work, school, family, illness, travel, or simply not checking in.
- Never diagnose or label. Do not use words like depressed, backslidden, lazy, uncommitted, problem.
- Suggest a counselling talk only when their own words point to grief, illness, conflict, stress, or a crisis. Otherwise prefer encouragement, a call, a visit, prayer, or practical help.
- Keep the summary to two or three sentences, plain and kind.
- The message: two or three warm sentences from the pastor, starting with a greeting to {name}. Do not mention numbers, tracking, attendance records or the app; do not make them feel watched or scolded. No sign-off name.
- Write the message three times: English, Tagalog, and Cebuano (Bisaya), each natural in its own language.

Answer with ONLY a JSON object, no other text:
{"summary": "...", "step": "one sentence: what to do", "stepKind": "encourage|call|visit|pray|practical|counsel", "urgency": "low|medium|high", "drafts": {"en": "...", "tl": "...", "ceb": "..."}}`;

function parse(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI did not answer in the expected shape. Please try again.');
  const j = JSON.parse(raw.slice(start, end + 1));
  const clean = (v, max) => String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
  const drafts = {};
  ['en', 'tl', 'ceb'].forEach((k) => { drafts[k] = clean(j.drafts?.[k], 700); });
  const out = {
    summary: clean(j.summary, 700),
    step: clean(j.step, 300),
    stepKind: STEP_KINDS[j.stepKind] ? j.stepKind : 'encourage',
    urgency: URGENCY[j.urgency] ? j.urgency : 'low',
    drafts,
  };
  if (!out.summary || !out.drafts.en) throw new Error('The AI answer was incomplete. Please try again.');
  return out;
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const who = await requireRole(body.actorId, CARE_ROLES);
  if (who.error) return bad(who.error, who.status);
  if (!groqConfigured()) return bad('The AI is not set up on this site yet (GROQ_API_KEY is missing).', 503);

  try {
    const data = await loadCare();
    const m = data.members.find((x) => x.id === String(body.memberId || ''));
    if (!m) return bad('That member was not found among the ministry members.', 404);
    const basis = basisOf(m);
    if (!body.refresh && m.ai && m.ai.hash === basis) {
      return NextResponse.json({ success: true, ai: m.ai, fresh: true, cached: true });
    }

    const gate = await limit(`cares-ai:${who.user.id}`, 40, 60 * 60 * 1000);
    if (!gate.allowed) return tooManyRequests(gate.retryAfterSec, 'That is a lot of suggestions for one hour. Please wait a little and try again.');

    const { text } = await groqChat({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(aiInput(m, data.today), null, 2) },
      ],
      temperature: 0.4,
      maxTokens: 1200,
    });
    const ai = { ...parse(text), at: new Date().toISOString(), hash: basis };

    if (data.tablesReady) {
      const { error } = await supabaseAdmin.from('care_people').upsert({
        member_id: m.id,
        ai_summary: ai.summary,
        ai_step: ai.step,
        ai_step_kind: ai.stepKind,
        ai_urgency: ai.urgency,
        ai_drafts: ai.drafts,
        ai_hash: basis,
        ai_at: ai.at,
        updated_at: ai.at,
      }, { onConflict: 'member_id' });
      if (error && !careTablesMissing(error)) throw error;
    }
    return NextResponse.json({ success: true, ai, fresh: true, saved: data.tablesReady, note: data.tablesReady ? null : CARE_MIGRATION_NOTE });
  } catch (error) {
    console.error('cares ai:', error?.message || error);
    return bad(error?.message && /AI|JSON|answer/i.test(error.message) ? error.message : 'The suggestion could not be made just now. Please try again.', 502);
  }
}
