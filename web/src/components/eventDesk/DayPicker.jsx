'use client';

/* ============================================================
   Which day of the event this desk is working on.

   Chosen, never inferred from the clock: a door open at 8am on Day 2 is
   checking people in for Day 2 whatever a timezone says, and an event running
   past midnight would roll over mid-queue. Shown with the session name the
   admin typed, because "Day 2" and "Evening Rally" are the same thing to the
   system and only one of them is the thing on the poster.

   A single-day event has nothing to choose, so nothing is drawn.

   `attendedDays` is the day map of the person whose card was just read,
   { '1': {...} }. Days they have already been through are greyed and ticked.

   Greyed, NOT disabled. This picker is the desk's setting, not the attendee's:
   it says which day this door is working on. Disabling Day 1 because the
   person at the front of the queue already came on Day 1 would stop the desk
   checking the NEXT person into Day 1, which is most of what a door does. So
   it marks, and stays pressable.
   ============================================================ */

export default function DayPicker({
  days = [],
  value,
  onChange,
  label = 'Checking in for',
  attendedDays = null,
}) {
  if (days.length < 2) return null;

  return (
    <div className="evt-daypick">
      <span className="evt-daypick-label">
        <i className="fas fa-calendar-day"></i> {label}
      </span>
      <div className="evt-daypick-row">
        {days.map((d) => {
          const wasHere = !!attendedDays?.[String(d.number)];
          return (
            <button
              type="button"
              key={d.number}
              className={`evt-daypick-btn ${value === d.number ? 'on' : ''} ${d.started ? '' : 'ahead'} ${wasHere ? 'done' : ''}`}
              onClick={() => onChange(d.number)}
              title={wasHere
                ? `${d.when} — already checked in`
                : (d.started ? d.when : `${d.when} — has not started yet`)}
            >
              <b>Day {d.number}</b>
              <em>{d.label === `Day ${d.number}` ? (d.when || 'No date') : d.label}</em>
              {wasHere ? (
                <span className="evt-daypick-done"><i className="fas fa-check"></i> attended</span>
              ) : (!d.started && <span className="evt-daypick-ahead">upcoming</span>)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
