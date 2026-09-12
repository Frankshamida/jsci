// ============================================================
// Rooms at an event: what a room is, and how beds become a head count
// ============================================================
// An event that runs over three days puts people up somewhere, and the sheet
// that gets passed round the office is always the same shape:
//
//   TYPE OF ROOM        ROOM NUMBERS          PAX
//   FAMILY DELUXE       308, 408 and 508      GOOD FOR 4 PAX
//                                             (1 QUEEN SIZED AND 1 DOUBLE BED)
//   STANDARD WITH VIEW  204, 205, 206, 307    GOOD FOR 2 PAX (1 DOUBLE BED)
//   DORMTYPE            FUNCTION HALL         15 PAX
//
// Three things are worth naming out of that, because both the API route and
// the dashboard have to agree on them exactly:
//
//   the numbers   One row per room, always - "308, 408 and 508" is three
//                 rooms that happen to be furnished alike, not one room with
//                 a funny name. But it is typed as one line, because that is
//                 how the hotel sends it, so the line has to be split. The
//                 split is deliberately conservative: commas, semicolons and
//                 new lines, plus the word "and" ONLY between single words.
//                 "FUNCTION HALL" is one room and must survive intact.
//
//   the beds      [{ type: 'Double Bed', count: 2 }]. A room is described by
//                 what is in it, not by a sentence, so "2 Double Beds" can be
//                 counted, summed and re-worded later. The sentence is built
//                 from the list on the way out - never stored.
//
//   the pax       How many people sleep there. Suggested from the beds and
//                 then left alone, because the two genuinely disagree: a
//                 family room with a queen and a double is sold as 4 pax, and
//                 a function hall floor is 15 pax with no beds in it at all.
//                 So the beds propose and the person at the desk decides.
// ============================================================

// The beds people actually type, and how many the trade counts each as
// sleeping. Offered as suggestions, never enforced - a hotel will always have
// one more kind of bed than any list.
export const BED_TYPES = [
  { name: 'Single Bed', sleeps: 1 },
  { name: 'Double Bed', sleeps: 2 },
  { name: 'Queen Sized Bed', sleeps: 2 },
  { name: 'King Sized Bed', sleeps: 2 },
  { name: 'Bunk Bed', sleeps: 2 },
  { name: 'Twin Bed', sleeps: 1 },
  { name: 'Sofa Bed', sleeps: 1 },
  { name: 'Extra Mattress', sleeps: 1 },
];

// None of these are limits on the venue - they are limits on a typing
// mistake. A room for 400 people is a hall being entered in the wrong field,
// and 40 beds in one room is a stuck key on a number input.
export const MAX_PAX = 200;
export const MAX_BED_COUNT = 40;
export const MAX_ROOMS_PER_ADD = 60;

/**
 * How many people one bed of this kind sleeps.
 *
 * Matched on the words rather than the exact name, because the name is typed:
 * "Queen", "Queen Bed" and "Queen Sized Bed" are the same bed and all three
 * get entered. Anything unrecognised counts as one, which under-counts rather
 * than over-books - and the pax field is editable either way.
 *
 * @param {string} type the bed as it was typed
 * @returns {number} how many it sleeps
 */
export function bedSleeps(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return 1;
  if (/double|queen|king|bunk|matrimonial/.test(t)) return 2;
  if (/single|twin|sofa|mattress|folding|cot/.test(t)) return 1;
  // An unknown bed is still one sleeping place as far as this is concerned.
  return 1;
}

/**
 * The stored form of a bed list: named beds with a count, no blanks, and the
 * same bed never listed twice.
 *
 * @param {Array} raw whatever the client sent
 * @returns {Array<{type: string, count: number}>}
 */
export function normalizeBeds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((b) => {
    const type = String(b?.type || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!type) return;
    const count = Math.min(MAX_BED_COUNT, Math.max(1, Math.round(Number(b?.count) || 1)));
    // The same bed typed twice is one line with the counts added, not two
    // lines that have to be read together.
    const hit = out.find((o) => o.type.toLowerCase() === type.toLowerCase());
    if (hit) {
      hit.count = Math.min(MAX_BED_COUNT, hit.count + count);
      return;
    }
    out.push({ type, count });
  });
  return out.slice(0, 12);
}

/**
 * How many the beds in a room sleep, added up. The suggestion behind the pax
 * field, and the reason a room with two double beds offers 4.
 */
export function bedsSleep(beds) {
  return normalizeBeds(beds).reduce((sum, b) => sum + b.count * bedSleeps(b.type), 0);
}

/**
 * The bed list as the sheet reads it: "1 Queen Sized Bed and 2 Double Beds".
 * Built on the way out, so the wording can change without a migration.
 */
