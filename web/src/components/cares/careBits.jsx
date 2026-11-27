'use client';

// Small pieces Joyful Cares draws in several places.

import { STATUSES } from '@/lib/joyfulCares';

export const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
export const at = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', ...opts });
export const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const manilaDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** "today", "yesterday", "5 days ago", "Nov 2" */
export function ago(today, ymd) {
  if (!ymd) return null;
  const n = daysBetween(ymd, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  return day(ymd, { month: 'short', day: 'numeric' });
}

export function StatusPill({ status, small }) {
  const s = STATUSES[status] || STATUSES.well;
  return (
    <span className={`jc-pill jc-pill-${status} ${small ? 'is-small' : ''}`}>
      <i className={`fas ${s.icon}`} aria-hidden="true"></i>{s.label}
    </span>
  );
}

export function Avatar({ person, size = 44, ring }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return (
    <span className={`jc-avatar ${ring ? `jc-ring-${ring}` : ''}`} style={style} aria-hidden="true">
      {person.picture
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={person.picture} alt="" loading="lazy" />
        : initials(person.name)}
    </span>
  );
}

/** The last 8 recorded Sundays, oldest first: here, excused or not. */
export function SundayDots({ weeks, label = true }) {
  if (!weeks?.length) return <span className="jc-dots-empty">No Sundays recorded yet</span>;
  const here = weeks.filter((w) => w.here).length;
  return (
    <span className="jc-dots" role="img" aria-label={`Checked in on ${here} of the last ${weeks.length} recorded Sundays`}>
      {weeks.map((w) => (
        <span key={w.date} className={`jc-dot ${w.here ? 'is-here' : w.excused ? 'is-excused' : 'is-missed'}`}
          title={`${day(w.date, { month: 'short', day: 'numeric' })}: ${w.here ? 'checked in' : w.excused ? 'excused' : 'no check-in'}`} />
      ))}
      {label && <span className="jc-dots-label">{here}/{weeks.length}</span>}
    </span>
  );
}

/** Attendance as a ring, with the percentage in the middle. */
export function Ring({ value, size = 76 }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <svg className="jc-ring" width={size} height={size} viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={r} className="jc-ring-track" />
      <circle cx="38" cy="38" r={r} className="jc-ring-fill" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" className="jc-ring-text">{value == null ? '—' : `${Math.round(v * 100)}%`}</text>
    </svg>
  );
}

/** The ministry's attendance on each of the last Sundays, as small bars. */
export function Spark({ trend }) {
  const points = (trend || []).filter((t) => t.rate != null);
  if (points.length < 2) return null;
  const w = 120;
  const h = 34;
  const step = w / trend.length;
  return (
    <svg className="jc-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {trend.map((t, i) => {
        const bh = t.rate == null ? 0 : Math.max(2, t.rate * (h - 2));
        return <rect key={t.date} x={i * step + 2} y={h - bh} width={step - 4} height={bh} rx="2" className={i === trend.length - 1 ? 'is-last' : ''} />;
      })}
    </svg>
  );
}

/** "+12 pts" / "-8 pts" against the 8 Sundays before. */
export function Trend({ now, before }) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 100);
  if (d === 0) return <span className="jc-trend is-flat">Same as before</span>;
  return (
    <span className={`jc-trend ${d > 0 ? 'is-up' : 'is-down'}`}>
      <i className={`fas fa-arrow-${d > 0 ? 'up' : 'down'}`} aria-hidden="true"></i>
      {Math.abs(d)} pts<span className="jc-sr"> {d > 0 ? 'up' : 'down'} on the 8 Sundays before</span>
    </span>
  );
}
