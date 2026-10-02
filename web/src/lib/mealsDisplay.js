// The name screen at the Meals Counter (/rfid-meals-display), driven by the
// counter. A card tapped there puts the attendee's full name up for the queue
// to see, with what happened - served, already taken, not checked in - and the
// event's cover blurred behind it. Same two roads as the QR screen (see
// lib/screenLink.js): another window, or another device.
//
// The message:
//   { at, event: { id, title, image }, meal: { kind, day }, tap: null | {
//       seq, name, church, status, note, claimedAt } }
//   status  'serving' | 'served' | 'already' | 'blocked' | 'unknown' | 'matched'

import { createScreenLink } from '@/lib/screenLink';

const link = createScreenLink({
  channel: 'jsci-meals-display',
  storageKey: 'jsci.mealsDisplay.v1',
  topic: 'meals-display',
});

export const readMealsDisplay = link.read;
export const publishMealsDisplay = (content) => link.publish(content);
export const subscribeMealsDisplay = link.subscribe;

// Only a poster from the church's own Cloudinary goes behind the name - the
// message comes over a public channel, and the screen is in front of a queue.
export const isPosterUrl = (url) => /^https:\/\/res\.cloudinary\.com\//i.test(String(url || ''));
