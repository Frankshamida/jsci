'use client';

// The homepage opens "Meet the Developers" by itself, once, without getting
// in anybody's way:
//   - only on "/", and only on the client (nothing on the server, no flash)
//   - once per browser session: the sh_dev_welcome session cookie, set the
//     moment it shows (a refresh, a new tab or coming back to "/" does not
//     show it again; closing the browser or clearing site data does)
//   - never after "Don't show this again", nor when an admin switched
//     "Auto-show on homepage" off, nor when the team could not be loaded
//   - 2 seconds after the page has loaded, and not at all if the visitor
//     leaves the homepage first
//   - never on top of something: a dialog or Ask Joy open, or someone typing
//     in a field. Then it waits until that is over and they have been idle
//     for 2 seconds, and gives up after about 30 seconds.
// The footers' "Meet the Developers" ignores all of this (lib/developerWelcome).

import { useEffect } from 'react';
import {
  getState, hasSeenThisSession, isOptedOut, loadDevelopers, markSeen, openDevelopers,
} from '@/lib/developerWelcome';

const DELAY_MS = 2000;
const IDLE_MS = 2000;
const GIVE_UP_MS = 30000;
const CHECK_MS = 500;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'];
// Something open that the window must not cover.
const OPEN_ALREADY = [
  '[aria-modal="true"]', '[role="alertdialog"]', 'dialog[open]',
  '.hp-chat.open', '.hp-evt-overlay', '.hp-isom-inquire-modal', '.hp-addon-modal',
].join(',');

function busy() {
  try {
    if ([...document.querySelectorAll(OPEN_ALREADY)].some((el) => el.getClientRects().length > 0)) return true;
    const at = document.activeElement;
    return !!at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.tagName === 'SELECT' || at.isContentEditable);
  } catch {
    return false;
  }
}

export default function useDeveloperWelcome() {
  useEffect(() => {
    if (window.location.pathname !== '/') return undefined;
    if (hasSeenThisSession() || isOptedOut()) return undefined;

    let cancelled = false;
    let timer = null;
    let lastActivity = 0;
    let waitingSince = 0;
    const onActivity = () => { lastActivity = Date.now(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    const team = loadDevelopers(); // fetched while the page settles

    const attempt = async () => {
      timer = null;
      const d = await team;
      if (cancelled) return;
      // No broken, empty window, and none the admins switched off.
      if (d.status !== 'ready' || !d.developers.length || d.settings?.autoShow === false) return;
      if (hasSeenThisSession() || isOptedOut() || getState().open || window.location.pathname !== '/') return;
      const now = Date.now();
      if (busy() || (waitingSince && now - lastActivity < IDLE_MS)) {
        if (!waitingSince) waitingSince = now;
        if (now - waitingSince >= GIVE_UP_MS) return;
        timer = setTimeout(attempt, CHECK_MS);
        return;
      }
      markSeen(); // when it shows, not when it closes
      openDevelopers('auto');
    };
    const start = () => { if (!cancelled) timer = setTimeout(attempt, DELAY_MS); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('load', start);
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
    };
  }, []);
}
