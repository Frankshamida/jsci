// The app's only door to the server: /api/ministry/* on the JSCI website.
// Every call carries the session token. A 401, or a refusal marked
// 'session_ended' (role taken away), signs the app out.
import { API_BASE_URL } from './config';
import type { HomeData, LineupLyrics, Lyrics, MemberHistory, MonthData, Profile, Recording, RoleType, Song, Swap, SwapCandidate } from './types';

// `field`: which form field a refusal is about ('email', 'password'), when the server says.
export type Result<T> = { ok: true; data: T; message?: string } | { ok: false; message: string; field?: string | null };

const TIMEOUT_MS = 25000;
let token: string | null = null;
let onSessionEnded: ((message: string) => void) | null = null;

export const setApiToken = (value: string | null) => { token = value; };
export const setSessionEndedHandler = (fn: ((message: string) => void) | null) => { onSessionEnded = fn; };

export async function request<T>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.form ? TIMEOUT_MS * 3 : TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    // The session ended (signed out, role taken away): the server says so.
    // Other refusals ("only the Media team can...") keep you signed in.
    if ((res.status === 401 || body.code === 'session_ended') && token && !path.startsWith('/api/ministry/login')) {
      onSessionEnded?.(body.message || 'Please sign in again.');
    }
    if (!res.ok || body.success === false) return { ok: false, message: body.message || `Something went wrong (${res.status}).`, field: body.field || null };
    return { ok: true, data: body.data as T, message: body.message };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return { ok: false, message: aborted ? 'The server took too long. Check your connection and try again.' : 'No connection. Check your internet and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; profile: Profile }>('/api/ministry/login', { method: 'POST', json: { email, password } }),

  home: () => request<HomeData>('/api/ministry/home'),
  month: (month: string) => request<MonthData>(`/api/ministry/schedule?month=${encodeURIComponent(month)}`),
  member: (id: string) => request<MemberHistory>(`/api/ministry/member?id=${encodeURIComponent(id)}`),

  lyrics: (scheduleId: string) => request<LineupLyrics>(`/api/ministry/lyrics?scheduleId=${encodeURIComponent(scheduleId)}`),
  saveLyrics: (input: { id?: string; title: string; link?: string; text: string; scheduleDate?: string }) =>
    request<Lyrics>('/api/ministry/lyrics', { method: 'PUT', json: input }),

  swapCandidates: (scheduleId: string) =>
    request<{ date: string; parts: string[]; candidates: SwapCandidate[] }>(`/api/ministry/swaps?scheduleId=${encodeURIComponent(scheduleId)}`),
  requestSwap: (input: { scheduleId: string; part: string; partnerId: string; partnerDate: string; reason: string }) =>
    request<Swap>('/api/ministry/swaps', { method: 'POST', json: input }),
  answerSwap: (id: string, action: 'accept' | 'decline', note?: string) =>
    request('/api/ministry/swaps', { method: 'PUT', json: { id, action, note } }),
  cancelSwap: (id: string) => request(`/api/ministry/swaps?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fileExcuse: (date: string, roleType: RoleType, reason: string) =>
    request('/api/ministry/excuses', { method: 'POST', json: { date, roleType, reason } }),
  cancelExcuse: (id: string) => request(`/api/ministry/excuses?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  requestSub: (scheduleId: string, roleType: RoleType, reason: string) =>
    request('/api/ministry/substitutes', { method: 'POST', json: { scheduleId, roleType, reason } }),
  acceptSub: (id: string) => request('/api/ministry/substitutes', { method: 'PUT', json: { id, action: 'accept' } }),
  thankSub: (id: string, message: string) => request('/api/ministry/substitutes', { method: 'PUT', json: { id, action: 'thank-you', message } }),
  cancelSub: (id: string) => request(`/api/ministry/substitutes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  saveSongs: (scheduleId: string, slowSongs: Song[], fastSongs: Song[]) =>
    request('/api/ministry/lineup', { method: 'PUT', json: { scheduleId, slowSongs, fastSongs } }),

  recordings: (scheduleId: string) => request<Recording[]>(`/api/ministry/recordings?scheduleId=${encodeURIComponent(scheduleId)}`),
  uploadRecording: (input: { uri: string; name: string; mimeType: string; scheduleId: string; songType: string; title: string }) => {
    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } file.
    form.append('file', { uri: input.uri, name: input.name, type: input.mimeType } as unknown as Blob);
    form.append('scheduleId', input.scheduleId);
    form.append('songType', input.songType);
    form.append('title', input.title);
    return request<Recording>('/api/ministry/recordings', { method: 'POST', form });
  },
  deleteRecording: (id: string) => request(`/api/ministry/recordings?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
