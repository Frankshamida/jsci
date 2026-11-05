import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { limit, tooManyRequests } from '@/lib/rateLimiter';
import { supabase } from '@/lib/supabase';
import { issueMinistryToken, ministryAccessError, USER_FIELDS } from '@/lib/ministryAuth';
import { ministryProfile } from '@/lib/ministryApp';

// POST - Sign in to the JSCI Ministry app. Ministry Members only.
// Returns a session token the app keeps in the phone's secure storage.
export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, message: 'Enter your email and password.' }, { status: 400 });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    // Same guard as the website's login: per account, before bcrypt.
    const attempt = await limit(`login:${cleanEmail}`, 10, 15 * 60 * 1000, { shared: true });
    if (!attempt.allowed) {
      return tooManyRequests(attempt.retryAfterSec, 'Too many sign-in attempts. Please wait a few minutes and try again.');
    }

    // Short, field-specific answers (the app shows them under the field):
    //   field 'email'     not registered / not in a ministry
    //   field 'password'  wrong password
    const { data: user } = await supabase.from('users').select(`${USER_FIELDS}, password`).eq('email', cleanEmail).maybeSingle();
    if (!user) return NextResponse.json({ success: false, field: 'email', message: 'Email not registered.' }, { status: 401 });
    if (user.password === 'GOOGLE_AUTH') {
      return NextResponse.json({
        success: false,
        message: 'This account signs in with Google. Set a password on the website (My Profile > Change Password), then sign in here.',
      }, { status: 401 });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ success: false, field: 'password', message: 'Wrong password.' }, { status: 401 });
    }

    const denied = ministryAccessError(user);
    if (denied) {
      // Signed up, but not a Ministry Member: "not registered to a ministry".
      const notMinistry = denied.startsWith('JSCI Ministry is for');
      return NextResponse.json({ success: false, field: notMinistry ? 'email' : null, message: notMinistry ? 'Not registered to a ministry.' : denied }, { status: 403 });
    }

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    return NextResponse.json({ success: true, data: { token: issueMinistryToken(user.id), profile: ministryProfile(user) } });
  } catch (error) {
    console.error('POST /api/ministry/login error:', error);
    return NextResponse.json({ success: false, message: 'Could not sign in right now. Please try again.' }, { status: 500 });
  }
}
