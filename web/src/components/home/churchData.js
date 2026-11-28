'use client';

// What a member's (and a Guest's) Home reads from the pages they already
// have: their event registrations, the events coming up, the announcements
// and the sermons. Shared by components/guest/GuestOverview and
// components/home/MemberOverview.

import { useEffect, useState } from 'react';
import { evtDate, evtStatus } from '@/lib/eventWhen';

export const REG_LABEL = {
  registered: 'Registered',
  payment_verified: 'Paid',
  paid_pending_turnover: 'Paid',
  payment_submitted: 'Payment being checked',
  pending_payment: 'Awaiting payment',
  pending_cash: 'Pay at the desk',
  installment: 'Paying in parts',
};
export const REG_TONE = { registered: 'ok', payment_verified: 'ok', paid_pending_turnover: 'ok', payment_submitted: 'warn', pending_payment: 'warn', pending_cash: 'warn', installment: 'warn' };

export const evtDay = (value) => evtDate(value)?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) || '';

/** Their registrations, one per event: { byEvent: { [eventId]: { status, event } }, loading }. */
export function useMyRegistrations(userId) {
  const [regs, setRegs] = useState({ byEvent: {}, loading: true });
  useEffect(() => {
    if (!userId) { setRegs({ byEvent: {}, loading: false }); return undefined; }
    let alive = true;
    fetch(`/api/events/registrations?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        const byEvent = {};
        (j.success ? j.data : []).forEach((r) => {
          if (r.event && r.status !== 'cancelled' && !byEvent[r.event.id]) byEvent[r.event.id] = { status: r.status, event: r.event };
        });
        setRegs({ byEvent, loading: false });
      })
      .catch(() => { if (alive) setRegs({ byEvent: {}, loading: false }); });
    return () => { alive = false; };
  }, [userId]);
  return regs;
}

/** The published events that have not ended, soonest first. */
export function useUpcomingEvents() {
  const [events, setEvents] = useState({ list: [], loading: true });
  useEffect(() => {
    let alive = true;
    fetch('/api/events?limit=20&published=true')
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        const list = (j.success && Array.isArray(j.data) ? j.data : [])
          .filter((e) => evtStatus(e.event_date, e.end_date) !== 'ended')
          .sort((a, b) => (evtDate(a.event_date)?.getTime() || 0) - (evtDate(b.event_date)?.getTime() || 0));
        setEvents({ list, loading: false });
      })
      .catch(() => { if (alive) setEvents({ list: [], loading: false }); });
    return () => { alive = false; };
  }, []);
  return events;
}

/** The announcements, pinned first, then the newest. */
export function useAnnouncements() {
  const [state, setState] = useState({ list: [], loading: true });
  useEffect(() => {
    let alive = true;
    fetch('/api/announcements')
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        const list = Array.isArray(j.data) ? j.data : (Array.isArray(j.announcements) ? j.announcements : []);
        list.sort((a, b) => (Number(!!b.is_pinned) - Number(!!a.is_pinned)) || (new Date(b.created_at) - new Date(a.created_at)));
        setState({ list, loading: false });
      })
      .catch(() => { if (alive) setState({ list: [], loading: false }); });
    return () => { alive = false; };
  }, []);
  return state;
}

/** The sermons, newest first (members only: /api/sermons checks the role). */
export function useSermons(userId) {
  const [state, setState] = useState({ list: [], loading: true });
  useEffect(() => {
    if (!userId) { setState({ list: [], loading: false }); return undefined; }
    let alive = true;
    fetch(`/api/sermons?actorId=${encodeURIComponent(userId)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => { if (alive) setState({ list: j.success && Array.isArray(j.sermons) ? j.sermons : [], loading: false }); })
      .catch(() => { if (alive) setState({ list: [], loading: false }); });
    return () => { alive = false; };
  }, [userId]);
  return state;
}
