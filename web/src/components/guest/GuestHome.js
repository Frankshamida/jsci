'use client';

// A Guest's home - on the landing page, right under the hero, not in the
// dashboard. Guests have no dashboard: the members, ministry and staff do.
// What is theirs is here instead, in the site's own look:
//
//   My giving      this year's confirmed total, what is waiting, the latest
//                  gifts with their status and receipts
//   My events      the events they signed up for, coming up first
//   Watch          the Sunday Service (live or not) and the Midweek Service
//   My profile     their details and password, in a window (ProfileModal)
//
// It also asks the server whether the account is still only a Guest: one
// promoted to member since signing in gets the Dashboard in the navbar at once.

import { useEffect, useMemo, useState } from 'react';
import ProfileModal from '@/components/account/ProfileModal';
import { initialsOf, isGuestOnly, saveViewer } from '@/lib/viewer';
import { useMyGifts, givingTotals } from '@/lib/givingClient';
import { MY_GIVING_PATH, TITHES_PATH, STATUSES, fundLabel, giftDate, peso, phYear, receiptPath, statusLabel } from '@/lib/giving';
import { eventSlug } from '@/lib/eventSlug';
import { evtDate } from '@/lib/eventWhen';
import './guestHome.css';

const REG_LABEL = {
  registered: 'Registered',
  payment_verified: 'Paid',
  paid_pending_turnover: 'Paid',
  payment_submitted: 'Payment being checked',
  pending_payment: 'Awaiting payment',
  pending_cash: 'Pay at the desk',
  installment: 'Paying in parts',
};
const REG_TONE = { registered: 'ok', payment_verified: 'ok', paid_pending_turnover: 'ok', payment_submitted: 'warn', pending_payment: 'warn', pending_cash: 'warn', installment: 'warn' };

