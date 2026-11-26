import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { formatAccountName } from '@/lib/eventFormat';
import { clientIp, limit, tooManyRequests } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';

// POST /api/auth/google/complete { accessToken, mode: 'login' | 'signup' }
//
// The end of a Google sign-in. The browser has a Supabase session from Google
// (/auth/callback); it hands the session's access token here, and the server
// asks Supabase whose it is - so the account is found or made from a Google
// identity Supabase vouches for, never from an email the browser typed.
//
// This used to happen in the browser, reading and writing the users table with
// the public key. The tables are locked to that key now
// (supabase/migrations/security_rls_lockdown.sql), so it happens here.
//
// Replies: { success, data: <session user>, created } or
//          { success: false, code: 'auth_failed' | 'deactivated' | 'no_account' | 'create_failed' }

const fail = (code, message, status) => NextResponse.json({ success: false, code, message }, { status });

const sessionUser = (u, extra = {}) => ({
  id: u.id,
  memberId: u.member_id,
  firstname: u.firstname,
  lastname: u.lastname,
  email: u.email,
  birthdate: u.birthdate || null,
  life_verse: u.life_verse || null,
  ministry: u.ministry || null,
  sub_role: u.sub_role || null,
  role: u.role || 'Guest',
  additional_roles: u.additional_roles || [],
  default_dashboard: u.default_dashboard || null,
  status: u.status,
  isActive: u.is_active !== false,
  isGoogleUser: true,
  hasPassword: u.password !== 'GOOGLE_AUTH',
  profile_picture: u.profile_picture || null,
  allowed_event_types: u.allowed_event_types || [],
  ...extra,
});

export async function POST(request) {
  try {
    const attempt = await limit(`google-complete:${clientIp(request)}`, 20, 10 * 60 * 1000, { shared: true });
    if (!attempt.allowed) return tooManyRequests(attempt.retryAfterSec, 'Too many sign-in attempts. Please wait a few minutes.');

    const body = await request.json().catch(() => ({}));
    const token = String(body.accessToken || '');
    const mode = body.mode === 'signup' ? 'signup' : 'login';
    if (!token) return fail('auth_failed', 'No Google session.', 401);

    // Whose session is this? Supabase checks the token's signature and expiry.
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
    const googleUser = auth?.user;
    if (authError || !googleUser?.id) return fail('auth_failed', 'The Google sign-in could not be confirmed.', 401);

    const email = String(googleUser.email || '').trim().toLowerCase();
    const meta = googleUser.user_metadata || {};
    const fullName = String(meta.full_name || meta.name || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstname = parts[0] || '';
    const lastname = parts.slice(1).join(' ');
    const avatar = meta.avatar_url || meta.picture || null;

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('users').select('*').eq('google_id', googleUser.id).maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      if (existing.is_active === false) return fail('deactivated', 'Account has been deactivated. Contact admin.', 403);
      const update = { last_login: new Date().toISOString() };
      if (avatar) update.profile_picture = avatar;
      if (fullName && !existing.firstname) update.firstname = firstname;
      if (fullName && !existing.lastname) update.lastname = lastname;
      await supabaseAdmin.from('users').update(update).eq('id', existing.id);
      return NextResponse.json({
        success: true,
        created: false,
        data: sessionUser({ ...existing, ...update }, { profile_picture: avatar || existing.profile_picture || null }),
      });
    }

    if (mode === 'login') return fail('no_account', 'No account found. Please sign up first.', 404);

    const { data: created, error: insertError } = await supabaseAdmin.from('users').insert({
      // Google names come as typed into Google: saved as "Frank Dweezel Gomez"
      ...formatAccountName(firstname, lastname),
      google_id: googleUser.id,
      email,
      password: 'GOOGLE_AUTH',
      role: 'Guest',
      security_question: 'Google Account',
      security_answer: 'GOOGLE_AUTH',
      status: 'Unverified',
      profile_picture: avatar,
    }).select('*').single();
    if (insertError) {
      console.error('[google complete] create:', insertError.message);
      return fail('create_failed', 'Error creating account. Please try again.', 500);
    }
    return NextResponse.json({ success: true, created: true, data: sessionUser(created, { hasPassword: false }) });
  } catch (error) {
    console.error('[google complete]', error.message);
    return fail('unknown', 'An error occurred. Please try again.', 500);
  }
}
