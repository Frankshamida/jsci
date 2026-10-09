'use client';

import { useEffect, useState } from 'react';
import { subscribeCheckinDisplay } from '@/lib/checkinDisplay';
import { isPosterUrl } from '@/lib/mealsDisplay';
import { eventImageUrl } from '@/lib/eventImage';
import {
  AppBar, FlipId, RotateHint, UpNext, datesOf, fmtDay, idNames, timeOf, TZ, useAppShell, useTapLine, useWakeLock,
} from '@/components/NameScreen';
import { StationBar, STATION_ID, useScanStation } from '@/components/ScanStation';
import './checkinDisplay.css';

// The screen at the door (/rfid-chekin-display). Put it on a TV or a monitor
// facing the queue, driven by "Scan RFID to Check In":
//
//   left   WELCOME DELEGATES, and the event - its name, dates, venue, the day
//   right  the front of the ID, big. Every card tapped turns it over to that
//          attendee's own ID, their name printed as the ID prints it; with
//          nobody at the door it turns back to the blank ID.
//
// Under the card, whether they are in - welcome, already in, see the desk.
//
// Cards tapped faster than one turn of the card each wait their turn: every
// name gets its moment on the ID, in tap order, and the ones still to come
// are listed under the welcome. Two ways in, side by side: the dashboard's
// "Scan RFID to Check In" sends its taps here, and a reader plugged into this
// screen's own computer checks people in right here (components/ScanStation).

// How long an attendee's ID stays up with nobody else tapping.
const HOLD_MS = 12000;
// The installed app's own service worker - see public/checkin-sw.js.
const WORKER = { url: '/checkin-sw.js', scope: '/rfid-chekin-display' };

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };
// Still being answered - the card waits on these.
const isBusy = (tap) => tap?.status === 'reading' || tap?.status === 'checking' || tap?.status === 'waiting';

