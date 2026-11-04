import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { coverableRoleTypes, shapeLineup } from '@/lib/ministryApp';
import { POST as createSub, PUT as updateSub, DELETE as deleteSub } from '@/app/api/lineup/substitutes/route';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

// POST - Ask for a substitute for one of your parts: { scheduleId, roleType, reason }.
// An admin approves it, then the team with that position sees it open.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { scheduleId, roleType, reason } = await request.json();
  if (!String(reason || '').trim()) return bad('Write a short reason.');
  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_id', scheduleId).maybeSingle();
  if (!schedule) return bad('Lineup not found.', 404);
  const lineup = shapeLineup(schedule, user, {});
  if (!lineup.myRoleTypes.includes(roleType)) return bad('You are not on this lineup in that part.');
  if (lineup.date < new Date().toISOString().slice(0, 10)) return bad('That date has passed.');

  return createSub(internalJson('/api/lineup/substitutes', 'POST', {
    requesterId: user.id,
    requesterName: fullNameOf(user),
    requesterProfilePicture: user.profile_picture || null,
    scheduleId: schedule.schedule_id,
    scheduleDate: schedule.schedule_date,
    reason: String(reason).trim().slice(0, 500),
    roleType,
  }));
}

// PUT - { id, action: 'accept' } takes an open request you can cover;
//       { id, action: 'thank-you', message } thanks whoever covered yours.
export async function PUT(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id, action, message } = await request.json();
  const { data: sub } = await supabase.from('lineup_substitutes').select('*').eq('id', id).maybeSingle();
  if (!sub) return bad('Request not found.', 404);

  if (action === 'accept') {
    if (sub.requester_id === user.id) return bad('That is your own request.');
    if (sub.status !== 'Open for Sub') return bad('This request is no longer open.', 409);
    if (!coverableRoleTypes(user.sub_role).includes(sub.role_type || 'Song Leader')) return bad('That is not one of your positions.');
    // One person, one part: somebody already on that lineup cannot also cover.
    const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_date', sub.schedule_date).maybeSingle();
    if (schedule) {
      const lineup = shapeLineup(schedule, user, {});
      if (lineup.myParts.length) return bad(`You are already on that lineup (${lineup.myParts.join(', ')}).`, 409);
    }
    return updateSub(internalJson('/api/lineup/substitutes', 'PUT', {
      id, action: 'accept', substituteId: user.id, substituteName: fullNameOf(user), substituteProfilePicture: user.profile_picture || null,
    }));
  }

  if (action === 'thank-you') {
    if (sub.requester_id !== user.id || sub.status !== 'Accepted') return bad('Only the person who asked can send thanks.', 403);
    return updateSub(internalJson('/api/lineup/substitutes', 'PUT', {
      id, action: 'thank-you', thankYouMessage: String(message || '').trim().slice(0, 300) || undefined,
    }));
  }

  return bad('Unknown action.');
}

// DELETE - Cancel your own request before anybody takes it: ?id=
export async function DELETE(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  const { data: sub } = await supabase.from('lineup_substitutes').select('id, requester_id, status').eq('id', id).maybeSingle();
  if (!sub || sub.requester_id !== auth.user.id) return bad('Request not found.', 404);
  if (!['Pending Admin', 'Open for Sub'].includes(sub.status)) return bad('This request can no longer be cancelled.');
  return deleteSub(internalJson(`/api/lineup/substitutes?id=${encodeURIComponent(id)}`, 'DELETE'));
}
