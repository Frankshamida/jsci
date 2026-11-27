'use client';

// Dashboard > Ministry Meetings.
//
// Members see the meetings for their ministries and answer Going / Maybe /
// Not going; the faces of everyone going show on each card. Going puts the
// meeting on their Weekly Schedule in the app and offers it to their phone's
// calendar (Google Calendar, or an .ics file for Apple Calendar / Outlook).
// Ministry heads, pastors and admins schedule meetings in a dialog; the
// members of the ministries they pick get a notice in the bell.
//
// The server decides who sees what (see lib/meetingsServer.js).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSmartPoll, POLL_MS } from '@/lib/pollingConfig';
import {
  MEETING_LIMITS, STILL_ON_MS, fmt, whenLabel, relativeDay, isoToInput, inputToIso, googleCalendarUrl, initials,
  ministryKey,
} from '@/lib/meetings';
import './meetings.css';

const PLACES = ['Church sanctuary', 'Fellowship hall', 'Media booth', 'Pastor\'s office', 'Online (Google Meet)', 'Online (Zoom)'];

// ---------------------------------------------------------------- helpers

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Someone';

// A soft colour per person, the same every time.
const TINTS = ['#f4d35e', '#9ad1d4', '#f7a072', '#b8b8ff', '#a3d9a5', '#f2a6c4', '#ffd6a5', '#9bc1ff'];
const tintOf = (key) => {
  let h = 0;
  for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
};

function phase(m, now = Date.now()) {
  if (m.status === 'Cancelled') return 'cancelled';
  if (m.status === 'Completed') return 'done';
  const t = new Date(m.startsAt).getTime();
  if (now >= t && now < t + STILL_ON_MS) return 'now';
  if (now >= t + STILL_ON_MS) return 'past';
  return 'ahead';
}

// "You're going", "Weldon is going", "You, Psalm and 3 others are going" ...
function goingLine(m, meId) {
  const over = phase(m) === 'past' || phase(m) === 'done';
  if (!m.going.length) return over ? 'Nobody answered' : "Be the first to say you're going";
  const me = m.going.some((p) => p.id === meId);
  const others = m.going.filter((p) => p.id !== meId).map((p) => firstName(p.name));
  const names = me ? ['You', ...others] : others;
  if (names.length === 1) {
    if (me) return over ? 'You went' : "You're going";
    return `${names[0]} ${over ? 'went' : 'is going'}`;
  }
  const verb = over ? 'went' : 'are going';
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'} ${verb}`;
}

async function call(url, options) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', ...options });
  } catch {
    throw new Error('We can\'t reach the server. Please check your internet connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.message || 'Something went wrong. Please try again.');
  return json;
}

const post = (url, body, method = 'POST') => call(url, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ---------------------------------------------------------------- small parts

export function Avatar({ person, size = 32, ring = true }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38), background: tintOf(person?.id || person?.name) };
  return (
    <span className={`mm-avatar${ring ? ' ring' : ''}`} style={style} title={person?.name}>
      {person?.photo && !broken
        ? <img src={person.photo} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
        : <span aria-hidden="true">{initials(person?.name)}</span>}
    </span>
  );
}

function AvatarStack({ people, max = 5, size = 32, onOpen, label }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <button type="button" className="mm-stack" onClick={onOpen} aria-label={label} title={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => <Avatar key={p.id} person={p} size={size} />)}
      {more > 0 && <span className="mm-avatar ring more" style={{ width: size, height: size }}>+{more}</span>}
    </button>
  );
}

function CalendarLinks({ meeting, actorId, compact = false }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const ics = `/api/meetings/calendar?id=${encodeURIComponent(meeting.id)}&actorId=${encodeURIComponent(actorId || '')}`;
  return (
    <div className={`mm-cal${compact ? ' compact' : ''}`}>
      <a className="mm-chipbtn" href={googleCalendarUrl(meeting, { origin })} target="_blank" rel="noopener noreferrer">
        <i className="fab fa-google" aria-hidden="true"></i> Google Calendar
      </a>
      <a className="mm-chipbtn" href={ics}>
        <i className="fas fa-calendar-plus" aria-hidden="true"></i> Apple / Outlook
      </a>
    </div>
  );
}

