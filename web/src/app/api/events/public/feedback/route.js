import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { clientIp, eventForPublicSlug } from '@/lib/eventAccess';
import { FEEDBACK_MAX_NAME, FEEDBACK_MAX_WORDS, countWords } from '@/lib/eventPublic';
import { rateLimit } from '@/lib/serverCache';

const MIGRATION_HINT = 'Feedback needs its migration: run supabase/migrations/event_feedback_and_photo_hearts.sql.';

// POST /api/events/public/feedback  { slug, name, anonymous, message }
//   Feedback from the public event page, once the event is over. No login.
//   A name, or anonymous - and anonymous keeps no name at all, so there is
//   nothing for anybody to look up later. Up to FEEDBACK_MAX_WORDS words.
//   Read by Admin / Super Admin through /api/events/feedback.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const anonymous = body.anonymous === true;
    const name = anonymous ? '' : String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, FEEDBACK_MAX_NAME);
    const message = String(body.message || '').trim();
    const words = countWords(message);

    if (!anonymous && !name) {
      return NextResponse.json({ success: false, message: 'Enter your name, or choose to send it anonymously.' }, { status: 400 });
    }
    if (words === 0) {
      return NextResponse.json({ success: false, message: 'Write your feedback first.' }, { status: 400 });
    }
    if (words > FEEDBACK_MAX_WORDS || message.length > FEEDBACK_MAX_WORDS * 12) {
      return NextResponse.json({ success: false, message: `Please keep it to ${FEEDBACK_MAX_WORDS} words.` }, { status: 400 });
    }

    const event = await eventForPublicSlug(body.slug);
    if (!event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    // A few per address per event: enough for a family sharing one phone,
    // not enough to flood the list.
    if (!rateLimit(`event-feedback:${event.id}:${clientIp(request)}`, 5, 10 * 60_000).allowed) {
      return NextResponse.json({ success: false, message: 'Thank you - you have sent a lot of feedback already. Please try again in a few minutes.' }, { status: 429 });
    }

    const { error } = await supabaseAdmin.from('event_feedback').insert([{
      event_id: event.id,
      name: anonymous ? null : name,
      is_anonymous: anonymous,
      message,
      word_count: words,
    }]);
    if (error) {
      const missing = /event_feedback/i.test(error.message || '');
      return NextResponse.json({ success: false, message: missing ? MIGRATION_HINT : error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
