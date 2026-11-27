'use client';

// A donation drive's jar, beside its photos on /donation/<slug>: the jar as it
// is - empty before the first donation, filling toward the goal, spilling
// over past it - how much is in it, and Donate. The jar is the <heart-jar>
// element (GivingJar); what it shows is jarProps (lib/giving) of the server's
// numbers, which count confirmed (Successful) donations only.
//
// Opened from the "your donation is confirmed" email (?gift=<token>): the
// drive's numbers are asked for fresh, the jar appears as it was BEFORE this
// gift, and on the next animation frame it is moved to AFTER
// (jar.setAmount): only the giver's new hearts fall in, and the verse shows
// once they have landed. It ends exactly as everyone else sees it. A gift
// that adds no heart by itself - the jar was full already, or it is small
// beside what is there - still sees hearts drop: the jar starts a little
// lower (GivingJar refillFrom), and past the goal pours its spill again.
//
// Donating here: when the window closes, the hearts drop in again for the
// giver (GivingJar replayJar). The gift is counted once it is confirmed.
//
// While the page is open it asks the server again every minute, and when the
// tab comes back: a donation confirmed or refunded since then moves the jar
// to the server's new amount - hearts fall in, or go.

import { useEffect, useRef, useState } from 'react';
import GivingJar, { heartsShown, refillFrom, replayJar, setJarAmount } from './GivingJar';
import { GiveButton } from './GiveModal';
import { loadHeartJar } from './heartJarLoader';
import { useJarMeter } from './useJarMeter';
import { campaignEnds, campaignOpen, jarProps, peso, receiptPath, verseFor } from '@/lib/giving';

const REFRESH_MS = 60_000;
const numbersOf = (c) => ({
  raised: Number(c?.raised) || 0,
  goal_amount: Number(c?.goal_amount) > 0 ? Number(c.goal_amount) : null,
  gifts: Number(c?.gifts) || 0,
});
const sameNumbers = (a, b) => a.raised === b.raised && a.gifts === b.gifts && a.goal_amount === b.goal_amount;

