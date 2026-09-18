// The church's real events, written out for Joy to read.
//
// WHY IT EXISTS: Joy (the public chatbot on the home page) used to be told a
// handful of facts baked into her prompt - service times, ISOM, "check the
// Events tab". So when a visitor asked "what events are coming up?" she could
// only point at a navbar link, and if she was pressed for a date or a venue
// she had nothing to give but an apology. Meanwhile the very same page had
// already loaded every published event out of Supabase to draw the cards.
//
// This turns those rows into a short briefing that goes into her system
// prompt, so the answer she gives is the event as it stands in the database
// right now: its time, its venue, how many days it runs, what it costs, how
// many slots are left and whether registration is even open yet.
//
// It is deliberately plain text rather than JSON. The model reads it once per
// message and repeats bits of it back; a labelled list is cheaper in tokens
// than braces and quotes, and it degrades gracefully - a field we cannot fill
// is simply left out rather than showing up as a null the model might read
// aloud.

import { evtCountdown, evtDate, evtDayCount, evtMs, evtStatus, evtWhen } from './eventWhen';

// How many events go into the prompt. Everything after this is summarised as a
// count, because a briefing longer than the conversation itself starts pushing
// the visitor's own questions out of the model's window.
const MAX_EVENTS = 10;
// An event's own blurb, trimmed. Enough for the model to describe the event in
// its own words without pasting a whole poster into the prompt.
const MAX_DESC = 320;

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

const shortDate = (str) => {
  const d = evtDate(str);
  return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
};

const dayTime = (str) => {
  const d = evtDate(str);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
};

const trim = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

// The full street-to-province address, skipping the parts an admin left blank.
export const evtFullPlace = (evt) => [evt?.location, evt?.loc_barangay, evt?.loc_city, evt?.loc_province]
  .map((x) => String(x || '').trim())
  .filter(Boolean)
  .join(', ');

// Just the town - "Cebu City", "Ormoc". This is what tells two events apart
// when they share a name, which happens more than you would think: one
// conference is taken on tour and every leg is called the same thing.
export const evtPlaceLabel = (evt) => String(evt?.loc_city || evt?.loc_province || evt?.loc_region || '').trim();

// Seats left, from the count the events API attaches. null when the event has
// no cap at all, which is a different thing from "nothing left".
const slotsLeft = (evt) => (evt?.slots_left != null
  ? evt.slots_left
  : (evt?.max_participants ? Math.max(0, evt.max_participants - (evt.registered_count || 0)) : null));

// One line saying whether somebody can sign up this minute, and if not, why.
// Same rules the register button on the card follows, so Joy never invites
// anyone into a form the page would refuse to open.
const registrationLine = (evt) => {
  if (evt?.registration_required === false) return 'No registration needed - everyone is welcome to simply come.';
  const left = slotsLeft(evt);
  const opens = evtMs(evt?.registration_start_date);
  const closes = evtMs(evt?.registration_deadline);
  const now = Date.now();
  // Sentence case, not shouting. An earlier version wrote "FULLY BOOKED" to
  // make the model notice it, and the model dutifully shouted it back at the
  // visitor.
  if (left != null && left <= 0) return 'Fully booked - registration is closed because every slot is taken.';
  if (opens && now < opens) return `Not open yet - registration opens ${shortDate(evt.registration_start_date)}.`;
  if (closes && now > closes) return `Closed - the deadline was ${shortDate(evt.registration_deadline)}.`;
  if (closes) return `Open now, closing ${shortDate(evt.registration_deadline)}.`;
  return 'Open now.';
};

const feeLine = (evt) => {
  if (!evt?.has_fee) return 'Free to attend.';
  const base = `${peso(evt.registration_fee)} per person`;
  const earlyMs = evtMs(evt.early_bird_deadline);
  if (evt.early_bird_price != null && earlyMs && Date.now() <= earlyMs) {
    return `${peso(evt.early_bird_price)} per person (early-bird price, until ${shortDate(evt.early_bird_deadline)}), then ${base}`;
  }
  if (evt.onsite_price != null) return `${base} (${peso(evt.onsite_price)} if paying at the door)`;
  return base;
};

// "Day 1: Oct 4, 9:00 AM - 6:00 PM (Opening Night)" for every session an event
// has. This is the answer to "what time does it start each day", which a single
// start-to-end span cannot give for a three-day conference.
const scheduleLines = (evt) => {
  const rows = Array.isArray(evt?.event_days) ? evt.event_days : [];
  if (rows.length === 0) return [];
  return rows
    .slice()
    .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
    .map((d, i) => {
      const start = evtDate(d.starts_at);
      if (!start) return null;
      const date = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const end = evtDate(d.ends_at);
      const hours = end && end.getTime() > start.getTime()
        ? `${dayTime(d.starts_at)} - ${dayTime(d.ends_at)}`
        : `starts ${dayTime(d.starts_at)}`;
      return `Day ${d.day_number || i + 1}: ${date}, ${hours}${d.label ? ` (${d.label})` : ''}`;
    })
    .filter(Boolean);
};

