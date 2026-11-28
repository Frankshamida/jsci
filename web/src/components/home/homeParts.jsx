'use client';

// The parts a Church Member's and a Ministry Member's Home are built from.
// They draw with the Admin Home's styles (admin/adminOverview.css: the .ao
// tokens, cards, attention tiles and key figures) plus roleHome.css, so every
// role's Home looks like one product.

import { useEffect, useState } from 'react';
import '@/components/admin/adminOverview.css';
import './roleHome.css';

export const TZ = 'Asia/Manila';
const INTRO_MS = 2200;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// 'YYYY-MM-DD' -> words. Dates are the church's own, so read them as UTC.
export const day = (ymd, opts) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
export const monthShort = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
export const monthLong = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const churchToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** "Today", "Tomorrow" or "Sun, Dec 6". */
export function whenWord(today, ymd) {
  const n = daysBetween(today, ymd);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return day(ymd, { weekday: 'short', month: 'short', day: 'numeric' });
}
/** "in 8 days" / "today" / "tomorrow". */
export function inDays(today, ymd) {
  const n = daysBetween(today, ymd);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}
/** "7:00 PM" from "19:00" or "19:00:00". */
export function clock(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** True for the first moments after the numbers arrive: things draw in once. */
export function useIntro(ready) {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [ready]);
  return intro;
}

// ---- Header ----

