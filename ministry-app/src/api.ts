// The app's only door to the server: /api/ministry/* on the JSCI website.
// Every call carries the session token. A 401/403 means the session ended
// (signed out elsewhere, role taken away) and signs the app out.
import { API_BASE_URL } from './config';
import type { HomeData, Profile, Recording, RoleType, Song } from './types';

export type Result<T> = { ok: true; data: T; message?: string } | { ok: false; message: string };

const TIMEOUT_MS = 25000;
let token: string | null = null;
let onSessionEnded: ((message: string) => void) | null = null;

export const setApiToken = (value: string | null) => { token = value; };
export const setSessionEndedHandler = (fn: ((message: string) => void) | null) => { onSessionEnded = fn; };

async function request<T>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<Result<T>> {
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
    if ((res.status === 401 || res.status === 403) && token && !path.startsWith('/api/ministry/login')) {
      onSessionEnded?.(body.message || 'Please sign in again.');
    }
    if (!res.ok || body.success === false) return { ok: false, message: body.message || `Something went wrong (${res.status}).` };
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
