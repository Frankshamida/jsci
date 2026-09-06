'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import './home.css';
import { withTitleCase } from '@/lib/eventTitle';

// ============================================
// DATA
// ============================================
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
  paymentMethod: '', paymentReference: '',
};

// Receipts are phone photos - often 3-5MB of JPEG for a picture of a screen.
// Re-encoding to WebP at a sane width cuts that to a couple of hundred KB
// before it ever leaves the browser, so uploads stay quick on mobile data.
// Anything that can't be decoded (an odd format, a huge file) is uploaded as-is.
const MAX_RECEIPT_WIDTH = 1600;
const toWebpFile = (file) => new Promise((resolve) => {
  if (!file || !file.type?.startsWith('image/')) { resolve(file); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, MAX_RECEIPT_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) { resolve(file); return; }
        const name = (file.name || 'receipt').replace(/\.[^.]+$/, '') + '.webp';
        resolve(new File([blob], name, { type: 'image/webp' }));
      }, 'image/webp', 0.82);
    } catch { URL.revokeObjectURL(url); resolve(file); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});

const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: '/assets/dr-weldon-pior.png' },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: '/assets/dr-dorothy-pior.png' },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: '/assets/ptr-gracelyn-gambe.png' },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: '/assets/ptr-eldan-gambe.png' },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: '/assets/ptr-psalm-gambe.png' },
];

const ACTIVITIES = [
  { title: 'Sunday Worship Service', desc: 'Our church family united in powerful worship and biblical teaching every Sunday morning.', photo: '/assets/worship-service.jpg', badge: 'Weekly' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study and discussion for spiritual growth and deeper understanding of God\'s Word.', photo: '/assets/friday-bible-study.jpg', badge: 'Weekly' },
  { title: 'ISOM Training', desc: 'International School of Ministry — equipping leaders for effective kingdom work and ministry.', photo: '/assets/isom-training.jpg', badge: 'Ongoing' },
  { title: 'Online Midweek Service', desc: 'Join us online every Wednesday for worship, teaching, and fellowship from wherever you are.', photo: '/assets/Midweek_Service.png', badge: 'Weekly' },
  { title: 'Youth Ministry', desc: 'Dynamic gatherings filled with fun, fellowship, games, and spiritual growth for the youth.', photo: '/assets/youth-event.jpg', badge: 'Monthly' },
  { title: 'Community Outreach', desc: 'Serving our community with practical needs and sharing the good news of Jesus Christ.', photo: '/assets/community-outreach.jpg', badge: 'Quarterly' },
  { title: 'Pastor Appreciation', desc: 'Honoring and celebrating our dedicated pastors for their faithful service and leadership.', photo: '/assets/pastor-appreciation.jpg', badge: 'Annual' },
  { title: 'Leadership Conference', desc: 'Equipping and empowering believers to raise up the next generation of kingdom leaders.', photo: '/assets/Leadership Conference.jpg', badge: 'Annual' },
];

const SERVICE_TIMES = [
  { icon: 'fa-sun', day: 'Sunday', time: '9:00 AM', name: 'Worship Service' },
  { icon: 'fa-book-bible', day: 'Friday', time: '7:00 PM', name: 'Bible Study' },
  { icon: 'fa-users', day: 'Saturday', time: '2:00 PM', name: 'Youth Fellowship' },
];

const ISOM_SLIDES = [
  '/assets/isom-training.jpg',
  '/assets/christian-leadership-conference.jpg',
  '/assets/friday-bible-study.jpg',
  '/assets/worship-service.jpg',
  '/assets/community-outreach.jpg',
];

// Icons cycled across the ISOM highlight badges, matched by bullet index.
const ISOM_BULLET_ICONS = ['fa-bible', 'fa-dove', 'fa-people-group', 'fa-earth-americas'];

// ---- Event date helpers -------------------------------------------------
// How many CALENDAR days an event covers: Fri 9am -> Sun 5pm is 3 days to a
// person even though it is 56 hours, so both ends are normalised to midnight.
const evtDayCount = (startStr, endStr) => {
  if (!startStr || !endStr) return 1;
  const s = new Date(startStr);
  const e = new Date(endStr);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  const s0 = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const e0 = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const days = Math.round((e0.getTime() - s0.getTime()) / 86400000) + 1;
  return days < 1 ? 1 : days;
};

// "Cebu Event" - the place people know the event by. Uses the city, falling
// back to the province or region, and drops a redundant "City" suffix so it
// reads "Cebu Event" rather than "Cebu City Event".
const evtRegionLabel = (evt) => {
  const place = (evt?.loc_city || evt?.loc_province || evt?.loc_region || '').trim();
  if (!place) return 'Event Registration';
  return place.replace(/\s+city$/i, '') + ' Event';
};

