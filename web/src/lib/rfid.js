// ============================================================
// RFID card numbers, and why they need their own file
//
// Readers in use:
//   Arduino + RC522 (hardware/)       hex over USB serial
//   13.56 MHz USB desk reader         a keyboard: types a 10-digit DECIMAL
//     (Mifare S50/S70, ISO 14443A)    number and presses Enter. Plug and play,
//                                     no driver. Same cards as the RC522, so a
//                                     card registered on one matches on the
//                                     other through uidCandidates() below.
//   the phone (Web NFC)               colon-separated hex
// ============================================================
// The same card gives a different answer depending on what is reading it.
// This is not a bug in any of the readers; there simply is no agreed way to
// print a UID, and every manufacturer picked one:
//
//   Arduino + MFRC522   A1 B2 C3 D4     bytes, space separated, often lower
//   the same, our way   A1B2C3D4        what the sketch in hardware/ prints
//   some HID readers    a1:b2:c3:d4     colons
//   EM4100 USB readers  0006238151      DECIMAL, zero padded to 10 digits
//   the same reader     095,03015       Wiegand: facility code, then card no.
//   cheap clones        D4C3B2A1        the same bytes, backwards
//
// Tap one card on two readers and you get two strings that look nothing alike.
// If the system stored whatever it was handed, a card registered at the office
// desk would not open the door at the hall, and the only symptom would be
// "it doesn't work".
//
// So: one normal form for storage, and a spread of candidates for lookup.
//
//   normalizeUid()   the form that gets WRITTEN. Uppercase hex, no
//                    separators. One card, one row, one spelling.
//   uidCandidates()  the forms accepted on READ. If a card was registered on
//                    a hex reader and later tapped on a decimal one, the
//                    decimal reading is converted and still finds the row.
//
// Being generous on the way in and strict on the way out is deliberate. The
// alternative - guessing the format at registration time - gets it wrong
// silently and leaves a card that can never be matched again.
// ============================================================

// Longest UID we will look at. A 10-byte NFC UID is 20 hex characters; a
// decimal reader can send 10-12 digits. Anything longer is a stuck key or a
// reader spewing, not a card.
const MAX_UID_LENGTH = 32;

/**
 * The single stored spelling of a card number: uppercase, hex characters only.
 *
 * A decimal-only string (what an EM4100 USB reader sends) is left as its
 * digits rather than converted, because "0006238151" and the hex "6238151"
 * are different numbers and there is no way to tell from the string alone
 * which one the reader meant. uidCandidates() below is what bridges the two
 * at lookup time, where being wrong costs nothing.
 *
 * @param {string} raw whatever the reader sent
 * @returns {string} normalised UID, or '' if there is nothing usable in it
 */
export function normalizeUid(raw) {
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw)
    .trim()
    // Readers pad with NULs and send stray control characters between reads.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    // Separators every reader chooses differently: spaces, colons, dashes.
    .replace(/[\s:\-_.]/g, '')
    // Some sketches prefix the value; ours does, and we should read our own.
    .replace(/^(UID|CARD|TAG|ID)[:=]?/i, '')
    .toUpperCase();

  // Only hex digits survive. A Wiegand "095,03015" loses its comma here and
  // becomes one number, which is exactly how those readers are usually keyed.
  const hex = cleaned.replace(/[^0-9A-F]/g, '').slice(0, MAX_UID_LENGTH);

  // A decimal reading is always stored at the ten digits the USB desk reader
  // types. A leading zero dropped on the way in - a keystroke lost, or a
  // number typed by hand - otherwise saved "011179659" beside "0011179659",
  // two spellings of one card, and the same card could then be handed to two
  // attendees at once.
  if (/^[0-9]+$/.test(hex) && hex.length < DECIMAL_UID_LENGTH) {
    return hex.padStart(DECIMAL_UID_LENGTH, '0');
  }
  return hex;
}

// What the 13.56 MHz USB desk reader types: a 4-byte UID in decimal, zero
// padded to ten digits.
const DECIMAL_UID_LENGTH = 10;

/** Reverse a hex string byte-wise: A1B2C3D4 -> D4C3B2A1. */
function reverseBytes(hex) {
  if (hex.length % 2 !== 0) return '';
  const out = [];
  for (let i = hex.length - 2; i >= 0; i -= 2) out.push(hex.slice(i, i + 2));
  return out.join('');
}

/**
 * Every spelling of a card number that should be treated as the same card.
 *
 * Ordered most-likely first, so a caller matching against a database can stop
 * at the first hit. Always includes the normalised form itself.
 *
 * @param {string} raw whatever the reader sent
 * @returns {string[]} unique candidate UIDs, never empty unless the input was
 */
