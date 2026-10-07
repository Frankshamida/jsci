// ---- Review Payment ----
//
// The Payments page (Event -> Payments) is where a Super Admin records money
// actually received: cash handed over by whoever was holding it, or one
// online transfer, each with the attendees it paid for. This compares those
// records with the registrations and says, per attendee, where the two
// DISAGREE - so the Registrations table can put a "Review Payment" flag on
// that row.
//
// Only disagreements are flagged. A registration the Payments page knows
// nothing about is not a mismatch by itself: Paid - Pending Turnover with no
// record simply means the money has not been turned over yet, and a payment
// verified at the desk was verified there.
//
// Flagged, for an attendee IN a payment record:
//   - the status has since moved off Paid (reverted, cancelled, back to owing)
//   - their total has changed since the money was recorded
//   - the registration now says a different way of paying than the record
//   - Cash On Hand from someone other than the person their turnover named
//   - an online transfer whose bank or reference is not the one they gave
//   - paid in advance for a bed on the accommodation waiting list, and no
//     longer waiting for it (taken off the list, cancelled, or given a bed
//     some other way) - that money is owed back
// Flagged, for an attendee NOT in any record:
//   - pending turnover with someone who has already turned cash over in
//     Payments, without them
//   - their reference was recorded in Payments for other attendees
//
// Resolved: a Super Admin looked at the flag and the registration is right as
// it is. Each reason has a key that holds the values it was raised over, and
// the keys resolved are kept on the registration (payment_review_resolved).
// Those stop being flagged; anything that changes afterwards is a new key, so
// it is flagged again.
//
// Returns Map(registrationId -> { reasons: string[], keys: string[], record | null }).

const PAID = new Set(['payment_verified', 'registered']);
// What the attendee had already claimed when the money was recorded.
const CLAIMED = new Set(['payment_submitted', 'paid_pending_turnover', 'pending_payment']);

const TITLES = new Set([
  'ptr', 'pstr', 'ptra', 'pstra', 'pastor', 'pastora', 'ps', 'rev', 'bro', 'sis', 'sister', 'brother',
  'dr', 'mr', 'mrs', 'ms', 'engr', 'atty', 'hon', 'ate', 'kuya', 'by',
]);
const nameTokens = (s) => String(s || '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')           // "Queenie Taripe (maribank)"
  .replace(/[^a-zÀ-ɏ\s]/g, ' ')
  .split(/\s+/)
  .filter((w) => w && !TITLES.has(w));
// The same person, typed twice by hand: every word of the shorter name is in
// the longer one ("Psalm Gambe" and "Pstr. Psalm Gambe"). Unknown never
// disagrees - an empty name proves nothing.
export function sameName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return true;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) => long.includes(w)) || ta.join('') === tb.join('');
}
const hasName = (s) => nameTokens(s).length > 0;

const refKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// The desk asks for the last six digits, so a reference that ends the other
// one is the same reference.
export function sameRef(a, b) {
  const x = refKey(a);
  const y = refKey(b);
  if (!x || !y) return true;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.endsWith(short);
}
const hasRef = (s) => refKey(s).length >= 4;

const bankKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function sameBank(a, b) {
  const x = bankKey(a);
  const y = bankKey(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x);
}

const cents = (n) => Math.round((Number(n) || 0) * 100);
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const day = (iso) => (iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
  : '');
export const recordSource = (rec) => (rec.kind === 'cash'
  ? `Cash On Hand from ${rec.holder_name || 'someone'}`
  : `${rec.bank_name || 'Online'}${rec.reference ? ` ref ${rec.reference}` : ''}`);

