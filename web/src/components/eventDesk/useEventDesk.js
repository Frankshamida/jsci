'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeUid, isPlausibleUid, formatUid } from '@/lib/rfid';
import { eventDaysOf, merchItemsOf } from '@/lib/eventFormat';

/* ============================================================
   Everything an event door knows, minus the reader hardware.

   Who came on which day, what they have collected, which day this desk is
   working on, and whether the columns are unlocked for corrections. The
   reader itself is useRfidReader - this hook is what a tap MEANS once a card
   number has arrived.

   Split from the reader on purpose: a desk with no reader at all still needs
   every one of these (the day columns are clickable by hand), and a reader
   with no event behind it is the member card page.

   USAGE
     const desk = useEventDesk({ event, actorId, showToast, onRegsChange });
   ============================================================ */

/* The master card, tapped to unlock the columns for corrections. One physical
   card, kept by whoever runs the event. Hard-coded rather than configurable
   because a lock whose key can be changed from the screen it locks is not a
   lock - and this one exists to make rewriting attendance deliberate. */
const UNLOCK_UID = normalizeUid('14 AF 2D A7');

/* Has this person's visit to a counter actually been written down?
   Used to warn when the next card replaces somebody whose kit or meal was
   never recorded - a desk that silently forgets one person per queue is
   worse than one that refuses to move on. */
export function claimDeskRecorded(desk, who, dayNumber) {
  if (!desk || !who || who.result !== 'matched') return true;
  // Nothing can be recorded for somebody who is not allowed to collect - not
  // checked in, not verified - so there is nothing to hold the queue for.
  if (who.blocked) return true;
  const held = who.claims || {};
  if (desk === 'kit') return !!held['kit-0'];
  const day = Number(dayNumber) || 1;
  return ['lunch', 'dinner'].some((meal) => !!held[`${meal}-${day}`]);
}