export function uidCandidates(raw) {
  const base = normalizeUid(raw);
  if (!base) return [];

  const out = [base];
  const add = (v) => {
    if (v && v.length <= MAX_UID_LENGTH && !out.includes(v)) out.push(v);
  };

  // The same bytes the other way round. Half the cheap readers are LSB-first
  // and there is no flag in the data saying which one you have.
  add(reverseBytes(base));

  // Decimal reading -> hex. An EM4100 USB reader sends "0006238151"; the same
  // card on an MFRC522 reads "005F2C07". Leading zeros are the reader padding
  // to a fixed width, not part of the number.
  if (/^[0-9]+$/.test(base)) {
    // The same number with more or fewer leading zeros: rows saved before
    // decimal readings were padded to ten digits ("011179659"), and a hex
    // reader's all-digit UID ("12345678") that normalizeUid padded.
    const bare = base.replace(/^0+/, '') || '0';
    for (let len = bare.length; len <= DECIMAL_UID_LENGTH + 2; len += 1) add(bare.padStart(len, '0'));
    try {
      const asHex = BigInt(base).toString(16).toUpperCase();
      add(asHex);
      // Padded to whole bytes, which is how the hex readers print it.
      add(asHex.length % 2 ? '0' + asHex : asHex);
      add(reverseBytes(asHex.length % 2 ? '0' + asHex : asHex));
    } catch { /* not a number we can hold - leave it out */ }
  }

  // Hex reading -> decimal, for the reverse case: registered on a decimal
  // reader, later tapped on a hex one.
  if (/^[0-9A-F]+$/.test(base) && base.length <= 16) {
    try {
      const asDec = BigInt('0x' + base).toString(10);
      add(asDec);
      // Decimal readers pad to ten digits. Match what they would have stored.
      if (asDec.length < 10) add(asDec.padStart(10, '0'));
    } catch { /* ditto */ }
  }

  return out;
}

/**
 * Are two readings the same card? For comparisons made in the browser - a
 * master card, the card just tapped - which cannot lean on the database
 * lookup to bridge a decimal USB reader and a hex one.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameCard(a, b) {
  const want = normalizeUid(b);
  return !!want && uidCandidates(a).includes(want);
}

/**
 * Is this plausibly a card number at all?
 *
 * A keyboard-wedge reader shares the keyboard with the person using it, so
 * the capture box will sometimes catch a stray keystroke or an accidental
 * Enter. Four characters is short enough to accept every real card - the
 * smallest UID in circulation is 4 bytes, and some decimal readers trim
 * leading zeros - and long enough to reject a fat-fingered space.
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isPlausibleUid(raw) {
  // Measured on what was actually read, before a decimal reading is padded -
  // otherwise a stray "12" and Enter would pass as card 0000000012.
  const read = String(raw ?? '').replace(/[\s:\-_.]/g, '').replace(/^(UID|CARD|TAG|ID)[:=]?/i, '')
    .replace(/[^0-9A-Fa-f]/g, '');
  return read.length >= 4 && normalizeUid(raw).length <= MAX_UID_LENGTH;
}

// ---- Keyboard-wedge readers ----
// A USB desk reader "types" the card number and presses Enter, a few
// milliseconds per key. A person types a key every 150ms or more. That
// difference is how a tap is told apart from somebody typing on the page.
//
// Judged over the WHOLE tap, not key by key. The browser can stall for a
// moment in the middle of a tap - the first one after a dialog opens is the
// usual time - and one slow gap is not a person. Throwing the digits away at
// the first slow gap is what turned 0011179659 into 79659.

/** Gaps longer than this start a fresh reading: nobody's tap takes a second. */
export const WEDGE_IDLE_RESET_MS = 1000;
/** A reader's typical gap between keys is well under this; a person's is not. */
const WEDGE_MACHINE_GAP_MS = 60;

/**
 * The card number a wedge reader typed, or '' if the keys look like a person.
 *
 * @param {string} buf the characters collected before Enter
 * @param {number[]} gaps milliseconds between consecutive keys, Enter included
 * @returns {string}
 */
export function wedgeCapture(buf, gaps) {
  if (!isPlausibleUid(buf)) return '';
  const sorted = [...(gaps || [])].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  // The median: one or two stalls cannot drag it up, a person typing always does.
  const median = sorted[Math.floor(sorted.length / 2)];
  return median <= WEDGE_MACHINE_GAP_MS ? buf : '';
}

/**
 * The UID in the form people read out to each other: pairs, spaced.
 * A1B2C3D4 -> A1 B2 C3 D4, and a decimal reading at its full ten digits,
 * 011179659 -> 00 11 17 96 59. Purely cosmetic; never stored.
 *
 * @param {string} uid a normalised UID
 * @returns {string}
 */
export function formatUid(uid) {
  const clean = normalizeUid(uid);
  if (!clean) return '';
  if (clean.length % 2 !== 0) return clean;
  return clean.match(/.{2}/g).join(' ');
}
