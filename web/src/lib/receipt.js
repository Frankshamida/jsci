// One attendee on a receipt - the Change to Give receipt at the verification
// desk and the Payments tab's - as their registration reads now:
//
//   lines     what it costs at full price - the registration fee and each
//             extra - then what came off it: the exemption, a discount. They
//             add up to `subtotal`, which is what they owe (amount).
//   tags      what is special about them, said plainly at the top:
//             "Exempted · Usher", "Accommodation free", "Registration fee
//             waived", "Discounted ₱50 · Senior", "Free", "Substitute for ..."
//
// Safe to import in the browser.

import { addonShortLabel } from '@/lib/eventPricing';
import { formatPersonName } from '@/lib/eventFormat';
import { extraNetFee } from '@/lib/exemption';

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

export function receiptOf(reg) {
  if (!reg) return { lines: [], tags: [], subtotal: 0 };
  const extras = (Array.isArray(reg.addons) ? reg.addons : []).filter((a) => a && (a.question || a.id));
  const amount = Number(reg.amount) || 0;
  const discount = Number(reg.discount_amount) || 0;
  const exempted = !!reg.exempted_at;
  const exemptNote = String(reg.exempt_note || '').trim() || 'Committee';
  const exemptTotal = exempted ? Number(reg.exempt_amount) || 0 : 0;
  // What the exemption paid of each extra is on the extra; the rest of what
  // it waived came off the registration fee.
  const extrasWaived = extras.reduce((t, a) => t + (Number(a.waived) || 0), 0);
  const feeWaived = Math.max(0, exemptTotal - extrasWaived);
  const extrasNet = extras.reduce((t, a) => t + extraNetFee(a), 0);
  // The fee as charged: what is left of the amount once the extras are out,
  // plus what came off it.
  const feeGross = Math.max(0, amount - extrasNet) + discount + feeWaived;

  const lines = [
    {
      label: `Registration fee${reg.price_tier ? ` · ${reg.price_tier}` : ''}`,
      amount: feeGross,
      tag: feeWaived > 0 && feeWaived >= feeGross ? 'waived · exempted' : feeGross === 0 ? 'free' : '',
    },
    ...extras.map((a) => {
      const fee = Number(a.fee) || 0;
      const waived = Number(a.waived) || 0;
      return {
        label: addonShortLabel(a.question),
        amount: fee,
        tag: fee > 0 && waived >= fee ? 'free · exempted' : waived > 0 ? `${peso(waived)} exempted` : fee === 0 ? 'free' : '',
      };
    }),
  ];
  if (exemptTotal > 0) {
    const what = [
      feeWaived > 0 ? 'registration fee waived' : '',
      ...extras.filter((a) => Number(a.waived) > 0).map((a) => `${addonShortLabel(a.question).toLowerCase()} free`),
    ].filter(Boolean).join(' + ');
    lines.push({ label: `Exemption · ${exemptNote}`, amount: -exemptTotal, deduct: true, tag: what });
  }
  if (discount > 0) {
    lines.push({ label: `Discount${reg.discount_note ? ` · ${reg.discount_note}` : ''}`, amount: -discount, deduct: true });
  }

  const tags = [];
  if (exempted) tags.push({ tone: 'exempt', text: `Exempted · ${exemptNote}` });
  const freeExtras = extras.filter((a) => Number(a.fee) > 0 && Number(a.waived) >= Number(a.fee)).map((a) => addonShortLabel(a.question));
  if (freeExtras.length) tags.push({ tone: 'free', text: `${freeExtras.join(', ')} free` });
  else if (extrasWaived > 0) tags.push({ tone: 'free', text: `${peso(extrasWaived)} of extras free` });
  if (feeWaived > 0) tags.push({ tone: 'free', text: feeWaived >= feeGross ? 'Registration fee waived' : `${peso(feeWaived)} of the fee waived` });
  if (discount > 0) tags.push({ tone: 'discount', text: `Discounted ${peso(discount)}${reg.discount_note ? ` · ${reg.discount_note}` : ''}` });
  if (amount === 0 && !exempted && discount === 0) {
    tags.push({ tone: 'free', text: reg.guardian_name ? `Free · with ${formatPersonName(reg.guardian_name)}` : 'Free' });
  }
  if (reg.original_attendee_name) tags.push({ tone: 'info', text: `Substitute for ${formatPersonName(reg.original_attendee_name)}` });

  return { lines, tags, subtotal: amount };
}

/** "−₱200" for what came off, "₱300" for the rest. */
export const receiptPeso = (n) => `${n < 0 ? '−' : ''}${peso(Math.abs(Number(n) || 0))}`;