export function Head({ name, line, pills = [] }) {
  return (
    <header className="ao-top">
      <div>
        <h2 className="ao-title">Dashboard</h2>
        <p className="ao-greet">
          {greeting()}{name ? `, ${name}` : ''}
          {line && <><span className="ao-dot" aria-hidden="true">·</span>{line}</>}
          <span className="ao-dot" aria-hidden="true">·</span>
          {new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>
      {pills.length > 0 && (
        <div className="rh-pills">
          {pills.map((p) => <span key={p.label} className="rh-pill"><i className={`fas ${p.icon}`} aria-hidden="true"></i>{p.label}</span>)}
        </div>
      )}
    </header>
  );
}

export function Loading({ name, line, error, onRetry }) {
  return (
    <div className="ao rh" aria-busy={!error}>
      <Head name={name} line={line} />
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

// ---- Shortcuts: the pages this role uses most, one tap away ----

export function Shortcuts({ items }) {
  if (!items.length) return null;
  return (
    <nav className="rh-go" aria-label="Shortcuts" style={{ '--rh-go': items.length }}>
      {items.map((s) => (
        <button key={s.key} type="button" onClick={s.onClick}>
          <i className={`fas ${s.icon}`} aria-hidden="true"></i>
          <b>{s.label}</b>
          {s.hint && <small>{s.hint}</small>}
        </button>
      ))}
    </nav>
  );
}

// ---- Needs your attention ----
// items: { key, n, text, small, icon, tone: 'good'|'warn'|'serious'|'', onClick? }

export function Attention({ items }) {
  return (
    <section className="ao-card ao-attn" aria-labelledby="rh-attn">
      <h3 id="rh-attn">Needs your attention</h3>
      <div className="ao-attn-list" style={{ '--rh-n': items.length }}>
        {items.map((a) => {
          const clear = a.n === 0;
          const Tag = a.onClick ? 'button' : 'div';
          return (
            <Tag key={a.key} {...(a.onClick ? { type: 'button', onClick: a.onClick } : {})} className={`ao-att${clear ? ' is-clear' : ''}`}>
              <i className={`fas ${clear ? 'fa-circle-check' : a.icon} ao-att-icon ao-tone-${clear ? 'good' : a.tone || ''}`} aria-hidden="true"></i>
              <b>{a.n}</b>
              <span>{a.text}<small>{a.small}</small></span>
              {a.onClick && <i className="fas fa-chevron-right ao-att-go" aria-hidden="true"></i>}
            </Tag>
          );
        })}
      </div>
    </section>
  );
}

// ---- Key figures ----

function Spark({ values }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const y = (v) => 27 - ((v - min) / span) * 24;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="rh-spark" aria-hidden="true">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points={pts} vectorEffect="non-scaling-stroke" /></svg>
      <span style={{ top: `${(8 + y(values[values.length - 1])).toFixed(1)}px` }}></span>
    </div>
  );
}

// items: { key, label, value, detail, spark?: number[], onClick? }
export function Kpis({ items }) {
  return (
    <section className="ao-kpis" aria-label="Key figures" style={{ '--rh-k': items.length }}>
      {items.map((k) => {
        const Tag = k.onClick ? 'button' : 'div';
        return (
          <Tag key={k.key} {...(k.onClick ? { type: 'button', onClick: k.onClick } : {})} className="ao-card ao-kpi">
            <span className="ao-kpi-label">{k.label}</span>
            <span className="ao-kpi-value">{k.value}</span>
            <span className="ao-kpi-detail">{k.detail}</span>
            {k.spark && k.spark.length > 1 && k.spark.some((v) => v !== k.spark[0]) && <Spark values={k.spark} />}
          </Tag>
        );
      })}
    </section>
  );
}

// ---- Cards ----

/**
 * A chart card. `span` is its width out of 12; `tall` lets it run beside two
 * cards; `more` is a link in its corner: { label, onClick }.
 */
export function Card({ span = 6, tall = false, title, sub, more, children, id }) {
  return (
    <section className={`ao-card ao-chart ao-c${span}${tall ? ' rh-rs2' : ''}`} aria-labelledby={id}>
      <div className="ao-chart-head">
        <div>
          <h3 id={id}>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {more && (
          <button type="button" className="ao-link" onClick={more.onClick} style={{ marginTop: 0 }}>
            {more.label} <i className="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Lay cards out in rows of two that fill the width: a card left alone takes
 * the whole row. rows: [[cardA, cardB?], ...] where a card is { span, node }.
 * A card's node is a function of its final span.
 */
export function Grid({ rows }) {
  const out = [];
  rows.filter((r) => r && r.some(Boolean)).forEach((r, i) => {
    const cards = r.filter(Boolean);
    if (cards.length === 1) out.push(<Slot key={`${i}-0`} node={cards[0].node(12)} />);
    else cards.forEach((c, j) => out.push(<Slot key={`${i}-${j}`} node={c.node(c.span)} />));
  });
  return <div className="ao-charts">{out}</div>;
}
const Slot = ({ node }) => node;

export const Chip = ({ tone = 'soft', children }) => <span className={`rh-chip ${tone}`}>{children}</span>;

export function Empty({ icon = 'fa-circle-info', title, children }) {
  return (
    <div className="rh-empty">
      <i className={`fas ${icon}`} aria-hidden="true"></i>
      <span>{title && <b>{title}</b>}{children}</span>
    </div>
  );
}

// rows: { key, name, value, pct, me? }
export function Rows({ rows }) {
  return (
    <div className="ao-rows">
      {rows.map((r) => (
        <div key={r.key} className="ao-row">
          <span className="ao-row-name">{r.me ? <span className="rh-me">You</span> : r.name}</span>
          <div className="ao-mtrack"><i style={{ width: `${Math.max(2, Math.min(100, r.pct))}%` }}></i></div>
          <span className="ao-row-val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// cols: { key, label, value }; the last one is "now", in gold.
export function Cols({ cols, fmt = (v) => v }) {
  const max = Math.max(1, ...cols.map((c) => c.value));
  return (
    <div className="rh-cols" role="img" aria-label={cols.map((c) => `${c.label}: ${fmt(c.value)}`).join(', ')}>
      {cols.map((c, i) => {
        const h = (c.value / max) * 82;
        return (
          <div key={c.key} className={`rh-col${i === cols.length - 1 ? ' is-now' : ''}`}>
            <div className="rh-col-bar">
              <i style={{ height: `${h}%`, animationDelay: `${i * 50}ms` }}></i>
              <b style={{ bottom: `${h}%` }}>{fmt(c.value)}</b>
            </div>
            <span>{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// items: { key, icon, title, sub, end }
export function List({ items }) {
  return (
    <div className="rh-list">
      {items.map((x) => (
        <div key={x.key} className="rh-li">
          <span className="rh-li-ic" aria-hidden="true"><i className={`fas ${x.icon}`}></i></span>
          <span><b>{x.title}</b>{x.sub && <small>{x.sub}</small>}</span>
          <span className="rh-li-end">{x.end}</span>
        </div>
      ))}
    </div>
  );
}

export function Verse({ verse }) {
  if (!verse?.verse || !verse.reference || verse.reference === 'Loading...') return null;
  return (
    <figure className="ao-card ao-chart rh-verse" style={{ margin: 0 }}>
      <blockquote>&ldquo;{verse.verse}&rdquo;</blockquote>
      <figcaption>{verse.reference}</figcaption>
    </figure>
  );
}
