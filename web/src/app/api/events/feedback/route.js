import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// Event feedback, as left on the public event page (see
// /api/events/public/feedback). Admin / Super Admin only.
//
//   GET    ?actorId=..[&eventId=..]   newest first, every event or one
//   DELETE ?actorId=..&id=..          remove one (spam, or something posted twice)

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/event_feedback_and_photo_hearts.sql first.';
const fail = (error) => NextResponse.json(
  { success: false, message: /event_feedback/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);
const denied = () => NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can read event feedback.' }, { status: 403 });

async function manager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (!(await manager(searchParams.get('actorId')))) return denied();
    let query = supabaseAdmin
      .from('event_feedback')
      .select('id, event_id, name, is_anonymous, message, word_count, created_at, event:events(id, title, event_date, end_date)')
      .order('created_at', { ascending: false })
      .limit(2000);
    const eventId = searchParams.get('eventId');
    if (eventId) query = query.eq('event_id', eventId);
    const { data, error } = await query;
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (!(await manager(searchParams.get('actorId')))) return denied();
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { error } = await supabaseAdmin.from('event_feedback').delete().eq('id', id);
    if (error) return fail(error);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
