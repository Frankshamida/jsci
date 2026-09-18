import { supabaseAdmin as supabase } from '@/lib/supabase';
import { isCashChannel, isCashMethodName } from '@/lib/paymentChannels';

// Was this payment settled in cash, and what is the channel actually called?
//
// The wire only ever carries the method's NAME - every registration endpoint
// takes `paymentMethod` as free text, and event_registrations stores a label
// rather than a channel id so that a renamed channel cannot rewrite what an old
// receipt says was used. That leaves one job to do on the way in: turn the label
// back into the row it came from, and believe that row's category.
//
// Why it matters: cash is the only method with no reference and no receipt.
// Whether a registration is cash decides what gets stored (never a reference,
// never a proof URL) and what its status says - see CASH_PENDING_STATUS in
// lib/eventSlots. Guessing from the words alone would misfile a channel an
// Admin named "Cash on the day", which is exactly the naming the form suggests.
//
// The fallback to reading the words is for labels with no channel behind them:
// a registration made before Mode of Payment existed, or one of the free-text
// chips ("Cash", "Pay at Church") an event can still carry.
export async function resolveCashPayment(eventRow, methodLabel) {
  const label = String(methodLabel || '').trim();
  if (!label) return { isCash: false, name: null };

  const ids = Array.isArray(eventRow?.payment_method_ids) ? eventRow.payment_method_ids : [];
  if (ids.length) {
    try {
      const { data } = await supabase
        .from('payment_methods').select('id, name, category').in('id', ids);
      const hit = (data || []).find(
        (c) => String(c.name || '').trim().toLowerCase() === label.toLowerCase(),
      );
      // The channel's own spelling wins over whatever the client typed, so one
      // account cannot end up under two spellings in the registration list.
      if (hit) return { isCash: isCashChannel(hit), name: hit.name };
    } catch { /* the label still has to be honoured - fall through */ }
  }

  return { isCash: isCashMethodName(label), name: label };
}
