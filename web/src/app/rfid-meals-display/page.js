'use client';

import { useEffect, useRef, useState } from 'react';
import { isPosterUrl, subscribeMealsDisplay } from '@/lib/mealsDisplay';
import { eventImageUrl } from '@/lib/eventImage';
import { formatPersonName } from '@/lib/eventFormat';
import './mealsDisplay.css';

// The name screen at the Meals Counter. Put it on a TV or a tablet facing the
// queue: every card tapped at the counter puts that attendee's full name up,
// with whether the meal was given, over the event's cover. The next tap
// slides the next name in over the last; a quiet counter goes back to
// "Tap your card".

// How long a name stays up with nobody else tapping.
const HOLD_MS = 20000;
// How long the name going out takes to leave - matches .rmd-card.leaving.
const LEAVE_MS = 320;

const MEAL_LABEL = { lunch: 'Lunch', dinner: 'Dinner' };
const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

const timeOf = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '');

// What the card says for each outcome at the counter.
function describe(tap, mealKind, day, days) {
  const meal = MEAL_LABEL[tap.meal || mealKind] || 'meal';
  const lower = meal.toLowerCase();
  const onDay = days > 1 ? ` · Day ${tap.day || day}` : '';
  switch (tap.status) {
    case 'served':
      return { tone: 'ok', icon: 'fa-circle-check', headline: `Enjoy your ${lower}!`, note: `${meal}${onDay} recorded` };
    case 'serving':
      return { tone: 'ok', icon: 'fa-utensils', headline: `Enjoy your ${lower}!`, note: `Recording ${lower}…`, busy: true };
    case 'already':
      return { tone: 'warn', icon: 'fa-clock-rotate-left', headline: `${meal} already claimed`, note: tap.claimedAt ? `Claimed at ${timeOf(tap.claimedAt)}${onDay}` : `Already on the record${onDay}` };
    case 'blocked':
      return { tone: 'bad', icon: 'fa-user-clock', headline: 'Not checked in yet', note: 'Please check in at the registration desk first.' };
    case 'unknown':
      return { tone: 'bad', icon: 'fa-circle-exclamation', headline: 'Card not recognised', note: tap.note || 'Please see the person at the counter.' };
    case 'reading':
      return { tone: 'info', icon: 'fa-wifi', headline: 'Welcome!', note: 'Checking your card…', busy: true };
    default:
      return { tone: 'info', icon: 'fa-hand-holding-heart', headline: 'Welcome!', note: 'Please wait for your meal.' };
  }
}

export default function MealsDisplayPage() {
  const [msg, setMsg] = useState(null);
  const [status, setStatus] = useState('connecting');
  // The cards on stage: the one coming in, and the ones on their way out.
  // id is the card's own (a React key); match is who it is for.
  const [cards, setCards] = useState([{ id: 0, match: 'idle', tap: null }]);
  const nextId = useRef(1);
  const holdTimer = useRef(null);

  useEffect(() => subscribeMealsDisplay(setMsg, setStatus), []);

  // A new tap slides in over the last; the same tap moving on (reading →
  // served) changes in place, without sliding.
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
  const mealKind = msg?.meal?.kind || '';
  const day = Number(msg?.meal?.day) || 1;
  const days = Number(msg?.meal?.days) || 1;
  const serving = [MEAL_LABEL[mealKind], days > 1 ? `Day ${day}` : ''].filter(Boolean).join(' · ');

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
          <small><i className="fas fa-utensils"></i> Meals Counter{serving ? ` · ${serving}` : ''}</small>
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
                <p>{mealKind ? `${MEAL_LABEL[mealKind]} is being served` : 'Your name will appear here'}</p>
              </div>
            );
          }
          const d = describe(c.tap, mealKind, day, days);
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
