// ============================================================
// The "Meet the Developers" window's state, shared by everything that opens
// it: the homepage's auto-open (components/developers/useDeveloperWelcome),
// the footers' "Meet the Developers" buttons, and the one window itself
// (components/developers/DeveloperWelcomeHost, in the root layout). Read with
// useSyncExternalStore.
//
// Whether a visitor has seen it:
//   sh_dev_welcome=1          a SESSION cookie (no Expires): set the moment
//                             the window shows, gone when the browser is
//                             closed or site data is cleared. Not
//                             sessionStorage, which is per tab: every new tab
//                             would show it again.
//   sh_dev_welcome_optout=1   localStorage: "Don't show this again".
//   shownThisLoad             in memory, for a browser that blocks both: at
//                             most once per page load, never again on a
//                             client-side visit back to "/".
// Browser only; nothing here touches window or document until called.
// ============================================================

const COOKIE = 'sh_dev_welcome';
const OPTOUT_KEY = 'sh_dev_welcome_optout';

let shownThisLoad = false;
let state = { open: false, source: null };
let data = { status: 'idle', developers: [], settings: null, error: '' };
let inflight = null;
let returnFocusTo = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const SERVER_STATE = { open: false, source: null };
export const SERVER_DATA = { status: 'idle', developers: [], settings: null, error: '' };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getState = () => state;
export const getData = () => data;
export const takeReturnFocus = () => { const el = returnFocusTo; returnFocusTo = null; return el; };

/** The developers and the window's words, read once per page load (again after a failure). */
export function loadDevelopers({ force = false } = {}) {
  if (!force && data.status === 'ready') return Promise.resolve(data);
  if (inflight) return inflight;
  data = { ...data, status: 'loading', error: '' };
  emit();
  inflight = fetch('/api/developers')
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || 'The team could not be loaded just now.');
      data = { status: 'ready', developers: Array.isArray(json.developers) ? json.developers : [], settings: json.settings || null, error: '' };
    })
    .catch((e) => {
      data = { status: 'error', developers: [], settings: null, error: e?.message || 'The team could not be loaded just now.' };
    })
    .then(() => {
      inflight = null;
      emit();
      return data;
    });
  return inflight;
}

/**
 * Open the window. `source` is 'auto' (the homepage) or 'manual' (a button,
 * which always opens it, whatever the cookie or the opt-out say).
 */
export function openDevelopers(source = 'manual') {
  if (state.open) return;
  try { returnFocusTo = document.activeElement; } catch { returnFocusTo = null; }
  state = { open: true, source };
  emit();
  if (data.status !== 'ready') loadDevelopers({ force: data.status === 'error' });
}

export function closeDevelopers() {
  if (!state.open) return;
  state = { open: false, source: state.source };
  emit();
}

// ---- Seen this session? ----

export function hasSeenThisSession() {
  if (shownThisLoad) return true;
  try {
    return String(document.cookie || '').split(/;\s*/).includes(`${COOKIE}=1`);
  } catch {
    return false;
  }
}

/** Called the moment the window shows on its own. */
export function markSeen() {
  shownThisLoad = true;
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    // No Expires / Max-Age: a session cookie.
    document.cookie = `${COOKIE}=1; path=/; SameSite=Lax${secure}`;
  } catch { /* cookies blocked: the in-memory flag stands in */ }
}

export function isOptedOut() {
  try { return window.localStorage.getItem(OPTOUT_KEY) === '1'; } catch { return false; }
}

export function setOptOut(on) {
  try {
    if (on) window.localStorage.setItem(OPTOUT_KEY, '1');
    else window.localStorage.removeItem(OPTOUT_KEY);
  } catch { /* storage blocked: nothing to remember it in */ }
}
