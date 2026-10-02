// The attendee-facing QR screen (/qr-display), driven by the verification
// desk. The desk publishes what to show; every open screen listens - in the
// same browser or on another device (see lib/screenLink.js).
//
// Only the channel's id crosses the network. The screen looks the QR and the
// account up in the public payment methods itself, so nobody else on the
// channel can put up a QR of their own - at most pick one of the church's.

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
 */
export function publishQrDisplay(qr) {
  // The dashboard clears the screen every time it loads; the other devices
  // only need telling when something is, or was, up from this desk.
  const wasShowing = !!link.read()?.qr;
  link.publish({ qr: qr || null }, { remote: !!qr || wasShowing });
}

/**
 * Follows the desk. onChange(qr) gets what to show (or null); onStatus(status)
 * gets 'live', 'connecting' or 'offline'. Returns an unsubscribe.
 */
export function subscribeQrDisplay(onChange, onStatus) {
  return link.subscribe((msg) => onChange(msg.qr || null), onStatus);
}
