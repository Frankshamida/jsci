// The attendee-facing QR screen (/qr-display), driven by the verification
// desk in the same browser. The desk publishes what to show; the screen,
// open in another window or on a second monitor, listens. localStorage keeps
// the last state so a screen opened (or reloaded) mid-payment still shows it.

const CHANNEL = 'jsci-qr-display';
const KEY = 'jsci.qrDisplay';

/**
 * Show a payment channel to the attendee, or clear the screen with null.
 * @param {null | { method: object, amount: number, names: string[] }} state
 */
export function publishQrDisplay(state) {
  const msg = state ? { ...state, at: Date.now() } : null;
  try { localStorage.setItem(KEY, JSON.stringify(msg)); } catch { /* private window */ }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch { /* old browser: the storage event below still reaches the screen */ }
}

export function readQrDisplay() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

/** Calls onChange(state) whenever the desk publishes. Returns an unsubscribe. */
export function subscribeQrDisplay(onChange) {
  let ch = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => onChange(e.data);
  } catch { /* fall back to storage events only */ }
  const onStorage = (e) => { if (e.key === KEY) onChange(readQrDisplay()); };
  window.addEventListener('storage', onStorage);
  return () => { if (ch) ch.close(); window.removeEventListener('storage', onStorage); };
}
