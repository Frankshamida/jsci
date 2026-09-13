'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeUid, isPlausibleUid } from '@/lib/rfid';
import { formatPersonName, formatChurchName, formatStampLine } from '@/lib/eventFormat';
import { claimDeskRecorded } from './useEventDesk';
import ReaderStatusStrip from './ReaderStatusStrip';
import DayPicker from './DayPicker';

/* ============================================================
   The kit counter and the meal counter.

   One dialog, two jobs, because they are the same shape: a card is tapped, a
   name appears, and only then is anything tickable. Nothing can be filled in
   before a card is read - that is the point, not a limitation. A checklist
   that works without a card is one that gets filled in for the person behind
   the person standing there.

   A tap here is a LOOKUP, never a check-in. Being handed a tote bag is not
   walking through a door, and a tap at the merch table must not mark somebody
   as having arrived - the API's ?uid= mode resolves without touching
   attendance.
   ============================================================ */

const personInitials = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
};

export default function ClaimCounter({
  deskKind,            // 'kit' | 'meals'
  onClose,
  event,
  desk,                // useEventDesk
  reader,              // useRfidReader
  showToast = () => {},
  onReady = null,      // hands the tap handler back to the parent
}) {
  const [who, setWho] = useState(null);
  const [ticked, setTicked] = useState([]);
  const [manual, setManual] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);

  const eventId = event?.id || null;
  const isKit = deskKind === 'kit';

  /* ---- A tap at a counter. Who is this, and what do they already hold? ---- */
  const lookup = useCallback(async (rawUid) => {
    if (!eventId) return;
    const uid = normalizeUid(rawUid);
    if (!isPlausibleUid(uid)) return;

    // The button will not skip somebody whose visit was never recorded - and
    // neither should the next card in the queue, silently. It still replaces
    // them, because the alternative is a desk that refuses to read a card
    // while the person it is waiting for has walked off; but it says whose
    // record was left empty, by name, while that is still fixable.
    const leaving = who;
    if (leaving?.result === 'matched' && !claimDeskRecorded(deskKind, leaving, desk.checkinDay)
      && normalizeUid(leaving.uid) !== uid) {
      showToast(
        `Nothing was recorded for ${leaving.registration?.attendee_name || 'the last card'}`,
        'warning',
      );
    }

    setLookupBusy(true);
    setTicked([]);
    try {
      const res = await fetch(`/api/rfid/event-checkin?eventId=${encodeURIComponent(eventId)}&uid=${encodeURIComponent(uid)}`);
      const data = await res.json();
      if (!data.success) {
        setWho({ result: 'error', message: data.message, uid });
        return;
      }

      // { 'kit-0': {...}, 'lunch-1': {...} } - the same keys the table uses.
      const held = {};
      (data.claims || []).forEach((c) => {
        held[`${c.kind}-${Number(c.day_number) || 0}`] = c;
      });

      /* What this person has ALREADY taken at this counter, said out loud.
         The whole failure this counter exists to prevent is a second lunch,
         and the queue moves faster than anybody reads a checklist. So the
         second tap of the same card is answered the way the door answers one
         - a name, and "already claimed" next to it. */
      let already = '';
      if (data.result === 'matched') {
        if (isKit) {
          const kit = held['kit-0'];
          if (kit) {
            already = kit.claimed_at
              ? `Kit already claimed — ${formatStampLine(kit.claimed_at)}`
              : 'Kit already claimed';
          }
        } else {
          // Named, not counted: "two meals taken" does not tell the person
          // holding the tray whether THIS meal is one of them.
          const taken = [];
          desk.dayNumbers.forEach((day) => {
            ['lunch', 'dinner'].forEach((meal) => {
              if (held[`${meal}-${day}`]) taken.push(`Day ${day} ${meal}`);
            });
          });
          if (taken.length > 0) already = `Already taken: ${taken.join(', ')}`;
        }
      }

      /* Which days they turned up for. Nothing is collected by somebody who
         has not arrived - the server refuses it either way, but a locked
         checklist that says why beats a tick that comes back as an error.

           a meal  needs them here THAT day: Day 2 lunch is not owed to
                   somebody who only came on Day 1
           the kit needs them here at all, on whichever day they arrive */
      const attendedDays = new Set((data.days || []).map((d) => Number(d.day_number)));
      let blocked = '';
      if (data.result === 'matched') {
        if (isKit && attendedDays.size === 0) {
          blocked = 'Not checked in yet — check them in at the door first.';
        } else if (!isKit && !attendedDays.has(Number(desk.checkinDay))) {
          blocked = `Not checked in for Day ${desk.checkinDay} yet — check them in first.`;
        }
      }

      setWho({
        result: data.result,
        message: data.message,
        uid: data.uid,
        registration: data.registration || null,
        claims: held,
        days: [...attendedDays],
        already,
        blocked,
      });

      // The kit already handed over comes back ticked, so a second visit
      // shows what was given rather than an empty list to fill in again.
      if (data.result === 'matched') {
        const kit = held['kit-0'];
        setTicked(Array.isArray(kit?.items) ? kit.items : []);
        if (blocked) {
          showToast(`${data.registration.attendee_name} — ${blocked}`, 'warning');
        } else if (already) {
          showToast(
            isKit
              ? `${data.registration.attendee_name} — kit already claimed`
              : `${data.registration.attendee_name} — ${already.toLowerCase()}`,
            'warning',
          );
        }
      }
    } catch (err) {
      setWho({ result: 'error', message: err.message, uid });
    } finally {
      setLookupBusy(false);
    }
  }, [eventId, who, deskKind, isKit, desk.checkinDay, desk.dayNumbers, showToast]);

  // The parent routes every tap; it needs this counter's handler to do it.
  useEffect(() => { onReady?.(lookup); }, [onReady, lookup]);

  /* ---- A meal, ticked as it is served ----
     Written as it is ticked - unlike the kit, a meal is one thing and there is
     nothing to check it against, so there is no Save to forget to press. */
  const toggleMeal = useCallback(async (meal, day) => {
    const reg = who?.registration;
    if (!eventId || !reg || desk.claimBusy) return;
    const key = `${meal}-${day}`;
    const already = !!who.claims?.[key];

    try {
      await desk.toggleClaim(reg, meal, day, !already);
      // Both the desk's own copy and the table behind it, so closing the
      // dialog does not show stale ticks.
      setWho((prev) => {
        if (!prev) return prev;
        const claims = { ...(prev.claims || {}) };
        if (!already) claims[key] = { claimed_at: new Date().toISOString() };
        else delete claims[key];
        return { ...prev, claims };
      });
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }, [eventId, who, desk, showToast]);

  /* ---- The kit, committed in one go ----
     The person at the counter is checking a bag against a list, and each item
     is provisional until the whole bag is right. */
  const commitKit = useCallback(async () => {
    const reg = who?.registration;
    if (!eventId || !reg) return;
    try {
      const res = await fetch('/api/events/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId, registrationId: reg.id, kind: 'kit', dayNumber: 0,
          claimed: true, items: ticked, actorId: desk.actorId || null,
        }),
      });
      const data = await res.json();
      if (!data.success) { showToast(data.message, 'danger'); return; }

      const claim = data.claim || { claimed_at: new Date().toISOString(), items: ticked };
      desk.setClaims((prev) => ({
        ...prev,
        [reg.id]: { ...(prev[reg.id] || {}), 'kit-0': claim },
      }));
      showToast(`Kit marked claimed for ${reg.attendee_name}`, 'success');

      /* The person STAYS on screen, now reading as claimed. Clearing them here
         is what it used to do, and it meant the only proof the kit had been
         recorded was a toast that had already gone. Next person is what moves
         the queue on, and it only unlocks once this is written - so the person
         at the counter sees the record they just made before they lose the
         name it belongs to. */
      setWho((prev) => (prev ? {
        ...prev,
        claims: { ...(prev.claims || {}), 'kit-0': claim },
        already: claim.claimed_at ? `Kit claimed — ${formatStampLine(claim.claimed_at)}` : 'Kit claimed',
      } : prev));
      setTicked(Array.isArray(claim.items) ? claim.items : ticked);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }, [eventId, who, ticked, desk, showToast]);

  /* Why Next person will not move yet. */
  const gate = (() => {
    const ok = claimDeskRecorded(deskKind, who, desk.checkinDay);
    if (ok) return { ok: true, why: 'Clear this card and wait for the next one' };
    return isKit
      ? { ok: false, why: 'Mark the kit claimed first — nothing is recorded for this person yet.' }
      : { ok: false, why: `Tick the meal being served before moving on — nothing is recorded for Day ${Number(desk.checkinDay) || 1} yet.` };
  })();

  const ready = who?.result === 'matched' && !who.blocked;
  const merch = desk.merchItems;

  return (
    <div className="evt-modal-overlay" onClick={onClose}>
      <div className="evt-modal evt-claim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="evt-modal-head">
          <div>
            <h3>
              <i className={`fas ${isKit ? 'fa-box-open' : 'fa-utensils'}`}></i>
              {isKit ? ' Event Kit Counter' : ' Meals Counter'}
            </h3>
            <p>{event?.title || 'Event'}</p>
          </div>
          <button type="button" className="evt-modal-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="evt-modal-body">
          <ReaderStatusStrip reader={reader} boxFocused={false} />
          {reader.error && (
            <p className="evt-rfid-hint bad">
              <i className="fas fa-triangle-exclamation"></i>
              {reader.error}
            </p>
          )}
          {/* Which day a meal belongs to. The kit has one day - the day they
              arrive - so the picker is only for meals. */}
          {!isKit && (
            <DayPicker
              days={desk.days}
              value={desk.checkinDay}
              onChange={desk.setCheckinDay}
              label="Serving"
            />
          )}

          {/* ---- Who is standing here ---- */}
          <div className={`evt-claim-who ${
            who?.result === 'matched'
              ? (who.blocked ? 'blocked' : who.already ? 'already' : 'ok')
              : who ? 'bad' : ''}`}>
            {lookupBusy ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                <div><b>Reading the card…</b></div>
              </>
            ) : !who ? (
              <>
                <i className="fas fa-id-card"></i>
                <div>
                  <b>Tap a card</b>
                  <em>
                    The list below stays locked until a card is read, so what is
                    ticked is always recorded against the person holding it.
                  </em>
                </div>
              </>
            ) : who.result === 'matched' ? (
              <>
                <div className="rfid-avatar">{personInitials(who.registration.attendee_name)}</div>
                <div>
                  <b>{formatPersonName(who.registration.attendee_name)}</b>
                  {/* The refusal comes first. Somebody who has not arrived
                      collects nothing, and that is the only thing worth
                      saying about them here. */}
                  {who.blocked ? (
                    <strong className="evt-claim-blocked">
                      <i className="fas fa-user-clock"></i> {who.blocked}
                    </strong>
                  ) : who.already ? (
                    <strong className="evt-claim-already">
                      <i className="fas fa-clock-rotate-left"></i> {who.already}
                    </strong>
                  ) : null}
                  <em>
                    {who.registration.church_name
                      ? formatChurchName(who.registration.church_name)
                      : who.registration.attendee_mobile || 'Attendee'}
                    {' · verified'}
                  </em>
                </div>
                {/* Locked until this person's visit is recorded. A queue moves
                    faster than anybody's memory, and this is the only thing
                    standing between "next" and a kit nobody can account for. */}
                <button
                  type="button"
                  className="btn-small btn-secondary"
                  disabled={!gate.ok}
                  title={gate.why}
                  onClick={() => { setWho(null); setTicked([]); }}
                >
                  Next person
                </button>
              </>
            ) : (
              <>
                <i className="fas fa-circle-exclamation"></i>
                <div>
                  <b>{who.message || 'That card could not be used'}</b>
                  {/* Not verified is a different problem from an unknown card,
                      and only one of them is fixed at this counter. */}
                  <em>
                    {who.result === 'not_verified'
                      ? 'Verify their registration first — nothing is owed until the payment is settled.'
                      : who.result === 'unknown'
                        ? 'Give them a card on the Events RFID screen first.'
                        : 'Try the card again.'}
                  </em>
                </div>
                <button type="button" className="btn-small btn-secondary" onClick={() => setWho(null)}>
                  Try again
                </button>
              </>
            )}
          </div>

          {/* Why Next person will not move yet. A disabled button with nothing
              beside it reads as a broken one. */}
          {who?.result === 'matched' && !who.blocked && !gate.ok && (
            <p className="evt-rfid-hint">
              <i className="fas fa-circle-info"></i>
              {gate.why}
            </p>
          )}

          {/* Typing a number in, for a card whose reader is not to hand and
              for testing before the queue arrives. */}
          {!who && (
            <div className="rfid-manual">
              <input
                className="form-control"
                autoComplete="new-password"
                data-lpignore="true"
                data-form-type="other"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="…or type a card number"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isPlausibleUid(manual)) { lookup(manual); setManual(''); }
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!isPlausibleUid(manual) || lookupBusy}
                onClick={() => { lookup(manual); setManual(''); }}
              >
                Look up
              </button>
            </div>
          )}

          {/* ---- The kit checklist ---- */}
          {isKit && (merch.length === 0 ? (
            <p className="evt-rfid-hint">
              <i className="fas fa-circle-info"></i>
              This event has no merch list, so the kit is one thing. Add items under
              Events &rarr; Merch if it should be itemised; the button below still
              records the kit as handed over.
            </p>
          ) : (
            <div className={`evt-claim-list ${ready ? '' : 'locked'}`}>
              <div className="evt-claim-list-head">
                <b>What was handed over</b>
                {ready ? (
                  <button
                    type="button"
                    className="evt-claim-all"
                    onClick={() => setTicked(
                      ticked.length === merch.length ? [] : merch.map((m) => m.name),
                    )}
                  >
                    {ticked.length === merch.length ? 'Clear all' : 'Tick all'}
                  </button>
                ) : (
                  <em>
                    <i className="fas fa-lock"></i>
                    {who?.blocked ? ' not checked in' : ' waiting for a card'}
                  </em>
                )}
              </div>
              {merch.map((m) => {
                const on = ticked.includes(m.name);
                return (
                  <label key={m.name} className={`evt-claim-item ${on ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!ready}
                      onChange={(e) => setTicked((prev) => (e.target.checked
                        ? [...prev, m.name]
                        : prev.filter((n) => n !== m.name)))}
                    />
                    {m.image_url && <img src={m.image_url} alt="" />}
                    <span>{m.name}</span>
                  </label>
                );
              })}
              {ready && who.claims?.['kit-0'] && (
                <p className="evt-claim-note">
                  <i className="fas fa-triangle-exclamation"></i>
                  This kit is already on their record. Pressing Mark kit claimed again
                  <b> replaces</b> the list above &mdash; untick anything they did not get.
                </p>
              )}
            </div>
          ))}

          {/* ---- The meal grid ---- */}
          {!isKit && (
            <div className={`evt-claim-list ${ready ? '' : 'locked'}`}>
              <div className="evt-claim-list-head">
                <b>Meals</b>
                {!ready && (
                  <em>
                    <i className="fas fa-lock"></i>
                    {who?.blocked ? ' not checked in' : ' waiting for a card'}
                  </em>
                )}
              </div>
              {desk.dayNumbers.map((day) => (
                <div className="evt-claim-mealrow" key={day}>
                  <span className="evt-meal-daylabel">Day {day}</span>
                  {['lunch', 'dinner'].map((meal) => {
                    const key = `${meal}-${day}`;
                    const on = ready && !!who.claims?.[key];
                    const busy = ready && desk.claimBusy === `${who.registration.id}:${key}`;
                    return (
                      <button
                        type="button"
                        key={meal}
                        className={`evt-meal-chip big ${on ? 'yes' : ''}`}
                        disabled={!ready || !!desk.claimBusy}
                        onClick={() => toggleMeal(meal, day)}
                        title={on ? 'Taken — click to take back' : `Click when ${meal} is served`}
                      >
                        <i className={`fas ${busy ? 'fa-spinner fa-spin' : on ? 'fa-square-check' : 'fa-square'}`}></i>
                        {meal === 'lunch' ? 'Lunch' : 'Dinner'}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="evt-modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {/* The kit is one decision at the end. Meals have no such button -
              each is written as it is ticked, above. */}
          {isKit && (
            <button
              type="button"
              className="btn-primary"
              disabled={!ready || !!desk.claimBusy || (merch.length > 0 && ticked.length === 0)}
              onClick={commitKit}
            >
              <i className="fas fa-box-open"></i>
              {who?.already ? ' Update kit claim' : ' Mark kit claimed'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