function useMyEvents(viewer) {
  const [state, setState] = useState({ list: [], loading: true });
  useEffect(() => {
    if (!viewer?.id) { setState({ list: [], loading: false }); return undefined; }
    let alive = true;
    fetch(`/api/events/registrations?userId=${encodeURIComponent(viewer.id)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        const now = Date.now() - 86400000;
        const rows = (j.success ? j.data : []).filter((r) => r.event && r.status !== 'cancelled');
        // Coming up first (soonest first), then the ones that are over.
        const when = (r) => evtDate(r.event.end_date || r.event.event_date)?.getTime() || 0;
        const upcoming = rows.filter((r) => when(r) >= now).sort((a, b) => when(a) - when(b));
        const past = rows.filter((r) => when(r) < now).sort((a, b) => when(b) - when(a));
        // One line per event, however many people were registered in it.
        const seen = new Set();
        const list = [...upcoming, ...past].filter((r) => (seen.has(r.event.id) ? false : seen.add(r.event.id)));
        setState({ list, loading: false, upcoming: upcoming.length });
      })
      .catch(() => { if (alive) setState({ list: [], loading: false }); });
    return () => { alive = false; };
  }, [viewer?.id]);
  return state;
}

export default function GuestHome({ viewer, live = false }) {
  const [profile, setProfile] = useState(false);
  const { gifts, loading: giftsLoading } = useMyGifts(viewer);
  const events = useMyEvents(viewer);
  const year = phYear();
  const totals = useMemo(() => givingTotals(gifts, year), [gifts, year]);
  const first = String(viewer.firstname || '').trim().split(/\s+/)[0];

  // Still only a Guest? (An Admin may have made them a member since.)
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/users?action=get-event-permissions&userId=${encodeURIComponent(viewer.id)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive || !j.success) return;
        const fresh = { ...(j.account || {}), allowed_event_types: j.allowed_event_types || [] };
        const changed = Object.keys(fresh).some((k) => JSON.stringify(fresh[k] ?? null) !== JSON.stringify(viewer[k] ?? null));
        if (changed) saveViewer({ ...viewer, ...fresh });
      })
      .catch(() => { /* the saved account stands */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.id]);

  if (!isGuestOnly(viewer)) return null;

  return (
    <section id="my-home" className="gh" aria-labelledby="gh-title">
      <div className="gh-inner">
        <div className="gh-top">
          <span className="gh-avatar" aria-hidden="true">
            {viewer.profile_picture ? <img src={viewer.profile_picture} alt="" referrerPolicy="no-referrer" /> : initialsOf(viewer)}
          </span>
          <div className="gh-hello">
            <span className="gh-eyebrow">Your home</span>
            <h2 id="gh-title">Welcome back{first ? `, ${first}` : ''}</h2>
            <p>Your giving, your events and our services, in one place.</p>
          </div>
          <button type="button" className="gh-btn" onClick={() => setProfile(true)}>My profile</button>
        </div>

        <div className="gh-grid">
          {/* ---- My giving ---- */}
          <article className="gh-card gh-giving">
            <div className="gh-card-head">
              <h3>My giving</h3>
              {gifts.length > 0 && <a href={MY_GIVING_PATH} className="gh-link">See all</a>}
            </div>
            {giftsLoading ? (
              <p className="gh-muted">Loading…</p>
            ) : gifts.length === 0 ? (
              <div className="gh-empty">
                <img src="/giving-assets/web/jar.webp" alt="" className="gh-jar" />
                <div>
                  <strong>No gifts yet</strong>
                  <p>Give your tithes and offerings online, and follow each gift here until it is confirmed.</p>
                  <a href={TITHES_PATH} className="gh-btn is-primary">Give</a>
                </div>
              </div>
            ) : (
              <>
                <div className="gh-totals">
                  <div><strong>{peso(totals.given)}</strong><span>Given in {year}</span></div>
                  <div><strong>{totals.pending}</strong><span>Waiting to be confirmed</span></div>
                </div>
                <ul className="gh-list">
                  {gifts.slice(0, 3).map((g) => (
                    <li key={g.receipt_no}>
                      <div className="gh-list-main">
                        <strong>{peso(g.amount)} <span>· {fundLabel(g)}</span></strong>
                        <small>{giftDate(g.given_at)} · {g.method_name}</small>
                      </div>
                      <span className={`gh-pill ${STATUSES[g.status]?.tone || 'warn'}`}>{statusLabel(g.status)}</span>
                      <a href={receiptPath(g.token)} className="gh-link">Receipt</a>
                    </li>
                  ))}
                </ul>
                <div className="gh-actions">
                  <a href={TITHES_PATH} className="gh-btn is-primary">Give</a>
                  <a href="/donation" className="gh-btn">Donate</a>
                </div>
              </>
            )}
          </article>

          {/* ---- My events ---- */}
          <article className="gh-card">
            <div className="gh-card-head">
              <h3>My events</h3>
            </div>
            {events.loading ? (
              <p className="gh-muted">Loading…</p>
            ) : events.list.length === 0 ? (
              <div className="gh-empty is-plain">
                <div>
                  <strong>No sign-ups yet</strong>
                  <p>Events you register for show here, with where your registration stands.</p>
                  <a href="/#news" className="gh-btn">See upcoming events</a>
                </div>
              </div>
            ) : (
              <ul className="gh-list">
                {events.list.slice(0, 4).map((r) => {
                  const d = evtDate(r.event.event_date);
                  return (
                    <li key={r.id}>
                      <div className="gh-list-main">
                        <strong className="is-wrap">{r.event.title}</strong>
                        <small>{d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{r.event.loc_city ? ` · ${r.event.loc_city}` : ''}</small>
                      </div>
                      <span className={`gh-pill ${REG_TONE[r.status] || 'off'}`}>{REG_LABEL[r.status] || String(r.status || '').replace(/_/g, ' ')}</span>
                      <a href={`/${eventSlug(r.event)}`} className="gh-link">Open</a>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>

          {/* ---- Watch ---- */}
          <article className="gh-card">
            <div className="gh-card-head"><h3>Watch</h3></div>
            <ul className="gh-watch">
              <li>
                <a href="/sunday-service" className={live ? 'is-live' : ''}>
                  <strong>Sunday Service{live && <span className="gh-live"><span className="gh-dot" aria-hidden="true"></span> Live</span>}</strong>
                  <small>{live ? 'We are live right now. Join in.' : 'Every Sunday at 9:00 AM, and the ones you missed'}</small>
                </a>
              </li>
              <li>
                <a href="/midweek">
                  <strong>Midweek Service</strong>
                  <small>Our online midweek services</small>
                </a>
              </li>
              <li>
                <a href="/news">
                  <strong>News</strong>
                  <small>Stories from the church</small>
                </a>
              </li>
            </ul>
          </article>
        </div>
      </div>
      {profile && <ProfileModal viewer={viewer} onClose={() => setProfile(false)} />}
    </section>
  );
}
