// ============================================================
// Is this extra on the registration the same as that extra on the event?
//
// A registration keeps a SNAPSHOT of the extras it was charged for -
// { id, question, fee } - so the receipt still reads right after the admin
// edits the event. The cost of that is that the snapshot drifts: the extra
// gets re-created (new id) and re-worded ("Do you want accommodation?" became
// "Accommodation"), and a match on the id or the exact wording then says the
// attendee never availed something they were charged ₱200 for. The Extras
// column showed a dash beside a +₱200 payment, the room desk refused them a
// bed, and Add Extras offered to charge them for it a second time.
//
// So the question is compared the way a person reads it: the filler of a
// form question dropped ("do you want", "would you like to avail"), case and
// punctuation ignored, and the one spelling everybody gets wrong forgiven.
// Deliberately NOT "one contains the other" - "Lunch" and "Lunch and Dinner"
// are different extras, and calling them the same would hide a charge.
// ============================================================

// Words that make an extra a question without changing what it is.
const FILLER = new Set([
  'do', 'you', 'want', 'wants', 'need', 'needs', 'would', 'like', 'to', 'avail', 'availing',
  'an', 'a', 'the', 'please', 'include', 'including', 'with', 'for', 'will', 'be', 'are', 'is',
  'your', 'yes', 'no', 'add', 'get', 'have', 'we', 'i', 'of',
]);

/**
 * What an extra's question comes down to, for comparing two of them.
 * "Do you want accommodation?" -> "accommodation"
 *
 * @param {string} question
 * @returns {string}
 */
export function addonKey(question) {
  return String(question || '')
    .toLowerCase()
    // The misspelling on half the posters. One word, one spelling.
    .replace(/accomodat/g, 'accommodat')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .join(' ');
}

/**
 * Are these the same extra? `held` is the snapshot on a registration,
 * `offered` is the event's extra (or another snapshot).
 *
 * @param {{id?: string, question?: string}} held
 * @param {{id?: string, question?: string}} offered
 * @returns {boolean}
 */
export function sameAddon(held, offered) {
  if (!held || !offered) return false;
  if (held.id && offered.id && String(held.id) === String(offered.id)) return true;
  const a = addonKey(held.question);
  const b = addonKey(offered.question);
  if (a && b) return a === b;
  // A question made entirely of filler ("Do you want?") compares as typed.
  return String(held.question || '').trim().toLowerCase() === String(offered.question || '').trim().toLowerCase()
    && !!String(held.question || '').trim();
}
