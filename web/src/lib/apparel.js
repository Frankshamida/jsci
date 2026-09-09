// Committee apparel: the rules the catalogue and the order desk both need.
//
// Kept out of the routes because stock arithmetic is the one thing here that
// must agree in three places - placing an order takes stock, cancelling one
// gives it back, and an Admin editing the catalogue types it directly. One
// copy of "what is left of size M" rather than three.

export const APPAREL_CATEGORIES = ['Jacket', 'Polo Shirt', 'Shirt', 'ID', 'Other'];

// pending   just ordered, nobody has looked at it
// approved  an Admin has accepted it and it is being made
// ready     it exists and is waiting to be collected
// released  handed over - the end of the road
// cancelled called off, whether by the orderer or the desk
export const ORDER_STATUSES = ['pending', 'approved', 'ready', 'released', 'cancelled'];

// The statuses that still have stock committed to them. A cancelled order has
// given its stock back; a released one has walked out of the door with it.
export const STOCK_HELD_STATUSES = ['pending', 'approved', 'ready', 'released'];

// The tables arrive in supabase/migrations/committee_apparel.sql. Until that is
// run, the answer is "run the migration" rather than a 500 with a Postgres
// error in it - the same courtesy the committee team route extends.
export function apparelMigrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('apparel_items')
    || text.includes('apparel_orders')
    || text.includes('apparel_order_items')
    || (text.includes('does not exist') && text.includes('apparel'));
}

// How many pictures one garment may carry. Front and back is the common case;
// five is enough for front, back, both sleeves and a sizing chart, and stops
// the store grid turning into an album.
export const MAX_APPAREL_IMAGES = 5;

// The picture list the rest of the code can trust: [{ url, label }], blanks
// dropped, labels trimmed, capped. Whatever shape the client sent.
export function normalizeImages(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((img) => (typeof img === 'string'
      ? { url: img.trim(), label: '' }
      : { url: String(img?.url ?? '').trim(), label: String(img?.label ?? '').trim() }))
    .filter((img) => img.url)
    .slice(0, MAX_APPAREL_IMAGES);
}

// A size list the rest of the code can trust: named sizes, whole-number stock,
// no duplicates, no blanks. Whatever shape the client sent.
export function normalizeSizes(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((s) => (typeof s === 'string'
      ? { size: s, stock: 0 }
      : { size: String(s?.size ?? '').trim(), stock: Math.max(0, Math.trunc(Number(s?.stock) || 0)) }))
    .filter((s) => {
      if (!s.size) return false;
      const key = s.size.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// An item with no named sizes is ordered as "One size" - an ID card, a pin.
export function isOneSize(item) {
  return normalizeSizes(item?.sizes).length === 0;
}

// What is left of one size (or of the whole item, when it has no sizes).
export function stockFor(item, size) {
  if (isOneSize(item)) return Math.max(0, Math.trunc(Number(item?.one_size_stock) || 0));
  const row = normalizeSizes(item?.sizes).find((s) => s.size.toLowerCase() === String(size || '').trim().toLowerCase());
  return row ? row.stock : 0;
}

// The columns to write to move one size's stock by `delta` (negative takes,
// positive gives back). Never goes below zero: a stock count that has drifted
// out of step with reality must not become a negative number on top of it.
export function stockDelta(item, size, delta) {
  if (isOneSize(item)) {
    const next = Math.max(0, (Math.trunc(Number(item?.one_size_stock) || 0)) + delta);
    return { one_size_stock: next };
  }
  const wanted = String(size || '').trim().toLowerCase();
  const sizes = normalizeSizes(item.sizes).map((s) => (s.size.toLowerCase() === wanted
    ? { ...s, stock: Math.max(0, s.stock + delta) }
    : s));
  return { sizes };
}

// "AP-7K3QF2" - short enough to read out over a table of people collecting.
export function newOrderNo() {
  const chunk = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AP-${chunk}`;
}
