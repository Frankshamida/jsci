// Answering a meeting: POST { actorId, meetingId, status: 'Going' | 'Maybe' | 'Not Going' }.
// Answers with the meeting as it now stands (who is going, with photos), so
// the card updates at once. (userId is still read for older pages.)

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadActor, canSee, loadPeople, loadRsvps, shapeMeeting } from '@/lib/meetingsServer';
import { RSVP_CHOICES, STILL_ON_MS } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

const REPLIES = {
  Going: 'See you there! We added it to your schedule.',
  Maybe: 'Marked as maybe. You can change your answer any time.',
  'Not Going': 'Thanks for letting them know. You can change your answer any time.',
};

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return bad('That request could not be read. Please try again.'); }
  try {
    const who = await loadActor(body.actorId || body.userId);
    if (who.error) return bad(who.error, who.status);
    const { user } = who;
    const status = body.status || 'Going';
    if (!RSVP_CHOICES.includes(status)) return bad('Please choose Going, Maybe or Not going.');
    if (!body.meetingId) return bad('Which meeting? Please open it again and retry.');

    const { data: row, error: findError } = await supabaseAdmin.from('ministry_meetings')
      .select('*').eq('id', String(body.meetingId)).maybeSingle();
    if (findError) throw findError;
    if (!row || !canSee(user, row)) return bad('This meeting is no longer available.', 404);
    if (row.status === 'Cancelled') return bad('This meeting was cancelled, so there is no need to answer.');
    if (row.status === 'Completed' || new Date(row.meeting_date).getTime() < Date.now() - STILL_ON_MS) {
      return bad('This meeting has already happened.');
    }

    const { error } = await supabaseAdmin.from('meeting_rsvps')
      .upsert({ meeting_id: row.id, user_id: user.id, status }, { onConflict: 'meeting_id,user_id' });
    if (error) throw error;

    const [people, rsvps] = await Promise.all([loadPeople(), loadRsvps([row.id])]);
    const data = shapeMeeting(row, { viewer: user, people, rsvps: rsvps.get(row.id) || [] });
    return NextResponse.json({ success: true, data, message: REPLIES[status] });
  } catch (error) {
    console.error('meetings rsvp:', error?.message || error);
    return bad('Your answer could not be saved. Please try again in a moment.', 500);
  }
}
