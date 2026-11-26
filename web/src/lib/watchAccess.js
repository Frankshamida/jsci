// Who may watch a service on the website: any account, a free Guest one
// included, that still exists and is not deactivated. SERVER ONLY.
//
// The website keeps its sign-in in the browser (the `userData` every page
// reads), so the account is named by its id, as the other web routes do.

import { supabaseAdmin } from '@/lib/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID.test(String(v || ''));
export const NO_STORE = { 'Cache-Control': 'private, no-store' };

// { ok: true } or { status, body } to send back as it is.
export async function checkWatcher(userId, signInMessage = 'Please sign in to watch.') {
  if (!isUuid(userId)) {
    return { status: 401, body: { error: 'sign-in', message: signInMessage } };
  }
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!user) {
    return { status: 401, body: { error: 'sign-in', message: 'We could not find your account. Please sign in again.' } };
  }
  if (user.is_active === false) {
    return { status: 403, body: { error: 'inactive', message: 'This account has been deactivated. Please contact the church office.' } };
  }
  return { ok: true };
}
