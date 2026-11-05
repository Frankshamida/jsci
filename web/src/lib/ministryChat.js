// ============================================================
// JSCI Ministry app - group chats
// One chat per ministry role, one for the PAW Team, and one for everybody.
// Who is in a room follows their ministry roles (users.ministry / sub_role),
// so giving someone the Media role puts them in "Media Team" at once, and
// taking it away takes them out. Checked on every call.
//
//   all       JSCI Ministry Members   everyone who can use the app
//   paw       PAW Team                singers, musicians, dancers and media
//   singer    Singers                 Singer (PAW)
//   musician  Musicians               Musician (PAW)
//   dancer    Dancers                 Dancer (PAW)
//   media     Media Team              Media
//   usher     Ushers                  Usher
//
// Messages: ministry_chat_messages. Ticks: ministry_chat_reads keeps, per
// room and member, when their app last received the room (delivered_at) and
// when they last had it open (read_at). Both tables are server-only.
// ============================================================
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { USER_FIELDS, fullNameOf, ministryAccessError } from '@/lib/ministryAuth';
import { ministryKeys } from '@/lib/ministryApp';

export const ROOMS = [
  { room: 'all', title: 'JSCI Ministry Members', icon: 'church' },
  { room: 'paw', title: 'PAW Team', icon: 'music' },
  { room: 'singer', title: 'Singers', icon: 'microphone' },
  { room: 'musician', title: 'Musicians', icon: 'guitar' },
  { room: 'dancer', title: 'Dancers', icon: 'person-running' },
  { room: 'media', title: 'Media Team', icon: 'camera' },
  { room: 'usher', title: 'Ushers', icon: 'door-open' },
];

const PAW_KEYS = ['singer', 'musician', 'dancer', 'media'];
export const MESSAGE_COLUMNS = 'id, room, sender_id, body, client_id, deleted_at, created_at';
export const MAX_BODY = 2000;

export const roomInfo = (room) => ROOMS.find((r) => r.room === room) || null;

/** May this user read and write in this room? */
export function inRoom(user, room) {
  if (!user || !roomInfo(room) || ministryAccessError(user)) return false;
  if (room === 'all') return true;
  const keys = ministryKeys(user);
  if (room === 'paw') return keys.some((k) => PAW_KEYS.includes(k));
  return keys.includes(room);
}

/** The rooms this user is in, in the fixed order. */
export const roomsFor = (user) => ROOMS.filter((r) => inRoom(user, r.room));

// Everybody who can use the app. Read once a minute per server instance:
// every chat call needs it (room sizes, names and pictures, receipts).
let membersCache = { at: 0, list: null };
const MEMBERS_TTL_MS = 60 * 1000;

export async function ministryMembers() {
  if (membersCache.list && Date.now() - membersCache.at < MEMBERS_TTL_MS) return membersCache.list;
  const { data, error } = await supabase.from('users').select(USER_FIELDS).eq('is_active', true).eq('status', 'Verified');
  if (error) {
    if (membersCache.list) return membersCache.list; // a blip: keep the last good list
    throw error;
  }
  const list = (data || []).filter((u) => !ministryAccessError(u));
  membersCache = { at: Date.now(), list };
  return list;
}

/** The members of a room. */
export async function roomMembers(room) {
  return (await ministryMembers()).filter((u) => inRoom(u, room));
}

/**
 * id -> user for these sender ids: from the members list, and anybody else
 * (a former member whose old messages are still there) in one query.
 */
export async function sendersById(ids) {
  const people = new Map((await ministryMembers()).map((u) => [u.id, u]));
  const missing = [...new Set(ids)].filter((id) => id && !people.has(id));
  if (missing.length) {
    const { data } = await supabase.from('users').select('id, firstname, lastname, profile_picture').in('id', missing);
    (data || []).forEach((u) => people.set(u.id, u));
  }
  return people;
}

/** A message as the app reads it. An unsent message keeps its place but loses its text. */
export function shapeMessage(m, people) {
  const p = people.get(m.sender_id);
  return {
    id: m.id,
    room: m.room,
    body: m.deleted_at ? '' : m.body,
    deleted: !!m.deleted_at,
    senderId: m.sender_id,
    senderName: p ? fullNameOf(p) : 'Former member',
    senderPicture: p?.profile_picture || null,
    createdAt: m.created_at,
    clientId: m.client_id || null,
  };
}

/**
 * Note that this user's app received these rooms (and, with `read`, that
 * they had them open). Only the columns given are changed.
 */
export async function touchReads(userId, rooms, { read = false } = {}) {
  if (!rooms.length) return;
  const now = new Date().toISOString();
  const rows = rooms.map((room) => ({ room, user_id: userId, delivered_at: now, ...(read && { read_at: now }) }));
  const { error } = await supabaseAdmin.from('ministry_chat_reads').upsert(rows, { onConflict: 'room,user_id' });
  if (error) console.error('ministry chat touchReads error:', error);
}
