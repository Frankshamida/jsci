'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { splitSubRole } from '@/lib/permissions';
import { LINEUP_INSTRUMENTS, cleanLineupMusicians, cleanNameList, lineupParts, lineupDoubleBooked } from '@/lib/userRoles';
import './monthlyPlanner.css';

// ============================================================
// MONTHLY PLANNER - who leads, sings, plays and dances each Sunday
// A month at a time, every Sunday on one screen, for an Admin or a Ministry
// Member with the Schedule Plotter switch on. The choices are the people who
// hold the position (User Management > Ministry Roles):
//   Song Leader     - Singer (PAW) with Song Leader ticked
//   Backup Singers  - Singer (PAW) with Backup Singer ticked
//   Musicians       - Musician (PAW) with that instrument ticked
//                     (Keyboard, Guitar, Bass, Drums: LINEUP_INSTRUMENTS)
//   Dancers         - Dancer (PAW)
// A plotter who sings, plays or dances is one of them, marked "You".
// Somebody cannot be picked when, on that date, they already have another
// part (one person, one part), filed an excuse, or handed their part to a
// substitute. Plotting saves the people only (api/schedules): the songs stay
// the Song Leader's to add, and an update from here never touches them.
// ============================================================

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const longDate = (s) => parseYmd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const nameKey = (name) => String(name || '').trim().toLowerCase();
const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
const sameMusicians = (a, b) => LINEUP_INSTRUMENTS.every(({ token }) => sameSet(a?.[token] || [], b?.[token] || []));
const musicianNames = (musicians) => LINEUP_INSTRUMENTS.flatMap(({ token }) => musicians?.[token] || []);
const initials = (name) => String(name || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// A part's word on a locked chip: "Backup", not "Backup Singer".
const PART_TAG = { 'Song Leader': 'Leading', 'Backup Singer': 'Backup', Dancer: 'Dancing' };
// A sub request still running: the requester is on the lineup but asked out.
const OPEN_SUB = ['Pending Admin', 'Open for Sub'];

function sundaysOf(month) {
  const d = firstOfMonth(month);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  const out = [];
  while (d.getMonth() === month.getMonth()) { out.push(ymd(d)); d.setDate(d.getDate() + 7); }
  return out;
}

function Avatar({ name, picture, size = 'sm' }) {
  return (
    <span className={`mp-avatar mp-avatar-${size}`}>
      {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export default function MonthlyPlanner({ me, showToast, onSaved }) {
  // The page's showToast is a new function every render; read it through a ref.
  const toast = useRef(showToast);
  toast.current = showToast;

  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  const [schedules, setSchedules] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [backups, setBackups] = useState([]);
  const [players, setPlayers] = useState([]); // Musicians (PAW); their instruments are in sub_role
  const [dancerPool, setDancerPool] = useState([]);
  const [excuses, setExcuses] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({}); // date -> unsaved lineup
  const [extraDates, setExtraDates] = useState([]); // special services added here
  const [openDate, setOpenDate] = useState(undefined); // undefined: the first Sunday still to plan
  const [saving, setSaving] = useState({});
  const [savingAll, setSavingAll] = useState(false);
  const [newDate, setNewDate] = useState('');

  const loadSchedules = useCallback(async () => {
    const res = await fetch('/api/schedules');
    const data = await res.json();
    if (data.success) setSchedules(data.data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const get = (url) => fetch(url).then((r) => r.json()).catch(() => ({}));
        const [s, l, b, m, d, e, u] = await Promise.all([
          get('/api/schedules'),
          get('/api/lineup/singers?type=song-leaders'),
          get('/api/lineup/singers?type=backupers'),
          get('/api/lineup/singers?type=musicians'),
          get('/api/lineup/singers?type=dancers'),
          get('/api/lineup/excuses'),
          get('/api/lineup/substitutes'),
        ]);
        if (cancelled) return;
        if (s.success) setSchedules(s.data || []);
        if (l.success) setLeaders(l.data || []);
        if (b.success) setBackups(b.data || []);
        if (m.success) setPlayers(m.data || []);
        if (d.success) setDancerPool(d.data || []);
        if (e.success) setExcuses(e.data || []);
        if (u.success) setSubs(u.data || []);
      } catch (err) {
        if (!cancelled) toast.current?.('Could not load the planner: ' + err.message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const today = ymd(new Date());
  const byDate = useMemo(() => Object.fromEntries(schedules.map((s) => [s.scheduleDate, s])), [schedules]);

  // Everybody who can be picked, once, with their picture.
  const roster = useMemo(() => {
    const all = {};
    [...leaders, ...backups, ...players, ...dancerPool].forEach((p) => { if (!all[p.name]) all[p.name] = p; });
    return all;
  }, [leaders, backups, players, dancerPool]);

  // "Frank", or "Frank G." when two people share the first name.
  const shortNames = useMemo(() => {
    const firstOf = (p) => String(p.firstname || p.name.split(' ')[0] || '').trim();
    const counts = {};
    Object.values(roster).forEach((p) => { const k = firstOf(p).toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    return Object.fromEntries(Object.values(roster).map((p) => {
      const first = firstOf(p);
      const lastInitial = String(p.lastname || p.name.split(' ').slice(-1)[0] || '').trim().charAt(0);
      return [p.name, counts[first.toLowerCase()] > 1 && lastInitial ? `${first} ${lastInitial}.` : first];
    }));
  }, [roster]);
  const short = (name) => shortNames[name] || String(name || '').split(' ')[0];

  // Accounts that share one full name. Lineups record people by name, so the
  // planner cannot tell them apart: picking one picks both. Shown as a warning
  // so the name can be fixed in User Management.
  const nameTwins = useMemo(() => {
    const byName = {};
    [...leaders, ...backups, ...players, ...dancerPool].forEach((p) => {
      const k = nameKey(p.name);
      if (!byName[k]) byName[k] = { name: p.name, ids: new Set() };
      byName[k].ids.add(p.id);
    });
    return Object.fromEntries(Object.entries(byName).filter(([, v]) => v.ids.size > 1).map(([k, v]) => [k, { name: v.name, count: v.ids.size }]));
  }, [leaders, backups, players, dancerPool]);

  const savedValue = (date) => ({
    songLeader: byDate[date]?.songLeader || '',
    backupSingers: [...(byDate[date]?.backupSingers || [])],
    musicians: cleanLineupMusicians(byDate[date]?.musicians),
    dancers: cleanNameList(byDate[date]?.dancers),
  });
  const valueOf = (date) => drafts[date] || savedValue(date);
  const isDirty = (date) => {
    const d = drafts[date];
    if (!d) return false;
    const s = savedValue(date);
    return d.songLeader !== s.songLeader || !sameSet(d.backupSingers, s.backupSingers)
      || !sameMusicians(d.musicians, s.musicians) || !sameSet(d.dancers, s.dancers);
  };

  // Who can play each instrument: the Musicians with that position.
  const playersFor = useMemo(() => Object.fromEntries(LINEUP_INSTRUMENTS.map(({ token }) => [
    token, players.filter((p) => splitSubRole(p.sub_role).includes(token)),
  ])), [players]);

  // Every Sunday of the month, plus any other date that has a lineup or was added here.
  const dates = useMemo(() => {
    const key = monthKey(month);
    const set = new Set(sundaysOf(month));
    schedules.forEach((s) => { if (String(s.scheduleDate || '').startsWith(key)) set.add(s.scheduleDate); });
    extraDates.forEach((d) => { if (d.startsWith(key)) set.add(d); });
    return [...set].sort();
  }, [month, schedules, extraDates]);

  // Per date, per person: an excuse they filed (pending or approved).
  const excusedOn = useMemo(() => {
    const map = {};
    excuses.forEach((x) => {
      if (!x.excuse_date || x.status === 'Rejected') return;
      if (!map[x.excuse_date]) map[x.excuse_date] = {};
      map[x.excuse_date][nameKey(x.user_name)] = x.status === 'Approved' ? 'Excused' : 'Excuse pending';
    });
    return map;
  }, [excuses]);

  // Per date: who handed their part to whom, and who is still looking for a sub.
  const subsOn = useMemo(() => {
    const map = {};
    subs.forEach((s) => {
      if (!s.schedule_date || !s.requester_name) return;
      if (!map[s.schedule_date]) map[s.schedule_date] = { out: {}, subFor: {}, needs: {} };
      const day = map[s.schedule_date];
      if (s.status === 'Accepted' && s.substitute_name) {
        day.out[nameKey(s.requester_name)] = s.substitute_name;
        day.subFor[nameKey(s.substitute_name)] = s.requester_name;
      } else if (OPEN_SUB.includes(s.status)) {
        day.needs[nameKey(s.requester_name)] = true;
      }
    });
    return map;
  }, [subs]);

  // How many Sundays each person is on this month, drafts included: spread the load.
  const monthLoad = {};
  dates.forEach((d) => {
    const v = valueOf(d);
    new Set([v.songLeader, ...v.backupSingers, ...musicianNames(v.musicians), ...v.dancers].filter(Boolean).map(nameKey))
      .forEach((k) => { monthLoad[k] = (monthLoad[k] || 0) + 1; });
  });

  const dirtyDates = Object.keys(drafts).filter((d) => isDirty(d) && d >= today).sort();
  const plannedCount = dates.filter((d) => byDate[d]).length;
  const autoOpen = dates.find((d) => d >= today && !byDate[d]) || null;
  const expanded = openDate === undefined ? autoOpen : openDate;

  const goMonth = (step) => { setMonth((m) => new Date(m.getFullYear(), m.getMonth() + step, 1)); setOpenDate(undefined); };

  const edit = (date, change) => setDrafts((all) => {
    const current = all[date] || savedValue(date);
    return { ...all, [date]: { ...current, ...change(current) } };
  });
  const toggleIn = (list, name) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  const pickLeader = (date, name) => edit(date, (v) => ({ songLeader: v.songLeader === name ? '' : name }));
  const toggleBackup = (date, name) => edit(date, (v) => ({ backupSingers: toggleIn(v.backupSingers, name) }));
  const toggleDancer = (date, name) => edit(date, (v) => ({ dancers: toggleIn(v.dancers, name) }));
  const toggleMusician = (date, token, name) => edit(date, (v) => ({
    musicians: { ...v.musicians, [token]: toggleIn(v.musicians[token] || [], name) },
  }));
  const discard = (date) => setDrafts((all) => { const next = { ...all }; delete next[date]; return next; });

  const saveDate = async (date) => {
    const v = valueOf(date);
    const saved = byDate[date];
    if (!v.songLeader) { toast.current?.(`Pick a Song Leader for ${longDate(date)}`, 'warning'); return false; }
    const doubled = lineupDoubleBooked(v);
    if (doubled.length) {
      toast.current?.(`${longDate(date)}: ${doubled[0].name} has more than one part. Keep one.`, 'warning');
      return false;
    }
    const leader = leaders.find((l) => l.name === v.songLeader);
    // No need to notify the plotter about their own Sunday.
    const notifyId = leader && leader.id !== me?.id ? leader.id : null;
    const people = { songLeader: v.songLeader, backupSingers: v.backupSingers, musicians: cleanLineupMusicians(v.musicians), dancers: cleanNameList(v.dancers) };
    setSaving((s) => ({ ...s, [date]: true }));
    try {
      const res = await fetch('/api/schedules', {
        method: saved ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved
          ? { scheduleId: saved.scheduleId, scheduleDate: date, ...people, songLeaderId: notifyId, notifyLeader: !!notifyId && saved.songLeader !== v.songLeader }
          : { scheduleDate: date, ...people, submittedBy: me?.email, songLeaderId: notifyId }),
      });
      const data = await res.json();
      if (!data.success) { toast.current?.(data.message || `Could not save ${longDate(date)}`, 'danger'); return false; }
      discard(date);
      return true;
    } catch (err) {
      toast.current?.('Error: ' + err.message, 'danger');
      return false;
    } finally {
      setSaving((s) => ({ ...s, [date]: false }));
    }
  };

  const refresh = async () => { await loadSchedules(); onSaved?.(); };

  const saveOne = async (date) => {
    if (!(await saveDate(date))) return;
    toast.current?.(`Lineup saved for ${longDate(date)}`, 'success');
    await refresh();
    setOpenDate(undefined); // on to the next Sunday still to plan
  };

  const saveAll = async () => {
    setSavingAll(true);
    let ok = 0;
    let failed = 0;
    for (const d of dirtyDates) { if (await saveDate(d)) ok += 1; else failed += 1; }
    setSavingAll(false);
    await refresh();
    if (failed) toast.current?.(`${ok} saved. ${failed} still need a Song Leader, or have someone in two parts.`, 'warning');
    else toast.current?.(`${ok} lineup${ok === 1 ? '' : 's'} saved`, 'success');
  };

  const addDate = () => {
    if (!newDate) return;
    if (newDate < today) { toast.current?.('Pick a date from today on', 'warning'); return; }
    setExtraDates((all) => (all.includes(newDate) ? all : [...all, newDate]));
    setMonth(firstOfMonth(parseYmd(newDate)));
    setOpenDate(newDate);
    setNewDate('');
  };

  // One person in a picker. `slot` is the part this picker fills; `ctx` holds
  // the date's parts, excuses and substitutes. A person is locked (not
  // clickable) when they already have another part that day, filed an excuse,
  // or handed their part to a substitute - unless they are ticked here, so a
  // mistake can always be unticked.
  const renderPerson = (person, slot, selected, onClick, ctx) => {
    const key = nameKey(person.name);
    const elsewhere = (ctx.parts[key]?.parts || []).filter((p) => p !== slot);
    const excuse = ctx.excused[key];
    const subbedTo = ctx.subs?.out[key];
    const subFor = ctx.subs?.subFor[key];
    const needsSub = ctx.subs?.needs[key];
    const lockedBy = elsewhere.length ? `🔒 ${elsewhere.map((p) => PART_TAG[p] || p).join(' · ')}`
      : excuse ? excuse
      : subbedTo ? `Sub: ${short(subbedTo)}`
      : null;
    const locked = !selected && !!lockedBy;
    const clash = selected && elsewhere.length > 0;
    const load = monthLoad[key] || 0;
    const isMe = me?.id && person.id === me.id;
    const twin = nameTwins[key];
    const why = twin ? `${twin.count} accounts are named ${person.name}, so the planner counts them as one person`
      : elsewhere.length ? `Already ${elsewhere.join(' · ')} on this date`
      : excuse ? `${excuse} for this date`
      : subbedTo ? `${subbedTo} is substituting for them on this date`
      : null;
    return (
      <button key={`${slot}-${person.id}`} type="button" aria-pressed={selected} disabled={locked}
        className={`mp-person ${selected ? 'on' : ''} ${locked ? 'locked' : ''} ${excuse || subbedTo ? 'away' : ''} ${clash ? 'clash' : ''}`}
        title={[person.name, why].filter(Boolean).join(' · ')}
        onClick={onClick}>
        <Avatar name={person.name} picture={person.profile_picture} />
        <span className="mp-person-name">{short(person.name)}</span>
        {isMe && <span className="mp-tag mp-tag-you">You</span>}
        {twin && <span className="mp-tag mp-tag-clash" title={why}><i className="fas fa-triangle-exclamation"></i> Same name</span>}
        {locked && <span className={`mp-tag ${excuse || subbedTo ? 'mp-tag-away' : 'mp-tag-taken'}`}>{lockedBy}</span>}
        {clash && <span className="mp-tag mp-tag-clash">Also {elsewhere.map((p) => PART_TAG[p] || p).join(' · ')}</span>}
        {selected && excuse && <span className="mp-tag mp-tag-away">{excuse}</span>}
        {selected && subFor && <span className="mp-tag mp-tag-sub">Sub for {short(subFor)}</span>}
        {selected && needsSub && <span className="mp-tag mp-tag-away">Needs sub</span>}
        {!selected && !locked && load > 0 && <span className="mp-tag mp-tag-load" title={`On ${load} Sunday${load === 1 ? '' : 's'} this month`}>{load}×</span>}
        {selected && <i className="fas fa-check mp-person-check"></i>}
      </button>
    );
  };

  // The collapsed row: who is on, grouped, first names only.
  const renderSummary = (v) => {
    const names = (list) => (list.length > 3 ? `${list.slice(0, 3).map(short).join(', ')} +${list.length - 3}` : list.map(short).join(', '));
    const groups = [
      v.songLeader && { icon: 'fa-microphone', cls: 'lead', text: short(v.songLeader), title: `Song Leader: ${v.songLeader}` },
      v.backupSingers.length && { icon: 'fa-users', cls: 'backup', text: names(v.backupSingers), title: `Backup Singers: ${v.backupSingers.join(', ')}` },
      ...LINEUP_INSTRUMENTS.filter(({ token }) => v.musicians[token]?.length).map(({ token, label, icon }) => (
        { icon, cls: 'band', text: names(v.musicians[token]), title: `${label}: ${v.musicians[token].join(', ')}` })),
      v.dancers.length && { icon: 'fa-person-running', cls: 'dance', text: names(v.dancers), title: `Dancers: ${v.dancers.join(', ')}` },
    ].filter(Boolean);
    if (!groups.length) return <span className="mp-summary-empty">Nobody on yet</span>;
    return groups.map((g) => (
      <span key={g.title} className={`mp-sum mp-sum-${g.cls}`} title={g.title}><i className={`fas ${g.icon}`}></i> {g.text}</span>
    ));
  };

  const renderRow = (date) => {
    const saved = byDate[date];
    const v = valueOf(date);
    const past = date < today;
    const dirty = isDirty(date);
    const open = expanded === date && !past;
    const songCount = (saved?.slowSongs?.length || 0) + (saved?.fastSongs?.length || 0);
    const d = parseYmd(date);
    const status = past ? { key: 'past', label: 'Past' }
      : dirty ? { key: 'dirty', label: 'Unsaved' }
      : saved ? (songCount ? { key: 'songs', label: `${songCount} song${songCount === 1 ? '' : 's'} added` } : { key: 'planned', label: 'Planned' })
      : { key: 'open', label: 'Not planned' };
    const ctx = { parts: lineupParts(v), excused: excusedOn[date] || {}, subs: subsOn[date] };
    const doubled = lineupDoubleBooked(v);
    const everyone = [v.songLeader, ...v.backupSingers, ...musicianNames(v.musicians), ...v.dancers].filter(Boolean);
    const awayPicked = [...new Set(everyone)].filter((n) => ctx.excused[nameKey(n)]);
    const noPlayers = LINEUP_INSTRUMENTS.filter(({ token }) => !playersFor[token].length).map(({ label }) => label);

    return (
      <div key={date} className={`mp-row status-${status.key} ${open ? 'open' : ''}`}>
        <button type="button" className="mp-row-head" onClick={() => !past && setOpenDate(open ? null : date)} disabled={past} aria-expanded={open}>
          <span className="mp-date">
            <span className="mp-date-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <span className="mp-date-day">{d.getDate()}</span>
          </span>
          <span className="mp-summary">
            {open
              ? <span className="mp-summary-open">{longDate(date)} · {new Set(everyone).size} on this Sunday</span>
              : renderSummary(v)}
          </span>
          <span className={`mp-status mp-status-${status.key}`}>{status.label}</span>
          {!past && <i className={`fas fa-chevron-down mp-row-caret ${open ? 'up' : ''}`}></i>}
        </button>

        {open && (
          <div className="mp-row-body">
            <div className="mp-editor">
              {/* Singers */}
              <section className="mp-panel mp-panel-singers">
                <header className="mp-panel-head"><i className="fas fa-microphone-lines"></i> Singers</header>
                <div className="mp-slot">
                  <div className="mp-slot-head">Song Leader <small>pick one</small></div>
                  {leaders.length ? (
                    <div className="mp-people">
                      {leaders.map((p) => renderPerson(p, 'Song Leader', v.songLeader === p.name, () => pickLeader(date, p.name), ctx))}
                    </div>
                  ) : <p className="mp-slot-empty">Nobody has the Song Leader position yet.</p>}
                </div>
                <div className="mp-slot">
                  <div className="mp-slot-head">Backup Singers <small>{v.backupSingers.length ? `${v.backupSingers.length} chosen` : 'pick any'}</small></div>
                  {backups.length ? (
                    <div className="mp-people">
                      {backups.map((p) => renderPerson(p, 'Backup Singer', v.backupSingers.includes(p.name), () => toggleBackup(date, p.name), ctx))}
                    </div>
                  ) : <p className="mp-slot-empty">Nobody has the Backup Singer position yet.</p>}
                </div>
              </section>

              {/* Musicians */}
              <section className="mp-panel mp-panel-band">
                <header className="mp-panel-head"><i className="fas fa-guitar"></i> Musicians</header>
                {LINEUP_INSTRUMENTS.filter(({ token }) => playersFor[token].length).map(({ token, label, icon }) => (
                  <div key={token} className="mp-slot mp-slot-inline">
                    <div className="mp-slot-head"><i className={`fas ${icon}`}></i> {label}</div>
                    <div className="mp-people">
                      {playersFor[token].map((p) => renderPerson(p, label, (v.musicians[token] || []).includes(p.name), () => toggleMusician(date, token, p.name), ctx))}
                    </div>
                  </div>
                ))}
                {noPlayers.length > 0 && (
                  <p className="mp-slot-empty">No one plays {noPlayers.join(', ')} yet.</p>
                )}
              </section>

              {/* Dancers */}
              <section className="mp-panel mp-panel-dance">
                <header className="mp-panel-head"><i className="fas fa-person-running"></i> Dancers <small>{v.dancers.length ? `${v.dancers.length} chosen` : 'pick any'}</small></header>
                {dancerPool.length ? (
                  <div className="mp-people">
                    {dancerPool.map((p) => renderPerson(p, 'Dancer', v.dancers.includes(p.name), () => toggleDancer(date, p.name), ctx))}
                  </div>
                ) : <p className="mp-slot-empty">Nobody has the Dancer position yet.</p>}
              </section>
            </div>

            {doubled.map((p) => (
              <p key={p.name} className="mp-note danger">
                <i className="fas fa-user-lock"></i> {p.name} has more than one part ({p.parts.join(', ')}). One person, one part: untick all but one.
              </p>
            ))}
            {awayPicked.length > 0 && (
              <p className="mp-note warn"><i className="fas fa-calendar-xmark"></i> {awayPicked.join(', ')} filed an excuse for this date. Untick them to free the spot.</p>
            )}
            {saved && songCount > 0 && saved.songLeader && v.songLeader !== saved.songLeader && (
              <p className="mp-note"><i className="fas fa-music"></i> {saved.songLeader} already added {songCount} song{songCount === 1 ? '' : 's'}. They stay with this date.</p>
            )}

            <div className="mp-row-actions">
              {!v.songLeader
                ? <span className="mp-hint"><i className="fas fa-circle-exclamation"></i> Pick a Song Leader to save</span>
                : doubled.length > 0 && <span className="mp-hint"><i className="fas fa-circle-exclamation"></i> Give each person one part to save</span>}
              {dirty && <button type="button" className="mp-btn mp-btn-ghost" onClick={() => discard(date)}>Discard</button>}
              <button type="button" className="mp-btn mp-btn-primary" disabled={!dirty || !v.songLeader || doubled.length > 0 || saving[date] || savingAll} onClick={() => saveOne(date)}>
                <i className={`fas ${saving[date] ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> {saved ? 'Update Lineup' : 'Save Lineup'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mp">
      <div className="mp-toolbar">
        <div className="mp-month">
          <button type="button" className="mp-icon-btn" onClick={() => goMonth(-1)} aria-label="Previous month"><i className="fas fa-chevron-left"></i></button>
          <h3>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" className="mp-icon-btn" onClick={() => goMonth(1)} aria-label="Next month"><i className="fas fa-chevron-right"></i></button>
          {monthKey(month) !== monthKey(new Date()) && (
            <button type="button" className="mp-btn mp-btn-ghost mp-btn-sm" onClick={() => { setMonth(firstOfMonth(new Date())); setOpenDate(undefined); }}>This month</button>
          )}
        </div>
        <div className="mp-toolbar-right">
          <span className="mp-progress">
            <span className="mp-progress-bar"><span style={{ width: `${dates.length ? (plannedCount / dates.length) * 100 : 0}%` }}></span></span>
            {plannedCount} of {dates.length} planned
          </span>
          <button type="button" className="mp-btn mp-btn-primary" disabled={!dirtyDates.length || savingAll} onClick={saveAll}>
            <i className={`fas ${savingAll ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i> Save All{dirtyDates.length ? ` (${dirtyDates.length})` : ''}
          </button>
        </div>
      </div>

      <div className="mp-legend">
        <span><i className="fas fa-check"></i> picked</span>
        <span><span className="mp-tag mp-tag-taken">🔒 Backup</span> already has a part that day</span>
        <span><span className="mp-tag mp-tag-away">Excused</span> filed an excuse</span>
        <span><span className="mp-tag mp-tag-sub">Sub for Ana</span> substituting</span>
        <span><span className="mp-tag mp-tag-load">2×</span> Sundays this month</span>
      </div>

      {Object.values(nameTwins).map((t) => (
        <p key={t.name} className="mp-note warn mp-twin-note">
          <i className="fas fa-triangle-exclamation"></i>
          <span>
            <strong>{t.count} accounts are named {t.name}.</strong> Lineups save people by name, so the planner treats them
            as one person &mdash; picking one picks both. Give one of them a different name (for example a middle initial) in
            User Management &rsaquo; Manage &rsaquo; Edit User.
          </span>
        </p>
      ))}

      {loading ? (
        <div className="mp-loading"><i className="fas fa-spinner fa-spin"></i> Loading the month&hellip;</div>
      ) : (
        <div className="mp-rows">{dates.map(renderRow)}</div>
      )}

      <div className="mp-add-date">
        <span><i className="fas fa-calendar-plus"></i> Special service on another day?</span>
        <input type="date" value={newDate} min={today} onChange={(e) => setNewDate(e.target.value)} />
        <button type="button" className="mp-btn mp-btn-ghost mp-btn-sm" disabled={!newDate} onClick={addDate}>Add date</button>
      </div>
    </div>
  );
}
