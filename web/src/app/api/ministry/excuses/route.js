import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { coverableRoleTypes } from '@/lib/ministryApp';
import { POST as createExcuse, DELETE as deleteExcuse } from '@/app/api/lineup/excuses/route';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

// POST - File an excuse for a date: { date, reason, roleType }.
// The rest (notifying the admins) is the website's excuse route.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { date, reason, roleType } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return bad('Pick a date.');
  if (date < new Date().toISOString().slice(0, 10)) return bad('Pick a date from today on.');
  if (!String(reason || '').trim()) return bad('Write a short reason.');
  const roles = coverableRoleTypes(user.sub_role);
  const role = roleType || roles[0];
  if (!roles.includes(role)) return bad('That is not one of your positions.');

  return createExcuse(internalJson('/api/lineup/excuses', 'POST', {
    userId: user.id,
    userName: fullNameOf(user),
    excuseDate: date,
    reason: String(reason).trim().slice(0, 500),
    roleType: role,
    profilePicture: user.profile_picture || null,
  }));
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
