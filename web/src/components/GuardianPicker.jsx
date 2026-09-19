'use client';

import { useEffect, useState } from 'react';

// "Who is bringing this child?"
//
// A children's group is a name and nothing else, so the child's church, pastor
// and contact number come from the person they are registered under. This finds
// that person among the people already registered for the event - which is also
// the answer to "we forgot to add our daughter": the parent searches for their
// own registration and adds her to it, without registering themselves twice.
//
// The search asks for three characters before it answers and never shows a
// contact number, because it is a public form: it is here to let somebody
// recognise a registration they already made, not to list the attendees.
export default function GuardianPicker({
  eventId,
  value,                 // { id, name, churchName } | null
  onChange,
  invalid = false,
  label = 'Parent or Guardian *',
  hint = 'Search for the person bringing them — they must already be registered for this event.',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!eventId || value || q.length < 3) { setResults([]); setSearched(false); return undefined; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?guardians=1&eventId=${eventId}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.success ? data.data || [] : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setSearched(true);
      }
    }, 320);
    return () => { clearTimeout(timer); setSearching(false); };
  }, [query, eventId, value]);

  // Chosen: the search box is gone and the person stands in its place, because
  // the question is answered and re-opening it should take a deliberate tap.
  if (value) {
    return (
      <div className="evt-guardian">
        <span className="evt-guardian-label">{label}</span>
        <div className="evt-guardian-chosen">
          <i className="fas fa-user-check"></i>
          <span>
            <strong>{value.name}</strong>
            {value.churchName && <small>{value.churchName}</small>}
          </span>
          <button type="button" onClick={() => { onChange(null); setQuery(''); setResults([]); setSearched(false); }}>
            Change
          </button>
        </div>
        <small className="evt-guardian-hint">
          <i className="fas fa-circle-info"></i> Their church, pastor and contact number are used for this child.
        </small>
      </div>
    );
  }

  const q = query.trim();
  return (
    <div className={`evt-guardian ${invalid ? 'invalid' : ''}`}>
      <span className="evt-guardian-label">{label}</span>
      <div className="evt-guardian-search">
        <i className="fas fa-magnifying-glass"></i>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type the parent's name, e.g. Juan Dela Cruz"
          autoComplete="off"
        />
      </div>

      {q.length > 0 && q.length < 3 && (
        <small className="evt-guardian-hint">Type at least 3 letters of their name.</small>
      )}
      {searching && q.length >= 3 && (
        <small className="evt-guardian-hint"><i className="fas fa-spinner fa-spin"></i> Searching…</small>
      )}

      {results.length > 0 && (
        <ul className="evt-guardian-list">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onChange({ id: r.id, name: r.name, churchName: r.churchName })}>
                <span>
                  <strong>{r.name}</strong>
                  {r.churchName && <small>{r.churchName}</small>}
                </span>
                <i className="fas fa-chevron-right"></i>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Nothing found is the common case for somebody who has not registered
          yet, so it says what to do about it rather than only that it failed. */}
      {searched && !searching && q.length >= 3 && results.length === 0 && (
        <small className="evt-guardian-hint warn">
          <i className="fas fa-circle-exclamation"></i> Nobody registered for this event matches
          &ldquo;{q}&rdquo;. The parent has to be registered first &mdash; register them, then add the child.
        </small>
      )}

      {!searched && q.length < 3 && <small className="evt-guardian-hint">{hint}</small>}
    </div>
  );
}
