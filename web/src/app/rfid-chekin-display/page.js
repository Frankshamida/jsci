'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeCheckinDisplay } from '@/lib/checkinDisplay';
import { isPosterUrl } from '@/lib/mealsDisplay';
import { eventImageUrl } from '@/lib/eventImage';
import { formatPersonName } from '@/lib/eventFormat';
// The same look as the Meals Counter's screen - one family of signs at one
// event, read the same way from across the room.
import '../rfid-meals-display/mealsDisplay.css';

// The name screen at the door. Put it on a TV or a tablet facing the queue:
// every card tapped at "Scan RFID to Check In" puts that attendee's full name
// up, with whether they are in, over the event's cover. The next tap slides
// the next name in over the last; a quiet door goes back to "Tap your card".

// How long a name stays up with nobody else tapping. Shorter than the meals
// screen: a door queue moves faster than a food line.
const HOLD_MS = 12000;
// How long the name going out takes to leave - matches .rmd-card.leaving.
const LEAVE_MS = 320;

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

const timeOf = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '');

// What the card says for each outcome at the door.
function describe(tap, day, days) {
  const onDay = days > 1 ? `Day ${tap.day || day}` : 'today';
  switch (tap.status) {
    case 'checked_in':
      return {
        tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome! You’re checked in',
        note: `Checked in for ${onDay}${tap.attendedAt ? ` · ${timeOf(tap.attendedAt)}` : ''}`,
      };
    case 'checking':
      return { tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome!', note: `Checking you in for ${onDay}…`, busy: true };
    case 'already_in':
      return {
        tone: 'warn', icon: 'fa-clock-rotate-left', headline: 'Already checked in',
        note: tap.attendedAt ? `You checked in for ${onDay} at ${timeOf(tap.attendedAt)}` : `You are already in for ${onDay}`,
      };
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
  const [msg, setMsg] = useState(null);
  const [status, setStatus] = useState('connecting');
  // The cards on stage: the one coming in, and the ones on their way out.
  // id is the card's own (a React key); match is who it is for.
  const [cards, setCards] = useState([{ id: 0, match: 'idle', tap: null }]);
  const nextId = useRef(1);
  const holdTimer = useRef(null);

  useEffect(() => subscribeCheckinDisplay(setMsg, setStatus), []);

  // A new tap slides in over the last; the same tap moving on (checking →
  // checked in) changes in place, without sliding.
  const show = (tap) => {
    const match = tap ? `tap-${tap.seq}` : 'idle';
    setCards((list) => {
      const live = list.filter((c) => !c.leaving);
      if (live.length === 1 && live[0].match === match) {
        return list.map((c) => (c === live[0] ? { ...c, tap } : c));
      }
      const id = nextId.current;
      nextId.current += 1;
      return [...list.map((c) => (c.leaving ? c : { ...c, leaving: true })), { id, match, tap }];
    });
  };
  useEffect(() => {
    const tap = msg?.tap && Date.now() - msg.at < HOLD_MS ? msg.tap : null;
    show(tap);
    clearTimeout(holdTimer.current);
    if (tap) holdTimer.current = setTimeout(() => show(null), HOLD_MS);
    return () => clearTimeout(holdTimer.current);
  }, [msg]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ones on their way out are dropped once they have left.
  useEffect(() => {
    if (!cards.some((c) => c.leaving)) return undefined;
    const t = setTimeout(() => setCards((list) => list.filter((c) => !c.leaving)), LEAVE_MS);
    return () => clearTimeout(t);
  }, [cards]);

  // A screen that dims mid-queue hides the names; keep it awake.
  useEffect(() => {
    if (!navigator.wakeLock) return undefined;
    let lock = null;
    const grab = () => {
      if (document.hidden) return;
      navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { document.removeEventListener('visibilitychange', grab); lock?.release().catch(() => {}); };
  }, []);

  const event = msg?.event || {};
  const poster = isPosterUrl(event.image) ? event.image : '';
  const day = Number(msg?.day?.number) || 1;
  const days = Number(msg?.day?.days) || 1;
  // "Day 2 · Saturday" - the session name the admin typed, when there is one.
  const dayLabel = msg?.day?.label && msg.day.label !== `Day ${day}` ? msg.day.label : '';
  const onDay = days > 1 ? [`Day ${day}`, dayLabel].filter(Boolean).join(' · ') : '';

  return (
    <main className="rmd">
      {/* The cover, blurred: the event's own colours without its words
          competing with the name. */}
      <div
        className={`rmd-bg ${poster ? '' : 'is-plain'}`}
        style={poster ? { backgroundImage: `url("${eventImageUrl(poster, 1280)}")` } : undefined}
        aria-hidden="true"
      />
      <div className="rmd-shade" aria-hidden="true" />

      <header className="rmd-head">
        {poster && <img className="rmd-poster" src={eventImageUrl(poster, 240)} alt="" />}
        <div>
          <small><i className="fas fa-id-card"></i> Check-in{onDay ? ` · ${onDay}` : ''}</small>
          <h2>{event.title || 'Welcome'}</h2>
        </div>
      </header>

      <section className="rmd-stage" aria-live="polite">
        {cards.map((c) => {
          if (!c.tap) {
            return (
              <div key={c.id} className={`rmd-card rmd-idle ${c.leaving ? 'leaving' : ''}`}>
                <div className="rmd-tap-ring"><i className="fas fa-wifi"></i></div>
                <h1>Tap your card</h1>
                <p>{onDay ? `Checking in for ${onDay}` : 'Your name will appear here'}</p>
              </div>
            );
          }
          const d = describe(c.tap, day, days);
          const name = formatPersonName(c.tap.name);
          return (
            <div key={c.id} className={`rmd-card is-${d.tone} ${c.leaving ? 'leaving' : ''}`}>
              <span className="rmd-badge">
                <i className={`fas ${d.busy ? 'fa-spinner fa-spin' : d.icon}`}></i> {d.headline}
              </span>
              {name && <h1 className={`rmd-name ${name.length > 28 ? 'is-long' : ''}`}>{name}</h1>}
              {c.tap.church && <p className="rmd-church"><i className="fas fa-church"></i> {c.tap.church}</p>}
              {d.note && <p className="rmd-note">{d.note}</p>}
            </div>
          );
        })}
      </section>

      <div className={`rmd-status is-${status}`} role="status">
        <span className="rmd-dot" aria-hidden="true"></span>
        {STATUS_LABEL[status] || status}
      </div>
    </main>
  );
}
