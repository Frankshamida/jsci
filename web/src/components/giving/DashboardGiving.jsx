'use client';

// Dashboard > Give: Tithes & Offerings, Donations and My giving, each its own
// page in the sidebar (there is no tab strip here). The same giving window as
// the public pages (GiveModal) does the giving; on Tithes & Offerings the fund,
// amount and account are chosen on the page first, so it opens at "Send it".

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GiveButton, GiveModal, loadGivingInfo, loadMethods } from './GiveModal';
import GivingJar from './GivingJar';
import { useJarMeter } from './useJarMeter';
import { useViewer } from '@/lib/viewer';
import { useMyGifts } from '@/lib/givingClient';
import {
  MAX_AMOUNT, MIN_AMOUNT, PRESET_AMOUNTS, TITHE_FUNDS, campaignEnds, giftDate, giftTime, jarProps,
  methodLabel, parseAmount, peso, phYear, receiptPath, verseFor,
} from '@/lib/giving';
import { DeskHead, DriveThumb, Pager, Pill, Strip, pageOf, sized } from './desk';
import './giving.css';
import './dashboardGiving.css';

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const sum = (list) => list.reduce((a, g) => a + (Number(g.amount) || 0), 0);
const GIVER_STATUS = {
  pending: { tone: 'wa', label: 'Waiting' },
  successful: { tone: 'ok', label: 'Confirmed' },
  failed: { tone: 'ba', label: 'Failed' },
  refunded: { tone: 'of', label: 'Refunded' },
};