export default function useEventDesk({
  event,
  actorId = null,
  showToast = () => {},
  onRegsChange = null,
  sendToReader = null,
} = {}) {
  const eventId = event?.id || null;

  // The event's days and its kit, both read off the event row rather than
  // fetched - the day picker and the Attendance column are drawn from the
  // same list so they cannot disagree about how many days the event runs.
  const days = eventDaysOf(event);
  const dayNumbers = days.map((d) => d.number);
  const merchItems = merchItemsOf(event);

  // Which day this desk is working on.
  const [checkinDay, setCheckinDay] = useState(1);

  const [dayAttend, setDayAttend] = useState({});
  const [dayBusy, setDayBusy] = useState('');
  const [claims, setClaims] = useState({});
  const [claimBusy, setClaimBusy] = useState('');

  // The corrections lock.
  const [unlocked, setUnlocked] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockManual, setUnlockManual] = useState('');
  const [unlockError, setUnlockError] = useState('');

  // The check-in dialog.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  // Whether the dialog's capture box has the caret, which is the whole of
  // "is the USB wedge going to work". It cannot be inferred - only watched.
  const [scanBoxFocused, setScanBoxFocused] = useState(false);

  /* ---- Loading ---- */

  const loadClaims = useCallback(async (id) => {
    if (!id) { setClaims({}); return; }
    try {
      const res = await fetch(`/api/events/claims?eventId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.success) { setClaims(data.data || {}); return; }
      // An empty grid and a grid that could not be read look identical, and
      // one of them means somebody hands out a second lunch. The one cause
      // worth naming is the migration not having been run.
      if (/event_claims/i.test(data.message || '')) {
        showToast('Kit and meal tracking needs its migration: run supabase/migrations/event_claims.sql', 'warning');
      }
    } catch { /* the ticks redraw on the next load - not worth a toast */ }
  }, [showToast]);

  // Who came, on which days. One request for the whole grid.
  const loadDayAttendance = useCallback(async (id) => {
    if (!id) { setDayAttend({}); return; }
    try {
      const res = await fetch(`/api/events/attendance-days?eventId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.success) { setDayAttend(data.data || {}); return; }
      // Blank because nobody came, and blank because it could not be read,
      // look the same - and one of them locks every counter.
      if (/event_day_attendance/i.test(data.message || '')) {
        showToast('Per-day attendance needs its migration: run supabase/migrations/event_day_attendance.sql', 'warning');
      }
    } catch { /* redraws on the next load */ }
  }, [showToast]);

  useEffect(() => {
    if (eventId) { loadClaims(eventId); loadDayAttendance(eventId); }
    else { setClaims({}); setDayAttend({}); }
  }, [eventId, loadClaims, loadDayAttendance]);

  // The day the desk defaults to: the one happening now, else the first that
  // has not started. Opening the door on Day 2 and having it pre-set to Day 1
  // is how a whole morning gets recorded against the wrong session.
  useEffect(() => {
    if (!eventId || days.length === 0) return;
    const live = days.filter((d) => d.started);
    setCheckinDay(live.length > 0 ? live[live.length - 1].number : days[0].number);
    // Only when the event changes - re-running on every render would fight
    // the person who just picked a different day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /* ---- Marking one day by hand, and undoing it ---- */
  const toggleDay = useCallback(async (reg, dayNumber, attended) => {
    if (!eventId || dayBusy) return;
    setDayBusy(`${reg.id}:${dayNumber}`);
    try {
      const res = await fetch('/api/events/attendance-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, registrationId: reg.id, dayNumber, attended, actorId }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message, 'danger'); return; }

      let nextForReg = null;
      setDayAttend((prev) => {
        const forReg = { ...(prev[reg.id] || {}) };
        if (data.attended) forReg[String(dayNumber)] = data.day || { attended_at: new Date().toISOString() };
        else delete forReg[String(dayNumber)];
        nextForReg = forReg;
        return { ...prev, [reg.id]: forReg };
      });

      // The registration's own "came at all" flag is kept in step by the
      // server; mirror it here so the row does not need a reload.
      if (onRegsChange) {
        const any = Object.keys(nextForReg || {}).length > 0;
        onRegsChange((prev) => prev.map((r) => (r.id === reg.id
          ? { ...r, attended: any, attended_at: any ? (r.attended_at || new Date().toISOString()) : null }
          : r)));
      }
      showToast(data.message, data.attended ? 'success' : 'warning');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setDayBusy('');
    }
  }, [eventId, dayBusy, actorId, showToast, onRegsChange]);

  /* ---- A correction made straight on the row, with the columns unlocked ----
     Same endpoint the counters use, so the same rules apply - an unverified
     registration or somebody who never checked in is still refused, and the
     refusal says which. Unlocking removes the guard against a stray click; it
     does not remove the rules underneath. */
  const toggleClaim = useCallback(async (reg, kind, dayNumber, claimed) => {
    if (!eventId || claimBusy) return;
    const key = `${kind}-${Number(dayNumber) || 0}`;
    setClaimBusy(`${reg.id}:${key}`);
    try {
      const res = await fetch('/api/events/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          registrationId: reg.id,
          kind,
          dayNumber: Number(dayNumber) || 0,
          claimed,
          // A kit given back and re-given from the table keeps whatever was
          // recorded at the counter; there is no checklist here to re-tick.
          items: kind === 'kit' ? (claims[reg.id]?.['kit-0']?.items || []) : [],
          actorId,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message, 'danger'); return; }

      setClaims((prev) => {
        const forReg = { ...(prev[reg.id] || {}) };
        if (data.claimed) forReg[key] = data.claim || { claimed_at: new Date().toISOString(), items: [] };
        else delete forReg[key];
        return { ...prev, [reg.id]: forReg };
      });

      // Never silent. Taking something back off a record is exactly the
      // action this lock exists to make deliberate, so it says so out loud.
      const what = kind === 'kit' ? 'Kit' : `Day ${dayNumber} ${kind}`;
      showToast(
        data.claimed
          ? `${what} recorded for ${reg.attendee_name}`
          : `${what} taken back off ${reg.attendee_name}`,
        data.claimed ? 'success' : 'warning',
      );
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setClaimBusy('');
    }
  }, [eventId, claimBusy, claims, actorId, showToast]);

  /* ---- The master card ----
     Any other card is refused BY NAME rather than ignored - a reader that
     seems to do nothing is indistinguishable from a broken one, and the
     commonest mistake here is reaching for an attendee's card. */
  const tryUnlock = useCallback((rawUid) => {
    const uid = normalizeUid(rawUid);
    if (!isPlausibleUid(uid)) return;
    if (uid === UNLOCK_UID) {
      setUnlocked(true);
      setUnlockOpen(false);
      setUnlockError('');
      showToast('Columns unlocked — click any cell to correct it', 'success');
      return;
    }
    setUnlockError(`That is not the master card (${formatUid(uid)}). Only the master card unlocks editing.`);
  }, [showToast]);

  /* ---- A tap at the door ---- */
  const checkIn = useCallback(async (rawUid, source) => {
    if (!eventId) return;
    const uid = normalizeUid(rawUid);
    if (!isPlausibleUid(uid)) return;

    setScanBusy(true);
    try {
      const res = await fetch('/api/rfid/event-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid, eventId, source: source || 'manual', dayNumber: checkinDay, actorId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setScanResult({ result: 'error', message: data.message, uid });
        sendToReader?.('NO', data.message || 'Error');
        return;
      }
      setScanResult(data);

      // The board has been showing "Checking..." since the tap and cannot
      // clear it on its own - so it is told what happened either way.
      const name = data.registration?.attendee_name || '';
      if (data.result === 'checked_in') sendToReader?.('OK', name);
      else if (data.result === 'already_in') sendToReader?.('DUP', name);
      else sendToReader?.('NO', data.message || 'Not on this list');

      // The table behind the dialog has to agree with what it just said.
      // Ticked with the tap, not a request later: at a door the next card is
      // already coming, and a column that catches up a second after the queue
      // has moved on is a column nobody trusts.
      if (data.result === 'checked_in' || data.result === 'already_in') {
        const regId = data.registration?.id;
        const dayKey = String(data.dayNumber || checkinDay);
        if (regId) {
          setDayAttend((prev) => {
            // The server now returns the whole day list on a check-in, so the
            // picker's "attended" marks are the database's answer rather than
            // the screen's memory of what it just did.
            if (Array.isArray(data.days) && data.days.length > 0) {
              const fromServer = {};
              data.days.forEach((d) => {
                fromServer[String(d.day_number)] = { attended_at: d.attended_at };
              });
              return { ...prev, [regId]: fromServer };
            }
            const forReg = { ...(prev[regId] || {}) };
            if (!forReg[dayKey]) {
              forReg[dayKey] = { attended_at: new Date().toISOString(), attended_by: actorId };
            }
            return { ...prev, [regId]: forReg };
          });
          if (onRegsChange) {
            onRegsChange((prev) => prev.map((r) => (r.id === regId
              ? { ...r, attended: true, attended_at: r.attended_at || new Date().toISOString() }
              : r)));
          }
        }
      }
    } catch (err) {
      setScanResult({ result: 'error', message: err.message, uid });
      sendToReader?.('NO', 'Error');
    } finally {
      setScanBusy(false);
    }
  }, [eventId, checkinDay, actorId, onRegsChange, sendToReader]);

  return {
    // who is at the desk, for anything that writes its own row
    actorId,
    // the event's shape
    days, dayNumbers, merchItems,
    // which day
    checkinDay, setCheckinDay,
    // who came
    dayAttend, setDayAttend, dayBusy, toggleDay, reloadDays: () => loadDayAttendance(eventId),
    // what they hold
    claims, setClaims, claimBusy, toggleClaim, reloadClaims: () => loadClaims(eventId),
    // the lock
    unlocked, setUnlocked, unlockOpen, setUnlockOpen,
    unlockManual, setUnlockManual, unlockError, setUnlockError, tryUnlock,
    // the door
    scanOpen, setScanOpen, scanResult, setScanResult, scanInput, setScanInput,
    scanBusy, scanBoxFocused, setScanBoxFocused, checkIn,
  };
}