// Everything worth saying about one event, as labelled lines.
const eventBlock = (evt, index) => {
  const status = evtStatus(evt.event_date, evt.end_date);
  const countdown = evtCountdown(evt.event_date, evt.end_date);
  const days = evtDayCount(evt.event_date, evt.end_date);
  const left = slotsLeft(evt);
  const lines = [];

  // The town goes in the heading, not just in the Where line below: when the
  // same conference tours three cities under one name, this is the only thing
  // that tells the visitor - and the model - which one is being described.
  const town = evtPlaceLabel(evt);
  lines.push(`EVENT ${index + 1}: "${evt.title}"${town ? ` (held in ${town})` : ''}`);
  // The countdown is dropped for an event already under way - "HAPPENING NOW
  // (happening now)" is the same fact said twice.
  const when = status === 'ongoing'
    ? 'HAPPENING NOW'
    : `${(status || 'scheduled').toUpperCase()}${countdown ? ` (${countdown})` : ''}`;
  lines.push(`  Status: ${when}`);
  lines.push(`  When: ${evtWhen(evt.event_date, evt.end_date)}`);
  lines.push(`  Length: ${days === 1 ? 'single day' : `${days} days`}`);

  const schedule = scheduleLines(evt);
  // Only worth listing when there is more than one session - for a single-day
  // event the schedule just repeats the When line back.
  if (schedule.length > 1) {
    lines.push('  Daily schedule:');
    schedule.forEach((s) => lines.push(`    - ${s}`));
  }

  const place = evtFullPlace(evt);
  lines.push(`  Where: ${place || 'Venue not announced yet'}`);
  lines.push(`  Cost: ${feeLine(evt)}`);

  if (evt.max_participants) {
    lines.push(`  Slots: ${left} of ${evt.max_participants} still available`);
  } else {
    lines.push('  Slots: no limit set');
  }
  lines.push(`  Registration: ${registrationLine(evt)}`);

  const addons = (evt.event_addons || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  if (addons.length) {
    const listed = addons.map((a) => `${a.question}${Number(a.fee) > 0 ? ` (+${peso(a.fee)})` : ' (free)'}${a.is_required ? ' [required]' : ''}`);
    lines.push(`  Optional extras: ${listed.join('; ')}`);
  }

  if (evt.has_fee && evt.payment_instructions) lines.push(`  How to pay: ${trim(evt.payment_instructions, 200)}`);
  if (evt.contact_number) lines.push(`  Contact: ${[evt.contact_name, evt.contact_number].filter(Boolean).join(' - ')}`);
  if (Array.isArray(evt.allowed_roles) && evt.allowed_roles.length) {
    lines.push(`  Who may attend: ${evt.allowed_roles.join(', ')} only`);
  }
  const about = trim(evt.description, MAX_DESC);
  if (about) lines.push(`  About: ${about}`);

  return lines.join('\n');
};

// The whole briefing. `events` is the published list the home page already
// holds; anything unpublished never reaches the browser in the first place.
export const buildEventsDigest = (events, { max = MAX_EVENTS } = {}) => {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const header = `Today is ${today}.`;

  const rows = Array.isArray(events) ? events.filter((e) => e && e.title) : [];
  // Ended events are dropped rather than described: nobody asks a chatbot to
  // sell them a conference that finished last month, and every line spent on
  // one is a line not spent on the next one coming up.
  const live = rows.filter((e) => evtStatus(e.event_date, e.end_date) !== 'ended');

  if (live.length === 0) {
    return `${header}

LIVE EVENT DATA (read from the church database just now):
There are no upcoming events on the calendar at the moment. Say so plainly and invite them to check back, or point them to the weekly services listed above.`;
  }

  const sorted = live.slice().sort((a, b) => (evtMs(a.event_date) ?? 0) - (evtMs(b.event_date) ?? 0));
  const shown = sorted.slice(0, max);
  const blocks = shown.map(eventBlock).join('\n\n');
  const overflow = sorted.length > shown.length
    ? `\n\n(There are ${sorted.length - shown.length} more events further out. Mention that they exist and point to the Events section for the full list.)`
    : '';

  return `${header}

LIVE EVENT DATA (read from the church database just now - ${shown.length} ${shown.length === 1 ? 'event' : 'events'}):

${blocks}${overflow}`;
};

// Which of these events a reply is actually talking about, so the chat can put
// a "View details" button under it. Matched on the title, and on the title with
// a trailing "Event"/"Conference" dropped, because Joy often shortens a name
// the second time she mentions it.
export const eventsMentionedIn = (reply, events) => {
  const haystack = String(reply || '').toLowerCase();
  if (!haystack) return [];
  const hits = [];
  (Array.isArray(events) ? events : []).forEach((evt) => {
    const title = String(evt?.title || '').trim();
    if (title.length < 3) return;
    const short = title.replace(/\s+(event|conference|convention|seminar)s?$/i, '').trim();
    const needle = (short.length >= 3 ? short : title).toLowerCase();
    if (haystack.includes(needle)) hits.push(evt);
  });
  return hits;
};
