'use client';

// Who is signed in on this browser, for the public pages (the home page, News,
// the live page). The website keeps its sign-in where the login page puts it:
// `userData` in sessionStorage and localStorage.
//
// Also the "take me back" path: a visitor sent to sign in from the live page
// comes back to the live page, not to the dashboard. It is kept for the tab,
// so it survives the sign-up form, the Google round trip and the login page.

import { useEffect, useState } from 'react';

const SESSION_KEY = 'userData';
const RETURN_KEY = 'returnTo';

export function readViewer() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    const user = raw ? JSON.parse(raw) : null;
    return user && user.id && user.firstname ? user : null;
  } catch {
    return null;
  }
}

export function signOutViewer() {
  try {
    const user = readViewer();
    if (user?.id) sessionStorage.removeItem(`dashboardStarted:${user.id}`);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('viewer-change'));
}

// { viewer, ready }: `ready` is false until the browser has been asked, so a
// page does not flash "Log In" at somebody who is signed in.
export function useViewer() {
  const [state, setState] = useState({ viewer: null, ready: false });
  useEffect(() => {
    const read = () => setState({ viewer: readViewer(), ready: true });
    read();
    // Signed in or out in another tab, or here (signOutViewer).
    const onStorage = (e) => { if (!e.key || e.key === SESSION_KEY) read(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('viewer-change', read);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('viewer-change', read);
    };
  }, []);
  return state;
}

// A path on this site, or null: "/sunday-service" yes; "//evil.com", "https://...",
// "javascript:..." no.
export function safeReturnPath(path) {
  const p = String(path || '').trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null;
  if (/^\/(login|signup|auth)(\/|\?|#|$)/.test(p)) return null;
  return p.slice(0, 300);
}

export function rememberReturn(path) {
  const p = safeReturnPath(path);
  if (!p) return;
  try { sessionStorage.setItem(RETURN_KEY, p); } catch { /* not kept */ }
}

export function peekReturn() {
  try { return safeReturnPath(sessionStorage.getItem(RETURN_KEY)); } catch { return null; }
}

// Where to go after signing in: the remembered page (used once), else `fallback`.
// Asked twice in a moment - React runs a page's effects twice in development,
// and a page may ask from a timer as well - it gives the same answer twice.
let recentlyTaken = null;
export function takeReturn(fallback = '/dashboard') {
  const p = peekReturn();
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* nothing kept */ }
  if (p) {
    recentlyTaken = { path: p, at: Date.now() };
    return p;
  }
  if (recentlyTaken && Date.now() - recentlyTaken.at < 10000) return recentlyTaken.path;
  return fallback;
}

// A Guest and nothing more: no other role, and no events of their own to run.
// The home page shows such an account one slim line (components/guest/
// GuestHome) pointing to the dashboard, which is every role's home now - a
// Guest's with its own Home page (components/guest/GuestOverview).
export function isGuestOnly(user) {
  if (!user) return false;
  const roles = [user.role, ...(user.additional_roles || [])].filter(Boolean);
  return roles.every((r) => r === 'Guest') && !(user.allowed_event_types || []).length;
}
// Where an account goes after signing in: the dashboard, whatever the role.
// (`user` is kept so callers need not change if roles ever differ again.)
// eslint-disable-next-line no-unused-vars
export const homeFor = (user) => '/dashboard';

// The signed-in account, saved where the login page keeps it, and every page
// told (the navbar, the guest's home).
export function saveViewer(user) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch { /* this page only */ }
  window.dispatchEvent(new Event('viewer-change'));
}

export function initialsOf(user) {
  const a = String(user?.firstname || '').trim()[0] || '';
  const b = String(user?.lastname || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}
