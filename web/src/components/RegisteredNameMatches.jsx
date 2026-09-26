'use client';

import { useEffect, useState } from 'react';

// "Is this person already on the event?" - answered while the name is typed.
//
// Shown right under the Last Name field on the admin desk. Everyone whose name
// contains what has been typed is listed, so a walk-in who already signed up
// online (or was added by another admin a minute ago) is spotted before a second
// slot is made. An exact match is flagged and reported to the parent through
// onExactChange, which is what lets the form refuse to add them again.
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default function RegisteredNameMatches({
  eventId,
  firstName,
  lastName,
  onExactChange,         // (match | null) => void
  onPick,                // (match) => void - when given, each match can be picked
  pickLabel = 'Use',
  formatStatus = (s) => s,
  exactNote = 'Already registered for this event — they cannot be added again.',
}) {
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  const full = `${firstName || ''} ${lastName || ''}`.trim().replace(/\s+/g, ' ');
  const key = normName(full);

  useEffect(() => {
    if (!eventId || full.length < 3) {
      setMatches([]);
      onExactChange?.(null);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?nameMatches=1&eventId=${eventId}&q=${encodeURIComponent(full)}`);
        const data = await res.json();
        const list = data.success ? data.data || [] : [];
        setMatches(list);
        onExactChange?.(list.find((m) => normName(m.name) === key) || null);
      } catch {
        setMatches([]);
        onExactChange?.(null);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); setSearching(false); };
    // onExactChange is a fresh closure each render; the name is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, key]);

  if (full.length < 3 || (matches.length === 0 && !searching)) return null;

  return (
    <div className="evt-name-matches">
      <div className="evt-name-matches-head">
        {searching
          ? <><i className="fas fa-spinner fa-spin"></i> Checking registrations…</>
          : <><i className="fas fa-users-viewfinder"></i> Already registered with a similar name</>}
      </div>
      {matches.length > 0 && (
        <ul>
          {matches.map((m) => {
            const exact = normName(m.name) === key;
            return (
              <li key={m.id} className={`${exact ? 'exact' : ''} ${onPick ? 'pickable' : ''}`}>
                <i className={`fas ${exact ? (onPick ? 'fa-user-check' : 'fa-ban') : 'fa-user'}`}></i>
                <span>
                  <strong>{m.name}</strong>
                  <small>
                    {[m.priceTier, m.churchName].filter(Boolean).join(' · ')}
                    {exact && <em>{exactNote}</em>}
                  </small>
                </span>
                {m.status && <span className={`evt-status evt-status-${m.status}`}>{formatStatus(m.status)}</span>}
                {onPick && !exact && (
                  <button type="button" className="evt-mini-btn ok evt-name-pick" onClick={() => onPick(m)}>
                    {pickLabel}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
