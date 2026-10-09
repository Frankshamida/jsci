'use client';

import { useEffect, useState } from 'react';
import { isPosterUrl, subscribeMealsDisplay, MEAL_LINE_BUSY } from '@/lib/mealsDisplay';
import { eventImageUrl } from '@/lib/eventImage';
import {
  AppBar, FlipId, RotateHint, UpNext, datesOf, fmtDay, idNames, timeOf, TZ, useAppShell, useTapLine, useWakeLock,
} from '@/components/NameScreen';
import { StationBar, STATION_ID, useScanStation } from '@/components/ScanStation';
import '../rfid-chekin-display/checkinDisplay.css';

// The name screen at the Meals Counter (/rfid-meals-display). The same screen
// as the door's (/rfid-chekin-display), turned to the meal: put it on a TV or
// a tablet facing the queue.
//
//   left   the meal being served, the event, and the line - every card
//          tapped is a name here the moment it is read
//   right  the front of the ID, big. It turns over to each attendee in the
//          order they tapped, with whether the meal was given under it.
//
// Two ways in, side by side: the Meals Counter dialog on the dashboard sends
// its taps here, and a reader plugged into this screen's own computer gives
// the meal right here (components/ScanStation.jsx) - no dialog needed.

const MEAL_LABEL = { lunch: 'Lunch', dinner: 'Dinner' };
const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

// What it says under the card for each outcome at the counter. Plain lines
// of its own, never the server's wording: the screen faces the queue.
function describe(tap, mealKind, day, days) {
  const meal = MEAL_LABEL[tap.meal || mealKind] || 'Meal';
  const lower = meal.toLowerCase();
  const onDay = days > 1 ? ` · Day ${tap.day || day}` : '';
  switch (tap.status) {
    case 'served':
      return { tone: 'ok', icon: 'fa-circle-check', headline: `Enjoy your ${lower}!`, note: `${meal}${onDay} recorded${tap.claimedAt ? ` · ${timeOf(tap.claimedAt)}` : ''}` };
    case 'serving':
      return { tone: 'ok', icon: 'fa-utensils', headline: `Enjoy your ${lower}!`, note: `Recording your ${lower}…`, busy: true };
    case 'already':
      return { tone: 'warn', icon: 'fa-clock-rotate-left', headline: `${meal} already claimed`, note: tap.claimedAt ? `Claimed at ${timeOf(tap.claimedAt)}${onDay}` : `Already on the record${onDay}` };
    case 'blocked':
      return { tone: 'bad', icon: 'fa-user-clock', headline: 'Not checked in yet', note: 'Please check in at the registration desk first.' };
    case 'not_verified':
      return { tone: 'bad', icon: 'fa-user-clock', headline: 'Not verified yet', note: 'Please see the registration desk.' };
    case 'unknown':
      return { tone: 'bad', icon: 'fa-circle-exclamation', headline: 'Card not recognised', note: 'Please see the person at the counter.' };
    case 'error':
      return { tone: 'bad', icon: 'fa-rotate-right', headline: 'Please tap again', note: 'Your card could not be read just now.' };
    case 'skipped':
      return { tone: 'warn', icon: 'fa-hand', headline: 'Please see the counter', note: 'Nothing was recorded for this card.' };
    case 'matched':
      return { tone: 'info', icon: 'fa-hand-holding-heart', headline: 'Welcome!', note: `Please wait for your ${lower}.` };
    default: // waiting, reading
      return { tone: 'info', icon: 'fa-wifi', headline: 'Welcome!', note: 'Checking your card…', busy: true };
  }
}

// Still being answered - the card waits on these.
const isBusy = (tap) => MEAL_LINE_BUSY.includes(tap?.status);

export default function MealsDisplayPage() {
  const shell = useAppShell();
  const [desk, setDesk] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [now, setNow] = useState(() => new Date());
  const line = useTapLine(isBusy, { hold: 15000 });

  // Every desk's line, as it comes. Each message is fed as it arrives rather
  // than through state, so two arriving together are both kept.
  useEffect(() => subscribeMealsDisplay((msg) => {
    if (msg.from === STATION_ID) return; // this screen's own, fed below
    setDesk(msg);
    line.feed(msg.from || 'desk', Array.isArray(msg.taps) ? msg.taps : (msg.tap ? [msg.tap] : []), msg.at, { merge: !Array.isArray(msg.taps) });
  }, setStatus), []); // eslint-disable-line react-hooks/exhaustive-deps

  // This screen's own reader.
  const station = useScanStation({
    kind: 'meals',
    desk: { eventId: desk?.event?.id, day: desk?.meal?.day, meal: desk?.meal?.kind },
  });
  useEffect(() => { line.feed('here', station.line, Date.now()); }, [station.line]); // eslint-disable-line react-hooks/exhaustive-deps

  useWakeLock();
  // The clock in the corner of the welcome.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // Scanning here: this screen's own event and meal. Otherwise the desk's.
  const head = station.head || desk || {};
  const event = head.event || {};
  const poster = isPosterUrl(event.image) ? event.image : '';
  const mealKind = head.meal?.kind || '';
  const mealName = MEAL_LABEL[mealKind] || '';
  const day = Number(head.meal?.day) || 1;
  const days = Number(head.meal?.days) || 1;
  const dayLabel = head.meal?.label && head.meal.label !== `Day ${day}` ? head.meal.label : '';
  const dayDate = head.meal?.date ? fmtDay(head.meal.date, { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const dates = datesOf(event.start, event.end);
  const venue = [event.venue, event.city && event.city !== event.venue ? event.city : ''].filter(Boolean).join(' · ');

  // Who the card shows: the attendee whose turn it is, the blank ID for a
  // card nobody holds, nothing new while a card is still being read.
  const { tap, waiting } = line;
  const names = tap ? idNames(tap) : null;
  const reading = tap && !names && isBusy(tap);
  const who = !tap ? { key: 'idle', names: null, idle: true }
    : names ? { key: `p-${tap.id}`, names }
      : reading ? null
        : { key: `b-${tap.id}`, names: null };
  const d = tap ? describe(tap, mealKind, day, days) : null;

  return (
    <main className={`rcd ${waiting.length ? 'has-line' : ''}`}>
      <div
        className={`rcd-bg ${poster ? '' : 'is-plain'}`}
        style={poster ? { backgroundImage: `url("${eventImageUrl(poster, 1280)}")` } : undefined}
        aria-hidden="true"
      />
      <div className="rcd-shade" aria-hidden="true" />

      {/* ---- Left: the meal, and the line ---- */}
      <section className="rcd-welcome">
        <div className="rcd-brand">
          <img src="/assets/LOGO.png" alt="" />
          <span>Joyful Sound Church<small>International</small></span>
        </div>

        <h1 className="rcd-hello">
          <span>{mealName || 'Meals'}</span>
          <span>{mealName ? 'Is served' : 'Counter'}</span>
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

        {(days > 1 || dayDate || mealName) && (
          <p className="rcd-day">
            <i className="fas fa-utensils"></i>
            <span>
              {[mealName || 'Meals', days > 1 ? `Day ${day}` : '', dayLabel].filter(Boolean).join(' · ')}
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
              <span>{mealName ? `${mealName} is being served - your ID turns over with your name.` : 'Hold it on the reader - your ID turns over with your name.'}</span>
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

      <AppBar shell={shell} appName="Meals" />
      <RotateHint what="The meals screen" />
    </main>
  );
}
