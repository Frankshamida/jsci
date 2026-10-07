// The attendee-facing QR screen (/qr-display), driven by the verification
// desk. The desk publishes what to show; every open screen listens - in the
// same browser or on another device (see lib/screenLink.js).
//
// Only the channel's id crosses the network. The screen looks the QR and the
// account up in the public payment methods itself, so nobody else on the
// channel can put up a QR of their own - at most pick one of the church's.
// The same for the event whose poster is the screen's background: its id,
// looked up on the public event list (api/events/poster).

import { createScreenLink } from '@/lib/screenLink';

// Only a desk with something up answers a hello, so an idle desk never
// blanks the screen another desk is using.
const link = createScreenLink({
  channel: 'jsci-qr-display',
  storageKey: 'jsci.qrDisplay.v2',
  topic: 'qr-display',
  answersHello: (msg) => !!msg?.qr,
});

export const readQrDisplay = link.read;

/**
 * Show a payment channel to the attendee, or clear the screen with null.
 * @param {null | { methodId: string, amount: number, names: string[] }} qr
 * @param {string} [eventId] the event the desk is on - its poster is the backdrop
 */
export function publishQrDisplay(qr, eventId) {
  // The dashboard clears the screen every time it loads; the other devices
  // only need telling when something is, or was, up from this desk.
  const wasShowing = !!link.read()?.qr;
  link.publish({ qr: qr || null, ...(eventId ? { eventId } : {}) }, { remote: !!qr || wasShowing });
}

/**
 * Which event the desk is on, so an idle screen shows that event's poster.
 * Carries no `qr` at all - a screen keeps whatever QR is up (another desk's,
 * even) and only changes its backdrop.
 */
export function announceQrDisplayEvent(eventId) {
  if (!eventId) return;
  const last = link.read();
  link.publish({ ...(last?.qr ? { qr: last.qr } : {}), eventId }, { remote: true });
}

/**
 * Follows the desk. onChange(qr) gets what to show (or null); onStatus(status)
 * gets 'live', 'connecting' or 'offline'; onEvent(eventId) gets the event a
 * desk is on. Returns an unsubscribe.
 */
export function subscribeQrDisplay(onChange, onStatus, onEvent = () => {}) {
  return link.subscribe((msg) => {
    if (msg.eventId) onEvent(msg.eventId);
    // An event-only message leaves the QR as it is.
    if ('qr' in msg) onChange(msg.qr || null);
  }, onStatus);
}
