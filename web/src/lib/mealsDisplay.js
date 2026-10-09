// The name screen at the Meals Counter (/rfid-meals-display), driven by the
// counter. Every card tapped there turns the ID on the screen over to that
// attendee, in the order they tapped, with what happened - served, already
// taken, not checked in - and the event's cover blurred behind it. Same two
// roads as the QR screen (see lib/screenLink.js): another window, or another
// device.
//
// The message is the counter's whole line, so a screen that falls behind a
// fast queue still has every name to show:
//   { at, event: { id, title, image, start, end, venue, city },
//     meal: { kind, day, days, label, date },
//     taps: [{ seq, name, first, last, church, status, meal, day, claimedAt, t }] }
//   seq     the tap's place in the line (the counter's clock when tapped)
//   t       when the counter last changed it
//   status  see MEAL_LINE_BUSY, then 'served' | 'already' | 'blocked'
//           | 'not_verified' | 'unknown' | 'error' | 'skipped'

import { createScreenLink } from '@/lib/screenLink';

const link = createScreenLink({
  channel: 'jsci-meals-display',
  storageKey: 'jsci.mealsDisplay.v1',
  topic: 'meals-display',
});

export const readMealsDisplay = link.read;
export const publishMealsDisplay = (content) => link.publish(content);
export const subscribeMealsDisplay = link.subscribe;

// A tap the counter is still answering:
//   waiting  in the line, not read yet
//   reading  being looked up
//   serving  the meal being recorded
//   matched  on the counter, waiting for the meal to be ticked by hand
export const MEAL_LINE_BUSY = ['waiting', 'reading', 'serving', 'matched'];

// The meal a counter opened now is serving: lunch until 3 pm in Manila,
// dinner after.
export const mealForNow = () => {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }));
  return hour < 15 ? 'lunch' : 'dinner';
};

// Only a poster from the church's own Cloudinary goes behind the name - the
// message comes over a public channel, and the screen is in front of a queue.
export const isPosterUrl = (url) => /^https:\/\/res\.cloudinary\.com\//i.test(String(url || ''));
