import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { coverableRoleTypes, shapeLineup, churchDate, addDays } from '@/lib/ministryApp';
import { DELETE as deleteExcuse } from '@/app/api/lineup/excuses/route';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
// How far ahead an excuse can be filed.
const MAX_DAYS_AHEAD = 366;

// POST - File an excuse for any date from today on: { date, reason, roleType }.
// One excuse per date: a second one is refused. A rejected one can be filed
// again (it goes back to Pending with the new reason).
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { date, reason, roleType } = await request.json();
  const today = churchDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return bad('Pick a date.');
  if (date < today) return bad('Pick a date from today on.');
  if (date > addDays(today, MAX_DAYS_AHEAD)) return bad('Pick a date within the next year.');
  const why = String(reason || '').trim().slice(0, 500);
  if (!why) return bad('Write a short reason.');

  // The part: the one they are plotted in that day, else one of their positions.
  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_date', date).maybeSingle();
  const onLineup = schedule ? shapeLineup(schedule, user, {}).myRoleTypes : [];
  const roles = [...new Set([...onLineup, ...coverableRoleTypes(user.sub_role)])];
  const role = roleType || onLineup[0] || roles[0] || 'Member';
  if (roles.length && !roles.includes(role)) return bad('That is not one of your positions.');

  const { data: filed } = await supabase.from('lineup_excuses').select('id, status, role_type').eq('user_id', user.id).eq('excuse_date', date);
  const active = (filed || []).find((e) => e.status !== 'Rejected');
  if (active) return bad(`You have already filed an excuse for this date (${active.status === 'Approved' ? 'approved' : 'waiting for approval'}).`, 409);

  const row = { reason: why, status: 'Pending', role_type: role, profile_picture: user.profile_picture || null, user_name: fullNameOf(user), admin_note: null, reviewed_by: null };
  const rejected = (filed || []).find((e) => e.role_type === role);
  const { data, error } = rejected
    ? await supabase.from('lineup_excuses').update(row).eq('id', rejected.id).select().single()
    : await supabase.from('lineup_excuses').insert({ ...row, user_id: user.id, excuse_date: date }).select().single();
  if (error) {
    console.error('POST /api/ministry/excuses error:', error);
    return bad('Could not file the excuse. Try again.', 500);
  }
  return NextResponse.json({ success: true, message: 'Excuse filed. The Schedule Plotter will review it.', data });
}

// DELETE - Take back one of your own excuses while it is still pending: ?id=
export async function DELETE(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  const { data: excuse } = await supabase.from('lineup_excuses').select('id, user_id, status').eq('id', id).maybeSingle();
  if (!excuse || excuse.user_id !== auth.user.id) return bad('Excuse not found.', 404);
  if (excuse.status !== 'Pending') return bad('Only a pending excuse can be taken back.');
  return deleteExcuse(internalJson(`/api/lineup/excuses?id=${encodeURIComponent(id)}`, 'DELETE'));
}
