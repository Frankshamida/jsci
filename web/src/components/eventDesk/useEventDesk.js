'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeUid, isPlausibleUid, formatUid, sameCard } from '@/lib/rfid';
import { eventDaysOf, eventDayForToday, guessDoorCheckIn, merchItemsOf } from '@/lib/eventFormat';
import { checkinTapFrom, publishCheckinDisplay } from '@/lib/checkinDisplay';

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
  // Every registration for the event, so a tap can put the name up before
  // the server has answered.
  regs = [],
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
  // Which card is whose at this event, so the door can say the name at the
  // tap. Read through a ref by checkIn, with the registrations and the day
  // grid, so a new tap never waits on a re-created callback.
  const [cardLinks, setCardLinks] = useState([]);
  const doorRef = useRef({ links: [], regs: [], dayAttend: {} });
  doorRef.current = { links: cardLinks, regs, dayAttend };
  // Bumped on every tap. An answer that comes back after the next card has
  // already been read updates the table, but must not replace the name of
  // the person now standing at the desk.
  const scanSeqRef = useRef(0);

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

  // ---- The day follows the calendar ----
  // On the date of Day 2 the desk is on Day 2 - the door, the meal counter
  // and the Mark Attended buttons alike. Opening the door on Day 2 and having
  // it pre-set to Day 1 is how a whole morning gets recorded against the
  // wrong session.
  //
  // Set when the event opens and whenever a desk dialog opens, then checked
  // every half minute so a desk left open overnight moves on by itself. A day
  // picked by hand is kept until the date changes again: the check only acts
  // when the calendar's answer is different from the last one it gave.
  const daysRef = useRef(days);
  daysRef.current = days;
  const autoDayRef = useRef(null);
  const followToday = useCallback(() => {
    const day = eventDayForToday(daysRef.current);
    if (day == null) return;
    autoDayRef.current = day;
    setCheckinDay(day);
  }, []);
  const daysKey = days.map((d) => `${d.number}:${d.dateKey || ''}`).join('|');
  useEffect(() => {
    if (!eventId || !daysKey) return undefined;
    followToday();
    const timer = setInterval(() => {
      if (eventDayForToday(daysRef.current) !== autoDayRef.current) followToday();
    }, 30000);
    return () => clearInterval(timer);
  }, [eventId, daysKey, followToday]);

  const loadCardLinks = useCallback(async (id) => {
    if (!id) { setCardLinks([]); return; }
    try {
      const res = await fetch(`/api/rfid/event-checkin?eventId=${encodeURIComponent(id)}&links=1`);
      const data = await res.json();
      if (data.success) setCardLinks(data.data || []);
    } catch { /* the name simply waits for the server, as before */ }
  }, []);

  // The door opening: on today's day, with the cards fresh.
  useEffect(() => {
    if (!scanOpen) return;
    followToday();
    loadCardLinks(eventId);
  }, [scanOpen, eventId, followToday, loadCardLinks]);

  // ---- The name screen at the door (/rfid-chekin-display) ----
  // The event, the day being checked in for, and the card just tapped (null
  // puts "Tap your card" back). Through a ref, so checkIn need not be
  // re-created whenever the event row or the day list is.
  const screenRef = useRef(() => {});
  screenRef.current = (tap = null) => {
    const day = Number(checkinDay) || 1;
    const dayRow = days.find((d) => d.number === day);
    publishCheckinDisplay({
      // Dates and venue too: the screen's welcome half says where and when.
      event: {
        id: eventId || '', title: event?.title || '', image: event?.image_url || '',
        start: event?.event_date || '', end: event?.end_date || '',
        venue: event?.location || '', city: event?.loc_city || '',
      },
      day: { number: day, label: dayRow?.label || '', days: days.length, date: dayRow?.dateKey || '' },
      tap,
    });
  };
  const screenIdle = useCallback(() => screenRef.current(), []);
  // Up as the door opens, and again if the day changes while it is open.
  useEffect(() => {
    if (scanOpen && eventId) screenRef.current();
  }, [scanOpen, eventId, checkinDay]);

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
    if (sameCard(uid, UNLOCK_UID)) {
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
    const seq = ++scanSeqRef.current;
    const latest = () => seq === scanSeqRef.current;
    // The name screen's id for this tap: the clock, because seq starts again
    // at 1 on a reload and would read as the same tap to a screen still up.
    const shownAs = Date.now();
    const screen = (result) => screenRef.current(checkinTapFrom(shownAs, result));

    // The name goes up with the tap, from the cards already on this screen,
    // and the server's answer replaces it a moment later. A card that is not
    // on this screen's list (a member's own card) still waits for the server.
    const guess = guessDoorCheckIn(doorRef.current, uid, checkinDay);
    setScanResult(guess);
    screen(guess);

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
        if (latest()) {
          setScanResult({ result: 'error', message: data.message, uid });
          screen({ result: 'error' });
        }
        sendToReader?.('NO', data.message || 'Error');
        return;
      }
      if (latest()) {
        setScanResult(data);
        screen(data);
      }

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
      if (latest()) {
        setScanResult({ result: 'error', message: err.message, uid });
        screen({ result: 'error' });
      }
      sendToReader?.('NO', 'Error');
    } finally {
      if (latest()) setScanBusy(false);
    }
  }, [eventId, checkinDay, actorId, onRegsChange, sendToReader]);

  return {
    // who is at the desk, for anything that writes its own row
    actorId,
    // the event's shape
    days, dayNumbers, merchItems,
    // which day
    checkinDay, setCheckinDay, followToday,
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
    // the door's name screen, back to "Tap your card"
    screenIdle,
  };
}
