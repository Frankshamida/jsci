import { supabaseAdmin as supabase } from '@/lib/supabase';

// Who is allowed to work an event's door and its money.
//
// Two kinds of people, one set of rules:
//
//   Admin / Super Admin   every event, always. Unchanged from before this file
//                         existed - the committee is an addition, not a
//                         replacement.
//   Event Committee       an ordinary account an Admin has flagged. Scoped to
//                         the events in `committee_events`, or to every event
//                         when that list is empty.
//
// Every route the committee touches asks the same two questions in the same
// order: findEventActor to learn who is calling, then canWorkEvent to decide.
// One copy of the rule, rather than one per route drifting away from the rest.

export const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

const BASE_COLUMNS = 'id, firstname, lastname, email, role, is_active, profile_picture';
const COMMITTEE_COLUMNS = `${BASE_COLUMNS}, is_event_committee, committee_events`;

// True when Postgres is complaining that a column does not exist, rather than
// about anything else. The committee columns arrive in a migration, and a
// database that has not run it yet must still serve Admins normally instead of
// failing every event route outright.
function missingCommitteeColumn(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('column') && (text.includes('is_event_committee') || text.includes('committee_events'));
}

// The account behind an id, with its committee flags if the database has them.
// Returns null when the id is unknown - kept separate from the permission check
// so a caller can tell "we do not know who you are" from "we know, and no".
export async function findEventActor(actorId) {
  if (!actorId) return null;
  try {
    const { data, error } = await supabase.from('users').select(COMMITTEE_COLUMNS).eq('id', actorId).single();
    if (!error) return data || null;
    if (!missingCommitteeColumn(error.message)) return null;
  } catch { /* fall through to the pre-migration read */ }

  try {
    const { data } = await supabase.from('users').select(BASE_COLUMNS).eq('id', actorId).single();
    // No columns means no committee yet: the account is whatever its role says.
    return data ? { ...data, is_event_committee: false, committee_events: [] } : null;
  } catch { return null; }
}

export function isEventManager(actor) {
  return !!actor && EVENT_MANAGER_ROLES.includes(actor.role);
}

// A flagged, still-active committee account. A deactivated account is nobody,
// whatever flags it is carrying.
export function isCommitteeMember(actor) {
  return !!actor && actor.is_event_committee === true && actor.is_active !== false;
}

// Which events this person may work. null means "all of them".
export function committeeEventIds(actor) {
  const list = Array.isArray(actor?.committee_events) ? actor.committee_events.filter(Boolean) : [];
  return list.length > 0 ? list.map(String) : null;
}

export function canWorkEvent(actor, eventId) {
  if (isEventManager(actor)) return true;
  if (!isCommitteeMember(actor)) return false;
  const scope = committeeEventIds(actor);
  return !scope || !eventId || scope.includes(String(eventId));
}

// The label that goes on a row this person creates, so an attendee list can say
// who entered a walk-in without the reader having to look the account up.
export function actorRoleLabel(actor) {
  return isEventManager(actor) ? actor.role : 'Event Committee';
}

// The refusal wording, chosen from what we know about the caller: an unknown id
// is a stale session and says so; a known account is told what it is, because
// "access denied" on its own sends people to the wrong fix.
export function staffDeniedMessage(actor) {
  if (!actor) return 'Could not tell who is signed in. Please sign out and sign in again.';
  if (isCommitteeMember(actor)) return 'You are not assigned to this event. Ask an Admin to add it to your committee assignments.';
  return `Only Admins, Super Admins and assigned Event Committee members can do this. Your account is signed in as "${actor.role || 'no role'}".`;
}
