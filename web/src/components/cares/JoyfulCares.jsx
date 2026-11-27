'use client';

// Dashboard > Joyful Cares: the Pastors' care desk. How every ministry and
// every member in it is doing, who needs a follow-up and who is in whose
// care. The numbers come from /api/cares (lib/joyfulCaresServer.js); each
// member opens in CareMember.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_ORDER } from '@/lib/joyfulCares';
import CareMember from './CareMember';
import { Avatar, StatusPill, SundayDots, Ring, Spark, Trend, day, plural, ago } from './careBits';
import './joyfulCares.css';

const TABS = [
  { id: 'ministries', label: 'Ministries', icon: 'fa-people-group' },
  { id: 'members', label: 'Members', icon: 'fa-users' },
  { id: 'followups', label: 'Follow-ups', icon: 'fa-list-check' },
];

// "Singers", "Musicians", "Dancers", "Ushers" - and "Media team".
const teamName = (m) => (m.title === 'Media' ? 'Media team' : `${m.title}s`);

function MinistryCard({ m, onSee }) {
  const total = Math.max(1, m.members);
  return (
    <article className="jc-ministry">
      <header className="jc-ministry-head">
        <span className="jc-ministry-icon" aria-hidden="true"><i className={`fas ${m.icon}`}></i></span>
        <div>
          <h3>{teamName(m)}</h3>
          <p>{m.group} · {plural(m.members, 'member')}</p>
        </div>
      </header>
      <div className="jc-ministry-body">
        <Ring value={m.rate8} />
        <div className="jc-ministry-rate">
          <span className="jc-label">Sunday attendance</span>
          <Trend now={m.rate8} before={m.ratePrev} />
          <Spark trend={m.trend} />
        </div>
      </div>
      <div className="jc-stack" role="img"
        aria-label={STATUS_ORDER.map((k) => `${m.byStatus[k]} ${STATUSES[k].label.toLowerCase()}`).join(', ')}>
        {STATUS_ORDER.map((k) => m.byStatus[k] > 0 && (
          <span key={k} className={`jc-stack-${k}`} style={{ width: `${(m.byStatus[k] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="jc-legend">
        {STATUS_ORDER.map((k) => (
          <li key={k}><span className={`jc-key jc-stack-${k}`} aria-hidden="true" />{m.byStatus[k]} {STATUSES[k].short.toLowerCase()}</li>
        ))}
      </ul>
      <dl className="jc-ministry-stats">
        <div><dt>Excuses, 30 days</dt><dd>{m.excuses30}</dd></div>
        <div><dt>Duties missed, 30 days</dt><dd>{m.missedDuties30}</dd></div>
      </dl>
      {m.needs.length > 0 && (
        <p className="jc-ministry-needs"><i className="fas fa-hand-holding-heart" aria-hidden="true"></i>Needs follow-up: {m.needs.join(', ')}</p>
      )}
      <button type="button" className="jc-btn jc-btn-block" onClick={() => onSee(m.key)}>
        See the {teamName(m)}<i className="fas fa-arrow-right" aria-hidden="true"></i>
      </button>
    </article>
  );
}

function MemberCard({ m, today, onOpen }) {
  return (
    <button type="button" className={`jc-member is-${m.status}`} onClick={(e) => onOpen(m.id, e.currentTarget)}>
      <span className="jc-member-top">
        <Avatar person={m} ring={m.status} />
        <span className="jc-member-who">
          <strong>{m.name}</strong>
          <span>{m.ministries.map((x) => x.title).join(' · ')}</span>
        </span>
        <StatusPill status={m.status} small />
      </span>
      {m.flags.length > 0 ? (
        <span className="jc-member-flags">
          {m.flags.slice(0, 2).map((f) => <span key={f}><i className="fas fa-circle-exclamation" aria-hidden="true"></i>{f}</span>)}
          {m.flags.length > 2 && <span className="jc-muted">and {m.flags.length - 2} more</span>}
        </span>
      ) : (
        <span className="jc-member-flags is-calm"><span><i className="fas fa-seedling" aria-hidden="true"></i>Serving faithfully</span></span>
      )}
      <span className="jc-member-foot">
        <SundayDots weeks={m.signals.last8} />
        <span className="jc-member-last">
          {m.care.inCare && m.care.assignedName ? `With ${m.care.assignedName.split(' ')[0]}`
            : m.signals.lastCheckIn ? `Last in ${ago(today, m.signals.lastCheckIn)}` : 'No check-ins yet'}
        </span>
      </span>
    </button>
  );
}

export default function JoyfulCares({ userData, active, canOpen, onMessage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('ministries');
  const [q, setQ] = useState('');
  const [ministry, setMinistry] = useState('all');
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const tabRefs = useRef({});
  const actorId = userData?.id;

  const load = useCallback(async () => {
    if (!actorId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cares?actorId=${encodeURIComponent(actorId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Joyful Cares could not be loaded.');
      setData(json);
      setError('');
      setLoadedAt(new Date());
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [actorId]);

  // Loaded when first opened; after that, on Refresh and after each change.
  const opened = useRef(false);
  useEffect(() => {
    if (active && !opened.current) { opened.current = true; load(); }
  }, [active, load]);

  const members = useMemo(() => data?.members || [], [data]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return members.filter((m) => (ministry === 'all' || m.ministries.some((x) => x.key === ministry))
      && (status === 'all' || m.status === status)
      && (!term || [m.name, ...m.flags, ...m.ministries.map((x) => x.title)].join(' ').toLowerCase().includes(term)));
  }, [members, q, ministry, status]);

  const today = data?.today;
  const inCare = useMemo(() => members.filter((m) => m.care.inCare)
    .sort((a, b) => String(a.care.followUpOn || '9999').localeCompare(String(b.care.followUpOn || '9999'))), [members]);
  const waiting = useMemo(() => members.filter((m) => m.status === 'follow'), [members]);

  const showMembers = (filters) => {
    setMinistry(filters.ministry || 'all');
    setStatus(filters.status || 'all');
    setQ('');
    setTab('members');
    tabRefs.current.members?.focus();
  };

  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const counts = { ministries: data?.ministries.length ?? null, members: members.length || null, followups: (inCare.length + waiting.length) || null };
  const t = data?.totals;

  return (
    <div className="jc">
      {/* The dashboard's own page title, as on every other page. */}
      <h2 className="section-title">Joyful Cares</h2>

      <div className="jc-meta">
        <p className="jc-intro">
          See how every ministry and every member is doing, and reach the ones who need you.
          <span className="jc-muted">
            {' '}{data ? `${plural(data.totals.members, 'ministry member')}, from check-ins over the last ${data.windowWeeks} weeks` : 'Loading the ministries…'}
            {loadedAt ? `. Updated ${loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` : ''}
          </span>
        </p>
        <button type="button" className="jc-btn" onClick={load} disabled={loading}>
          <i className={`fas fa-rotate ${loading ? 'fa-spin' : ''}`} aria-hidden="true"></i>{loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="jc-tiles" role="group" aria-label="Members by status">
        {STATUS_ORDER.map((k) => (
          <button key={k} type="button" className={`jc-tile is-${k}`} onClick={() => showMembers({ status: k })} disabled={!data}>
            <span className="jc-tile-icon" aria-hidden="true"><i className={`fas ${STATUSES[k].icon}`}></i></span>
            <span className="jc-tile-text">
              <strong>{t ? t[k] : '–'}</strong>
              <span>{STATUSES[k].label}</span>
            </span>
          </button>
        ))}
      </div>

      {data && !data.tablesReady && (
        <p className="jc-banner"><i className="fas fa-database" aria-hidden="true"></i>To save care notes and follow-ups, run <code>supabase/migrations/joyful_cares.sql</code> in the Supabase SQL editor once. Everything else already works.</p>
      )}
      {data && data.sundaysRecorded === 0 && (
        <p className="jc-banner"><i className="fas fa-circle-info" aria-hidden="true"></i>No Sunday check-ins are recorded yet, so attendance cannot be judged. They come from the ministry app, RFID cards and Attendance.</p>
      )}
      {error && <p className="jc-error" role="alert">{error} <button type="button" className="jc-link" onClick={load}>Try again</button></p>}

      <div className="jc-tabs" role="tablist" aria-label="Joyful Cares">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" id={`jc-tab-${x.id}`} aria-controls={`jc-panel-${x.id}`}
            aria-selected={tab === x.id} tabIndex={tab === x.id ? 0 : -1} ref={(el) => { tabRefs.current[x.id] = el; }}
            className={`jc-tab ${tab === x.id ? 'is-on' : ''}`} onClick={() => setTab(x.id)} onKeyDown={onTabKey}>
            <i className={`fas ${x.icon}`} aria-hidden="true"></i>{x.label}
            {counts[x.id] != null && <span className="jc-tab-count">{counts[x.id]}</span>}
          </button>
        ))}
      </div>

      {!data && !error && (
        <div className="jc-skeleton" aria-busy="true"><span /><span /><span /><span /></div>
      )}

      {data && tab === 'ministries' && (
        <div id="jc-panel-ministries" role="tabpanel" aria-labelledby="jc-tab-ministries">
          {data.ministries.length === 0 ? (
            <p className="jc-empty"><i className="fas fa-people-group" aria-hidden="true"></i>No ministry members yet. They appear here once accounts have a ministry role.</p>
          ) : (
            <div className="jc-ministries">
              {data.ministries.map((m) => <MinistryCard key={m.key} m={m} onSee={(key) => showMembers({ ministry: key })} />)}
            </div>
          )}
        </div>
      )}

      {data && tab === 'members' && (
        <div id="jc-panel-members" role="tabpanel" aria-labelledby="jc-tab-members">
          <div className="jc-toolbar">
            <label className="jc-search">
              <i className="fas fa-magnifying-glass" aria-hidden="true"></i>
              <span className="jc-sr">Search members</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or reason" />
            </label>
            <label className="jc-select">
              <span className="jc-sr">Ministry</span>
              <select value={ministry} onChange={(e) => setMinistry(e.target.value)}>
                <option value="all">All ministries</option>
                {data.ministries.map((m) => <option key={m.key} value={m.key}>{teamName(m)}</option>)}
              </select>
            </label>
          </div>
          <div className="jc-filters" role="group" aria-label="Show">
            {['all', ...STATUS_ORDER].map((k) => (
              <button key={k} type="button" aria-pressed={status === k} className={`jc-filter ${status === k ? 'is-on' : ''} ${k !== 'all' ? `is-${k}` : ''}`} onClick={() => setStatus(k)}>
                {k === 'all' ? 'Everyone' : STATUSES[k].label}
                <span>{k === 'all' ? members.length : data.totals[k]}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="jc-empty"><i className="fas fa-seedling" aria-hidden="true"></i>{members.length ? 'Nobody matches these filters.' : 'No ministry members yet.'}</p>
          ) : (
            <div className="jc-members">
              {filtered.map((m) => <MemberCard key={m.id} m={m} today={today} onOpen={(id) => setOpenId(id)} />)}
            </div>
          )}
        </div>
      )}

      {data && tab === 'followups' && (
        <div id="jc-panel-followups" role="tabpanel" aria-labelledby="jc-tab-followups" className="jc-followups">
          <section aria-labelledby="jc-due-title">
            <h3 id="jc-due-title" className="jc-h3"><i className="fas fa-heart" aria-hidden="true"></i>In care</h3>
            {inCare.length === 0 ? (
              <p className="jc-empty is-small">Nobody is in care right now. Open a member and choose &ldquo;Take into care&rdquo; to give them a Pastor and a follow-up date.</p>
            ) : (
              <ul className="jc-rows">
                {inCare.map((m) => {
                  const due = m.care.followUpOn;
                  const late = due && due < today;
                  const isToday = due === today;
                  return (
                    <li key={m.id}>
                      <button type="button" className="jc-row-btn" onClick={() => setOpenId(m.id)}>
                        <span className={`jc-date ${late ? 'is-late' : isToday ? 'is-today' : ''}`}>
                          {due ? <><span>{day(due, { month: 'short' }).toUpperCase()}</span><strong>{day(due, { day: 'numeric' })}</strong></> : <i className="fas fa-calendar" aria-hidden="true"></i>}
                        </span>
                        <span className="jc-row-text">
                          <strong>{m.name}</strong>
                          <span>{[m.care.assignedName ? `With ${m.care.assignedName}` : 'No Pastor yet', due ? (late ? `follow-up was due ${ago(today, due)}` : isToday ? 'follow up today' : `follow up ${day(due, { weekday: 'long' })}`) : 'no follow-up date'].join(' · ')}</span>
                          {m.flags[0] && <span className="jc-muted">{m.flags[0]}</span>}
                        </span>
                        {late && <span className="jc-pill jc-pill-follow is-small">Overdue</span>}
                        <i className="fas fa-chevron-right jc-chev" aria-hidden="true"></i>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="jc-wait-title">
            <h3 id="jc-wait-title" className="jc-h3"><i className="fas fa-hand-holding-heart" aria-hidden="true"></i>Waiting for a Pastor</h3>
            {waiting.length === 0 ? (
              <p className="jc-empty is-small">Nobody is waiting. Everyone flagged for a follow-up is already in someone&rsquo;s care.</p>
            ) : (
              <ul className="jc-rows">
                {waiting.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="jc-row-btn" onClick={() => setOpenId(m.id)}>
                      <Avatar person={m} size={44} ring="follow" />
                      <span className="jc-row-text">
                        <strong>{m.name}</strong>
                        <span>{m.ministries.map((x) => x.title).join(' · ')}</span>
                        <span className="jc-row-flag">{m.flags.join(' · ')}</span>
                      </span>
                      <i className="fas fa-chevron-right jc-chev" aria-hidden="true"></i>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="jc-fine">
            A member needs a follow-up after 3 Sundays in a row without a check-in, or 2 missed lineup duties in 30 days.
            Watch: 2 Sundays in a row, a missed duty, 2 missed practices, 3 excuses or 3 substitute requests in 30 days, or Sunday attendance halved.
            Only days on which check-ins were taken count, and &ldquo;All clear&rdquo; on a member clears what came before.
          </p>
        </div>
      )}

      {openId && (
        <CareMember memberId={openId} actorId={actorId} canOpen={canOpen} onMessage={onMessage}
          onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}
