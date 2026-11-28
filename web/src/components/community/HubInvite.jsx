'use client';

// The home page's invitation to the Community Hub ("A peek inside"): what
// members can do there, a soft view of the hub that never shows anyone's
// posts (placeholder lines and gold shapes stand in for them), and the way in
// for whoever is looking - a visitor, a Guest waiting to be welcomed as a
// member, or a member. Every feature named is in the hub today.

import { useCallback, useEffect, useRef, useState } from 'react';
import { canOpenSection } from '@/lib/userRoles';
import {
  ReactionIcon, REACTION_TYPES, REACTION_PLAY_MS, preloadReactionIcons, prefersReducedMotion, reactionPlaySrc,
} from './ReactionIcon';

const HUB_PATH = '/dashboard#community-hub';

const FEATURES = [
  ['fa-images', 'Share your moments', 'Posts with photos, several at once as a collage.'],
  ['fa-book-bible', 'Share a verse', 'Post a Bible verse and what it means to you.'],
  ['fa-hand-holding-heart', 'Encourage each other', 'React with Love, Fire or Praise, and comment.'],
  ['fa-cake-candles', 'Celebrate birthdays', 'Today’s celebrants, a verse for each, and the family’s wishes.'],
  ['fa-tower-broadcast', 'Worship together live', 'Watch the Sunday service in the hub with live chat.'],
  ['fa-lightbulb', 'Grow a little every day', 'Verse of the Hour, Bible fun facts and trivia.'],
];

// Light or dark, as the site's theme button sets it on <body>, live.
function useBodyDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.body.classList.contains('dark-mode'));
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, []);
  return dark;
}

// The hub's three reactions, the real icons, playing their animations one
// after another when they come into view, again every few seconds while they
// stay in view, and when someone points at them. Still for reduced motion.
function HubReactions({ dark }) {
  const [plays, setPlays] = useState({});
  const boxRef = useRef(null);
  const darkRef = useRef(dark);
  const timers = useRef([]);
  darkRef.current = dark;

  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  const playAll = useCallback(() => {
    if (prefersReducedMotion()) return;
    REACTION_TYPES.forEach((type, i) => later(() => {
      const play = reactionPlaySrc(type, darkRef.current);
      setPlays((prev) => ({ ...prev, [type]: play.src }));
      later(() => {
        setPlays((prev) => (prev[type] === play.src ? { ...prev, [type]: undefined } : prev));
        play.release();
      }, REACTION_PLAY_MS);
    }, i * 260));
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let loop = null;
    let shown = false;
    // Fetch the animations a little before they are needed...
    const near = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { preloadReactionIcons(); near.disconnect(); }
    }, { rootMargin: '600px 0px' });
    // ...and play while the hub view is on screen.
    const seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !shown) {
        shown = true;
        later(playAll, 350);
        loop = setInterval(playAll, 7000);
      } else if (!e.isIntersecting && shown) {
        shown = false;
        clearInterval(loop);
      }
    }, { threshold: 0.6 });
    near.observe(el);
    seen.observe(el);
    const pending = timers.current;
    return () => { near.disconnect(); seen.disconnect(); clearInterval(loop); pending.forEach(clearTimeout); };
  }, [playAll]);

  return (
    <span className="hp-hub-rx" ref={boxRef} onMouseEnter={playAll}>
      {REACTION_TYPES.map((type) => (
        <span key={type} className="hp-hub-rx-i">
          <ReactionIcon type={type} dark={dark} active size={24} src={plays[type]} />
        </span>
      ))}
    </span>
  );
}