// One session split into the pieces the schedule strip shows:
// "Oct 2" and "10:00 AM - 6:00 PM" (or a second date when it runs overnight).
const evtSessionParts = (d, evt) => {
  const s = d?.starts_at ? new Date(d.starts_at) : null;
  if (!s || Number.isNaN(s.getTime())) return null;
  let e = d.ends_at ? new Date(d.ends_at) : null;
  // Sessions saved before end times were required have none. Rather than showing
  // a bare "10:00 AM", fall back to the event's own finishing time of day - the
  // hours the event as a whole runs.
  if ((!e || Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) && evt?.end_date) {
    const evtEnd = new Date(evt.end_date);
    if (!Number.isNaN(evtEnd.getTime())) {
      const guess = new Date(s.getFullYear(), s.getMonth(), s.getDate(), evtEnd.getHours(), evtEnd.getMinutes());
      e = guess.getTime() > s.getTime() ? guess : null;
    }
  }
  const hasEnd = e && !Number.isNaN(e.getTime()) && e.getTime() > s.getTime();
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

// Where the event sits relative to now. Used for the status pill.
// An event with no end date is treated as over once its start has passed.
const evtStatus = (startStr, endStr) => {
  if (!startStr) return null;
  const s = new Date(startStr);
  if (Number.isNaN(s.getTime())) return null;
  const now = Date.now();
  const e = endStr ? new Date(endStr) : null;
  const endMs = e && !Number.isNaN(e.getTime()) ? e.getTime() : s.getTime();
  if (now < s.getTime()) return 'upcoming';
  if (now <= endMs) return 'ongoing';
  return 'ended';
};

// "Saturday, September 26, 2025 at 9:00 AM - Monday, September 28 at 5:00 PM"
// The old version formatted end_date with hour+minute ONLY, so a multi-day
// event read as "September 26 at 9:00 AM - 5:00 PM" and silently lost the
// end date entirely. Same-day events still collapse to just the end time.
const evtWhen = (startStr, endStr) => {
  if (!startStr) return 'TBA';
  const s = new Date(startStr);
  if (Number.isNaN(s.getTime())) return 'TBA';
  const full = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  const startTxt = s.toLocaleString('en-US', full);
  if (!endStr) return startTxt;
  const e = new Date(endStr);
  if (Number.isNaN(e.getTime())) return startTxt;
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  if (sameDay) return startTxt + ' \u2013 ' + e.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameYear = s.getFullYear() === e.getFullYear();
  const endTxt = e.toLocaleString('en-US', sameYear
    ? { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : full);
  return startTxt + ' \u2013 ' + endTxt;
};

const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ============================================
// COMPONENT
// ============================================
export default function HomePage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
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
  const [eventsVersion, setEventsVersion] = useState(0); // bumped after a registration so the slot counts refresh
  const [detailEvent, setDetailEvent] = useState(null);

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
  const [guestRegStep, setGuestRegStep] = useState(0);           // 0 = who's coming, 1 = payment
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

  const handlePublicRegister = (evt) => {
    setDetailEvent(null);
    setRegChoiceScreen('how');
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
  });

  const openGuestRegistration = (evt, mode = 'individual') => {
    setRegChoiceEvent(null);
    setRegChoiceScreen('how');
    setGuestRegMode(mode);
    setGuestRegEvent(evt);
    const methods = evt.payment_methods || [];
    setGuestRegForm({ ...EMPTY_GUEST_REG_FORM, paymentMethod: methods.length === 1 ? methods[0] : '' });
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
    setGuestRegResult(null);
  };

  // Shrink + convert the receipt before it is attached, so the upload is small.
  const handleGuestProofPick = async (file) => {
    if (!file) { setGuestRegProof(null); setGuestRegProofPreview(''); return; }
    const converted = await toWebpFile(file);
    setGuestRegProof(converted);
    setGuestRegProofPreview(URL.createObjectURL(converted));
  };

  // "Gomez_GCash_POP_09-01-2026.webp" - so a folder of receipts can be scanned
  // by eye without opening every one.
  const proofFileName = () => {
    const last = (guestRegForm.lastName || 'Attendee').trim().replace(/[^a-z0-9]+/gi, '') || 'Attendee';
    const method = (guestRegForm.paymentMethod || 'Payment').replace(/[^a-z0-9]+/gi, '') || 'Payment';
    const d = new Date();
    const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
    return `${last}_${method}_POP_${stamp}.webp`;
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

  // A calendar entry for the event, generated in the browser. Opening the file
  // on a phone hands it straight to the calendar app.
  const addEventToCalendar = (evt) => {
    if (!evt?.event_date) return;
    const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const end = evt.end_date || evt.event_date;
    const where = [evt.location, evt.loc_barangay, evt.loc_city, evt.loc_province].filter(Boolean).join(', ');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JSCI//Events//EN', 'BEGIN:VEVENT',
      `UID:${evt.id}@jsci`,
      `DTSTAMP:${stamp(Date.now())}`,
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
  const downloadQr = async (url, title) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${(title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-gcash-qr.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch {
      // cross-origin fetch blocked: open it so the user can long-press / save
      window.open(url, '_blank', 'noopener');
    }
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
        const res = await fetch(`/api/events/registrations?churches=1&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setChurchOptions(data.success ? data.data || [] : []);
      } catch { setChurchOptions([]); }
    }, 220);
    return () => clearTimeout(timer);
  }, [guestRegForm.churchName, churchOpen, guestRegEvent]);

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
      <div className="hp-pay-line">
        <span className="hp-pay-line-label">Proof of Payment *</span>
        {guestRegProof ? (
          <>
            {/* the saved filename, and a click to check it */}
            <button type="button" className="hp-pay-file" onClick={() => window.open(guestRegProofPreview, '_blank', 'noopener')}>
              <i className="fas fa-file-image"></i> {proofFileName()}
              <em>{(guestRegProof.size / 1024).toFixed(0)} KB</em>
            </button>
            <label className="hp-pay-reupload" htmlFor="hp-reg-proof"><i className="fas fa-rotate"></i> Change</label>
          </>
        ) : (
          <label className={`hp-pay-upload-btn ${guestFieldErrors.proof ? 'invalid' : ''}`} htmlFor="hp-reg-proof">
            <i className="fas fa-cloud-arrow-up"></i> Upload
          </label>
        )}
        <input id="hp-reg-proof" type="file" accept="image/*" hidden onChange={(e) => handleGuestProofPick(e.target.files?.[0] || null)} />
      </div>
      {guestFieldErrors.proof && (
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
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    return (guestRegEvent?.event_addons || [])
      .filter((x) => held.some((h) => h.id === x.id || same(h.question, x.question)))
      .map((x) => x.id);
  })();

  // Only a verified registration can be reused - an unverified one may still be
  // rejected, and its details would then be the wrong ones to copy.
  const repVerified = !!repMatch && (repMatch.status === 'payment_verified' || repMatch.status === 'registered');
  // Extras the representative is adding now. For someone already registered these
  // are the ones they had NOT availed before, charged on top of what they hold.
  const repNewAddonIds = repAddonIds.filter((id) => !repLockedAddonIds.includes(id));
  const repTopUpAddons = () => (guestRegEvent?.event_addons || []).filter((x) => repNewAddonIds.includes(x.id));
  const repTopUpTotal = () => repTopUpAddons().reduce((sum, x) => sum + (Number(x.fee) || 0), 0);

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
    setGuestRegForm({ ...EMPTY_GUEST_REG_FORM, paymentMethod: methods.length === 1 ? methods[0] : '' });
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
    ? { firstName: guestRegForm.firstName.trim(), lastName: guestRegForm.lastName.trim(), addonIds: repAddonIds, isRep: true }
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
  const commitAttendee = () => {
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

    const person = { firstName: first, lastName: last, addonIds: draft.addonIds };
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
  const attendeeExtrasTotal = (a) => attendeeAddons(a).reduce((sum, x) => sum + (Number(x.fee) || 0), 0);
  // What one person in the roster costs: the base fee plus whatever they ticked.
  const attendeeAmount = (a) => guestBaseAmount(guestRegEvent)
    + (guestRegEvent?.event_addons || [])
        .filter((x) => a.addonIds.includes(x.id))
        .reduce((sum, x) => sum + (Number(x.fee) || 0), 0);

  // Step 1: for an individual, who is coming. For a group, who is holding the
  // registration - the same fields, plus the promise that they are true.
  const guestStepOneErrors = () => {
    const errs = {};
    if (!guestRegForm.firstName.trim()) errs.firstName = 'First name is required.';
    if (!guestRegForm.lastName.trim()) errs.lastName = 'Last name is required.';
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
    if ((guestRegEvent?.payment_methods || []).length > 1 && !guestRegForm.paymentMethod) errs.paymentMethod = 'Please choose how you paid.';
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

  const closeGuestRegistration = () => {
    setGuestRegEvent(null); setGuestRegResult(null); setGuestFieldErrors({});
    setRepAgreed(false); setRepUsedSaved(false);
    setDupNames([]); setDupDetails([]);
  };

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
  const guestBaseAmount = (evt) => {
    if (!evt || !evt.has_fee) return 0;
    const early = evt.early_bird_price != null && evt.early_bird_deadline && new Date() <= new Date(evt.early_bird_deadline);
    return Number(early ? evt.early_bird_price : evt.registration_fee) || 0;
  };

  // Base + the extras ticked. Only a preview - the server recomputes the real
  // total from the database so the form can't understate what is owed.
  const guestTotalAmount = (evt) => {
    // A group pays for each person on the roster, extras and all.
    if (guestRegMode === 'bulk') {
      const base = guestBaseAmount(evt);
      const topUp = repLocked ? repTopUpTotal() : 0;
      return topUp + fullRoster().reduce((sum, a) => sum + base
        + (evt?.event_addons || [])
            .filter((x) => a.addonIds.includes(x.id))
            .reduce((s, x) => s + (Number(x.fee) || 0), 0), 0);
    }
    return guestBaseAmount(evt)
      + (evt?.event_addons || [])
          .filter((a) => guestRegAddonIds.includes(a.id))
          .reduce((sum, a) => sum + (Number(a.fee) || 0), 0);
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
        }))));
        // Who to call about this booking - stored on every row of the group.
        fd.append('representative', `${guestRegForm.firstName.trim()} ${guestRegForm.lastName.trim()}`.trim());
        // Extras the representative is availing on the slot they already hold.
        if (repLocked && repNewAddonIds.length > 0) fd.append('repAddonTopUp', JSON.stringify(repNewAddonIds));
      }
      fd.append('attendeeEmail', guestRegForm.email || '');
      fd.append('attendeeMobile', guestRegForm.mobile || '');
      fd.append('churchName', guestRegForm.churchName || '');
      fd.append('churchPastor', guestRegForm.churchPastor ? `Ptr. ${guestRegForm.churchPastor.trim()}` : '');
      fd.append('addonIds', JSON.stringify(guestRegAddonIds));
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
    { role: 'assistant', content: "Hello, I'm **Joy**, your SanctuaryHub assistant. 😊\n\nI'd be glad to help you with:\n- **Service times** and weekly gatherings\n- **ISOM** enrollment and details\n- Upcoming **events** and announcements\n- Getting connected or creating an account\n\nHow may I assist you today?" },
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
    if (userData && userData.firstname && userData.email) {
      router.replace('/dashboard');
      return;
    }
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) { document.body.classList.add('dark-mode'); document.documentElement.classList.add('dark-mode'); }
  }, [router]);

  // ---- Hero auto-rotate ----
  useEffect(() => {
    heroTimer.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(heroTimer.current);
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
              const end = evt.end_date ? new Date(evt.end_date).getTime() : (evt.event_date ? new Date(evt.event_date).getTime() : null);
              return !end || end >= now;
            });
            const sorted = [...notCompleted].sort((a, b) => {
              const da = new Date(a.event_date).getTime();
              const db = new Date(b.event_date).getTime();
              const aUpcoming = da >= now;
              const bUpcoming = db >= now;
              // Upcoming events first (soonest first), then past events (most recent first)
              if (aUpcoming && bUpcoming) return da - db;
              if (aUpcoming) return -1;
              if (bUpcoming) return 1;
              return db - da;
            });
            setNewsEvents(sorted.slice(0, 8).map(withTitleCase));
          }
        }
      } catch { /* fall back to defaults */ }
    };
    loadNews();
  }, [eventsVersion]);


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

  // ---- Daily verse (cached 24h in localStorage) ----
  const fetchDailyVerse = useCallback(async () => {
    const FALLBACK = { verse: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."', reference: 'Jeremiah 29:11 (NIV)' };
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1) Serve a cached verse if it's less than 24h old
    try {
      const cached = JSON.parse(localStorage.getItem('dailyVerse') || 'null');
      if (cached && cached.verse && cached.savedAt && (Date.now() - cached.savedAt) < ONE_DAY) {
        setDailyVerse({ verse: cached.verse, reference: cached.reference });
        return;
      }
    } catch { /* ignore corrupt cache */ }

    if (!GROQ_API_KEY) {
      setDailyVerse(FALLBACK);
      return;
    }

    // 2) Otherwise fetch a fresh verse from Groq and cache it for the day
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
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
          localStorage.setItem('dailyVerse', JSON.stringify({ verse: parsed.verse, reference: parsed.reference, savedAt: Date.now() }));
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

  const CHAT_SYSTEM_PROMPT = `You are "Joy", the professional AI assistant for SanctuaryHub — the online ministry portal of Jesus Sanctuary Christian International (JSCI).

TONE & STYLE:
- Write in a warm but professional and polished tone, like a helpful ministry representative.
- Be concise and well-organized. Prefer short paragraphs (1-2 sentences) separated by a blank line.
- When listing details (times, steps, options), use bullet points starting with "- ".
- Emphasize the most important words or key terms using **bold** markdown (e.g. **Sunday 9:00 AM**, **ISOM**, **August 2026**). Bold sparingly and purposefully — only the key terms, not whole sentences.
- Use emojis very sparingly — at most ONE per reply, and only when it genuinely adds warmth. Many replies should have none.
- Do NOT use markdown headings (#) or tables. Only **bold**, plain paragraphs, and "- " bullets.

KEY FACTS:
- Worship Service: **Sunday 9:00 AM**. Bible Study: **Friday 7:00 PM**. Youth Fellowship: **Saturday 2:00 PM**.
- Senior Pastors: **Dr. Weldon Pior** and **Dr. Dorothy Pior**.
- ISOM (International School of Ministries) is a ministry-training program. Classes begin **August 2026**. People enroll by signing up / clicking "Enroll Now".
- Users can sign up or log in from the navbar buttons, and watch live streams when a service is live.

If you don't know something specific, professionally encourage the user to contact the church office or visit in person. Keep answers focused (usually 2-4 short paragraphs or a short list). Never invent doctrine; refer spiritual counsel to a pastor.`;

  // Render a single line, converting **bold** markdown into <strong> spans
  const renderInline = (text, keyPrefix) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${keyPrefix}-${i}`} className="hp-chat-em">{part.slice(2, -2)}</strong>;
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    });
  };

  // Convert Joy's reply (bold, paragraphs, "- " bullets) into formatted JSX
  const renderRichText = (content) => {
    const lines = content.split('\n');
    const blocks = [];
    let bullets = [];
    const flushBullets = (key) => {
      if (bullets.length) {
        blocks.push(
          <ul className="hp-chat-list" key={`ul-${key}`}>
            {bullets.map((b, i) => <li key={i}>{renderInline(b, `li-${key}-${i}`)}</li>)}
          </ul>
        );
        bullets = [];
      }
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

  // Detect sign-up / sign-in intent in a reply and attach clickable buttons
  const buildChatActions = (reply) => {
    const t = reply.toLowerCase();
    const actions = [];
    if (/(sign\s?up|signup|register|enroll|create an account|join)/.test(t)) {
      actions.push({ label: 'Sign Up', href: '/signup', icon: 'fa-user-plus' });
    }
    if (/(sign\s?in|signin|log\s?in|login|log in to)/.test(t)) {
      actions.push({ label: 'Sign In', href: '/login', icon: 'fa-sign-in-alt' });
    }
    return actions;
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    if (!GROQ_API_KEY) {
      const fallback = "I'm not fully connected right now, but here's what I can share: our Worship Service is Sunday 9 AM, and ISOM classes begin August 2026. You can sign up or sign in anytime below. 🙏";
      setChatMessages([...newMessages, { role: 'assistant', content: fallback, actions: buildChatActions(fallback + ' sign up sign in') }]);
      setChatLoading(false);
      return;
    }

    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...newMessages.slice(-8).map(m => ({ role: m.role, content: m.content })),
          ],
          temperature: 0.7, max_tokens: 400,
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't quite catch that. Could you rephrase? 😊";
      setChatMessages([...newMessages, { role: 'assistant', content: reply, actions: buildChatActions(reply) }]);
    } catch {
      setChatMessages([...newMessages, { role: 'assistant', content: "I'm having trouble connecting right now. Please try again in a moment, or contact the church office. 🙏" }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ---- Helpers ----
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const goSlide = (i) => {
    setHeroIndex(i);
    clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length), 6000);
  };

  const prevSlide = () => goSlide((heroIndex - 1 + HERO_SLIDES.length) % HERO_SLIDES.length);
  const nextSlide = () => goSlide((heroIndex + 1) % HERO_SLIDES.length);

  const scrollToSection = (id) => {
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <>
      {/* ---- NAVBAR ---- */}
      <nav className="hp-navbar">
        <a className="hp-navbar-brand" href="/">
          <img src="/assets/LOGO.png" alt="Joyful Sound Church International Logo" className="hp-navbar-logo" fetchPriority="high" decoding="async" />
          <div className="hp-navbar-title">
            Joyful Sound Church
            <span>International</span>
          </div>
        </a>

        <div className={`hp-navbar-links ${mobileNavOpen ? 'open' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>About</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('services'); }}>Services</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('activities'); }}>Activities</a>
          <a href="#" className="hp-nav-isom" onClick={(e) => { e.preventDefault(); scrollToSection('isom'); }} title="ISOM"><img src="/assets/ISOM_Logo.png" alt="ISOM" className="hp-nav-isom-icon" /></a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('news'); }}>Events</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('pastors'); }}>Pastors</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('location'); }}>Location</a>
          <a href="/login" className="hp-btn-login"><i className="fas fa-sign-in-alt"></i> Login</a>
        </div>

        <div className="hp-navbar-actions">
          <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
            <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
          <button className="hp-nav-toggle" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            <i className={`fas ${mobileNavOpen ? 'fa-times' : 'fa-bars'}`}></i>
          </button>
        </div>
      </nav>

      {/* ---- HERO CAROUSEL ---- */}
      <section className="hp-hero">
        {HERO_SLIDES.map((slide, i) => (
          <div key={i} className={`hp-hero-slide ${i === heroIndex ? 'active' : ''}`}>
            <img src={slide.img} alt={slide.title} className="hp-hero-slide-img" />
          </div>
        ))}

        <div className="hp-hero-overlay">
          <img src="/assets/LOGO.png" alt="Joyful Sound Church International Logo" className="hp-hero-logo" />
          <h1 className="hp-hero-heading">Joyful Sound Church</h1>
          <p className="hp-hero-sub">International</p>
          <p className="hp-hero-tagline">{HERO_SLIDES[heroIndex].sub}</p>
          <div className="hp-hero-buttons">
            <a href="/signup" className="hp-btn-primary">
              <i className="fas fa-user-plus"></i> Join Our Family
            </a>
            <a href="#about" className="hp-btn-outline" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>
              <i className="fas fa-info-circle"></i> Learn More
            </a>
          </div>
        </div>

        <button className="hp-hero-arrow left" onClick={prevSlide}>
          <i className="fas fa-chevron-left"></i>
        </button>
        <button className="hp-hero-arrow right" onClick={nextSlide}>
          <i className="fas fa-chevron-right"></i>
        </button>

        <div className="hp-hero-dots">
          {HERO_SLIDES.map((_, i) => (
            <button key={i} className={`hp-hero-dot ${i === heroIndex ? 'active' : ''}`} onClick={() => goSlide(i)} />
          ))}
        </div>

        {/* The events are the thing most visitors came for, and they sit far down
            the page - this drops them straight there. */}
        <button
          type="button"
          className="hp-hero-jump"
          onClick={() => scrollToSection('news')}
          aria-label="Jump to upcoming events"
        >
          <span>Events</span>
          <i className="fas fa-chevron-down"></i>
        </button>
      </section>

      {/* ---- WELCOME / ABOUT ---- */}
      <section id="about" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Welcome to Our Church</h2>
          <p>A community of believers passionate about God&apos;s Word, worship, and reaching the nations</p>
        </div>

        <div className="hp-welcome-grid hp-animate">
          <div className="hp-welcome-img-wrapper">
            <img src="/assets/worship-service.jpg" alt="Church worship" loading="lazy" decoding="async" />
            <div className="hp-welcome-img-badge">
              <i className="fas fa-church"></i>&nbsp; Est. by God&apos;s Grace
            </div>
          </div>

          <div className="hp-welcome-text">
            <h3>Bringing the Joy of the Lord to Every Nation</h3>
            <p>
              SanctuaryHub is a vibrant, Spirit-filled community 
              committed to spreading the gospel of Jesus Christ. Under the leadership 
              of our Senior Pastors Dr. Weldon and Dr. Dorothy Pior, we are a family 
              that worships, grows, and serves together.
            </p>
            <p>
              Whether you&apos;re seeking a church home, looking for fellowship, or simply 
              curious about the Christian faith — you are welcome here. Come experience 
              the love of God in an atmosphere of praise and genuine community.
            </p>

            <div className="hp-welcome-highlights">
              <div className="hp-highlight-item">
                <i className="fas fa-bible"></i>
                <span>Bible-Centered Teaching</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-music"></i>
                <span>Spirit-Filled Worship</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-hands-helping"></i>
                <span>Community Outreach</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-users"></i>
                <span>Youth & Family Ministry</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- SERVICE TIMES ---- */}
      <div className="hp-section-dark">
        <section id="services" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Service Times</h2>
            <p>Join us for worship and fellowship throughout the week</p>
          </div>

          <div className="hp-services-grid hp-animate">
            {SERVICE_TIMES.map((s, i) => (
              <div className="hp-service-card" key={i}>
                <div className="hp-service-icon">
                  <i className={`fas ${s.icon}`}></i>
                </div>
                <h4>{s.name}</h4>
                <div className="hp-service-time">{s.time}</div>
                <div className="hp-service-day">Every {s.day}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- DAILY VERSE ---- */}
      <section className="hp-section hp-animate">
        <div className="hp-section-header">
          <div className="hp-divider"></div>
          <h2>Verse of the Day</h2>
          <p>Be inspired by God&apos;s Word today</p>
        </div>

        <div className="hp-verse-wrapper">
          <div className="hp-verse-icon">
            <i className="fas fa-book-open"></i>
          </div>
          <p className="hp-verse-text">
            {dailyVerse.verse || 'Loading verse of the day...'}
          </p>
          <p className="hp-verse-ref">— {dailyVerse.reference || 'Loading...'}</p>
        </div>
      </section>

      {/* ---- ACTIVITIES ---- */}
      <div className="hp-section-dark">
        <section id="activities" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Church Activities</h2>
            <p>Discover the many ways you can connect, grow, and serve in our community</p>
          </div>

          <div className="hp-activities-grid">
            {ACTIVITIES.map((a, i) => (
              <div className="hp-activity-card hp-animate" key={i} style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className="hp-activity-img-wrapper">
                  <img src={a.photo} alt={a.title} className="hp-activity-img" loading="lazy" decoding="async" />
                  <div className="hp-activity-badge">{a.badge}</div>
                </div>
                <div className="hp-activity-body">
                  <h4>{a.title}</h4>
                  <p>{a.desc}</p>
                  <div className="hp-activity-meta">
                    <i className="fas fa-calendar-alt"></i> {a.badge} Activity
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- ISOM ---- */}
      <section id="isom" className="hp-isom">
        <div className="hp-isom-dotgrid"></div>
        <div className="hp-isom-wave hp-isom-wave-left"></div>
        <div className="hp-isom-wave hp-isom-wave-right"></div>

        <div className="hp-isom-inner">
          <div className="hp-isom-topbar hp-animate">
            <span className="hp-isom-eyebrow"><i className="fas fa-star"></i> Now Enrolling</span>
            <div className="hp-isom-quote">
              <i className="fas fa-quote-left"></i>
              <p>Raising Kingdom Leaders.<br />Impacting Nations.</p>
            </div>
          </div>

          <div className="hp-isom-grid hp-animate">
            <div className="hp-isom-left">
              <div className="hp-isom-brandrow">
                <img src="/assets/ISOM_Logo.png" alt="ISOM Logo" className="hp-isom-logo-sm" loading="lazy" decoding="async" />
                <span className="hp-isom-brandrow-divider"></span>
                <span className="hp-isom-brandrow-text">International<br />School of<br />Ministries</span>
              </div>

              <h2 className="hp-isom-title">International School<br />of <span>Ministries</span></h2>
              <p className="hp-isom-sub">{isomData.subtitle}</p>

              <div className="hp-isom-badges">
                {isomData.bullets.map((b, i) => (
                  <div className="hp-isom-badge" key={i}>
                    <div className="hp-isom-badge-icon">
                      <i className={`fas ${ISOM_BULLET_ICONS[i % ISOM_BULLET_ICONS.length]}`}></i>
                    </div>
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              <div className="hp-isom-actions">
                <button type="button" className="hp-isom-btn" onClick={openIsomInquire}>
                  Inquire / Enroll Now
                  <span className="hp-isom-btn-arrow"><i className="fas fa-arrow-right"></i></span>
                </button>
                <a href="/isom" className="hp-isom-outline-btn">
                  <i className="fas fa-circle-info"></i> Learn More About ISOM
                </a>
              </div>
            </div>

            <div className="hp-isom-right">
              <div className="hp-isom-carousel">
                {isomData.slides.map((slide, i) => (
                  <img
                    key={i}
                    src={slide.url}
                    alt={`ISOM ${i + 1}`}
                    loading="lazy"
                    decoding="async"
                    className={`hp-isom-slide ${i === isomIndex ? 'active' : ''}`}
                  />
                ))}
                <button className="hp-isom-arrow left" aria-label="Previous"
                  onClick={() => setIsomIndex((isomIndex - 1 + isomData.slides.length) % isomData.slides.length)}>
                  <i className="fas fa-chevron-left"></i>
                </button>
                <button className="hp-isom-arrow right" aria-label="Next"
                  onClick={() => setIsomIndex((isomIndex + 1) % isomData.slides.length)}>
                  <i className="fas fa-chevron-right"></i>
                </button>
                <div className="hp-isom-dots">
                  {isomData.slides.map((_, i) => (
                    <button key={i} className={`hp-isom-dot ${i === isomIndex ? 'active' : ''}`}
                      aria-label={`Slide ${i + 1}`} onClick={() => setIsomIndex(i)} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="hp-isom-statsbar hp-animate">
            <div className="hp-isom-stat hp-isom-stat-date">
              <i className="fas fa-calendar-day"></i>
              <div>
                <span className="hp-isom-stat-label">Classes Begin</span>
                <span className="hp-isom-stat-value">{isomData.class_start_date}</span>
              </div>
            </div>
            <div className="hp-isom-stat"><i className="fas fa-graduation-cap"></i><span>Spirit-Filled Learning</span></div>
            <div className="hp-isom-stat"><i className="fas fa-people-group"></i><span>Global Community</span></div>
            <div className="hp-isom-stat"><i className="fas fa-earth-americas"></i><span>Transforming Lives</span></div>
          </div>
        </div>
      </section>

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

                <button type="button" className="hp-reg-choice-back" onClick={() => setRegChoiceScreen('how')}>
                  <i className="fas fa-arrow-left"></i> Back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- GUEST REGISTRATION ---- */}
      {guestRegEvent && (
        <div className="hp-evt-overlay hp-reg-overlay" onClick={closeGuestRegistration}>
          <div className="hp-isom-inquire-modal" onClick={(e) => e.stopPropagation()}>
            {guestRegResult?.ok ? (
              <div className="hp-reg-done">
                <div className="hp-reg-done-check"><i className="fas fa-check"></i></div>
                <h3>{isBulk
                  ? `${fullRoster().length} ${fullRoster().length === 1 ? 'person is' : 'people are'} registered!`
                  : `Thank you${guestRegForm.firstName ? `, ${guestRegForm.firstName.trim()}` : ''}!`}</h3>
                <p className="hp-reg-done-see">
                  See you on {new Date(guestRegEvent.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
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
                  <button className="hp-evt-close hp-reg-close" onClick={closeGuestRegistration} aria-label="Close"><i className="fas fa-times"></i></button>
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
                          onBlur={() => setTimeout(() => setChurchOpen(false), 160)}
                          placeholder="e.g. Joyful Sound Church - International"
                          autoComplete="off"
                        />
                        {churchOpen && churchOptions.length > 0 && (
                          <ul className="hp-church-list">
                            {churchOptions.map((c) => (
                              <li key={c.name}>
                                <button type="button" onMouseDown={() => { setGuestRegForm((f) => ({ ...f, churchName: c.name })); setChurchOpen(false); }}>
                                  <span>{c.name}</span>
                                  <em>{c.count} registered</em>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {guestFieldErrors.churchName
                          ? <small className="hp-field-error">{guestFieldErrors.churchName}</small>
                          : <small className="hp-field-hint">Write it in full, e.g. &quot;Joyful Sound Church - International&quot;.</small>}
                      </div>

                      <div className="hp-isom-inquire-row">
                        <div className="hp-form-group">
                          <label>Church Pastor *</label>
                          {/* "Ptr." is fixed, so only the name is typed */}
                          <div className={`hp-prefix-input ${guestFieldErrors.churchPastor ? 'invalid' : ''}`}>
                            <span>Ptr.</span>
                            <input type="text" value={guestRegForm.churchPastor} onChange={(e) => { setGuestRegForm({ ...guestRegForm, churchPastor: e.target.value }); clearGuestFieldError('churchPastor'); }} placeholder="Juan Cruz" />
                          </div>
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
                                <span className="hp-reg-addon-fee">+&#8369;{Number(a.fee) || 0}</span>
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
                                    <em>+&#8369;{Number(x.fee) || 0}</em>
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
                        <button type="button" className="hp-reg-back" onClick={backToRegType} disabled={guestRegSubmitting}>
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

                        {/* Extras are per person - only some of a group usually need
                            accommodation, so they are ticked with the name. */}
                        {(guestRegEvent.event_addons || []).length > 0 && (
                          <div className="hp-bulk-addons">
                            {guestRegEvent.event_addons.map((x) => (
                              <label className={`hp-bulk-addon ${draft.addonIds.includes(x.id) ? 'on' : ''} ${x.is_required ? 'locked' : ''}`} key={x.id}>
                                <input type="checkbox" checked={draft.addonIds.includes(x.id)} disabled={x.is_required} onChange={() => toggleDraftAddon(x)} />
                                <span>{x.question}</span>
                                <em>+&#8369;{Number(x.fee) || 0}</em>
                              </label>
                            ))}
                          </div>
                        )}

                        {/* Already on this event: say who, and where their payment
                            stands, rather than a bare "already registered". */}
                        {draftError === 'already-registered' ? (() => {
                          const info = dupInfoFor(draft.firstName, draft.lastName);
                          const chip = statusChip(info?.status);
                          return (
                            <p className="hp-dup-warn">
                              <i className="fas fa-triangle-exclamation"></i>
                              <span>
                                <b className="hp-dup-name">{`${draft.firstName.trim()} ${draft.lastName.trim()}`}</b>
                                <span className={`hp-status-chip ${chip.cls}`}>{chip.label}</span>
                                <br />is already registered for this event, so they cannot be added again.
                              </span>
                            </p>
                          );
                        })() : draftError ? <small className="hp-field-error">{draftError}</small> : null}

                        <button type="button" className="hp-bulk-add" onClick={commitAttendee}>
                          <i className={`fas ${editingAttendee == null ? 'fa-plus' : 'fa-check'}`}></i>
                          {editingAttendee == null ? ' Add Attendee' : ' Save Changes'}
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
                                        </span>
                                        {guestFieldErrors[`attendee-${listIndex}`] && (
                                          <small className="hp-field-error">{guestFieldErrors[`attendee-${listIndex}`]}</small>
                                        )}
                                      </td>
                                      <td data-label="Registration Fee">&#8369;{guestBaseAmount(guestRegEvent)}</td>
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
                              Already registered &mdash; extras only:{repTopUpAddons().map((x) => ` ${x.question} ₱${Number(x.fee) || 0}`).join(',')}
                            </div>
                          </div>
                        )}
                        {isBulk ? fullRoster().map((a, i) => (
                          <div className="hp-receipt-person" key={i}>
                            <div className="hp-receipt-line">
                              <span><b>{`${a.firstName} ${a.lastName}`.trim() || `Person ${i + 1}`}</b>{a.isRep && <em className="hp-bulk-you">You</em>}</span>
                              <b>&#8369;{attendeeAmount(a)}</b>
                            </div>
                            <div className="hp-receipt-sub">
                              Registration &#8369;{guestBaseAmount(guestRegEvent)}
                              {(guestRegEvent.event_addons || [])
                                .filter((x) => a.addonIds.includes(x.id))
                                .map((x) => ` + ${x.question} ₱${Number(x.fee) || 0}`)
                                .join('')}
                            </div>
                          </div>
                        )) : (
                          <>
                            <div className="hp-receipt-line">
                              <span>Registration Fee</span>
                              <b>&#8369;{guestBaseAmount(guestRegEvent)}</b>
                            </div>
                            {(guestRegEvent.event_addons || []).filter((a) => guestRegAddonIds.includes(a.id)).map((a) => (
                              <div className="hp-receipt-line" key={a.id}>
                                <span>Extras ({a.question})</span>
                                <b>&#8369;{Number(a.fee) || 0}</b>
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

                      {(guestRegEvent.payment_methods || []).length > 1 && (
                        <div className="hp-form-group">
                          <label>Payment Method *</label>
                          <select className="hp-form-control" value={guestRegForm.paymentMethod} onChange={(e) => setGuestRegForm({ ...guestRegForm, paymentMethod: e.target.value })}>
                            <option value="">Select&hellip;</option>
                            {guestRegEvent.payment_methods.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Nobody can hand over cash for this one, so say it plainly
                          before they arrive expecting to pay at the door. */}
                      {(guestRegEvent.payment_methods || []).length > 0
                        && !(guestRegEvent.payment_methods || []).some((m) => /cash|church|walk/i.test(m) && !/gcash/i.test(m)) && (
                        <p className="hp-pay-online-only">
                          <i className="fas fa-circle-exclamation"></i>
                          <span><strong>Online payment only.</strong> We do not accept cash for this event &mdash; please pay through the account below and upload your receipt.</span>
                        </p>
                      )}

                      {guestRegEvent.payment_instructions && <p className="hp-reg-instructions">{guestRegEvent.payment_instructions}</p>}

                      {/* GCash: QR first, account name and number BELOW it. */}
                      {(guestRegEvent.gcash_number || guestRegEvent.gcash_qr_url) && guestShowsMethod('GCash') && (
                        <div className="hp-pay-card">
                          <div className="hp-pay-card-head"><i className="fas fa-mobile-screen-button"></i> GCash</div>
                          {guestRegEvent.gcash_qr_url && (
                            <div className="hp-pay-qr">
                              <img src={guestRegEvent.gcash_qr_url} alt="GCash QR code" />
                              <button type="button" className="hp-pay-qr-dl" onClick={() => downloadQr(guestRegEvent.gcash_qr_url, guestRegEvent.title)}>
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

                      {guestRegEvent.bank_account_number && guestShowsMethod('Bank Transfer') && (
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
                          <div className="hp-pay-card-head"><i className="fas fa-receipt"></i> Payment Details</div>
                          {payFieldRows()}
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

      {/* ---- UPCOMING EVENTS ---- */}
      <section id="news" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Church Upcoming Events</h2>
          <p>Stay updated with the upcoming events in our church community</p>
        </div>

        <div className="hp-invite-grid">
          {newsEvents.length > 0 ? (
            newsEvents.map((evt, i) => (
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
                    ? <img src={evt.image_url} alt={evt.title} className="hp-invite-hero-img" loading="lazy" decoding="async" />
                    : <span className="hp-invite-hero-ph"><i className="fas fa-calendar-day"></i></span>}

                  <span className="hp-invite-pill"><i className="fas fa-star"></i> UPCOMING EVENT</span>
                </div>
              </button>
            ))
          ) : (
            <div className="hp-empty-state hp-animate">
              <div className="hp-empty-state-icon"><i className="fas fa-calendar-xmark"></i></div>
              <h3>No Upcoming Events</h3>
              <p>There are no events scheduled right now. Check back soon — we&apos;re always planning something new!</p>
            </div>
          )}
        </div>
      </section>

      {/* ---- EVENT DETAILS MODAL ---- */}
      {detailEvent && (
        <div className="hp-evt-overlay" onClick={() => setDetailEvent(null)}>
          <div className="hp-evt-modal" onClick={(e) => e.stopPropagation()}>
            <button className="hp-evt-close" onClick={() => setDetailEvent(null)} aria-label="Close"><i className="fas fa-times"></i></button>

            {detailEvent.image_url ? (
              <img src={detailEvent.image_url} alt={detailEvent.title} className="hp-evt-banner" />
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
                <span className={`hp-event-fee ${detailEvent.has_fee ? 'paid' : 'free'}`}>{detailEvent.has_fee ? `₱${detailEvent.registration_fee}` : 'Free Event'}</span>
                {detailEvent.allowed_roles && detailEvent.allowed_roles.length > 0 && <span className="hp-event-roles">{detailEvent.allowed_roles.join(', ')} only</span>}
              </div>

              <h2 className="hp-evt-title">{detailEvent.title}</h2>
              {detailEvent.description && <p className="hp-evt-text">{detailEvent.description}</p>}

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
                {detailEvent.has_fee && detailEvent.payment_instructions && (
                  <div className="hp-evt-info-row">
                    <i className="fas fa-money-check-dollar"></i>
                    <div><span className="hp-evt-info-label">Payment</span><span style={{ whiteSpace: 'pre-wrap' }}>{detailEvent.payment_instructions}</span></div>
                  </div>
                )}
              </div>

              {detailEvent.registration_required !== false && (() => {
                const left = detailEvent.slots_left != null ? detailEvent.slots_left : (detailEvent.max_participants ? Math.max(0, detailEvent.max_participants - (detailEvent.registered_count || 0)) : null);
                const full = left != null && left <= 0;
                // Registration can be scheduled to open later; until that moment the
                // button is dead rather than letting someone submit and be rejected.
                const opensAt = detailEvent.registration_start_date ? new Date(detailEvent.registration_start_date) : null;
                const notOpenYet = opensAt && !Number.isNaN(opensAt.getTime()) && Date.now() < opensAt.getTime();
                const closesAt = detailEvent.registration_deadline ? new Date(detailEvent.registration_deadline) : null;
                const closed = closesAt && !Number.isNaN(closesAt.getTime()) && Date.now() > closesAt.getTime();

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
        </div>
      )}

      {/* ---- PASTORS ---- */}
      <div className="hp-section-dark">
        <section id="pastors" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Our Pastors</h2>
            <p>Meet the dedicated leaders shepherding our church family</p>
          </div>

          <div className="hp-pastors-grid hp-animate">
            {PASTORS.map((p, i) => (
              <div className="hp-pastor-card" key={i}>
                <div className="hp-pastor-photo-wrapper">
                  <img src={p.photo} alt={p.name} loading="lazy" decoding="async" />
                </div>
                <h4>{p.name}</h4>
                <div className="hp-pastor-role">{p.title}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- VISIT US / MAP ---- */}
      <section id="location" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Visit Us</h2>
          <p>Come and experience worship with us — here&apos;s where you can find our church</p>
        </div>

        <div className="hp-map-wrapper hp-animate">
          <div className="hp-map-info">
            <div className="hp-map-info-icon">
              <i className="fas fa-map-marker-alt"></i>
            </div>
            <h3>SanctuaryHub</h3>
            <p>Join us for Sunday Worship Service every week. Everyone is welcome!</p>
            <div className="hp-map-details">
              <div className="hp-map-detail-item">
                <i className="fas fa-clock"></i>
                <span>Sunday Worship: 9:00 AM</span>
              </div>
              <div className="hp-map-detail-item">
                <i className="fas fa-book-bible"></i>
                <span>Friday Bible Study: 7:00 PM</span>
              </div>
              <div className="hp-map-detail-item">
                <i className="fas fa-phone"></i>
                <span>Contact us for more info</span>
              </div>
            </div>
          </div>
          <div className="hp-map-embed">
            <iframe
              src="https://www.google.com/maps/embed?pb=!4v1772207931266!6m8!1m7!1sdo9Akv3QAW6kJETCDEd_HQ!2m2!1d10.31957253395332!2d123.8994709106599!3f236.24502041751504!4f2.753458141938296!5f0.7820865974627469"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allow="accelerometer; gyroscope; magnetometer; fullscreen"
              title="SanctuaryHub Location"
            ></iframe>
          </div>
        </div>
      </section>

      {/* ---- CTA BANNER ---- */}
      <section className="hp-cta">
        <h2>Join Our Church Family Today</h2>
        <p>
          We&apos;d love to welcome you! Whether online or in person, there&apos;s a place for you at SanctuaryHub.
        </p>
        <a href="/signup" className="hp-btn-primary">
          <i className="fas fa-user-plus"></i> Create an Account
        </a>
      </section>

      {/* ---- FOOTER ---- */}
      <footer className="hp-footer">
        <div className="hp-footer-grid">
          {/* About col */}
          <div className="hp-footer-about">
            <div className="hp-footer-brand">
              <img src="/assets/LOGO.png" alt="SanctuaryHub" loading="lazy" decoding="async" />
              <h3>
                SanctuaryHub
              </h3>
            </div>
            <p>
              A Spirit-filled community of believers dedicated to spreading the gospel, 
              building disciples, and making a lasting impact for God&apos;s kingdom.
            </p>
            <div className="hp-footer-socials">
              <a href="https://www.facebook.com/CebuCityJoyfulSound" target="_blank" rel="noopener noreferrer" title="Facebook"><i className="fab fa-facebook-f"></i></a>
              <a href="https://www.youtube.com/@JoyfulSoundChurchCebuCity" target="_blank" rel="noopener noreferrer" title="YouTube"><i className="fab fa-youtube"></i></a>
              <span className="hp-social-disabled" title="Instagram (coming soon)"><i className="fab fa-instagram"></i></span>
              <span className="hp-social-disabled" title="TikTok (coming soon)"><i className="fab fa-tiktok"></i></span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="hp-footer-col">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#about"><i className="fas fa-chevron-right"></i> About Us</a></li>
              <li><a href="#services"><i className="fas fa-chevron-right"></i> Service Times</a></li>
              <li><a href="#activities"><i className="fas fa-chevron-right"></i> Activities</a></li>
              <li><a href="#news"><i className="fas fa-chevron-right"></i> Events</a></li>
              <li><a href="#pastors"><i className="fas fa-chevron-right"></i> Our Pastors</a></li>
              <li><a href="#location"><i className="fas fa-chevron-right"></i> Visit Us</a></li>
            </ul>
          </div>

          {/* Ministry */}
          <div className="hp-footer-col">
            <h4>Ministries</h4>
            <ul>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Praise & Worship</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Media Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Dance Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Ushering Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Youth Ministry</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="hp-footer-col">
            <h4>Get in Touch</h4>
            <ul>
              <li><a href="#"><i className="fas fa-map-marker-alt"></i> Church Location</a></li>
              <li><a href="#"><i className="fas fa-phone"></i> Contact Us</a></li>
              <li><a href="#"><i className="fas fa-envelope"></i> Email Us</a></li>
              <li><a href="/login"><i className="fas fa-sign-in-alt"></i> Member Login</a></li>
              <li><a href="/signup"><i className="fas fa-user-plus"></i> Sign Up</a></li>
            </ul>
          </div>
        </div>

        <div className="hp-footer-bottom">
          <p>&copy; {new Date().getFullYear()} <span>SanctuaryHub</span>. All rights reserved.</p>
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
            {chatMessages.map((m, i) => (
              <div key={i} className={`hp-chat-msg ${m.role}`}>
                <div className="hp-chat-bubble">
                  {m.role === 'assistant' ? renderRichText(m.content) : m.content}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="hp-chat-actions">
                    {m.actions.map((a, j) => (
                      <a key={j} href={a.href} className="hp-chat-action-btn">
                        <i className={`fas ${a.icon}`}></i> {a.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="hp-chat-msg assistant">
                <div className="hp-chat-bubble hp-chat-typing">
                  <span></span><span></span><span></span>
                </div>
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
