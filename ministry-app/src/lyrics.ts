// A lineup's lyrics (from the Media team's lyrics library), kept per lineup
// so switching between Songs and Lyrics is instant. Saving lyrics forgets the
// lineup's copy so it is read again.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { LineupLyrics } from './types';

const cache = new Map<string, LineupLyrics>();
const listeners = new Set<(scheduleId: string) => void>();

export function invalidateLyrics(scheduleId?: string) {
  if (scheduleId) cache.delete(scheduleId); else cache.clear();
  listeners.forEach((l) => l(scheduleId || '*'));
}

export const cachedLyrics = (scheduleId: string) => cache.get(scheduleId) || null;

export function useLineupLyrics(scheduleId: string, enabled: boolean) {
  const [data, setData] = useState<LineupLyrics | null>(cache.get(scheduleId) || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.lyrics(scheduleId);
    setLoading(false);
    if (res.ok) { cache.set(scheduleId, res.data); setData(res.data); } else setError(res.message);
  }, [scheduleId]);

  useEffect(() => {
    if (!enabled) return;
    const have = cache.get(scheduleId);
    if (have) setData(have); else load();
  }, [enabled, scheduleId, load]);

  useEffect(() => {
    const on = (id: string) => { if (id === '*' || id === scheduleId) { setData(null); if (enabled) load(); } };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, [scheduleId, enabled, load]);

  return { data, loading, error, reload: load };
}
