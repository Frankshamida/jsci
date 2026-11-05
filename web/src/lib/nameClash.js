// ============================================================
// One full name, one account
// Lineups, excuses and substitutes record people by full name
// ("Frank Dweezel Gomez"), so two accounts with the same full name look like
// one person there: picking one in the Monthly Planner picks both, and both
// see the other's Sundays in the JSCI Ministry app. Names are checked here
// whenever one is saved.
// ============================================================
import { supabase } from '@/lib/supabase';

// "Frank" + "Dweezel Gomez" and "Frank Dweezel" + "Gomez" are the same name.
export const fullNameKey = (firstname, lastname) =>
  `${firstname || ''} ${lastname || ''}`.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The other account already using this full name, or null.
 * @param {string|null} exceptId - the account being edited (it may keep its own name)
 */
export async function accountWithName(firstname, lastname, exceptId = null) {
  const key = fullNameKey(firstname, lastname);
  if (!key) return null;
  // The name's last word is in every match's last name: fetch those, compare in full.
  const lastWord = key.split(' ').pop().replace(/[%_\\]/g, '');
  let query = supabase.from('users').select('id, firstname, lastname, email').ilike('lastname', `%${lastWord}%`);
  if (exceptId) query = query.neq('id', exceptId);
  const { data } = await query;
  return (data || []).find((u) => fullNameKey(u.firstname, u.lastname) === key) || null;
}

const displayName = (u) => `${u.firstname} ${u.lastname}`.trim();

// For the person signing up or editing their own profile.
export const nameTakenForSelf = (twin) =>
  `There is already an account named ${displayName(twin)}. Add your middle name or initial so the church can tell you apart. If that account is yours, sign in to it instead.`;

// For a Super Admin creating or editing someone else's account.
export const nameTakenForAdmin = (twin) =>
  `${displayName(twin)} is already the name of another account (${twin.email}). Lineups record people by name, so add a middle name or initial to tell them apart.`;