// A dialog over the page, in the page's theme. Escape and the backdrop close it.
function Dialog({ labelledBy, onClose, children, wide = false, canClose = true }) {
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;

  useEffect(() => {
    const before = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const first = boxRef.current?.querySelector('[data-autofocus]') || boxRef.current?.querySelector('input, textarea, button');
    first?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && canCloseRef.current) { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab' && boxRef.current) {
        const items = [...boxRef.current.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex="0"]')];
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, []);

  return createPortal(
    <div className="mm-theme mm-modal-root" onMouseDown={(e) => { if (e.target === e.currentTarget && canCloseRef.current) onClose(); }}>
      <div ref={boxRef} className={`mm-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- the form

const EMPTY = { title: '', date: '', time: '19:00', location: '', ministries: [], description: '' };

function MeetingForm({ editing, ministries, members, defaultMinistries, actorId, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!editing) return { ...EMPTY, ministries: defaultMinistries };
    const local = isoToInput(editing.startsAt);
    return {
      title: editing.title,
      date: local.slice(0, 10),
      time: local.slice(11, 16),
      location: editing.location,
      ministries: editing.ministries,
      description: editing.description,
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const start = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== start.current;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const has = (name) => form.ministries.some((m) => ministryKey(m) === ministryKey(name));
  const toggle = (name) => setForm((f) => ({
    ...f, ministries: has(name) ? f.ministries.filter((m) => ministryKey(m) !== ministryKey(name)) : [...f.ministries, name],
  }));
  const all = ministries.length > 0 && ministries.every(has);
  const toggleAll = () => setForm((f) => ({ ...f, ministries: all ? [] : [...ministries] }));

  // How many people the notice goes to.
  const reach = useMemo(() => {
    const ids = new Set();
    form.ministries.forEach((m) => (members[ministryKey(m)] || []).forEach((id) => ids.add(id)));
    ids.delete(actorId);
    return ids.size;
  }, [form.ministries, members, actorId]);

  const iso = inputToIso(form.date && form.time ? `${form.date}T${form.time}` : '');
  const problems = {
    title: !form.title.trim() ? 'Give the meeting a title.' : '',
    when: !form.date || !form.time ? 'Pick a date and a time.'
      : !iso ? 'That date could not be read.'
        : new Date(iso).getTime() < Date.now() && (!editing || iso !== inputToIso(isoToInput(editing.startsAt)))
          ? 'That time has already passed.' : '',
    ministries: !form.ministries.length ? 'Choose at least one ministry.' : '',
  };
  const invalid = Object.values(problems).some(Boolean);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        actorId,
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        ministries: form.ministries,
        startsAt: iso,
      };
      const json = editing
        ? await post('/api/meetings', { ...body, id: editing.id }, 'PUT')
        : await post('/api/meetings', body);
      onSaved(json.data, json.message);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const show = (k) => touched && problems[k];

  return (
    <Dialog labelledBy="mm-form-title" onClose={onClose} canClose={!saving && !dirty}>
      <form onSubmit={submit} noValidate className="mm-form">
        <header className="mm-dialog-head">
          <span className="mm-dialog-icon" aria-hidden="true"><i className={`fas ${editing ? 'fa-pen' : 'fa-calendar-plus'}`}></i></span>
          <div>
            <h3 id="mm-form-title">{editing ? 'Edit meeting' : 'Schedule a meeting'}</h3>
            <p>{editing ? 'People who are coming will be told if the time or place changes.' : 'Everyone in the ministries you choose gets a notice.'}</p>
          </div>
          <button type="button" className="mm-x" onClick={onClose} aria-label="Close" disabled={saving}><i className="fas fa-times"></i></button>
        </header>

        <div className="mm-dialog-body">
          <label className="mm-field">
            <span className="mm-label">What is it about? <em>*</em></span>
            <input
              data-autofocus
              className={`mm-input${show('title') ? ' bad' : ''}`}
              value={form.title}
              onChange={set('title')}
              maxLength={MEETING_LIMITS.title}
              placeholder="e.g. Christmas service planning"
            />
            {show('title') && <span className="mm-hint bad"><i className="fas fa-circle-exclamation"></i> {problems.title}</span>}
          </label>

          <div className="mm-row">
            <label className="mm-field">
              <span className="mm-label">Date <em>*</em></span>
              <input type="date" className={`mm-input${show('when') ? ' bad' : ''}`} value={form.date} min={editing ? undefined : today} onChange={set('date')} />
            </label>
            <label className="mm-field">
              <span className="mm-label">Time <em>*</em></span>
              <input type="time" className={`mm-input${show('when') ? ' bad' : ''}`} value={form.time} step={300} onChange={set('time')} />
            </label>
          </div>
          {show('when')
            ? <span className="mm-hint bad"><i className="fas fa-circle-exclamation"></i> {problems.when}</span>
            : iso && <span className="mm-hint"><i className="far fa-clock"></i> {fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' })} at {fmt(iso, { hour: 'numeric', minute: '2-digit' })} {relativeDay(iso) && `(${relativeDay(iso).toLowerCase()})`}</span>}

          <label className="mm-field">
            <span className="mm-label">Where</span>
            <input className="mm-input" value={form.location} onChange={set('location')} maxLength={MEETING_LIMITS.location} placeholder="Church sanctuary, or a meeting link" list="mm-places" />
            <datalist id="mm-places">{PLACES.map((p) => <option key={p} value={p} />)}</datalist>
          </label>

          <fieldset className="mm-field">
            <legend className="mm-label">Who is invited? <em>*</em></legend>
            <div className="mm-pills" role="group">
              <button type="button" className={`mm-pill all${all ? ' on' : ''}`} aria-pressed={all} onClick={toggleAll}>
                <i className={`fas ${all ? 'fa-check-double' : 'fa-users'}`}></i> All ministries
              </button>
              {ministries.map((m) => (
                <button type="button" key={m} className={`mm-pill${has(m) ? ' on' : ''}`} aria-pressed={has(m)} onClick={() => toggle(m)}>
                  {has(m) && <i className="fas fa-check"></i>} {m}
                </button>
              ))}
            </div>
            {show('ministries')
              ? <span className="mm-hint bad"><i className="fas fa-circle-exclamation"></i> {problems.ministries}</span>
              : form.ministries.length > 0 && (
                <span className="mm-hint"><i className="far fa-bell"></i> {reach ? `${reach} ${reach === 1 ? 'person' : 'people'} will get a notice${editing ? ' (new invitees only)' : ''}.` : 'Nobody is in these ministries yet.'}</span>
              )}
          </fieldset>

          <label className="mm-field">
            <span className="mm-label">Agenda or notes</span>
            <textarea className="mm-input" rows={4} value={form.description} onChange={set('description')} maxLength={MEETING_LIMITS.description} placeholder="What will you talk about? What should people bring?" />
            <span className="mm-count">{form.description.length}/{MEETING_LIMITS.description}</span>
          </label>

          {error && <div className="mm-alert" role="alert"><i className="fas fa-triangle-exclamation"></i> {error}</div>}
        </div>

        <footer className="mm-dialog-foot">
          <button type="button" className="mm-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="mm-btn primary" disabled={saving}>
            {saving
              ? <><i className="fas fa-spinner fa-spin"></i> Saving…</>
              : <><i className={`fas ${editing ? 'fa-check' : 'fa-paper-plane'}`}></i> {editing ? 'Save changes' : 'Schedule & notify'}</>}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- who's coming

function PeopleDialog({ meeting, actorId, onClose, onRemind, reminding }) {
  const tabs = [
    { key: 'going', label: 'Going', icon: 'fa-circle-check', list: meeting.going },
    { key: 'maybe', label: 'Maybe', icon: 'fa-circle-question', list: meeting.maybe },
    ...(meeting.canManage ? [
      { key: 'notGoing', label: 'Can\'t go', icon: 'fa-circle-xmark', list: meeting.notGoing },
      { key: 'noReply', label: 'No answer', icon: 'fa-hourglass-half', list: meeting.noReply },
    ] : []),
  ];
  const [tab, setTab] = useState('going');
  const current = tabs.find((t) => t.key === tab) || tabs[0];
  const live = phase(meeting) === 'ahead' || phase(meeting) === 'now';

  return (
    <Dialog labelledBy="mm-people-title" onClose={onClose}>
      <header className="mm-dialog-head">
        <span className="mm-dialog-icon" aria-hidden="true"><i className="fas fa-user-group"></i></span>
        <div>
          <h3 id="mm-people-title">Who&apos;s coming</h3>
          <p>{meeting.title} · {whenLabel(meeting.startsAt)}</p>
        </div>
        <button type="button" className="mm-x" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
      </header>
      <div className="mm-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`mm-tab ${t.key}${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`fas ${t.icon}`}></i> {t.label} <span className="mm-tab-n">{t.list.length}</span>
          </button>
        ))}
      </div>
      <div className="mm-dialog-body people">
        {current.list.length ? (
          <ul className="mm-people">
            {current.list.map((p) => (
              <li key={p.id}>
                <Avatar person={p} size={38} ring={false} />
                <span className="mm-person-name">{p.name}{p.id === actorId && <span className="mm-you">You</span>}</span>
                {p.id === meeting.organizer?.id && <span className="mm-tag">Organizer</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mm-quiet">
            {tab === 'going' && 'Nobody has said they\'re going yet.'}
            {tab === 'maybe' && 'Nobody is unsure. 🙂'}
            {tab === 'notGoing' && 'Nobody has said they can\'t make it.'}
            {tab === 'noReply' && 'Everyone has answered. 🎉'}
          </p>
        )}
      </div>
      {meeting.canManage && live && meeting.noReply.length > 0 && (
        <footer className="mm-dialog-foot">
          <span className="mm-foot-note">{meeting.noReply.length} {meeting.noReply.length === 1 ? 'person hasn\'t' : 'people haven\'t'} answered yet.</span>
          <button type="button" className="mm-btn primary" onClick={() => onRemind(meeting)} disabled={reminding}>
            {reminding ? <><i className="fas fa-spinner fa-spin"></i> Sending…</> : <><i className="fas fa-bell"></i> Send a reminder</>}
          </button>
        </footer>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- a card

function MeetingCard({ m, actorId, busy, nudge, menuOpen, onMenu, onAnswer, onPeople, onEdit, onCancel, onReopen, onDone, onRemove, onRemind, onDismissNudge }) {
  const p = phase(m);
  const answering = busy?.startsWith('rsvp:') ? busy.slice(5) : null;
  const open = p === 'ahead' || p === 'now';
  const rel = relativeDay(m.startsAt);
  const going = m.myStatus === 'Going';
  const [expanded, setExpanded] = useState(false);
  const long = (m.description || '').length > 160;

  const chip = {
    cancelled: { cls: 'cancelled', icon: 'fa-ban', text: 'Cancelled' },
    done: { cls: 'done', icon: 'fa-check', text: 'Done' },
    now: { cls: 'now', icon: null, text: 'Happening now' },
    past: { cls: 'done', icon: 'fa-clock-rotate-left', text: 'Past' },
    ahead: rel === 'Today' || rel === 'Tomorrow' ? { cls: 'soon', icon: 'fa-bolt', text: rel } : null,
  }[p];

  return (
    <article className={`mm-card ${p}${going && open ? ' mine' : ''}`} aria-busy={Boolean(busy)}>
      <div className="mm-card-top">
        <div className="mm-date" aria-hidden="true">
          <span className="mm-date-mon">{fmt(m.startsAt, { month: 'short' })}</span>
          <span className="mm-date-day">{fmt(m.startsAt, { day: 'numeric' })}</span>
          <span className="mm-date-wd">{fmt(m.startsAt, { weekday: 'short' })}</span>
        </div>
        <div className="mm-head">
          <div className="mm-chips">
            {chip && <span className={`mm-status ${chip.cls}`}>{chip.icon ? <i className={`fas ${chip.icon}`}></i> : <span className="mm-pulse" />} {chip.text}</span>}
            {going && open && <span className="mm-status going"><i className="fas fa-circle-check"></i> You&apos;re going</span>}
          </div>
          <h3 className="mm-title">{m.title}</h3>
          <ul className="mm-meta">
            <li>
              <i className="far fa-clock" aria-hidden="true"></i>
              <span>
                {fmt(m.startsAt, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmt(m.startsAt, { hour: 'numeric', minute: '2-digit' })}
                {rel && p === 'ahead' && rel !== 'Today' && rel !== 'Tomorrow' && <span className="mm-rel">{rel}</span>}
              </span>
            </li>
            <li>
              <i className="fas fa-location-dot" aria-hidden="true"></i>
              <span>{m.location || <span className="mm-faint">Place to be announced</span>}</span>
            </li>
          </ul>
        </div>
        {m.canManage && (
          <div className="mm-menu-wrap">
            <button type="button" className="mm-icon-btn" aria-label={`Options for ${m.title}`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); onMenu(menuOpen ? null : m.id); }}>
              <i className="fas fa-ellipsis"></i>
            </button>
            {menuOpen && (
              <div className="mm-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                {p !== 'cancelled' && p !== 'done' && <button type="button" role="menuitem" onClick={() => onEdit(m)}><i className="fas fa-pen"></i> Edit details</button>}
                {open && m.noReply.length > 0 && <button type="button" role="menuitem" onClick={() => onRemind(m)}><i className="fas fa-bell"></i> Remind {m.noReply.length} who haven&apos;t answered</button>}
                {(p === 'now' || p === 'past') && <button type="button" role="menuitem" onClick={() => onDone(m)}><i className="fas fa-flag-checkered"></i> Mark as done</button>}
                {p === 'cancelled' && new Date(m.startsAt).getTime() > Date.now() && <button type="button" role="menuitem" onClick={() => onReopen(m)}><i className="fas fa-rotate-left"></i> Put it back on</button>}
                {p !== 'cancelled' && p !== 'done' && <button type="button" role="menuitem" className="danger" onClick={() => onCancel(m)}><i className="fas fa-ban"></i> Cancel meeting</button>}
                {p === 'cancelled' && <button type="button" role="menuitem" className="danger" onClick={() => onRemove(m)}><i className="fas fa-trash-can"></i> Remove for good</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {m.description && (
        <p className={`mm-desc${long && !expanded ? ' clamp' : ''}`}>
          {m.description}
        </p>
      )}
      {long && <button type="button" className="mm-link" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Read more'}</button>}

      <div className="mm-tags">
        {m.ministries.map((x) => <span key={x} className="mm-tag-ministry">{x}</span>)}
      </div>

      {p === 'cancelled' ? (
        <div className="mm-attend off">
          <i className="fas fa-calendar-xmark" aria-hidden="true"></i>
          <span>
            <strong>This meeting will not go ahead.</strong>
            <span>{m.counts.going + m.counts.maybe > 0 ? 'Everyone who said they were coming got a notice.' : 'No need to answer.'}</span>
          </span>
        </div>
      ) : (
        <div className="mm-attend">
          <AvatarStack people={m.going} onOpen={() => onPeople(m)} label={`See who's going to ${m.title}`} />
          <button type="button" className="mm-attend-text" onClick={() => onPeople(m)}>
            <strong>{goingLine(m, actorId)}</strong>
            <span>
              {m.counts.maybe > 0 && `${m.counts.maybe} maybe · `}
              {m.counts.invited > 0 ? `${m.counts.invited} invited` : 'See who\'s coming'}
            </span>
          </button>
        </div>
      )}

      {open && (
        <div className="mm-rsvp-row">
          <span className="mm-rsvp-q">{m.myStatus ? 'Your answer' : 'Are you going?'}</span>
          <div className="mm-rsvp" role="group" aria-label={`Your answer for ${m.title}`}>
            {[
              { s: 'Going', icon: 'fa-check', label: 'Going' },
              { s: 'Maybe', icon: 'fa-question', label: 'Maybe' },
              { s: 'Not Going', icon: 'fa-xmark', label: 'Can\'t go' },
            ].map((o) => (
              <button
                key={o.s}
                type="button"
                className={`mm-rsvp-btn ${o.s === 'Not Going' ? 'no' : o.s.toLowerCase()}${m.myStatus === o.s ? ' on' : ''}`}
                aria-pressed={m.myStatus === o.s}
                disabled={Boolean(busy)}
                onClick={() => onAnswer(m, o.s)}
              >
                <i className={`fas ${answering === o.s ? 'fa-spinner fa-spin' : o.icon}`}></i> {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {open && nudge && going && (
        <div className="mm-nudge" role="status">
          <i className="fas fa-calendar-check mm-nudge-icon" aria-hidden="true"></i>
          <div>
            <strong>It&apos;s on your Weekly Schedule.</strong>
            <span>Add it to your phone&apos;s calendar too, with a reminder an hour before:</span>
            <CalendarLinks meeting={m} actorId={actorId} />
          </div>
          <button type="button" className="mm-x small" onClick={onDismissNudge} aria-label="Hide"><i className="fas fa-times"></i></button>
        </div>
      )}

      <footer className="mm-card-foot">
        <span className="mm-organizer">
          <Avatar person={m.organizer} size={22} ring={false} />
          <span>Set by <strong>{m.organizer?.id === actorId ? 'you' : m.organizer?.name}</strong></span>
        </span>
        {open && (m.myStatus === 'Going' || m.myStatus === 'Maybe') && !nudge && (
          <details className="mm-addcal">
            <summary><i className="far fa-calendar-plus"></i> Add to calendar</summary>
            <CalendarLinks meeting={m} actorId={actorId} compact />
          </details>
        )}
      </footer>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="mm-grid" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="mm-card skel">
          <div className="mm-card-top"><div className="mm-skel box" /><div style={{ flex: 1 }}><div className="mm-skel line w60" /><div className="mm-skel line w80" /><div className="mm-skel line w40" /></div></div>
          <div className="mm-skel line w90" /><div className="mm-skel line w70" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function MinistryMeetings({ userData, active, onToast, onConfirm }) {
  const actorId = userData?.id;
  const [view, setView] = useState('upcoming'); // upcoming | mine | past
  const [data, setData] = useState({ upcoming: null, past: null, canSchedule: false, ministries: [], members: {} });
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState(null); // { meeting } | { meeting: null }
  const [peopleOf, setPeopleOf] = useState(null); // meeting id
  const [busy, setBusy] = useState({}); // meeting id -> what
  const [nudge, setNudge] = useState(null); // meeting id
  const [menu, setMenu] = useState(null); // meeting id

  const toast = useCallback((msg, type = 'success') => { if (msg) onToast?.(msg, type); }, [onToast]);

  const load = useCallback(async (which) => {
    if (!actorId) return;
    const json = await call(`/api/meetings?actorId=${encodeURIComponent(actorId)}&view=${which}`);
    setData((d) => ({
      ...d,
      [which]: json.data || [],
      canSchedule: Boolean(json.canSchedule),
      ministries: json.ministries?.length ? json.ministries : d.ministries,
      members: json.members || d.members,
    }));
    setLoadError('');
  }, [actorId]);

  const refresh = useCallback(async () => {
    try {
      await load('upcoming');
    } catch (e) {
      setLoadError(e.message);
      throw e; // the poller backs off
    }
  }, [load]);

  useSmartPoll(refresh, POLL_MS.meetings, { enabled: Boolean(active && actorId) });

  useEffect(() => {
    if (active && view === 'past' && data.past === null) load('past').catch((e) => setLoadError(e.message));
  }, [active, view, data.past, load]);

  // Close the options menu on any click elsewhere.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  // One meeting changed: put the new copy everywhere it shows.
  const put = useCallback((m) => {
    if (!m) return;
    setData((d) => {
      const swap = (list) => (list ? list.map((x) => (x.id === m.id ? m : x)) : list);
      const inUpcoming = d.upcoming?.some((x) => x.id === m.id);
      const upcoming = inUpcoming ? swap(d.upcoming)
        : [...(d.upcoming || []), m].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      return { ...d, upcoming, past: swap(d.past) };
    });
  }, []);

  const drop = useCallback((id) => {
    setData((d) => ({ ...d, upcoming: d.upcoming?.filter((x) => x.id !== id) || null, past: d.past?.filter((x) => x.id !== id) || null }));
  }, []);

  const run = async (m, what, fn) => {
    setBusy((b) => ({ ...b, [m.id]: what }));
    setMenu(null);
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[m.id]; return n; });
    }
  };

  const answer = (m, status) => {
    if (m.myStatus === status) return;
    run(m, `rsvp:${status}`, async () => {
      const json = await post('/api/meetings/rsvp', { actorId, meetingId: m.id, status });
      put(json.data);
      toast(json.message, status === 'Not Going' ? 'info' : 'success');
      setNudge(status === 'Going' ? m.id : null);
    });
  };

  const remind = (m) => run(m, 'remind', async () => {
    const json = await post('/api/meetings', { actorId, action: 'remind', id: m.id });
    if (json.data) put(json.data);
    toast(json.message, 'success');
  });

  const change = (m, body, what) => run(m, what, async () => {
    const json = await post('/api/meetings', { actorId, id: m.id, ...body }, 'PUT');
    put(json.data);
    toast(json.message, 'success');
  });

  const cancel = (m) => {
    const ask = () => run(m, 'cancel', async () => {
      const json = await call(`/api/meetings?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      if (json.data) put(json.data);
      toast(json.message, 'success');
    });
    const coming = m.counts.going + m.counts.maybe - (m.myStatus === 'Going' || m.myStatus === 'Maybe' ? 1 : 0);
    if (!onConfirm) { ask(); return; }
    onConfirm(
      coming > 0
        ? `Cancel "${m.title}"? The ${coming} ${coming === 1 ? 'person' : 'people'} who said they're coming will get a notice.`
        : `Cancel "${m.title}"? It will stay in the list, marked as cancelled.`,
      ask,
      { title: 'Cancel this meeting?', confirmLabel: 'Yes, cancel it', icon: 'fa-calendar-xmark', confirmIcon: 'fa-ban' },
    );
  };

  const remove = (m) => {
    const go = () => run(m, 'remove', async () => {
      const json = await call(`/api/meetings?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(m.id)}&mode=hard`, { method: 'DELETE' });
      drop(m.id);
      toast(json.message, 'success');
    });
    if (!onConfirm) { go(); return; }
    onConfirm(`Remove "${m.title}" for good? This can't be undone.`, go, { title: 'Remove this meeting?', confirmLabel: 'Remove', icon: 'fa-trash-can' });
  };

  const saved = (m, message) => {
    setEditor(null);
    put(m);
    toast(message, 'success');
    if (view === 'past') setView('upcoming');
  };

  // ---- what to show
  const upcoming = data.upcoming || [];
  const mine = upcoming.filter((m) => (m.myStatus === 'Going' || m.myStatus === 'Maybe') && m.status !== 'Cancelled');
  const list = view === 'past' ? data.past : view === 'mine' ? mine : upcoming;
  const loading = list === null || (view !== 'past' && data.upcoming === null);
  const unanswered = upcoming.filter((m) => !m.myStatus && phase(m) === 'ahead').length;
  const nextOne = mine.find((m) => phase(m) === 'ahead' || phase(m) === 'now');

  const defaultMinistries = useMemo(() => {
    const own = String(userData?.ministry || '').split(',').map((s) => s.trim()).filter(Boolean);
    return data.ministries.filter((m) => own.some((o) => ministryKey(o) === ministryKey(m)));
  }, [userData?.ministry, data.ministries]);

  const peopleMeeting = peopleOf && [...upcoming, ...(data.past || [])].find((m) => m.id === peopleOf);

  return (
    <div className="mm mm-theme">
      <h2 className="section-title">Ministry Meetings</h2>

      <div className="mm-bar">
        <div className="mm-intro">
          {nextOne ? (
            <p><i className="fas fa-calendar-check"></i> Your next meeting: <strong>{nextOne.title}</strong>, {relativeDay(nextOne.startsAt).toLowerCase() || fmt(nextOne.startsAt, { month: 'short', day: 'numeric' })} at {fmt(nextOne.startsAt, { hour: 'numeric', minute: '2-digit' })}.</p>
          ) : unanswered > 0 ? (
            <p><i className="fas fa-envelope-open-text"></i> {unanswered === 1 ? 'One meeting is' : `${unanswered} meetings are`} waiting for your answer.</p>
          ) : (
            <p>Plan together, and see who&apos;s coming.</p>
          )}
        </div>
        {data.canSchedule && (
          <button type="button" className="mm-btn primary" onClick={() => setEditor({ meeting: null })}>
            <i className="fas fa-plus"></i> Schedule a meeting
          </button>
        )}
      </div>

      <div className="mm-views" role="tablist" aria-label="Which meetings">
        {[
          { key: 'upcoming', label: 'Upcoming', n: upcoming.length },
          { key: 'mine', label: 'My schedule', n: mine.length },
          { key: 'past', label: 'Past', n: null },
        ].map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`mm-view${view === v.key ? ' on' : ''}`} onClick={() => setView(v.key)}>
            {v.label}{v.n != null && data.upcoming && <span className="mm-view-n">{v.n}</span>}
          </button>
        ))}
      </div>

      {loadError && !loading && (
        <div className="mm-alert soft" role="status">
          <i className="fas fa-wifi"></i> {loadError}
          <button type="button" className="mm-link" onClick={() => { setLoadError(''); (view === 'past' ? load('past') : refresh()).catch(() => {}); }}>Try again</button>
        </div>
      )}

      {loading ? (
        loadError ? (
          <div className="mm-empty">
            <span className="mm-empty-icon"><i className="fas fa-cloud"></i></span>
            <h3>We couldn&apos;t load the meetings</h3>
            <p>{loadError}</p>
            <button type="button" className="mm-btn" onClick={() => { setLoadError(''); (view === 'past' ? load('past') : refresh()).catch(() => {}); }}><i className="fas fa-rotate-right"></i> Try again</button>
          </div>
        ) : <Skeleton />
      ) : list.length === 0 ? (
        <div className="mm-empty">
          <span className="mm-empty-icon"><i className={`fas ${view === 'past' ? 'fa-clock-rotate-left' : view === 'mine' ? 'fa-calendar-check' : 'fa-mug-hot'}`}></i></span>
          {view === 'upcoming' && <>
            <h3>No meetings coming up</h3>
            <p>{data.canSchedule ? 'Schedule one, and everyone in the ministries you choose gets a notice.' : 'When your ministry schedules a meeting, it shows up here and you get a notice in the bell.'}</p>
            {data.canSchedule && <button type="button" className="mm-btn primary" onClick={() => setEditor({ meeting: null })}><i className="fas fa-plus"></i> Schedule a meeting</button>}
          </>}
          {view === 'mine' && <>
            <h3>Nothing on your schedule yet</h3>
            <p>Answer <strong>Going</strong> or <strong>Maybe</strong> on a meeting and it shows up here and on your Weekly Schedule.</p>
            {upcoming.length > 0 && <button type="button" className="mm-btn" onClick={() => setView('upcoming')}>See upcoming meetings</button>}
          </>}
          {view === 'past' && <>
            <h3>No past meetings</h3>
            <p>Meetings from the last six months show up here.</p>
          </>}
        </div>
      ) : (
        <div className="mm-grid">
          {list.map((m) => (
            <MeetingCard
              key={m.id}
              m={m}
              actorId={actorId}
              busy={busy[m.id]}
              nudge={nudge === m.id}
              menuOpen={menu === m.id}
              onMenu={setMenu}
              onAnswer={answer}
              onPeople={(x) => setPeopleOf(x.id)}
              onEdit={(x) => { setMenu(null); setEditor({ meeting: x }); }}
              onCancel={cancel}
              onReopen={(x) => change(x, { status: 'Scheduled' }, 'reopen')}
              onDone={(x) => change(x, { status: 'Completed' }, 'done')}
              onRemove={remove}
              onRemind={remind}
              onDismissNudge={() => setNudge(null)}
            />
          ))}
        </div>
      )}

      {editor && (
        <MeetingForm
          editing={editor.meeting}
          ministries={data.ministries}
          members={data.members}
          defaultMinistries={defaultMinistries}
          actorId={actorId}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {peopleMeeting && (
        <PeopleDialog
          meeting={peopleMeeting}
          actorId={actorId}
          onClose={() => setPeopleOf(null)}
          onRemind={remind}
          reminding={busy[peopleMeeting.id] === 'remind'}
        />
      )}
    </div>
  );
}
