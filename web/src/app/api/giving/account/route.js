import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';
import { clientIp, limit, tooManyRequests } from '@/lib/rateLimiter';
import { NO_STORE } from '@/lib/watchAccess';
import { formatAccountName } from '@/lib/eventFormat';
import { accountWithName, nameTakenForSelf } from '@/lib/nameClash';
import { GIFTS, cleanEmail, giftByToken, plain, sessionUser } from '@/lib/givingServer';

export const dynamic = 'force-dynamic';

const fail = (message, status = 400, extra = {}) => NextResponse.json({ success: false, message, ...extra }, { status, headers: NO_STORE });
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

// POST /api/giving/account { token, tokens?, firstname, lastname, password }
// "Yes, keep track of my giving": a free Guest account with the email the gift
// was sent with, and that gift (and any other this browser sent with the same
// email) in it. Signs in at once - the reply is the session, as from login.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const attempt = await limit(`giving:account:${clientIp(request)}`, 5, 30 * 60 * 1000, { shared: true });
    if (!attempt.allowed) return tooManyRequests(attempt.retryAfterSec, 'Please wait a few minutes before trying again.');

    const gift = await giftByToken(body.token);
    if (!gift) return fail('We could not find your gift. Please try again from the thank-you page.', 404);
    const email = cleanEmail(gift.donor_email);
    if (!email) return fail('This gift has no email address to make an account with.');
    if (gift.user_id) return fail('This gift is already in an account. Sign in to see it.', 409, { code: 'linked' });

    const firstname = plain(body.firstname, 60);
    const lastname = plain(body.lastname, 60);
    const password = String(body.password || '');
    if (!firstname || !lastname) return fail('Please enter your first and last name.');
    if (password.length < 8) return fail('Your password needs at least 8 characters.');

    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) return fail(`There is already an account with ${email}. Sign in to it, and your gift will be added.`, 409, { code: 'exists' });

    const name = formatAccountName(firstname, lastname);
    const twin = await accountWithName(name.firstname, name.lastname);
    if (twin) return fail(nameTakenForSelf(twin), 409);

    const { data: user, error } = await supabaseAdmin.from('users').insert({
      ...name,
      email,
      password: await bcrypt.hash(password, 12),
      role: 'Guest',
      ministry: null,
      security_question: 'N/A',
      security_answer: 'N/A',
      status: 'Unverified',
    }).select('*').single();
    if (error) throw error;

    // This gift, and the others this browser sent with the same email.
    const tokens = [...new Set([String(body.token), ...(Array.isArray(body.tokens) ? body.tokens : [])])]
      .filter((t) => TOKEN_RE.test(String(t))).slice(0, 25);
    await supabaseAdmin.from(GIFTS).update({ user_id: user.id }).in('token', tokens).eq('donor_email', email).is('user_id', null);

    return NextResponse.json({ success: true, data: sessionUser(user) }, { headers: NO_STORE });
  } catch (error) {
    console.error('[giving account]', error.message);
    return fail('Your account could not be made just now. Please try again.', 500);
  }
}
