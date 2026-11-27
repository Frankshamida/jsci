import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/profile/me?userId=..
// The signed-in account as it is now, for the dashboard to keep up with
// changes an Admin makes (a role, a ministry, verification) and to notice an
// account that was deleted. The dashboard used to listen for these over
// Supabase Realtime with the public key; the tables are closed to that key now
// (supabase/migrations/security_rls_lockdown.sql), so it asks here instead,
// every few minutes (POLL_MS.ownAccount).
//
// Only what the dashboard shows of the account itself: never the e-mail,
// password, security answer or anything else stored about it.
// ============================================================

const FIELDS = 'id, firstname, lastname, role, additional_roles, status, is_active, ministry, sub_role, birthdate, life_verse, profile_picture';

export async function GET(request) {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin.from('users').select(FIELDS).eq('id', String(userId)).maybeSingle();
    if (error) throw error;
    return NextResponse.json(
      data ? { success: true, exists: true, user: data } : { success: true, exists: false },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ success: false, message: 'The account could not be checked just now.' }, { status: 500 });
  }
}
