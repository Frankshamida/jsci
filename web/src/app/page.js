'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import './home.css';
import { withTitleCase } from '@/lib/eventTitle';
import { sameAddon } from '@/lib/addons';
import { eventSlug, findEventBySlug, slugFromPath } from '@/lib/eventSlug';
import { eventCardTitle } from '@/lib/socialCard';
import { EVENT_IMAGE_SIZES, eventImageSrcSet, eventImageUrl } from '@/lib/eventImage';
import { HERO_MEDIA_DEFAULT, heroVideoFor, normalizeHeroMedia } from '@/lib/heroMedia';
import HeroVideo from '@/components/HeroVideo';
import { useBranding } from '@/components/BrandingProvider';
import { SiteNavbar } from '@/components/SiteChrome';
import { isGuestOnly, useViewer } from '@/lib/viewer';
import GuestHome from '@/components/guest/GuestHome';
import GiveShowcase from '@/components/giving/GiveShowcase';
import { linkMeta } from '@/lib/linkMeta';
import { newsDate, newsImage } from '@/lib/news';
import { evtDate, evtDayCount, evtMs, evtStatus, evtWhen } from '@/lib/eventWhen';
import { buildEventsDigest, eventsMentionedIn, evtPlaceLabel } from '@/lib/eventDigest';
import { PROOF_ACCEPT, PROOF_MAX_BYTES, PROOF_MAX_LABEL, shrinkProofImage } from '@/lib/proofFile';
import { isCashChannel, channelTypeLabel, channelTypeIcon, eventTakesCash } from '@/lib/paymentChannels';
import { OTHER_CHURCH, isPlaceholderChurch, normalizeChurchName } from '@/lib/eventFormat';
import AgeGroupPicker from '@/components/AgeGroupPicker';
import GuardianPicker from '@/components/GuardianPicker';
import PastorInput from '@/components/PastorInput';
import { usePastors } from '@/lib/usePastors';
import {
  addonFeeFor, addonShortLabel, baseAmountFor, defaultTier, eventFeeLabel, eventTiers,
  findTier, hasPriceTiers, isNameOnlyTier, nameOnlyTiers, representativeTiers,
  tierAgeLabel, tierFee,
} from '@/lib/eventPricing';

// ============================================
// DATA
// ============================================
// `sub` is the line each slide used to caption itself with under the lockup.
// The hero shows the name and the two buttons only now, so nothing reads it -
// it is kept because it is the copy, and restoring the caption should not mean
// writing it again.
const HERO_SLIDES = [
  { img: '/assets/worship-service.jpg', title: 'Experience God\'s Presence', sub: 'Join us every Sunday for a powerful time of worship and the Word' },
  { img: '/assets/community-outreach.jpg', title: 'Reaching Our Community', sub: 'Extending God\'s love through service and outreach to those in need' },
  { img: '/assets/youth-event.jpg', title: 'Empowering the Next Generation', sub: 'Dynamic youth programs for spiritual growth and fun fellowship' },
  { img: '/assets/christian-leadership-conference.jpg', title: 'Raising Up Leaders', sub: 'Equipping believers for effective ministry and leadership' },
  { img: '/assets/baptism-service.jpg', title: 'New Life in Christ', sub: 'Celebrating lives transformed through faith and baptism' },
];

// A guest registration needs only who is coming and, when there is something
// to pay, how they paid it.
const EMPTY_GUEST_REG_FORM = {
  firstName: '', lastName: '', churchName: '', churchPastor: '', mobile: '', email: '',
  // Which age group they are in, on an event that prices by age. Empty on an
  // event with one price, which is most of them.
  priceTier: '',
  paymentMethod: '', paymentReference: '',
};

// `match` finds the pastor in one of Joy's replies, so her answer can show
// their photo. "Psalm" alone is a book of the Bible, so that one needs the
// "Pastor"/"Ptr." in front of it or the surname after it.
const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: '/assets/dr-weldon-pior.png', match: /\bweldon\b/i },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: '/assets/dr-dorothy-pior.png', match: /\bdorothy\b/i },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: '/assets/ptr-gracelyn-gambe.png', match: /\bgracelyn\b/i },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: '/assets/ptr-eldan-gambe.png', match: /\beldan\b/i },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: '/assets/ptr-psalm-gambe.png', match: /\b(?:ptr\.?|pastor)\s+psalm\b|\bpsalm\s+gambe\b/i },
];
const pastorsNamedIn = (text) => PASTORS.filter((p) => p.match.test(String(text || '')));

// `group` is what the filter chips above the grid sort them by.
const ACTIVITIES = [
  { title: 'Sunday Worship Service', desc: 'Our church family united in powerful worship and biblical teaching every Sunday morning.', photo: '/assets/worship-service.jpg', badge: 'Weekly', group: 'weekly' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study and discussion for spiritual growth and deeper understanding of God\'s Word.', photo: '/assets/friday-bible-study.jpg', badge: 'Weekly', group: 'weekly' },
  { title: 'ISOM Training', desc: 'International School of Ministry — equipping leaders for effective kingdom work and ministry.', photo: '/assets/isom-training.jpg', badge: 'Ongoing', group: 'training' },
  { title: 'Online Midweek Service', desc: 'Join us online every Wednesday for worship, teaching, and fellowship from wherever you are.', photo: '/assets/Midweek_Service.png', badge: 'Weekly', group: 'weekly' },
  { title: 'Youth Ministry', desc: 'Dynamic gatherings filled with fun, fellowship, games, and spiritual growth for the youth.', photo: '/assets/youth-event.jpg', badge: 'Monthly', group: 'monthly' },
  { title: 'Community Outreach', desc: 'Serving our community with practical needs and sharing the good news of Jesus Christ.', photo: '/assets/community-outreach.jpg', badge: 'Quarterly', group: 'special' },
  { title: 'Pastor Appreciation', desc: 'Honoring and celebrating our dedicated pastors for their faithful service and leadership.', photo: '/assets/pastor-appreciation.jpg', badge: 'Annual', group: 'special' },
  { title: 'Leadership Conference', desc: 'Equipping and empowering believers to raise up the next generation of kingdom leaders.', photo: '/assets/Leadership Conference.jpg', badge: 'Annual', group: 'special' },
];

const ACTIVITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'special', label: 'Special Events' },
  { key: 'training', label: 'Training' },
];

// The ministries a member can serve in - the same five the ministry app and
// the dashboard's ministry roles are built around.
const MINISTRIES = [
  { name: 'Praise & Worship', desc: 'Lead the church in Spirit-filled worship through music and song.' },
  { name: 'Media Ministry', desc: 'Run the screens, sound and live stream that carry every service.' },
  { name: 'Dance Ministry', desc: 'Worship through movement and bring the message to life on stage.' },
  { name: 'Ushering Ministry', desc: 'Welcome every guest at the door and keep each service in order.' },
  { name: 'Youth Ministry', desc: 'Fellowship, games and the Word for the next generation of believers.' },
];

// "What to expect" on a first visit. Nothing here promises a detail the
// church has not stated - no service length, no parking, no dress code.
const VISIT_STEPS = [
  { title: 'Come as you are', text: 'Arrive a few minutes early. Our ushers will welcome you and help you find a seat.' },
  { title: 'Worship together', text: 'Spirit-filled praise led by our Praise & Worship ministry.' },
  { title: 'Hear the Word', text: 'Bible-centered preaching from our pastors that you can live out during the week.' },
  { title: 'Stay and connect', text: 'Meet the church family, and ask about our ministries, events and ISOM.' },
];

// ---- Where the church is ----
// The pin the Visit Us map has always pointed at. The Street View embed is the
// view somebody chose of the building; the plain map is what gets a visitor
// there, so the map is shown first and the street view is one tap away.
const CHURCH_LAT = 10.31957253395332;
const CHURCH_LNG = 123.8994709106599;
const CHURCH_CITY = 'Cebu City, Philippines';
// Google's keyless embed, at the address `maps.google.com/maps?...&output=embed`
// redirects to - asked for directly, so the frame does not ride a redirect.
const MAP_EMBED_URL = `https://www.google.com/maps/embed?origin=mfe&pb=!1m3!2m1!1s${CHURCH_LAT},${CHURCH_LNG}!6i17`;
const STREET_EMBED_URL = 'https://www.google.com/maps/embed?pb=!4v1772207931266!6m8!1m7!1sdo9Akv3QAW6kJETCDEd_HQ!2m2!1d10.31957253395332!2d123.8994709106599!3f236.24502041751504!4f2.753458141938296!5f0.7820865974627469';
const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${CHURCH_LAT},${CHURCH_LNG}`;
const MAP_URL = `https://www.google.com/maps/search/?api=1&query=${CHURCH_LAT},${CHURCH_LNG}`;
const FACEBOOK_URL = 'https://www.facebook.com/CebuCityJoyfulSound';
const MESSENGER_URL = 'https://m.me/CebuCityJoyfulSound';
const YOUTUBE_URL = 'https://www.youtube.com/@JoyfulSoundChurchCebuCity';

// ---- The next gathering, in church time ----
// The services are held in Cebu, so "Sunday 9:00 AM" means 9:00 in the
// Philippines (UTC+8, no daylight saving) wherever the visitor is reading
// from. The wall clock is worked out in UTC+8 and turned back into an instant.
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

const nextGathering = (nowMs) => {
  const ph = new Date(nowMs + PH_OFFSET_MS);
  let best = null;
  SERVICE_TIMES.forEach((s) => {
    for (let add = 0; add <= 7; add += 1) {
      const wall = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate() + add, s.hour, s.minute));
      if (wall.getUTCDay() !== s.dow) continue;
      const startMs = wall.getTime() - PH_OFFSET_MS;
      if (startMs <= nowMs) continue;
      if (!best || startMs < best.startMs) best = { ...s, startMs };
      break;
    }
  });
  return best;
};

// "in 2 days, 4 hrs" / "in 3 hrs 20 min" / "in 12 min"
const untilLabel = (ms) => {
  const mins = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const min = mins % 60;
  if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}${hrs ? `, ${hrs} hr${hrs > 1 ? 's' : ''}` : ''}`;
  if (hrs > 0) return `in ${hrs} hr${hrs > 1 ? 's' : ''}${min ? ` ${min} min` : ''}`;
  return `in ${min} min`;
};

const phDayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', {
  weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
});

// The verse is wrapped in curly quotes by the page, so quotes the AI (or an
// old cached copy) put round the whole thing are taken off first, and any
// left inside become single quotes - a quotation inside a quotation.
const cleanVerse = (text) => {
  const t = String(text || '').trim().replace(/^["“”]+|["“”]+$/g, '').trim();
  return t.replace(/(^|[\s(—-])["“]/g, '$1‘').replace(/["”]/g, '’');
};

// `dow` (0 = Sunday) and the hour are what "Next Gathering" counts down to;
// the rest is what the cards print.
const SERVICE_TIMES = [
  { icon: 'fa-sun', day: 'Sunday', time: '9:00 AM', name: 'Worship Service', dow: 0, hour: 9, minute: 0 },
  { icon: 'fa-book-bible', day: 'Friday', time: '7:00 PM', name: 'Bible Study', dow: 5, hour: 19, minute: 0 },
  { icon: 'fa-users', day: 'Saturday', time: '2:00 PM', name: 'Youth Fellowship', dow: 6, hour: 14, minute: 0 },
];

const ISOM_SLIDES = [
  '/assets/isom-training.jpg',
  '/assets/christian-leadership-conference.jpg',
  '/assets/friday-bible-study.jpg',
  '/assets/worship-service.jpg',
  '/assets/community-outreach.jpg',
];

// ---- Event date helpers -------------------------------------------------
// evtDate / evtMs / evtDayCount / evtStatus / evtWhen now live in
// src/lib/eventWhen.js, because Joy's event briefing (lib/eventDigest) has to
// read an event's dates exactly the way these cards do.

// "Cebu Event" - the place people know the event by. Uses the city, falling
// back to the province or region, and drops a redundant "City" suffix so it
// reads "Cebu Event" rather than "Cebu City Event".
const evtRegionLabel = (evt) => {
  const place = (evt?.loc_city || evt?.loc_province || evt?.loc_region || '').trim();
  if (!place) return 'Event Registration';
  return place.replace(/\s+city$/i, '') + ' Event';
};

// Just the place itself ("Cebu"), for the "Upcoming Cebu Event" card pill.
// Empty when the event has no location yet, so the pill reads "Upcoming Event".
const evtPlaceWord = (evt) => (evt?.loc_city || evt?.loc_province || evt?.loc_region || '')
  .trim().replace(/\s+city$/i, '');

// One session split into the pieces the schedule strip shows:
// "Oct 2" and "10:00 AM - 6:00 PM" (or a second date when it runs overnight).
const evtSessionParts = (d, evt) => {
  const s = evtDate(d?.starts_at);
  if (!s) return null;
  let e = evtDate(d.ends_at);
  // Sessions saved before end times were required have none. Rather than showing
  // a bare "10:00 AM", fall back to the event's own finishing time of day - the
  // hours the event as a whole runs.
  if ((!e || e.getTime() <= s.getTime()) && evt?.end_date) {
    const evtEnd = evtDate(evt.end_date);
    if (evtEnd) {
      const guess = new Date(s.getFullYear(), s.getMonth(), s.getDate(), evtEnd.getHours(), evtEnd.getMinutes());
      e = guess.getTime() > s.getTime() ? guess : null;
    }
  }
  const hasEnd = e && e.getTime() > s.getTime();
  const day = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = (x) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = hasEnd && s.toDateString() === e.toDateString();
  return {
    date: hasEnd && !sameDay ? `${day(s)} – ${day(e)}` : day(s),
    time: hasEnd ? `${time(s)} – ${time(e)}` : time(s),
  };
};

// A single-session event IS the event, so its session is never listed on its
// own - the event title and the When line already say everything. Two or more
// sessions each get their title and their own date & time.
const evtSessions = (evt) => {
  const rows = Array.isArray(evt?.event_days) ? evt.event_days : [];
  if (rows.length < 2) return [];
  return rows.slice().sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
};

// Whether registration is actually open for an event, and when it is not, why.
// The details modal reads this to decide what its button says; the magic-link
// handler reads the same thing to decide between opening the form and opening
// the poster, so a shared link to a full event explains itself rather than
// dropping somebody into a form the server would only turn away.
const evtRegGate = (evt) => {
  const left = evt?.slots_left != null
    ? evt.slots_left
    : (evt?.max_participants ? Math.max(0, evt.max_participants - (evt.registered_count || 0)) : null);
  // Registration can be scheduled to open later; until that moment the button
  // is dead rather than letting someone submit and be rejected.
  const opensAt = evtDate(evt?.registration_start_date);
  const closesAt = evtDate(evt?.registration_deadline);
  // An event that is over takes no more registrations, deadline or not - Joy
  // can show past events, and their details must not offer a form.
  const ended = evtStatus(evt?.event_date, evt?.end_date) === 'ended';
  return {
    left,
    opensAt,
    ended,
    required: evt?.registration_required !== false,
    full: left != null && left <= 0,
    notOpenYet: !ended && !!opensAt && Date.now() < opensAt.getTime(),
    closed: ended || (!!closesAt && Date.now() > closesAt.getTime()),
  };
};

// The one question the magic link needs answered: can this person register
// right now?
const evtRegOpen = (evt) => {
  const gate = evtRegGate(evt);
  return gate.required && !gate.full && !gate.notOpenYet && !gate.closed;
};

// The AI is reached through our own server (src/app/api/ai/chat), never
// straight from the browser: the API key stays on the server, where it
// cannot be read out of this page's JavaScript and spent by a stranger.
// The route answers in Groq's own shape, so the 'data.choices[0].message
// .content' reads below still find the reply.
const AI_CHAT_URL = '/api/ai/chat';

// ---- Joy and past events ----------------------------------------------------
// Joy's live briefing only carries events that have not ended. Past ones are
// looked up by a date range the visitor chooses, so a question like "what were
// the last events?" gets a short, relevant list instead of everything the
// church has ever held. She asks for the dates first; the answer is a card per
// event (poster, date, venue, a line about it) built from the database rows -
// the AI never describes a past event itself, so it cannot invent one.

// "past events", "last events", "previous activities", "events that already
// ended", "what is the last evets" (typos happen). "the last day of the event"
// is not a question about past events.
const PAST_EVENT_WORD = String.raw`(?:events?|evets?|evnts?|eventz|activit(?:y|ies)|gatherings?|conferences?)`;
const PAST_EVENTS_ASK = new RegExp(
  String.raw`\b(?:past|last|previous|recent|latest|earlier|older|ended|finished|completed|done)\s+(?:\w+\s+){0,2}${PAST_EVENT_WORD}\b`
  + String.raw`|\b${PAST_EVENT_WORD}\s+(?:\w+\s+){0,3}?(?:happened|ended|finished|before|ago|already|were\s+held|took\s+place)\b`,
  'i',
);
const asksPastEvents = (text) => PAST_EVENTS_ASK.test(text) && !/\blast\s+day\b/i.test(text);

// Did the question already say WHEN? Then the AI turns the words into dates
// (it knows today's date); otherwise Joy asks before answering.
const MENTIONS_DATES = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b|\b(?:this|last|past)\s+(?:\d+\s+)?(?:weeks?|months?|years?|days?)\b|\byesterday\b/i;

const PAST_TAG_ASK = /\[\[\s*ASK_PAST_RANGE\s*\]\]/i;
const PAST_TAG_RANGE = /\[\[\s*PAST_EVENTS\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*\]\]/i;
const PAST_EVENTS_MAX = 6; // cards per answer; a narrower range shows the rest

// Dates as the <input type="date"> writes them, read as LOCAL days - the same
// way evtDate() reads an event's wall-clock time, so the two compare cleanly.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s, endOfDay = false) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return endOfDay
    ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
    : new Date(+m[1], +m[2] - 1, +m[3]);
};
const prettyDay = (s) => fromYmd(s)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) || s;

const PAST_RANGE_PRESETS = [
  { label: 'Last 30 days', from: (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - 30) },
  { label: 'Last 3 months', from: (t) => new Date(t.getFullYear(), t.getMonth() - 3, t.getDate()) },
  { label: 'Last 6 months', from: (t) => new Date(t.getFullYear(), t.getMonth() - 6, t.getDate()) },
  { label: 'This year', from: (t) => new Date(t.getFullYear(), 0, 1) },
];

// Events that touch the range at all - a conference that started before it and
// ended inside it still happened in it. Most recent first.
const eventsInRange = (events, fromStr, toStr) => {
  const from = fromYmd(fromStr)?.getTime();
  const to = fromYmd(toStr, true)?.getTime();
  if (from == null || to == null) return [];
  return events
    .filter((e) => {
      const start = evtMs(e.event_date);
      if (start == null) return false;
      const end = evtMs(e.end_date) ?? start;
      return start <= to && end >= from;
    })
    .sort((a, b) => (evtMs(b.event_date) ?? 0) - (evtMs(a.event_date) ?? 0));
};

// "Oct 2–3, 2026", "Sep 30 – Oct 2, 2026", "Oct 2, 2026"
const evtShortWhen = (startStr, endStr) => {
  const s = evtDate(startStr);
  if (!s) return 'Date to be announced';
  const e = evtDate(endStr) || s;
  const md = { month: 'short', day: 'numeric' };
  const year = s.getFullYear();
  if (s.toDateString() === e.toDateString()) return s.toLocaleDateString('en-US', { ...md, year: 'numeric' });
  if (year === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short' })} ${s.getDate()}–${e.getDate()}, ${year}`;
  }
  if (year === e.getFullYear()) return `${s.toLocaleDateString('en-US', md)} – ${e.toLocaleDateString('en-US', md)}, ${year}`;
  return `${s.toLocaleDateString('en-US', { ...md, year: 'numeric' })} – ${e.toLocaleDateString('en-US', { ...md, year: 'numeric' })}`;
};

// The dates a visitor typed, read here rather than by the AI - which, asked to
// turn "last month" into two dates, would sometimes ask again instead. Covers
// what people actually write: a month ("October", "September to October
// 2026"), "last month", "this year", "the past 3 months", "yesterday", a year,
// or the dates themselves. A month with no year is the most recent one that
// has begun. Returns { from, to } as YYYY-MM-DD, or null when there is no date.
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(\d{4}))?\b/gi;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const orderedRange = (a, b) => (a <= b ? { from: a, to: b } : { from: b, to: a });
const parseDateRange = (text, today = new Date()) => {
  const t = String(text || '').toLowerCase();
  const y = today.getFullYear();
  const mo = today.getMonth();
  const d = today.getDate();
  const todayStr = ymd(today);
  let m;

  const written = [];
  for (const x of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) written.push(ymd(new Date(+x[1], +x[2] - 1, +x[3])));
  for (const x of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) written.push(ymd(new Date(+x[3], +x[1] - 1, +x[2])));
  if (written.length) return orderedRange(written[0], written[written.length - 1]);

  if (/\b(?:last|previous)\s+month\b/.test(t)) return { from: ymd(new Date(y, mo - 1, 1)), to: ymd(new Date(y, mo, 0)) };
  if (/\bthis\s+month\b/.test(t)) return { from: ymd(new Date(y, mo, 1)), to: todayStr };
  if (/\b(?:last|previous)\s+year\b/.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (/\bthis\s+year\b/.test(t)) return { from: `${y}-01-01`, to: todayStr };
  if (/\byesterday\b/.test(t)) { const s = ymd(new Date(y, mo, d - 1)); return { from: s, to: s }; }
  if ((m = t.match(/\b(?:last|past|previous)\s+(?:(\d{1,3})\s+)?(day|week|month|year)s?\b/))) {
    const n = m[1] ? +m[1] : 1;
    const back = { day: new Date(y, mo, d - n), week: new Date(y, mo, d - 7 * n), month: new Date(y, mo - n, d), year: new Date(y - n, mo, d) }[m[2]];
    return { from: ymd(back), to: todayStr };
  }

  const months = [];
  for (const x of t.matchAll(MONTH_RE)) {
    const word = x[1].toLowerCase();
    // "may I see..." is not May.
    if (word === 'may' && !x[2] && !x[3] && !/\b(?:in|from|to|since|of|until|through|and|between)\s*$|-\s*$/.test(t.slice(0, x.index))) continue;
    months.push({ month: MONTH_KEYS.indexOf(word.slice(0, 3)), day: x[2] ? +x[2] : null, year: x[3] ? +x[3] : null });
  }
  if (months.length) {
    const first = months[0];
    const last = months[months.length - 1];
    const lastYear = last.year ?? first.year ?? (last.month <= mo ? y : y - 1);
    const firstYear = first.year ?? (first.month <= last.month ? lastYear : lastYear - 1);
    const from = first.day ? new Date(firstYear, first.month, first.day) : new Date(firstYear, first.month, 1);
    const to = last.day ? new Date(lastYear, last.month, last.day) : new Date(lastYear, last.month + 1, 0);
    return orderedRange(ymd(from), ymd(to));
  }

  if ((m = t.match(/\b(20\d{2})\b/))) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  return null;
};
const EVENT_WORD_RE = new RegExp(String.raw`\b${PAST_EVENT_WORD}\b`, 'i');

// A sentence or two of the description, cut at a word.
const evtBlurb = (text, max = 150) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
};

// ============================================
// COMPONENT
// ============================================
// The events grid is only on the page while there are events to show; with
// none, "This Week" is where the visitor is told so (and the other way round).
const sectionEl = (id) => document.getElementById(id)
  || (id === 'news' ? document.getElementById('this-week') : null)
  || (id === 'this-week' ? document.getElementById('news') : null);

