// Attendance by GPS (web/src/app/api/ministry/attendance/route.js).
// The screen's data is kept here between visits, so coming back to the tab
// shows it at once and refreshes quietly behind it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api';

export type SessionType = 'Sunday Service' | 'Practice';

export interface ChurchEvent {
  type: SessionType;
  date: string;          // YYYY-MM-DD, the church's calendar
  time: string | null;   // "7:00 PM" for a practice with a time
  scheduleId: string | null;
}

export interface RosterPerson {
  name: string;
  picture: string | null;
  part: string;          // "Song Leader", "Keyboard", "Media", ...
  here: boolean;
  checkedInAt: string | null;
}

export interface RosterGroup {
  key: 'leader' | 'backup' | 'musicians' | 'dancers' | 'media' | 'others' | string;
  title: string;
  people: RosterPerson[];
}

export interface AttendanceItem {
  id: string;
  date: string;
  status: string;        // Present | Late | Excused | Absent
  sessionType: SessionType | string | null;
  checkedInAt: string | null;
  distanceM: number | null;
  notes: string | null;
}

export interface AttendanceData {
  church: { latitude: number; longitude: number; radiusM: number; name: string };
  today: string;
  event: ChurchEvent | null;
  nextEvent: ChurchEvent | null;
  me: { status: string; checkedInAt: string | null; distanceM: number | null; sessionType: string | null } | null;
  roster: RosterGroup[];
  counts: { here: number; total: number };
  history: AttendanceItem[];
}

// Where the church is. The server checks the distance again on check-in.
export const CHURCH = {
  latitude: 10.319767311613345,
  longitude: 123.8992883502071,
  radiusM: 30,
  name: 'Joyful Sound Church International',
};

// The server's rule (web/src/app/api/ministry/attendance/route.js): within
// 30 m of the church, allowing up to 20 m for the GPS error the phone reports;
// a fix worse than 100 m is too weak to tell.
export const GPS_MARGIN_M = 20;
export const WORST_ACCURACY_M = 100;
export const closeEnough = (distance: number, accuracy: number | null, radiusM = CHURCH.radiusM) =>
  distance - Math.min(Math.max(accuracy || 0, 0), GPS_MARGIN_M) <= radiusM;

export const CHURCH_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${CHURCH.latitude},${CHURCH.longitude}`;
export const CHURCH_STREET_VIEW = 'https://www.google.com/maps/embed?pb=!3m2!1sen!2sph!4v1793867952075!5m2!1sen!2sph!6m8!1m7!1sdo9Akv3QAW6kJETCDEd_HQ!2m2!1d10.31957203889858!2d123.8994707404156!3f239.81294!4f-1.8889599999999973!5f0.7820865974627469';

// Metres between two points on the earth (haversine).
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "25 m", "350 m", "1.2 km", "12 km"
export function distanceText(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export const attendanceApi = {
  load: () => request<AttendanceData>('/api/ministry/attendance'),
  checkIn: (latitude: number, longitude: number, accuracy: number | null) =>
    request<{ record: AttendanceItem }>('/api/ministry/attendance', { method: 'POST', json: { latitude, longitude, accuracy } }),
};

// ---- The screen's data, kept per account ----

let cache: { userId: string; data: AttendanceData; at: number } | null = null;

export function useAttendance(userId: string | undefined) {
  const own = cache && cache.userId === userId ? cache : null;
  const [data, setData] = useState<AttendanceData | null>(own?.data || null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(() => {
    if (!userId) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const run = (async () => {
      const res = await attendanceApi.load();
      if (!alive.current) return;
      if (res.ok) {
        cache = { userId, data: res.data, at: Date.now() };
        setData(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
    })().finally(() => { inFlight.current = null; if (alive.current) setLoading(false); });
    inFlight.current = run;
    return run;
  }, [userId]);

  // Older than this, a visit to the tab refreshes it.
  const isStale = useCallback((ms: number) => !cache || cache.userId !== userId || Date.now() - cache.at > ms, [userId]);

  return { data, error, loading, reload, isStale };
}
