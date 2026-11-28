// The church's regular services, and "when is the next one", in church time.
// Shared by the home page (This Week, Plan Your First Visit, Visit Us) and the
// Guest's Home in the dashboard (components/guest/GuestOverview).
//
// The services are held in Cebu, so "Sunday 9:00 AM" means 9:00 in the
// Philippines (UTC+8, no daylight saving) wherever the visitor is reading
// from. The wall clock is worked out in UTC+8 and turned back into an instant.

export const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

// `dow` (0 = Sunday) and the hour are what "Next Gathering" counts down to;
// the rest is what the cards print.
export const SERVICE_TIMES = [
  { icon: 'fa-sun', day: 'Sunday', time: '9:00 AM', name: 'Worship Service', dow: 0, hour: 9, minute: 0 },
  { icon: 'fa-book-bible', day: 'Friday', time: '7:00 PM', name: 'Bible Study', dow: 5, hour: 19, minute: 0 },
  { icon: 'fa-users', day: 'Saturday', time: '2:00 PM', name: 'Youth Fellowship', dow: 6, hour: 14, minute: 0 },
];

/** The next service after `nowMs`: { ...SERVICE_TIMES entry, startMs }, or null. */
export const nextGathering = (nowMs) => {
  const ph = new Date(nowMs + PH_OFFSET_MS);
  let best = null;
  SERVICE_TIMES.forEach((s) => {
    for (let add = 0; add <= 7; add += 1) {
      const wall = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate() + add, s.hour, s.minute));
      if (wall.getUTCDay() !== s.dow) continue;
      const startMs = wall.getTime() - PH_OFFSET_MS;
      if (startMs <= nowMs) continue;
      if (!best || startMs < best.startMs) best = { ...s, startMs };
      break;
    }
  });
  return best;
};

/** "in 2 days, 4 hrs" / "in 3 hrs 20 min" / "in 12 min" */
export const untilLabel = (ms) => {
  const mins = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const min = mins % 60;
  if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}${hrs ? `, ${hrs} hr${hrs > 1 ? 's' : ''}` : ''}`;
  if (hrs > 0) return `in ${hrs} hr${hrs > 1 ? 's' : ''}${min ? ` ${min} min` : ''}`;
  return `in ${min} min`;
};

/** "Sunday, Nov 29", in church time. */
export const phDayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', {
  weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
});