function MethodMark({ m }) {
  return (
    <span className="gd-logo" style={{ background: m.logo_url ? '#fff' : m.logo_color || '#1e3a8a' }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {m.logo_url ? <img src={m.logo_url} alt="" /> : String(m.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

// ---- Tithes & Offerings: choose here, then the window shows where to send it ----
function Tithes({ onMy }) {
  const verse = verseFor(new Date().toDateString());
  const { viewer, ready } = useViewer();
  const { gifts } = useMyGifts(ready ? viewer : null);
  const [methods, setMethods] = useState(null);
  const [fund, setFund] = useState('Tithes');
  const [amount, setAmount] = useState(1000);
  const [other, setOther] = useState('');
  const [methodId, setMethodId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMethods().then((m) => {
      if (!alive) return;
      setMethods(m);
      setMethodId((id) => id || m[0]?.id || '');
    });
    return () => { alive = false; };
  }, []);

  const value = other ? parseAmount(other) : amount;
  const method = (methods || []).find((m) => m.id === methodId) || null;
  const last = gifts.find((g) => !g.campaign_id && g.fund !== 'Donation');

  const go = () => {
    if (!value || value < MIN_AMOUNT) { setError('Choose or type an amount.'); return; }
    if (value > MAX_AMOUNT) { setError(`For more than ${peso(MAX_AMOUNT)}, please message the church office.`); return; }
    if (!method) { setError('Choose where you are sending it.'); return; }
    setError('');
    setOpen(true);
  };

  return (
    <>
      <DeskHead title="Tithes & Offerings" sub="Your receipt arrives once the treasurer confirms the gift." />
      <div className="gd-give">
        <section className="gd-card gd-form" aria-label="Give tithes or an offering">
          <div className="gd-q">For</div>
          <div className="gd-opts" role="group" aria-label="For">
            {TITHE_FUNDS.map((f) => (
              <button key={f.key} type="button" className="gd-opt" aria-pressed={fund === f.key} onClick={() => setFund(f.key)}>{f.label}</button>
            ))}
          </div>

          <div className="gd-q">Amount</div>
          <div className="gd-opts" role="group" aria-label="Amount">
            {PRESET_AMOUNTS.map((n) => (
              <button key={n} type="button" className="gd-opt" aria-pressed={!other && amount === n} onClick={() => { setAmount(n); setOther(''); setError(''); }}>{peso(n)}</button>
            ))}
            <label className="gd-money">
              <span aria-hidden="true">₱</span>
              <input inputMode="decimal" placeholder="Other amount" aria-label="Other amount, in pesos" value={other}
                onChange={(e) => { setOther(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} />
            </label>
          </div>

          <div className="gd-q">Send through</div>
          {methods === null ? (
            <p className="gd-sub">Loading…</p>
          ) : methods.length === 0 ? (
            <p className="gd-sub">Giving online is not set up yet. Please ask the church office.</p>
          ) : (
            <div className="gd-opts" role="radiogroup" aria-label="Send through">
              {methods.map((m) => (
                <button key={m.id} type="button" role="radio" className="gd-opt" aria-checked={methodId === m.id} onClick={() => { setMethodId(m.id); setError(''); }}>
                  <MethodMark m={m} />{m.name}
                </button>
              ))}
            </div>
          )}

          {error && <p className="gd-error" role="alert">{error}</p>}
          <div className="gd-sum">
            <span>{fund}, <b>{value ? peso(value) : '—'}</b>{method ? `, by ${method.name}` : ''}</span>
            <button type="button" className="gd-btn is-primary" onClick={go} disabled={!methods?.length}>Continue</button>
          </div>
        </section>

        <aside className="gd-card gd-side">
          {verse && <blockquote className="gd-verse">&ldquo;{verse.text}&rdquo;<cite>{verse.ref}</cite></blockquote>}
          <p className="gd-last" style={verse ? undefined : { borderTop: 0, paddingTop: 0 }}>
            {last ? <>Last gift: <b>{peso(last.amount)} {String(last.fund || '').toLowerCase()}</b>, {giftDate(last.given_at)}. </> : 'Your receipts are kept in My giving. '}
            <button type="button" className="gd-link" onClick={onMy}>My giving</button>
          </p>
        </aside>
      </div>
      {open && <GiveModal mode="tithes" preset={{ fund, amount: value, methodId }} onClose={() => setOpen(false)} />}
    </>
  );
}

// What a drive has raised, in words: "₱15,000 of ₱50,000".
const barPercent = (c) => {
  const goal = Number(c.goal_amount) || 0;
  return goal ? Math.min(100, Math.max(Math.round((c.raised / goal) * 100), c.raised > 0 ? 2 : 0)) : null;
};
function Raised({ c }) {
  const goal = Number(c.goal_amount) || 0;
  if (!c.raised) return <>Be the first to give</>;
  return <><b>{peso(c.raised)}</b>{goal ? ` of ${peso(goal)}` : ` from ${plural(c.gifts || 0, 'donation')}`}{goal && c.raised >= goal ? ', goal reached' : ''}</>;
}

// A drive's card: its photo, what it is for, and its gold bar, which fills as
// the card comes into view.
function Drive({ c, onGiven, onStory }) {
  const percent = barPercent(c);
  const meter = useJarMeter(percent ?? 0, { withJar: false });
  const ends = campaignEnds(c);
  return (
    <article className="gd-card gd-drive">
      <div className="gd-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.image_url ? sized(c.image_url, 720, 316) : '/giving-assets/web/jar.webp'} className={c.image_url ? '' : 'is-jar'} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="gd-drive-body">
        <h3>{c.title}</h3>
        {c.summary && <p>{c.summary}</p>}
        {percent != null && (
          <span className="gd-meter" role="img" aria-label={`${percent}% of the goal`} ref={meter.barRef}>
            <span style={meter.fillStyle}></span>
          </span>
        )}
        <div className="gd-mrow"><span><Raised c={c} /></span>{ends && <span>{ends}</span>}</div>
        <div className="gd-drive-acts">
          <GiveButton mode="donation" campaign={c} className="gd-btn is-primary" onGiven={onGiven}>Donate</GiveButton>
          <button type="button" className="gd-btn" onClick={(e) => onStory(c, e.currentTarget)}>Read the story</button>
        </div>
      </div>
    </article>
  );
}

// The drive's story, in a window that fits the screen: its jar, centred in
// its own column, fills with hearts as it opens, and the gold bar with it
// (useJarMeter); beside it the photos and the story.
function DriveStory({ c, onClose, onGiven }) {
  const percent = barPercent(c);
  const meter = useJarMeter(percent ?? 0);
  const closeRef = useRef(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  const [photo, setPhoto] = useState(0);
  const photos = (c.images?.length ? c.images : c.image_url ? [c.image_url] : []).slice(0, 8);

  // Opened once: focus in, Escape closes it (not while the giving window,
  // opened from here, is on top of it), the page behind stays still.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.gv-modal-root')) closeFn.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, []);

  // The window never scrolls: the photo takes the room there is, and a long
  // story is read in place of the photos ("Read the whole story").
  const [reading, setReading] = useState(false);
  const longStory = !!c.story && (c.story.length > 220 || c.story.split('\n').filter((l) => l.trim()).length > 3);
  const storyOnly = !!c.story && photos.length === 0;
  const showStory = reading || storyOnly;

  return createPortal(
    <div className="dg-story-root gv-theme" role="presentation" onClick={onClose}>
      <div className="dg-story" role="dialog" aria-modal="true" aria-labelledby="dg-story-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="gv-x" onClick={onClose} aria-label="Close">×</button>
        <div className="dg-story-jar">
          <GivingJar {...jarProps(c)} animateOnLoad backdrop keepSize label={c.raised ? `The donation jar: ${peso(c.raised)}` : 'The donation jar, empty so far'} onReady={meter.onJarReady} />
        </div>
        <div className="dg-story-body">
          <div className="dg-story-head">
            <span className="gv-eyebrow">Donation drive</span>
            <h3 id="dg-story-title">{c.title}</h3>
            <p className="dg-story-amount"><Raised c={c} /></p>
            {percent != null && (
              <span className="gv-meter dg-story-meter" role="img" aria-label={`${percent}% of the goal`} ref={meter.barRef}>
                <span style={meter.fillStyle}></span>
              </span>
            )}
            {c.summary && <p className="dg-story-sum">{c.summary}</p>}
          </div>

          {showStory ? (
            <div className="dg-story-read" tabIndex={0} aria-label="The story">
              <p className="dg-story-text">{c.story}</p>
            </div>
          ) : (
            <>
              {photos.length > 0 && (
                <div className="dg-story-photos">
                  <div className="dg-story-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="dg-story-photo" src={sized(photos[photo], 1000, 640)} alt="" />
                  </div>
                  {photos.length > 1 && (
                    <div className="dg-story-thumbs" role="group" aria-label="Photos">
                      {photos.map((src, i) => (
                        <button key={src} type="button" className={`dg-thumb ${i === photo ? 'is-on' : ''}`} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1} of ${photos.length}`} aria-pressed={i === photo}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sized(src, 112, 112)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {c.story && <p className={`dg-story-text ${longStory ? 'is-clamped' : ''}`}>{c.story}</p>}
            </>
          )}

          <div className="dg-story-actions">
            <GiveButton mode="donation" campaign={c} className="gv-btn is-primary" onGiven={onGiven}>Donate</GiveButton>
            {longStory && !storyOnly && (
              <button type="button" className="gv-btn" onClick={() => setReading((r) => !r)} aria-pressed={reading}>
                {reading ? 'Show the photos' : 'Read the whole story'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Donations() {
  const [drives, setDrives] = useState(null);
  const [error, setError] = useState('');
  const [story, setStory] = useState(null); // { c, opener }
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/giving', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The donation drives could not be loaded.');
      setDrives(json.campaigns || []);
      setError('');
    } catch (e) { setError(e.message); setDrives((d) => d || []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <DeskHead title="Donations" sub="Give toward what the church is raising for." />
      {drives === null ? (
        <div className="gd-loading"><span className="gv-spinner" aria-label="Loading"></span></div>
      ) : (
        <>
          {error && <p className="gd-error" role="alert">{error} <button type="button" className="gd-link" onClick={load}>Try again</button></p>}
          {drives.length === 0 && !error ? (
            <section className="gd-card gd-empty">
              <GivingJar amount={0} isStatic label="An empty jar" />
              <strong>No donation drive right now</strong>
              When the church starts one, it shows here with its jar.
            </section>
          ) : (
            <div className="gd-grid">
              {drives.map((c) => <Drive key={c.id} c={c} onGiven={load} onStory={(drive, opener) => setStory({ c: drive, opener })} />)}
            </div>
          )}
        </>
      )}
      {story && (
        <DriveStory c={(drives || []).find((d) => d.id === story.c.id) || story.c} onGiven={load}
          onClose={() => { const back = story.opener; setStory(null); back?.focus?.(); }} />
      )}
    </>
  );
}

// ---- My giving: the year's figures, then every gift with its receipt ----
function MyGivingDesk({ onTab }) {
  const { viewer, ready } = useViewer();
  const { gifts, loading, error, reload } = useMyGifts(ready ? viewer : null);
  const [photos, setPhotos] = useState({});
  const thisYear = phYear();
  const [year, setYear] = useState(thisYear);
  const [page, setPage] = useState(1);
  const PER = 10;

  // The open drives' photos, for the For column.
  useEffect(() => {
    let alive = true;
    loadGivingInfo().then((j) => {
      if (alive) setPhotos(Object.fromEntries((j.campaigns || []).map((c) => [c.id, c.image_url || c.images?.[0] || null])));
    });
    return () => { alive = false; };
  }, []);

  const years = useMemo(() => [...new Set([thisYear, ...gifts.map((g) => phYear(g.given_at))])].sort().reverse(), [gifts, thisYear]);
  const list = gifts.filter((g) => phYear(g.given_at) === year);
  const ok = list.filter((g) => g.status === 'successful');
  const waiting = list.filter((g) => g.status === 'pending');
  const toDrives = ok.filter((g) => g.campaign_id);
  useEffect(() => { setPage(1); }, [year]);
  const paged = pageOf(list, page, PER);

  const head = (
    <DeskHead title="My giving">
      <button type="button" className="gd-btn" onClick={() => onTab('tithes')}>Give tithes</button>
      <button type="button" className="gd-btn is-primary" onClick={() => onTab('donations')}>Donate</button>
    </DeskHead>
  );
  if (!ready || (loading && !gifts.length)) return <>{head}<div className="gd-loading"><span className="gv-spinner" aria-label="Loading"></span></div></>;
  if (!viewer) return <>{head}<div className="gd-card gd-empty"><strong>Sign in to see your giving</strong>Your gifts and their receipts are kept in your account.</div></>;

  return (
    <>
      {head}
      <Strip
        label="Your giving"
        stats={[
          { k: `Given in ${year}`, v: peso(sum(ok)), s: `${plural(ok.length, 'gift')} confirmed` },
          { k: 'Waiting to be confirmed', v: peso(sum(waiting)), s: plural(waiting.length, 'gift') },
          { k: 'To donation drives', v: peso(sum(toDrives)), s: plural(toDrives.length, 'gift') },
        ]}
      />
      <section className="gd-card" aria-labelledby="gd-my-title">
        <div className="gd-tools-bar">
          <h3 id="gd-my-title">Your gifts</h3>
          <select className="gd-input" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" style={{ margin: '8px 0' }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {error ? (
          <div className="gd-empty"><strong>Your giving could not be loaded</strong>{error}<div><button type="button" className="gd-btn" onClick={reload}>Try again</button></div></div>
        ) : list.length === 0 ? (
          <div className="gd-empty">
            <strong>No gifts in {year}</strong>
            Gifts you send while signed in, or with this account&apos;s email, show here.
          </div>
        ) : (
          <>
            <table className="gd-table">
              <colgroup><col style={{ width: '20%' }} /><col /><col style={{ width: '18%' }} /><col style={{ width: '104px' }} /><col style={{ width: '120px' }} /><col style={{ width: '84px' }} /></colgroup>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">For</th><th scope="col">Paid through</th><th scope="col" className="gd-r">Amount</th><th scope="col">Status</th><th scope="col"><span className="gd-sr">Receipt</span></th></tr>
              </thead>
              <tbody>
                {paged.rows.map((g) => {
                  const st = GIVER_STATUS[g.status] || GIVER_STATUS.pending;
                  return (
                    <tr key={g.receipt_no || g.token}>
                      <td className="gd-c1"><b>{giftDate(g.given_at)}</b><small>{giftTime(g.given_at)} · {g.receipt_no}</small></td>
                      <td className="gd-c2">
                        {g.campaign_id
                          ? <span className="gd-drv"><DriveThumb src={photos[g.campaign_id]} /><span className="gd-drv-name">{g.campaign_title || 'Donation drive'}</span></span>
                          : g.fund || 'Offering'}
                      </td>
                      <td className="gd-c3">{methodLabel(g)}<small>{g.reference_no || 'No reference'}</small></td>
                      <td className="gd-c4 gd-r gd-amt">{peso(g.amount)}</td>
                      <td className="gd-c5"><Pill tone={st.tone}>{st.label}</Pill></td>
                      <td className="gd-act"><a className="gd-link" href={receiptPath(g.token)} target="_blank" rel="noopener noreferrer">Receipt</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager total={list.length} page={paged.page} per={PER} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}

export default function DashboardGiving({ tab, onTab }) {
  return (
    <div className="dg gv-theme gd gd-page">
      {tab === 'tithes' && <Tithes onMy={() => onTab('my')} />}
      {tab === 'donations' && <Donations />}
      {tab === 'my' && <MyGivingDesk onTab={onTab} />}
    </div>
  );
}
