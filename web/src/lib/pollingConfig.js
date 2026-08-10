'use client';

import { useEffect, useRef } from 'react';

/**
 * Central polling configuration + a quota-friendly polling hook.
 *
 * Why this exists: the app runs on the FREE tiers of Supabase, Cloudinary and Groq.
 * Naive `setInterval` polling burns those quotas around the clock — including while
 * the tab sits in the background, which is where most of the waste happens.
 *
 * Every interval in the app should come from POLL_MS so the whole system can be
 * re-tuned from one place if we start approaching a limit.
 */

// All values in milliseconds. Raise these first if a quota gets tight.
export const POLL_MS = {
  // Chat is the single most expensive poller (2 requests + a write per tick).
  // Supabase Realtime does the heavy lifting; this is only a safety-net refresh.
  chatThread: 30000,
  chatUsers: 60000,
  // Presence heartbeat — a DB write per tick, so keep it lazy.
  presence: 120000,
  // Admin alert feeds.
  eventRegAlerts: 180000,
  // Cloudinary Admin API is capped at 500 calls/hour on the free plan.
  cloudinaryUsage: 300000,
  // Public pages: Realtime already covers these, so this is a fallback only.
  liveStreams: 120000,
};

// Treat the user as idle after this long with no interaction; idle tabs stop polling.
const IDLE_AFTER_MS = 5 * 60 * 1000;

// How much to slow a poller down each time it fails, and the ceiling for backoff.
const BACKOFF_FACTOR = 2;
const MAX_BACKOFF_MULTIPLIER = 8;

function isTabVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

/**
 * Polls `callback` every `intervalMs`, but skips work that would waste quota:
 *
 *  - pauses entirely while the tab is hidden (and refreshes once on return)
 *  - pauses while the user is idle (no input for IDLE_AFTER_MS)
 *  - backs off exponentially when the callback throws, recovering on success
 *  - never overlaps runs, so a slow request can't stack up queued calls
 *
 * @param {() => (void | Promise<void>)} callback  work to run each tick
 * @param {number|null} intervalMs                 base interval; null/0 disables polling
 * @param {object}  [options]
 * @param {boolean} [options.enabled=true]         set false to disable entirely
 * @param {boolean} [options.immediate=true]       run once on mount / on re-enable
 * @param {boolean} [options.pauseWhenIdle=true]   stop polling for an idle user
 */
export function useSmartPoll(callback, intervalMs, options = {}) {
  const { enabled = true, immediate = true, pauseWhenIdle = true } = options;

  // Keep the latest callback in a ref so callers can pass an inline arrow
  // without resetting the timer on every render.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const lastActivityRef = useRef(Date.now());
  const backoffRef = useRef(1);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;

    let disposed = false;
    let timerId;

    const markActive = () => { lastActivityRef.current = Date.now(); };
    const isIdle = () => pauseWhenIdle && (Date.now() - lastActivityRef.current > IDLE_AFTER_MS);

    const run = async () => {
      // Don't stack requests if the previous one is still running.
      if (disposed || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await callbackRef.current();
        backoffRef.current = 1; // recovered
      } catch {
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_FACTOR, MAX_BACKOFF_MULTIPLIER);
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = () => {
      if (disposed) return;
      clearTimeout(timerId);
      timerId = setTimeout(tick, intervalMs * backoffRef.current);
    };

    const tick = async () => {
      if (disposed) return;
      // Skip the request but keep the loop alive, so we resume instantly
      // once the tab is visible / the user comes back.
      if (isTabVisible() && !isIdle()) await run();
      schedule();
    };

    const onVisibilityChange = () => {
      if (!isTabVisible()) return;
      // Coming back to the tab: refresh now rather than waiting out the interval.
      markActive();
      run();
      schedule();
    };

    if (immediate) run();
    schedule();

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    if (typeof window !== 'undefined') {
      activityEvents.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      disposed = true;
      clearTimeout(timerId);
      if (typeof window !== 'undefined') {
        activityEvents.forEach((e) => window.removeEventListener(e, markActive));
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [enabled, intervalMs, immediate, pauseWhenIdle]);
}

export default POLL_MS;
