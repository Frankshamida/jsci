import { supabaseAdmin as supabase } from '@/lib/supabase';

// Which payments the committee store accepts, and where they go.
//
// The channels live in payment_methods - the same rows the events use, kept
// under Mode of Payment - so editing an account number there updates every
// item pointing at it. An item only stores the ids it accepts.
//
// Shared between the catalogue and the order desk, because both have to answer
// the same question on the server: is this a payment this item actually takes?

export const APPAREL_CHANNEL_COLUMNS = 'id, category, name, account_number, account_name, logo_url, logo_color, qr_url, notes, is_active, sort_order';

// What cash is called when an Admin has not renamed it.
export const DEFAULT_CASH_LABEL = 'Pay Cash at Church';

export function apparelIdList(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? [...new Set(list.filter(Boolean).map(String))] : [];
}

// Every channel a payer may be sent to. Hidden channels are excluded here
// rather than at the call sites, so a channel switched off under Mode of
// Payment stops being offered everywhere at once.
export async function listVisibleChannels() {
  const { data } = await supabase.from('payment_methods').select(APPAREL_CHANNEL_COLUMNS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return data || [];
}

// The channels one item accepts, as live rows in the order they were ticked.
export function channelsForItem(item, visible) {
  const ids = apparelIdList(item?.payment_method_ids);
  const byId = new Map((visible || []).map((m) => [String(m.id), m]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function cashLabelForItem(item) {
  return String(item?.cash_label || '').trim() || DEFAULT_CASH_LABEL;
}

// What a BASKET can be paid with: only what every item in it accepts. Two
// items with nothing in common cannot go on one payment, and saying so beats
// taking money through a channel one of them does not use.
export function paymentsForBasket(items, visible) {
  if (!items || items.length === 0) return { cash: false, channels: [], cashLabel: DEFAULT_CASH_LABEL };
  const cash = items.every((it) => it.allow_cash !== false);
  const shared = items
    .map((it) => new Set(channelsForItem(it, visible).map((c) => String(c.id))))
    .reduce((acc, set) => (acc === null ? set : new Set([...acc].filter((id) => set.has(id)))), null);
  const channels = (visible || []).filter((m) => shared?.has(String(m.id)));
  return { cash, channels, cashLabel: cashLabelForItem(items[0]) };
}
