// Every verifier's desk at an event, kept on the same page.
//
// Two or three desks verify the same queue from different laptops. When one
// of them changes something - somebody verified, a payment taken - it says so
// on a Supabase Realtime broadcast channel for the event, and the others
// re-read straight away instead of showing a stale Status and count until the
// next poll. Nothing is in the message but "changed": what changed is read
// back from the server, which is the only place that knows it.

import { supabase } from '@/lib/supabase';

const topicOf = (eventId) => `verify-desk-${eventId}`;

// One channel per event, kept a moment after its last listener goes: the
// client hands back a leaving channel for the same topic, so leaving and
// rejoining at once (a remount) would try to subscribe it twice.
const rooms = new Map();

function join(eventId) {
  if (rooms.has(eventId)) return rooms.get(eventId);
  const ch = supabase.channel(topicOf(eventId), { config: { broadcast: { self: false } } });
  const room = { ch, listeners: new Set(), closing: null };
  ch.on('broadcast', { event: 'changed' }, () => room.listeners.forEach((fn) => fn()));
  ch.subscribe();
  rooms.set(eventId, room);
  return room;
}

/** Calls onChange() whenever another desk at this event changes something. */
export function followDeskChanges(eventId, onChange) {
  if (!supabase || !eventId) return () => {};
  const room = join(eventId);
  clearTimeout(room.closing);
  room.listeners.add(onChange);
  return () => {
    room.listeners.delete(onChange);
    if (room.listeners.size) return;
    room.closing = setTimeout(() => {
      if (room.listeners.size) return;
      rooms.delete(eventId);
      supabase.removeChannel(room.ch);
    }, 5000);
  };
}

/** Tells the other desks at this event to re-read. */
export function announceDeskChange(eventId) {
  const room = supabase && eventId ? rooms.get(eventId) : null;
  if (!room) return;
  const payload = { at: Date.now() };
  // Until the socket has joined, the REST endpoint carries it.
  if (room.ch.state === 'joined') room.ch.send({ type: 'broadcast', event: 'changed', payload }).catch(() => {});
  else room.ch.httpSend('changed', payload).catch(() => {});
}
