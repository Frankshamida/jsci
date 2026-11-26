// Who is asking, and may they? For API routes that change something.
//
// SERVER ONLY. The caller is named by the id the browser sends (actorId) and
// looked up here: the account must exist, be active, and hold one of `roles`
// (its main role or an additional one; a Super Admin always may).
//
// The id itself is still the browser's word - this site has no server-side
// session yet - so a check here stops anyone who is not signed in as one of
// these roles, but not someone who has learned such an account's id. The
// signed session cookie (planned with the AI work) closes that; routes that use
// requireRole will switch to it in one place.

import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';

export const STAFF_ROLES = ['Pastor', 'Admin', 'Super Admin'];
export const ADMIN_ROLES = ['Admin', 'Super Admin'];

// { user, name } or { error, status }
export async function requireRole(actorId, roles) {
  if (!actorId) return { error: 'Please sign in first.', status: 401 };
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, firstname, lastname, role, additional_roles, is_active')
    .eq('id', String(actorId))
    .maybeSingle();
  if (error || !user || user.is_active === false) return { error: 'Please sign in again.', status: 401 };
  const held = getUserRoles(user);
  if (!held.includes('Super Admin') && !held.some((r) => roles.includes(r))) {
    return { error: 'Access denied. Your role cannot do this.', status: 403 };
  }
  return { user, name: [user.firstname, user.lastname].filter(Boolean).join(' ') };
}
