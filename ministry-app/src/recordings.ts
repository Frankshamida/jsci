// Practice recordings of a lineup, kept in memory while the app is open, so
// opening the same lineup again does not ask the server again. An upload or
// a delete marks that lineup's list stale.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from './api';
import type { Recording } from './types';

const FRESH_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; list: Recording[] }>();

export const invalidateRecordings = (scheduleId: string) => { cache.delete(scheduleId); };

export function useRecordings(scheduleId: string) {
  const [list, setList] = useState<Recording[] | null>(cache.get(scheduleId)?.list ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    const hit = cache.get(scheduleId);
    if (!force && hit && Date.now() - hit.at < FRESH_MS) { setList(hit.list); return; }
    setLoading(true);
    const res = await api.recordings(scheduleId);
    setLoading(false);
    if (res.ok) {
      cache.set(scheduleId, { at: Date.now(), list: res.data || [] });
      setList(res.data || []);
      setError(null);
    } else {
      setError(res.message);
    }
  }, [scheduleId]);

  // Each time the lineup screen shows (first open, back from the recorder),
  // fetch only if the list is missing or stale.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return { list, error, loading, reload: () => load(true) };
}
