// ============================================================
// Group chats: the API, and one shared list of rooms for the Chat tab and
// its badge.
//   useChatUnreadCount()  the tab badge; keeps the list fresh (every 20 s
//                         while the app is open, and when it comes back)
//   useChatRooms()        the room list for the Chat tab
//   refreshChatRooms()    ask again now (after reading or sending)
// A room's messages are kept here too, so opening it again is instant.
// ============================================================
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { request } from './api';
import { useSession } from './session';
import type { IconName } from './icons';

export interface ChatPreview {
  id: string;
  body: string;
  deleted: boolean;
  senderId: string;
  senderName: string;
  createdAt: string;
}

export interface ChatRoomSummary {
  room: string;
  title: string;
  icon: IconName;
  memberCount: number;
  unread: number;
  lastMessage: ChatPreview | null;
}

export interface ChatMessage {
  id: string;
  room: string;
  body: string;
  deleted: boolean;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  createdAt: string;
  clientId: string | null;
}

// When another member's app last received the room, and when they last had it open.
export interface ChatReceipt {
  userId: string;
  name: string;
  picture: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ChatPage {
  messages: ChatMessage[];
  receipts: ChatReceipt[];
  deletedIds: string[];
  hasMore: boolean;
  memberCount: number;
  serverTime: string;
}

export const chatApi = {
  rooms: () => request<ChatRoomSummary[]>('/api/ministry/chat'),
  messages: (room: string, opts: { after?: string; before?: string; read?: boolean; deletedSince?: string; limit?: number } = {}) => {
    const q = [`room=${encodeURIComponent(room)}`];
    if (opts.after) q.push(`after=${encodeURIComponent(opts.after)}`);
    if (opts.before) q.push(`before=${encodeURIComponent(opts.before)}`);
    if (opts.read) q.push('read=1');
    if (opts.deletedSince) q.push(`deletedSince=${encodeURIComponent(opts.deletedSince)}`);
    if (opts.limit) q.push(`limit=${opts.limit}`);
    return request<ChatPage>(`/api/ministry/chat/messages?${q.join('&')}`);
  },
  send: (room: string, body: string, clientId: string) =>
    request<ChatMessage>('/api/ministry/chat/messages', { method: 'POST', json: { room, body, clientId } }),
  unsend: (id: string) => request<{ id: string }>(`/api/ministry/chat/messages?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// A fresh id for a message being sent, so a retry never doubles it.
export const newClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ---- The shared room list ----

interface RoomsState {
  rooms: ChatRoomSummary[] | null;
  error: string | null;
  at: number; // when it was last fetched
}

let state: RoomsState = { rooms: null, error: null, at: 0 };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let generation = 0; // bumped on sign-out, so a late answer for the old account is dropped

const setState = (next: Partial<RoomsState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

export function refreshChatRooms(): Promise<void> {
  if (inFlight) return inFlight;
  const gen = generation;
  inFlight = (async () => {
    const res = await chatApi.rooms();
    if (gen !== generation) return;
    if (res.ok) setState({ rooms: res.data, error: null, at: Date.now() });
    else setState({ error: res.message });
  })().finally(() => { inFlight = null; });
  return inFlight;
}

// Refresh unless it was just done (opening the tab right after the poll).
export function refreshChatRoomsIfStale(maxAgeMs = 5000) {
  if (Date.now() - state.at > maxAgeMs) refreshChatRooms();
}

// The open room is being read: its badge drops now, before the next poll.
export function markRoomRead(room: string, last?: ChatMessage) {
  if (!state.rooms) return;
  const rooms = state.rooms.map((r) => {
    if (r.room !== room) return r;
    const sameLast = !last || (r.lastMessage?.id === last.id && r.lastMessage.deleted === last.deleted);
    if (r.unread === 0 && sameLast) return r;
    const lastMessage = last
      ? { id: last.id, body: last.body, deleted: last.deleted, senderId: last.senderId, senderName: last.senderName, createdAt: last.createdAt }
      : r.lastMessage;
    return { ...r, unread: 0, lastMessage };
  });
  if (rooms.some((r, i) => r !== state.rooms![i])) setState({ rooms });
}

export const useChatRooms = () => useSyncExternalStore(subscribe, snapshot);

// ---- A room's messages, kept between visits ----

export interface RoomCache {
  messages: ChatMessage[];
  receipts: ChatReceipt[];
  hasMore: boolean;
  serverTime: string | null;
  memberCount: number;
}
const roomCache = new Map<string, RoomCache>();
export const getRoomCache = (room: string) => roomCache.get(room) || null;
export const setRoomCache = (room: string, value: RoomCache) => { roomCache.set(room, value); };

function resetChat() {
  generation++;
  roomCache.clear();
  setState({ rooms: null, error: null, at: 0 });
}

// ---- The tab badge ----

const POLL_MS = 20 * 1000;

// Total unread across the rooms. Mounted once, by the tab bar: it keeps the
// list fresh while the app is open and signed in, and forgets it on sign-out.
export function useChatUnreadCount(): number {
  const { status } = useSession();
  const { rooms } = useChatRooms();
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      refreshChatRooms();
      timer = setInterval(refreshChatRooms, POLL_MS);
    };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { stop(); sub.remove(); resetChat(); };
  }, [signedIn]);

  return (rooms || []).reduce((sum, r) => sum + r.unread, 0);
}

// ---- Times ----

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const daysBetween = (a: Date, b: Date) =>
  Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000);

// "9:41 AM"
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// The room list: "9:41 AM" today, "Yesterday", "Mon" this week, "Nov 3" before that.
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return clockTime(iso);
  const days = daysBetween(d, now);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// Between the messages of different days: "Today", "Yesterday", "Mon, Nov 3".
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = daysBetween(d, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
