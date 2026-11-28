'use client';

// The Admin and Super Admin Home: what is waiting on the office first, then
// the church's numbers as charts. Everything comes from one request to
// /api/admin/overview, refreshed while Home is open (useSmartPoll stops it in
// a hidden or idle tab). A Super Admin also sees the System card.
//
// The charts draw themselves in when the page opens or the period changes:
// columns rise, the donut sweeps round, bars grow from the left, the figures
// count up. A background refresh never replays it, and reduced motion turns
// it off (adminOverview.css).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSmartPoll, POLL_MS } from '@/lib/pollingConfig';
import { peso } from '@/lib/giving';
import './adminOverview.css';

const TZ = 'Asia/Manila';
const RANGES = [3, 6, 12];
const RANGE_KEY = 'sh-admin-home-range';
const ANIM_MS = 2200;

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const monthLabel = (ym, long = false) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}) });
const at = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...opts });
const pesoK = (n) => {
  if (n >= 1e6) return `₱${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1000) return `₱${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K`;
  return `₱${Math.round(n)}`;
};
const count = (n) => Math.round(n).toLocaleString('en-US');
// Joyful Cares names a ministry by its role: "Singer" -> "Singers", "Media" -> "Media team".
const teamName = (title) => (title === 'Media' ? 'Media team' : /s$/.test(title) ? title : `${title}s`);

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ymd(new Date(iso)) === ymd(y)) return 'Yesterday';
  return at(iso, { month: 'short', day: 'numeric' });
}

function eventWhen(e) {
  const start = at(e.at, { month: 'short', day: 'numeric' });
  if (!e.endsAt) return start;
  const sameDay = at(e.at, { dateStyle: 'short' }) === at(e.endsAt, { dateStyle: 'short' });
  if (sameDay) return start;
  const sameMonth = at(e.at, { month: 'short' }) === at(e.endsAt, { month: 'short' });
  return `${start}–${sameMonth ? at(e.endsAt, { day: 'numeric' }) : at(e.endsAt, { month: 'short', day: 'numeric' })}`;
}

const motionOk = () => typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---- Small parts ----

// The size of a box, kept up to date, for charts drawn to fit it.
function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// One hover label for the whole page, drawn in the body so no scrolling box
// clips it. Filled with text nodes only.
function useTip() {
  const ref = useRef(null);
  const [host, setHost] = useState(null);
  useEffect(() => { setHost(document.body); }, []);
  useEffect(() => {
    const hide = () => { if (ref.current) ref.current.hidden = true; };
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', hide, { capture: true });
  }, []);
  const api = useRef({
    show(e, { value, label, rows }) {
      const tip = ref.current;
      if (!tip) return;
      tip.replaceChildren();
      const b = document.createElement('b');
      b.textContent = value;
      tip.append(b);
      if (label) tip.append(document.createTextNode(label));
      (rows || []).forEach((r) => {
        const line = document.createElement('div');
        line.className = 'ao-tip-row';
        const name = document.createElement('span');
        const key = document.createElement('i');
        key.style.background = r.color;
        name.append(key, document.createTextNode(r.name));
        const v = document.createElement('span');
        v.textContent = r.value;
        line.append(name, v);
        tip.append(line);
      });
      tip.hidden = false;
      api.current.move(e);
    },
    move(e) {
      const tip = ref.current;
      if (!tip || tip.hidden) return;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      const y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 16;
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${y}px`;
    },
    hide() { if (ref.current) ref.current.hidden = true; },
  });
  const node = host ? createPortal(<div className="ao-tip" ref={ref} hidden role="presentation"></div>, host) : null;
  return [api.current, node];
}

// A figure that counts up from zero the first time it shows.
function CountUp({ value, format = count }) {
  const [shown, setShown] = useState(() => (motionOk() ? 0 : value));
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || !motionOk()) { setShown(value); return undefined; }
    first.current = false;
    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(t >= 1 ? value : value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}

// A round step (1, 2 or 5 x 10^n) giving at most four steps above zero.
function niceStep(max) {
  const raw = Math.max(max, 1) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * Math.max(p, 1);
}
const topRound = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};
// Spread the start of n marks over at most `span` ms.
const delay = (i, n, span = 650) => `${Math.round((i / Math.max(1, n - 1)) * Math.min(span, n * 45))}ms`;