export function reviewPayments(regs, records, { isCash = () => false, statusLabel = (s) => String(s || '').replace(/_/g, ' ') } = {}) {
  const out = new Map();
  const list = Array.isArray(records) ? records : [];
  if (!list.length || !Array.isArray(regs) || !regs.length) return out;

  // Newest first, so the first record seen for an attendee is their latest.
  const sorted = [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const latest = new Map(); // regId -> { rec, item }
  sorted.forEach((rec) => {
    (Array.isArray(rec.items) ? rec.items : []).forEach((item) => {
      if (item?.id && !latest.has(item.id)) latest.set(item.id, { rec, item });
    });
  });
  const cashRecs = sorted.filter((r) => r.kind === 'cash' && hasName(r.holder_name));
  const onlineRecs = sorted.filter((r) => r.kind === 'online' && hasRef(r.reference));

  regs.forEach((r) => {
    if (!r || r.deleted_at) return;
    const resolved = new Set(Array.isArray(r.payment_review_resolved?.keys) ? r.payment_review_resolved.keys : []);
    const found = [];
    const flag = (key, why) => found.push({ key, why });
    const finish = (record) => {
      const open = found.filter((f) => !resolved.has(f.key));
      if (open.length) out.set(r.id, { reasons: open.map((f) => f.why), keys: open.map((f) => f.key), record });
    };
    const hit = latest.get(r.id);

    // Paid for a bed they are no longer waiting for. The waiting list sets
    // bed_wait_paid back to 0 when it gives the bed, so anything left here
    // with nobody waiting is money taken for nothing.
    const bedPaid = Number(r.bed_wait_paid) || 0;
    if (bedPaid > 0 && (!r.bed_wait_since || r.status === 'cancelled')) {
      flag(`bed:${cents(bedPaid)}:${r.status === 'cancelled' ? 'cancelled' : 'off'}`, `Paid ${peso(bedPaid)} in advance for accommodation on the waiting list, but ${r.status === 'cancelled' ? 'the registration is cancelled' : 'they are no longer on the waiting list'} - refund it, or give them the accommodation.`);
    }

    if (hit) {
      const { rec, item } = hit;
      const src = `${recordSource(rec)}, ${day(rec.created_at)}`;
      if (r.status === 'cancelled') {
        flag(`cancelled:${rec.id}`, `Recorded as paid in Payments (${src}), but the registration is cancelled - the money may need to be refunded.`);
      } else if (!PAID.has(r.status)) {
        flag(`status:${rec.id}:${r.status}`, `Recorded as paid in Payments (${src}), but the status is now "${statusLabel(r.status)}".`);
      } else {
        // Paid - and paid the way the record says.
        if (rec.kind === 'cash' && r.payment_method && !isCash(r.payment_method)) {
          flag(`cash-method:${rec.id}:${bankKey(r.payment_method)}`, `Payments recorded it as Cash On Hand, but the registration says it was paid via ${r.payment_method}.`);
        }
        if (rec.kind === 'online' && (isCash(r.payment_method) || !sameBank(r.payment_method, rec.bank_name))) {
          flag(`online-method:${rec.id}:${bankKey(r.payment_method)}`, `Payments recorded it via ${rec.bank_name}, but the registration says ${r.payment_method || 'no method'}.`);
        }
      }
      // A bed paid for on the waiting list joins their total when it is given,
      // so either total is the one recorded.
      const bedFee = Number(item.bedFee) || 0;
      if (r.status !== 'cancelled' && item.total != null && cents(item.total) !== cents(r.amount)
        && !(bedFee > 0 && cents(Number(item.total) + bedFee) === cents(r.amount))) {
        flag(`total:${rec.id}:${cents(item.total)}:${cents(r.amount)}`, `Payments recorded ${peso(item.total)} for this attendee, but their total is now ${peso(r.amount)}.`);
      }
      if (rec.kind === 'cash' && item.from === 'paid_pending_turnover' && item.prevHolder
        && !sameName(item.prevHolder, rec.holder_name)) {
        flag(`holder:${rec.id}`, `Was pending turnover with ${item.prevHolder}, but the cash was recorded from ${rec.holder_name}.`);
      }
      if (rec.kind === 'online' && CLAIMED.has(item.from)) {
        if (item.prevReference && !sameRef(item.prevReference, rec.reference)) {
          flag(`ref:${rec.id}`, `The attendee's reference (${item.prevReference}) is not the payment's reference (${rec.reference}).`);
        }
        if (item.prevMethod && !isCash(item.prevMethod) && !sameBank(item.prevMethod, rec.bank_name)) {
          flag(`bank:${rec.id}`, `The attendee said they paid via ${item.prevMethod}, but the payment was recorded via ${rec.bank_name}.`);
        }
      }
      finish(rec);
      return;
    }

    if (r.status === 'cancelled' || !(Number(r.amount) > 0)) {
      finish(null);
      return;
    }
    let record = null;

    // Their holder has turned cash over since - without them.
    if (r.status === 'paid_pending_turnover' && hasName(r.turnover_holder)) {
      const since = r.turnover_marked_at ? String(r.turnover_marked_at) : '';
      const rec = cashRecs.find((c) => sameName(c.holder_name, r.turnover_holder) && (!since || String(c.created_at) >= since));
      if (rec) {
        record = rec;
        flag(`left-out:${rec.id}`, `${rec.holder_name} has already turned over ${peso(rec.total_amount)} in Payments (${day(rec.created_at)}), but this attendee was not included.`);
      }
    }
    // Their reference is on a payment recorded for other people.
    if (hasRef(r.payment_reference)) {
      const rec = onlineRecs.find((o) => sameRef(o.reference, r.payment_reference));
      if (rec) {
        record = record || rec;
        flag(`ref-elsewhere:${rec.id}:${refKey(r.payment_reference)}`, `Reference ${r.payment_reference} was recorded in Payments (${rec.bank_name}, ${day(rec.created_at)}) for other attendees, but not for this one.`);
      }
    }
    finish(record);
  });
  return out;
}
