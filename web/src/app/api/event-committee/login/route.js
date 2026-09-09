import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { EVENT_MANAGER_ROLES } from '@/lib/eventCommittee';

// The committee signs in with the account it registered with on the main site.
// Same table, same password hash, same "forgot password" - this route differs
// from /api/auth/login in exactly one way: after the password checks out, the
// account must also have been put on the committee by an Admin.
//
// Somebody who has an account but has not been added yet is NOT told "invalid
// password" - they are told they are waiting to be assigned, because that is a
// completely different thing to fix and sending them back to retype a correct
// password helps nobody.

export async function POST(request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, message: 'Email and password are required' }, { status: 400 });
    }

    // The committee columns may predate their migration on some databases, so
    // the flags are read separately and the login still works without them.
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 });
    }

    if (user.password === 'GOOGLE_AUTH') {
      return NextResponse.json({
        success: false,
        message: 'This account signs in with Google. Set a password from your main dashboard first, then use it here.',
      }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 });
    }

    if (user.is_active === false) {
      return NextResponse.json({ success: false, message: 'Account has been deactivated. Contact admin.' }, { status: 403 });
    }

    const isManager = EVENT_MANAGER_ROLES.includes(user.role);
    const isCommittee = user.is_event_committee === true;

    if (!isManager && !isCommittee) {
      // The password was right. Say so plainly, and say what is missing.
      return NextResponse.json({
        success: false,
        code: 'NOT_COMMITTEE',
        message: 'Your account is not on the Event Committee yet. An Admin needs to add you before you can open this dashboard.',
      }, { status: 403 });
    }

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    // An empty assignment list means every event - see the migration.
    const assigned = Array.isArray(user.committee_events) ? user.committee_events.filter(Boolean) : [];

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        memberId: user.member_id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role || 'Guest',
        profile_picture: user.profile_picture || null,
        isEventManager: isManager,
        isCommittee,
        // Managers are never scoped - they run every event.
        committeeEvents: isManager ? [] : assigned,
      },
    });
  } catch (error) {
    console.error('Committee login error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