// Columns, one series or stacked. Hover a column's whole band for its numbers.
function Columns({ items, series, fmt = count, tick = count, label, tip, minHeight = 230 }) {
  const [ref, { w: W, h: H }] = useSize();
  let svg = null;
  if (W > 0 && H > 0 && items.length) {
    const m = { l: 42, r: 6, t: 22, b: 24 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const totals = items.map((it) => sum(it.values));
    const top = Math.max(...totals, 1) * 1.08;
    const step = niceStep(top);
    const max = step * Math.max(1, Math.ceil(top / step));
    const band = iw / items.length;
    const bw = Math.max(3, Math.min(24, band * 0.62));
    const every = Math.ceil(items.length / Math.max(2, Math.floor(iw / 50)));
    const ticks = [];
    for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
    const lastIdx = items.length - 1;
    svg = (
      <svg role="img" aria-label={label} width={W} height={H}>
        {ticks.map((v) => {
          const y = m.t + ih - (v / max) * ih;
          return (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} className={v ? 'ao-grid' : 'ao-axis'} />
              <text x={m.l - 6} y={y + 4} textAnchor="end">{tick(v)}</text>
            </g>
          );
        })}
        {items.map((it, i) => {
          const x = m.l + band * i + (band - bw) / 2;
          let y = m.t + ih;
          const segs = it.values.map((v, k) => ({ v, k })).filter((p) => p.v > 0);
          const shapes = segs.map((p, j) => {
            const h = (p.v / max) * ih;
            const gap = j ? 2 : 0;
            const height = Math.max(h - gap, 0.5);
            const fill = `var(--ao-${series[p.k].c})`;
            const out = j === segs.length - 1
              ? <path key={p.k} d={topRound(x, y - h, bw, height, 4)} fill={fill} />
              : <rect key={p.k} x={x} y={y - h} width={bw} height={height} fill={fill} />;
            y -= h;
            return out;
          });
          // Axis labels counted back from the newest, so the last one always shows.
          const showLabel = (lastIdx - i) % every === 0;
          const half = String(it.label).length * 3.4;
          const lx = Math.max(m.l + half, Math.min(x + bw / 2, W - 2 - half));
          const value = fmt(totals[i]);
          const halfV = String(value).length * 3.6;
          const vx = Math.min(x + bw / 2, W - 2 - halfV);
          // Above the tallest column the label spans, so it never sits on one.
          const under = i === lastIdx ? Math.max(totals[i], ...totals.filter((_, k) => Math.abs(m.l + band * k + band / 2 - vx) <= halfV + band / 2)) : 0;
          const vy = m.t + ih - (under / max) * ih - 7;
          return (
            <g key={it.key || i}>
              {shapes.length > 0 && <g className="ao-col" style={{ animationDelay: delay(i, items.length) }}>{shapes}</g>}
              {showLabel && <text x={lx} y={H - 6} textAnchor="middle">{it.label}</text>}
              {i === lastIdx && totals[i] > 0 && <text className="ao-v ao-fade" x={vx} y={vy} textAnchor="middle">{value}</text>}
              <rect className="ao-hit" x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
                onPointerMove={(e) => tip.show(e, {
                  value: it.empty || fmt(totals[i]),
                  label: it.full || it.label,
                  rows: series.length > 1 ? series.map((s, k) => ({ color: `var(--ao-${s.c})`, name: s.name, value: fmt(it.values[k]) })) : null,
                })}
                onPointerLeave={tip.hide} />
            </g>
          );
        })}
      </svg>
    );
  }
  return <div className="ao-fig" ref={ref} style={{ minHeight }}>{svg}</div>;
}

