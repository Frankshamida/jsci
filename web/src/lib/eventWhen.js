// Reading an event's dates the way the rest of the app writes them.
//
// These used to live inside src/app/page.js. They moved here when Joy (the
// public chatbot) started answering questions about real events: she has to
// read "when" exactly the way the event cards do, and a second copy of this
// parsing would eventually drift from the first and have her quoting a time
// nobody else on the page could see.

// Event datetimes are stored as WALL-CLOCK time: the form posts what the admin
// typed ("2026-09-08T10:00") and Postgres stamps it +00:00, so Supabase hands
// back "2026-09-08T10:00:00+00:00" meaning "10:00 on the day", not an instant
// in UTC. Passing that to `new Date()` shifts it by the viewer's offset - in
// Manila a 10:00 AM - 6:00 PM event rendered as 6:00 PM - 2:00 AM and so looked
// like it spanned two days. So the components are read off the string and
// rebuilt as a local Date, which is what every display below expects.
export const evtDate = (str) => {
  if (!str) return null;
  if (str instanceof Date) return Number.isNaN(str.getTime()) ? null : str;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const fallback = new Date(str);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d;
};

// Same value as a millisecond stamp, or null. Handy for the many
// `? ... .getTime() : null` comparisons against Date.now().
export const evtMs = (str) => { const d = evtDate(str); return d ? d.getTime() : null; };

// How many CALENDAR days an event covers: Fri 9am -> Sun 5pm is 3 days to a
// person even though it is 56 hours, so both ends are normalised to midnight.
export const evtDayCount = (startStr, endStr) => {
  if (!startStr || !endStr) return 1;
  const s = evtDate(startStr);
  const e = evtDate(endStr);
  if (!s || !e) return 1;
  const s0 = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const e0 = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const days = Math.round((e0.getTime() - s0.getTime()) / 86400000) + 1;
  return days < 1 ? 1 : days;
};

// Where the event sits relative to now. Used for the status pill.
// An event with no end date is treated as over once its start has passed.
export const evtStatus = (startStr, endStr) => {
  if (!startStr) return null;
  const s = evtDate(startStr);
  if (!s) return null;
  const now = Date.now();
  const endMs = evtMs(endStr) ?? s.getTime();
  if (now < s.getTime()) return 'upcoming';
  if (now <= endMs) return 'ongoing';
  return 'ended';
};

// "Saturday, September 26, 2025 at 9:00 AM - Monday, September 28 at 5:00 PM"
// The old version formatted end_date with hour+minute ONLY, so a multi-day
// event read as "September 26 at 9:00 AM - 5:00 PM" and silently lost the
// end date entirely. Same-day events still collapse to just the end time.
export const evtWhen = (startStr, endStr) => {
  if (!startStr) return 'TBA';
  const s = evtDate(startStr);
  if (!s) return 'TBA';
  const full = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  const startTxt = s.toLocaleString('en-US', full);
  if (!endStr) return startTxt;
  const e = evtDate(endStr);
  if (!e) return startTxt;
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  if (sameDay) return startTxt + ' – ' + e.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameYear = s.getFullYear() === e.getFullYear();
  const endTxt = e.toLocaleString('en-US', sameYear
    ? { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : full);
  return startTxt + ' – ' + endTxt;
};

// "in 12 days" / "tomorrow" / "today" - the thing people actually want to know
// after the date itself. Counted in calendar days so an event at 9:00 AM
// tomorrow is "tomorrow" even when it is only fourteen hours away.
export const evtCountdown = (startStr, endStr) => {
  const s = evtDate(startStr);
  if (!s) return null;
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(s) - midnight(new Date())) / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  const e = evtDate(endStr);
  // Started already but still running - say so rather than "3 days ago".
  if (e && Date.now() <= e.getTime()) return 'happening now';
  const ago = Math.abs(days);
  return ago === 1 ? 'yesterday' : `${ago} days ago`;
};