export default function DonationJar({ campaign }) {
  const [live, setLive] = useState(() => numbersOf(campaign));
  // checking: a ?gift= link is being looked up | public | thanks | note
  const [phase, setPhase] = useState('checking');
  const [gift, setGift] = useState(null);
  // thanks: the jar as it was before this gift, until it is moved to now
  const [before, setBefore] = useState(null);
  const [moved, setMoved] = useState(false);
  const [landed, setLanded] = useState(false);
  const card = useRef(null);
  const started = useRef(false);
  const armed = useRef(false);
  const jarEl = useRef(null);
  const nowRef = useRef(null);

  useEffect(() => {
    loadHeartJar().catch(() => { /* the jar's place stays empty */ });
    let token = null;
    try { token = new URLSearchParams(window.location.search).get('gift'); } catch { /* none */ }
    if (!token) { setPhase('public'); return undefined; }
    let alive = true;
    fetch(`/api/giving/gifts?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        const g = j.success ? j.data : null;
        const c = j.campaign;
        if (!g || !c || c.slug !== campaign.slug) { setPhase('public'); return; }
        const now = numbersOf(c);
        setLive(now);
        setGift(g);
        card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (g.status === 'successful') {
          setBefore(jarProps({ ...now, raised: Math.max(0, now.raised - (Number(g.amount) || 0)), gifts: Math.max(0, now.gifts - 1) }));
          setPhase('thanks');
        } else {
          setPhase('note');
        }
      })
      .catch(() => { if (alive) setPhase('public'); });
    return () => { alive = false; };
  }, [campaign.slug]);

  // The server's numbers again, every minute and when the tab comes back.
  useEffect(() => {
    if (phase === 'checking' || !campaign.id) return undefined;
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch(`/api/giving?drive=${encodeURIComponent(campaign.id)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive || !j?.success) return;
          const fresh = numbersOf(j.campaign);
          setLive((old) => (sameNumbers(old, fresh) ? old : fresh));
        })
        .catch(() => { /* keep what is shown */ });
    };
    const timer = setInterval(refresh, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, [phase, campaign.id]);

  const now = jarProps(live);
  nowRef.current = now;
  const shown = phase === 'thanks' && before && !moved ? before : now;

  // The email link: the jar is on the page at BEFORE; on the next frame, AFTER.
  const onReady = (jar) => {
    jarEl.current = jar;
    if (phase !== 'thanks' || started.current) return;
    started.current = true;
    // No heart of its own: start lower, before anything is drawn.
    if (heartsShown(now) === heartsShown(before)) {
      const from = refillFrom(now);
      if (from != null && from < before.amount) jar.setAmount(from);
    }
    requestAnimationFrame(() => {
      armed.current = true;
      setJarAmount(jar, now.amount);
      setMoved(true);
    });
  };
  const onSettled = () => { if (phase === 'thanks' && armed.current) setLanded(true); };

  // Donated here: bring the jar into view, then its hearts drop in again.
  const onGiven = () => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => replayJar(jarEl.current, nowRef.current), calm ? 0 : 450);
  };

  const goal = live.goal_amount || 0;
  const percent = goal ? Math.round((live.raised / goal) * 100) : null;
  const reached = goal > 0 && live.raised >= goal;
  const open = campaignOpen(campaign);
  const ends = campaignEnds(campaign);
  const first = String(gift?.donor_name || '').trim().split(/\s+/)[0];
  const verse = gift ? verseFor(gift.receipt_no) : null;
  const label = live.raised ? `The donation jar: ${peso(live.raised)}${goal ? ` of ${peso(goal)}` : ''}` : 'The donation jar, empty so far';
  // The gold bar fills with the jar's hearts, and stops with them.
  const meter = useJarMeter(goal ? Math.min(100, Math.max(percent, live.raised > 0 ? 2 : 0)) : 0);

  return (
    <div ref={card} className="gv-card gv-jarcard">
      {phase === 'thanks' && (
        <div className="gv-thanks" role="status">
          <span className="gv-eyebrow">Donation confirmed</span>
          <h2>Thank you{first ? `, ${first}` : ''}!</h2>
          <p>Your {peso(gift.amount)} is in the jar.</p>
        </div>
      )}
      {phase === 'note' && (
        <p className="gv-banner warn" role="status">
          {gift.status === 'pending'
            ? `Your ${peso(gift.amount)} is waiting to be confirmed. When it is, your hearts drop into this jar.`
            : gift.status === 'refunded'
              ? `Your ${peso(gift.amount)} donation was refunded.`
              : `We could not find your ${peso(gift.amount)} transfer. If you sent it, message us with your reference number.`}
        </p>
      )}

      {phase === 'checking' ? (
        <div className="gj has-art" role="img" aria-label={label}>
          <span className="gj-art" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
          <span className="gj-wait" />
        </div>
      ) : (
        <GivingJar
          amount={shown.amount}
          goal={shown.goal}
          softScale={shown.softScale}
          animateOnLoad={phase === 'public'}
          backdrop
          onReady={(j) => { onReady(j); meter.onJarReady(j); }}
          onSettled={onSettled}
          label={label}
        />
      )}

      {phase === 'thanks' && (
        <div className={`gv-thanks-after ${landed ? 'is-shown' : ''}`}>
          <blockquote className="gv-verse">&ldquo;{verse.text}&rdquo;<cite>{verse.ref}</cite></blockquote>
          <a href={receiptPath(gift.token)} className="gv-link">View your receipt</a>
        </div>
      )}

      <div className="gv-total">
        {live.raised > 0 ? (
          <>
            <strong>{peso(live.raised)}</strong>
            <span>{goal ? `of ${peso(goal)}` : `from ${live.gifts} ${live.gifts === 1 ? 'donation' : 'donations'}`}</span>
          </>
        ) : (
          <>
            <strong>{peso(0)}</strong>
            <span>{goal ? `of ${peso(goal)} · be the first to give` : 'Be the first to give'}</span>
          </>
        )}
      </div>
      {goal > 0 && (
        <div className="gv-meter" aria-hidden="true" ref={meter.barRef}><span style={meter.fillStyle}></span></div>
      )}
      {reached && <p className="gv-reached">Goal reached - thank you!</p>}

      {open ? (
        <GiveButton mode="donation" campaign={campaign} className="gv-btn is-primary is-wide" onGiven={onGiven}>Donate</GiveButton>
      ) : (
        <p className="gv-closed-note">This drive has ended. Thank you to everyone who gave.</p>
      )}
      {open && ends && <p className="gv-ends">{ends}</p>}
    </div>
  );
}