// Accounts by role: the ring sweeps round once when drawn.
function Donut({ parts, total, label, tip }) {
  const [ref, { w: W, h: H }] = useSize();
  const maskId = `aom${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  let svg = null;
  if (W > 0 && H > 0) {
    const R = Math.min(W, H) / 2 - 4;
    const r = R * 0.62;
    const cx = W / 2;
    const cy = H / 2;
    const gap = parts.filter((p) => p.count > 0).length > 1 ? 0.025 : 0;
    const pt = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    let a0 = -Math.PI / 2;
    const slices = parts.map((p) => {
      if (!p.count || !total) return null;
      const a1 = a0 + (p.count / total) * Math.PI * 2;
      const s0 = a0 + gap / 2;
      const s1 = Math.max(s0 + 0.001, a1 - gap / 2);
      a0 = a1;
      const share = `${Math.round((p.count / total) * 100)}%`;
      const show = (e) => tip.show(e, { value: count(p.count), label: `${p.label} · ${share}` });
      // A whole ring is two halves: one arc cannot start and end at one point.
      if (s1 - s0 >= Math.PI * 2 - 0.002) {
        return (
          <g key={p.key} className="ao-slice" onPointerMove={show} onPointerLeave={tip.hide}>
            <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" strokeWidth={R - r} stroke={`var(--ao-${p.c})`} />
          </g>
        );
      }
      const large = s1 - s0 > Math.PI ? 1 : 0;
      return (
        <path key={p.key} className="ao-slice" fill={`var(--ao-${p.c})`}
          d={`M${pt(R, s0)}A${R},${R} 0 ${large} 1 ${pt(R, s1)}L${pt(r, s1)}A${r},${r} 0 ${large} 0 ${pt(r, s0)}Z`}
          onPointerMove={show} onPointerLeave={tip.hide} />
      );
    });
    svg = (
      <svg role="img" aria-label={label} width={W} height={H}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
            <circle className="ao-sweep" cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke="#fff" strokeWidth={R - r + 6}
              pathLength="100" strokeDasharray="100 100" transform={`rotate(-90 ${cx} ${cy})`} />
          </mask>
        </defs>
        {!total && <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" strokeWidth={R - r} className="ao-ring-empty" />}
        <g mask={`url(#${maskId})`}>{slices}</g>
        <text className="ao-v ao-donut-n" x={cx} y={cy + 6} textAnchor="middle"><CountUp value={total} /></text>
        <text x={cx} y={cy + 26} textAnchor="middle">accounts</text>
      </svg>
    );
  }
  return <div className="ao-fig ao-donut-fig" ref={ref}>{svg}</div>;
}

function Sparkline({ values }) {
  const [ref, { w: W, h: H }] = useSize();
  let svg = null;
  if (W > 0 && H > 0 && values.length > 1) {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * (W - 10), H - 5 - ((v - min) / (max - min || 1)) * (H - 10)]);
    const last = pts[pts.length - 1];
    svg = (
      <svg aria-hidden="true" width={W} height={H}>
        <polyline className="ao-spark-line" points={pts.map((p) => p.join(',')).join(' ')} pathLength="100" />
        <circle className="ao-spark-dot" cx={last[0]} cy={last[1]} r="4" />
      </svg>
    );
  }
  return <div className="ao-spark" ref={ref}>{svg}</div>;
}