// What it says under the card for each outcome at the door.
function describe(tap, day, days) {
  const onDay = days > 1 ? `Day ${tap.day || day}` : 'today';
  switch (tap.status) {
    case 'checked_in':
      return { tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome! You’re checked in', note: `Checked in for ${onDay}${tap.attendedAt ? ` · ${timeOf(tap.attendedAt)}` : ''}` };
    case 'checking':
      return { tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome!', note: `Checking you in for ${onDay}…`, busy: true };
    case 'already_in':
      return { tone: 'warn', icon: 'fa-clock-rotate-left', headline: 'Already checked in', note: tap.attendedAt ? `You checked in for ${onDay} at ${timeOf(tap.attendedAt)}` : `You are already in for ${onDay}` };
    case 'not_verified':
      return { tone: 'bad', icon: 'fa-user-clock', headline: 'Not verified yet', note: 'Please see the registration desk.' };
    case 'unknown':
      return { tone: 'bad', icon: 'fa-circle-exclamation', headline: 'Card not recognised', note: 'Please see the person at the desk.' };
    case 'error':
      return { tone: 'bad', icon: 'fa-rotate-right', headline: 'Please tap again', note: 'Your card could not be read just now.' };
    default:
      return { tone: 'info', icon: 'fa-wifi', headline: 'Welcome!', note: 'Checking your card…', busy: true };
  }
}

export default function CheckinDisplayPage() {
  const shell = useAppShell({ worker: WORKER });
  const [desk, setDesk] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [now, setNow] = useState(() => new Date());
  const line = useTapLine(isBusy, { hold: HOLD_MS });

  // Every desk's taps, as they come. The door sends one tap at a time, so
  // each is added to the ones before it (merge) - fed as it arrives rather
  // than through state, so two arriving together are both kept.
  useEffect(() => subscribeCheckinDisplay((msg) => {
    if (msg.from === STATION_ID) return; // this screen's own, fed below
    setDesk(msg);
    line.feed(msg.from || 'desk', Array.isArray(msg.taps) ? msg.taps : (msg.tap ? [msg.tap] : []), msg.at, { merge: !Array.isArray(msg.taps) });
  }, setStatus), []); // eslint-disable-line react-hooks/exhaustive-deps

  // This screen's own reader.
  const station = useScanStation({ kind: 'checkin', desk: { eventId: desk?.event?.id, day: desk?.day?.number } });
  useEffect(() => { line.feed('here', station.line, Date.now()); }, [station.line]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock in the corner of the welcome.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  useWakeLock();

  // Scanning here: this screen's own event and day. Otherwise the desk's.
  const head = station.head || desk || {};
  const event = head.event || {};
  const poster = isPosterUrl(event.image) ? event.image : '';
  const day = Number(head.day?.number) || 1;
  const days = Number(head.day?.days) || 1;
  const dayLabel = head.day?.label && head.day.label !== `Day ${day}` ? head.day.label : '';
  const dayDate = head.day?.date ? fmtDay(head.day.date, { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const dates = datesOf(event.start, event.end);
  const venue = [event.venue, event.city && event.city !== event.venue ? event.city : ''].filter(Boolean).join(' · ');

  // Who the card shows: the attendee tapped, the blank ID for a card nobody
  // holds, nothing new while a card is still being read.
  const { tap, waiting } = line;
  const names = tap ? idNames(tap) : null;
  const reading = tap && !names && isBusy(tap);
  const who = !tap ? { key: 'idle', names: null, idle: true }
    : names ? { key: `p-${tap.id}`, names }
      : reading ? null
        : { key: `b-${tap.id}`, names: null };
  const d = tap ? describe(tap, day, days) : null;

  return (
    <main className={`rcd ${waiting.length ? 'has-line' : ''}`}>
      <div
        className={`rcd-bg ${poster ? '' : 'is-plain'}`}
        style={poster ? { backgroundImage: `url("${eventImageUrl(poster, 1280)}")` } : undefined}
        aria-hidden="true"
      />
      <div className="rcd-shade" aria-hidden="true" />

      {/* ---- Left: the welcome ---- */}
      <section className="rcd-welcome">
        <div className="rcd-brand">
          <img src="/assets/LOGO.png" alt="" />
          <span>Joyful Sound Church<small>International</small></span>
        </div>

        <h1 className="rcd-hello">
          <span>Welcome</span>
          <span>Delegates</span>
        </h1>

        <div className="rcd-event">
          {poster && <img className="rcd-poster" src={eventImageUrl(poster, 320)} alt="" />}
          <div>
            <h2>{event.title || 'Welcome to the event'}</h2>
            <ul className="rcd-facts">
              {dates && <li><i className="fas fa-calendar-days"></i> {dates}</li>}
              {venue && <li><i className="fas fa-location-dot"></i> {venue}</li>}
            </ul>
          </div>
        </div>

        {(days > 1 || dayDate) && (
          <p className="rcd-day">
            <i className="fas fa-id-card"></i>
            <span>
              Check-in{days > 1 ? ` · Day ${day}` : ''}{dayLabel ? ` · ${dayLabel}` : ''}
              {dayDate && <small>{dayDate}</small>}
            </span>
          </p>
        )}

        {waiting.length > 0 ? <UpNext waiting={waiting} /> : (
          <p className="rcd-clock" aria-hidden="true">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}
          </p>
        )}
      </section>

      {/* ---- Right: the ID ---- */}
      <section className="rcd-idside" aria-live="polite">
        <FlipId who={who} />
        <div className={`rcd-say ${d ? `is-${d.tone}` : 'is-idle'}`} key={tap ? `${tap.id}-${tap.status}` : 'idle'}>
          {d ? (
            <>
              <b><i className={`fas ${d.busy ? 'fa-spinner fa-spin' : d.icon}`}></i> {d.headline}</b>
              {d.note && <span>{d.note}</span>}
            </>
          ) : (
            <>
              <b><i className="fas fa-wifi rcd-wifi"></i> Tap your ID card</b>
              <span>Hold it on the reader - your ID turns over with your name.</span>
            </>
          )}
        </div>
      </section>

      <div className="rcd-corner">
        <StationBar station={station} />
        <div className={`rcd-status is-${status}`} role="status">
          <span className="rcd-dot" aria-hidden="true"></span>
          {STATUS_LABEL[status] || status}
        </div>
      </div>

      <AppBar shell={shell} appName="Check-in" />
      <RotateHint what="The check-in screen" />
    </main>
  );
}
