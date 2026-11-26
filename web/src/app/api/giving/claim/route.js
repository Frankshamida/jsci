import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, NO_STORE } from '@/lib/watchAccess';
import { GIFTS, cleanEmail, givingTablesMissing } from '@/lib/givingServer';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

// POST /api/giving/claim { userId, tokens }
// Gifts sent from this browser before signing in, added to the account - only
// the ones sent with the account's own email, and only while in no account.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!isUuid(body.userId)) return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401, headers: NO_STORE });
    const tokens = (Array.isArray(body.tokens) ? body.tokens : []).map(String).filter((t) => TOKEN_RE.test(t)).slice(0, 25);
    if (!tokens.length) return NextResponse.json({ success: true, linked: 0 }, { headers: NO_STORE });

    const { data: user } = await supabaseAdmin.from('users').select('id, email, is_active').eq('id', body.userId).maybeSingle();
    if (!user || user.is_active === false) return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401, headers: NO_STORE });

    const { data, error } = await supabaseAdmin
      .from(GIFTS).update({ user_id: user.id })
      .in('token', tokens).eq('donor_email', cleanEmail(user.email)).is('user_id', null)
      .select('token');
    if (error) {
      if (givingTablesMissing(error)) return NextResponse.json({ success: true, linked: 0 }, { headers: NO_STORE });
      throw error;
    }
    return NextResponse.json({ success: true, linked: (data || []).length, tokens: (data || []).map((g) => g.token) }, { headers: NO_STORE });
  } catch (error) {
    console.error('[giving claim]', error.message);
    return NextResponse.json({ success: false, message: 'Could not add your gifts to your account.' }, { status: 500, headers: NO_STORE });
  }
}
