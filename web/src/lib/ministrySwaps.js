// ============================================================
// JSCI Ministry app - schedule swaps
// Two teammates with the same part trade dates: the requester gives away
// their part on `requester_date` and takes the partner's same part on
// `partner_date`. Asked in the app, accepted by the partner, then approved by
// a Schedule Plotter / Admin, which changes both lineups (applySwap).
//
//   lineup_swaps.status
//     'Waiting Partner'   the partner has not answered yet
//     'Pending Approval'  the partner said yes; waiting for the plotter
//     'Approved'          done: both lineups changed
//     'Declined'          the partner said no
//     'Rejected'          the plotter said no
//     'Cancelled'         the requester took it back
// ============================================================
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { LINEUP_INSTRUMENTS, lineupParts } from '@/lib/userRoles';
import { ROLE_TYPE_OF_PART } from '@/lib/ministryApp';

export const SWAP_OPEN = ['Waiting Partner', 'Pending Approval'];

const INSTRUMENT_TOKEN = Object.fromEntries(LINEUP_INSTRUMENTS.map(({ token, label }) => [label, token]));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Can two people swap this part? Only lineup parts can. */
export const isSwappablePart = (part) => !!ROLE_TYPE_OF_PART[part];

/** The names in one part of a schedules row: 'Song Leader', 'Backup Singer', 'Keyboard', ..., 'Dancer'. */
export function namesInPart(s, part) {
  if (!s) return [];
  if (part === 'Song Leader') return s.song_leader ? [s.song_leader] : [];
  if (part === 'Backup Singer') return s.backup_singers || [];
  if (part === 'Dancer') return s.dancers || [];
  const token = INSTRUMENT_TOKEN[part];
  return token ? (s.musicians?.[token] || []) : [];
}

/** The schedules update that puts `to` where `from` is in `part`. */
export function replaceInPart(s, part, from, to) {
  const swap = (names) => (names || []).map((n) => (same(n, from) ? to : n));
  if (part === 'Song Leader') return { song_leader: to };
  if (part === 'Backup Singer') return { backup_singers: swap(s.backup_singers) };
  if (part === 'Dancer') return { dancers: swap(s.dancers) };
  const token = INSTRUMENT_TOKEN[part];
  return { musicians: { ...(s.musicians || {}), [token]: swap(s.musicians?.[token]) } };
}

const partsOf = (s, name) => (s ? lineupParts({ songLeader: s.song_leader, backupSingers: s.backup_singers, musicians: s.musicians, dancers: s.dancers })[String(name).trim().toLowerCase()]?.parts || [] : []);

/**
 * Why this swap cannot happen on these two lineups, or null.
 * @param {{ requester_name, requester_date, partner_name, partner_date, part }} swap
 * @param {object|null} mine    - the schedules row on requester_date
 * @param {object|null} theirs  - the schedules row on partner_date
 */
export function swapProblem(swap, mine, theirs, today = new Date().toISOString().slice(0, 10)) {
  if (!isSwappablePart(swap.part)) return 'Only lineup parts can be swapped.';
  if (swap.requester_date === swap.partner_date) return 'Pick a different date to swap with.';
  if (swap.requester_date < today || swap.partner_date < today) return 'One of the dates has already passed.';
  if (!mine || !theirs) return 'One of the lineups was removed.';
  if (!namesInPart(mine, swap.part).some((n) => same(n, swap.requester_name))) return `${swap.requester_name} is no longer ${swap.part} on that date.`;
  if (!namesInPart(theirs, swap.part).some((n) => same(n, swap.partner_name))) return `${swap.partner_name} is no longer ${swap.part} on that date.`;
  const busyMe = partsOf(theirs, swap.requester_name);
  if (busyMe.length) return `${swap.requester_name} is already on the other date (${busyMe.join(', ')}).`;
  const busyThem = partsOf(mine, swap.partner_name);
  if (busyThem.length) return `${swap.partner_name} is already on that date (${busyThem.join(', ')}).`;
  return null;
}

/**
 * Make an accepted swap real: both lineups change. Checked again first, as
 * the lineups may have changed since it was asked.
 * @returns {Promise<string|null>} why it could not be done, or null when done
 */
export async function applySwap(swap) {
  const { data: rows, error } = await supabase.from('schedules').select('*').in('schedule_date', [swap.requester_date, swap.partner_date]);
  if (error) return 'Could not read the lineups. Try again.';
  const mine = (rows || []).find((r) => r.schedule_date === swap.requester_date) || null;
  const theirs = (rows || []).find((r) => r.schedule_date === swap.partner_date) || null;
  const problem = swapProblem(swap, mine, theirs);
  if (problem) return problem;

  const firstPatch = replaceInPart(mine, swap.part, swap.requester_name, swap.partner_name);
  const first = await supabase.from('schedules').update(firstPatch).eq('id', mine.id);
  if (first.error) return 'Could not change the lineup. Try again.';
  const second = await supabase.from('schedules').update(replaceInPart(theirs, swap.part, swap.partner_name, swap.requester_name)).eq('id', theirs.id);
  if (second.error) {
    // Put the first lineup back, so the two never disagree.
    const column = Object.keys(firstPatch)[0];
    await supabase.from('schedules').update({ [column]: mine[column] }).eq('id', mine.id);
    return 'Could not change the second lineup. Nothing was changed.';
  }
  return null;
}

/** A lineup_swaps row as the app reads it. */
export const shapeSwap = (w) => ({
  id: w.id,
  status: w.status,
  part: w.part,
  roleType: w.role_type,
  reason: w.reason || '',
  requesterId: w.requester_id,
  requesterName: w.requester_name,
  requesterDate: w.requester_date,
  partnerId: w.partner_id,
  partnerName: w.partner_name,
  partnerDate: w.partner_date,
  partnerNote: w.partner_note || null,
  adminNote: w.admin_note || null,
  reviewedBy: w.reviewed_by || null,
  createdAt: w.created_at,
});