function HubWindow({ dark, churchName }) {
  return (
    <div
      className="hp-hub-window"
      role="img"
      aria-label="A view of the Community Hub: a box to share something, a pinned post from the church with Love, Fire and Praise reactions, today's birthdays and the Verse of the Hour."
    >
      <div className="hp-hub-bar"><i></i><i></i><i></i><b>Community Hub</b></div>
      <div className="hp-hub-card hp-hub-compose">
        <span className="hp-hub-av"></span>
        <span className="hp-hub-ph">Share something with the community…</span>
        <span className="hp-hub-tools"><b>Photo</b><b>Bible Verse</b></span>
      </div>
      <div className="hp-hub-card">
        <div className="hp-hub-head">
          <span className="hp-hub-av is-church"><img src="/assets/LOGO.png" alt="" /></span>
          <span className="hp-hub-who"><strong>{churchName}</strong><small>From the pastors</small></span>
          <span className="hp-hub-pin"><i className="fas fa-thumbtack"></i> Pinned</span>
        </div>
        <span className="hp-hub-gl w1"></span>
        <span className="hp-hub-gl w2"></span>
        <div className="hp-hub-coll"><i></i><i></i><i></i></div>
        <div className="hp-hub-react"><HubReactions dark={dark} /><span>Love · Comment</span></div>
      </div>
      <div className="hp-hub-two">
        <div className="hp-hub-card hp-hub-bday">
          <strong><i className="fas fa-cake-candles"></i> Birthdays today</strong>
          <span className="hp-hub-avs"><span className="hp-hub-av"></span><span className="hp-hub-av b"></span><span className="hp-hub-av c"></span></span>
          <small>Leave a wish</small>
        </div>
        <div className="hp-hub-card hp-hub-verse">
          <small>Verse of the Hour</small>
          <q>And let us consider how we may spur one another on toward love and good deeds.</q>
          <cite>Hebrews 10:24</cite>
        </div>
      </div>
      <div className="hp-hub-card hp-hub-ghost">
        <div className="hp-hub-head"><span className="hp-hub-av b"></span><span className="hp-hub-gl w3"></span></div>
        <span className="hp-hub-gl w1"></span>
        <span className="hp-hub-gl w3"></span>
      </div>
      <div className="hp-hub-lockbar"><span><i className="fas fa-lock"></i> For members of the church family</span></div>
    </div>
  );
}

/**
 * @param {object|null} viewer   the signed-in account on this browser, or null
 * @param {string} churchName    whose posts the hub's pinned post is from
 * @param {string} messengerUrl  where a Guest writes to the church office
 */
export default function HubInvite({ viewer, churchName, messengerUrl }) {
  const dark = useBodyDark();
  const member = !!viewer && canOpenSection(viewer, 'community-hub');
  const guest = !!viewer && !member;

  return (
    <section id="community" className="hp-hub" aria-labelledby="hp-hub-title">
      <div className="hp-hub-inner">
        <div className="hp-hub-copy">
          <span className="hp-hub-eye">
            Community Hub
            <span className="hp-hub-lock"><i className="fas fa-lock"></i> Members only</span>
          </span>
          <h2 id="hp-hub-title">Where our church family <em>stays close</em>, all week long</h2>
          <p className="hp-hub-sub">Share what God is doing, encourage one another and celebrate together, in a safe space just for our members.</p>
          <ul className="hp-hub-feats">
            {FEATURES.map(([icon, title, text]) => (
              <li key={title}>
                <span className="hp-hub-ic"><i className={`fas ${icon}`}></i></span>
                <span><strong>{title}</strong><span>{text}</span></span>
              </li>
            ))}
          </ul>
          <div className="hp-hub-ctas">
            {member ? (
              <>
                <a className="hp-hub-btn" href={HUB_PATH}>Open the Community Hub</a>
                <span className="hp-hub-note">Welcome back, {viewer.firstname}. See what the family is sharing today.</span>
              </>
            ) : guest ? (
              <>
                <a className="hp-hub-btn" href={messengerUrl} target="_blank" rel="noopener noreferrer">Message the church office</a>
                <span className="hp-hub-note"><b>You’re signed in as a Guest.</b> Once the church welcomes you as a member, the hub opens in your dashboard.</span>
              </>
            ) : (
              <>
                <a className="hp-hub-btn" href="/signup">Create your free account</a>
                <a className="hp-hub-btn is-ghost" href={`/login?next=${encodeURIComponent(HUB_PATH)}`}>Log in</a>
                <span className="hp-hub-note">Free, and Google sign-in works. <b>New accounts are welcomed as members by the church office</b>, then the hub opens.</span>
              </>
            )}
          </div>
        </div>
        <HubWindow dark={dark} churchName={churchName} />
      </div>
    </section>
  );
}
