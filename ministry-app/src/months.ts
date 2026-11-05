// ============================================================
// The schedule by month, for Home's month calendar.
// This month comes with the dashboard (/api/ministry/home). Other months are
// asked for once (/api/ministry/schedule?month=) and kept here, so flipping
// back and forth is instant; they are asked again when older than STALE_MS,
// on pull-to-refresh, or after a change anywhere (invalidateMonths).
// ============================================================
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { useSession } from './session';
import type { Lineup, MonthData } from './types';

const STALE_MS = 5 * 60 * 1000;

interface Entry { data: MonthData; at: number }
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;

/** Forget every cached month (after an excuse, swap, lineup change...). */
export function invalidateMonths(): void {
  cache.clear();
  emit();
}

/** A lineup from any month seen so far. */
export function cachedLineup(scheduleId: string): Lineup | null {
  for (const { data } of cache.values()) {
    const found = data.lineups.find((l) => l.scheduleId === scheduleId);
    if (found) return found;
  }
  return null;
}

/**
 * One month: { data, loading, error, reload }. This month is the dashboard's.
 * `data` keeps showing the last month while the next one loads.
 */
export function useMonth(month: string) {
  const { home } = useSession();
  useSyncExternalStore(subscribe, getVersion);
  const fromHome = home?.month && home.month.month === month ? home.month : null;
  const entry = cache.get(month);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<MonthData | null>(fromHome || entry?.data || null);

  const load = useCallback(async (force = false) => {
    const have = cache.get(month);
    if (!force && have && Date.now() - have.at < STALE_MS) { setShown(have.data); return; }
    setLoading(true);
    setError(null);
    const res = await api.month(month);
    setLoading(false);
    if (res.ok) {
      cache.set(month, { data: res.data, at: Date.now() });
      setShown(res.data);
      emit();
    } else {
      setError(res.message);
    }
  }, [month]);

  useEffect(() => {
    if (fromHome) { setShown(fromHome); setError(null); return; }
    const have = cache.get(month);
    if (have) setShown(have.data);
    load();
  }, [month, fromHome, load, entry]);

  const data = fromHome || (entry ? entry.data : null);
  return { data: data || shown, exact: !!data, loading, error, reload: () => load(true) };
}
