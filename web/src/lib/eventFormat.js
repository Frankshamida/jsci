/* ============================================================
   How an event desk reads names, churches, statuses and dates.

   These were defined twice - once in the Admin dashboard and once in the
   Event Committee dashboard - and had already drifted: the committee's
   formatPersonName knew about Filipino name particles ("Juan dela Cruz") and
   the Admin's did not, so the same attendee's name was capitalised one way on
   one screen and another way on the other. The better of the two is the one
   kept here.

   Pure functions only. Anything needing a toast, a confirm box or component
   state stays on the page that owns it.
   ============================================================ */

/* ---- Churches ----
   Kept as typed where it is clearly an acronym (JSCI, ICM), title-cased
   otherwise, with the small joining words left lowercase unless they start
   the name. */
const CHURCH_MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'for', 'a', 'an', 'at', 'on', 'to']);

/* Somebody with no church - or who cannot be bothered to type one - writes
   "N/A", "n/a", "none", "wala" or a dash, and the church list then carries a
   handful of meaningless entries that each count as a church people came from.
   They all mean the same thing, so they are all stored as one word: Others. */
export const OTHER_CHURCH = 'Others';
const CHURCH_PLACEHOLDERS = new Set([
  'n/a', 'na', 'n.a', 'n.a.', 'nil', 'none', 'no', 'no church', 'not applicable',
  'not available', 'wala', 'wala pa', 'nothing', 'unknown', 'other', 'others', '-', '--', '.',
]);

// True for anything typed that carries no church name at all.
export function isPlaceholderChurch(name) {
  const t = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  if (!t) return false;
  return CHURCH_PLACEHOLDERS.has(t) || /^[-_/\.]+$/.test(t);
}

// What a typed church name is stored and shown as.
export function normalizeChurchName(name) {
  if (isPlaceholderChurch(name)) return OTHER_CHURCH;
  return titleCaseChurch(name);
}

