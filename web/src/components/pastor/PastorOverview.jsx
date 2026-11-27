'use client';

// The Pastor's Home: an overview, and nothing else. What needs the Pastor,
// then one card for each thing worth watching - each says it once, with its
// own chart: Sunday check-ins, Sunday's lineup, Joyful Cares, the ministries,
// what is coming up, giving, and the people to greet. One request to
// /api/pastor/overview, refreshed while Home is open (useSmartPoll stops it
// for hidden or idle tabs).

import { useCallback, useState } from 'react';
import { useSmartPoll, POLL_MS } from '@/lib/pollingConfig';
import { peso } from '@/lib/giving';
import PastorReports from './PastorReports';
import './pastorOverview.css';

const TZ = 'Asia/Manila';
const PEOPLE_PREVIEW = 5;
const STATUS = [
  { key: 'follow', label: 'Needs follow-up' },
  { key: 'watch', label: 'Watch' },
  { key: 'care', label: 'In care' },
  { key: 'well', label: 'Doing well' },
];

// 'YYYY-MM-DD' -> words. Dates are the church's own, so read them as UTC.
const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const at = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...opts });
const ymdOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (r) => `${Math.round(r * 100)}%`;
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const teamName = (m) => (m.title === 'Media' ? 'Media team' : `${m.title}s`);

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function sundayLine(daysAway) {
  if (daysAway <= 0) return 'Sunday service is today';
  if (daysAway === 1) return 'Sunday service is tomorrow';
  return `${daysAway} days to Sunday service`;
}
function whenLabel(today, ymd) {
  const n = daysBetween(today, ymd);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return day(ymd, { weekday: 'short', month: 'short', day: 'numeric' });
}
function agoLabel(today, ymd) {
  const n = daysBetween(ymd, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

// ---- Building blocks ----

function Card({ id, title, sub, action, className = '', children }) {
  return (
    <section className={`po-card ${className}`} aria-labelledby={id}>
      <header className="po-card-head">
        <div className="po-card-heading">
          <h3 id={id} className="po-card-title">{title}</h3>
          {sub && <p className="po-card-sub">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Avatar({ person }) {
  if (person.picture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="po-avatar" src={person.picture} alt="" loading="lazy" />;
  }
  return <span className="po-avatar" aria-hidden="true">{initials(person.name)}</span>;
}

function Delta({ value, unit = '', label }) {
  if (value == null) return null;
  if (value === 0) return <span className="po-delta is-flat">No change{label ? ` ${label}` : ''}</span>;
  return (
    <span className={`po-delta ${value > 0 ? 'is-up' : 'is-down'}`}>
      <i className={`fas fa-arrow-${value > 0 ? 'up' : 'down'}`} aria-hidden="true"></i>
      {Math.abs(value)}{unit}{label ? <span className="po-delta-label"> {label}</span> : null}
    </span>
  );
}

function DateTile({ iso }) {
  return (
    <span className="po-datetile" aria-hidden="true">
      <span className="po-datetile-mon">{at(iso, { month: 'short' }).toUpperCase()}</span>
      <strong className="po-datetile-day">{at(iso, { day: 'numeric' })}</strong>
    </span>
  );
}

function Failed() {
  return <p className="po-empty">This could not be loaded just now. It will try again shortly.</p>;
}

// ---- Charts ----

// Rounded up to a tidy top for the axis: 7 -> 10, 34 -> 40, 120 -> 150.
function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * p;
}

function AttendanceChart({ weeks, avg }) {
  const W = 640; const H = 280; const L = 36; const R = 8; const T = 22; const B = 28;
  const top = niceMax(Math.max(...weeks.map((w) => w.count), avg || 0, 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const step = (W - L - R) / weeks.length;
  const barW = Math.min(30, step * 0.58);
  const lo = Math.min(...weeks.filter((w) => w.count > 0).map((w) => w.count));
  const hi = Math.max(...weeks.map((w) => w.count));
  return (
    <svg className="po-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Sunday check-ins over the last ${weeks.length} weeks, between ${lo} and ${hi}, average ${avg}`}>
      {[0, top / 2, top].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? 'po-chart-axis' : 'po-chart-grid'} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="po-chart-tick">{Math.round(v)}</text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const x = L + i * step + (step - barW) / 2;
        const last = i === weeks.length - 1;
        const h = w.count > 0 ? Math.max(3, y(0) - y(w.count)) : 0;
        return (
          <g key={w.date}>
            <title>{`${day(w.date, { month: 'short', day: 'numeric' })}: ${w.count ? `${w.count} checked in` : 'none recorded'}`}</title>
            {h > 0 && <rect x={x} y={y(0) - h} width={barW} height={h} rx="5" className={`po-chart-bar ${last ? 'is-last' : ''}`} />}
            {last && w.count > 0 && <text x={x + barW / 2} y={y(w.count) - 7} textAnchor="middle" className="po-chart-value">{w.count}</text>}
            {i % 2 === (weeks.length - 1) % 2 && (
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="po-chart-label">{day(w.date, { month: 'short', day: 'numeric' })}</text>
            )}
          </g>
        );
      })}
      {avg > 0 && (
        <g>
          <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} className="po-chart-avg" />
          {/* On the left, clear of the newest bar and its number. */}
          <text x={L + 4} y={y(avg) - 6} textAnchor="start" className="po-chart-avg-label">avg {avg}</text>
        </g>
      )}
    </svg>
  );
}

function Ring({ ready, total, size = 96 }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const done = total > 0 ? (ready / total) * c : 0;
  return (
    <svg className="po-ring" width={size} height={size} viewBox="0 0 80 80" role="img" aria-label={`${ready} of ${total} ready`}>
      <circle cx="40" cy="40" r={r} className="po-ring-track" />
      <circle cx="40" cy="40" r={r} className="po-ring-fill" strokeDasharray={`${done} ${c}`} transform="rotate(-90 40 40)" />
      <text x="40" y="44" textAnchor="middle" className="po-ring-num">{ready}/{total}</text>
    </svg>
  );
}

function Donut({ totals }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const all = STATUS.reduce((s, x) => s + (totals[x.key] || 0), 0);
  let offset = 0;
  return (
    <svg className="po-donut" viewBox="0 0 110 110" role="img"
      aria-label={STATUS.map((x) => `${totals[x.key] || 0} ${x.label.toLowerCase()}`).join(', ')}>
      <circle cx="55" cy="55" r={r} className="po-donut-track" />
      {all > 0 && STATUS.map((x) => {
        const len = ((totals[x.key] || 0) / all) * c;
        if (!len) return null;
        const gap = len > 6 ? 2 : 0;
        const seg = (
          <circle key={x.key} cx="55" cy="55" r={r} className={`po-donut-seg is-${x.key}`}
            strokeDasharray={`${len - gap} ${c - len + gap}`} strokeDashoffset={-offset} transform="rotate(-90 55 55)" />
        );
        offset += len;
        return seg;
      })}
      <text x="55" y="54" textAnchor="middle" className="po-donut-num">{all}</text>
      <text x="55" y="69" textAnchor="middle" className="po-donut-cap">members</text>
    </svg>
  );
}

// ---- The cards ----

function Attention({ data, canOpen, go, eventsSection }) {
  const { sunday, cares, isom, events, care } = data;
  const items = [];
  const push = (tone, icon, text, target) => items.push({ tone, icon, text, target: target && canOpen(target) ? target : null });
  if (cares?.totals?.follow) push('red', 'fa-hand-holding-heart', `${plural(cares.totals.follow, 'member')} ${cares.totals.follow === 1 ? 'needs' : 'need'} a follow-up`, 'joyful-cares');
  if (cares?.overdue) push('red', 'fa-clock', `${plural(cares.overdue, 'care follow-up')} overdue`, 'joyful-cares');
  if (!sunday.lineup && !sunday.failed) push('amber', 'fa-music', 'No lineup for Sunday yet', 'create-lineup');
  else if (sunday.lineup && sunday.lineup.total > sunday.lineup.ready) {
    const open = sunday.lineup.total - sunday.lineup.ready;
    push('amber', 'fa-music', `${plural(open, 'lineup part')} still open`, 'create-lineup');
  }
  const toCheck = (events || []).reduce((s, e) => s + (e.toCheck || 0), 0);
  if (toCheck) push('blue', 'fa-receipt', `${plural(toCheck, 'event payment')} to check`, eventsSection);
  if (isom?.waiting) push('blue', 'fa-user-graduate', `${plural(isom.waiting, 'ISOM inquiry', 'ISOM inquiries')} waiting`, 'isom-inquiries');
  if (care.unverifiedNew) push('amber', 'fa-user-clock', `${plural(care.unverifiedNew, 'new account')} not verified yet`, null);

  return (
    <section className="po-attention" aria-label="Needs your attention">
      <span className="po-attention-title"><i className="fas fa-bell" aria-hidden="true"></i>Needs your attention</span>
      {items.length === 0 ? (
        <span className="po-chip is-green"><i className="fas fa-circle-check" aria-hidden="true"></i>All caught up. Nothing needs you right now.</span>
      ) : items.map((it) => (it.target ? (
        <button key={it.text} type="button" className={`po-chip is-${it.tone}`} onClick={() => go(it.target)}>
          <i className={`fas ${it.icon}`} aria-hidden="true"></i>{it.text}<i className="fas fa-chevron-right po-chip-go" aria-hidden="true"></i>
        </button>
      ) : (
        <span key={it.text} className={`po-chip is-${it.tone}`}><i className={`fas ${it.icon}`} aria-hidden="true"></i>{it.text}</span>
      )))}
    </section>
  );
}

function AttendanceCard({ attendance, isSunday, canOpen, go }) {
  const weeks = attendance.weeks || [];
  const recorded = weeks.filter((w) => w.count > 0);
  const last = weeks[weeks.length - 1];
  const before = weeks[weeks.length - 2];
  const avg = recorded.length ? Math.round(recorded.reduce((s, w) => s + w.count, 0) / recorded.length) : 0;
  return (
    <Card id="po-att" className="po-a" title="Sunday check-ins" sub="The last 12 Sundays: ministry app, RFID cards and attendance marked by hand">
      {attendance.failed ? <Failed /> : !recorded.length ? (
        <div className="po-empty">
          <p>No check-ins on the last 12 Sundays yet.</p>
          {canOpen('attendance-management') && <button type="button" className="po-link" onClick={() => go('attendance-management')}>Open Attendance</button>}
        </div>
      ) : (
        <>
          <div className="po-headline">
            <strong>{last.count}</strong>
            <span className="po-headline-text">
              checked in {isSunday ? 'today' : 'last Sunday'}
              <span className="po-headline-meta">
                {before && before.count > 0 && last.count > 0 && <Delta value={last.count - before.count} label="on the Sunday before" />}
                <span className="po-muted">Average {avg}</span>
              </span>
            </span>
          </div>
          <AttendanceChart weeks={weeks} avg={avg} />
        </>
      )}
    </Card>
  );
}

function ReadinessCard({ sunday, canOpen, go }) {
  const lineup = sunday.lineup;
  const when = `${day(sunday.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${sunday.time}`;
  const action = canOpen('create-lineup') && (
    <button type="button" className="po-link" onClick={() => go('create-lineup')}>{lineup ? 'Open lineup' : 'Plan lineup'}</button>
  );
  return (
    <Card id="po-ready" className="po-r" title="Sunday readiness" sub={when} action={action}>
      {!lineup ? (
        <p className="po-empty">{sunday.failed ? 'The lineup could not be loaded just now.' : 'No lineup for this Sunday yet: no song leader, songs, singers, musicians or dancers.'}</p>
      ) : (
        <>
          <div className="po-ready-top">
            <Ring ready={lineup.ready} total={lineup.total} />
            <p className="po-ready-note">
              {lineup.ready === lineup.total ? 'Everything on the lineup is set.' : `${plural(lineup.total - lineup.ready, 'part')} still ${lineup.total - lineup.ready === 1 ? 'needs' : 'need'} someone.`}
            </p>
          </div>
          <ul className="po-checklist">
            {lineup.items.map((item) => (
              <li key={item.key} className={item.ready ? 'is-ready' : 'is-open'}>
                <i className={`fas ${item.ready ? 'fa-circle-check' : 'fa-circle-exclamation'}`} aria-hidden="true"></i>
                <span className="po-check-text"><strong>{item.label}</strong><span>{item.detail}</span></span>
                <span className="po-sr">{item.ready ? 'Ready' : 'Not ready'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function CaresCard({ cares, canOpen, go }) {
  const action = canOpen('joyful-cares') && (
    <button type="button" className="po-link" onClick={() => go('joyful-cares')}>Open Joyful Cares</button>
  );
  if (!cares) return <Card id="po-cares" className="po-c" title="Joyful Cares" action={action}><Failed /></Card>;
  const t = cares.totals;
  const people = cares.flagged.filter((p) => p.status === 'follow' || p.status === 'care').slice(0, 3);
  return (
    <Card id="po-cares" className="po-c" title="Joyful Cares" sub="How the ministry members are doing" action={action}>
      {!t.members ? <p className="po-empty">No ministry members yet.</p> : (
        <>
          <div className="po-cares-top">
            <Donut totals={t} />
            <ul className="po-legend">
              {STATUS.map((s) => (
                <li key={s.key}>
                  <span className={`po-key is-${s.key}`} aria-hidden="true" />
                  <span className="po-legend-label">{s.label}</span>
                  <strong>{t[s.key] || 0}</strong>
                </li>
              ))}
            </ul>
          </div>
          {people.length > 0 ? (
            <ul className="po-mini-people" aria-label="Who needs you">
              {people.map((p) => (
                <li key={p.id}>
                  <Avatar person={p} />
                  <span className="po-mini-text">
                    <strong>{p.name}</strong>
                    <span>{p.status === 'care' ? `In care${p.assignedName ? ` with ${p.assignedName.split(' ')[0]}` : ''}` : p.flags[0]}</span>
                  </span>
                  <span className={`po-dot is-${p.status}`} aria-hidden="true" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="po-calm"><i className="fas fa-seedling" aria-hidden="true"></i>Nobody needs a follow-up right now.</p>
          )}
        </>
      )}
    </Card>
  );
}

function MinistriesCard({ cares }) {
  if (!cares) return <Card id="po-min" className="po-m" title="Ministries"><Failed /></Card>;
  const list = cares.ministries || [];
  return (
    <Card id="po-min" className="po-m" title="Ministries" sub="Sunday attendance over the last 8 recorded Sundays, and the change on the 8 before">
      {!list.length ? <p className="po-empty">No ministry members yet.</p> : (
        <ul className="po-hbars">
          {list.map((m) => {
            const change = m.rate8 != null && m.ratePrev != null ? Math.round((m.rate8 - m.ratePrev) * 100) : null;
            return (
              <li key={m.key}>
                <span className="po-hbar-icon" aria-hidden="true"><i className={`fas ${m.icon}`}></i></span>
                <span className="po-hbar-name"><strong>{teamName(m)}</strong><span>{plural(m.members, 'member')}{m.follow ? ` · ${m.follow} to follow up` : ''}</span></span>
                <span className="po-hbar-track" role="img" aria-label={m.rate8 == null ? 'No Sundays recorded' : `${pct(m.rate8)} attendance`}>
                  <span className="po-hbar-fill" style={{ width: `${m.rate8 == null ? 0 : Math.max(2, m.rate8 * 100)}%` }} />
                </span>
                <span className="po-hbar-val">{m.rate8 == null ? '—' : pct(m.rate8)}</span>
                <span className="po-hbar-delta">{change == null ? '' : <Delta value={change} unit=" pts" />}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ComingUpCard({ events, meetings, canOpen, go, eventsSection, onExportEvent }) {
  const rows = [
    ...(events || []).map((e) => ({ ...e, kind: 'event' })),
    ...(meetings || []).map((m) => ({ ...m, kind: 'meeting' })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 5);
  const action = canOpen(eventsSection) && <button type="button" className="po-link" onClick={() => go(eventsSection)}>All events</button>;
  return (
    <Card id="po-ev" className="po-e" title="Coming up" sub="Events and ministry meetings" action={action}>
      {events == null && meetings == null ? <Failed /> : rows.length === 0 ? <p className="po-empty">Nothing scheduled yet.</p> : (
        <ul className="po-rows">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="po-row">
              <DateTile iso={r.at} />
              <span className="po-row-text">
                <span className="po-row-title"><strong>{r.title}</strong><span className={`po-tag is-${r.kind}`}>{r.kind === 'event' ? 'Event' : 'Meeting'}</span></span>
                {r.kind === 'event' ? (
                  <>
                    <span>{!r.takesRegistrations ? 'Open to all, no registration'
                      : [r.capacity ? `${r.registered} of ${r.capacity} registered` : plural(r.registered, 'registration'),
                        r.toCheck ? `${plural(r.toCheck, 'payment')} to check` : null].filter(Boolean).join(' · ')}</span>
                    {r.takesRegistrations && r.capacity && (
                      <span className="po-bar" aria-hidden="true"><span className="po-bar-fill is-blue" style={{ width: `${Math.min(100, (r.registered / r.capacity) * 100)}%` }} /></span>
                    )}
                  </>
                ) : (
                  <span>{[r.ministry, at(r.at, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), `${r.going} going`].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              {r.kind === 'event' && onExportEvent && r.takesRegistrations && canOpen(eventsSection) && (
                <button type="button" className="po-icon-btn" onClick={() => onExportEvent(r.id)} aria-label={`Export the registrations for ${r.title}`} title="Export registrations">
                  <i className="fas fa-file-export" aria-hidden="true"></i>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GivingCard({ drives, canOpen, go, onReport }) {
  const raised = (drives || []).reduce((s, d) => s + (Number(d.raised) || 0), 0);
  const action = <button type="button" className="po-link" onClick={onReport}>Donations report</button>;
  return (
    <Card id="po-give" className="po-g" title="Giving" sub="Open donation drives, confirmed gifts" action={action}>
      {drives == null ? <Failed /> : drives.length === 0 ? <p className="po-empty">No donation drives open.</p> : (
        <>
          <div className="po-headline is-small">
            <strong>{peso(raised)}</strong>
            <span className="po-headline-text">raised across {plural(drives.length, 'drive')}</span>
          </div>
          <ul className="po-rows is-tight">
            {drives.map((d) => {
              const p = d.goal > 0 ? Math.min(100, (d.raised / d.goal) * 100) : null;
              const reached = d.goal > 0 && d.raised >= d.goal;
              return (
                <li key={d.id} className="po-drive">
                  <span className="po-drive-head"><strong>{d.title}</strong><span className={reached ? 'is-good' : ''}>{p == null ? plural(d.gifts, 'gift') : reached ? 'Goal reached' : `${Math.round(p)}%`}</span></span>
                  {p != null && <span className="po-bar" aria-hidden="true"><span className="po-bar-fill" style={{ width: `${Math.max(2, p)}%` }} /></span>}
                  <span className="po-drive-sub">{d.goal > 0 ? `${peso(d.raised)} of ${peso(d.goal)}` : peso(d.raised)}{d.endsOn ? ` · ends ${day(d.endsOn, { month: 'short', day: 'numeric' })}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {canOpen('give') && <button type="button" className="po-link po-card-foot-link" onClick={() => go('give')}>Open Give</button>}
    </Card>
  );
}

function PeopleCard({ care, today, canMessage, onMessage }) {
  const [tab, setTab] = useState(care.newCount ? 'new' : 'birthdays');
  const [all, setAll] = useState(false);
  const list = tab === 'new' ? care.newPeople : care.birthdays;
  const shown = all ? list : list.slice(0, PEOPLE_PREVIEW);
  const tabs = [
    { id: 'new', label: 'New accounts', count: care.newCount },
    { id: 'birthdays', label: 'Birthdays', count: care.birthdays.length },
  ];
  return (
    <Card id="po-people" className="po-p" title="People to greet" sub={`New in the last ${care.newDays} days, birthdays in the next 7`}>
      <div className="po-seg" role="tablist" aria-label="People to greet">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`po-seg-btn ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => { setTab(t.id); setAll(false); }}>
            {t.label}<span className="po-seg-count">{t.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {list.length === 0 ? (
          <p className="po-empty">{tab === 'new' ? `Nobody new in the last ${care.newDays} days.` : 'No birthdays in the next 7 days.'}</p>
        ) : (
          <ul className="po-people">
            {shown.map((p) => (
              <li key={`${tab}-${p.id}`}>
                <Avatar person={p} />
                <span className="po-mini-text">
                  <strong>{p.name}</strong>
                  <span>
                    {tab === 'new'
                      ? [p.role || 'Guest', `joined ${agoLabel(today, ymdOf(p.joined))}`, p.verified ? null : 'not verified'].filter(Boolean).join(' · ')
                      : [`Birthday ${whenLabel(today, p.on)}`, p.ministry].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {canMessage && p.canMessage && (
                  <button type="button" className="po-icon-btn" onClick={() => onMessage(p.id)} aria-label={`Message ${p.name}`} title="Message">
                    <i className="fas fa-comment-dots" aria-hidden="true"></i>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.length > PEOPLE_PREVIEW && (
          <button type="button" className="po-link" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>
        )}
      </div>
    </Card>
  );
}

// ---- The page ----

export default function PastorOverview({ userId, firstname, fullName, active, canOpen, go, onMessage, onExportEvent }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pastor/overview?actorId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || 'The overview could not be loaded.');
      setData(json);
      setError('');
    } catch (e) {
      setError(e.message || 'The overview could not be loaded.');
      throw e;
    }
  }, [userId]);

  useSmartPoll(load, POLL_MS.pastorOverview, { enabled: !!active && !!userId });

  return (
    <PastorOverviewView data={data} error={error} onRetry={() => load().catch(() => {})}
      userId={userId} firstname={firstname} fullName={fullName}
      canOpen={canOpen} go={go} onMessage={onMessage} onExportEvent={onExportEvent} />
  );
}

// What the overview draws, from the route's answer (null while loading).
export function PastorOverviewView({ data, error, onRetry, userId, firstname, fullName, canOpen, go, onMessage, onExportEvent }) {
  const [reports, setReports] = useState(null); // null | the report to open on
  const name = data?.firstname || firstname || '';

  const head = (
    <header className="po-head">
      <div className="po-head-text">
        <p className="po-eyebrow">Pastor&rsquo;s overview</p>
        <h2 className="po-title">{greeting()}{name ? `, Pastor ${name}` : ''}</h2>
        {data && (
          <p className="po-sub">
            {day(data.today, { weekday: 'long', month: 'long', day: 'numeric' })}
            <span className="po-pill"><i className="fas fa-church" aria-hidden="true"></i>{sundayLine(data.sunday.daysAway)}</span>
          </p>
        )}
      </div>
      {data && (
        <div className="po-actions">
          <button type="button" className="po-btn" onClick={() => setReports('donations')}>
            <i className="fas fa-file-arrow-down" aria-hidden="true"></i>Download reports
          </button>
          {canOpen('announcements-management') && (
            <button type="button" className="po-btn po-btn-primary" onClick={() => go('announcements-management')}>
              <i className="fas fa-bullhorn" aria-hidden="true"></i>Post announcement
            </button>
          )}
        </div>
      )}
    </header>
  );

  if (!data) {
    return (
      <div className="po" aria-busy={!error}>
        {head}
        {error ? (
          <div className="po-card po-error" role="alert">
            <p>{error}</p>
            <button type="button" className="po-btn" onClick={onRetry}>Try again</button>
          </div>
        ) : (
          <div className="po-grid po-skeleton" aria-hidden="true">
            <span className="po-skel po-a" /><span className="po-skel po-r" /><span className="po-skel po-c" /><span className="po-skel po-m" />
          </div>
        )}
      </div>
    );
  }

  const eventsSection = canOpen('events-management') ? 'events-management' : 'events';
  return (
    <div className="po">
      {head}
      <Attention data={data} canOpen={canOpen} go={go} eventsSection={eventsSection} />
      <div className="po-grid">
        <AttendanceCard attendance={data.attendance} isSunday={data.sunday.daysAway === 0} canOpen={canOpen} go={go} />
        <ReadinessCard sunday={data.sunday} canOpen={canOpen} go={go} />
        <CaresCard cares={data.cares} canOpen={canOpen} go={go} />
        <MinistriesCard cares={data.cares} />
        <ComingUpCard events={data.events} meetings={data.meetings} canOpen={canOpen} go={go} eventsSection={eventsSection} onExportEvent={onExportEvent} />
        <GivingCard drives={data.drives} canOpen={canOpen} go={go} onReport={() => setReports('donations')} />
        <PeopleCard care={data.care} today={data.today} canMessage={canOpen('messages')} onMessage={onMessage} />
      </div>
      {reports && (
        <PastorReports data={data} userId={userId} byName={fullName || name} initialReport={reports} onClose={() => setReports(null)} />
      )}
    </div>
  );
}
