'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROGRAMME_KINDS, daysWith, formatClock, formatDay, groupProgramme, programmeKind, shortDay } from '@/lib/eventPublic';

// The event's programme flow - sessions, speakers, meals - as the public page
// (/events/<province>-<event>) shows it. Admins build it here, one item at a time.

const dayOf = (v) => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const EMPTY = { dayDate: '', startTime: '', endTime: '', title: '', speaker: '', kind: 'session', venue: '', notes: '' };

export default function EventProgrammeTab({ event, actorId, publicUrl, showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null); // null = closed; { id? , ...fields }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/programme?eventId=${encodeURIComponent(event.id)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setItems(data.data || []);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  // Every day of the event gets its own section, even before it has items,
  // so Day 2 can be filled in without first moving something onto it.
  const allDays = useMemo(() => daysWith(event, items.map((i) => i.day_date)), [event, items]);
  const days = useMemo(() => {
    const grouped = new Map(groupProgramme(items).map((g) => [g.day, g.rows]));
    return allDays.map((d) => ({ day: d, rows: grouped.get(d) || [] }));
  }, [allDays, items]);
  const multiDay = allDays.length > 1;
  const [dayTab, setDayTab] = useState('all');
  const visible = dayTab === 'all' ? days : days.filter((d) => d.day === dayTab);

  // A new item goes on the day asked for (the open Day tab), else the day of
  // the last one added, else the event's first day - at the time the
  // previous item on that day ends.
  const openNew = (onDay) => {
    const last = items[items.length - 1];
    const dayDate = (typeof onDay === 'string' && onDay) || (dayTab !== 'all' ? dayTab : '')
      || last?.day_date || dayOf(event.event_date);
    const sameDay = items.filter((i) => i.day_date === dayDate);
    const after = sameDay[sameDay.length - 1];
    setForm({ ...EMPTY, dayDate, startTime: String(after?.end_time || '').slice(0, 5) });
  };

  const openEdit = (it) => setForm({
    id: it.id,
    dayDate: it.day_date,
    startTime: String(it.start_time || '').slice(0, 5),
    endTime: String(it.end_time || '').slice(0, 5),
    title: it.title || '',
    speaker: it.speaker || '',
    kind: it.kind || 'session',
    venue: it.venue || '',
    notes: it.notes || '',
  });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/events/programme', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, eventId: event.id, actorId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setItems((prev) => (form.id ? prev.map((i) => (i.id === form.id ? data.data : i)) : [...prev, data.data]));
      showToast?.(form.id ? 'Programme item updated' : 'Added to the programme', 'success');
      setForm(null);
    } catch (err) {
      showToast?.(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it) => {
    if (!window.confirm(`Remove "${it.title}" from the programme?`)) return;
    try {
      const res = await fetch(`/api/events/programme?id=${encodeURIComponent(it.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setItems((prev) => prev.filter((i) => i.id !== it.id));
      showToast?.('Removed from the programme', 'success');
    } catch (err) {
      showToast?.(err.message, 'danger');
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="evt-prog">
      <div className="evt-prog-bar">
        <div>
          <h4>Programme Flow</h4>
          <p>Shown first on the event&apos;s public page - the page the ID&apos;s QR opens.</p>
        </div>
        <div className="evt-prog-bar-actions">
          {publicUrl && (
            <a className="btn-secondary" href={publicUrl} target="_blank" rel="noreferrer">
              <i className="fas fa-arrow-up-right-from-square"></i> Public Page
            </a>
          )}
          <button type="button" className="btn-primary" onClick={() => openNew()}>
            <i className="fas fa-plus"></i> {dayTab !== 'all' && multiDay ? `Add to Day ${allDays.indexOf(dayTab) + 1}` : 'Add Item'}
          </button>
        </div>
      </div>

      {multiDay && !loading && !loadError && (
        <div className="evt-daytabs" role="tablist" aria-label="Programme by day">
          <button type="button" role="tab" aria-selected={dayTab === 'all'} className={dayTab === 'all' ? 'active' : ''} onClick={() => setDayTab('all')}>
            All Days <em>{items.length}</em>
          </button>
          {days.map((d, i) => (
            <button key={d.day} type="button" role="tab" aria-selected={dayTab === d.day} className={dayTab === d.day ? 'active' : ''} onClick={() => setDayTab(d.day)}>
              Day {i + 1} <small>{shortDay(d.day)}</small> <em>{d.rows.length}</em>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="evt-prog-empty"><i className="fas fa-spinner fa-spin"></i> Loading programme…</p>
      ) : loadError ? (
        <p className="evt-field-error-msg">{loadError}</p>
      ) : items.length === 0 && !multiDay ? (
        <div className="evt-prog-empty">
          <i className="fas fa-list-ol"></i>
          <p>No programme yet. Add the first item - registration, opening worship, the first session, lunch…</p>
        </div>
      ) : (
        visible.map(({ day, rows }) => (
          <div key={day} className="evt-prog-day">
            <h5><span>Day {allDays.indexOf(day) + 1}</span> {formatDay(day)}</h5>
            {rows.length === 0 && (
              <div className="evt-prog-dayempty">
                <span>Nothing on this day yet.</span>
                <button type="button" className="btn-secondary" onClick={() => openNew(day)}>
                  <i className="fas fa-plus"></i> Add to Day {allDays.indexOf(day) + 1}
                </button>
              </div>
            )}
            <ul>
              {rows.map((it) => {
                const kind = programmeKind(it.kind);
                return (
                  <li key={it.id} className={`evt-prog-item kind-${kind.key}`}>
                    <div className="evt-prog-time">
                      {formatClock(it.start_time)}
                      {it.end_time && <small>– {formatClock(it.end_time)}</small>}
                    </div>
                    <i className={`fas ${kind.icon} evt-prog-icon`}></i>
                    <div className="evt-prog-main">
                      <strong>{it.title}</strong>
                      <span>
                        {[kind.label, it.speaker, it.venue].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="evt-prog-actions">
                      <button type="button" onClick={() => openEdit(it)} title="Edit"><i className="fas fa-pen"></i></button>
                      <button type="button" onClick={() => remove(it)} title="Remove" className="danger"><i className="fas fa-trash"></i></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {form && (
        <div className="evt-modal-overlay" onClick={() => !busy && setForm(null)}>
          <form className="evt-modal evt-prog-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="evt-modal-head">
              <div><h3>{form.id ? 'Edit Programme Item' : 'Add Programme Item'}</h3><p>{event.title}</p></div>
              <button type="button" className="evt-modal-close" onClick={() => setForm(null)} disabled={busy}><i className="fas fa-times"></i></button>
            </div>
            <div className="evt-modal-body">
              <div className="form-group">
                <label>Title *</label>
                <input className="form-control" value={form.title} onChange={set('title')} placeholder="e.g. Opening Worship, Session 1, Lunch" required autoFocus />
              </div>
              <div className="evt-form-grid">
                <div className="form-group">
                  <label>Type</label>
                  <select className="form-control" value={form.kind} onChange={set('kind')}>
                    {PROGRAMME_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>{multiDay ? 'Day *' : 'Date *'}</label>
                  {multiDay ? (
                    <select className="form-control" value={form.dayDate} onChange={set('dayDate')} required>
                      {!allDays.includes(form.dayDate) && <option value={form.dayDate}>{form.dayDate ? shortDay(form.dayDate) : 'Pick a day'}</option>}
                      {allDays.map((d, i) => <option key={d} value={d}>Day {i + 1} · {shortDay(d)}</option>)}
                    </select>
                  ) : (
                    <input type="date" className="form-control" value={form.dayDate} onChange={set('dayDate')} required />
                  )}
                </div>
                <div className="form-group">
                  <label>Start Time *</label>
                  <input type="time" className="form-control" value={form.startTime} onChange={set('startTime')} required />
                </div>
                <div className="form-group">
                  <label>End Time</label>
                  <input type="time" className="form-control" value={form.endTime} onChange={set('endTime')} />
                </div>
              </div>
              <div className="form-group">
                <label>Speaker</label>
                <input className="form-control" value={form.speaker} onChange={set('speaker')} placeholder="e.g. Ptr. Juan Dela Cruz" />
              </div>
              <div className="form-group">
                <label>Venue / Room</label>
                <input className="form-control" value={form.venue} onChange={set('venue')} placeholder="e.g. Main Hall" />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea className="form-control" rows={2} value={form.notes} onChange={set('notes')} placeholder="Anything attendees should know" />
              </div>
            </div>
            <div className="evt-modal-foot">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>
                <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> {form.id ? 'Save' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