export function titleCaseChurch(name) {
  const raw = (name || '').trim();
  if (!raw) return '';
  return raw.split(/(\s+)/).map((chunk) => {
    if (!chunk.trim()) return chunk;
    return chunk.split('-').map((word, wi) => {
      if (!word) return word;
      // Already an acronym - JSCI must not become Jsci.
      if (word.length > 1 && word === word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      if (wi !== 0 && CHURCH_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('-');
  }).join('');
}

export function formatChurchName(name) {
  // Rows saved before Others existed still hold "N/A" - they read as Others too.
  const t = normalizeChurchName(name);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/* ---- People ----
   People type their own names in a hurry, and the badge has to read properly
   whatever they typed. The particles matter here: "Juan Dela Cruz" is wrong
   and "Juan dela Cruz" is right, and half the registrations in this church
   have one in them. A particle only stays lowercase in the MIDDLE of a name -
   somebody actually surnamed "Delos" as their whole entry keeps its capital. */
const NAME_PARTICLES = new Set([
  'de', 'del', 'dela', 'delos', 'delas', 'da', 'di',
  'van', 'von', 'y', 'la', 'las', 'los', 'san', 'santa',
]);

export function formatPersonName(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return raw.split(' ').map((word, i, all) => {
    const lower = word.toLowerCase();
    if (i > 0 && i < all.length - 1 && NAME_PARTICLES.has(lower)) return lower;
    return lower.split('-').map((part) => part.split("'").map(capWord).join("'")).join('-');
  }).join(' ');
}

/* ---- Registration status ---- */
export const STATUS_LABELS = {
  payment_verified: 'paid',
  payment_submitted: 'for verification',
  pending_payment: 'awaiting payment',
  // Not "awaiting payment": the money is expected at the desk by arrangement,
  // so the word staff need is what they must DO about it.
  pending_cash: 'cash to collect',
  installment: 'installment',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '').replace(/_/g, ' ');
}

/* ---- Dates ----
   Event datetimes are WALL-CLOCK: the column holds "the time the admin typed"
   and Postgres stamps it +00:00 on the way in. Reading one with `new Date()`
   would shift it by the viewer's offset - an 8am session showing as 4pm - so
   the components are read off the string and rebuilt locally. */
export function evtDate(str) {
  if (!str) return null;
  if (str instanceof Date) return Number.isNaN(str.getTime()) ? null : str;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const f = new Date(str); return Number.isNaN(f.getTime()) ? null : f; }
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/* One session's own date and time. "Oct 2, 10:00 AM – 4:00 PM" for a session
   inside a day; the day is repeated when it runs past midnight. */
export function formatSessionRange(startsAt, endsAt) {
  const s = evtDate(startsAt);
  if (!s) return '';
  const e = evtDate(endsAt);
  const day = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // An end equal to the start is the same as having none.
  if (!e || e.getTime() <= s.getTime()) return `${day(s)}, ${time(s)}`;
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${day(s)}, ${time(s)} – ${time(e)}`
    : `${day(s)}, ${time(s)} – ${day(e)}, ${time(e)}`;
}

/* Rows written by the server (created_at, attended_at) are real instants, not
   wall-clock - so these two read them with plain `new Date()` on purpose. */
export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* The stamp under a tick: "OCT 2, 2026 | 8:14 AM". Upper-cased date and a
   pipe, because it sits in a narrow column under a day button and has to be
   scannable rather than readable. */
export function formatStampLine(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} | ${time}`;
}

/* ---- The event's days ----
   What the day picker and the Attendance column are both drawn from, so they
   can never disagree about how many days an event runs.

     number   1, 2, 3...
     label    the session name the admin typed, else "Day 2"
     when     its own date and time, for the picker
     started  whether it has begun. A day still in the future is shown but
              cannot be ticked - nobody has attended tomorrow. */
export function eventDaysOf(event) {
  const rows = Array.isArray(event?.event_days) ? event.event_days : [];
  const now = Date.now();

  if (rows.length > 0) {
    return rows
      .slice()
      .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
      .map((d, i) => {
        const num = Number(d.day_number) || i + 1;
        const starts = evtDate(d.starts_at);
        return {
          number: num,
          label: d.label ? String(d.label) : `Day ${num}`,
          when: d.starts_at ? formatSessionRange(d.starts_at, d.ends_at) : '',
          // No start time on the row means there is nothing to wait for.
          started: !starts || starts.getTime() <= now,
        };
      });
  }

  // No per-day schedule: count calendar days across the span, so a two-day
  // event created before sessions existed still gets two rows.
  const start = evtDate(event?.event_date);
  const end = evtDate(event?.end_date);
  let count = 1;
  if (start && end) {
    const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    count = Math.min(Math.max(1, Math.round((b - a) / 86400000) + 1), 14);
  }
  return Array.from({ length: count }, (_, i) => {
    const dayStart = start ? new Date(start.getTime() + i * 86400000) : null;
    return {
      number: i + 1,
      label: `Day ${i + 1}`,
      when: dayStart ? dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      started: !dayStart || dayStart.getTime() <= now,
    };
  });
}

/* The kit, as the event defines it. events.merch_items is a jsonb array of
   { name, image_url } written straight from the event form, so a name is the
   only stable handle there is - it is also what the person at the counter
   reads off the screen and ticks. */
export function merchItemsOf(event) {
  const rows = Array.isArray(event?.merch_items) ? event.merch_items : [];
  return rows
    .map((m) => ({ name: String(m?.name || '').trim(), image_url: m?.image_url || null }))
    .filter((m) => m.name);
}

/* A registration is only worth a card once the money is settled. Mirrors
   VERIFIED_STATUSES in api/rfid/event-checkin - 'registered' is what a free
   event produces, 'payment_verified' what a paid one becomes when staff
   confirm the payment. */
export const VERIFIED_STATUSES = ['registered', 'payment_verified'];
