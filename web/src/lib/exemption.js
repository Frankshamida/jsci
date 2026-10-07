// What an exemption gives (api/events/registrations/exempt).
//
// It is worth the registration fee - what they owe less the extras they
// availed - and it pays whatever they still owe, up to that. Nothing already
// paid is given back:
//
//   nothing paid yet          the registration fee is waived; their extras
//                             (accommodation) they still pay
//   fee already paid (online) what is left - their accommodation - is free
//   an extra added later      free too, while the exemption has any left
//
// What it covers is kept on the registration (exempt_cover), what it has
// waived so far beside it (exempt_amount), and an extra it paid for carries
// `waived` on its snapshot - so cancelling that extra refunds nothing that
// was never paid.
//
// Safe to import in the browser.

const extrasOf = (reg) => (Array.isArray(reg?.addons) ? reg.addons : []).filter((a) => a && (a.question || a.id));

/** What their extras come to. */
export const extrasTotal = (reg) => extrasOf(reg).reduce((t, a) => t + (Number(a.fee) || 0), 0);

/** The registration fee alone - what an exemption is worth. */
export const registrationFeeOf = (reg) => Math.max(0, (Number(reg?.amount) || 0) - extrasTotal(reg));

/** What an exempted registration's exemption can still pay for. */
export const exemptCreditLeft = (reg) => (reg?.exempted_at
  ? Math.max(0, (Number(reg.exempt_cover) || 0) - (Number(reg.exempt_amount) || 0))
  : 0);

/** What an extra still costs them: its fee less what the exemption paid of it. */
export const extraNetFee = (a) => Math.max(0, (Number(a?.fee) || 0) - (Number(a?.waived) || 0));

/**
 * Extras being added to `reg`, with the exemption's credit spent on them in
 * order: each gets `waived` (when any), and `waived` is the total.
 */
export function waiveAdded(reg, added) {
  let credit = exemptCreditLeft(reg);
  let waived = 0;
  const out = (added || []).map((a) => {
    const w = Math.min(credit, Number(a.fee) || 0);
    if (w <= 0) return a;
    credit -= w;
    waived += w;
    return { ...a, waived: w };
  });
  return { added: out, waived };
}
