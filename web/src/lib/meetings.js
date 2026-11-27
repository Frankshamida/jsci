// Ministry Meetings: what the browser and the server share.
//
// Times. A meeting is a real moment, stored as timestamptz. The form's
// <input type="datetime-local"> holds a Manila wall-clock time ("2026-12-05T14:00")
// and is sent with its +08:00 offset, so the database keeps the right instant
// whatever the viewer's device is set to. Everything is shown in Manila time.
// The Philippines has no daylight saving, so +08:00 is always right.
//
// Calendars. A meeting has a start time only, so a calendar entry runs for
// MEETING_LENGTH_MIN minutes.

export const MEETING_TZ = 'Asia/Manila';
export const MEETING_LENGTH_MIN = 60;
export const RSVP_CHOICES = ['Going', 'Maybe', 'Not Going'];
export const MEETING_STATUSES = ['Scheduled', 'Completed', 'Cancelled'];
export const MEETING_LIMITS = { title: 120, description: 2000, location: 200 };
// A meeting stays under "Upcoming" until this long after it starts.
export const STILL_ON_MS = 2 * 60 * 60 * 1000;

/** "Media, Praise And Worship" -> ['Media', 'Praise And Worship'] (trimmed, no repeats). */
export function splitMinistries(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return list.map((s) => String(s || '').trim()).filter((s) => {
    const k = ministryKey(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** For comparing ministry names: "Back-up" = "backup", "Praise and Worship " = "praiseandworship". */
export const ministryKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---- Manila time ----

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** datetime-local value (Manila) -> ISO instant with its offset, or null. */
export function inputToIso(value) {
  const m = INPUT_RE.exec(String(value || ''));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** ISO instant -> datetime-local value in Manila time ('' when unreadable). */
export function isoToInput(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16);
}

/** The Manila calendar day of an instant, 'YYYY-MM-DD'. */
export function manilaDay(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Intl formatting in Manila time. */
export function fmt(iso, opts) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { timeZone: MEETING_TZ, ...opts });
}

/** "Sat, Dec 5 · 2:00 PM" */
export function whenLabel(iso) {
  return `${fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmt(iso, { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Today", "Tomorrow", "In 3 days", "Next week" ... relative to now, by Manila days. */
export function relativeDay(iso, now = Date.now()) {
  const a = manilaDay(new Date(now).toISOString());
  const b = manilaDay(iso);
  if (!a || !b) return '';
  const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days >= 7 && days < 14) return 'Next week';
  if (days >= 14 && days < 60) return `In ${Math.round(days / 7)} weeks`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return '';
}

// ---- Calendars ----

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261205T060000Z

/** A Google Calendar "add event" link. */
export function googleCalendarUrl(m, { origin = '' } = {}) {
  const start = new Date(m.startsAt).getTime();
  const end = start + MEETING_LENGTH_MIN * 60 * 1000;
  const details = [m.description, origin ? `Ministry Meetings: ${origin}/dashboard/ministry-meetings` : '']
    .filter(Boolean).join('\n\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${stamp(start)}/${stamp(end)}`,
    details,
    location: m.location || '',
    ctz: MEETING_TZ,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const icsText = (s) => String(s || '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets are folded: CRLF and a space (RFC 5545 3.1).
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** An .ics file for one meeting, with a reminder an hour before. */
export function meetingIcs(m, { origin = '', host = 'sanctuaryhub' } = {}) {
  const start = new Date(m.startsAt).getTime();
  const end = start + MEETING_LENGTH_MIN * 60 * 1000;
  const updated = new Date(m.updatedAt || m.createdAt || Date.now()).getTime();
  const cancelled = m.status === 'Cancelled';
  const desc = [
    m.description,
    m.ministries?.length ? `For: ${m.ministries.join(', ')}` : '',
    m.organizer?.name ? `Organizer: ${m.organizer.name}` : '',
    origin ? `${origin}/dashboard/ministry-meetings` : '',
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SanctuaryHub//Ministry Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:meeting-${m.id}@${host}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    // Updates replace the copy already in the calendar, newest wins.
    `SEQUENCE:${Math.max(0, Math.floor(updated / 1000) - 1700000000)}`,
    `LAST-MODIFIED:${stamp(updated)}`,
    `SUMMARY:${icsText(m.title)}`,
    desc ? `DESCRIPTION:${icsText(desc)}` : null,
    m.location ? `LOCATION:${icsText(m.location)}` : null,
    origin ? `URL:${origin}/dashboard/ministry-meetings` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    cancelled ? null : 'BEGIN:VALARM',
    cancelled ? null : 'TRIGGER:-PT1H',
    cancelled ? null : 'ACTION:DISPLAY',
    cancelled ? null : `DESCRIPTION:${icsText(`${m.title} starts in an hour`)}`,
    cancelled ? null : 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** A file name for the .ics: "christmas-services-worship-planning.ics". */
export function icsFileName(title) {
  const base = String(title || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'meeting'}.ics`;
}

/** First letters for an avatar: "Weldon Pior" -> "WP". */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
