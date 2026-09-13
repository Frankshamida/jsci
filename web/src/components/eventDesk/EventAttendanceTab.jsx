'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isPlausibleUid, formatUid } from '@/lib/rfid';
import { formatPersonName, statusLabel, formatStampLine } from '@/lib/eventFormat';
import useRfidReader from './useRfidReader';
import useEventDesk from './useEventDesk';
import ReaderStatusStrip from './ReaderStatusStrip';
import DayPicker from './DayPicker';
import ClaimCounter from './ClaimCounter';

/* ============================================================
   The Attendance tab of an event, whole.

   One component for the Admin dashboard and the Event Committee dashboard.
   It was written twice before this - the admin had the RFID door, the per-day
   columns and the counters; the committee had a single Mark Attended button -
   and the two were never going to converge by being maintained separately.

   What it needs from the page it sits in:

     event         the event row being managed (with event_days, merch_items)
     regs          every registration for that event
     loading       whether those are still arriving
     onRegsChange  a setState for `regs`, so a tap can tick the row it just
                   changed without waiting for a reload
     actorId       who is at the desk, recorded against every change
     showToast     the host page's toast
     askConfirm    the host page's confirm dialog
     Pager         the host page's TablePager, passed in rather than imported
                   so neither page's existing one has to move

   Everything else - which readers exist, who came on which day, what anybody
   has collected - this owns.
   ============================================================ */

