import { publicEventChoices } from '@/lib/eventAccess';
import { placeName } from '@/lib/eventPublic';
import { eventImageUrl } from '@/lib/eventImage';
import './conference.css';

// What the QR on the back of every ID opens: one button per conference -
// Leyte Conference, Cebu Conference - each to that event's own page
// (/events/<place>-<name>). The photos, the profile and the sign-in there are
// that event's alone: a password or card only opens the event its holder is
// registered in, and a sign-in on one is not a sign-in on the other.
//
// The one on now first, then the next one coming, then the ones that ended,
// newest first.

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose your conference',
  description: 'Open your conference - the programme, your photos and your profile.',
  robots: { index: false, follow: false },
};

// Edge to edge on a phone; conference.css keeps clear of the notch and home bar.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f6f1e4',
};

const TZ = 'Asia/Manila';
const dayOf = (iso) => String(iso || '').slice(0, 10);
const todayInManila = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const fmt = (day, opts) => new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-US', { timeZone: TZ, ...opts });

// "October 8-9, 2026", "Sep 30 - Oct 2, 2026", "October 8, 2026".
function datesOf(e) {
  const start = dayOf(e.event_date);
  const end = dayOf(e.end_date) || start;
  if (!start) return '';
  if (end === start) return fmt(start, { month: 'long', day: 'numeric', year: 'numeric' });
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { month: 'long', day: 'numeric' })}-${fmt(end, { day: 'numeric' })}, ${end.slice(0, 4)}`;
  }
  return `${fmt(start, { month: 'short', day: 'numeric' })} - ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function stateOf(e, today) {
  const start = dayOf(e.event_date);
  const end = dayOf(e.end_date) || start;
  if (start && start <= today && today <= end) return 'now';
  if (start && start > today) return 'soon';
  return 'done';
}
const STATE_LABEL = { now: 'Happening now', soon: 'Upcoming', done: 'Ended' };

export default async function ConferencePage() {
  let events = [];
  let failed = false;
  try { events = await publicEventChoices(); } catch { failed = true; }
  const today = todayInManila();
  const order = { now: 0, soon: 1, done: 2 };
  const list = events
    .map((e) => ({ ...e, state: stateOf(e, today) }))
    .sort((a, b) => order[a.state] - order[b.state]
      || (a.state === 'done' ? dayOf(b.event_date).localeCompare(dayOf(a.event_date)) : dayOf(a.event_date).localeCompare(dayOf(b.event_date))))
    .slice(0, 8);

  return (
    <div className="conf">
      <header className="conf-head">
        <img src="/assets/LOGO.png" alt="" className="conf-logo" />
        <h1>Choose your conference</h1>
        <p>Open the one you are attending - the programme, your photos and your profile.</p>
      </header>

      {failed || list.length === 0 ? (
        <p className="conf-empty">{failed ? 'Could not load the conferences. Please try again in a moment.' : 'No conference is open yet.'}</p>
      ) : (
        <ul className="conf-list">
          {list.map((e) => {
            const place = placeName(e);
            const cover = e.image_url ? eventImageUrl(e.image_url, 880) : '';
            return (
              <li key={e.id}>
                {/* /programme, not the bare address: that is what an old ID's QR holds,
                    and for Cebu it comes back here (QR_CHOOSER_SLUGS). */}
                <a href={`/events/${e.slug}/programme`} className={`conf-card is-${e.state}`} aria-label={`${place ? `${place} Conference` : e.title} - ${STATE_LABEL[e.state]}, ${datesOf(e)}`}>
                  {/* A frame as tall as the card, the poster cropped to fill it -
                      never stretched. Named like the event page's poster, so it
                      carries across when the page opens. */}
                  <span className="conf-cover" aria-hidden="true">
                    {cover
                      ? <img src={cover} alt="" loading="lazy" decoding="async" style={{ viewTransitionName: `ep-poster-${e.slug}` }} />
                      : <i className="fas fa-calendar-days"></i>}
                  </span>
                  <span className="conf-body">
                    <span className={`conf-state is-${e.state}`}>
                      {e.state === 'now' && <i className="fas fa-circle"></i>} {STATE_LABEL[e.state]}
                    </span>
                    <b className="conf-name">{place ? `${place} Conference` : e.title}</b>
                    <span className="conf-title">{e.title}</span>
                    <span className="conf-meta">
                      <span><i className="fas fa-calendar-day"></i> {datesOf(e)}</span>
                      {(e.loc_city || e.location) && <span><i className="fas fa-location-dot"></i> {e.loc_city || e.location}</span>}
                    </span>
                  </span>
                  <span className="conf-go"><i className="fas fa-arrow-right"></i></span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