function DataTable({ head, rows }) {
  return (
    <div className="ao-scroll">
      <table className="ao-table">
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j ? <td key={j}>{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="ao-legend">
      {items.map(([name, c]) => <span key={name}><i style={{ background: `var(--ao-${c})` }}></i>{name}</span>)}
    </div>
  );
}

function ChartCard({ id, span, title, sub, tables, setTables, table, children }) {
  const asTable = !!tables[id];
  return (
    <section className={`ao-card ao-chart ao-${span}`} aria-labelledby={`ao-${id}`}>
      <header className="ao-chart-head">
        <div>
          <h3 id={`ao-${id}`}>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {table && (
          <button type="button" className="ao-tbtn" aria-pressed={asTable}
            onClick={() => setTables((t) => ({ ...t, [id]: !t[id] }))}>
            <i className={`fas ${asTable ? 'fa-chart-column' : 'fa-table'}`} aria-hidden="true"></i>{asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {asTable && table ? table() : children}
    </section>
  );
}

const Unread = () => <p className="ao-empty"><i className="fas fa-circle-exclamation" aria-hidden="true"></i>This could not be read just now. It will try again shortly.</p>;

// ---- What each card shows ----

const PAY = [
  { key: 'paid', name: 'Paid', c: 'good' },
  { key: 'check', name: 'Proof to check', c: 'warn' },
  { key: 'cash', name: 'Cash to collect', c: 'serious' },
  { key: 'turnover', name: 'Not turned over', c: 'crit' },
  { key: 'unpaid', name: 'Not paid yet', c: 'none' },
];
const ROLE_COLORS = { guests: 's1', ministry: 's2', pastors: 's3', staff: 's4' };

function attentionItems(a) {
  const n = (v) => (v == null ? null : v);
  const p = a.payments;
  const paymentsN = p ? p.check + p.cash + p.turnover : null;
  const paymentBits = p ? [
    p.cash && `${p.cash} cash to collect`,
    p.turnover && `${p.turnover} not turned over`,
    p.check && plural(p.check, 'proof to check', 'proofs to check'),
  ].filter(Boolean).join(' · ') : '';
  return [
    {
      key: 'accounts', n: n(a.accounts), go: 'user-management', icon: 'fa-user-clock', tone: 'warn',
      label: (v) => (v === 1 ? 'account to verify' : 'accounts to verify'),
      sub: (v) => (v ? 'Waiting since they signed up' : 'Everyone is verified'),
    },
    {
      key: 'payments', n: paymentsN, go: 'events-management', icon: 'fa-money-bill-wave', tone: 'serious',
      label: (v) => (v === 1 ? 'event payment to check' : 'event payments to check'),
      sub: (v) => (v ? paymentBits : 'Every payment is in'),
    },
    {
      key: 'gifts', n: n(a.gifts), go: 'giving-management', icon: 'fa-hand-holding-heart', tone: 'warn',
      label: (v) => (v === 1 ? 'gift to confirm' : 'gifts to confirm'),
      sub: (v) => (v ? 'Sent in, waiting for you' : 'Nothing waiting'),
    },
    {
      key: 'isom', n: n(a.isom), go: 'isom-inquiries', icon: 'fa-user-graduate', tone: 'warn',
      label: (v) => (v === 1 ? 'new ISOM inquiry' : 'new ISOM inquiries'),
      sub: (v) => (v ? 'Not contacted yet' : 'Everyone has been contacted'),
    },
  ];
}

// ---- The loader ----

export default function AdminOverview({ userId, firstname, isSuper, active, go, canOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState(null);
  // Each visit to Home draws the charts in afresh (the view starts over).
  const [visit, setVisit] = useState(0);
  useEffect(() => { if (active) setVisit((v) => v + 1); }, [active]);

  const load = useCallback(async () => {
    try {
      const [res, usage] = await Promise.all([
        fetch(`/api/admin/overview?actorId=${encodeURIComponent(userId)}`, { cache: 'no-store' }),
        isSuper ? fetch('/api/cloudinary/usage').then((r) => r.json()).catch(() => null) : null,
      ]);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || 'Your dashboard could not be loaded.');
      setData(json);
      if (usage?.success) setStorage(usage.data);
      setError('');
    } catch (e) {
      setError(e.message || 'Your dashboard could not be loaded.');
      throw e;
    }
  }, [userId, isSuper]);

  useSmartPoll(load, POLL_MS.adminOverview, { enabled: !!active && !!userId });

  return (
    <AdminOverviewView key={visit} data={data} storage={storage} error={error} onRetry={() => load().catch(() => {})}
      firstname={firstname} isSuper={isSuper} go={go} canOpen={canOpen} />
  );
}

// ---- What it draws, from the route's answer (null while loading) ----

export function AdminOverviewView({ data, storage, error, onRetry, firstname, isSuper, go, canOpen }) {
  const [range, setRange] = useState(3);
  const [tables, setTables] = useState({});
  const [anim, setAnim] = useState(true); // the charts draw in
  const [intro, setIntro] = useState(true); // the first load only: attention and figures too
  const [tip, tipNode] = useTip();
  const ready = !!data;

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(RANGE_KEY));
      if (RANGES.includes(saved)) setRange(saved);
    } catch { /* private window: the default it is */ }
  }, []);

  // Draw-in once the numbers arrive, and again on a new period.
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => { setAnim(false); setIntro(false); }, ANIM_MS);
    return () => clearTimeout(t);
  }, [ready, range]);

  const pickRange = (n) => {
    if (n === range) return;
    setAnim(true);
    setRange(n);
    tip.hide();
    try { window.localStorage.setItem(RANGE_KEY, String(n)); } catch { /* not kept */ }
  };

  const open = (section) => (canOpen?.(section) ? () => go(section) : null);
  const name = data?.firstname || firstname || '';
  const roleName = (data?.isSuper ?? isSuper) ? 'Super Admin' : 'Admin';
  const head = (
    <header className="ao-top">
      <div>
        <h2 className="ao-title">Dashboard</h2>
        <p className="ao-greet">
          {greeting()}{name ? `, ${name}` : ''}
          <span className="ao-dot" aria-hidden="true">·</span>
          {data ? day(data.today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : roleName}
        </p>
      </div>
      <div className="ao-seg" role="group" aria-label="Period for the charts">
        {RANGES.map((n) => (
          <button key={n} type="button" aria-pressed={range === n} onClick={() => pickRange(n)}>{n} months</button>
        ))}
      </div>
    </header>
  );

  if (!data) {
    return (
      <div className="ao" aria-busy={!error}>
        {head}
        {error ? (
          <div className="ao-card ao-error" role="alert">
            <i className="fas fa-cloud-arrow-down" aria-hidden="true"></i>
            <div><b>Your dashboard did not load</b><p>{error}</p></div>
            <button type="button" className="ao-retry" onClick={onRetry}>Try again</button>
          </div>
        ) : (
          <div className="ao-skeleton" aria-label="Loading your dashboard">
            <div className="ao-sk ao-sk-attn"></div>
            <div className="ao-sk-row">{[0, 1, 2, 3].map((i) => <div key={i} className="ao-sk ao-sk-kpi"></div>)}</div>
            <div className="ao-sk-row"><div className="ao-sk ao-sk-chart"></div><div className="ao-sk ao-sk-chart ao-sk-narrow"></div></div>
          </div>
        )}
      </div>
    );
  }

  const { members, attendance, ministries, events, registrations, giving, system } = data;
  const per = `${range} months`;

  // Sundays and months in the period.
  const weeksAll = attendance?.weeks || [];
  const weeks = weeksAll.slice(-Math.round(range * 4.33));
  const recorded = weeks.filter((w) => w.count > 0);
  const avg = recorded.length ? Math.round(sum(recorded.map((w) => w.count)) / recorded.length) : 0;
  const givingIn = (giving || []).slice(-range);
  const givingTotal = sum(givingIn.map((g) => g.tithes + g.donations));
  const signupsIn = (members?.signups || []).slice(-range);

  // The four figures.
  const recordedAll = weeksAll.filter((w) => w.count > 0);
  const lastWeek = recordedAll[recordedAll.length - 1];
  const prevWeek = recordedAll[recordedAll.length - 2];
  const gNow = giving ? giving[giving.length - 1].tithes + giving[giving.length - 1].donations : 0;
  const gPrev = giving ? giving[giving.length - 2].tithes + giving[giving.length - 2].donations : 0;
  const gChange = gPrev ? Math.round(((gNow - gPrev) / gPrev) * 100) : null;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
  const kpis = [
    {
      key: 'members', label: 'Verified members', go: 'user-management', ok: !!members,
      value: members?.verified ?? 0,
      detail: members && (members.newThisMonth
        ? <><b className="ao-up">+{members.newThisMonth}</b> new {members.newThisMonth === 1 ? 'account' : 'accounts'} this month</>
        : <>No new accounts this month</>),
      spark: (members?.totals || []).map((t) => t.count),
    },
    {
      key: 'sunday', label: lastWeek ? `Last Sunday · ${day(lastWeek.date, { month: 'short', day: 'numeric' })}` : 'Last Sunday', go: 'attendance-management', ok: !!attendance,
      value: lastWeek?.count ?? 0,
      detail: lastWeek ? (prevWeek
        ? <><b className={lastWeek.count >= prevWeek.count ? 'ao-up' : 'ao-down'}>{signed(lastWeek.count - prevWeek.count)}</b> vs the Sunday before{avg ? ` · avg ${avg}` : ''}</>
        : <>The first Sunday on record</>) : <>No check-ins recorded yet</>,
      spark: weeksAll.slice(-12).map((w) => w.count),
    },
    {
      key: 'events', label: 'Event registrations', go: 'events-management', ok: !!events,
      value: events?.total ?? 0,
      detail: events && (events.upcomingCount
        ? <>{plural(events.upcomingCount, 'upcoming event')} · {count(events.paid)} paid</>
        : <>No upcoming events</>),
      spark: (registrations || []).map((r) => r.count),
    },
    {
      key: 'giving', label: 'Giving this month', go: 'giving-management', ok: !!giving, money: true,
      value: gNow,
      detail: giving && (gChange == null
        ? <>{gPrev ? '' : 'Nothing confirmed last month'}</>
        : <><b className={gChange >= 0 ? 'ao-up' : 'ao-down'}>{gChange >= 0 ? '+' : '−'}{Math.abs(gChange)}%</b> vs last month</>),
      spark: (giving || []).map((g) => g.tithes + g.donations),
    },
  ];

  // Accounts by role.
  const roleParts = (members?.byRole || []).map((r) => ({ ...r, c: ROLE_COLORS[r.key] || 'none' }));
  const total = members?.total || 0;

  // Payments by event.
  const upcoming = events?.upcoming || [];
  const owedShown = sum(upcoming.map((e) => e.check + e.cash + e.turnover));
  const payUsed = PAY.filter((p) => upcoming.some((e) => e[p.key] > 0));
  const maxTotal = Math.max(1, ...upcoming.map((e) => e.total));

  // Ministries.
  const rated = (ministries || []).filter((m) => m.rate != null);
  const best = rated.slice().sort((a, b) => b.rate - a.rate)[0];

  // System (Super Admin).
  const usedPct = storage?.credits?.limit ? Math.min(100, Math.round(storage.credits.usedPercent || (storage.credits.usage / storage.credits.limit) * 100)) : null;
  const sysTitle = usedPct == null ? 'System' : usedPct >= 90 ? 'Storage is almost full' : usedPct >= 75 ? 'Storage is filling up' : 'System is healthy';
  const week7 = system?.days || [];

  return (
    <div className={`ao${intro ? ' ao-intro' : ''}`}>
      {head}

      <section className="ao-card ao-attn" aria-labelledby="ao-attn">
        <h3 id="ao-attn">Needs your attention</h3>
        <div className="ao-attn-list">
          {attentionItems(data.attention).map((a) => {
            const onClick = open(a.go);
            const v = a.n;
            const clear = v === 0;
            const Tag = onClick ? 'button' : 'div';
            return (
              <Tag key={a.key} {...(onClick ? { type: 'button', onClick } : {})} className={`ao-att${clear ? ' is-clear' : ''}`}>
                <i className={`fas ${clear ? 'fa-circle-check' : a.icon} ao-att-icon ao-tone-${clear ? 'good' : a.tone}`} aria-hidden="true"></i>
                <b>{v == null ? '—' : <CountUp value={v} />}</b>
                <span>
                  {a.label(v ?? 2)}
                  <small>{v == null ? 'Could not be read just now' : a.sub(v)}</small>
                </span>
                {onClick && <i className="fas fa-chevron-right ao-att-go" aria-hidden="true"></i>}
              </Tag>
            );
          })}
        </div>
      </section>

      <section className="ao-kpis" aria-label="Key figures">
        {kpis.map((k) => {
          const onClick = open(k.go);
          const Tag = onClick ? 'button' : 'div';
          return (
            <Tag key={k.key} {...(onClick ? { type: 'button', onClick } : {})} className="ao-card ao-kpi">
              <span className="ao-kpi-label">{k.label}</span>
              <span className="ao-kpi-value">{k.ok ? <CountUp value={k.value} format={k.money ? (n) => peso(Math.round(n)) : count} /> : '—'}</span>
              <span className="ao-kpi-detail">{k.ok ? k.detail : 'Could not be read just now'}</span>
              {k.ok && k.spark.length > 1 && <Sparkline values={k.spark} />}
            </Tag>
          );
        })}
      </section>

      <div className={`ao-charts${anim ? ' ao-anim' : ''}`} key={range}>
        <ChartCard id="attendance" span="c8" tables={tables} setTables={setTables}
          title={recorded.length ? `Sunday attendance averaged ${avg} over the last ${per}` : `No Sunday check-ins in the last ${per}`}
          sub="People checked in each Sunday (present or late)"
          table={attendance && (() => <DataTable head={['Sunday', 'Checked in']} rows={weeks.slice().reverse().map((w) => [day(w.date, { month: 'short', day: 'numeric', year: 'numeric' }), w.count ? count(w.count) : 'None recorded'])} />)}>
          {attendance ? (
            <Columns tip={tip} label="Sunday attendance" series={[{ name: 'Checked in', c: 'gold' }]}
              items={weeks.map((w) => ({ key: w.date, label: day(w.date, { month: 'short', day: 'numeric' }), full: `Sunday, ${day(w.date, { month: 'long', day: 'numeric' })}`, values: [w.count], empty: w.count ? null : 'None recorded' }))}
              fmt={(v) => `${count(v)} checked in`} />
          ) : <Unread />}
        </ChartCard>

        <ChartCard id="roles" span="c4" tables={tables} setTables={setTables}
          title={members ? `${count(total)} accounts: ${count(members.verified)} verified, ${count(members.waiting)} waiting` : 'Accounts'}
          sub="Accounts by role"
          table={members && (() => <DataTable head={['Role', 'Accounts', 'Share']} rows={roleParts.map((r) => [r.label, count(r.count), total ? `${Math.round((r.count / total) * 100)}%` : '0%'])} />)}>
          {members ? (
            <div className="ao-donut">
              <Donut parts={roleParts} total={total} tip={tip} label={`Accounts by role: ${roleParts.map((r) => `${r.label} ${r.count}`).join(', ')}`} />
              <div className="ao-dleg">
                {roleParts.map((r) => (
                  <div key={r.key}>
                    <i style={{ background: `var(--ao-${r.c})` }}></i>
                    <span>{r.label}</span>
                    <b>{count(r.count)}</b>
                    <em>{total ? Math.round((r.count / total) * 100) : 0}%</em>
                  </div>
                ))}
              </div>
              <div>
                <div className="ao-muted">Verified accounts</div>
                <div className="ao-split ao-grow" role="img" aria-label={`${members.verified} verified, ${members.waiting} waiting`}>
                  {members.verified > 0 && <i style={{ flex: members.verified, background: 'var(--ao-good)' }}></i>}
                  {members.waiting > 0 && <i style={{ flex: members.waiting, background: 'var(--ao-warn)' }}></i>}
                </div>
                <div className="ao-muted ao-split-note">{count(members.verified)} verified · {count(members.waiting)} waiting</div>
              </div>
            </div>
          ) : <Unread />}
        </ChartCard>

        <ChartCard id="payments" span="c7" tables={tables} setTables={setTables}
          title={!events ? 'Event registrations' : !upcoming.length ? 'No upcoming events take registrations' : owedShown ? `${plural(owedShown, 'event payment')} still to collect or check` : 'Every upcoming event payment is in'}
          sub="Registrations for upcoming events, by payment"
          table={upcoming.length ? () => <DataTable head={['Event', ...PAY.map((p) => p.name), 'Total']} rows={upcoming.map((e) => [`${e.title} (${eventWhen(e)})`, ...PAY.map((p) => count(e[p.key])), count(e.total)])} /> : null}>
          {!events ? <Unread /> : !upcoming.length ? (
            <p className="ao-empty"><i className="fas fa-calendar" aria-hidden="true"></i>When an event opens registration, its payments show here.</p>
          ) : (
            <>
              <Legend items={payUsed.map((p) => [p.name, p.c])} />
              <div className="ao-rows">
                {upcoming.map((e, i) => (
                  <div key={e.id} className="ao-row">
                    <div className="ao-row-name">{e.title}<small>{eventWhen(e)}</small></div>
                    <div className="ao-track ao-grow" style={{ width: `${Math.max(e.total ? 4 : 0, (e.total / maxTotal) * 100)}%`, animationDelay: delay(i, upcoming.length, 300) }}>
                      {PAY.filter((p) => e[p.key] > 0).map((p) => (
                        <i key={p.key} style={{ flex: e[p.key], background: `var(--ao-${p.c})` }}
                          onPointerMove={(ev) => tip.show(ev, { value: count(e[p.key]), label: `${p.name} · ${e.title}` })}
                          onPointerLeave={tip.hide}></i>
                      ))}
                    </div>
                    <div className="ao-row-val">{count(e.total)}<small>{e.total ? `${count(e.paid + e.turnover)} paid` : 'None yet'}</small></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard id="giving" span="c5" tables={tables} setTables={setTables}
          title={giving ? `${peso(givingTotal)} given in the last ${per}` : 'Giving'}
          sub="Confirmed gifts by month"
          table={giving && (() => <DataTable head={['Month', 'Tithes & offerings', 'Donations', 'Total']} rows={givingIn.slice().reverse().map((g) => [monthLabel(g.month, true), peso(g.tithes), peso(g.donations), peso(g.tithes + g.donations)])} />)}>
          {giving ? (
            <>
              <Legend items={[['Tithes & offerings', 's1'], ['Donations', 's2']]} />
              <Columns tip={tip} label="Giving by month" fmt={peso} tick={pesoK}
                series={[{ name: 'Tithes & offerings', c: 's1' }, { name: 'Donations', c: 's2' }]}
                items={givingIn.map((g) => ({ key: g.month, label: monthLabel(g.month), full: monthLabel(g.month, true), values: [g.tithes, g.donations] }))} />
            </>
          ) : <Unread />}
        </ChartCard>

        <ChartCard id="signups" span="c6" tables={tables} setTables={setTables}
          title={members ? `${plural(sum(signupsIn.map((s) => s.count)), 'new account')} in the last ${per}` : 'New accounts'}
          sub="Accounts made each month"
          table={members && (() => <DataTable head={['Month', 'New accounts']} rows={signupsIn.slice().reverse().map((s) => [monthLabel(s.month, true), count(s.count)])} />)}>
          {members ? (
            <Columns tip={tip} label="New accounts per month" series={[{ name: 'New accounts', c: 'gold' }]} minHeight={210}
              items={signupsIn.map((s) => ({ key: s.month, label: monthLabel(s.month), full: monthLabel(s.month, true), values: [s.count] }))}
              fmt={(v) => plural(Math.round(v), 'new account')} tick={count} />
          ) : <Unread />}
        </ChartCard>

        <ChartCard id="ministries" span="c6" tables={tables} setTables={setTables}
          title={best ? `${teamName(best.title)} ${best.title === 'Media' ? 'has' : 'have'} the best attendance, at ${best.rate}%` : 'Ministry attendance'}
          sub="Ministry members present, last 8 Sundays"
          table={ministries && ministries.length ? () => <DataTable head={['Ministry', 'Members', 'Attendance']} rows={ministries.map((m) => [teamName(m.title), count(m.members), m.rate == null ? 'No Sundays yet' : `${m.rate}%`])} /> : null}>
          {!ministries ? <Unread /> : !ministries.length ? (
            <p className="ao-empty"><i className="fas fa-people-group" aria-hidden="true"></i>No ministry has members yet.</p>
          ) : (
            <div className="ao-rows">
              {ministries.map((m, i) => (
                <div key={m.key} className="ao-row">
                  <div className="ao-row-name">{teamName(m.title)}<small>{plural(m.members, 'member')}</small></div>
                  <div className="ao-mtrack">
                    {m.rate != null && m.rate > 0 && (
                      <i className="ao-grow" style={{ width: `${m.rate}%`, animationDelay: delay(i, ministries.length, 300) }}
                        onPointerMove={(ev) => tip.show(ev, { value: `${m.rate}%`, label: `present · ${teamName(m.title)}${m.prev != null ? ` (${m.prev}% the 8 Sundays before)` : ''}` })}
                        onPointerLeave={tip.hide}></i>
                    )}
                  </div>
                  <div className="ao-row-val">{m.rate == null ? '—' : `${m.rate}%`}</div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {isSuper && (
          <ChartCard id="system" span="c12" tables={tables} setTables={setTables}
            title={sysTitle} sub="Storage, the activity log and the latest changes (Super Admin only)"
            table={system && (() => <DataTable head={['Day', 'Logged changes']} rows={week7.slice().reverse().map((d) => [day(d.date, { weekday: 'long', month: 'short', day: 'numeric' }), count(d.count)])} />)}>
            <div className="ao-sys">
              <div>
                <div className="ao-muted">Storage (Cloudinary credits this month)</div>
                {usedPct == null ? <p className="ao-muted ao-sys-na">Not available just now</p> : (
                  <>
                    <div className="ao-big">{(Math.round(storage.credits.usage * 10) / 10).toLocaleString('en-US')} <span className="ao-muted">of {count(storage.credits.limit)}</span></div>
                    <div className="ao-meter" role="img" aria-label={`${usedPct}% used`}>
                      <i className="ao-grow" style={{ width: `${usedPct}%`, background: usedPct >= 90 ? 'var(--ao-crit)' : usedPct >= 75 ? 'var(--ao-serious)' : 'var(--ao-s1)' }}></i>
                    </div>
                    <div className="ao-muted">{usedPct}% used</div>
                  </>
                )}
                {open('cloudinary-usage') && <button type="button" className="ao-link" onClick={open('cloudinary-usage')}>Storage details<i className="fas fa-arrow-right" aria-hidden="true"></i></button>}
              </div>
              <div>
                {system ? (
                  <>
                    <div className="ao-muted">Activity log, last 7 days: <b className="ao-ink">{count(sum(week7.map((d) => d.count)))}</b> changes ({count(system.total)} in all)</div>
                    <Columns tip={tip} label="Logged changes, last 7 days" series={[{ name: 'Changes', c: 's1' }]} minHeight={130}
                      items={week7.map((d) => ({ key: d.date, label: day(d.date, { weekday: 'short' }), full: day(d.date, { weekday: 'long', month: 'short', day: 'numeric' }), values: [d.count] }))}
                      fmt={(v) => plural(Math.round(v), 'change')} tick={count} />
                  </>
                ) : <Unread />}
              </div>
              <div>
                <div className="ao-muted ao-log-head">Latest changes</div>
                {system?.latest?.length ? (
                  <ul className="ao-log">
                    {system.latest.map((l) => (
                      <li key={l.id}><span><b>{l.who}</b> {l.what}</span><span>{ago(l.at)}</span></li>
                    ))}
                  </ul>
                ) : <p className="ao-muted">{system ? 'Nothing logged yet.' : ''}</p>}
                {open('audit-logs') && <button type="button" className="ao-link" onClick={open('audit-logs')}>Open the activity log<i className="fas fa-arrow-right" aria-hidden="true"></i></button>}
              </div>
            </div>
          </ChartCard>
        )}
      </div>
      {tipNode}
    </div>
  );
}
