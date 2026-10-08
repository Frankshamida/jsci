// The name screen at the door (/rfid-chekin-display), driven by the "Scan
// RFID to Check In" dialog. A card tapped there puts the attendee's full name
// up for the queue to see - welcome, already in, not verified - with the
// event's cover blurred behind it. Same two roads as the meals screen (see
// lib/screenLink.js): another window, or another device.
//
// The message:
//   { at, event: { id, title, image, start, end, venue, city }, day: { number, label, days, date },
//     tap: null | { seq, name, first, last, church, status, day, attendedAt } }
//   first / last  the name as the ID prints it - the screen draws their ID front
//   status  'reading' | 'checking' | 'checked_in' | 'already_in'
//           | 'not_verified' | 'unknown' | 'error'

import { createScreenLink } from '@/lib/screenLink';

const link = createScreenLink({
  channel: 'jsci-checkin-display',
  storageKey: 'jsci.checkinDisplay.v1',
  topic: 'checkin-display',
});

export const readCheckinDisplay = link.read;
export const publishCheckinDisplay = (content) => link.publish(content);
export const subscribeCheckinDisplay = link.subscribe;

/* What the screen shows for one tap, from what the door dialog has: its
   instant guess off the cards on screen, the server's answer, or nothing yet.

   Deliberately no server wording on the screen. It faces the queue, and
   "not verified yet (pending cash)" or another member's name is the desk's
   business, not the room's - the page says its own plain line for each. */
export function checkinTapFrom(seq, result) {
  if (!result) return { seq, name: '', first: '', last: '', church: '', status: 'reading' };
  const reg = result.registration || null;
  const day = Number(result.dayNumber) || null;
  let status = result.result;
  if (status === 'checked_in' && result.pending) status = 'checking';
  // 'error' is the desk failing to get an answer at all (the network, the
  // server) - a reason to tap again, not a card nobody knows.
  if (!['checking', 'checked_in', 'already_in', 'not_verified', 'error'].includes(status)) status = 'unknown';
  const stamp = day && Array.isArray(result.days)
    ? result.days.find((d) => Number(d.day_number) === day)?.attended_at
    : null;
  return {
    seq,
    name: reg?.attendee_name || '',
    first: reg?.attendee_firstname || '',
    last: reg?.attendee_lastname || '',
    church: reg?.church_name || '',
    status,
    day,
    attendedAt: stamp || null,
  };
}
