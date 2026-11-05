import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, ministryAccessError, fullNameOf, USER_FIELDS } from '@/lib/ministryAuth';
import { describeRoleDetails } from '@/lib/userRoles';
import { loadHistory } from '@/lib/ministrySchedule';

// GET - A teammate: ?id=<user id>. Their ministry roles and their lineup
// history (six months back to three months ahead).
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  const { data: member } = id ? await supabase.from('users').select(USER_FIELDS).eq('id', id).maybeSingle() : { data: null };
  if (!member || ministryAccessError(member)) return NextResponse.json({ success: false, message: 'Teammate not found.' }, { status: 404 });
  try {
    const history = await loadHistory(member);
    return NextResponse.json({
      success: true,
      data: {
        id: member.id,
        name: fullNameOf(member),
        picture: member.profile_picture || null,
        groups: describeRoleDetails(member).filter((g) => g.key !== 'pastor').map((g) => ({ key: g.key || null, label: g.label, positions: g.chips })),
        ...history,
      },
    });
  } catch (error) {
    console.error('GET /api/ministry/member error:', error);
    return NextResponse.json({ success: false, message: 'Could not load their history. Try again.' }, { status: 500 });
  }
}