export function bedsToText(beds) {
  const list = normalizeBeds(beds).map((b) => {
    const name = b.count > 1 && !/s$/i.test(b.type) ? `${b.type}s` : b.type;
    return `${b.count} ${name}`;
  });
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * One typed line of room numbers, split into the rooms it names.
 *
 * Splits on commas, semicolons and new lines, and on "and" only where it sits
 * between two single words - so "408 and 508" is two rooms while "FUNCTION
 * HALL" and "HALL A and B" are each left as one. Case is kept as typed;
 * duplicates go, because "308" and "308 " being two rooms is never what
 * anybody meant.
 *
 * @param {string|Array} raw the room number field, or an array of numbers
 * @returns {string[]} the rooms to create, in the order they were typed
 */
export function parseRoomNumbers(raw) {
  const pieces = Array.isArray(raw)
    ? raw.map((r) => String(r || ''))
    : String(raw || '').split(/[,;\n]+/);
  const out = [];
  const seen = new Set();
  pieces.forEach((piece) => {
    const token = piece.trim().replace(/\s+/g, ' ');
    if (!token) return;
    // "408 and 508" - single words joined by "and" - is a list. Anything with
    // a multi-word part is a name that happens to contain "and".
    const parts = /^[^\s]+(?:\s+and\s+[^\s]+)+$/i.test(token)
      ? token.split(/\s+and\s+/i)
      : [token];
    parts.forEach((part) => {
      const name = part.trim().slice(0, 40);
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(name);
    });
  });
  return out.slice(0, MAX_ROOMS_PER_ADD);
}

/**
 * A room type as it is stored: trimmed, inner runs of space collapsed, and
 * left in the case it was typed. Not upper-cased here - the sheet is shouted
 * in CSS, and the stored value has to stay readable in an export.
 */
export function roomTypeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

/**
 * A pax figure that can be trusted: a whole number of people, at least one.
 * Falls back to what the beds sleep, and to 1 for a room with neither.
 */
export function normalizePax(raw, beds) {
  const asked = Math.round(Number(raw) || 0);
  if (asked >= 1) return Math.min(MAX_PAX, asked);
  const fromBeds = bedsSleep(beds);
  return fromBeds >= 1 ? Math.min(MAX_PAX, fromBeds) : 1;
}

/**
 * Room numbers in the order a person expects to read them: 204 before 307
 * before 1002, and "Function Hall" after the numbers rather than in the
 * middle of them. A plain text sort puts 1002 first, which reads as a mistake
 * in the data rather than as a sort.
 */
export function compareRoomNumbers(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const aNum = /^\d+$/.test(sa.trim());
  const bNum = /^\d+$/.test(sb.trim());
  if (aNum && bNum) return Number(sa) - Number(sb);
  if (aNum) return -1;
  if (bNum) return 1;
  return sa.localeCompare(sb);
}

// ============================================================
// Who is entitled to a bed
// ============================================================
// A room is not handed out to whoever taps a card. It goes to somebody who
// PAID for accommodation, which on this system is a paid extra ticked on the
// registration form - "Do you want accommodation? +200".
//
// That has to be decided in one place, because two places would disagree and
// the disagreement would look like this: the desk lets somebody in, the list
// says they were never entitled, and nobody can tell which is right. The
// server is the authority and this is the function it uses; the screen calls
// the same one so it can refuse before the request rather than after it.
//
// HOW THE ACCOMMODATION EXTRA IS RECOGNISED
//
// Extras are free text - the admin writes the question - so there is no flag
// on the row saying "this one is a bed". Two steps, in this order:
//
//   1. If any of the event's extras is worded like accommodation, then THAT
//      is the one that entitles somebody to a room, and an attendee who
//      ticked a different extra does not get one. This is the normal case and
//      it is the strict one.
//   2. If none of them is worded like accommodation, any paid extra counts.
//      An event whose extras are named in Cebuano, or "Billeting", or
//      "Package B", must not be locked out of the feature by a word list.
//
// Deliberately not clever beyond that. The refusal always names what the
// person actually availed, so a wrong guess is visible in the message rather
// than mysterious.
const ACCOMMODATION_WORDS = /accommodat|accomodat|lodg|billet|hotel|dorm|room|bed|stay|sleep|overnight|tulog|hotel/i;

const sameQuestion = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * The extras on this event that mean "a bed", or [] if none of them is worded
 * that way.
 *
 * @param {Array} eventAddons the event's event_addons rows
 * @returns {Array} the subset that reads as accommodation
 */
export function accommodationAddons(eventAddons) {
  return (Array.isArray(eventAddons) ? eventAddons : [])
    .filter((a) => ACCOMMODATION_WORDS.test(String(a?.question || '')));
}

/**
 * Is this registration entitled to a room?
 *
 * @param {Array} regAddons the extras snapshotted on the registration
 * @param {Array} eventAddons the event's own extras
 * @returns {{ok: boolean, why: string, availed: string[]}}
 *   why is written to be shown to the person holding the card reader - it
 *   names what they DID avail, because "not entitled" on its own is the kind
 *   of refusal that gets overridden by hand.
 */
export function roomEntitlement(regAddons, eventAddons) {
  const theirs = (Array.isArray(regAddons) ? regAddons : [])
    .filter((a) => a && (a.question || a.id));
  const availed = theirs.map((a) => String(a.question || '').trim()).filter(Boolean);

  if (theirs.length === 0) {
    return { ok: false, why: 'did not avail any extra on their registration', availed };
  }

  const wanted = accommodationAddons(eventAddons);
  if (wanted.length === 0) {
    // Nothing on this event is worded like accommodation, so a paid extra is
    // the best evidence there is. Said plainly rather than pretended about.
    return { ok: true, why: '', availed };
  }

  const has = theirs.some((t) => wanted.some((w) => (t.id && w.id && t.id === w.id)
    || sameQuestion(t.question, w.question)));
  if (has) return { ok: true, why: '', availed };

  return {
    ok: false,
    why: availed.length > 0
      ? `did not avail accommodation — they availed: ${availed.join(', ')}`
      : 'did not avail accommodation',
    availed,
  };
}
