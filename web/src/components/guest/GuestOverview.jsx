'use client';

// A Guest's Home in the dashboard: where their account stands and what
// membership opens, the next service, their events and their giving, the
// events coming up and the latest announcements, and the verse of the day.
// A Guest has the same dashboard as every other role (the capstone's Guest
// storyboard, Figures 36 to 40), with the pages a Guest may open; welcomed as
// a member, they stay right here and the sidebar gains pages.

import { useEffect, useMemo, useState } from 'react';
import { useMyGifts, givingTotals } from '@/lib/givingClient';
import { peso, phYear } from '@/lib/giving';
import { evtDate, evtStatus } from '@/lib/eventWhen';
import { nextGathering, phDayLabel, untilLabel } from '@/lib/serviceTimes';
import { REG_LABEL, REG_TONE, evtDay, useMyRegistrations, useUpcomingEvents, useAnnouncements } from '@/components/home/churchData';
import './guestOverview.css';

const MESSENGER_URL = 'https://m.me/CebuCityJoyfulSound';

function DateTile({ value }) {
  const d = evtDate(value);
  return (
    <span className="go-date" aria-hidden="true">
      <b>{d ? d.getDate() : '?'}</b>
      <small>{d ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : 'TBA'}</small>
    </span>
  );
}

/**
 * @param {object}   viewer    the signed-in account (the dashboard's userData)
 * @param {boolean}  verified  the church office has checked the account
 * @param {Function} go        open a dashboard section: go('events')
 * @param {Function} openGive  open a Give page: openGive('tithes' | 'donations' | 'my')
 * @param {object}   verse     the verse of the day: { verse, reference }
 */
export default function GuestOverview({ viewer, verified = false, go, openGive, verse }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const { gifts, loading: giftsLoading } = useMyGifts(viewer);
  const year = phYear();
  const totals = useMemo(() => givingTotals(gifts, year), [gifts, year]);
  const regs = useMyRegistrations(viewer?.id);
  const events = useUpcomingEvents();
  const notices = useAnnouncements();

  const first = String(viewer?.firstname || '').trim().split(/\s+/)[0];
  const phHour = Number(new Date(nowMs).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }));
  const greeting = phHour < 12 ? 'Good morning' : phHour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date(nowMs).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const next = nextGathering(nowMs);

  // Their events still to come, soonest first.
  const mine = Object.values(regs.byEvent)
    .filter((r) => evtStatus(r.event.event_date, r.event.end_date) !== 'ended')
    .sort((a, b) => (evtDate(a.event.event_date)?.getTime() || 0) - (evtDate(b.event.event_date)?.getTime() || 0));

  return (
    <div className="go">
      <header className="go-hello">
        <div>
          <small>{today}</small>
          <h2>{greeting}{first ? `, ${first}` : ''}</h2>
        </div>
        <button type="button" className="go-btn" onClick={() => go('my-profile')}>My profile</button>
      </header>

      <div className="go-notice" role="note">
        <span className="go-notice-ic" aria-hidden="true"><i className={`fas ${verified ? 'fa-circle-info' : 'fa-hourglass-half'}`}></i></span>
        <div className="go-notice-text">
          <strong>{verified ? 'You have a Guest account' : 'Your account is being reviewed'}</strong>
          <span>
            {verified
              ? 'The church office welcomes new members. Once you are a member, the Community Hub, Chat and the ministries open here, in this same dashboard.'
              : 'The church office checks new accounts, usually within 24 to 48 hours. Meanwhile you can see the events, read the announcements and give.'}
          </span>
        </div>
        <a className="go-btn is-primary" href={MESSENGER_URL} target="_blank" rel="noopener noreferrer">Message the church office</a>
      </div>

      <div className="go-kpis">
        <article className="go-kpi">
          <span className="go-label">Next service</span>
          {next ? (
            <>
              <strong>{next.name}, {next.time}</strong>
              <span>{phDayLabel(next.startMs)} · starts {untilLabel(next.startMs - nowMs)}</span>
            </>
          ) : (
            <><strong>Worship Service</strong><span>Every Sunday, 9:00 AM</span></>
          )}
          <a className="go-more" href="/sunday-service">Watch online</a>
        </article>
        <article className="go-kpi">
          <span className="go-label">My events</span>
          {regs.loading ? <span>Loading…</span> : mine.length ? (
            <>
              <strong>{mine.length} coming up</strong>
              <span>{mine[0].event.title}, {evtDay(mine[0].event.event_date)}</span>
            </>
          ) : (
            <><strong>None yet</strong><span>Register for an event and it shows here.</span></>
          )}
          <button type="button" className="go-more" onClick={() => go('events')}>Browse events</button>
        </article>
        <article className="go-kpi">
          <span className="go-label">My giving</span>
          {giftsLoading ? <span>Loading…</span> : gifts.length ? (
            <>
              <strong>{peso(totals.given)} in {year}</strong>
              <span>{totals.pending > 0 ? `${totals.pending} gift${totals.pending > 1 ? 's' : ''} waiting to be confirmed` : 'Every gift confirmed'}</span>
            </>
          ) : (
            <><strong>No gifts yet</strong><span>Tithes, offerings and donations, with receipts.</span></>
          )}
          <span className="go-more-row">
            <button type="button" className="go-more" onClick={() => openGive('tithes')}>Give</button>
            {gifts.length > 0 && <button type="button" className="go-more" onClick={() => openGive('my')}>My giving</button>}
          </span>
        </article>
      </div>

      <div className="go-two">
        <section className="go-card" aria-labelledby="go-events-title">
          <div className="go-card-head">
            <h3 id="go-events-title">Upcoming events</h3>
            <button type="button" className="go-more" onClick={() => go('events')}>All events</button>
          </div>
          {events.loading ? (
            <p className="go-muted">Loading…</p>
          ) : events.list.length === 0 ? (
            <p className="go-muted">No events coming up. New ones show here the moment they are published.</p>
          ) : (
            <ul className="go-rows">
              {events.list.slice(0, 4).map((e) => {
                const reg = regs.byEvent[e.id];
                return (
                  <li key={e.id}>
                    <DateTile value={e.event_date} />
                    <span className="go-row-main">
                      <strong>{e.title}</strong>
                      <small>{evtDay(e.event_date)}{e.loc_city ? ` · ${e.loc_city}` : ''}</small>
                    </span>
                    {reg
                      ? <span className={`go-pill ${REG_TONE[reg.status] || 'off'}`}>{REG_LABEL[reg.status] || String(reg.status || '').replace(/_/g, ' ')}</span>
                      : <button type="button" className="go-btn is-small" onClick={() => go('events')}>View</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="go-card" aria-labelledby="go-ann-title">
          <div className="go-card-head">
            <h3 id="go-ann-title">Announcements</h3>
            <button type="button" className="go-more" onClick={() => go('announcements')}>All</button>
          </div>
          {notices.loading ? (
            <p className="go-muted">Loading…</p>
          ) : notices.list.length === 0 ? (
            <p className="go-muted">No announcements right now.</p>
          ) : (
            <ul className="go-notes">
              {notices.list.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <strong>{a.is_pinned && <i className="fas fa-thumbtack" aria-label="Pinned"></i>} {a.title}</strong>
                  {a.content && <p>{a.content}</p>}
                  {a.created_at && <small>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {verse?.verse && (
        <figure className="go-card go-verse">
          <blockquote>“{verse.verse}”</blockquote>
          {verse.reference && <figcaption>{verse.reference}</figcaption>}
        </figure>
      )}
    </div>
  );
}