export default function HomePage() {
  const router = useRouter();
  // Who is signed in on this browser (a Guest stays on this page; see below).
  const { viewer } = useViewer();
  const pathname = usePathname();
  // Whose name the page wears - the church's, or SanctuaryHub's. Chosen by a
  // Super Admin under System Configuration; see lib/branding.js.
  const brand = useBranding();
  // Our Pastors: the Pastor accounts marked for the website (/api/pastors),
  // this page's own list until that is set up.
  const pastors = usePastors(PASTORS);
  const [heroIndex, setHeroIndex] = useState(0);
  // Which hero slides have an <img> in the DOM. All five used to, and because
  // they are stacked absolutely they are all "in the viewport" - so the browser
  // fetched 570 KB of carousel at full priority before the events section had
  // asked for anything, and `loading="lazy"` would not have stopped it. Only the
  // slide on screen starts out mounted; see the effect that mounts the rest.
  const [heroMounted, setHeroMounted] = useState(() => new Set([0]));
  // Carousel or video, set by an Admin under System Configuration. It starts on
  // the carousel - what the site has always shown - and only becomes a video
  // once the setting has been fetched and says so. That order matters: the
  // first paint is the carousel's own photo either way, which doubles as the
  // video's poster, so the hero is never empty while this is in flight.
  const [heroMedia, setHeroMedia] = useState(HERO_MEDIA_DEFAULT);
  const [heroIsMobile, setHeroIsMobile] = useState(false);
  const [dailyVerse, setDailyVerse] = useState({ verse: '', reference: '' });
  const heroTimer = useRef(null);
  const [isomIndex, setIsomIndex] = useState(0);
  const [isomData, setIsomData] = useState({
    subtitle: 'Be equipped, empowered, and sent — a Spirit-filled ministry training program raising up the next generation of kingdom leaders.',
    bullets: [
      'Solid biblical foundation & sound doctrine',
      'Spirit-empowered prayer & worship',
      'Hands-on leadership & ministry training',
      'A heart to reach the nations for Christ',
    ],
    class_start_date: 'August 2026',
    slides: ISOM_SLIDES.map((url) => ({ url })),
  });
  const [newsEvents, setNewsEvents] = useState([]);
  // The same published events as `newsEvents`, but the whole list rather than
  // the eight the News section shows. Joy answers out of this, so a visitor
  // asking about the ninth event still gets a real answer.
  const [liveEvents, setLiveEvents] = useState([]);
  // Church News on the landing page: the stories an Admin featured first
  // (Dashboard > News > Feature), then the newest - four at most. Nothing is
  // shown until there is at least one.
  const [latestNews, setLatestNews] = useState([]);
  useEffect(() => {
    fetch('/api/news?limit=4&featured=1')
      .then((r) => r.json())
      .then((j) => { if (j.success && Array.isArray(j.data)) setLatestNews(j.data); })
      .catch(() => {});
  }, []);
  const [eventsVersion, setEventsVersion] = useState(0); // bumped after a registration so the slot counts refresh
  const [detailEvent, setDetailEvent] = useState(null);

  // ---- Landing page: This Week, the activity filter, the map ----
  // `nowMs` is null on the server and set on mount: the countdown is the
  // visitor's clock, and rendering it during SSR would hand React a time that
  // no longer matches by the time the page hydrates.
  const [nowMs, setNowMs] = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [activityFilter, setActivityFilter] = useState('all');
  const [mapView, setMapView] = useState('map');
  const [heroAsk, setHeroAsk] = useState('');


  // ---- ISOM Inquire modal ----
  const ISOM_CHURCH_ROLES = [
    'Pastor', 'Associate Pastor', 'Elder', 'Deacon', 'Ministry Leader',
    'Worship/Song Leader', 'Usher', 'Volunteer', 'Member', 'Other',
  ];
  const EMPTY_ISOM_INQUIRE_FORM = { fullName: '', email: '', mobile: '', churchName: '', churchRole: '', message: '' };
  const [showIsomInquire, setShowIsomInquire] = useState(false);
  const [isomInquireForm, setIsomInquireForm] = useState(EMPTY_ISOM_INQUIRE_FORM);
  const [isomInquireSubmitting, setIsomInquireSubmitting] = useState(false);
  const [isomInquireResult, setIsomInquireResult] = useState(null); // { ok: boolean, message: string }

  const openIsomInquire = () => {
    setIsomInquireForm(EMPTY_ISOM_INQUIRE_FORM);
    setIsomInquireResult(null);
    setShowIsomInquire(true);
  };

  const submitIsomInquiry = async () => {
    if (!isomInquireForm.fullName.trim()) {
      setIsomInquireResult({ ok: false, message: 'Please enter your full name.' });
      return;
    }
    if (!isomInquireForm.email.trim() && !isomInquireForm.mobile.trim()) {
      setIsomInquireResult({ ok: false, message: 'Please provide an email or mobile number so we can reach you.' });
      return;
    }
    setIsomInquireSubmitting(true);
    setIsomInquireResult(null);
    try {
      const res = await fetch('/api/isom/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isomInquireForm),
      });
      const data = await res.json();
      if (data.success) {
        setIsomInquireResult({ ok: true, message: data.message || "Thanks for reaching out! Our ISOM team will contact you soon." });
        setIsomInquireForm(EMPTY_ISOM_INQUIRE_FORM);
      } else {
        setIsomInquireResult({ ok: false, message: data.message || 'Something went wrong. Please try again.' });
      }
    } catch {
      setIsomInquireResult({ ok: false, message: 'Network error. Please try again.' });
    } finally {
      setIsomInquireSubmitting(false);
    }
  };

  // ---- Public registration -------------------------------------------
  // Registering used to jump straight to the signup page. Now the visitor
  // chooses: make an account first (so they can track and pay later), or just
  // register for this one event as a guest.
  const [regChoiceEvent, setRegChoiceEvent] = useState(null);   // the "how do you want to register?" step
  const [regChoiceScreen, setRegChoiceScreen] = useState('how'); // 'how' -> account vs no account, 'who' -> one person vs a group
  const [guestRegEvent, setGuestRegEvent] = useState(null);     // the guest form itself
  const [guestRegForm, setGuestRegForm] = useState(EMPTY_GUEST_REG_FORM);
  const [guestRegAddonIds, setGuestRegAddonIds] = useState([]);
  const [guestRegProof, setGuestRegProof] = useState(null);      // already converted to .webp
  const [guestRegProofPreview, setGuestRegProofPreview] = useState('');
  const [guestProofError, setGuestProofError] = useState('');   // a file too big to upload, said before submit
  const [guestRegStep, setGuestRegStep] = useState(0);           // 0 = who's coming, 1 = payment
  // The channel the payer chose, and whether the picker list is open. Only the
  // chosen account's details are shown - the QRs and numbers are long, and only
  // one of them is being paid into.
  const [guestPayChannel, setGuestPayChannel] = useState(null);
  const [guestPayPickerOpen, setGuestPayPickerOpen] = useState(false);
  const [copiedField, setCopiedField] = useState('');            // which account number was just copied
  const [addonDetail, setAddonDetail] = useState(null);          // add-on shown in the "why is this here?" popup
  const [fraudTip, setFraudTip] = useState(false);               // the scam warning, shown a moment into the payment step
  const [guestRegSubmitting, setGuestRegSubmitting] = useState(false);
  const [guestRegResult, setGuestRegResult] = useState(null);   // { ok, message }
  const [guestFieldErrors, setGuestFieldErrors] = useState({}); // which inputs to paint red, by field name
  const [guestRegMode, setGuestRegMode] = useState('individual'); // 'individual' = just me, 'bulk' = a group on one payment
  const [bulkAttendees, setBulkAttendees] = useState([]);         // [{ firstName, lastName, addonIds }]
  const [repAgreed, setRepAgreed] = useState(false);              // the representative vouched for their own details
  const [dupNames, setDupNames] = useState([]);                   // names already registered for this event (lower-cased)
  const [dupDetails, setDupDetails] = useState([]);               // what those existing registrations already know
  const [repAddonIds, setRepAddonIds] = useState([]);             // the representative's own extras
  const [repUsedSaved, setRepUsedSaved] = useState(false);        // they accepted "use my saved details"
  const [attendeeDraft, setAttendeeDraft] = useState(null);       // the person being typed in above the table
  const [editingAttendee, setEditingAttendee] = useState(null);   // index being edited, or null while adding
  const [draftError, setDraftError] = useState('');
  const [checkingAttendee, setCheckingAttendee] = useState(false);  // asking the server whether this name is already registered
  // The parent or guardian a child is being registered under, when the age
  // group picked is a children's one.
  const [guestGuardian, setGuestGuardian] = useState(null);

  // ---- Losing a half-filled registration ----
  //
  // The form sits in a dialog that closes on a tap anywhere outside it, and
  // the people filling it in are mostly on phones, where "anywhere outside it"
  // is most of the screen. Losing a name, a church, a pastor, a contact number
  // and a payment screenshot to a mis-tap is the single most expensive
  // accident on this page, so a close is only allowed straight through when
  // there is genuinely nothing to lose.
  //
  // `pristineReg` is what the form looked like the moment it opened - kept as
  // a snapshot rather than compared field by field, so a field added to the
  // form later is covered without anybody remembering to come back here.
  const pristineReg = useRef(null);
  // null when nothing is being asked, otherwise what the visitor was trying to
  // do - so "Discard" carries out the thing they actually asked for rather
  // than always just closing.
  const [discardPrompt, setDiscardPrompt] = useState(null); // null | 'close' | 'change-type'

  // While ANY dialog is open the page behind it must not scroll - the dialog is
  // the only thing on screen, and a scrolling backdrop makes the wheel feel
  // like it is fighting it. The scrollbar's width is paid back as padding so
  // the layout does not jump when it disappears.
  //
  // This used to watch `detailEvent` alone, so the event details locked the
  // page and every other dialog - Individual/Bulk, the registration form
  // itself, an extra's details, the ISOM enquiry - did not. `anyModalOpen` is
  // one boolean on purpose: closing the add-on popup while the registration
  // form is still up must not release the lock, and a single flag cannot get
  // that wrong the way a stack of separate effects could.
  const anyModalOpen = !!(detailEvent || regChoiceEvent || guestRegEvent || addonDetail || showIsomInquire);
  useEffect(() => {
    if (!anyModalOpen) return undefined;
    const { body, documentElement: html } = document;
    // globals.css sets `overflow-x: hidden` on html AND body, which makes BOTH of
    // them scroll containers - locking only body still leaves html scrollable, so
    // both are pinned here.
    const prev = {
      body: body.style.overflow,
      html: html.style.overflow,
      pad: body.style.paddingRight,
    };
    const gap = window.innerWidth - html.clientWidth;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = prev.body;
      html.style.overflow = prev.html;
      body.style.paddingRight = prev.pad;
    };
  }, [anyModalOpen]);

  // ---- The event description: a few lines, then "See more" ----
  // Some of these run to several paragraphs. On a phone that pushed the date,
  // the venue, the price and the Register button below two screens of scrolling,
  // so what somebody came to find was the last thing they could reach.
  const [descOpen, setDescOpen] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);
  const descRef = useRef(null);

  // An event limited to specific roles can only be joined from an account - the
  // server rejects a guest registration for one - so those still have to be
  // asked to sign up first.
  const regNeedsAccount = (evt) => Array.isArray(evt?.allowed_roles) && evt.allowed_roles.length > 0;

  const handlePublicRegister = (evt) => {
    setDetailEvent(null);
    // The "create an account, or register without one?" step is switched off
    // for now: Register goes straight to Individual / Bulk. The screen itself
    // is left in place (and is still used for role-restricted events), so
    // turning it back on is a matter of starting at 'how' again.
    setRegChoiceScreen(regNeedsAccount(evt) ? 'how' : 'who');
    setRegChoiceEvent(evt);
  };

  const closeRegChoice = () => { setRegChoiceEvent(null); setRegChoiceScreen('how'); };

  // "Create an account first" - remember the event so signup can pick it up.
  const goToSignupForEvent = (evt) => {
    try {
      if (typeof window !== 'undefined' && evt?.id) {
        localStorage.setItem('pendingEventRegistration', JSON.stringify({ id: evt.id, title: evt.title }));
      }
    } catch { /* ignore */ }
    router.push('/signup?next=events');
  };

  // A blank person in a bulk roster, with the compulsory extras already ticked.
  const emptyAttendee = (evt) => ({
    firstName: '', lastName: '',
    addonIds: (evt?.event_addons || []).filter((a) => a.is_required).map((a) => a.id),
    // Everyone starts in the first group - the adults on a poster written the
    // usual way - and changes it if they are not one.
    priceTier: defaultTier(evt)?.label || '',
  });

  const openGuestRegistration = (evt, mode = 'individual') => {
    setRegChoiceEvent(null);
    setRegChoiceScreen('how');
    setGuestRegMode(mode);
    setGuestRegEvent(evt);
    const methods = evt.payment_methods || [];
    const startingForm = {
      ...EMPTY_GUEST_REG_FORM,
      priceTier: defaultTier(evt)?.label || '',
      paymentMethod: methods.length === 1 ? methods[0] : '',
    };
    const startingAddons = (evt.event_addons || []).filter((a) => a.is_required).map((a) => a.id);
    setGuestRegForm(startingForm);
    // The snapshot the "have you typed anything?" check measures against. Taken
    // from the values being set rather than read back off state, which has not
    // been applied yet at this point in the handler.
    pristineReg.current = {
      form: JSON.stringify(startingForm),
      addons: JSON.stringify([...startingAddons].sort()),
    };
    setGuestGuardian(null);
    setGuestFieldErrors({});
    // The roster starts empty and is built one person at a time, above the table.
    setBulkAttendees([]);
    setAttendeeDraft(mode === 'bulk' ? emptyAttendee(evt) : null);
    setEditingAttendee(null);
    setDraftError('');
    setRepAgreed(false);
    setRepAddonIds((evt.event_addons || []).filter((a) => a.is_required).map((a) => a.id));
    setRepUsedSaved(false);
    setDupNames([]);
    setDupDetails([]);
    // Required add-ons are charged either way, so they start ticked and locked.
    setGuestRegAddonIds((evt.event_addons || []).filter((a) => a.is_required).map((a) => a.id));
    setGuestRegProof(null);
    setGuestRegProofPreview('');
    setGuestRegStep(0);
    setGuestPayChannel(null);
    setGuestPayPickerOpen(false);
    setGuestRegResult(null);
  };

  // Shrink + convert the receipt before it is attached, so the upload is small.
  // `shrinkProofImage` hands back anything it cannot decode untouched, which is
  // what lets a PDF or a .heic through as itself.
  const handleGuestProofPick = async (file) => {
    setGuestProofError('');
    if (!file) { setGuestRegProof(null); setGuestRegProofPreview(''); return; }
    // Shrink FIRST, then measure. A phone photo of a receipt is routinely 5MB
    // and a couple of hundred KB once re-encoded - measuring the original would
    // turn away the very files this form exists to collect.
    const converted = await shrinkProofImage(file);
    if (converted.size > PROOF_MAX_BYTES) {
      // Said now rather than at submit, where it would arrive after the whole
      // payment step had been filled in.
      setGuestProofError(`That file is ${(converted.size / 1024 / 1024).toFixed(1)}MB. Please attach one under ${PROOF_MAX_LABEL}.`);
      setGuestRegProof(null); setGuestRegProofPreview('');
      return;
    }
    setGuestRegProof(converted);
    setGuestRegProofPreview(URL.createObjectURL(converted));
  };

  // Only a picture can be shown back as a thumbnail; a PDF or a document is
  // named instead, so "is my receipt attached?" is still answerable.
  const guestProofIsImage = !!guestRegProof && String(guestRegProof.type || '').startsWith('image/');

  // "Gomez_GCash_POP_09-01-2026.webp" - so a folder of receipts can be scanned
  // by eye without opening every one.
  //
  // The extension follows the file that was actually attached. It used to be
  // hard-coded to .webp, which was true only of the photos the browser had
  // re-encoded: a bank's PDF went up named ".webp", and from then on nothing -
  // not Cloudinary, not the admin's viewer - could tell it was a PDF.
  const proofFileName = () => {
    const last = (guestRegForm.lastName || 'Attendee').trim().replace(/[^a-z0-9]+/gi, '') || 'Attendee';
    const method = (guestRegForm.paymentMethod || 'Payment').replace(/[^a-z0-9]+/gi, '') || 'Payment';
    const d = new Date();
    const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
    const ext = (String(guestRegProof?.name || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'webp').toLowerCase();
    return `${last}_${method}_POP_${stamp}.${ext}`;
  };

  // Copying beats re-typing an 11-digit number off a screen - one wrong digit
  // sends the money to a stranger.
  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1800);
    } catch { /* clipboard blocked - the number is still on screen to read */ }
  };

  // The event's own link, to paste into a group chat. Phones get their native
  // share sheet; everything else falls back to copying it.
  const shareEventLink = async (evt) => {
    const slug = eventSlug(evt);
    if (!slug || typeof window === 'undefined') return;
    const url = `${window.location.origin}/${slug}`;
    if (navigator.share) {
      try {
        // The same wording the link's own preview card carries ("Cebu -
        // Miracle Working God"), so a share sheet and the card that lands in
        // the chat say the same thing. The URL is passed on its own - apps
        // that build a preview want a bare link to scrape, and a link buried
        // in `text` is often not unfurled at all.
        await navigator.share({ title: eventCardTitle(evt), text: eventCardTitle(evt), url });
        return;
      } catch (err) {
        // Dismissing the share sheet is a decision, not a failure - only a
        // browser that could not open it at all falls through to the clipboard.
        if (err?.name === 'AbortError') return;
      }
    }
    copyToClipboard(url, 'event-link');
  };

  // A calendar entry for the event, generated in the browser. Opening the file
  // on a phone hands it straight to the calendar app.
  const addEventToCalendar = (evt) => {
    if (!evt?.event_date) return;
    // DTSTAMP is a real instant, so it keeps the trailing Z. The event's own
    // times are wall-clock (see evtDate), so they are written as ICS "floating"
    // local times - no Z - which is what puts 10:00 AM in the phone calendar at
    // 10:00 AM instead of shifting it by the UTC offset.
    const utcStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (v) => {
      const d = evtDate(v);
      if (!d) return utcStamp(Date.now());
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    };
    const end = evt.end_date || evt.event_date;
    const where = [evt.location, evt.loc_barangay, evt.loc_city, evt.loc_province].filter(Boolean).join(', ');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JSCI//Events//EN', 'BEGIN:VEVENT',
      `UID:${evt.id}@jsci`,
      `DTSTAMP:${utcStamp(Date.now())}`,
      `DTSTART:${stamp(evt.event_date)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${(evt.title || 'Event').replace(/[\n,;]/g, ' ')}`,
      where ? `LOCATION:${where.replace(/[\n,;]/g, ' ')}` : '',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(evt.title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Save the QR to the phone so it can be opened inside the payment app.
  const downloadQr = async (url, title, label = 'qr') => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      // The stored QR is a .webp; name the file after the channel so a payer with
      // several saved QRs can tell them apart.
      const ext = (blob.type && blob.type.split('/')[1]) || 'webp';
      const slug = (v) => String(v || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      a.download = [slug(title) || 'event', slug(label) || 'qr'].filter(Boolean).join('-') + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch {
      // cross-origin fetch blocked: open it so the user can long-press / save
      window.open(url, '_blank', 'noopener');
    }
  };

  // The church's saved payment channels (Mode of Payment). Events reference them
  // by id, so the account number, name and QR always match what the office set
  // and never have to be retyped into the event.
  const [payChannels, setPayChannels] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/payment-methods');
        const data = await res.json();
        if (!cancelled && data?.success) setPayChannels(data.data || []);
      } catch { /* the legacy per-event fields still render */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // The channels this event accepts, in the order the office arranged them.
  const eventChannels = (evt) => {
    const ids = evt?.payment_method_ids || [];
    if (!ids.length) return [];
    return ids.map((id) => payChannels.find((c) => c.id === id)).filter(Boolean);
  };

  // Initials fallback when a channel has no logo image ("BDO", "GCash" -> "GC").
  const channelInitials = (name) => {
    const t = (name || '').trim();
    if (!t) return '\u20B1';
    if (t.length <= 3 && !t.includes(' ')) return t.toUpperCase();
    const words = t.split(/\s+/).filter((w) => !['of', 'the', 'and'].includes(w.toLowerCase()));
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  };

  // Church name suggestions, so the same church is always spelled the same way.
  // Each suggestion carries how many people already registered under it, which
  // is the quickest signal that you are picking the right one.
  const [churchOptions, setChurchOptions] = useState([]);
  const [churchOpen, setChurchOpen] = useState(false);

  useEffect(() => {
    if (!guestRegEvent || !churchOpen) return undefined;
    const q = guestRegForm.churchName.trim();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?churches=1&eventId=${guestRegEvent.id}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setChurchOptions(data.success ? data.data || [] : []);
      } catch { setChurchOptions([]); }
    }, 220);
    return () => clearTimeout(timer);
  }, [guestRegForm.churchName, churchOpen, guestRegEvent]);

  // "Others" is always on the list. Without it, somebody with no church to name
  // types N/A, n/a, none or wala, and the church list grows five entries that
  // all mean the same thing. Picking it writes one word that every screen and
  // every count already understands.
  const churchChoices = (() => {
    const real = churchOptions.filter((c) => !isPlaceholderChurch(c.name));
    const othersCount = churchOptions
      .filter((c) => isPlaceholderChurch(c.name))
      .reduce((sum, c) => sum + (Number(c.count) || 0), 0);
    const typed = guestRegForm.churchName.trim().toLowerCase();
    // Offered while the box is empty, while it reads like a placeholder ("n/a"),
    // or while what they are typing is part of the word itself.
    const wantsOthers = !typed || isPlaceholderChurch(typed) || OTHER_CHURCH.toLowerCase().includes(typed);
    return wantsOthers ? [...real, { name: OTHER_CHURCH, count: othersCount, isOther: true }] : real;
  })();

  // Whatever spelling of "no church" was typed becomes the one word as soon as
  // the field is left, so what they see is what will be saved.
  const settleChurchName = () => {
    setGuestRegForm((f) => (isPlaceholderChurch(f.churchName) ? { ...f, churchName: OTHER_CHURCH } : f));
  };

  // Whether there is anything hidden to see more OF. Measured rather than
  // guessed from the length: four lines is a different number of characters on
  // a phone and on a desk, and a button that opens nothing is worse than no
  // button. Re-measured when the window is resized for the same reason.
  useEffect(() => {
    setDescOpen(false);
    if (!detailEvent?.description) { setDescOverflows(false); return undefined; }
    const measure = () => {
      const el = descRef.current;
      if (el) setDescOverflows(el.scrollHeight > el.clientHeight + 2);
    };
    const frame = requestAnimationFrame(measure);
    // Again once the dialog has finished arriving: measured mid-animation the
    // paragraph can still be zero-height, and the button would never appear.
    const settled = setTimeout(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
      window.removeEventListener('resize', measure);
    };
  }, [detailEvent]);

  // A Philippine mobile number: 11 digits starting 09. Anything typed that
  // isn't a digit is dropped as it is entered, so the field can't drift.
  const onlyDigits = (v) => (v || '').replace(/\D/g, '').slice(0, 11);
  const isValidPhMobile = (v) => /^09\d{9}$/.test(v || '');

  // The warning matters most while someone is actually looking at an account
  // number, so it arrives a few seconds into the payment step rather than
  // taking up half the screen before they get there.
  useEffect(() => {
    if (!guestRegEvent || guestRegStep !== 2) { setFraudTip(false); return undefined; }
    const timer = setTimeout(() => setFraudTip(true), 5000);
    return () => clearTimeout(timer);
  }, [guestRegEvent, guestRegStep]);

  // Which account block to show: the one they picked, or all of them while no
  // choice has been made yet.
  const guestShowsMethod = (method) => !guestRegForm.paymentMethod || guestRegForm.paymentMethod === method;

  // Which account card carries the reference / proof rows, so they read as the
  // last two lines of the same box rather than a second one. 'none' means the
  // chosen method has no account details of its own (e.g. Cash).
  const payFieldsCard = () => {
    const e = guestRegEvent;
    if (!e) return 'none';
    // A saved channel is shown, so the reference / receipt rows belong to the
    // last of those cards rather than to a separate box.
    // Only the picked channel is on screen, so the rows belong to it.
    const picked = eventChannels(e).find((c) => c.id === guestPayChannel);
    if (picked) return `channel:${picked.id}`;
    if (eventChannels(e).length > 0) return 'none';
    if ((e.gcash_number || e.gcash_qr_url) && guestShowsMethod('GCash')) return 'gcash';
    if (e.bank_account_number && guestShowsMethod('Bank Transfer')) return 'bank';
    return 'none';
  };

  // The two things we need back from the payer.
  const payFieldRows = () => (
    <>
      <div className="hp-pay-line">
        <span className="hp-pay-line-label">Reference Number *</span>
        <input
          type="text"
          className={`hp-pay-inline-input ${guestFieldErrors.paymentReference ? 'invalid' : ''}`}
          value={guestRegForm.paymentReference}
          onChange={(e) => { setGuestRegForm({ ...guestRegForm, paymentReference: e.target.value }); clearGuestFieldError('paymentReference'); }}
          placeholder="From your payment receipt"
        />
      </div>
      {guestFieldErrors.paymentReference && (
        <p className="hp-pay-line-error"><i className="fas fa-circle-exclamation"></i> {guestFieldErrors.paymentReference}</p>
      )}
      {/* The receipt is the one thing people miss, so it is a drop zone with the
          screenshot shown back to them rather than a word next to a label. */}
      <div className="hp-proof-block">
        <span className="hp-proof-label">Proof of Payment *</span>
        {guestRegProof ? (
          <div className="hp-proof-done">
            <button type="button" className="hp-proof-thumb" onClick={() => window.open(guestRegProofPreview, '_blank', 'noopener')} title="Open your receipt">
              {guestProofIsImage
                ? <img src={guestRegProofPreview} alt="Your payment receipt" />
                : <span className="hp-proof-thumb-file"><i className="fas fa-file-lines"></i></span>}
            </button>
            <div className="hp-proof-info">
              <strong><i className="fas fa-circle-check"></i> Receipt attached</strong>
              <span className="hp-proof-file">{proofFileName()} &middot; {(guestRegProof.size / 1024).toFixed(0)} KB</span>
              <div className="hp-proof-actions">
                <label htmlFor="hp-reg-proof"><i className="fas fa-rotate"></i> Change</label>
                <button type="button" onClick={() => handleGuestProofPick(null)}><i className="fas fa-trash"></i> Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <label className={`hp-proof-drop ${guestFieldErrors.proof || guestProofError ? 'invalid' : ''}`} htmlFor="hp-reg-proof">
            <span className="hp-proof-drop-icon"><i className="fas fa-cloud-arrow-up"></i></span>
            <span className="hp-proof-drop-text">
              <strong>Upload a screenshot or file of your receipt</strong>
              <small>Photo, screenshot or PDF from your bank or payment app &middot; tap to choose</small>
            </span>
          </label>
        )}
        <input id="hp-reg-proof" type="file" accept={PROOF_ACCEPT} hidden onChange={(e) => handleGuestProofPick(e.target.files?.[0] || null)} />
      </div>
      {guestProofError && (
        <p className="hp-pay-line-error"><i className="fas fa-circle-exclamation"></i> {guestProofError}</p>
      )}
      {guestFieldErrors.proof && !guestProofError && (
        <p className="hp-pay-line-error"><i className="fas fa-circle-exclamation"></i> {guestFieldErrors.proof}</p>
      )}
    </>
  );

  const isBulk = guestRegMode === 'bulk';

  // A group has one extra step at the front: who is holding the registration.
  const guestStepLabels = isBulk
    ? ['Representative', 'Attendees', 'Review', 'Payment']
    : ['Your Details', 'Review', 'Payment'];
  const rosterStep = isBulk ? 1 : -1;
  const reviewStep = isBulk ? 2 : 1;
  const payStep = isBulk ? 3 : 2;

  // Names already registered for this event. Checked against the server (which
  // only ever answers with the names we asked about, never the whole list) so a
  // representative is told before paying that someone is signed up twice.
  const nameKey = (first, last) => `${(first || '').trim()} ${(last || '').trim()}`.trim().toLowerCase().replace(/\s+/g, ' ');
  const isDuplicateName = (first, last) => {
    const key = nameKey(first, last);
    return !!key && dupNames.includes(key);
  };

  useEffect(() => {
    if (!guestRegEvent) { setDupNames([]); return undefined; }
    const names = [];
    if (isBulk) {
      bulkAttendees.forEach((a) => names.push(nameKey(a.firstName, a.lastName)));
      if (attendeeDraft) names.push(nameKey(attendeeDraft.firstName, attendeeDraft.lastName));
    }
    names.push(nameKey(guestRegForm.firstName, guestRegForm.lastName));
    const wanted = [...new Set(names.filter((n) => n.includes(' ')))]; // a first name alone is not worth asking about
    if (wanted.length === 0) { setDupNames([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?eventId=${guestRegEvent.id}&duplicates=${encodeURIComponent(wanted.join('|'))}`);
        const data = await res.json();
        setDupNames(data.success ? (data.data || []).map((n) => String(n).toLowerCase()) : []);
        setDupDetails(data.success ? (data.details || []) : []);
      } catch { /* a failed check must never block the form - the server checks again on submit */ }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestRegEvent, isBulk, bulkAttendees, attendeeDraft, guestRegForm.firstName, guestRegForm.lastName]);

  // How an existing registration reads on a chip next to the name.
  const REG_STATUS_CHIP = {
    payment_verified: { label: 'PAID', cls: 'paid' },
    registered: { label: 'REGISTERED', cls: 'paid' },
    payment_submitted: { label: 'FOR VERIFICATION', cls: 'pending' },
    pending_payment: { label: 'UNPAID', cls: 'unpaid' },
    // Booked, owing cash at the desk - not the same as simply unpaid.
    pending_cash: { label: 'PAY AT DESK', cls: 'cash' },
    // Being paid down over several visits - not something waiting on an admin.
    installment: { label: 'INSTALLMENT', cls: 'pending' },
  };
  const statusChip = (status) => REG_STATUS_CHIP[status] || { label: String(status || '').replace(/_/g, ' ').toUpperCase(), cls: 'pending' };

  // What we already hold about this person, if they registered for this event
  // before. Drives both the "use my details" offer and the locked extras.
  const dupInfoFor = (first, last) => {
    const key = nameKey(first, last);
    return key ? dupDetails.find((d) => String(d.name).toLowerCase() === key) || null : null;
  };
  const repMatch = isBulk ? dupInfoFor(guestRegForm.firstName, guestRegForm.lastName) : null;

  // Already registered means their extras are settled - shown as they stand and
  // not editable here, and they are not added to the roster a second time.
  const repLocked = !!repMatch;
  // The add-ons on a registration are a snapshot taken when it was made, so an
  // id can be stale (renamed, re-created). Fall back to matching the question
  // text, or the padlock never appears against what they already availed.
  const repLockedAddonIds = (() => {
    const held = repMatch?.addons || [];
    if (held.length === 0) return [];
    return (guestRegEvent?.event_addons || [])
      .filter((x) => held.some((h) => sameAddon(h, x)))
      .map((x) => x.id);
  })();

  // Only a verified registration can be reused - an unverified one may still be
  // rejected, and its details would then be the wrong ones to copy.
  const repVerified = !!repMatch && (repMatch.status === 'payment_verified' || repMatch.status === 'registered');
  // Extras the representative is adding now. For someone already registered these
  // are the ones they had NOT availed before, charged on top of what they hold.
  const repNewAddonIds = repAddonIds.filter((id) => !repLockedAddonIds.includes(id));
  const repTopUpAddons = () => (guestRegEvent?.event_addons || []).filter((x) => repNewAddonIds.includes(x.id));
  const repTopUpTotal = () => repTopUpAddons()
    .reduce((sum, x) => sum + addonFeeFor(x, findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent)), 0);

  // Copy across what the earlier registration already recorded, so a returning
  // representative does not retype their church, pastor and number.
  const useSavedRepDetails = () => {
    if (!repMatch || !repVerified) return;
    setGuestRegForm((f) => ({
      ...f,
      churchName: repMatch.churchName || f.churchName,
      churchPastor: (repMatch.churchPastor || f.churchPastor).replace(/^ptr\.?\s*/i, ''),
      mobile: repMatch.mobile || f.mobile,
    }));
    setGuestFieldErrors({});
    setRepUsedSaved(true);
  };

  // An unverified registration cannot be built on, so the name that matched it
  // has to go - and with it everything typed under that name.
  const clearRepDetails = () => {
    const methods = guestRegEvent?.payment_methods || [];
    setGuestRegForm({
      ...EMPTY_GUEST_REG_FORM,
      priceTier: defaultTier(guestRegEvent)?.label || '',
      paymentMethod: methods.length === 1 ? methods[0] : '',
    });
    setRepAddonIds((guestRegEvent?.event_addons || []).filter((a) => a.is_required).map((a) => a.id));
    setRepAgreed(false);
    setRepUsedSaved(false);
    setGuestFieldErrors({});
    setGuestRegResult(null);
    setChurchOpen(false);
  };

  const toggleRepAddon = (addon) => {
    // Required extras, and anything already availed, are not up for debate.
    if (addon.is_required || repLockedAddonIds.includes(addon.id)) return;
    setRepAddonIds((ids) => (ids.includes(addon.id) ? ids.filter((v) => v !== addon.id) : [...ids, addon.id]));
  };

  // The representative as a roster entry, when they are attending and are not
  // already registered from an earlier submission.
  // The representative is one of the people being registered - unless they
  // already have a slot for this event, in which case they only top up extras.
  const repAsAttendee = () => ((isBulk && !repLocked && guestRegForm.firstName.trim() && guestRegForm.lastName.trim())
    ? {
        firstName: guestRegForm.firstName.trim(),
        lastName: guestRegForm.lastName.trim(),
        addonIds: repAddonIds,
        priceTier: guestRegForm.priceTier,
        isRep: true,
      }
    : null);

  // Everyone being registered by this submission: the representative first when
  // they are coming, then the people they added.
  const fullRoster = () => {
    const rep = repAsAttendee();
    return rep ? [rep, ...bulkAttendees] : bulkAttendees;
  };

  // ---- Bulk roster: fill in the person above, then they drop into the table ----
  const draft = attendeeDraft || emptyAttendee(guestRegEvent);
  const setDraft = (patch) => { setAttendeeDraft({ ...draft, ...patch }); setDraftError(''); };
  const toggleDraftAddon = (addon) => {
    if (addon.is_required) return;
    const has = draft.addonIds.includes(addon.id);
    setDraft({ addonIds: has ? draft.addonIds.filter((v) => v !== addon.id) : [...draft.addonIds, addon.id] });
  };

  // Add, or save the row that is being edited. The same button does both, so
  // there is only ever one place a name is typed.
  const commitAttendee = async () => {
    if (checkingAttendee) return;
    const first = draft.firstName.trim();
    const last = draft.lastName.trim();
    if (!first || !last) { setDraftError('Enter both the first and last name.'); return; }
    const key = nameKey(first, last);
    if (isBulk && key === nameKey(guestRegForm.firstName, guestRegForm.lastName)) {
      setDraftError(repLocked
        ? 'That is you - you already have a slot for this event.'
        : 'That is you - you are already on the list as the representative.');
      return;
    }
    const clash = bulkAttendees.findIndex((a, i) => i !== editingAttendee && nameKey(a.firstName, a.lastName) === key);
    if (clash > -1) { setDraftError('That person is already on the list below.'); return; }
    if (dupNames.includes(key)) {
      setDraftError('already-registered');
      return;
    }

    // The background check runs on a delay, so a name typed and added quickly
    // can be added before the answer about it comes back. Asked again here, on
    // the tap itself, because this is the moment the person joins the list -
    // after this they are on a payment, and taking them off is somebody's work.
    if (guestRegEvent) {
      setCheckingAttendee(true);
      try {
        const res = await fetch(`/api/events/registrations?eventId=${guestRegEvent.id}&duplicates=${encodeURIComponent(key)}`);
        const data = await res.json();
        const found = data.success ? (data.data || []).map((n) => String(n).toLowerCase()) : [];
        if (found.includes(key)) {
          setDupNames((list) => [...new Set([...list, ...found])]);
          // Keep what came back about them - it is what puts PAID / UNPAID on
          // the warning instead of a bare "already registered".
          setDupDetails((list) => {
            const fresh = data.details || [];
            const names = new Set(fresh.map((d) => String(d.name).toLowerCase()));
            return [...list.filter((d) => !names.has(String(d.name).toLowerCase())), ...fresh];
          });
          setDraftError('already-registered');
          return;
        }
      } catch {
        /* the check is a convenience - the server refuses a duplicate on submit */
      } finally {
        setCheckingAttendee(false);
      }
    }

    const person = { firstName: first, lastName: last, addonIds: draft.addonIds, priceTier: draft.priceTier };
    setBulkAttendees((list) => (editingAttendee == null
      ? [...list, person]
      : list.map((a, i) => (i === editingAttendee ? person : a))));
    setAttendeeDraft(emptyAttendee(guestRegEvent));
    setEditingAttendee(null);
    setDraftError('');
    clearGuestFieldError('roster');
  };

  // Editing lifts the row back into the form above, so it is edited where it
  // was typed rather than turning the table into a grid of inputs.
  const editAttendee = (index) => {
    setAttendeeDraft({ ...bulkAttendees[index] });
    setEditingAttendee(index);
    setDraftError('');
  };
  const cancelEditAttendee = () => {
    setAttendeeDraft(emptyAttendee(guestRegEvent));
    setEditingAttendee(null);
    setDraftError('');
  };
  const removeAttendee = (index) => {
    setBulkAttendees((list) => list.filter((_, i) => i !== index));
    if (editingAttendee === index) cancelEditAttendee();
    else if (editingAttendee != null && index < editingAttendee) setEditingAttendee(editingAttendee - 1);
  };
  // What a person's extras cost, and what they are called - the table shows both.
  const attendeeAddons = (a) => (guestRegEvent?.event_addons || []).filter((x) => a.addonIds.includes(x.id));
  // Priced for THEIR age group - a child's accommodation can cost less than an
  // adult's on the same event.
  const attendeeExtrasTotal = (a) => attendeeAddons(a)
    .reduce((sum, x) => sum + addonFeeFor(x, personTier(a)), 0);
  // What one person in the roster costs: the base fee plus whatever they ticked.
  const attendeeAmount = (a) => guestBaseAmount(guestRegEvent, personTier(a)) + attendeeExtrasTotal(a);

  // Step 1: for an individual, who is coming. For a group, who is holding the
  // registration - the same fields, plus the promise that they are true.
  const guestStepOneErrors = () => {
    const errs = {};
    if (!guestRegForm.firstName.trim()) errs.firstName = 'First name is required.';
    if (!guestRegForm.lastName.trim()) errs.lastName = 'Last name is required.';
    // A child is asked for a name and a guardian. The church, the pastor and the
    // number to ring are the guardian's, and asking a parent to retype their own
    // details for each of their children is how three spellings of one church
    // end up on one family.
    if (isChildReg) {
      if (!guestGuardian) errs.guardian = 'Please search for the parent or guardian bringing them.';
      return errs;
    }
    if (!guestRegForm.churchName.trim()) errs.churchName = 'Church name is required.';
    if (!guestRegForm.churchPastor.trim()) errs.churchPastor = 'Church pastor is required.';
    if (!guestRegForm.mobile.trim()) errs.mobile = 'Contact number is required.';
    else if (!isValidPhMobile(guestRegForm.mobile)) errs.mobile = 'Philippine mobile number: 11 digits starting with 09.';
    // A representative whose own registration is still unverified cannot hold a
    // group booking - the name has to be changed before anything else matters.
    if (isBulk && repMatch && !repVerified) {
      errs.firstName = 'This registration is still waiting for verification.';
      errs.lastName = 'Please use a name that is not registered yet.';
    }
    if (isBulk && !repAgreed) errs.agree = 'Please confirm that the details above are true.';
    return errs;
  };

  // The bulk roster step: everyone needs a full name, and nobody may be on the
  // list twice - neither within the form nor against what is already registered.
  const guestRosterErrors = () => {
    const errs = {};
    if (fullRoster().length === 0 && !(repLocked && repNewAddonIds.length > 0)) {
      errs.roster = 'Add at least one attendee before continuing.';
      return errs;
    }
    // Names are checked as each person is added, but the list is re-checked here
    // in case a duplicate showed up on the server while the form was open.
    bulkAttendees.forEach((a, i) => {
      if (dupNames.includes(nameKey(a.firstName, a.lastName))) errs[`attendee-${i}`] = 'This person is already registered for this event.';
    });
    return errs;
  };

  // The same for the payment step - only asked when there is something to pay.
  const guestPaymentErrors = () => {
    const errs = {};
    if (guestTotalAmount(guestRegEvent) <= 0) return errs;
    // The picker sets paymentMethod, so nothing picked means nothing to check against.
    if (eventChannels(guestRegEvent).length > 0 && !guestPayChannel) errs.paymentMethod = 'Please choose where you sent the payment.';
    else if ((guestRegEvent?.payment_methods || []).length > 1 && !guestRegForm.paymentMethod) errs.paymentMethod = 'Please choose how you paid.';
    // Cash is handed over at the desk, so there is no number to quote and no
    // receipt to photograph. Asking for either would make the form impossible
    // to finish for the one method that has neither.
    const pickedChannel = eventChannels(guestRegEvent).find((c) => c.id === guestPayChannel);
    if (pickedChannel ? isCashChannel(pickedChannel) : eventTakesCash([], [guestRegForm.paymentMethod])) return errs;
    if (!guestRegForm.paymentReference.trim()) errs.paymentReference = 'Reference number is required.';
    if (!guestRegProof) errs.proof = 'Proof of payment is required.';
    return errs;
  };

  // Typing in a field clears its own red state, so the form stops shouting as
  // soon as it is being fixed.
  const clearGuestFieldError = (field) => setGuestFieldErrors((errs) => {
    if (!errs[field]) return errs;
    const next = { ...errs };
    delete next[field];
    return next;
  });

  const guestStepOneValid = () => Object.keys(guestStepOneErrors()).length === 0;
  // Everything that must be true before the step after `step` can be opened.
  const guestStepsValidUpTo = (step) => {
    if (step > 0 && !guestStepOneValid()) return false;
    if (isBulk && step > rosterStep && Object.keys(guestRosterErrors()).length > 0) return false;
    return true;
  };

  // Jumping around the stepper: back is always fine, forward has to satisfy the
  // same rules as the Continue buttons.
  const goToGuestStep = (step) => {
    if (step === guestRegStep) return;
    if (step < guestRegStep) { setGuestRegResult(null); setGuestRegStep(step); return; }
    if (!guestStepsValidUpTo(step)) return;
    if (step === payStep && guestTotalAmount(guestRegEvent) <= 0) return;
    setGuestRegResult(null);
    setGuestRegStep(step);
  };

  const guestRegNext = () => {
    const errs = guestRegStep === rosterStep ? guestRosterErrors() : guestStepOneErrors();
    if (Object.keys(errs).length > 0) {
      setGuestFieldErrors(errs);
      setGuestRegResult({
        ok: false,
        message: Object.values(errs).some((m) => m.includes('already'))
          ? 'Someone on the list is already registered. Please check the highlighted names.'
          : 'Please complete the highlighted fields.',
      });
      return;
    }
    setGuestFieldErrors({});
    setGuestRegResult(null);
    // Leaving the details step settles the church spelling, so the review page
    // and the receipt read the same as what is saved.
    if (guestRegStep === 0) settleChurchName();
    if (guestRegStep < reviewStep) { setGuestRegStep(guestRegStep + 1); return; }
    // Nothing to pay - the review IS the last step.
    if (guestTotalAmount(guestRegEvent) <= 0) { submitGuestRegistration(); return; }
    setGuestRegStep(payStep);
  };

  // Back out of the form to the individual-vs-bulk choice, keeping the event so
  // the wrong pick is a one-tap fix rather than starting over from the poster.
  const backToRegType = () => {
    const evt = guestRegEvent;
    closeGuestRegistration();
    if (evt) { setRegChoiceScreen('who'); setRegChoiceEvent(evt); }
  };

  // Switching between Individual and Bulk rebuilds the form from scratch, so
  // it throws away everything typed exactly as closing does - and it sits next
  // to the button that submits. It asks the same question.
  const requestBackToRegType = () => {
    if (guestRegDirty) { setDiscardPrompt('change-type'); return; }
    backToRegType();
  };

  const closeGuestRegistration = () => {
    setGuestRegEvent(null); setGuestRegResult(null); setGuestFieldErrors({});
    setGuestGuardian(null);
    setRepAgreed(false); setRepUsedSaved(false);
    setDupNames([]); setDupDetails([]);
    setDiscardPrompt(false);
    pristineReg.current = null;
  };

  // Has anything been entered that closing would throw away?
  //
  // A registration that has already gone through is NOT unsaved work - the
  // last step is a receipt, and being asked to confirm leaving it would be
  // nonsense. Everything else is measured against the snapshot taken when the
  // form opened.
  const guestRegDirty = useMemo(() => {
    if (!guestRegEvent || guestRegResult) return false;
    const pristine = pristineReg.current;
    if (!pristine) return false;
    if (JSON.stringify(guestRegForm) !== pristine.form) return true;
    // Sorted, because ticking an extra off and on again reorders the array
    // without changing what was chosen.
    if (JSON.stringify([...guestRegAddonIds].sort()) !== pristine.addons) return true;
    if (bulkAttendees.length > 0) return true;
    if (guestGuardian) return true;
    if (guestRegProof) return true;
    // A name half-typed into the roster's own row counts too: it is the most
    // common thing on screen when somebody mis-taps during a group booking.
    if (attendeeDraft && (attendeeDraft.firstName?.trim() || attendeeDraft.lastName?.trim())) return true;
    return false;
  }, [guestRegEvent, guestRegResult, guestRegForm, guestRegAddonIds, bulkAttendees, guestGuardian, guestRegProof, attendeeDraft]);

  // Every close the visitor can trigger goes through here. The X, the backdrop
  // and "Change type" all call this rather than closing directly, so there is
  // one place that decides whether the question gets asked.
  const requestCloseGuestRegistration = () => {
    if (guestRegDirty) { setDiscardPrompt('close'); return; }
    closeGuestRegistration();
  };

  // "Yes, discard" - carry out whatever was being asked about.
  const confirmDiscard = () => {
    const action = discardPrompt;
    setDiscardPrompt(null);
    if (action === 'change-type') backToRegType();
    else closeGuestRegistration();
  };

  // Leaving the page outright - the browser's Back button, a reload, closing
  // the tab. None of those go through any handler of ours, and a browser will
  // not let a page put its own dialog in front of them: the only thing on
  // offer is this flag, which makes the browser show its own "Leave site?"
  // prompt. The wording is fixed by the browser and cannot be customised -
  // that is deliberate on their part, to stop pages writing scary messages.
  // It is also the only protection there is for a phone's back gesture.
  useEffect(() => {
    if (!guestRegDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guestRegDirty]);

  const toggleGuestAddon = (addon) => {
    if (addon.is_required) return;
    setGuestRegAddonIds((ids) => (ids.includes(addon.id) ? ids.filter((v) => v !== addon.id) : [...ids, addon.id]));
  };

  // A genuinely free event: no base fee and no compulsory paid extra. Not the
  // same as "the total is currently zero", which is also true of a bulk form
  // before anyone has been added.
  const eventIsFree = (evt) => guestBaseAmount(evt) <= 0
    && (evt?.event_addons || []).filter((a) => a.is_required).every((a) => !(Number(a.fee) > 0));

  // Base price for this visitor (early bird if it still applies).
  // What one person pays before extras: their age group's price on an event
  // that has groups, the single registration fee on one that does not.
  const guestBaseAmount = (evt, tier) => {
    if (!evt) return 0;
    if (!hasPriceTiers(evt)) {
      if (!evt.has_fee) return 0;
      const early = evt.early_bird_price != null && evt.early_bird_deadline && Date.now() <= (evtMs(evt.early_bird_deadline) ?? 0);
      return Number(early ? evt.early_bird_price : evt.registration_fee) || 0;
    }
    return baseAmountFor(evt, tier || findTier(evt, guestRegForm.priceTier) || defaultTier(evt));
  };

  // The group one person on the roster is in.
  const personTier = (a) => findTier(guestRegEvent, a?.priceTier) || defaultTier(guestRegEvent);

  // A child registering on their own: a name, the group, and the parent who is
  // bringing them. Everything else on the form - church, pastor, number - comes
  // from that parent's own registration, so it is not asked for twice.
  //
  // Never true for a group booking: there the representative is the adult
  // holding it, and the children are names on their roster.
  const guestTier = () => findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent);
  const isChildReg = !isBulk && isNameOnlyTier(guestTier());

  // Base + the extras ticked. Only a preview - the server recomputes the real
  // total from the database so the form can't understate what is owed.
  const guestTotalAmount = (evt) => {
    // A group pays for each person on the roster, extras and all.
    if (guestRegMode === 'bulk') {
      const topUp = repLocked ? repTopUpTotal() : 0;
      return topUp + fullRoster().reduce((sum, a) => sum + attendeeAmount(a), 0);
    }
    const tier = findTier(evt, guestRegForm.priceTier) || defaultTier(evt);
    return guestBaseAmount(evt, tier)
      + (evt?.event_addons || [])
          .filter((a) => guestRegAddonIds.includes(a.id))
          .reduce((sum, a) => sum + addonFeeFor(a, tier), 0);
  };

  const submitGuestRegistration = async () => {
    if (!guestRegEvent) return;
    const stepOneErrs = guestStepOneErrors();
    if (Object.keys(stepOneErrs).length > 0) {
      setGuestFieldErrors(stepOneErrs);
      setGuestRegResult({ ok: false, message: 'Please complete the highlighted fields.' });
      setGuestRegStep(0);
      return;
    }
    if (isBulk) {
      const rosterErrs = guestRosterErrors();
      if (Object.keys(rosterErrs).length > 0) {
        setGuestFieldErrors(rosterErrs);
        setGuestRegResult({ ok: false, message: 'Please check the highlighted names.' });
        setGuestRegStep(rosterStep);
        return;
      }
    }
    // With more than one account to choose from, we need to know which one they
    // used before an admin can match the payment.
    const payErrs = guestPaymentErrors();
    if (Object.keys(payErrs).length > 0) {
      setGuestFieldErrors(payErrs);
      setGuestRegResult({ ok: false, message: 'Please complete the highlighted fields.' });
      return;
    }
    setGuestFieldErrors({});
    setGuestRegSubmitting(true);
    setGuestRegResult(null);
    try {
      const fd = new FormData();
      fd.append('eventId', guestRegEvent.id);
      fd.append('attendeeFirstName', guestRegForm.firstName.trim());
      fd.append('attendeeLastName', guestRegForm.lastName.trim());
      if (isBulk) {
        fd.append('attendees', JSON.stringify(fullRoster().map((a) => ({
          firstName: a.firstName.trim(), lastName: a.lastName.trim(), addonIds: a.addonIds,
          priceTier: a.priceTier || null,
        }))));
        // Who to call about this booking - stored on every row of the group.
        fd.append('representative', `${guestRegForm.firstName.trim()} ${guestRegForm.lastName.trim()}`.trim());
        // Extras the representative is availing on the slot they already hold.
        if (repLocked && repNewAddonIds.length > 0) fd.append('repAddonTopUp', JSON.stringify(repNewAddonIds));
      }
      fd.append('attendeeEmail', guestRegForm.email || '');
      fd.append('attendeeMobile', guestRegForm.mobile || '');
      // Saved as the one word whichever spelling of "no church" was typed.
      fd.append('churchName', normalizeChurchName(guestRegForm.churchName) || '');
      fd.append('churchPastor', guestRegForm.churchPastor ? `Ptr. ${guestRegForm.churchPastor.trim()}` : '');
      fd.append('addonIds', JSON.stringify(guestRegAddonIds));
      // Which age group, never what it costs - the server reads the price
      // from the database so a changed form cannot lower a fee.
      fd.append('priceTier', guestRegForm.priceTier || '');
      // A child's row inherits the church, pastor and number from this
      // registration - the server reads them, so nothing is retyped here.
      if (guestGuardian?.id) fd.append('guardianRegistrationId', guestGuardian.id);
      if (guestTotalAmount(guestRegEvent) > 0) {
        fd.append('paymentMethod', guestRegForm.paymentMethod || '');
        fd.append('paymentReference', guestRegForm.paymentReference || '');
        if (guestRegProof) fd.append('proof', guestRegProof, proofFileName());
      }
      const res = await fetch('/api/events/registrations', { method: 'POST', body: fd });
      const data = await res.json();
      setGuestRegResult({ ok: !!data.success, message: data.message || (data.success ? 'You are registered!' : 'Something went wrong. Please try again.') });
      // Slots left and the church counts both come off the registration rows, so
      // pull the events again - a group of five has just taken five seats.
      if (data.success) setEventsVersion((v) => v + 1);
    } catch {
      setGuestRegResult({ ok: false, message: 'Network error. Please try again.' });
    } finally {
      setGuestRegSubmitting(false);
    }
  };

  // ---- Chatbot (Joy AI Assistant) ----
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content: `Hello, I'm **Joy**, ${brand.isPlatform ? `your SanctuaryHub assistant for **${brand.church}**` : `your assistant at **${brand.church}**`}. 😊\n\nI'd be glad to help you with:\n- **Service times** and planning your first visit\n- **ISOM** enrollment and details\n- Upcoming **events** and registration\n- **Past events**, for the dates you choose\n- Getting connected or creating an account\n\nHow may I assist you today?`,
    },
  ]);
  const chatBodyRef = useRef(null);

  // ---- Check logged in & catch OAuth hash redirect ----
  useEffect(() => {
    // Safety net: if Google OAuth redirects to root with tokens in hash, redirect to callback page
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('access_token')) {
      const hashParams = window.location.hash.substring(1);
      router.replace(`/auth/callback?mode=login#${hashParams}`);
      return;
    }

    const userData = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    // A Guest account (and nothing more) stays here, signed in: the navbar
    // shows who they are, and the live service plays for them. Members and
    // staff work from their dashboard, so they go on there as before.
    const signedIn = !!(userData && userData.firstname && userData.email);
    const roles = [userData?.role, ...(userData?.additional_roles || [])].filter(Boolean);
    const guestOnly = roles.every((r) => r === 'Guest');
    const onEventLink = !!slugFromPath(window.location.pathname);
    if (signedIn && (!guestOnly || onEventLink)) {
      // Somebody signed in is sent to their dashboard. But an event link IS
      // this page's address, and sending
      // them to /dashboard threw the slug away: tapping a link to a specific
      // event landed them on the dashboard home with no sign of the event they
      // were invited to.
      //
      // The slug is handed over instead, and the dashboard opens that event on
      // the Events section (see the pendingEventLink effect there). Session
      // storage, not local: it belongs to this tab and this hop, and a slug
      // left behind in localStorage would reopen an event weeks later.
      const linkSlug = slugFromPath(window.location.pathname);
      if (linkSlug) {
        try { sessionStorage.setItem('pendingEventLink', linkSlug); } catch { /* ignore */ }
        router.replace('/events');
      } else {
        router.replace('/dashboard');
      }
      return;
    }
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    if (saved) { document.body.classList.add('dark-mode'); document.documentElement.classList.add('dark-mode'); }
  }, [router]);

  // ---- Which hero the site is set to ----
  //
  // A clip cut for a widescreen monitor is the wrong shape on a phone held
  // upright, so the two are chosen separately and the viewport is read once,
  // here. Once, deliberately: re-picking on every resize would restart the
  // download from scratch each time somebody dragged a window edge.
  useEffect(() => {
    setHeroIsMobile(window.matchMedia?.('(max-width: 768px)')?.matches === true);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hero-media');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.data) setHeroMedia(normalizeHeroMedia(json.data));
      } catch { /* the carousel is the fallback, and it is already showing */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const heroVideoSrc = heroVideoFor(heroMedia, heroIsMobile);

  // ---- Hero auto-rotate ----
  // Only the carousel rotates. On a video hero the photos are not on screen to
  // be advanced, and leaving the timer running would still swap the tagline
  // underneath the clip every six seconds with no dots to explain why.
  useEffect(() => {
    if (heroVideoSrc) return undefined;
    heroTimer.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(heroTimer.current);
  }, [heroVideoSrc]);

  // ---- "Next Gathering" ticks over without a reload ----
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- Is a service streaming right now? ----
  // The same public list the Sunday Service page checks, cached at the CDN for ten
  // seconds - so this costs the church nothing per visitor. Asked again every
  // two minutes, which is how a tab left open finds out the service started.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/live-streams/public');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json)) setLiveStreams(json);
      } catch { /* no live card is the same as nothing live */ }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ---- ISOM carousel auto-rotate ----
  useEffect(() => {
    const t = setInterval(() => {
      setIsomIndex(prev => (prev + 1) % (isomData.slides.length || 1));
    }, 4000);
    return () => clearInterval(t);
  }, [isomData.slides.length]);

  // ---- Load ISOM content (dynamic, editable via SuperAdmin) ----
  useEffect(() => {
    const loadIsom = async () => {
      try {
        const res = await fetch('/api/admin/isom');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setIsomData({
              subtitle: json.data.subtitle || isomData.subtitle,
              bullets: Array.isArray(json.data.bullets) && json.data.bullets.length ? json.data.bullets : isomData.bullets,
              class_start_date: json.data.class_start_date || isomData.class_start_date,
              slides: Array.isArray(json.data.slides) && json.data.slides.length ? json.data.slides : isomData.slides,
            });
          }
        }
      } catch { /* keep defaults */ }
    };
    loadIsom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load events for the News section (upcoming first, then most recent) ----
  useEffect(() => {
    const loadNews = async () => {
      try {
        const res = await fetch('/api/events?limit=20&published=true');
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            const now = Date.now();
            const notCompleted = json.data.filter((evt) => {
              const end = evtMs(evt.end_date) ?? evtMs(evt.event_date);
              return !end || end >= now;
            });
            const sorted = [...notCompleted].sort((a, b) => {
              const da = evtMs(a.event_date) ?? 0;
              const db = evtMs(b.event_date) ?? 0;
              const aUpcoming = da >= now;
              const bUpcoming = db >= now;
              // Upcoming events first (soonest first), then past events (most recent first)
              if (aUpcoming && bUpcoming) return da - db;
              if (aUpcoming) return -1;
              if (bUpcoming) return 1;
              return db - da;
            });
            const titled = sorted.map(withTitleCase);
            setNewsEvents(titled.slice(0, 8));
            // Joy reads the full list, not the eight on the cards - and the
            // title-cased copy, so the name she says back matches the name on
            // the poster the visitor is looking at.
            setLiveEvents(titled);
          }
        }
      } catch { /* fall back to defaults */ }
    };
    loadNews();
  }, [eventsVersion]);

  // ---- Magic links: /miracle-working-god-cebu-event -----------------------
  // next.config.mjs rewrites any single-segment path with no page of its own
  // to this page, so the slug someone was sent is still sitting in the address
  // bar. It is matched against the published events (lib/eventSlug.js) and
  // that event's registration is opened straight away - the point of the link
  // is that the person who taps it never has to find the event themselves.
  //
  // The whole published list is asked for rather than the News section's top
  // eight, because a link is just as likely to point at the ninth event.
  const linkSlugRef = useRef('');   // the slug already acted on: closing the modal must not reopen it
  const linkOwnsUrlRef = useRef(false); // an event link is up because this page put it there
  const [linkResolving, setLinkResolving] = useState(false);
  const [linkMiss, setLinkMiss] = useState('');  // a link that matched nothing, shown as a notice

  useEffect(() => {
    const slug = slugFromPath(pathname);
    // Every path that is not a magic link - "/" included - lands here, and so
    // does the "/" this effect itself restores when a modal closes.
    if (!slug || linkSlugRef.current === slug) return undefined;
    linkSlugRef.current = slug;

    let cancelled = false;
    setLinkResolving(true);
    (async () => {
      try {
        // The same URL the News section asks for, first.
        //
        // This used to go straight for limit=200, which is a second request for
        // 200 events with all their days, add-ons and seat counts - on top of
        // the 20 the page was already loading, and on the slowest moment of the
        // visit. A link nearly always points at something current, so the 20
        // already being fetched almost always has it: same URL means the server
        // serves both from one cached read and the browser may not go out at
        // all. Only a link to something further down the list pays for the
        // bigger fetch, and it pays for it once.
        const lookIn = async (url) => {
          const res = await fetch(url);
          const json = res.ok ? await res.json() : null;
          return json?.success && Array.isArray(json.data) ? json.data : [];
        };

        let match = findEventBySlug(await lookIn('/api/events?limit=20&published=true'), slug);
        if (cancelled) return;
        if (!match) {
          match = findEventBySlug(await lookIn('/api/events?limit=200&published=true'), slug);
          if (cancelled) return;
        }
        if (!match) { setLinkMiss(slug); return; }
        linkOwnsUrlRef.current = true;

        const evt = withTitleCase(match);
        // Behind the dialog, put them on the events section rather than the
        // hero, so closing it leaves them looking at the event they came for.
        document.getElementById('news')?.scrollIntoView({ block: 'start' });
        // A full, closed or not-yet-open event opens its poster instead: the
        // modal then says why in place of the Register button.
        if (evtRegOpen(evt)) handlePublicRegister(evt);
        else setDetailEvent(evt);
      } catch {
        if (!cancelled) setLinkMiss(slug);
      } finally {
        if (!cancelled) setLinkResolving(false);
      }
    })();
    // Cleanup runs before the next effect body, so a slug that supersedes this
    // one turns the overlay straight back on - it is only left off when there
    // is genuinely nothing being looked up any more.
    return () => { cancelled = true; setLinkResolving(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // A link that matched nothing says so, then gets out of the way.
  useEffect(() => {
    if (!linkMiss) return undefined;
    const t = setTimeout(() => setLinkMiss(''), 9000);
    return () => clearTimeout(t);
  }, [linkMiss]);

  // Keep the address bar on the event's own link for as long as its dialog is
  // up, so the tab can be shared exactly as it stands, and hand "/" back when
  // it closes. history.replaceState rather than the router: this is a cosmetic
  // URL, and a real navigation would tear down a half-filled form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const open = guestRegEvent || regChoiceEvent || detailEvent;
    const slug = open ? eventSlug(open) : '';

    // Nothing open. "/" goes back only if this page is what put an event link
    // in the address bar - on first load that link is the one the visitor
    // arrived on, and it is still being looked up. Wiping it there cancelled
    // the very lookup it was for.
    if (!slug && !linkOwnsUrlRef.current) return;
    // Claim the slug before writing it: the address bar is what the resolver
    // above watches, and a link this page wrote itself has already been acted
    // on. Without this, opening an event would immediately "resolve" its own
    // URL and reopen the dialog from the top, wiping a half-filled form.
    if (slug) linkSlugRef.current = slug;
    linkOwnsUrlRef.current = !!slug;

    const target = slug ? `/${slug}` : '/';
    if (window.location.pathname === target) return;
    try {
      window.history.replaceState(window.history.state, '', target + window.location.search + window.location.hash);
    } catch { /* the dialog matters more than the address bar */ }
  }, [guestRegEvent, regChoiceEvent, detailEvent]);


  // ---- Scroll listener ----
  useEffect(() => {
    const handleScroll = () => {
      // Intersection-style animation
      document.querySelectorAll('.hp-animate:not(.visible)').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight - 80) {
          el.classList.add('visible');
        }
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    // Trigger once on mount
    setTimeout(handleScroll, 300);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Sections that arrive after the first paint (the events, once they load)
  // are revealed by the same check, run again when they land - otherwise a
  // grid already on screen would wait for the visitor to scroll before it
  // faded in.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('scroll')), 80);
    return () => clearTimeout(t);
  }, [newsEvents.length]);

  // ---- Daily verse (cached 24h in localStorage) ----
  const fetchDailyVerse = useCallback(async () => {
    const FALLBACK = { verse: '‘For I know the plans I have for you,’ declares the Lord, ‘plans to prosper you and not to harm you, plans to give you hope and a future.’', reference: 'Jeremiah 29:11 (NIV)' };
    // The verse turns over on the calendar day, not 24h after it was fetched,
    // so everyone sees the same verse change at midnight local time.
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

    // 1) Serve the cached verse if it was fetched today
    try {
      const cached = JSON.parse(localStorage.getItem('dailyVerse') || 'null');
      if (cached && cached.verse && cached.day === today) {
        setDailyVerse({ verse: cached.verse, reference: cached.reference });
        return;
      }
    } catch { /* ignore corrupt cache */ }

    // No "is the AI configured?" check here any more - the browser cannot know,
    // now that the key lives on the server. A server without one answers 503,
    // which lands in the same FALLBACK as any other failure below.

    // 2) Otherwise fetch a fresh verse and cache it for the day
    try {
      const res = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a Bible verse provider. Respond ONLY with valid JSON in the exact form {"verse":"...","reference":"Book Chapter:Verse (NIV)"} and nothing else.' },
            { role: 'user', content: `Provide a single inspiring, uplifting Bible verse for today (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}). Vary the book and choose an encouraging verse. Return JSON only.` },
          ],
          temperature: 1.0, max_tokens: 250,
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.verse && parsed.reference) {
          setDailyVerse({ verse: parsed.verse, reference: parsed.reference });
          localStorage.setItem('dailyVerse', JSON.stringify({ verse: parsed.verse, reference: parsed.reference, day: today }));
          return;
        }
      }
      setDailyVerse(FALLBACK);
    } catch {
      setDailyVerse(FALLBACK);
    }
  }, []);

  useEffect(() => { fetchDailyVerse(); }, [fetchDailyVerse]);

  // ---- Chatbot: auto-scroll to newest message ----
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading, chatOpen]);

  // ---- Chatbot: freshen the events before she is asked about them ----
  // A tab left open for an hour would otherwise have Joy quoting the slot count
  // from whenever the page was loaded. Opening the chat re-reads the list; the
  // route is cached for half a minute on the server and twenty seconds in the
  // browser, so this costs nothing when the chat is opened and closed again.
  // Every published event, past ones included, for "show me past events".
  // Read only when somebody asks, and kept for the rest of the chat. Same URL
  // as the magic-link lookup, so the server's cache serves both.
  const eventArchive = useRef(null);

  useEffect(() => {
    if (chatOpen) {
      setEventsVersion((v) => v + 1);
      eventArchive.current = null; // past events are re-read on the next lookup too
    }
  }, [chatOpen]);

  const loadEventArchive = async () => {
    if (eventArchive.current) return eventArchive.current;
    const res = await fetch('/api/events?limit=200&published=true');
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !Array.isArray(json.data)) {
      throw new Error(json.message || 'The events could not be loaded.');
    }
    eventArchive.current = json.data.map(withTitleCase);
    return eventArchive.current;
  };

  // The custom range under Joy's question. Starts on the last three months.
  const [pastFrom, setPastFrom] = useState('');
  const [pastTo, setPastTo] = useState('');

  const pastRangeQuestion = (text) => ({
    role: 'assistant',
    content: text || 'I’d be glad to show you our past events. **Which dates** would you like me to look up? Choose a range below, or type the dates (for example, “September to October 2026”).',
    rangePicker: true,
  });

  // The answer itself: a card per event, written from the rows. `content` is
  // what the AI is shown on the next turn, so a follow-up like "tell me more
  // about the Ormoc one" still has something to go on; `display` is what the
  // visitor reads above the cards.
  const answerPastEvents = async (fromStr, toStr) => {
    const [a, b] = fromStr <= toStr ? [fromStr, toStr] : [toStr, fromStr];
    let all;
    try {
      all = await loadEventArchive();
    } catch (err) {
      console.error('[Joy] past events:', err.message);
      return pastRangeQuestion('I couldn’t load the events just now. Please try again in a moment.');
    }
    const found = eventsInRange(all, a, b);
    const span = `**${prettyDay(a)}** to **${prettyDay(b)}**`;
    if (found.length === 0) {
      return pastRangeQuestion(`I couldn’t find any church events from ${span}. Would you like to try a wider range?`);
    }
    const shown = found.slice(0, PAST_EVENTS_MAX);
    let display;
    if (found.length === 1) display = `Here is the event from ${span}.`;
    else if (found.length === shown.length) display = `Here are the **${found.length} events** from ${span}, most recent first.`;
    else display = `I found **${found.length} events** from ${span}. Here are the ${shown.length} most recent; choose a shorter range to see the others.`;
    const summary = shown.map((e) => {
      const st = evtStatus(e.event_date, e.end_date);
      const where = [e.location, e.loc_city].filter(Boolean).join(', ');
      return `- ${e.title} — ${evtShortWhen(e.event_date, e.end_date)}${where ? ` — ${where}` : ''}${st ? ` (${st})` : ''}${e.description ? ` — ${evtBlurb(e.description, 200)}` : ''}`;
    }).join('\n');
    return { role: 'assistant', content: `${display}\n\n${summary}`, display, events: shown };
  };

  // A preset chip or the custom range: said back as the visitor's own message,
  // then answered straight from the database - no AI round trip needed.
  const pickPastRange = async (fromStr, toStr) => {
    if (!fromStr || !toStr || chatLoading) return;
    const [a, b] = fromStr <= toStr ? [fromStr, toStr] : [toStr, fromStr];
    const asked = [...chatMessages, { role: 'user', content: `Show events from ${prettyDay(a)} to ${prettyDay(b)}` }];
    setChatMessages(asked);
    setChatLoading(true);
    try {
      setChatMessages([...asked, await answerPastEvents(a, b)]);
    } finally {
      setChatLoading(false);
    }
  };

  // The events briefing Joy answers out of. Rebuilt whenever the event list
  // changes (a registration comes in, an admin edits a date), so what she says
  // is the row as it stands in Supabase - not a fact typed into a prompt once.
  const eventsDigest = useMemo(() => buildEventsDigest(liveEvents), [liveEvents]);

  // Starter chips under the greeting. The first one names the next event by its
  // real name, so a visitor who has never heard of it can ask about it without
  // having to know it exists - which is the whole difficulty with a chatbot on
  // a church page: people do not know what to ask it.
  const chatSuggestions = useMemo(() => {
    const next = liveEvents[0];
    const chips = [];
    if (next) {
      // With the town, because the next two events can be the same conference
      // in two cities - "Tell me about Miracle Working God" would be a question
      // Joy has to answer with another question.
      const place = evtPlaceLabel(next);
      chips.push(`Tell me about ${next.title}${place ? ` in ${place}` : ''}`);
    }
    if (liveEvents.length > 1) chips.push('What events are coming up?');
    chips.push('What time is Sunday service?');
    chips.push('Show me past events');
    if (chips.length < 4) chips.push('How do I enroll in ISOM?');
    return chips;
  }, [liveEvents]);

  const CHAT_SYSTEM_PROMPT = `You are "Joy", the professional AI assistant of ${brand.church} (JSCI), a Spirit-filled church in ${CHURCH_CITY}. You answer visitors on the church's website, which runs on SanctuaryHub — the church's AI-powered church management platform.

TONE & STYLE:
- Write in a warm but professional and polished tone, like a helpful ministry representative.
- Be concise and well-organized. Prefer short paragraphs (1-2 sentences) separated by a blank line.
- When listing details (times, steps, options), use bullet points starting with "- ".
- Emphasize the most important words or key terms using **bold** markdown (e.g. **Sunday 9:00 AM**, **ISOM**, **August 2026**). Bold sparingly and purposefully — only the key terms, not whole sentences.
- Use emojis very sparingly — at most ONE per reply, and only when it genuinely adds warmth. Many replies should have none.
- Do NOT use markdown headings (#) or tables. Only **bold**, plain paragraphs, and "- " bullets.

KEY FACTS:
- Worship Service: **Sunday 9:00 AM**. Bible Study: **Friday 7:00 PM**. Youth Fellowship: **Saturday 2:00 PM**. These are Philippine time (GMT+8). There is also an **Online Midweek Service** every **Wednesday**; its videos are on the website to watch any time, with a free account.
- Senior Pastors: **Dr. Weldon Pior** and **Dr. Dorothy Pior**. Associate Pastors: **Ptr. Gracelyn Gambe** and **Ptr. Eldan Gambe**. Youth Pastor: **Ptr. Psalm Gambe**.
- Location: **${CHURCH_CITY}**. For directions, point visitors to the **Visit Us** map on this page, which has a Get Directions button. Never invent a street address.
- Ministries members can serve in: Praise & Worship, Media, Dance, Ushering and Youth.
- Contact: visitors can message the church on its **Facebook page** or **Messenger** (see OFFICIAL LINKS). Never invent a phone number or an email address.
- Giving: tithes and offerings are received during the services, and online on the Sunday Service page (/sunday-service, its "Tithes & Offering" card) by GCash, Maya or bank transfer — no account needed. Donations to the church's drives are at /donation, where each drive has a jar that fills as people give. Send people to those pages; never type out bank details, account numbers or payment links yourself.
- ISOM (International School of Ministries) is a ministry-training program. Classes begin **August 2026**. People enroll by signing up / clicking "Enroll Now".
- Users can sign up or log in from the navbar buttons. Watching the live service on the website needs a free account (a Guest account is enough); anyone can make one in a minute from Sign Up.

If you don't know something specific, professionally encourage the user to contact the church office or visit in person. Keep answers focused (usually 2-4 short paragraphs or a short list). Never invent doctrine; refer spiritual counsel to a pastor.

ANSWERING ABOUT EVENTS:
- The EVENT DATA below is live from the church's own database. It is the ONLY source you may use for events. Never invent an event, a date, a venue, a price or a slot count, and never repeat an event from an earlier conversation that is not in the list below.
- Use the event's name EXACTLY as written below (in **bold**), so the visitor can match it to the poster on the page.
- Two events can share the same name and be held in different cities on different dates. When that happens, NEVER merge them into one answer — list them separately and always say which city each one is in, e.g. **Miracle Working God** in **Cebu City** and **Miracle Working God** in **Ormoc**. If the visitor asks about that name, ask which city they mean, or give both.
- When asked "what events are coming up", list them shortest-notice first, ONE bullet per event: the name in **bold**, then the date, the city and how long it runs, separated by em dashes on that same line. Never nest bullets under a bullet — the chat window only renders one level. Then offer to give full details on any of them.
- When asked about ONE event, give the useful specifics: **when** (with the day of the week), **where** (the full venue), **how many days** it runs, the daily start and end times when it has a multi-day schedule, the **cost**, how many **slots are left**, and whether registration is open, closing soon, or already full.
- If registration is not open yet, closed, or fully booked, say so plainly and say why — never invite someone to register for an event they cannot join.
- If an event is free, say **Free**. If it has a fee, always give the peso amount. Mention early-bird pricing and its deadline when one is still running.
- The EVENT DATA below lists only events that have NOT ended yet. If it has none, say there are no **upcoming** events and invite them to check back or join the weekly services. Never say there are no past events — past events are looked up separately (see PAST EVENTS). Do NOT guess.
- Do not paste event URLs and do not name a specific button. After you name an event, a button for it appears under your message automatically, so you may end with something like "tap the button below to see the full details or to register".

LINKS:
- When a link helps, write it as [Title](URL), for example [Facebook](${FACEBOOK_URL}). The visitor sees it as a button with the right icon, so never paste a bare address and never write the address twice.
- Only share links listed in OFFICIAL LINKS, MORE CHURCH LINKS or CHURCH DOCUMENTS, exactly as written. Never invent or guess a web address, and never say the church has an account on a social media site that is not listed.
- When asked for the church's social media, write one short sentence first, then list each listed account as its own "- " bullet that STARTS with its link and then says what it is for, e.g. "- [Facebook](${FACEBOOK_URL}) — news and announcements". Do not write the platform's name again before or after the link; the button already shows it.
- When the visitor asks for ONE link (e.g. "what's your Facebook page?"), answer in a friendly sentence with the link inside it, e.g. "You can find us on [Facebook](${FACEBOOK_URL}), where we post news and announcements." — not a one-item list.

OFFICIAL LINKS:
- [Facebook](${FACEBOOK_URL}) — the church's Facebook page: news, announcements and photos
- [Messenger](${MESSENGER_URL}) — to send the church a message
- [YouTube](${YOUTUBE_URL}) — sermons and past live services
- [Sunday Service](/sunday-service) — the Sunday Service live when it is streaming, and past Sunday services (sign in with a free account to watch)
- [Midweek Service videos](/midweek) — the Online Midweek Service and other past services on video, to watch any time; they open on Facebook (sign in with a free account to see them)
- [Directions on Google Maps](${DIRECTIONS_URL}) — directions to the church

PASTORS: when you mention a pastor, use their full name and title as written in KEY FACTS (e.g. **Ptr. Eldan Gambe**) - their photo is shown with your answer automatically.

PAST EVENTS (events that already happened):
- You do not have past events in your data. They are looked up from the church database by a date range, and shown to the visitor as cards with the poster and details.
- When the visitor asks about past, previous, recent, last or finished events and has NOT said which dates, do not list or describe any event. Reply with one short, friendly sentence asking which dates they would like to see, then put the tag [[ASK_PAST_RANGE]] on its own line at the very end.
- When the visitor names ANY period — a month ("October", "October 2026"), a year ("2026", "this year"), "last month", "last week", "the past 3 months", or two dates — that IS the date range. Do NOT ask for exact days. Work out the first and last day using today's date below: a month runs from its 1st to its last day; "last month" is the whole previous calendar month; "this year" runs from January 1 to today; "the past N days/weeks/months" runs from that far back to today; a month with no year means the most recent one that has started. Then reply with one short sentence and put the tag [[PAST_EVENTS YYYY-MM-DD YYYY-MM-DD]] (start date, then end date) on its own line at the very end.
- Never list or describe the past events yourself — the cards appear automatically under your message.
- Examples, if today were Monday, November 23, 2026:
  Visitor: "What events did you have in October 2026?" → You: "Here are our events from October 2026." then [[PAST_EVENTS 2026-10-01 2026-10-31]]
  Visitor: "past events last month" → You: "Here are our events from last month." then [[PAST_EVENTS 2026-10-01 2026-10-31]]
  Visitor: "September to October" → You: "Here are our events from September to October 2026." then [[PAST_EVENTS 2026-09-01 2026-10-31]]
  Visitor: "what were the last events?" → You: "Which dates would you like me to look up?" then [[ASK_PAST_RANGE]]
- Only use these tags for past events, never for upcoming ones.

${eventsDigest}`;

  // Render a single line: **bold**, [Title](link) and bare web addresses. A
  // link is drawn as its platform's icon and a readable title - "Facebook ·
  // CebuCityJoyfulSound", not a raw address - and opens in a new tab. Only
  // http(s), mailto:, tel: and this site's own paths become links (lib/linkMeta).
  const INLINE_TOKEN = /(\*\*[^*]+\*\*)|\[([^\]\n]+)\]\(([^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,!?;:'"*])/g;
  const renderInline = (text, keyPrefix) => {
    const out = [];
    let last = 0;
    let n = 0;
    for (const m of text.matchAll(INLINE_TOKEN)) {
      if (m.index > last) out.push(<span key={`${keyPrefix}-t${n}`}>{text.slice(last, m.index)}</span>);
      if (m[1]) {
        out.push(<strong key={`${keyPrefix}-b${n}`} className="hp-chat-em">{renderInline(m[1].slice(2, -2), `${keyPrefix}-b${n}`)}</strong>);
      } else {
        const link = linkMeta(m[3] || m[4], m[2]);
        out.push(link ? (
          <a
            key={`${keyPrefix}-l${n}`}
            href={link.href}
            className={`hp-chat-link is-${link.key}`}
            {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <i className={link.icon} aria-hidden="true"></i>
            <span>{link.title}</span>
          </a>
        ) : <span key={`${keyPrefix}-l${n}`}>{m[2] || m[0]}</span>);
      }
      last = m.index + m[0].length;
      n += 1;
    }
    if (last < text.length) out.push(<span key={`${keyPrefix}-t${n}`}>{text.slice(last)}</span>);
    return out;
  };

  // The pastors as a small directory: photo, name, role - one row each. Used
  // in place of a bulleted list of their names, and under a reply that names
  // one in passing.
  const renderPastorList = (list, key, standalone = false) => (
    <ul className={`hp-chat-pastorlist${standalone ? ' standalone' : ''}`} key={key}>
      {list.map((p) => (
        <li key={p.name}>
          <img src={p.photo} alt="" loading="lazy" decoding="async" />
          <span>
            <strong>{p.name}</strong>
            <small>{p.title}</small>
          </span>
        </li>
      ))}
    </ul>
  );

  // "- [Facebook](https://…) — news and announcements": a list made of these
  // is drawn as rows - the platform's icon, the name, what it is for - rather
  // than bullets with a small button and a sentence wrapping under it.
  const LINK_ROW = /^\[([^\]\n]+)\]\(([^)\s]+)\)\s*(?:[—–:-]+\s*(.*))?$/;
  const renderLinkList = (rows, key) => (
    <div className="hp-chat-linklist" key={key}>
      {rows.map(({ link, about }) => (
        <a
          key={link.href}
          href={link.href}
          className={`hp-chat-linkrow is-${link.key}`}
          {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          <span className="hp-chat-linkrow-icon" aria-hidden="true"><i className={link.icon}></i></span>
          <span className="hp-chat-linkrow-text">
            <strong>{link.title}</strong>
            {about && <small>{about}</small>}
          </span>
          <i className={`fas ${link.external ? 'fa-arrow-up-right-from-square' : 'fa-chevron-right'} hp-chat-linkrow-go`} aria-hidden="true"></i>
        </a>
      ))}
    </div>
  );

  // Convert Joy's reply (bold, paragraphs, "- " bullets) into formatted JSX.
  // `shown` notes whether the pastors were drawn inside the reply, so the
  // message does not draw them a second time underneath.
  const renderRichText = (content, shown = {}) => {
    const lines = content.split('\n');
    const blocks = [];
    let bullets = [];
    const flushBullets = (key) => {
      if (!bullets.length) return;
      const links = bullets.map((b) => {
        const m = b.replace(/\*\*/g, '').trim().match(LINK_ROW);
        const link = m && linkMeta(m[2], m[1]);
        return link ? { link, about: (m[3] || '').trim() } : null;
      });
      const named = bullets.map((b) => pastorsNamedIn(b));
      if (links.every(Boolean)) {
        blocks.push(renderLinkList(links, `links-${key}`));
      } else if (named.every((n) => n.length === 1)) {
        blocks.push(renderPastorList(named.map((n) => n[0]), `pastors-${key}`));
        shown.pastors = true;
      } else {
        blocks.push(
          <ul className="hp-chat-list" key={`ul-${key}`}>
            {bullets.map((b, i) => <li key={i}>{renderInline(b, `li-${key}-${i}`)}</li>)}
          </ul>
        );
      }
      bullets = [];
    };
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (/^[-•]\s+/.test(line)) {
        bullets.push(line.replace(/^[-•]\s+/, ''));
      } else if (line === '') {
        flushBullets(idx);
      } else {
        flushBullets(idx);
        blocks.push(<p className="hp-chat-p" key={`p-${idx}`}>{renderInline(line, `p-${idx}`)}</p>);
      }
    });
    flushBullets('end');
    return blocks;
  };

  // Turn a reply into the buttons that go under it.
  //
  // An answer about an event is only half an answer while the visitor still has
  // to scroll back up and hunt for the card. So any event Joy actually named
  // gets its own button: one tap opens that event's details, and a second one
  // opens the registration form when registration is genuinely open - the same
  // gate the card's own button obeys, so she never offers a form that would
  // turn the person away.
  const buildChatActions = (reply, events = []) => {
    const t = reply.toLowerCase();
    const actions = [];

    const mentioned = eventsMentionedIn(reply, events).slice(0, 3);
    const shorten = (text) => (text.length > 24 ? `${text.slice(0, 23).trimEnd()}…` : text);
    // The same conference is run in several cities under one name, so a button
    // labelled with the title would give the visitor two identical buttons and
    // no way to tell which is which. Where the names collide, the town is the
    // label instead - it is the only part that differs.
    const sameName = new Set(mentioned.map((e) => e.title.toLowerCase())).size < mentioned.length;
    mentioned.forEach((evt) => {
      const place = evtPlaceLabel(evt);
      const label = mentioned.length === 1
        ? 'View Details'
        : shorten(sameName && place ? place : evt.title);
      actions.push({
        label,
        icon: 'fa-circle-info',
        onClick: () => { setChatOpen(false); setDetailEvent(evt); },
      });
    });
    // Only when she is talking about ONE event - two Register buttons side by
    // side is a question, not a shortcut.
    if (mentioned.length === 1 && evtRegOpen(mentioned[0])) {
      actions.push({
        label: 'Register',
        icon: 'fa-user-plus',
        onClick: () => { setChatOpen(false); handlePublicRegister(mentioned[0]); },
      });
    }
    // She spoke about events but did not name all of them - send them to the
    // section that has the rest. Pointless when the ones she named ARE all of
    // them, which is why this counts rather than just checking for a mention.
    if (/\bevent/.test(t) && liveEvents.length > 0 && mentioned.length < liveEvents.length) {
      actions.push({
        label: 'See All Events',
        icon: 'fa-calendar-days',
        onClick: () => { setChatOpen(false); scrollToSection('news'); },
      });
    }

    // "Register" in an answer about an event means that event's form, not a
    // SanctuaryHub account - so the generic Sign Up button stands down unless
    // the reply is really about creating an account.
    const accountTalk = mentioned.length === 0
      ? /(sign\s?up|signup|register|enroll|create an account|join)/.test(t)
      : /(create an account|sign\s?up for an account|free account)/.test(t);
    if (accountTalk) {
      actions.push({ label: 'Sign Up', href: '/signup', icon: 'fa-user-plus' });
    }
    if (/(sign\s?in|signin|log\s?in|login|log in to)/.test(t)) {
      actions.push({ label: 'Sign In', href: '/login', icon: 'fa-sign-in-alt' });
    }
    return actions;
  };

  // The hero's "Ask Joy" bar and the buttons that say "Ask Joy": open the chat
  // and send the question, so the visitor lands on an answer rather than an
  // empty box they then have to type into again.
  const askJoy = (question) => {
    const q = String(question || '').trim();
    setChatOpen(true);
    if (q) {
      setHeroAsk('');
      sendChatMessage(q);
    }
  };

  // `preset` is what the starter chips send - the same path as typing it, so a
  // tapped suggestion and a typed question are one code path.
  const sendChatMessage = async (preset) => {
    const text = (typeof preset === 'string' ? preset : chatInput).trim();
    if (!text || chatLoading) return;

    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');

    // Past events are answered here, without the AI, so they work even when it
    // cannot be reached:
    //  - dates given ("events last month", "October", or the reply to Joy
    //    asking which dates) -> the cards for that range;
    //  - a question about past events with no dates -> ask for the range.
    // A question about events in a range that is already over ("any events
    // from September to October?") counts as a past-events question too;
    // "events this month" does not, as that is mostly about what is coming.
    const awaitingRange = !!chatMessages[chatMessages.length - 1]?.rangePicker;
    const today = new Date();
    const range = parseDateRange(text, today);
    const rangeIsOver = !!range && range.to < ymd(today);
    if (range && (asksPastEvents(text) || awaitingRange || (EVENT_WORD_RE.test(text) && rangeIsOver))) {
      setChatLoading(true);
      try {
        setChatMessages([...newMessages, await answerPastEvents(range.from, range.to)]);
      } finally {
        setChatLoading(false);
      }
      return;
    }
    if (asksPastEvents(text) && !MENTIONS_DATES.test(text)) {
      setChatMessages([...newMessages, pastRangeQuestion()]);
      return;
    }

    setChatLoading(true);

    // Something useful to say when Joy cannot reach the AI at all, so a visitor
    // still leaves with the things they most often came to ask. The events are
    // read straight off the list this page already loaded, so even with the AI
    // down the next event's name, date and venue are still correct.
    const offline = (() => {
      const base = "I'm not fully connected right now, but here's what I can share: our **Worship Service** is **Sunday 9:00 AM**, and **ISOM** classes begin **August 2026**.";
      const next = liveEvents.filter((e) => evtStatus(e.event_date, e.end_date) !== 'ended').slice(0, 3);
      if (next.length === 0) return `${base} You can sign up or sign in anytime. 🙏`;
      const lines = next.map((e) => {
        const where = [e.location, e.loc_city].filter(Boolean).join(', ');
        const days = evtDayCount(e.event_date, e.end_date);
        return `- **${e.title}** — ${evtWhen(e.event_date, e.end_date)}${where ? ` at ${where}` : ''}${days > 1 ? ` (runs ${days} days)` : ''}`;
      });
      return `${base}\n\nComing up:\n\n${lines.join('\n')}`;
    })();

    try {
      const res = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...newMessages.slice(-8).map(m => ({ role: m.role, content: m.content })),
          ],
          // Room for a short list of events with their dates and venues - 400
          // cut the third event off mid-sentence.
          temperature: 0.6, max_tokens: 700,
          // The server adds whatever the church's documents say about the
          // question (Dashboard > System Configuration > Joy's Knowledge).
          knowledge: true,
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        // NOT "Sorry, I didn't quite catch that". That line is what hid a dead
        // model for months: every request was failing, and Joy answered as
        // though she simply had not understood anyone. A failure on our side
        // says so, and the reason goes to the console for whoever is looking.
        console.error('[Joy]', data.message || 'The AI returned no reply.');
        setChatMessages([...newMessages, {
          role: 'assistant',
          content: offline,
          actions: buildChatActions(`${offline} sign up sign in`, liveEvents),
        }]);
        return;
      }

      // Past events: the AI turned the visitor's words into dates; the cards
      // are built from the database, not from anything the AI wrote.
      const range = reply.match(PAST_TAG_RANGE);
      if (range) {
        setChatMessages([...newMessages, await answerPastEvents(range[1], range[2])]);
        return;
      }
      const clean = reply.replace(/\[\[[^\]]*\]\]/g, '').trim();
      if (PAST_TAG_ASK.test(reply) || (awaitingRange && MENTIONS_DATES.test(text))) {
        // Asked for dates, or was given dates it could not place - either way
        // the picker goes under the reply so the visitor can just choose.
        setChatMessages([...newMessages, pastRangeQuestion(clean || undefined)]);
        return;
      }

      setChatMessages([...newMessages, {
        role: 'assistant',
        content: clean,
        actions: buildChatActions(clean, liveEvents),
        pastors: pastorsNamedIn(clean),
      }]);
    } catch (error) {
      console.error('[Joy]', error.message);
      setChatMessages([...newMessages, { role: 'assistant', content: "I'm having trouble connecting right now. Please try again in a moment, or contact the church office. 🙏" }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ---- Helpers ----
  const goSlide = (i) => {
    setHeroIndex(i);
    clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length), 6000);
  };

  const prevSlide = () => goSlide((heroIndex - 1 + HERO_SLIDES.length) % HERO_SLIDES.length);
  const nextSlide = () => goSlide((heroIndex + 1) % HERO_SLIDES.length);

  // Mount the slide on screen and the one after it, and not until the page has
  // finished loading - so a carousel nobody has seen yet never competes with the
  // events for the connection. Keeping one slide ahead in hand means the 1.2s
  // fade always has an image to fade to: the carousel turns every 6 seconds,
  // which is a long head start for one photo.
  useEffect(() => {
    const mountAhead = () => setHeroMounted((prev) => {
      const next = new Set(prev);
      next.add(heroIndex);
      next.add((heroIndex + 1) % HERO_SLIDES.length);
      // Same set back when nothing is new, so this never re-renders for free.
      return next.size === prev.size ? prev : next;
    });
    // Waiting for `load` is only right while the carousel is still sitting on
    // the slide it started on. Somebody who taps a dot during the initial load
    // has asked for that slide now, and must not be shown an empty frame until
    // the rest of the page happens to finish.
    if (document.readyState === 'complete' || heroIndex !== 0) {
      mountAhead();
      return undefined;
    }
    window.addEventListener('load', mountAhead, { once: true });
    return () => window.removeEventListener('load', mountAhead);
  }, [heroIndex]);

  // Arriving from another page on a section link (/#plan-visit from the News
  // navbar): go to that section once the page has drawn, the same smooth way
  // the navbar's own links do. OAuth tokens in the hash are not a section.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || /[=&]/.test(id)) return undefined;
    const t = setTimeout(() => {
      sectionEl(id)?.scrollIntoView({ behavior: 'smooth' });
    }, 450);
    return () => clearTimeout(t);
  }, []);

  const scrollToSection = (id) => {
    sectionEl(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // ---- What the landing page shows, worked out once per render ----
  const verseText = cleanVerse(dailyVerse.verse);
  const nextSvc = nowMs ? nextGathering(nowMs) : null;
  const liveStream = liveStreams[0] || null;
  const nextEvent = newsEvents.find((e) => evtStatus(e.event_date, e.end_date) !== 'ended') || null;
  const shownActivities = activityFilter === 'all'
    ? ACTIVITIES
    : ACTIVITIES.filter((a) => a.group === activityFilter);

  // ============================================
  // RENDER
  // ============================================
  return (
    <>
      {/* ---- NAVBAR: the same one the News pages use ---- */}
      <SiteNavbar current="home" onSection={scrollToSection} live={!!liveStream} />

      {/* ---- HERO: the photo carousel, or one looping clip ---- */}
      <section className="hp-hero">
        {heroVideoSrc ? (
          /* The poster is the carousel's own first photo, which the page is
             already preloading - so the hero is painted before the clip has
             downloaded a byte, and the video fades over it when it can play. */
          <div className="hp-hero-slide hp-hero-videoslide active">
            <HeroVideo src={heroVideoSrc} poster={HERO_SLIDES[0].img} />
          </div>
        ) : HERO_SLIDES.map((slide, i) => (
          <div key={i} className={`hp-hero-slide ${i === heroIndex ? 'active' : ''}`}>
            {heroMounted.has(i) && (
              <img src={slide.img} alt={slide.title} className="hp-hero-slide-img" />
            )}
          </div>
        ))}

        <div className={`hp-hero-overlay ${brand.isPlatform ? 'is-platform' : ''}`}>
          <img src="/assets/LOGO.png" alt={`${brand.full} logo`} className="hp-hero-logo" />
          {brand.isPlatform && <p className="hp-hero-eyebrow">{brand.platformTagline}</p>}
          <h1 className="hp-hero-heading">{brand.name}</h1>
          <p className="hp-hero-sub">{brand.sub}</p>
          {verseText && (
            <div className="hp-hero-verse">
              <p className="hp-hero-verse-text">&ldquo;{verseText}&rdquo;</p>
              <p className="hp-hero-verse-ref">{dailyVerse.reference}</p>
            </div>
          )}
          <div className="hp-hero-buttons">
            {viewer ? (
              <a href="/sunday-service" className="hp-btn-primary">Watch Live</a>
            ) : (
              <a href="/signup" className="hp-btn-primary">Join Our Family</a>
            )}
            <a href="#plan-visit" className="hp-btn-outline" onClick={(e) => { e.preventDefault(); scrollToSection('plan-visit'); }}>
              Plan Your Visit
            </a>
          </div>

          {/* Joy, in the one place every visitor looks. A question typed here
              opens the chat with the answer already on its way. */}
          <form
            className="hp-hero-ask"
            onSubmit={(e) => { e.preventDefault(); askJoy(heroAsk); }}
            role="search"
          >
            <input
              type="text"
              value={heroAsk}
              onChange={(e) => setHeroAsk(e.target.value)}
              placeholder="Ask Joy: “When is Sunday worship?”"
              aria-label="Ask Joy, our AI assistant, a question"
              maxLength={300}
            />
            <button type="submit">Ask Joy</button>
          </form>
        </div>

        {/* Arrows and dots steer the carousel, so a video hero has no use for
            them - five dots under a single clip are five controls that do
            nothing. */}
        {!heroVideoSrc && (
          <>
            <button className="hp-hero-arrow left" onClick={prevSlide} aria-label="Previous photo">
              <i className="fas fa-chevron-left"></i>
            </button>
            <button className="hp-hero-arrow right" onClick={nextSlide} aria-label="Next photo">
              <i className="fas fa-chevron-right"></i>
            </button>

            <div className="hp-hero-dots">
              {HERO_SLIDES.map((_, i) => (
                <button key={i} className={`hp-hero-dot ${i === heroIndex ? 'active' : ''}`} onClick={() => goSlide(i)} aria-label={`Photo ${i + 1}`} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---- THIS WEEK: the three things a visitor came to find out ---- */}
      {/* When is the next service, is anything live, and what is coming up -
          answered in the first screen below the hero instead of four sections
          further down. */}
      <section id="this-week" className="hp-week" aria-label="This week">
        <div className="hp-week-inner">
          <article className="hp-week-card">
            <span className="hp-week-label">Next Gathering</span>
            {nextSvc ? (
              <>
                <h3>{nextSvc.name}</h3>
                <p className="hp-week-when">{phDayLabel(nextSvc.startMs)}, {nextSvc.time}</p>
                <p className="hp-week-count">Starts {untilLabel(nextSvc.startMs - nowMs)}</p>
              </>
            ) : (
              <>
                <h3>Worship Service</h3>
                <p className="hp-week-when">Every Sunday, 9:00 AM</p>
                <p className="hp-week-count">&nbsp;</p>
              </>
            )}
            <button type="button" className="hp-week-link" onClick={() => scrollToSection('plan-visit')}>
              All service times
            </button>
          </article>

          <article className={`hp-week-card ${liveStream ? 'is-live' : ''}`}>
            <span className="hp-week-label">
              {liveStream ? <><span className="hp-live-dot" aria-hidden="true"></span> Live Now</> : 'Watch Online'}
            </span>
            <h3>{liveStream ? (liveStream.caption || liveStream.title || 'Our service is live') : 'Worship from anywhere'}</h3>
            <p>
              {liveStream
                ? (viewer
                  ? 'Join the service as it happens, and react and comment with the church family.'
                  : 'Join the service as it happens. Sign in with a free account to watch.')
                : (viewer
                  ? 'Services stream on our live page the moment they begin. Missed one? The Online Midweek Service is here on video.'
                  : 'Services stream on our live page the moment they begin, and the Online Midweek Service is on video, for anyone with a free account.')}
            </p>
            {!liveStream ? (
              <a href="/midweek" className="hp-week-link">
                Watch the Midweek Service
              </a>
            ) : viewer ? (
              <a href="/sunday-service" className="hp-week-link">Watch now</a>
            ) : (
              <a href="/login?next=%2Fsunday-service" className="hp-week-link">
                <i className="fas fa-lock" aria-hidden="true"></i> Sign in to watch
              </a>
            )}
          </article>

          <article className="hp-week-card">
            <span className="hp-week-label">Next Event</span>
            {nextEvent ? (
              <>
                <h3>{nextEvent.title}</h3>
                <p className="hp-week-when">
                  {evtDate(nextEvent.event_date)?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  {evtPlaceWord(nextEvent) ? `, ${evtPlaceWord(nextEvent)}` : ''}
                </p>
                <button type="button" className="hp-week-link" onClick={() => setDetailEvent(nextEvent)}>
                  {evtRegOpen(nextEvent) ? 'Details and registration' : 'View details'}
                </button>
              </>
            ) : (
              <>
                <h3>Nothing announced yet</h3>
                <p>New events appear here the moment they are published. Our weekly services are always open to you.</p>
                <button type="button" className="hp-week-link" onClick={() => askJoy('What events are coming up?')}>
                  Ask Joy what&apos;s coming
                </button>
              </>
            )}
          </article>
        </div>
      </section>

      {/* ---- A GUEST'S HOME: their giving, events and services. Guests have
          no dashboard; this is theirs (components/guest/GuestHome). ---- */}
      {viewer && isGuestOnly(viewer) && <GuestHome viewer={viewer} live={!!liveStream} />}

      {/* ---- UPCOMING EVENTS ---- */}
      {/* Only while there is something to show. An empty grid with a "No
          Upcoming Events" card was the first thing under the hero; "This Week"
          above already says so in one line. */}
      {newsEvents.length > 0 && (
      <section id="news" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Upcoming Events</h2>
          <p>Conferences, gatherings and celebrations you can register for online</p>
        </div>

        <div className="hp-invite-grid">
          {newsEvents.map((evt, i) => (
              <button
                type="button"
                className="hp-invite-card hp-animate"
                key={evt.id || i}
                style={{ transitionDelay: `${i * 0.08}s` }}
                onClick={() => setDetailEvent(evt)}
                aria-label={`View details for ${evt.title}`}
              >
                <div className="hp-invite-hero">
                  {evt.image_url
                    ? <img
                        src={eventImageUrl(evt.image_url, 440)}
                        srcSet={eventImageSrcSet(evt.image_url)}
                        sizes={EVENT_IMAGE_SIZES}
                        alt={evt.title}
                        className="hp-invite-hero-img"
                        loading="lazy"
                        decoding="async"
                      />
                    : <span className="hp-invite-hero-ph"><i className="fas fa-calendar-day"></i></span>}

                  <span className="hp-invite-pill">
                    <span>Upcoming{evtPlaceWord(evt) ? <> <b>{evtPlaceWord(evt)}</b></> : null} Event</span>
                  </span>

                </div>

                {/* At rest only the title shows over the artwork; the rest slides up
                    on hover, so the poster is never covered until someone is actually
                    looking at this card. Anchored to the card so it rides the card's
                    bottom edge rather than the poster box's. */}
                <span className="hp-invite-scrim"></span>
                <span className="hp-invite-info">
                  <span className="hp-invite-name">{evt.title}</span>
                  {/* The one line that stays in frame at rest: when, and where in
                      the broadest sense - the two things somebody scanning the grid
                      is deciding on. The full venue waits for the hover. */}
                  <span className="hp-invite-key">
                    {evt.event_date && (
                      <span className="hp-invite-line">
                        {evtDate(evt.event_date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    {evtPlaceWord(evt) && (
                      <span className="hp-invite-line">
                        {evtPlaceWord(evt)}
                      </span>
                    )}
                  </span>
                  {(evt.location || evt.loc_city) && (
                    <span className="hp-invite-line hp-invite-venue">
                      {[evt.location, evt.loc_city].filter(Boolean).join(', ')}
                    </span>
                  )}
                  <span className="hp-invite-cta">View Details</span>
                </span>
              </button>
          ))}
        </div>
      </section>
      )}

      {/* ---- CHURCH NEWS: one story large (a featured one first), the next
          three beside it, and the way to all the news ---- */}
      {latestNews.length > 0 && (
        <section id="latest-news" className="hp-section hp-newsfeat" aria-label="Church News">
          <div className="hp-newsfeat-inner">
            <div className="hp-newsfeat-head">
              <div>
                <span className="hp-newsfeat-eyebrow">Church News</span>
                <h2>Stories from our church family</h2>
                <p>What God is doing among us: outreach, celebrations, testimonies and announcements.</p>
              </div>
              <a href="/news" className="hp-newsfeat-all">See all news <i className="fas fa-arrow-right" aria-hidden="true"></i></a>
            </div>

            <div className={`hp-newsfeat-grid ${latestNews.length === 1 ? 'solo' : ''}`}>
              {(() => {
                const [lead, ...others] = latestNews;
                return (
                  <>
                    <a href={`/news/${lead.slug}`} className="hp-newsfeat-lead">
                      <span className="hp-newsfeat-img">
                        {lead.featured_image_url
                          ? <img src={newsImage(lead.featured_image_url, 1100)} srcSet={[640, 900, 1100, 1400].map((w) => `${newsImage(lead.featured_image_url, w)} ${w}w`).join(', ')} sizes="(max-width: 900px) 92vw, 720px" alt="" loading="lazy" decoding="async" />
                          : <span className="hp-newsfeat-noimg">{lead.category}</span>}
                      </span>
                      <span className="hp-newsfeat-shade" aria-hidden="true" />
                      <span className="hp-newsfeat-tags">
                        {lead.is_featured && <span className="hp-newsfeat-pill"><i className="fas fa-star" aria-hidden="true"></i> Featured</span>}
                        <span className="hp-newsfeat-cat">{lead.category}</span>
                      </span>
                      <span className="hp-newsfeat-body">
                        <span className="hp-newsfeat-date">{newsDate(lead.published_at)}</span>
                        <strong>{lead.title}</strong>
                        {lead.summary && <span className="hp-newsfeat-sum">{lead.summary}</span>}
                        <span className="hp-newsfeat-read">Read story <i className="fas fa-arrow-right" aria-hidden="true"></i></span>
                      </span>
                    </a>
                    {others.length > 0 && (
                      <div className="hp-newsfeat-side">
                        {others.map((a) => (
                          <a key={a.id} href={`/news/${a.slug}`} className="hp-newsfeat-item">
                            <span className="hp-newsfeat-thumb">
                              {a.featured_image_url
                                ? <img src={newsImage(a.featured_image_url, 320)} alt="" loading="lazy" decoding="async" />
                                : <span className="hp-newsfeat-noimg">{a.category}</span>}
                            </span>
                            <span className="hp-newsfeat-text">
                              <span className="hp-newsfeat-kicker">
                                {a.is_featured && <i className="fas fa-star" aria-label="Featured"></i>}
                                {a.category} · {newsDate(a.published_at)}
                              </span>
                              <strong>{a.title}</strong>
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {/* ---- PLAN YOUR VISIT (service times + what to expect) ---- */}
      <div className="hp-section-dark">
        <section id="plan-visit" className="hp-section">
          <span id="services" className="hp-anchor" aria-hidden="true"></span>
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Plan Your First Visit</h2>
            <p>New here? We would love to meet you. Here is when we gather and what to expect.</p>
          </div>

          <div className="hp-visit-grid">
            <div className="hp-visit-panel hp-animate">
              <h3>Weekly Gatherings</h3>
              <ul className="hp-visit-times">
                {SERVICE_TIMES.map((s) => {
                  const isNext = nextSvc?.dow === s.dow;
                  return (
                    <li key={s.day} className={isNext ? 'is-next' : ''}>
                      <span className="hp-visit-day">{s.day}</span>
                      <span className="hp-visit-name">
                        {s.name}
                        {isNext && <em>Next</em>}
                      </span>
                      <span className="hp-visit-at">{s.time}</span>
                    </li>
                  );
                })}
                <li>
                  <span className="hp-visit-day">Wednesday</span>
                  <span className="hp-visit-name">Online Midweek Service</span>
                  <a href="/midweek" className="hp-visit-at hp-visit-watch" title="Watch the Midweek Service on video">
                    <i className="fas fa-circle-play" aria-hidden="true"></i> Watch
                  </a>
                </li>
              </ul>
              <p className="hp-visit-tz">All times are Philippine time (GMT+8).</p>
            </div>

            <div className="hp-visit-panel hp-animate">
              <h3>What to Expect</h3>
              <ol className="hp-visit-steps">
                {VISIT_STEPS.map((step, i) => (
                  <li key={step.title}>
                    <span className="hp-visit-step-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="hp-visit-actions">
                <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="hp-btn-solid">Get Directions</a>
                <button type="button" className="hp-btn-soft" onClick={() => askJoy('I am planning my first visit. What should I know?')}>
                  Ask Joy a Question
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---- WELCOME / ABOUT + OUR PASTORS ---- */}
      <section id="about" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Welcome Home</h2>
          <p>A community of believers passionate about God&apos;s Word, worship, and reaching the nations</p>
        </div>

        <div className="hp-welcome-grid hp-animate">
          <div className="hp-welcome-img-wrapper">
            <img src="/assets/worship-service.jpg" alt="The church family in worship" loading="lazy" decoding="async" />
          </div>

          <div className="hp-welcome-text">
            <h3>Bringing the Joy of the Lord to Every Nation</h3>
            <p>
              {brand.church} is a vibrant, Spirit-filled community committed to
              spreading the gospel of Jesus Christ. Under the leadership of our Senior
              Pastors, Dr. Weldon and Dr. Dorothy Pior, we are a family that worships,
              grows, and serves together.
            </p>
            {brand.isPlatform ? (
              <p>
                {brand.platform} is the church&apos;s online home, where members register
                for events, follow live services, serve in ministries and get answers from
                Joy, our AI assistant, any time of day.
              </p>
            ) : (
              <p>
                Whether you&apos;re seeking a church home, looking for fellowship, or simply
                curious about the Christian faith, you are welcome here. Come experience
                the love of God in an atmosphere of praise and genuine community.
              </p>
            )}

            <ul className="hp-welcome-points">
              <li>Bible-centered teaching</li>
              <li>Spirit-filled worship</li>
              <li>Community outreach</li>
              <li>Youth and family ministry</li>
            </ul>
          </div>
        </div>

        {/* Only the pastors with an account marked for the website. */}
        <div id="pastors" className="hp-leaders">
          {pastors.length > 0 && (
            <>
              <div className="hp-subhead hp-animate">
                <h3>Our Pastors</h3>
                <p>The leaders shepherding our church family</p>
              </div>
              <div className="hp-pastors-grid hp-animate">
                {pastors.map((p) => (
                  <div className="hp-pastor-card" key={p.id || p.name}>
                    <div className="hp-pastor-photo-wrapper">
                      <img src={p.photo || '/assets/LOGO.png'} alt={p.name} loading="lazy" decoding="async" />
                    </div>
                    <h4>{p.name}</h4>
                    <div className="hp-pastor-role">{p.title}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---- FIND YOUR PLACE: ministries + activities ---- */}
      <div className="hp-section-dark">
        <section id="ministries" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Find Your Place</h2>
            <p>There is room for everyone to belong, grow and serve. Explore our ministries and the ways we gather.</p>
          </div>

          <div className="hp-ministry-grid hp-animate">
            {MINISTRIES.map((m) => (
              <a key={m.name} href="/signup" className="hp-ministry-card">
                <strong>{m.name}</strong>
                <p>{m.desc}</p>
                <span className="hp-ministry-cta">Get involved</span>
              </a>
            ))}
          </div>

          <div id="activities" className="hp-activities-head hp-animate">
            <div className="hp-subhead">
              <h3>Church Activities</h3>
              <p>Weekly gatherings, special events and training through the year</p>
            </div>
            <div className="hp-filter" role="tablist" aria-label="Filter activities">
              {ACTIVITY_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={activityFilter === f.key}
                  className={`hp-filter-chip ${activityFilter === f.key ? 'active' : ''}`}
                  onClick={() => setActivityFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Keyed by the filter so the cards play their entrance again when the
              set changes - and not tied to the scroll reveal, which a re-render
              would undo by rewriting the class list. */}
          <div className="hp-activities-grid" key={activityFilter}>
            {shownActivities.map((a, i) => (
              <div className="hp-activity-card hp-pop" key={a.title} style={{ animationDelay: `${i * 0.06}s` }}>
                <div className="hp-activity-img-wrapper">
                  <img src={a.photo} alt={a.title} className="hp-activity-img" loading="lazy" decoding="async" />
                </div>
                <div className="hp-activity-body">
                  <span className="hp-activity-freq">{a.badge}</span>
                  <h4>{a.title}</h4>
                  <p>{a.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- ISOM ---- */}
      {/* The school's own content (subtitle, points, start date, photos) is
          edited by a Super Admin under ISOM Management; this only lays it out. */}
      <section id="isom" className="hp-isom">
        <div className="hp-isom-inner">
          <div className="hp-isom-copy hp-animate">
            <div className="hp-isom-mark">
              <img src="/assets/ISOM_Logo.png" alt="ISOM logo" loading="lazy" decoding="async" />
              <span>Now Enrolling</span>
            </div>
            <h2 className="hp-isom-heading">International School of Ministries</h2>
            <p className="hp-isom-tagline">Raising kingdom leaders. Impacting nations.</p>
            <p className="hp-isom-lead">{isomData.subtitle}</p>

            <ul className="hp-isom-points">
              {isomData.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>

            <div className="hp-isom-foot">
              <div className="hp-isom-date">
                <span>Classes begin</span>
                <strong>{isomData.class_start_date}</strong>
              </div>
              <div className="hp-isom-cta">
                <button type="button" className="hp-isom-primary" onClick={openIsomInquire}>
                  Inquire or Enroll
                </button>
                <a href="/isom" className="hp-isom-secondary">Learn more about ISOM</a>
              </div>
            </div>
          </div>

          <figure className="hp-isom-photo hp-animate">
            {isomData.slides.map((slide, i) => (
              <img
                key={i}
                src={slide.url}
                alt={`ISOM class photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                className={`hp-isom-slide ${i === isomIndex ? 'active' : ''}`}
              />
            ))}
            {isomData.slides.length > 1 && (
              <div className="hp-isom-dots">
                {isomData.slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`hp-isom-dot ${i === isomIndex ? 'active' : ''}`}
                    aria-label={`Show photo ${i + 1}`}
                    onClick={() => setIsomIndex(i)}
                  />
                ))}
              </div>
            )}
          </figure>
        </div>
      </section>

      {/* ---- GIVE ---- */}
      {/* The newest donation drive: its jar of hearts, its details, its photos
          and Donate (components/giving/GiveShowcase). Left out while no drive
          is open. Tithes and offerings are on the Sunday Service page. Still
          no account numbers here - a church page that prints bank details is
          the page scammers copy; the accounts are shown in the giving window,
          step by step, from Mode of Payment. */}
      <GiveShowcase />

      {/* ---- MAGIC LINK: looking the event up ---- */}
      {/* A shared link opens the page, then has to find the event before the
          form can come up. That gap is covered rather than left looking like
          nothing happened. */}
      {linkResolving && (
        <div className="hp-link-loading" role="status" aria-live="polite">
          <span className="hp-link-spinner" aria-hidden="true"></span>
          <span>Opening your registration&hellip;</span>
        </div>
      )}

      {/* A link whose event has been renamed, unpublished or taken down. */}
      {linkMiss && (
        <div className="hp-link-miss" role="alert">
          <i className="fas fa-link-slash"></i>
          <div>
            <strong>That registration link isn&apos;t available.</strong>
            <span>The event may have been renamed or closed. Here&apos;s everything coming up.</span>
          </div>
          <button type="button" onClick={() => setLinkMiss('')} aria-label="Dismiss"><i className="fas fa-times"></i></button>
        </div>
      )}

      {/* ---- HOW DO YOU WANT TO REGISTER? ---- */}
      {regChoiceEvent && (
        <div className="hp-evt-overlay hp-reg-overlay" onClick={closeRegChoice}>
          <div className="hp-reg-choice" onClick={(e) => e.stopPropagation()}>
            <button className="hp-evt-close" onClick={closeRegChoice} aria-label="Close"><i className="fas fa-times"></i></button>
            <h3>{evtRegionLabel(regChoiceEvent)} &mdash; {regChoiceEvent.title}</h3>

            {/* Screen 1: with an account, or without one. */}
            {regChoiceScreen === 'how' && (
              <>
                <p className="hp-reg-choice-sub">How would you like to continue?</p>

                <button type="button" className="hp-reg-option" onClick={() => goToSignupForEvent(regChoiceEvent)}>
                  <span className="hp-reg-option-icon"><i className="fas fa-user-plus"></i></span>
                  <span className="hp-reg-option-text">
                    <strong>Create an Account <em>(recommended)</em></strong>
                    <small>You get your own account where you can see your payments, your QR code for check-in, and every event you have joined &mdash; all in one place.</small>
                  </span>
                  <i className="fas fa-chevron-right"></i>
                </button>

                {/* An event limited to specific roles can only be joined by a member, so
                    guest registration is not offered - the server would reject it. */}
                {(regChoiceEvent.allowed_roles && regChoiceEvent.allowed_roles.length > 0) ? (
                  <p className="hp-reg-choice-note">
                    <i className="fas fa-lock"></i> This event is for {regChoiceEvent.allowed_roles.join(', ')} only, so an account is required.
                  </p>
                ) : (
                  <button type="button" className="hp-reg-option" onClick={() => setRegChoiceScreen('who')}>
                    <span className="hp-reg-option-icon alt"><i className="fas fa-bolt"></i></span>
                    <span className="hp-reg-option-text">
                      <strong>Register Now</strong>
                      <small>No account needed. Just fill in the form for this event and you are done.</small>
                    </span>
                    <i className="fas fa-chevron-right"></i>
                  </button>
                )}
              </>
            )}

            {/* Screen 2: registering yourself, or a whole group at once. */}
            {regChoiceScreen === 'who' && (
              <>
                <p className="hp-reg-choice-sub">Who are you registering?</p>

                <button type="button" className="hp-reg-option" onClick={() => openGuestRegistration(regChoiceEvent, 'individual')}>
                  <span className="hp-reg-option-icon"><i className="fas fa-user"></i></span>
                  <span className="hp-reg-option-text">
                    <strong>Individual Registration</strong>
                    <small>Only 1 person will be registered. Fill in your own details and pay for one slot.</small>
                  </span>
                  <i className="fas fa-chevron-right"></i>
                </button>

                <button type="button" className="hp-reg-option" onClick={() => openGuestRegistration(regChoiceEvent, 'bulk')}>
                  <span className="hp-reg-option-icon alt"><i className="fas fa-user-group"></i></span>
                  <span className="hp-reg-option-text">
                    <strong>Bulk Registration</strong>
                    <small>Many people will be registered at once. Add each person&apos;s name in one form and pay for all of them together.</small>
                  </span>
                  <i className="fas fa-chevron-right"></i>
                </button>

                {/* Only offered when there is a previous screen - the account
                    question is skipped for an event anyone can join. */}
                {regNeedsAccount(regChoiceEvent) && (
                  <button type="button" className="hp-reg-choice-back" onClick={() => setRegChoiceScreen('how')}>
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- GUEST REGISTRATION ---- */}
      {guestRegEvent && (
        <div className="hp-evt-overlay hp-reg-overlay" onClick={requestCloseGuestRegistration}>
          <div className="hp-isom-inquire-modal" onClick={(e) => e.stopPropagation()}>
            {guestRegResult?.ok ? (
              <div className="hp-reg-done">
                <div className="hp-reg-done-check"><i className="fas fa-check"></i></div>
                <h3>{isBulk
                  ? `${fullRoster().length} ${fullRoster().length === 1 ? 'person is' : 'people are'} registered!`
                  : `Thank you${guestRegForm.firstName ? `, ${guestRegForm.firstName.trim()}` : ''}!`}</h3>
                <p className="hp-reg-done-see">
                  See you on {evtDate(guestRegEvent.event_date)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                </p>

                <div className="hp-reg-done-card">
                  <span className="hp-reg-done-event">{guestRegEvent.title}</span>
                  <span className="hp-reg-done-where">
                    <i className="fas fa-location-dot"></i>
                    {[guestRegEvent.location, guestRegEvent.loc_city].filter(Boolean).join(', ') || 'Venue to be announced'}
                  </span>
                </div>

                <p className="hp-reg-done-note">
                  <i className="fas fa-circle-info"></i> {guestRegResult.message}
                </p>

                {/* Registering is not the end of it - a name is spelled wrong, an
                    extra needs changing, somebody can no longer come. A tel:
                    link opens the dialler with the number already in it, so the
                    fix is one tap away rather than a hunt for a contact page. */}
                {guestRegEvent.contact_number && (
                  <p className="hp-reg-done-contact">
                    If anything about your details changes,{' '}
                    <a href={`tel:${String(guestRegEvent.contact_number).replace(/[^\d+]/g, '')}`}>
                      <i className="fas fa-phone"></i> Contact Us
                    </a>
                    {' '}&mdash; {guestRegEvent.contact_number}
                    {guestRegEvent.contact_name && ` (${guestRegEvent.contact_name})`}
                  </p>
                )}

                {/* Only worth offering where a tap actually lands in a calendar app. */}
                <button type="button" className="hp-reg-cal" onClick={() => addEventToCalendar(guestRegEvent)}>
                  <i className="fas fa-calendar-plus"></i> Add to Calendar
                </button>

                <button type="button" className="hp-isom-btn hp-modal-btn" onClick={closeGuestRegistration}>Done</button>
              </div>
            ) : (
              <>
                {/* Title, stepper and close stay put; only the step content scrolls. */}
                <div className="hp-reg-top">
                  <button className="hp-evt-close hp-reg-close" onClick={requestCloseGuestRegistration} aria-label="Close"><i className="fas fa-times"></i></button>
                  <div className="hp-isom-inquire-head">
                    <div>
                      <h3>{evtRegionLabel(guestRegEvent)} &mdash; {guestRegEvent.title}</h3>
                      {/* which of the two guest flows this is, so nobody wonders why
                          the form is asking for a list of names. */}
                      <span className={`hp-reg-mode ${isBulk ? 'bulk' : ''}`}>
                        <i className={`fas ${isBulk ? 'fa-user-group' : 'fa-user'}`}></i>
                        {isBulk ? 'Bulk Registration' : 'Individual Registration'}
                      </span>
                    </div>
                  </div>
                  <div className="hp-reg-steps">
                    {guestStepLabels.map((label, i) => (
                      <span className="hp-reg-step-wrap" key={label}>
                        {i > 0 && <span className="hp-reg-step-line"></span>}
                        <button
                          type="button"
                          className={`hp-reg-step ${guestRegStep === i ? 'on' : ''} ${guestRegStep > i ? 'done' : ''}`}
                          onClick={() => goToGuestStep(i)}
                          disabled={guestRegSubmitting || (i > guestRegStep && !guestStepsValidUpTo(i))}
                        >
                          <b>{guestRegStep > i ? <i className="fas fa-check"></i> : i + 1}</b> {label}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="hp-isom-inquire-form">

                  {guestRegStep === 0 && (
                    <>
                      {/* A group is held by one person: their details, their word
                          that they are true, then the list of who is coming. */}
                      {isBulk && (
                        <div className="hp-rep-intro">
                          <div className="hp-rep-intro-head"><i className="fas fa-id-card"></i> Representative Details</div>
                          <p>
                            You are the one holding this registration for your group, so please
                            make sure to <strong>input your legit information</strong> &mdash; this is
                            where we call or message about the payment, the slots, and any change
                            to the schedule.
                          </p>
                        </div>
                      )}

                      {(
                        <div className="hp-isom-inquire-row">
                          <div className="hp-form-group">
                            <label>First Name *</label>
                            <input type="text" className={`hp-form-control ${guestFieldErrors.firstName ? 'invalid' : ''}`} value={guestRegForm.firstName} onChange={(e) => { setGuestRegForm({ ...guestRegForm, firstName: e.target.value }); clearGuestFieldError('firstName'); }} placeholder="Juan" />
                            {guestFieldErrors.firstName && <small className="hp-field-error">{guestFieldErrors.firstName}</small>}
                          </div>
                          <div className="hp-form-group">
                            <label>Last Name *</label>
                            <input type="text" className={`hp-form-control ${guestFieldErrors.lastName ? 'invalid' : ''}`} value={guestRegForm.lastName} onChange={(e) => { setGuestRegForm({ ...guestRegForm, lastName: e.target.value }); clearGuestFieldError('lastName'); }} placeholder="Dela Cruz" />
                            {guestFieldErrors.lastName && <small className="hp-field-error">{guestFieldErrors.lastName}</small>}
                          </div>
                        </div>
                      )}

                      {/* Traced against this event's existing registrations while
                          they type, so a repeat sign-up is caught before payment. */}
                      {isBulk && repMatch && (
                        <div className={`hp-dup-known ${repVerified ? '' : 'waiting'}`}>
                          <div className="hp-dup-known-head">
                            <i className={`fas ${repVerified ? 'fa-circle-check' : 'fa-hourglass-half'}`}></i>
                            <span>
                              <strong>{`${guestRegForm.firstName.trim()} ${guestRegForm.lastName.trim()}`}</strong>
                              <span className={`hp-status-chip ${statusChip(repMatch.status).cls}`}>{statusChip(repMatch.status).label}</span>
                              <br />You are already registered for this event.
                            </span>
                          </div>
                          {repVerified ? (
                            <>
                              <p>Want to use the information from that registration? Your church, pastor and contact number will be filled in for you.</p>
                              {repUsedSaved ? (
                                <span className="hp-dup-known-done"><i className="fas fa-check"></i> Your saved details are in.</span>
                              ) : (
                                <button type="button" className="hp-dup-known-btn" onClick={useSavedRepDetails}>
                                  <i className="fas fa-wand-magic-sparkles"></i> Use my information
                                </button>
                              )}
                            </>
                          ) : (
                            /* Not verified yet: it could still be rejected, so its
                               details are not offered as something to build on. */
                            <>
                              <p className="hp-dup-known-wait">
                                <i className="fas fa-clock"></i> That registration is still waiting for an admin to verify the
                                payment, so this name cannot be used to hold a group booking yet.
                                Please use someone whose registration is verified, or who is not registered yet.
                              </p>
                              <button type="button" className="hp-dup-known-btn danger" onClick={clearRepDetails}>
                                <i className="fas fa-eraser"></i> Clear and use another name
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {!isBulk && isDuplicateName(guestRegForm.firstName, guestRegForm.lastName) && (
                        <p className="hp-dup-warn">
                          <i className="fas fa-triangle-exclamation"></i>
                          <span>
                            <strong>{`${guestRegForm.firstName.trim()} ${guestRegForm.lastName.trim()}`}</strong> is already registered for this event.
                            Registering again will create a second slot.
                          </span>
                        </p>
                      )}


                      {/* Which age group. It sits above the church block on
                          purpose: for a child the rest of this step is a
                          different set of questions, and the answer has to come
                          before the questions it changes. */}
                      {!isBulk && (
                        <AgeGroupPicker
                          event={guestRegEvent}
                          value={guestRegForm.priceTier}
                          onChange={(label) => {
                            setGuestRegForm((f) => ({ ...f, priceTier: label }));
                            // Leaving the children's group means the guardian is no
                            // longer part of this registration.
                            if (!isNameOnlyTier(findTier(guestRegEvent, label))) setGuestGuardian(null);
                            clearGuestFieldError('guardian');
                          }}
                          title="Age Group"
                        />
                      )}

                      {/* A group booking is held by an adult - the one we ring
                          about the payment. The children come later, on the
                          roster, where each of them picks their own group. */}
                      {isBulk && representativeTiers(guestRegEvent).length > 0 && (
                        <p className="hp-rep-tier">
                          <i className="fas fa-user-shield"></i>
                          <span>
                            You are registered as <strong>{guestRegForm.priceTier || representativeTiers(guestRegEvent)[0].label}</strong>
                            {' '}&mdash; &#8369;{guestBaseAmount(guestRegEvent)}.
                            {nameOnlyTiers(guestRegEvent).length > 0
                              ? ' Children go on the next step, where each person picks their own age group.'
                              : ' Everyone else goes on the next step, where each person picks their own age group.'}
                          </span>
                        </p>
                      )}

                      {/* A child is a name and a guardian. Their church, pastor
                          and contact number are the guardian's - asked once, on
                          the registration the child is being added to. */}
                      {isChildReg ? (
                        <>
                          <GuardianPicker
                            eventId={guestRegEvent.id}
                            value={guestGuardian}
                            onChange={(g) => { setGuestGuardian(g); clearGuestFieldError('guardian'); }}
                            invalid={!!guestFieldErrors.guardian}
                          />
                          {guestFieldErrors.guardian && <small className="hp-field-error">{guestFieldErrors.guardian}</small>}
                        </>
                      ) : (
                      <>
                      {/* The full church name, spelled the same way every time - past
                          registrations are offered as you type, with how many people
                          already came from each. */}
                      <div className="hp-form-group hp-church-field">
                        <label>Church Name * <em>(complete name)</em></label>
                        <input
                          type="text"
                          className={`hp-form-control ${guestFieldErrors.churchName ? 'invalid' : ''}`}
                          value={guestRegForm.churchName}
                          onChange={(e) => { setGuestRegForm({ ...guestRegForm, churchName: e.target.value }); setChurchOpen(true); clearGuestFieldError('churchName'); }}
                          onFocus={() => setChurchOpen(true)}
                          onBlur={() => { settleChurchName(); setTimeout(() => setChurchOpen(false), 160); }}
                          placeholder="e.g. Joyful Sound Church - International"
                          autoComplete="off"
                        />
                        {churchOpen && churchChoices.length > 0 && (
                          <ul className="hp-church-list">
                            {churchChoices.map((c) => (
                              <li key={c.name}>
                                <button type="button" className={c.isOther ? 'hp-church-other' : ''} onMouseDown={() => { setGuestRegForm((f) => ({ ...f, churchName: c.name })); setChurchOpen(false); clearGuestFieldError('churchName'); }}>
                                  <span>
                                    {c.name}
                                    {c.isOther && <small>Not from a church, or none to give</small>}
                                  </span>
                                  {c.count > 0 && <em>{c.count} registered</em>}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {guestFieldErrors.churchName
                          ? <small className="hp-field-error">{guestFieldErrors.churchName}</small>
                          : <small className="hp-field-hint">Write it in full, e.g. &quot;Joyful Sound Church - International&quot;. No church to give? Choose <strong>{OTHER_CHURCH}</strong>.</small>}
                      </div>

                      <div className="hp-isom-inquire-row">
                        <div className="hp-form-group">
                          <label>Church Pastor *</label>
                          {/* "Ptr." is fixed, so only the name is typed */}
                          <PastorInput
                            variant="hp"
                            eventId={guestRegEvent?.id}
                            churchName={guestRegForm.churchName}
                            value={guestRegForm.churchPastor}
                            onChange={(v) => { setGuestRegForm((f) => ({ ...f, churchPastor: v })); clearGuestFieldError('churchPastor'); }}
                            invalid={!!guestFieldErrors.churchPastor}
                          />
                          {guestFieldErrors.churchPastor && <small className="hp-field-error">{guestFieldErrors.churchPastor}</small>}
                        </div>
                        <div className="hp-form-group">
                          <label>Contact Number *</label>
                          <input
                            type="tel"
                            inputMode="numeric"
                            className={`hp-form-control ${guestFieldErrors.mobile || (guestRegForm.mobile && !isValidPhMobile(guestRegForm.mobile)) ? 'invalid' : ''}`}
                            value={guestRegForm.mobile}
                            onChange={(e) => { setGuestRegForm({ ...guestRegForm, mobile: onlyDigits(e.target.value) }); clearGuestFieldError('mobile'); }}
                            placeholder="09XXXXXXXXX"
                            maxLength={11}
                          />
                          {(guestFieldErrors.mobile || (guestRegForm.mobile && !isValidPhMobile(guestRegForm.mobile))) && (
                            <small className="hp-field-error">{guestFieldErrors.mobile || 'Philippine mobile number: 11 digits starting with 09.'}</small>
                          )}
                        </div>
                      </div>
                      </>
                      )}

                      {/* Paid extras belong here - they decide the total shown on step 2. */}
                      {!isBulk && (guestRegEvent.event_addons || []).length > 0 && (
                        <div className="hp-reg-addons">
                          <div className="hp-reg-addons-head"><i className="fas fa-circle-plus"></i> Optional Extras</div>
                          {/* The question and its price are all the box shows - the
                              explanation lives behind View Details, under the box. */}
                          {guestRegEvent.event_addons.map((a) => (
                            <div className="hp-reg-addon-item" key={a.id}>
                              <label className={`hp-reg-addon ${guestRegAddonIds.includes(a.id) ? 'on' : ''} ${a.is_required ? 'locked' : ''}`}>
                                <input type="checkbox" checked={guestRegAddonIds.includes(a.id)} disabled={a.is_required} onChange={() => toggleGuestAddon(a)} />
                                <span className="hp-reg-addon-text">
                                  <strong>{a.question}</strong>
                                  {a.is_required && <small>Required &mdash; included for everyone.</small>}
                                </span>
                                <span className="hp-reg-addon-fee">+&#8369;{addonFeeFor(a, findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent))}</span>
                              </label>
                              {(a.details || a.description) && (
                                <button type="button" className="hp-addon-details-btn" onClick={() => setAddonDetail(a)}>
                                  <i className="fas fa-circle-info"></i> View Details
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {eventIsFree(guestRegEvent) && (
                        <p className="hp-reg-free"><i className="fas fa-gift"></i> Free &mdash; you&apos;ll be registered instantly.</p>
                      )}

                      {/* The representative usually attends too - when they do they
                          become the first line of the group, priced like anyone else. */}
                      {isBulk && (
                        <div className="hp-rep-join">
                          <div className="hp-rep-join-head">
                            <i className="fas fa-suitcase-rolling"></i>
                            <span>
                              <strong>Your Extras</strong>
                              <small>
                                {repLocked
                                  ? 'What your existing registration already covers. Anything not yet availed can still be added below.'
                                  : 'You are the first person in your group - tick anything you need for yourself.'}
                              </small>
                            </span>
                          </div>

                          {(guestRegEvent.event_addons || []).length > 0 ? (
                            <div className="hp-bulk-addons hp-rep-addons">
                              {guestRegEvent.event_addons.map((x) => {
                                // Already availed on an earlier registration: shown
                                // ticked and greyed out. Not yet availed: still open,
                                // so it can be added and paid for with this booking.
                                const settled = repLockedAddonIds.includes(x.id);
                                const on = settled || repAddonIds.includes(x.id);
                                const frozen = settled || x.is_required;
                                return (
                                  <label className={`hp-bulk-addon ${on ? 'on' : ''} ${frozen ? 'locked' : ''}`} key={x.id}>
                                    <input type="checkbox" checked={on} disabled={frozen} onChange={() => toggleRepAddon(x)} />
                                    <span>{x.question}</span>
                                    <em>+&#8369;{addonFeeFor(x, findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent))}</em>
                                    {settled && <i className="fas fa-lock" title="Already availed on your existing registration"></i>}
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <small className="hp-rep-locked-note">This event has no optional extras.</small>
                          )}

                          {repLocked && (
                            <small className="hp-rep-locked-note">
                              {repLockedAddonIds.length > 0
                                ? <><i className="fas fa-lock"></i> The ticked ones came from your existing registration and cannot be changed here.</>
                                : <><i className="fas fa-circle-info"></i> You have not availed any extras yet - tick one to add it to this payment.</>}
                            </small>
                          )}
                        </div>
                      )}

                      {isBulk && (
                        <label className={`hp-rep-agree ${guestFieldErrors.agree ? 'invalid' : ''} ${repAgreed ? 'on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={repAgreed}
                            onChange={(e) => { setRepAgreed(e.target.checked); clearGuestFieldError('agree'); }}
                          />
                          <span>
                            I confirm that the information above is <strong>true and correct</strong>, and that
                            I am the representative responsible for the people I am registering.
                          </span>
                        </label>
                      )}
                      {guestFieldErrors.agree && <small className="hp-field-error">{guestFieldErrors.agree}</small>}

                      {guestRegResult && !guestRegResult.ok && (
                        <p className="hp-reg-error"><i className="fas fa-circle-exclamation"></i> {guestRegResult.message}</p>
                      )}

                      <div className="hp-reg-actions">
                        <button type="button" className="hp-reg-back" onClick={requestBackToRegType} disabled={guestRegSubmitting}>
                          <i className="fas fa-arrow-left"></i> Change type
                        </button>
                        <button type="button" className="hp-isom-btn" onClick={guestRegNext} disabled={guestRegSubmitting}>
                          <span>{isBulk ? 'Add the People' : 'Review Details'}</span> <i className="fas fa-arrow-right"></i>
                        </button>
                      </div>
                    </>
                  )}

                  {/* ---- Bulk step 2: who the representative is bringing ----
                       One entry form at the top, one row per person in the table
                       below. Editing a row lifts it back into that same form. */}
                  {isBulk && guestRegStep === rosterStep && (
                    <>
                      <div className="hp-bulk-entry">
                        <div className="hp-bulk-entry-head">
                          <span>
                            <i className={`fas ${editingAttendee == null ? 'fa-user-plus' : 'fa-pen'}`}></i>
                            {editingAttendee == null ? ' Add an Attendee' : ` Editing attendee #${editingAttendee + 1}`}
                          </span>
                          {editingAttendee != null && (
                            <button type="button" className="hp-bulk-entry-cancel" onClick={cancelEditAttendee}>Cancel</button>
                          )}
                        </div>

                        <div className="hp-isom-inquire-row">
                          <div className="hp-form-group">
                            <label>First Name *</label>
                            <input
                              type="text"
                              className={`hp-form-control ${draftError && !draft.firstName.trim() ? 'invalid' : ''}`}
                              value={draft.firstName}
                              onChange={(e) => setDraft({ firstName: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAttendee(); } }}
                              placeholder="Juan"
                            />
                          </div>
                          <div className="hp-form-group">
                            <label>Last Name *</label>
                            <input
                              type="text"
                              className={`hp-form-control ${draftError && !draft.lastName.trim() ? 'invalid' : ''}`}
                              value={draft.lastName}
                              onChange={(e) => setDraft({ lastName: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAttendee(); } }}
                              placeholder="Dela Cruz"
                            />
                          </div>
                        </div>

                        {/* Age group is per person too - a family is one payment,
                            not one price. */}
                        <AgeGroupPicker
                          event={guestRegEvent}
                          value={draft.priceTier}
                          onChange={(label) => setDraft({ priceTier: label })}
                          title="Age Group"
                          hint={nameOnlyTiers(guestRegEvent).length > 0 ? 'children are registered under you' : ''}
                        />

                        {/* Extras are per person - only some of a group usually need
                            accommodation, so they are ticked with the name. */}
                        {(guestRegEvent.event_addons || []).length > 0 && (
                          <div className="hp-bulk-addons">
                            {guestRegEvent.event_addons.map((x) => (
                              <label className={`hp-bulk-addon ${draft.addonIds.includes(x.id) ? 'on' : ''} ${x.is_required ? 'locked' : ''}`} key={x.id}>
                                <input type="checkbox" checked={draft.addonIds.includes(x.id)} disabled={x.is_required} onChange={() => toggleDraftAddon(x)} />
                                <span>{x.question}</span>
                                <em>+&#8369;{addonFeeFor(x, findTier(guestRegEvent, draft.priceTier) || defaultTier(guestRegEvent))}</em>
                              </label>
                            ))}
                          </div>
                        )}

                        {/* Already on this event: say who, and where their payment
                            stands, rather than a bare "already registered". */}
                        {draftError === 'already-registered' ? (() => {
                          const info = dupInfoFor(draft.firstName, draft.lastName);
                          // Nothing came back about their payment: still say plainly
                          // that the name is taken rather than show an empty chip.
                          const chip = info ? statusChip(info.status) : null;
                          return (
                            <p className="hp-dup-warn">
                              <i className="fas fa-triangle-exclamation"></i>
                              <span>
                                <b className="hp-dup-name">{`${draft.firstName.trim()} ${draft.lastName.trim()}`}</b>
                                {chip && <span className={`hp-status-chip ${chip.cls}`}>{chip.label}</span>}
                                <br />is already registered for this event, so they cannot be added again.
                              </span>
                            </p>
                          );
                        })() : draftError ? <small className="hp-field-error">{draftError}</small> : null}

                        <button type="button" className="hp-bulk-add" onClick={commitAttendee} disabled={checkingAttendee}>
                          {checkingAttendee ? (
                            <><i className="fas fa-spinner fa-spin"></i> Checking...</>
                          ) : (
                            <>
                              <i className={`fas ${editingAttendee == null ? 'fa-plus' : 'fa-check'}`}></i>
                              {editingAttendee == null ? ' Add Attendee' : ' Save Changes'}
                            </>
                          )}
                        </button>
                      </div>

                      {/* The list so far, priced line by line. */}
                      <div className="hp-bulk-table-wrap">
                        <div className="hp-bulk-head">
                          <span><i className="fas fa-user-group"></i> People You Are Registering</span>
                          <em>{fullRoster().length} {fullRoster().length === 1 ? 'person' : 'people'}</em>
                        </div>

                        {fullRoster().length === 0 && !(repLocked && repTopUpAddons().length > 0) ? (
                          <p className="hp-bulk-empty">
                            <i className="fas fa-inbox"></i>
                            No one added yet. Fill in the name above and tap <strong>Add Attendee</strong>.
                          </p>
                        ) : (
                          <div className="hp-bulk-table-scroll">
                            <table className="hp-bulk-table">
                              <thead>
                                <tr>
                                  <th>Attendee</th>
                                  <th>Registration Fee</th>
                                  <th>Extras</th>
                                  <th aria-label="Actions"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {fullRoster().map((a, i) => {
                                  // the representative's own line is edited back on
                                  // step 1, where their details live
                                  const listIndex = a.isRep ? -1 : i - (repAsAttendee() ? 1 : 0);
                                  return (
                                    <tr key={a.isRep ? 'rep' : listIndex} className={`${editingAttendee === listIndex ? 'editing' : ''} ${guestFieldErrors[`attendee-${listIndex}`] ? 'invalid' : ''}`}>
                                      <td data-label="Attendee">
                                        <span className="hp-bulk-row-name">
                                          <b>{i + 1}.</b> {`${a.firstName} ${a.lastName}`.trim()}
                                          {a.isRep && <em className="hp-bulk-you">You</em>}
                                          {hasPriceTiers(guestRegEvent) && a.priceTier && (
                                            <em className="hp-bulk-tier">{a.priceTier}</em>
                                          )}
                                        </span>
                                        {guestFieldErrors[`attendee-${listIndex}`] && (
                                          <small className="hp-field-error">{guestFieldErrors[`attendee-${listIndex}`]}</small>
                                        )}
                                      </td>
                                      <td data-label="Registration Fee">&#8369;{guestBaseAmount(guestRegEvent, personTier(a))}</td>
                                      <td data-label="Extras">
                                        {attendeeAddons(a).length === 0 ? <span className="hp-bulk-none">&mdash;</span> : (
                                          <>
                                            &#8369;{attendeeExtrasTotal(a)}
                                            <small>{attendeeAddons(a).map((x) => x.question).join(', ')}</small>
                                          </>
                                        )}
                                      </td>
                                      <td data-label="" className="hp-bulk-row-actions">
                                        {a.isRep ? (
                                          <button type="button" onClick={() => setGuestRegStep(0)} title="Edit your details"><i className="fas fa-pen"></i></button>
                                        ) : (
                                          <>
                                            <button type="button" onClick={() => editAttendee(listIndex)} title="Edit"><i className="fas fa-pen"></i></button>
                                            <button type="button" className="danger" onClick={() => removeAttendee(listIndex)} title="Remove"><i className="fas fa-trash"></i></button>
                                          </>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {/* Extras the representative is availing on the slot
                                    they already hold - not a new seat, but money due. */}
                                {repLocked && repTopUpAddons().length > 0 && (
                                  <tr className="hp-bulk-topup">
                                    <td data-label="Attendee">
                                      <span className="hp-bulk-row-name">
                                        {`${guestRegForm.firstName} ${guestRegForm.lastName}`.trim()}
                                        <em className="hp-bulk-you">You</em>
                                      </span>
                                      <small>Already registered &mdash; adding extras only</small>
                                    </td>
                                    <td data-label="Registration Fee"><span className="hp-bulk-none">&mdash;</span></td>
                                    <td data-label="Extras">
                                      &#8369;{repTopUpTotal()}
                                      <small>{repTopUpAddons().map((x) => x.question).join(', ')}</small>
                                    </td>
                                    <td data-label="" className="hp-bulk-row-actions">
                                      <button type="button" onClick={() => setGuestRegStep(0)} title="Edit your extras"><i className="fas fa-pen"></i></button>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <td>Total</td>
                                  <td colSpan={3}>&#8369;{guestTotalAmount(guestRegEvent)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>

                      <p className="hp-bulk-shared-note">
                        <i className="fas fa-circle-info"></i> Everyone here is registered under
                        {` ${guestRegForm.churchName.trim() || 'your church'}`}, with
                        {` ${guestRegForm.firstName.trim() || 'you'}`} as the contact person.
                      </p>

                      {guestRegResult && !guestRegResult.ok && (
                        <p className="hp-reg-error"><i className="fas fa-circle-exclamation"></i> {guestRegResult.message}</p>
                      )}

                      <div className="hp-reg-actions">
                        <button type="button" className="hp-reg-back" onClick={() => setGuestRegStep(0)} disabled={guestRegSubmitting}>
                          <i className="fas fa-arrow-left"></i> Back
                        </button>
                        <button type="button" className="hp-isom-btn" onClick={guestRegNext} disabled={guestRegSubmitting}>
                          <span>Review Details</span> <i className="fas fa-arrow-right"></i>
                        </button>
                      </div>
                    </>
                  )}

                  {/* ---- Step 2: check everything before any money moves ---- */}
                  {guestRegStep === reviewStep && (
                    <>
                      <div className="hp-step-title">Review your details</div>

                      {/* The days being signed up for, right above the summary. */}
                      {evtSessions(guestRegEvent).length > 0 && (
                        <ul className="hp-evt-sessions" style={{ marginBottom: 14 }}>
                          {evtSessions(guestRegEvent).map((d, i) => {
                            const parts = evtSessionParts(d, detailEvent);
                            if (!parts) return null;
                            return (
                              <li key={d.id || i}>
                                <span className="hp-evt-session-day">Day {i + 1}</span>
                                <span className="hp-evt-session-date">{parts.date}</span>
                                <span className="hp-evt-session-time">{parts.time}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <div className="hp-review">
                        {isBulk ? (
                          <>
                            <div className="hp-review-row">
                              <span>Representative</span>
                              <b>{`${guestRegForm.firstName} ${guestRegForm.lastName}`.trim() || '—'}</b>
                            </div>
                            <div className="hp-review-row">
                              <span>Attendees</span>
                              <b>{fullRoster().length} {fullRoster().length === 1 ? 'person' : 'people'}</b>
                            </div>
                          </>
                        ) : (
                          <div className="hp-review-row">
                            <span>Full Name</span>
                            <b>{`${guestRegForm.firstName} ${guestRegForm.lastName}`.trim() || '—'}</b>
                          </div>
                        )}
                        {hasPriceTiers(guestRegEvent) && guestRegForm.priceTier && (
                          <div className="hp-review-row">
                            <span>Age Group</span>
                            <b>{guestRegForm.priceTier}</b>
                          </div>
                        )}
                        {isChildReg && guestGuardian && (
                          <div className="hp-review-row">
                            <span>Parent / Guardian</span>
                            <b>{guestGuardian.name}</b>
                          </div>
                        )}
                        {isChildReg ? (
                          <div className="hp-review-row">
                            <span>Church &amp; Contact</span>
                            <b>{guestGuardian ? `From ${guestGuardian.name}` : '—'}</b>
                          </div>
                        ) : (
                          <>
                            <div className="hp-review-row">
                              <span>Church Name</span>
                              <b>{guestRegForm.churchName.trim() || '—'}</b>
                            </div>
                            <div className="hp-review-row">
                              <span>Church Pastor</span>
                              <b>{guestRegForm.churchPastor.trim() ? `Ptr. ${guestRegForm.churchPastor.trim()}` : '—'}</b>
                            </div>
                            <div className="hp-review-row">
                              <span>Contact Number</span>
                              <b>{guestRegForm.mobile || '—'}</b>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Itemised like a receipt, so the total is never a mystery.
                          A group is itemised person by person for the same reason. */}
                      <div className="hp-receipt">
                        {isBulk && repLocked && repTopUpAddons().length > 0 && (
                          <div className="hp-receipt-person">
                            <div className="hp-receipt-line">
                              <span><b>{`${guestRegForm.firstName} ${guestRegForm.lastName}`.trim()}</b><em className="hp-bulk-you">You</em></span>
                              <b>&#8369;{repTopUpTotal()}</b>
                            </div>
                            <div className="hp-receipt-sub">
                              Already registered &mdash; extras only:{repTopUpAddons().map((x) => ` ${x.question} ₱${addonFeeFor(x, findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent))}`).join(',')}
                            </div>
                          </div>
                        )}
                        {isBulk ? fullRoster().map((a, i) => (
                          <div className="hp-receipt-person" key={i}>
                            <div className="hp-receipt-line">
                              <span>
                                <b>{`${a.firstName} ${a.lastName}`.trim() || `Person ${i + 1}`}</b>
                                {a.isRep && <em className="hp-bulk-you">You</em>}
                                {hasPriceTiers(guestRegEvent) && a.priceTier && <em className="hp-bulk-tier">{a.priceTier}</em>}
                              </span>
                              <b>&#8369;{attendeeAmount(a)}</b>
                            </div>
                            <div className="hp-receipt-sub">
                              Registration &#8369;{guestBaseAmount(guestRegEvent, personTier(a))}
                              {(guestRegEvent.event_addons || [])
                                .filter((x) => a.addonIds.includes(x.id))
                                .map((x) => ` + ${x.question} ₱${addonFeeFor(x, personTier(a))}`)
                                .join('')}
                            </div>
                          </div>
                        )) : (
                          <>
                            <div className="hp-receipt-line">
                              <span>Registration Fee{hasPriceTiers(guestRegEvent) && guestRegForm.priceTier ? ` (${guestRegForm.priceTier})` : ''}</span>
                              <b>&#8369;{guestBaseAmount(guestRegEvent)}</b>
                            </div>
                            {(guestRegEvent.event_addons || []).filter((a) => guestRegAddonIds.includes(a.id)).map((a) => (
                              <div className="hp-receipt-line" key={a.id}>
                                <span>Extras ({a.question})</span>
                                <b>&#8369;{addonFeeFor(a, findTier(guestRegEvent, guestRegForm.priceTier) || defaultTier(guestRegEvent))}</b>
                              </div>
                            ))}
                          </>
                        )}
                        <div className="hp-receipt-total">
                          <span>Total</span>
                          <b>&#8369;{guestTotalAmount(guestRegEvent)}</b>
                        </div>
                      </div>

                      {guestTotalAmount(guestRegEvent) <= 0 && (
                        <p className="hp-reg-free"><i className="fas fa-gift"></i> Free &mdash; you&apos;ll be registered instantly.</p>
                      )}

                      {guestRegResult && !guestRegResult.ok && (
                        <p className="hp-reg-error"><i className="fas fa-circle-exclamation"></i> {guestRegResult.message}</p>
                      )}

                      <div className="hp-reg-actions">
                        <button type="button" className="hp-reg-back" onClick={() => setGuestRegStep(reviewStep - 1)} disabled={guestRegSubmitting}>
                          <i className="fas fa-arrow-left"></i> Edit
                        </button>
                        <button type="button" className="hp-isom-btn" onClick={guestRegNext} disabled={guestRegSubmitting}>
                          {guestTotalAmount(guestRegEvent) > 0 ? (
                            <><span>Continue to Payment</span> <i className="fas fa-arrow-right"></i></>
                          ) : (
                            <><i className={`fas ${guestRegSubmitting ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> <span>{guestRegSubmitting ? 'Submitting…' : 'Register'}</span></>
                          )}
                        </button>
                      </div>
                    </>
                  )}

                  {/* ---- Step 3: pay ---- */}
                  {guestRegStep === payStep && (
                    <>
                      <div className="hp-paytotal">
                        <span>Total Payment</span>
                        <strong>&#8369;{guestTotalAmount(guestRegEvent)}</strong>
                      </div>


                      {/* Nobody can hand over cash for this one, so say it plainly
                          before they arrive expecting to pay at the door. */}
                      {/* Read the CHANNELS first: an event with a saved cash entry
                          takes cash whatever that entry happens to be called, and
                          telling the payer otherwise would contradict the card
                          printed directly underneath this line. The label regex is
                          kept only for events too old to have any saved channel. */}
                      {((guestRegEvent.payment_methods || []).length > 0 || eventChannels(guestRegEvent).length > 0)
                        && !eventTakesCash(eventChannels(guestRegEvent), guestRegEvent.payment_methods) && (
                        <p className="hp-pay-online-only">
                          <i className="fas fa-circle-exclamation"></i>
                          <span><strong>Online payment only.</strong> We do not accept cash for this event &mdash; please pay through the account below and upload your receipt.</span>
                        </p>
                      )}

                      {guestRegEvent.payment_instructions && <p className="hp-reg-instructions">{guestRegEvent.payment_instructions}</p>}

                      {/* Choose where you are paying, and only that account opens
                          up - QR first, then its details, exactly as set in Mode
                          of Payment. */}
                      {eventChannels(guestRegEvent).length > 0 && (() => {
                        const channels = eventChannels(guestRegEvent);
                        const picked = channels.find((c) => c.id === guestPayChannel) || null;
                        return (
                          <div className="hp-pay-picker-wrap">
                            <span className="hp-pay-picker-label">Send your payment to *</span>
                            <div className={`hp-pay-picker ${guestPayPickerOpen ? 'open' : ''}`}>
                              <button
                                type="button"
                                className={`hp-pay-picker-trigger ${guestFieldErrors.paymentMethod ? 'invalid' : ''}`}
                                aria-expanded={guestPayPickerOpen}
                                onClick={() => setGuestPayPickerOpen((v) => !v)}
                              >
                                {picked ? (
                                  <>
                                    <span className={`hp-pay-logo ${isCashChannel(picked) && !picked.logo_url ? 'cash' : ''}`} style={{ background: picked.logo_url ? 'transparent' : (picked.logo_color || '#1e3a8a') }}>
                                      {picked.logo_url
                                        ? <img src={picked.logo_url} alt={picked.name} />
                                        : isCashChannel(picked)
                                          ? <span><i className="fas fa-money-bill-wave"></i></span>
                                          : <span>{channelInitials(picked.name)}</span>}
                                    </span>
                                    <span className="hp-pay-picker-name">
                                      {picked.name}
                                      <span className={`hp-pay-card-type ${picked.category}`}>{channelTypeLabel(picked)}</span>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="hp-pay-picker-ph"><i className="fas fa-hand-pointer"></i></span>
                                    <span className="hp-pay-picker-name empty">Choose where you are paying</span>
                                  </>
                                )}
                                <i className="fas fa-chevron-down hp-pay-picker-caret"></i>
                              </button>
                              {guestPayPickerOpen && (
                                <ul className="hp-pay-picker-menu">
                                  {channels.map((c) => (
                                    <li key={c.id}>
                                      <button
                                        type="button"
                                        className={`hp-pay-picker-option ${guestPayChannel === c.id ? 'on' : ''}`}
                                        onClick={() => {
                                          setGuestPayChannel(c.id);
                                          setGuestPayPickerOpen(false);
                                          // The picker IS the answer to "how did you pay".
                                          const listed = (guestRegEvent.payment_methods || []).find((x) => String(x).toLowerCase() === String(c.name).toLowerCase());
                                          setGuestRegForm((f) => ({ ...f, paymentMethod: listed || c.name }));
                                          clearGuestFieldError('paymentMethod');
                                        }}
                                      >
                                        <span className={`hp-pay-logo ${isCashChannel(c) && !c.logo_url ? 'cash' : ''}`} style={{ background: c.logo_url ? 'transparent' : (c.logo_color || '#1e3a8a') }}>
                                          {c.logo_url
                                            ? <img src={c.logo_url} alt={c.name} />
                                            : isCashChannel(c)
                                              ? <span><i className="fas fa-money-bill-wave"></i></span>
                                              : <span>{channelInitials(c.name)}</span>}
                                        </span>
                                        <span className="hp-pay-picker-name">
                                          {c.name}
                                          <span className={`hp-pay-card-type ${c.category}`}>{channelTypeLabel(c)}</span>
                                        </span>
                                        {guestPayChannel === c.id && <i className="fas fa-check hp-pay-picker-tick"></i>}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            {!picked && (
                              <p className={`hp-pay-picker-hint ${guestFieldErrors.paymentMethod ? 'bad' : ''}`}>
                                <i className="fas fa-circle-info"></i> {guestFieldErrors.paymentMethod || 'Pick a channel to see its QR, account number, and where to enter your reference.'}
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {eventChannels(guestRegEvent)
                        .filter((c) => c.id === guestPayChannel)
                        .map((c) => (
                          <div className="hp-pay-card" key={c.id}>
                            <div className="hp-pay-card-head">
                              <span className={`hp-pay-logo ${isCashChannel(c) && !c.logo_url ? 'cash' : ''}`} style={{ background: c.logo_url ? 'transparent' : (c.logo_color || '#1e3a8a') }}>
                                {c.logo_url
                                  ? <img src={c.logo_url} alt={c.name} />
                                  : isCashChannel(c)
                                    ? <span><i className="fas fa-money-bill-wave"></i></span>
                                    : <span>{channelInitials(c.name)}</span>}
                              </span>
                              <span className="hp-pay-card-name">{c.name}</span>
                              <span className={`hp-pay-card-type ${c.category}`}>
                                {channelTypeLabel(c)}
                              </span>
                            </div>

                            {c.qr_url && (
                              <div className="hp-pay-qr">
                                <img src={c.qr_url} alt={`${c.name} QR code`} />
                                <button type="button" className="hp-pay-qr-dl" onClick={() => downloadQr(c.qr_url, guestRegEvent.title, `${c.name}-qr`)}>
                                  <i className="fas fa-download"></i> Save QR
                                </button>
                              </div>
                            )}

                            {c.account_name && (
                              <div className="hp-pay-line">
                                <span className="hp-pay-line-label">Account Name</span>
                                <span className="hp-pay-line-value">{c.account_name}</span>
                                <button type="button" className="hp-pay-copy" onClick={() => copyToClipboard(c.account_name, `name-${c.id}`)}>
                                  <i className={`fas ${copiedField === `name-${c.id}` ? 'fa-check' : 'fa-copy'}`}></i> {copiedField === `name-${c.id}` ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            )}
                            {c.account_number && (
                              <div className="hp-pay-line">
                                <span className="hp-pay-line-label">{c.category === 'bank' ? 'Account Number' : 'Mobile Number'}</span>
                                {/* cash never reaches here - it has no account_number */}
                                <span className="hp-pay-line-value mono">{c.account_number}</span>
                                <button type="button" className="hp-pay-copy" onClick={() => copyToClipboard(c.account_number, `num-${c.id}`)}>
                                  <i className={`fas ${copiedField === `num-${c.id}` ? 'fa-check' : 'fa-copy'}`}></i> {copiedField === `num-${c.id}` ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            )}
                            {c.notes && <p className={`hp-pay-card-note ${isCashChannel(c) ? 'cash' : ''}`}><i className="fas fa-circle-info"></i> {c.notes}</p>}

                            {/* Cash asks for nothing back: no reference exists yet and
                                there is no receipt to photograph. The payer is told
                                they are done rather than left looking for a field. */}
                            {isCashChannel(c)
                              ? (
                                <p className="hp-pay-cash-done">
                                  <i className="fas fa-money-bill-wave"></i>
                                  <span><strong>Nothing to upload.</strong> Pay in person as described above &mdash; an admin marks you paid once the money is handed over.</span>
                                </p>
                              )
                              : payFieldsCard() === `channel:${c.id}` && payFieldRows()}
                          </div>
                        ))}

                      {/* Events created before Mode of Payment existed keep their
                          own typed-in details - shown only when no channel is set. */}
                      {eventChannels(guestRegEvent).length === 0 && (guestRegEvent.gcash_number || guestRegEvent.gcash_qr_url) && guestShowsMethod('GCash') && (
                        <div className="hp-pay-card">
                          <div className="hp-pay-card-head"><i className="fas fa-mobile-screen-button"></i> GCash</div>
                          {guestRegEvent.gcash_qr_url && (
                            <div className="hp-pay-qr">
                              <img src={guestRegEvent.gcash_qr_url} alt="GCash QR code" />
                              <button type="button" className="hp-pay-qr-dl" onClick={() => downloadQr(guestRegEvent.gcash_qr_url, guestRegEvent.title, 'gcash-qr')}>
                                <i className="fas fa-download"></i> Save QR
                              </button>
                            </div>
                          )}
                          {guestRegEvent.gcash_name && (
                            <div className="hp-pay-line">
                              <span className="hp-pay-line-label">Account Name</span>
                              <span className="hp-pay-line-value">{guestRegEvent.gcash_name}</span>
                            </div>
                          )}
                          {guestRegEvent.gcash_number && (
                            <div className="hp-pay-line">
                              <span className="hp-pay-line-label">Mobile Number</span>
                              <span className="hp-pay-line-value mono">{guestRegEvent.gcash_number}</span>
                              <button type="button" className="hp-pay-copy" onClick={() => copyToClipboard(guestRegEvent.gcash_number, 'gcash')}>
                                <i className={`fas ${copiedField === 'gcash' ? 'fa-check' : 'fa-copy'}`}></i> {copiedField === 'gcash' ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          )}
                          {payFieldsCard() === 'gcash' && payFieldRows()}
                        </div>
                      )}

                      {eventChannels(guestRegEvent).length === 0 && guestRegEvent.bank_account_number && guestShowsMethod('Bank Transfer') && (
                        <div className="hp-pay-card">
                          <div className="hp-pay-card-head"><i className="fas fa-building-columns"></i> Bank Transfer</div>
                          <div className="hp-pay-line">
                            <span className="hp-pay-line-label">Bank</span>
                            <span className="hp-pay-line-value">{guestRegEvent.bank_name}</span>
                          </div>
                          <div className="hp-pay-line">
                            <span className="hp-pay-line-label">Account Name</span>
                            <span className="hp-pay-line-value">{guestRegEvent.bank_account_name}</span>
                          </div>
                          <div className="hp-pay-line">
                            <span className="hp-pay-line-label">Account Number</span>
                            <span className="hp-pay-line-value mono">{guestRegEvent.bank_account_number}</span>
                            <button type="button" className="hp-pay-copy" onClick={() => copyToClipboard(guestRegEvent.bank_account_number, 'bank')}>
                              <i className={`fas ${copiedField === 'bank' ? 'fa-check' : 'fa-copy'}`}></i> {copiedField === 'bank' ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          {payFieldsCard() === 'bank' && payFieldRows()}
                        </div>
                      )}

                      {/* A method with no account of its own (e.g. Cash) still needs
                          the reference and the receipt. */}
                      {payFieldsCard() === 'none' && (
                        <div className="hp-pay-card">
                          {/* An older event with no saved channel, where "Cash" is
                              just a label on the list. Still nothing to upload. */}
                          {eventTakesCash([], [guestRegForm.paymentMethod]) ? (
                            <>
                              <div className="hp-pay-card-head"><i className="fas fa-money-bill-wave"></i> Paying in cash</div>
                              <p className="hp-pay-cash-done">
                                <i className="fas fa-money-bill-wave"></i>
                                <span><strong>Nothing to upload.</strong> Settle it in person &mdash; an admin marks you paid once the money is handed over.</span>
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="hp-pay-card-head"><i className="fas fa-receipt"></i> Payment Details</div>
                              {payFieldRows()}
                            </>
                          )}
                        </div>
                      )}

                      <p className="hp-reg-note">Your registration is confirmed once an admin verifies your payment.</p>

                      {guestRegResult && !guestRegResult.ok && (
                        <p className="hp-reg-error"><i className="fas fa-circle-exclamation"></i> {guestRegResult.message}</p>
                      )}

                      {fraudTip && (
                        <div className="hp-fraud-tip" role="alert">
                          <i className="fas fa-shield-halved"></i>
                          <span><strong>Be careful of scams.</strong> Only pay the account shown here. We never ask for an OTP, a PIN, or a &quot;release&quot; fee.</span>
                          <button type="button" onClick={() => setFraudTip(false)} aria-label="Dismiss"><i className="fas fa-times"></i></button>
                        </div>
                      )}

                      <div className="hp-reg-actions">
                        <button type="button" className="hp-reg-back" onClick={() => setGuestRegStep(reviewStep)} disabled={guestRegSubmitting}>
                          <i className="fas fa-arrow-left"></i> Back
                        </button>
                        <button type="button" className="hp-isom-btn" onClick={submitGuestRegistration} disabled={guestRegSubmitting}>
                          <i className={`fas ${guestRegSubmitting ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
                          <span>{guestRegSubmitting ? ' Submitting…' : ' Submit Registration'}</span>
                        </button>
                      </div>
                    </>
                  )}

                  <p className="hp-reg-switch">
                    Want to track this later? <button type="button" onClick={() => goToSignupForEvent(guestRegEvent)}>Create an account instead</button>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- WHY IS THIS EXTRA HERE? ---- */}
      {addonDetail && (
        <div className="hp-evt-overlay hp-reg-overlay" style={{ zIndex: 14000 }} onClick={() => setAddonDetail(null)}>
          <div className="hp-addon-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{addonDetail.question}</h3>
            <div className="hp-addon-modal-fee">+&#8369;{Number(addonDetail.fee) || 0}{addonDetail.is_required ? ' · required' : ' · optional'}</div>
            {addonDetail.description && <p className="hp-addon-modal-lead">{addonDetail.description}</p>}
            {addonDetail.details && <p className="hp-addon-modal-body">{addonDetail.details}</p>}
            <button type="button" className="hp-isom-btn hp-modal-btn" onClick={() => setAddonDetail(null)}>Got it</button>
          </div>
        </div>
      )}

      {/* ---- "You will lose what you have typed" ---- */}
      {/* Sits above the registration form (z-index in home.css) and does NOT
          close on a backdrop tap: a dialog asking whether you meant to close
          something by tapping outside it cannot itself be dismissed that way.
          The only ways out are the two buttons, and the safe one is the
          default. */}
      {discardPrompt && (
        <div className="hp-evt-overlay hp-discard-overlay">
          <div className="hp-discard" role="alertdialog" aria-modal="true" aria-labelledby="hp-discard-title">
            <div className="hp-discard-icon"><i className="fas fa-triangle-exclamation"></i></div>
            <h3 id="hp-discard-title">
              {discardPrompt === 'change-type' ? 'Change registration type?' : 'Leave this registration?'}
            </h3>
            <p>
              {discardPrompt === 'change-type'
                ? 'Switching between Individual and Bulk starts the form again. The details you have entered will not be kept.'
                : 'The details you have entered have not been submitted yet. If you leave now, they will be lost and you will have to fill the form in again.'}
            </p>
            <div className="hp-discard-actions">
              {/* Deliberately first and styled as the primary action: the
                  person is here because of a mis-tap far more often than
                  because they meant to leave. */}
              <button type="button" className="hp-discard-stay" onClick={() => setDiscardPrompt(null)} autoFocus>
                <i className="fas fa-pen"></i> Keep filling it in
              </button>
              <button type="button" className="hp-discard-go" onClick={confirmDiscard}>
                {discardPrompt === 'change-type' ? 'Start again' : 'Discard and leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- ISOM INQUIRE MODAL ---- */}
      {showIsomInquire && (
        <div className="hp-evt-overlay" onClick={() => setShowIsomInquire(false)}>
          <div className="hp-isom-inquire-modal" onClick={(e) => e.stopPropagation()}>
            <button className="hp-evt-close" onClick={() => setShowIsomInquire(false)} aria-label="Close"><i className="fas fa-times"></i></button>

            {isomInquireResult?.ok ? (
              <div className="hp-isom-inquire-success">
                <div className="hp-isom-inquire-success-icon"><i className="fas fa-check"></i></div>
                <h3>Inquiry Sent!</h3>
                <p>{isomInquireResult.message}</p>
                <button type="button" className="hp-isom-btn" onClick={() => setShowIsomInquire(false)}>Close</button>
              </div>
            ) : (
              <>
                <div className="hp-isom-inquire-head">
                  <img src="/assets/ISOM_Logo.png" alt="ISOM" className="hp-isom-inquire-logo" />
                  <div>
                    <h3>Inquire About ISOM</h3>
                    <p>Tell us a bit about yourself and our ISOM team will reach out to you.</p>
                  </div>
                </div>

                <div className="hp-isom-inquire-form">
                  <div className="hp-form-group">
                    <label>Full Name *</label>
                    <input
                      type="text"
                      className="hp-form-control"
                      value={isomInquireForm.fullName}
                      onChange={(e) => setIsomInquireForm({ ...isomInquireForm, fullName: e.target.value })}
                      placeholder="Juan Dela Cruz"
                    />
                  </div>
                  <div className="hp-isom-inquire-row">
                    <div className="hp-form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        className="hp-form-control"
                        value={isomInquireForm.email}
                        onChange={(e) => setIsomInquireForm({ ...isomInquireForm, email: e.target.value })}
                        placeholder="you@email.com"
                      />
                    </div>
                    <div className="hp-form-group">
                      <label>Mobile</label>
                      <input
                        type="text"
                        className="hp-form-control"
                        value={isomInquireForm.mobile}
                        onChange={(e) => setIsomInquireForm({ ...isomInquireForm, mobile: e.target.value })}
                        placeholder="09XXXXXXXXX"
                      />
                    </div>
                  </div>
                  <div className="hp-isom-inquire-row">
                    <div className="hp-form-group">
                      <label>Church Name</label>
                      <input
                        type="text"
                        className="hp-form-control"
                        value={isomInquireForm.churchName}
                        onChange={(e) => setIsomInquireForm({ ...isomInquireForm, churchName: e.target.value })}
                        placeholder="e.g. SanctuaryHub Church"
                      />
                    </div>
                    <div className="hp-form-group">
                      <label>Role in Church</label>
                      <select
                        className="hp-form-control"
                        value={isomInquireForm.churchRole}
                        onChange={(e) => setIsomInquireForm({ ...isomInquireForm, churchRole: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {ISOM_CHURCH_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="hp-form-group">
                    <label>Message (optional)</label>
                    <textarea
                      className="hp-form-control"
                      rows={3}
                      value={isomInquireForm.message}
                      onChange={(e) => setIsomInquireForm({ ...isomInquireForm, message: e.target.value })}
                      placeholder="Any questions about ISOM?"
                    />
                  </div>

                  {isomInquireResult && !isomInquireResult.ok && (
                    <p className="hp-isom-inquire-error"><i className="fas fa-circle-exclamation"></i> {isomInquireResult.message}</p>
                  )}

                  <button type="button" className="hp-isom-btn hp-isom-inquire-submit" onClick={submitIsomInquiry} disabled={isomInquireSubmitting}>
                    <i className={`fas ${isomInquireSubmitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                    {isomInquireSubmitting ? 'Sending…' : 'Send Inquiry'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- EVENT DETAILS MODAL ---- */}
      {/* Portalled to <body>: as a child of the page it inherits any ancestor that
          creates a containing block (a transform on the scroll-reveal wrappers is
          enough), and `position: fixed` then anchors to that ancestor instead of
          the viewport - which is what let the dialog drift off-centre and travel
          with the page. */}
      {detailEvent && typeof document !== 'undefined' && createPortal(
        <div className="hp-evt-overlay" onClick={() => setDetailEvent(null)}>
          <div className="hp-evt-modal" onClick={(e) => e.stopPropagation()}>
            <button className="hp-evt-close" onClick={() => setDetailEvent(null)} aria-label="Close"><i className="fas fa-times"></i></button>

            {detailEvent.image_url ? (
              <img
                src={eventImageUrl(detailEvent.image_url, 440)}
                srcSet={eventImageSrcSet(detailEvent.image_url)}
                sizes={EVENT_IMAGE_SIZES}
                alt={detailEvent.title}
                className="hp-evt-banner"
              />
            ) : (
              <div className="hp-evt-banner placeholder"><i className="fas fa-calendar-day"></i></div>
            )}

            <div className="hp-evt-content">
              <div className="hp-evt-badges">
                {(() => {
                  const st = evtStatus(detailEvent.event_date, detailEvent.end_date);
                  if (!st) return null;
                  const copy = { upcoming: 'Upcoming', ongoing: 'Happening now', ended: 'Ended' };
                  const icon = { upcoming: 'fa-clock', ongoing: 'fa-circle-dot', ended: 'fa-flag-checkered' };
                  return <span className={`hp-evt-status ${st}`}><i className={`fas ${icon[st]}`}></i> {copy[st]}</span>;
                })()}
                <span className={`hp-event-fee ${detailEvent.has_fee ? 'paid' : 'free'}`}>{detailEvent.has_fee ? eventFeeLabel(detailEvent) : 'Free Event'}</span>
                {detailEvent.allowed_roles && detailEvent.allowed_roles.length > 0 && <span className="hp-event-roles">{detailEvent.allowed_roles.join(', ')} only</span>}
              </div>

              <h2 className="hp-evt-title">{detailEvent.title}</h2>
              {detailEvent.description && (
                <div className="hp-evt-desc">
                  <p ref={descRef} className={`hp-evt-text ${descOpen ? '' : 'clamped'}`}>{detailEvent.description}</p>
                  {/* Shown while there is more to read, and while it is open so
                      there is a way back - never for a description that already
                      fits, which is most of them. */}
                  {(descOverflows || descOpen) && (
                    <button type="button" className="hp-evt-more" onClick={() => setDescOpen((v) => !v)}>
                      {descOpen ? 'See less' : 'See more'}
                      <i className={`fas fa-chevron-${descOpen ? 'up' : 'down'}`}></i>
                    </button>
                  )}
                </div>
              )}

              <div className="hp-evt-info">
                <div className="hp-evt-info-row">
                  <i className="fas fa-calendar-check"></i>
                  <div>
                    <span className="hp-evt-info-label">When</span>
                    {evtSessions(detailEvent).length === 0 && (
                      <span>{evtWhen(detailEvent.event_date, detailEvent.end_date)}</span>
                    )}
                    {evtDayCount(detailEvent.event_date, detailEvent.end_date) > 1 && (
                      <span className="hp-evt-days">
                        <i className="fas fa-calendar-week"></i>
                        Runs {evtDayCount(detailEvent.event_date, detailEvent.end_date)} days
                      </span>
                    )}
                    {evtSessions(detailEvent).length > 0 && (
                      <ul className="hp-evt-sessions">
                        {evtSessions(detailEvent).map((d, i) => {
                          const parts = evtSessionParts(d, detailEvent);
                          if (!parts) return null;
                          return (
                            <li key={d.id || i}>
                              <span className="hp-evt-session-day">Day {i + 1}</span>
                              <span className="hp-evt-session-date">{parts.date}</span>
                              <span className="hp-evt-session-time">{parts.time}</span>
                              {d.label && <span className="hp-evt-session-name">{d.label}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
                {(detailEvent.location || detailEvent.loc_city) && (
                  <div className="hp-evt-info-row">
                    <i className="fas fa-location-dot"></i>
                    <div>
                      <span className="hp-evt-info-label">Where</span>
                      <span>{[detailEvent.location, detailEvent.loc_barangay, detailEvent.loc_city, detailEvent.loc_province].filter(Boolean).join(', ')}</span>
                      {detailEvent.latitude && detailEvent.longitude && (
                        <a className="hp-evt-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${detailEvent.latitude},${detailEvent.longitude}`} target="_blank" rel="noreferrer"><i className="fas fa-directions"></i> Get Directions</a>
                      )}
                    </div>
                  </div>
                )}
                {detailEvent.max_participants && (() => {
                  const left = detailEvent.slots_left != null
                    ? detailEvent.slots_left
                    : Math.max(0, detailEvent.max_participants - (detailEvent.registered_count || 0));
                  const full = left <= 0;
                  return (
                    <div className="hp-evt-info-row">
                      <i className="fas fa-users"></i>
                      <div>
                        <span className="hp-evt-info-label">Capacity</span>
                        <span>
                          {full
                            ? <strong style={{ color: '#dc2626' }}>Fully booked</strong>
                            : <><strong style={{ color: 'var(--primary)' }}>{left}</strong> {left === 1 ? 'Slot' : 'Slots'} Available</>}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                {/* What each age group pays, laid out the way the poster does
                    it - the question "how much for my 8-year-old?" answered
                    before anybody opens the form. Nothing here on an event with
                    a single price. */}
                {eventTiers(detailEvent).length > 0 && (
                  <div className="hp-evt-info-row hp-evt-fees-row">
                    <i className="fas fa-peso-sign"></i>
                    <div>
                      <span className="hp-evt-info-label">Fee</span>
                      <div className="hp-fee-cards">
                        {eventTiers(detailEvent).map((t) => {
                          const fee = tierFee(detailEvent, t);
                          // What each extra costs someone in this group, so the
                          // "+₱200 if accommodation is needed" line on the poster
                          // has somewhere to live.
                          const extras = (detailEvent.event_addons || [])
                            .map((a) => ({ question: a.question, fee: addonFeeFor(a, t) }))
                            .filter((a) => a.fee > 0);
                          // The green card is the FREE-toddler card, and it is green
                          // because of the price, not because of the guardian. A paid
                          // group registered under a parent - the 6-10s - gets the
                          // ordinary card and says what it costs; the note below still
                          // tells a parent where that child goes. Green against "₱100"
                          // would read as though it were free.
                          return (
                            <div className={`hp-fee-card ${t.nameOnly && fee <= 0 ? 'kid' : ''}`} key={t.label}>
                              <span className="hp-fee-card-label">{t.label}</span>
                              <span className="hp-fee-card-age">{tierAgeLabel(t)}</span>
                              <span className={`hp-fee-card-price ${fee > 0 ? '' : 'free'}`}>
                                {fee > 0 ? `₱${fee}` : 'FREE'}
                              </span>
                              {/* "+₱200 Accommodation", not "+₱200 Do you want
                                  accommodation?" - the card is a price list, not
                                  the form, and the full question wraps a narrow
                                  card to three lines for one word of meaning. */}
                              {extras.map((x) => (
                                <span className="hp-fee-card-extra" key={x.question}>
                                  +₱{x.fee} {addonShortLabel(x.question)}
                                </span>
                              ))}
                              {/* Only the children's cards carry a line of small
                                  print. An adult's card saying "registered under a
                                  parent" is a note left behind by a tick that was
                                  undone, and it makes every card a line taller. */}
                              {t.nameOnly && (
                                <span className="hp-fee-card-note">{t.note || 'Under a parent or guardian'}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {detailEvent.has_fee && detailEvent.payment_instructions && (
                  <div className="hp-evt-info-row">
                    <i className="fas fa-money-check-dollar"></i>
                    <div><span className="hp-evt-info-label">Payment</span><span style={{ whiteSpace: 'pre-wrap' }}>{detailEvent.payment_instructions}</span></div>
                  </div>
                )}
              </div>

              {/* The event's own link, so anyone looking at the poster can pass
                  it on: whoever opens it lands right back on this registration. */}
              {eventSlug(detailEvent) && (
                <button type="button" className="hp-evt-share" onClick={() => shareEventLink(detailEvent)}>
                  <i className={`fas ${copiedField === 'event-link' ? 'fa-check' : 'fa-share-nodes'}`}></i>
                  {copiedField === 'event-link' ? 'Link copied' : 'Share this event'}
                </button>
              )}

              {detailEvent.registration_required !== false && (() => {
                const { full, notOpenYet, closed, opensAt, ended } = evtRegGate(detailEvent);

                if (ended) {
                  return (
                    <button className="hp-evt-register" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                      <i className="fas fa-flag-checkered"></i> This Event Has Ended
                    </button>
                  );
                }
                if (notOpenYet) {
                  return (
                    <>
                      <button className="hp-evt-register" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                        <i className="fas fa-hourglass-start"></i> Upcoming Soon
                      </button>
                      <p className="hp-evt-note">
                        <i className="fas fa-circle-info"></i> Registration opens {opensAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
                      </p>
                    </>
                  );
                }
                if (closed) {
                  return (
                    <button className="hp-evt-register" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                      <i className="fas fa-lock"></i> Registration Closed
                    </button>
                  );
                }
                if (full) {
                  return (
                    <button className="hp-evt-register" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                      <i className="fas fa-ban"></i> Fully Booked
                    </button>
                  );
                }
                return (
                  <>
                    <button className="hp-evt-register" onClick={() => handlePublicRegister(detailEvent)}>
                      <i className="fas fa-user-plus"></i> Register for this Event
                    </button>
                    <p className="hp-evt-note"><i className="fas fa-circle-info"></i> Register in a minute as a guest, or create a free account to track it.</p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ---- VISIT US / MAP ---- */}
      <div className="hp-section-dark">
        <section id="location" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Visit Us</h2>
            <p>Come and worship with us. Here is where you can find our church.</p>
          </div>

          <div className="hp-map-wrapper hp-animate">
            <div className="hp-map-info">
              <span className="hp-map-eyebrow">Our Church</span>
              <h3>{brand.church}</h3>
              <p className="hp-map-city">{CHURCH_CITY}</p>
              <dl className="hp-map-hours">
                {SERVICE_TIMES.map((s) => (
                  <div key={s.day}>
                    <dt>{s.name}</dt>
                    <dd>{s.day}, {s.time}</dd>
                  </div>
                ))}
              </dl>
              <div className="hp-map-actions">
                <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="hp-map-btn primary">Get Directions</a>
                <a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer" className="hp-map-btn">Message Us</a>
              </div>
            </div>
            <div className="hp-map-embed">
              <div className="hp-map-toggle" role="tablist" aria-label="Map view">
                <button type="button" role="tab" aria-selected={mapView === 'map'} className={mapView === 'map' ? 'active' : ''} onClick={() => setMapView('map')}>
                  Map
                </button>
                <button type="button" role="tab" aria-selected={mapView === 'street'} className={mapView === 'street' ? 'active' : ''} onClick={() => setMapView('street')}>
                  Street View
                </button>
              </div>
              <iframe
                key={mapView}
                src={mapView === 'map' ? MAP_EMBED_URL : STREET_EMBED_URL}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allow="accelerometer; gyroscope; magnetometer; fullscreen"
                title={`${brand.church} on the map`}
              ></iframe>
            </div>
          </div>
        </section>
      </div>

      {/* ---- ABOUT SANCTUARYHUB ---- */}
      {/* What this site is, and what signing in with Google shares. Google reads
          this page when it checks the sign-in app's branding: it wants the app
          name (SanctuaryHub) on the home page, the app's purpose explained, and
          a link to the privacy policy - so this names the platform in either
          branding mode and is plain text, not animated in. */}
      <section id="platform" className="hp-platform">
        <div className="hp-platform-inner">
          <div className="hp-platform-copy">
            <span className="hp-give-eyebrow">About this site</span>
            <h2>About {brand.platform}</h2>
            <p>
              {brand.platform} is the online church management platform of {brand.church} in{' '}
              {CHURCH_CITY}. It gives our members one place to stay connected with church life,
              and gives our pastors and ministry leaders the tools to care for the congregation.
            </p>
            <p className="hp-platform-signin">
              Accounts are free. You can sign up with your email address or with your Google
              account. If you choose Google, {brand.platform} receives only your name, email
              address and profile picture, and uses them only to create your account, sign you in
              and show your name and picture on your profile. We never sell your information or
              use it for advertising. Read our <a href="/privacy-policy">Privacy Policy</a> and{' '}
              <a href="/terms">Terms of Service</a>.
            </p>
          </div>
          <dl className="hp-platform-uses">
            <div>
              <dt>For members</dt>
              <dd>Register for church events, follow live services, read announcements and the Bible, and ask Joy, our AI assistant, about church life.</dd>
            </div>
            <div>
              <dt>For ministries</dt>
              <dd>Plan worship lineups, weekly schedules and ministry meetings, and keep in touch with your team through messages.</dd>
            </div>
            <div>
              <dt>For church leaders</dt>
              <dd>Manage members, events, attendance, accommodation and reports from one dashboard.</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ---- CTA BANNER ---- */}
      {viewer ? (
        <section className="hp-cta">
          <h2>Welcome back, {viewer.firstname}!</h2>
          <p>
            You are signed in. Watch our services live, sign up for events and keep your
            details up to date in your account.
          </p>
          <div className="hp-cta-buttons">
            <a href="/sunday-service" className="hp-btn-primary">Watch Live</a>
            <a href="/dashboard" className="hp-btn-outline">My Account</a>
          </div>
        </section>
      ) : (
        <section className="hp-cta">
          <h2>Join Our Church Family Today</h2>
          <p>
            Create your free account to register for events, watch our services live and stay
            connected with {brand.church}{brand.isPlatform ? ` on ${brand.platform}` : ''}.
          </p>
          <div className="hp-cta-buttons">
            <a href="/signup" className="hp-btn-primary">Create an Account</a>
            <a href="/login" className="hp-btn-outline">Log In</a>
          </div>
        </section>
      )}

      {/* ---- FOOTER ---- */}
      <footer className="hp-footer">
        <div className="hp-footer-grid">
          {/* About col */}
          <div className="hp-footer-about">
            <div className="hp-footer-brand">
              <img src="/assets/LOGO.png" alt={`${brand.full} logo`} loading="lazy" decoding="async" />
              <h3>
                {brand.name}
                <span>{brand.isPlatform ? brand.church : brand.sub}</span>
              </h3>
            </div>
            <p>
              A Spirit-filled community of believers dedicated to spreading the gospel,
              building disciples, and making a lasting impact for God&apos;s kingdom.
            </p>
            <div className="hp-footer-socials">
              <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" title="Facebook" aria-label="Facebook"><i className="fab fa-facebook-f"></i></a>
              <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" title="YouTube" aria-label="YouTube"><i className="fab fa-youtube"></i></a>
              <a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer" title="Messenger" aria-label="Messenger"><i className="fab fa-facebook-messenger"></i></a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="hp-footer-col">
            <h4>Explore</h4>
            <ul>
              <li><a href="#about">About Us</a></li>
              <li><a href="#plan-visit">Plan a Visit</a></li>
              <li><a href="#ministries">Ministries</a></li>
              <li><a href="#this-week">Events</a></li>
              <li><a href="#isom">ISOM</a></li>
              <li><a href="/donation">Donate</a></li>
              <li><a href="/news">News</a></li>
            </ul>
          </div>

          {/* Online */}
          <div className="hp-footer-col">
            <h4>Online</h4>
            <ul>
              <li><a href="/sunday-service">Watch Live</a></li>
              <li><a href="/midweek">Midweek Service</a></li>
              <li><a href="/ministrymobileapp">Ministry App</a></li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); askJoy(''); }}>Ask Joy</a></li>
              {viewer ? (
                <>
                  <li><a href="/giving/my">My Giving</a></li>
                  <li><a href={isGuestOnly(viewer) ? '#my-home' : '/dashboard'}>My Account</a></li>
                </>
              ) : (
                <>
                  <li><a href="/login">Member Login</a></li>
                  <li><a href="/signup">Create an Account</a></li>
                </>
              )}
            </ul>
          </div>

          {/* Contact */}
          <div className="hp-footer-col">
            <h4>Get in Touch</h4>
            <ul>
              <li><a href="#location">{CHURCH_CITY}</a></li>
              <li><a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">Get Directions</a></li>
              <li><a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer">Message Us</a></li>
              <li><a href="/terms">Terms</a></li>
              <li><a href="/privacy-policy">Privacy Policy</a></li>
            </ul>
          </div>
        </div>

        <div className="hp-footer-bottom">
          <p>
            &copy; {new Date().getFullYear()} <span>{brand.owner}</span>. All rights reserved.
            {brand.isPlatform
              ? <> Serving {brand.church}.</>
              : <> Powered by <span>{brand.platform}</span>.</>}
          </p>
        </div>
      </footer>

      {/* ---- JOY AI CHATBOT ---- */}
      <div className={`hp-chat ${chatOpen ? 'open' : ''}`}>
        <div className="hp-chat-window" role="dialog" aria-label="Joy AI Assistant">
          <div className="hp-chat-header">
            <div className="hp-chat-header-info">
              <img src="/assets/Joy_Mascot.webp" alt="Joy" className="hp-chat-avatar" loading="lazy" decoding="async" />
              <div>
                <span className="hp-chat-name">Joy</span>
                <span className="hp-chat-status"><i className="fas fa-circle"></i> AI Assistant</span>
              </div>
            </div>
            <button className="hp-chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="hp-chat-body" ref={chatBodyRef}>
            {chatMessages.map((m, i) => {
              const shown = {};
              const body = m.role === 'assistant' ? renderRichText(m.display ?? m.content, shown) : m.content;
              return (
              <div key={i} className={`hp-chat-msg ${m.role}${m.events?.length || m.rangePicker ? ' wide' : ''}`}>
                <div className="hp-chat-bubble">
                  {body}
                </div>

                {/* Pastors Joy named in a sentence rather than a list: their
                    photo, name and role under the reply - the same pictures
                    as the Our Pastors section. */}
                {m.pastors && m.pastors.length > 0 && !shown.pastors && renderPastorList(m.pastors, 'pastors', true)}

                {/* Past events Joy looked up: one card each, straight from the
                    database row. "View full details" opens the same dialog the
                    event cards on the page open. */}
                {m.events && m.events.length > 0 && (
                  <div className="hp-chat-events">
                    {m.events.map((evt) => {
                      const st = evtStatus(evt.event_date, evt.end_date);
                      const days = evtDayCount(evt.event_date, evt.end_date);
                      const place = [evt.location, evt.loc_city].filter(Boolean).join(', ');
                      const about = evtBlurb(evt.description);
                      return (
                        <article key={evt.id} className="hp-chat-evt">
                          {evt.image_url ? (
                            <img
                              className="hp-chat-evt-img"
                              src={eventImageUrl(evt.image_url, 440)}
                              alt={`${evt.title} poster`}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="hp-chat-evt-img placeholder" aria-hidden="true">{evt.title}</div>
                          )}
                          <div className="hp-chat-evt-body">
                            {st && (
                              <span className={`hp-chat-evt-status ${st}`}>
                                {{ upcoming: 'Upcoming', ongoing: 'Happening now', ended: 'Ended' }[st]}
                              </span>
                            )}
                            <h4>{evt.title}</h4>
                            <dl className="hp-chat-evt-facts">
                              <div>
                                <dt>When</dt>
                                <dd>{evtShortWhen(evt.event_date, evt.end_date)}{days > 1 ? ` · ${days} days` : ''}</dd>
                              </div>
                              {place && (
                                <div>
                                  <dt>Where</dt>
                                  <dd>{place}</dd>
                                </div>
                              )}
                            </dl>
                            {about && <p className="hp-chat-evt-about">{about}</p>}
                            <button
                              type="button"
                              className="hp-chat-evt-more"
                              onClick={() => { setChatOpen(false); setDetailEvent(evt); }}
                            >
                              View full details
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {/* Joy asked which dates: quick ranges, or a custom one. Only
                    under her latest message - an older picker would answer a
                    question the conversation has moved past. */}
                {m.rangePicker && i === chatMessages.length - 1 && !chatLoading && (() => {
                  const today = new Date();
                  const todayStr = ymd(today);
                  const from = pastFrom || ymd(PAST_RANGE_PRESETS[1].from(today));
                  const to = pastTo || todayStr;
                  return (
                    <div className="hp-chat-range">
                      <div className="hp-chat-range-presets">
                        {PAST_RANGE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            className="hp-chat-suggestion"
                            onClick={() => pickPastRange(ymd(p.from(today)), todayStr)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <form
                        className="hp-chat-range-custom"
                        onSubmit={(e) => { e.preventDefault(); pickPastRange(from, to); }}
                      >
                        <label>
                          <span>From</span>
                          <input type="date" value={from} max={todayStr} onChange={(e) => setPastFrom(e.target.value)} required />
                        </label>
                        <label>
                          <span>To</span>
                          <input type="date" value={to} max={todayStr} onChange={(e) => setPastTo(e.target.value)} required />
                        </label>
                        <button type="submit" className="hp-chat-action-btn">Show events</button>
                      </form>
                    </div>
                  );
                })()}

                {m.actions && m.actions.length > 0 && (
                  <div className="hp-chat-actions">
                    {/* An event button opens a dialog on this very page, so it
                        is a button - a link would have to navigate somewhere to
                        get back to where the visitor already is. */}
                    {m.actions.map((a, j) => (a.onClick ? (
                      <button key={j} type="button" className="hp-chat-action-btn" onClick={a.onClick}>
                        <i className={`fas ${a.icon}`}></i> {a.label}
                      </button>
                    ) : (
                      <a key={j} href={a.href} className="hp-chat-action-btn">
                        <i className={`fas ${a.icon}`}></i> {a.label}
                      </a>
                    )))}
                  </div>
                )}
              </div>
              );
            })}
            {chatLoading && (
              <div className="hp-chat-msg assistant">
                <div className="hp-chat-bubble hp-chat-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}

            {/* Only under the opening greeting. Once there is a conversation
                these would be answering a question nobody asked. */}
            {chatMessages.length === 1 && !chatLoading && (
              <div className="hp-chat-suggestions">
                {chatSuggestions.map((s) => (
                  <button key={s} type="button" className="hp-chat-suggestion" onClick={() => sendChatMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="hp-chat-input"
            onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask Joy anything..."
              aria-label="Message"
            />
            <button type="submit" disabled={!chatInput.trim() || chatLoading} aria-label="Send">
              <i className="fas fa-paper-plane"></i>
            </button>
          </form>
        </div>

        <button
          className="hp-chat-launcher"
          onClick={() => setChatOpen(o => !o)}
          title="Chat with Joy"
          aria-label="Chat with Joy, our AI Assistant"
        >
          <img src="/assets/Joy_Mascot.webp" alt="Joy AI Assistant" draggable="false" loading="lazy" decoding="async" fetchPriority="low" />
        </button>
      </div>
    </>
  );
}
