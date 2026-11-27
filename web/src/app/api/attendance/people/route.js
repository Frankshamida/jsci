import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
// Every read fresh. On its own, force-dynamic does not stop Next 14 from
// keeping the database reads of a GET-only route in its data cache for good.
export const revalidate = 0;

// GET /api/attendance/people?actorId=..
// The people an attendance sheet lists (components/AttendanceManager): active
// accounts, by name. Admin and Super Admin only. It used to be read in the
// browser with the public key; the users table is closed to that key now
// (supabase/migrations/security_rls_lockdown.sql).
const ALLOWED = ['Admin', 'Super Admin'];

export async function GET(request) {
  try {
    const actorId = new URL(request.url).searchParams.get('actorId');
    if (!actorId) return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401 });
    const { data: actor } = await supabaseAdmin
      .from('users').select('id, role, additional_roles, is_active').eq('id', actorId).maybeSingle();
    if (!actor || actor.is_active === false || !getUserRoles(actor).some((r) => ALLOWED.includes(r))) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }
    const { data, error } = await supabaseAdmin
      .from('users').select('id, firstname, lastname, ministry').neq('is_active', false).order('firstname');
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
