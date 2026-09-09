// ============================================================
// RFID card numbers, and why they need their own file
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
  const hex = cleaned.replace(/[^0-9A-F]/g, '');
  return hex.slice(0, MAX_UID_LENGTH);
}

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
  const uid = normalizeUid(raw);
  return uid.length >= 4 && uid.length <= MAX_UID_LENGTH;
}

/**
 * The UID in the form people read out to each other: pairs, spaced.
 * A1B2C3D4 -> A1 B2 C3 D4. Purely cosmetic; never stored.
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
