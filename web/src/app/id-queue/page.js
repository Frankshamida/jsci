'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { splitLastFirst } from '@/lib/personName';
import './idQueue.css';

// The ID box. The verification desk asks for an attendee's printed ID; it
// lands here, oldest first. Whoever is at the box finds it and presses Found
// - only the one at the top of the line, so the first asked is the first
// found. A Found pressed by mistake can be undone; it goes back to its place.

const POLL_MS = 3000;

function readUser() {
  try {
    return JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData')
      || sessionStorage.getItem('committeeUser') || localStorage.getItem('committeeUser') || 'null');
  } catch { return null; }
}

function Name({ value }) {
  const n = splitLastFirst(value);
  return <span className="idq-name"><b>{n.last}</b>{n.first ? `, ${n.first}` : ''}</span>;
}

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

export default function IdQueuePage() {
  const [user, setUser] = useState(undefined);
  const [rows, setRows] = useState(null);
  const [events, setEvents] = useState({});
  const [eventId, setEventId] = useState('');
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState('');
  const seenRef = useRef(new Set());

  useEffect(() => {
    setUser(readUser());
    const q = new URLSearchParams(window.location.search).get('eventId');
    if (q) setEventId(q);
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/events/id-queue?actorId=${encodeURIComponent(user.id)}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || 'Could not load the queue.'); setRows([]); return; }
      setError('');
      setRows(data.data || []);
      setEvents(data.events || {});
      setMe(data.me || '');
    } catch (err) { setError(err.message); }
  }, [user?.id, eventId]);

  useEffect(() => {
    if (!user?.id) return undefined;
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [user?.id, load]);

  const act = async (row, action) => {
    if (busy) return;
    setBusy(row.id);
    try {
      const res = await fetch('/api/events/id-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: user.id, id: row.id, action, by: me }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); load(); return; }
      setError('');
      if (action === 'found') {
        // Slides out, then the list moves up.
        setLeaving(row.id);
        await new Promise((r) => setTimeout(r, 320));
        setLeaving('');
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  if (user === undefined) return <main className="idq" />;
  if (!user?.id) {
    return (
      <main className="idq">
        <div className="idq-empty">
          <i className="fas fa-lock"></i>
          <h2>Sign in first</h2>
          <p>Open the dashboard and sign in, then come back to this page.</p>
          <a className="idq-btn" href="/login">Go to sign in</a>
        </div>
      </main>
    );
  }

  const open = (rows || []).filter((r) => !r.found_at && !r.claimed_at);
  const found = (rows || []).filter((r) => r.found_at && !r.claimed_at).sort((a, b) => String(b.found_at).localeCompare(String(a.found_at)));
  const eventIds = Object.keys(events);
  // New names get a short entrance; the ones already on screen do not re-animate on every poll.
  const isNew = (id) => { const fresh = !seenRef.current.has(id); seenRef.current.add(id); return fresh; };

  return (
    <main className="idq">
      <header className="idq-head">
        <div>
          <h1><i className="fas fa-id-card"></i> ID Queue</h1>
          <p>{eventId && events[eventId] ? events[eventId] : 'Find each ID in order - the top one first.'}</p>
        </div>
        <div className="idq-head-side">
          {eventIds.length > 1 && (
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
              <option value="">All events</option>
              {eventIds.map((id) => <option key={id} value={id}>{events[id]}</option>)}
            </select>
          )}
          <span className="idq-count"><b>{open.length}</b> to find</span>
        </div>
      </header>

      {error && <p className="idq-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}

      <section className="idq-list" aria-label="IDs to find">
        {rows === null && <div className="idq-empty"><div className="idq-spin"></div><p>Loading…</p></div>}
        {rows !== null && open.length === 0 && (
          <div className="idq-empty">
            <i className="fas fa-circle-check"></i>
            <h2>All caught up</h2>
            <p>When the verifier asks for an ID, the name appears here.</p>
          </div>
        )}
        {open.map((r, i) => {
          const first = i === 0;
          return (
            <div key={r.id} className={`idq-row ${first ? 'is-next' : ''} ${leaving === r.id ? 'is-leaving' : ''} ${isNew(r.id) ? 'is-new' : ''}`}>
              <span className="idq-pos">{first ? <i className="fas fa-eye"></i> : i + 1}</span>
              <span className="idq-who">
                <Name value={r.attendee_name} />
                <small>
                  Asked {timeOf(r.requested_at)}{r.requested_by ? ` by ${r.requested_by}` : ''}
                  {!eventId && events[r.event_id] ? ` · ${events[r.event_id]}` : ''}
                </small>
              </span>
              <button
                type="button"
                className="idq-found"
                onClick={() => act(r, 'found')}
                disabled={!first || !!busy}
                title={first ? 'The ID is found' : 'Find the one at the top first'}
              >
                {busy === r.id ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>} Found
              </button>
            </div>
          );
        })}
      </section>

      {found.length > 0 && (
        <section className="idq-done" aria-label="Found">
          <h3>Found <span>- waiting at the desk</span></h3>
          {found.map((r) => (
            <div key={r.id} className="idq-row is-found">
              <span className="idq-pos"><i className="fas fa-id-card"></i></span>
              <span className="idq-who">
                <Name value={r.attendee_name} />
                <small>Found {timeOf(r.found_at)}{r.found_by ? ` by ${r.found_by}` : ''}</small>
              </span>
              <button type="button" className="idq-undo" onClick={() => act(r, 'undo')} disabled={!!busy} title="Put it back in the line">
                {busy === r.id ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate-left"></i>} Undo
              </button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