export default function EventAttendanceTab({
  event,
  regs = [],
  loading = false,
  onRegsChange = null,
  actorId = null,
  showToast = () => {},
  askConfirm = null,
  Pager = null,
  // Anything the host page wants in the toolbar beside the counters - the
  // committee desk keeps its QR scanner button here, because a door that had
  // RFID added to it should not have lost the reader it already used.
  extraActions = null,
  // Shown under the table. The committee's QR log lives here.
  footer = null,
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Which counter is open: null | 'kit' | 'meals'.
  const [claimDesk, setClaimDesk] = useState(null);

  const scanBoxRef = useRef(null);

  /* Only the settled registrations. A card gets somebody through a door, so
     an unverified one has nothing to check in - it is on the Registrations
     tab, where it can be verified. */
  const confirmedAll = useMemo(
    () => regs.filter((r) => r.status === 'registered' || r.status === 'payment_verified'),
    [regs],
  );
  const confirmed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return confirmedAll;
    return confirmedAll.filter((r) => `${r.attendee_name || ''} ${r.church_name || ''} ${r.attendee_mobile || ''} ${r.attendee_email || ''}`
      .toLowerCase().includes(q));
  }, [confirmedAll, search]);

  /* The desk needs the reader's writer to put the name on the board's LCD,
     and the reader needs the desk to know what a tap means. One of the two
     has to be built first, so the link is made through a ref rather than by
     either owning the other - the function handed to the desk is stable, and
     it finds the current writer when it is actually called. */
  const sendToReaderRef = useRef(null);
  const sendToReader = useCallback((prefix, text) => {
    sendToReaderRef.current?.(prefix, text);
  }, []);

  const desk = useEventDesk({ event, actorId, showToast, onRegsChange, sendToReader });

  /* ---- Where a tap goes ----
     Whichever desk is open takes every tap, wherever it came from. Without
     this the reader would still be feeding the screen underneath, which is
     not the one the person is looking at. */
  // The counter registers its own lookup here when it opens - a tap at a
  // counter resolves a card without checking anybody in, which is a different
  // thing entirely from a tap at the door.
  const claimTapRef = useRef(null);

  const routeTap = useCallback((uid, source) => {
    if (desk.unlockOpen) { desk.tryUnlock(uid); return; }
    if (claimDesk) { claimTapRef.current?.(uid); return; }
    if (desk.scanOpen) desk.checkIn(uid, source);
  }, [desk, claimDesk]);

  // The reader is wanted while any of the three desks is open, and let go the
  // moment they all close - a port left open stays locked to this tab.
  const readerActive = desk.scanOpen || desk.unlockOpen || !!claimDesk;
  const reader = useRfidReader({ active: readerActive, onTap: routeTap });

  useEffect(() => { sendToReaderRef.current = reader.sendToReader; }, [reader.sendToReader]);

  const days = desk.days;
  const many = days.length > 1;

  const pageSafe = Math.min(page, Math.max(1, Math.ceil(confirmed.length / pageSize)));
  const shown = confirmed.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  return (
    <>
      {/* Search on the left, the counters on the right. Each counter is a card
          tapped and a name appearing - the table below is the record, not the
          way things are normally done to it. */}
      <div className="evt-attbar">
        <div className="evt-search evt-attbar-search">
          <i className="fas fa-magnifying-glass"></i>
          <input
            type="search"
            autoComplete="new-password"
            data-lpignore="true"
            data-form-type="other"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search attendees, church, contact"
            aria-label="Search attendees"
          />
        </div>
        <div className="evt-attbar-actions">
          {extraActions}
          <button
            className="btn-primary"
            onClick={() => { desk.setScanResult(null); desk.setScanInput(''); desk.setScanOpen(true); }}
          >
            <i className="fas fa-id-card"></i> Scan RFID to Check In
          </button>
          <button className="btn-primary" onClick={() => setClaimDesk('kit')}>
            <i className="fas fa-box-open"></i> Event Kit Counter
          </button>
          <button className="btn-primary" onClick={() => setClaimDesk('meals')}>
            <i className="fas fa-utensils"></i> Meals Counter
          </button>
          {/* Last, and on its own: this is the one button that changes what
              the other columns DO. Locking needs no card - only unlocking. */}
          <button
            type="button"
            className={`evt-lockbtn ${desk.unlocked ? 'open' : ''}`}
            title={desk.unlocked
              ? 'Columns are unlocked — click to lock them again'
              : 'Unlock the columns for corrections (master card required)'}
            aria-label={desk.unlocked ? 'Lock the columns' : 'Unlock the columns'}
            onClick={() => {
              if (desk.unlocked) { desk.setUnlocked(false); showToast('Columns locked', 'info'); return; }
              desk.setUnlockError('');
              desk.setUnlockManual('');
              desk.setUnlockOpen(true);
            }}
          >
            <i className={`fas ${desk.unlocked ? 'fa-lock-open' : 'fa-circle-exclamation'}`}></i>
            {desk.unlocked ? 'Unlocked' : 'Corrections'}
          </button>
        </div>
      </div>

      {/* Said plainly while it lasts, because an unlocked table looks exactly
          like a locked one until something is clicked by accident. */}
      {desk.unlocked && (
        <p className="evt-unlock-note">
          <i className="fas fa-triangle-exclamation"></i>
          <span>
            <b>Corrections are on.</b> Clicking a day, the kit or a meal changes it
            straight away — including taking one back. Lock it again when you are done.
          </span>
          <button
            type="button"
            className="btn-small btn-secondary"
            onClick={() => { desk.setUnlocked(false); showToast('Columns locked', 'info'); }}
          >
            <i className="fas fa-lock"></i> Lock
          </button>
        </p>
      )}

      <div className="evt-table-wrapper evt-table-steady">
        <table className="evt-table">
          <thead>
            <tr>
              {/* No Contact column here on purpose: at a door the question is
                  who they are and whether they are cleared to come in, and an
                  email address in the middle of that pushes the columns that
                  answer it off the screen. Contact is still searchable in the
                  box above. */}
              <th>Attendee</th><th>Status</th>
              <th className="evt-th-center">Attendance</th>
              <th className="evt-th-center">Event Kit</th>
              {/* One column, however many days the event runs. Two days of two
                  meals is four boxes, and four columns of "Day 1 Lunch"
                  headings would push the names off the screen. */}
              <th className="evt-th-center">Meals</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Loading…</td></tr>
            ) : confirmed.length === 0 ? (
              <tr><td colSpan={6}>
                {search.trim()
                  ? `No attendee matches “${search.trim()}”.`
                  : 'No confirmed registrations yet.'}
              </td></tr>
            ) : shown.map((r) => (
              <tr key={r.id}>
                <td className="evt-cell-name evt-td-primary" data-label="Attendee">
                  {formatPersonName(r.attendee_name)}
                </td>
                {/* "Paid" is the right word beside a peso figure on the
                    Registrations tab. Here the column is about somebody
                    standing at a door, and what matters is that they are
                    cleared to come in. */}
                <td className="evt-nowrap" data-label="Status">
                  <span className={`evt-status evt-status-${r.status}`}>
                    {r.status === 'payment_verified' || r.status === 'registered'
                      ? 'Verified Attendee'
                      : statusLabel(r.status)}
                  </span>
                </td>

                {/* ---- Came, per day ----
                    An event over two or three days cannot answer "did they
                    come" with one word: the person who came on Day 1 and went
                    home reads identically to the one who came to all three.
                    So one line per day, and a day that has not started yet is
                    greyed - it is not a no-show, it simply has not happened.

                    Each line is a button, so any day can be corrected by hand;
                    a day still ahead is disabled, because nobody attended
                    tomorrow. */}
                <td className="evt-td-center" data-label="Attendance">
                  <div className="evt-attend-days">
                    {days.map((d) => {
                      const day = desk.dayAttend[r.id]?.[String(d.number)];
                      const busy = desk.dayBusy === `${r.id}:${d.number}`;
                      const state = day ? 'in' : d.started ? 'out' : 'ahead';
                      return (
                        <button
                          type="button"
                          key={d.number}
                          className={`evt-attend-day ${state} ${desk.unlocked ? 'live' : ''}`}
                          disabled={!desk.unlocked || state === 'ahead' || !!desk.dayBusy}
                          onClick={() => desk.toggleDay(r, d.number, !day)}
                          title={!desk.unlocked
                            ? (day
                              ? `${d.label} — attended ${formatStampLine(day.attended_at)}`
                              : state === 'ahead'
                                ? `${d.label} has not started yet${d.when ? ` (${d.when})` : ''}`
                                : `${d.label} — not yet. Unlock corrections to change it.`)
                            : day
                              ? `${d.label} — attended ${formatStampLine(day.attended_at)}. Click to undo.`
                              : state === 'ahead'
                                ? `${d.label} has not started yet${d.when ? ` (${d.when})` : ''}`
                                : `${d.label} — click to mark attended`}
                        >
                          <i className={`fas ${busy ? 'fa-spinner fa-spin'
                            : day ? 'fa-circle-check' : 'fa-circle'}`}></i>
                          <b>Day {d.number}</b>
                          <span className="evt-attend-day-sep">|</span>
                          <em>{day ? 'Attended' : state === 'ahead' ? 'Upcoming' : 'Not yet'}</em>
                          {day?.attended_at && <time>{formatStampLine(day.attended_at)}</time>}
                        </button>
                      );
                    })}
                  </div>
                </td>

                {/* ---- The kit ----
                    Read here, not changed here. Handing over a bag means
                    checking it against a list with the person's card in hand,
                    which is the Kit Counter above - a checkbox in a table row
                    can be ticked for the wrong person by being one line off. */}
                <td className="evt-td-center" data-label="Event Kit">
                  {(() => {
                    const kit = desk.claims[r.id]?.['kit-0'];
                    const busy = desk.claimBusy === `${r.id}:kit-0`;
                    // Unlocked, the state itself is the control. Locked, it is
                    // a read-out - the kit is handed over at its counter.
                    const Tag = desk.unlocked ? 'button' : 'span';
                    const live = desk.unlocked
                      ? { type: 'button', disabled: !!desk.claimBusy, onClick: () => desk.toggleClaim(r, 'kit', 0, !kit) }
                      : {};
                    if (!kit) {
                      return (
                        <Tag className={`evt-claim-state ${desk.unlocked ? 'live' : ''}`} {...live}>
                          {busy && <i className="fas fa-spinner fa-spin"></i>}
                          Not claimed
                        </Tag>
                      );
                    }
                    const items = Array.isArray(kit.items) ? kit.items : [];
                    return (
                      <div className="evt-claim-done">
                        <Tag className={`evt-claim-state yes ${desk.unlocked ? 'live' : ''}`} {...live}>
                          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-box-open'}`}></i> Claimed
                        </Tag>
                        {kit.claimed_at && (
                          <time className="evt-attend-when">{formatStampLine(kit.claimed_at)}</time>
                        )}
                        {/* Which pieces, when the event has a merch list and
                            not everything was handed over - the shirts running
                            out in one size is normal, and the person who comes
                            back for theirs needs it recorded. */}
                        {desk.merchItems.length > 0 && items.length < desk.merchItems.length && (
                          <span className="evt-claim-partial">
                            {items.length} of {desk.merchItems.length} items
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>

                {/* ---- Meals ----
                      DAY 1  [x] Lunch  [x] Dinner
                      DAY 2  [ ] Lunch  [ ] Dinner
                    One cell for the lot, so the number of days is a property
                    of the event and not of the table. */}
                <td className="evt-td-center" data-label="Meals">
                  <div className="evt-meals">
                    {desk.dayNumbers.map((day) => (
                      <div className="evt-meal-day" key={day}>
                        <span className="evt-meal-daylabel">Day {day}</span>
                        {['lunch', 'dinner'].map((meal) => {
                          const key = `${meal}-${day}`;
                          const has = !!desk.claims[r.id]?.[key];
                          const at = desk.claims[r.id]?.[key]?.claimed_at;
                          const busy = desk.claimBusy === `${r.id}:${key}`;
                          const label = meal === 'lunch' ? 'Lunch' : 'Dinner';
                          const icon = busy ? 'fa-spinner fa-spin' : has ? 'fa-square-check' : 'fa-square';
                          // Locked, this is a tick on a record. Unlocked, it
                          // serves or takes back.
                          if (!desk.unlocked) {
                            return (
                              <span
                                key={meal}
                                className={`evt-meal-chip ${has ? 'yes' : ''}`}
                                title={has
                                  ? `${meal} taken${at ? ` ${formatStampLine(at)}` : ''}`
                                  : `${meal} not taken yet`}
                              >
                                <i className={`fas ${icon}`}></i>{label}
                              </span>
                            );
                          }
                          return (
                            <button
                              type="button"
                              key={meal}
                              className={`evt-meal-chip live ${has ? 'yes' : ''}`}
                              disabled={!!desk.claimBusy}
                              onClick={() => desk.toggleClaim(r, meal, day, !has)}
                              title={has
                                ? `${meal} taken${at ? ` ${formatStampLine(at)}` : ''} — click to take back`
                                : `Click to record ${meal} as taken`}
                            >
                              <i className={`fas ${icon}`}></i>{label}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </td>

                {/* ---- Actions ----
                    Marks the day the desk is currently on - the one chosen in
                    the scan dialog - and says which, because on a three-day
                    event an unlabelled "Mark Attended" is a guess. Any other
                    day is corrected from its own line in the Attendance
                    column. */}
                <td className="evt-nowrap evt-td-actions" data-label="Actions">
                  {(() => {
                    const here = desk.dayAttend[r.id]?.[String(desk.checkinDay)];
                    const suffix = many ? ` Day ${desk.checkinDay}` : '';
                    return here ? (
                      <button
                        className="evt-mini-btn danger"
                        disabled={!!desk.dayBusy}
                        onClick={() => {
                          const run = () => desk.toggleDay(r, desk.checkinDay, false);
                          if (!askConfirm) { run(); return; }
                          askConfirm(
                            `${r.attendee_name} will be marked as not attended for Day ${desk.checkinDay}. You can mark them attended again later.`,
                            run,
                            {
                              title: 'Mark as Not Attended?',
                              subtitle: event?.title || 'Event Attendance',
                              confirmLabel: 'Mark Not Attended',
                              icon: 'fa-user-xmark',
                            },
                          );
                        }}
                      ><i className="fas fa-user-xmark"></i> Undo{suffix}</button>
                    ) : (
                      <button
                        className="evt-mini-btn ok"
                        disabled={!!desk.dayBusy}
                        onClick={() => desk.toggleDay(r, desk.checkinDay, true)}
                      >
                        <i className="fas fa-user-check"></i> Mark{suffix} Attended
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmed.length > 0 && Pager && (
        <Pager
          page={pageSafe} pageSize={pageSize} total={confirmed.length}
          onPage={setPage} onSize={setPageSize} label="attendees"
        />
      )}

      {footer}

      {/* ================= The door ================= */}
      {desk.scanOpen && (
        <div className="evt-modal-overlay" onClick={() => desk.setScanOpen(false)}>
          <div className="evt-modal evt-rfid-modal" onClick={(e) => e.stopPropagation()}>
            <div className="evt-modal-head">
              <div>
                <h3>Scan RFID to Check In</h3>
                <p>{event?.title}</p>
              </div>
              <button type="button" className="evt-modal-close" onClick={() => desk.setScanOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="evt-modal-body">
              <ReaderStatusStrip reader={reader} boxFocused={desk.scanBoxFocused} />
              {/* Which day every tap in this queue counts for. Above the scan
                  pad, because getting it wrong records a whole morning against
                  the wrong session and nobody notices until the reports run.
                  The day map of whoever was just read comes with it, so the
                  days they have already been through show as attended. */}
              <DayPicker
                days={days}
                value={desk.checkinDay}
                onChange={desk.setCheckinDay}
                attendedDays={desk.scanResult?.registration?.id
                  ? desk.dayAttend[desk.scanResult.registration.id]
                  : null}
              />
              {reader.error && (
                <p className="evt-rfid-hint bad">
                  <i className="fas fa-triangle-exclamation"></i>
                  {reader.error}
                </p>
              )}
              {/* The name is the whole point of this dialog and is sized
                  accordingly - it has to be read at arm's length, across a
                  desk, by someone who is also looking at a queue. */}
              {desk.scanResult ? (
                <div className={`evt-rfid-shout ${desk.scanResult.result}`}>
                  <i className={`fas ${
                    desk.scanResult.result === 'checked_in' ? 'fa-circle-check'
                      : desk.scanResult.result === 'already_in' ? 'fa-clock-rotate-left'
                        : 'fa-circle-exclamation'}`}></i>
                  <strong>
                    {desk.scanResult.registration
                      ? formatPersonName(desk.scanResult.registration.attendee_name)
                      : 'Not recognised'}
                  </strong>
                  <span>{desk.scanResult.message}</span>
                  {desk.scanResult.registration?.church_name && (
                    <em>{desk.scanResult.registration.church_name}</em>
                  )}
                  <code>{formatUid(desk.scanResult.uid)}</code>
                </div>
              ) : (
                <div className="evt-rfid-pad">
                  <i className={`fas ${desk.scanBusy ? 'fa-spinner fa-spin' : 'fa-id-card'}`}></i>
                  <h4>{desk.scanBusy ? 'Reading…' : 'Tap a card'}</h4>
                  <p>The attendee&apos;s name appears here and they are checked in.</p>
                </div>
              )}

              <input
                ref={scanBoxRef}
                className="rfid-catch"
                type="text"
                /* Armed for a USB reader on a computer. Not on a phone: there
                   is no wedge to catch, and the caret would only raise the
                   keyboard over the name. */
                autoFocus={!reader.isPhone}
                autoComplete="new-password"
                data-lpignore="true"
                data-form-type="other"
                spellCheck="false"
                value={desk.scanInput}
                placeholder={reader.isPhone ? 'Or type a card number' : 'Waiting for a card…'}
                aria-label="Card number"
                onChange={(e) => desk.setScanInput(e.target.value)}
                onFocus={() => desk.setScanBoxFocused(true)}
                onBlur={() => desk.setScanBoxFocused(false)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = e.currentTarget.value;
                  desk.setScanInput('');
                  if (isPlausibleUid(v)) desk.checkIn(v, 'keyboard');
                }}
              />
            </div>
            <div className="evt-modal-foot">
              <button type="button" className="btn-secondary" onClick={() => desk.setScanOpen(false)}>Done</button>
              {desk.scanResult && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    desk.setScanResult(null);
                    if (!reader.isPhone) setTimeout(() => scanBoxRef.current?.focus(), 50);
                  }}
                >
                  <i className="fas fa-forward"></i> Next attendee
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= The master card ================= */}
      {desk.unlockOpen && (
        <div className="evt-modal-overlay" onClick={() => desk.setUnlockOpen(false)}>
          <div className="evt-modal evt-unlock-modal" onClick={(e) => e.stopPropagation()}>
            <div className="evt-modal-head">
              <div>
                <h3><i className="fas fa-circle-exclamation"></i> Unlock corrections</h3>
                <p>{event?.title || 'Event'}</p>
              </div>
              <button type="button" className="evt-modal-close" onClick={() => desk.setUnlockOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="evt-modal-body">
              <ReaderStatusStrip reader={reader} boxFocused={false} />

              <div className={`evt-claim-who ${desk.unlockError ? 'bad' : ''}`}>
                <i className={`fas ${desk.unlockError ? 'fa-circle-exclamation' : 'fa-key'}`}></i>
                <div>
                  <b>{desk.unlockError ? 'Wrong card' : 'Tap the master card'}</b>
                  <em>
                    {desk.unlockError || 'Only the master card unlocks editing. An attendee’s card will not do it.'}
                  </em>
                </div>
              </div>

              <div className="rfid-manual">
                <input
                  className="form-control"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-form-type="other"
                  value={desk.unlockManual}
                  onChange={(e) => desk.setUnlockManual(e.target.value)}
                  placeholder={'…or type the master card number'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isPlausibleUid(desk.unlockManual)) {
                      desk.tryUnlock(desk.unlockManual);
                      desk.setUnlockManual('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!isPlausibleUid(desk.unlockManual)}
                  onClick={() => { desk.tryUnlock(desk.unlockManual); desk.setUnlockManual(''); }}
                >
                  Unlock
                </button>
              </div>

              <p className="evt-rfid-hint">
                <i className="fas fa-circle-info"></i>
                With the columns unlocked you can mark a day attended or undo it, give the kit
                back, and tick or untick a meal &mdash; by clicking in the table. Every change
                saves straight away. The table locks itself again when this event is closed.
              </p>
            </div>

            <div className="evt-modal-foot">
              <button type="button" className="btn-secondary" onClick={() => desk.setUnlockOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= The kit and meal counters ================= */}
      {claimDesk && (
        <ClaimCounter
          deskKind={claimDesk}
          onClose={() => setClaimDesk(null)}
          event={event}
          desk={desk}
          reader={reader}
          showToast={showToast}
          onReady={(fn) => { claimTapRef.current = fn; }}
        />
      )}
    </>
  );
}
