// ============================================================
// Schedule Plotter: the month's lineups and the approvals, from
// /api/ministry/planner and /api/ministry/approvals (web/src/app/api/ministry).
// Months are kept in memory, so flipping back and forth is instant; any change
// forgets them (and the Home month cache) so every screen shows it.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api';
import { invalidateMonths } from './months';
import type { IconName } from './icons';
import type { RoleType, Swap } from './types';

export type InstrumentToken = 'Keyboard' | 'Guitarist' | 'Bass' | 'Drummer';

// The instruments plotted each Sunday (web/src/lib/userRoles.js LINEUP_INSTRUMENTS).
export const INSTRUMENTS: { token: InstrumentToken; label: string; short: string; icon: IconName }[] = [
  { token: 'Keyboard', label: 'Keyboard', short: 'Keys', icon: 'keyboard' },
  { token: 'Guitarist', label: 'Guitar', short: 'Guitar', icon: 'guitar' },
  { token: 'Bass', label: 'Bass', short: 'Bass', icon: 'guitar' },
  { token: 'Drummer', label: 'Drums', short: 'Drums', icon: 'drum' },
];

export interface PlannerPerson {
  id: string;
  name: string;
  picture: string | null;
  instruments?: InstrumentToken[];
}

export interface PlannerLineup {
  scheduleId: string;
  date: string;
  practiceDate: string | null;
  practiceTime: string | null;
  songLeader: string | null;
  backupSingers: string[];
  musicians: Record<InstrumentToken, string[]>;
  dancers: string[];
  songCount: number;
  hasSubstitute: boolean;
}

export interface PlannerExcuse {
  userId: string;
  name: string;
  date: string;
  status: 'Pending' | 'Approved' | string;
  roleType: RoleType;
}

export interface PlannerMonth {
  month: string; // YYYY-MM
  today: string;
  sundays: string[];
  lineups: PlannerLineup[];
  people: {
    songLeaders: PlannerPerson[];
    backupSingers: PlannerPerson[];
    musicians: PlannerPerson[];
    dancers: PlannerPerson[];
  };
  excuses: PlannerExcuse[];
}

// What the editor sends.
export interface LineupInput {
  date: string;
  practiceDate: string | null;
  practiceTime: string;
  songLeader: string;
  backupSingers: string[];
  musicians: Record<InstrumentToken, string[]>;
  dancers: string[];
}

// ---- Approvals ----

export interface PendingRequest {
  id: string;
  userId: string;
  name: string;
  picture: string | null;
  date: string;
  roleType: RoleType;
  reason: string;
  createdAt: string;
  hasLineup: boolean;
  parts: string[]; // their parts on that date's lineup ([] = not on it)
}

export interface PendingSwap extends Swap {
  requesterPicture: string | null;
  partnerPicture: string | null;
  problem: string | null; // why it can no longer happen, if the lineups changed
}

export type ApprovalKind = 'excuse' | 'sub' | 'swap';

export interface DecidedItem {
  kind: ApprovalKind;
  id: string;
  name: string;
  date: string;
  otherDate: string | null;
  partner: string | null;
  part: string;
  status: string;
  reviewedBy: string | null;
  decidedAt: string;
}

export interface Approvals {
  today: string;
  excuses: PendingRequest[];
  subs: PendingRequest[];
  swaps: PendingSwap[];
  recent: DecidedItem[];
}

export const waitingCount = (a: Approvals | null) => (a ? a.excuses.length + a.subs.length + a.swaps.length : 0);

// ---- Calls ----

const FRESH_MS = 60 * 1000;
const months = new Map<string, { at: number; data: PlannerMonth }>();
let approvalsCache: { at: number; data: Approvals } | null = null;

export const peekPlannerMonth = (month: string) => months.get(month)?.data || null;
export const peekApprovals = () => approvalsCache?.data || null;

// Forget everything, after a change (and the Home month cache with it).
export function plannerChanged() {
  months.clear();
  approvalsCache = null;
  invalidateMonths();
}

// One request per month at a time, however many screens ask for it.
const inFlight = new Map<string, ReturnType<typeof fetchMonth>>();
async function fetchMonth(month: string) {
  const res = await request<PlannerMonth>(`/api/ministry/planner?month=${encodeURIComponent(month)}`);
  if (res.ok) months.set(res.data.month, { at: Date.now(), data: res.data });
  return res;
}
export function loadPlannerMonth(month: string) {
  const running = inFlight.get(month);
  if (running) return running;
  const run = fetchMonth(month).finally(() => inFlight.delete(month));
  inFlight.set(month, run);
  return run;
}

// A line for the plotter's screen after the editor closes ("Lineup saved").
let flash: string | null = null;
export const setPlannerFlash = (message: string) => { flash = message; };
export const takePlannerFlash = () => { const m = flash; flash = null; return m; };

// The month holding a lineup (when the editor is opened with just its id).
export async function loadPlannerMonthOf(scheduleId: string) {
  const res = await request<PlannerMonth>(`/api/ministry/planner?scheduleId=${encodeURIComponent(scheduleId)}`);
  if (res.ok) months.set(res.data.month, { at: Date.now(), data: res.data });
  return res;
}

export function findPlannedLineup(scheduleId: string): PlannerLineup | null {
  for (const { data } of months.values()) {
    const found = data.lineups.find((l) => l.scheduleId === scheduleId);
    if (found) return found;
  }
  return null;
}

export const plannerApi = {
  create: (input: LineupInput) => request('/api/ministry/planner', { method: 'POST', json: input }),
  update: (scheduleId: string, input: LineupInput) => request('/api/ministry/planner', { method: 'PUT', json: { scheduleId, ...input } }),
  remove: (scheduleId: string) => request(`/api/ministry/planner?scheduleId=${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }),
  approvals: async () => {
    const res = await request<Approvals>('/api/ministry/approvals');
    if (res.ok) approvalsCache = { at: Date.now(), data: res.data };
    return res;
  },
  decide: (kind: ApprovalKind, id: string, decision: 'approve' | 'reject', note?: string) =>
    request('/api/ministry/approvals', { method: 'PUT', json: { kind, id, decision, note } }),
};

// ---- Hooks ----

// One month for the plotter: shown at once from memory, fetched when missing
// or older than a minute. `reload()` always asks the server.
export function usePlannerMonth(month: string) {
  const [data, setData] = useState<PlannerMonth | null>(() => peekPlannerMonth(month));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(month);
  current.current = month;

  const load = useCallback(async (force = false) => {
    const cached = months.get(month);
    if (cached) setData(cached.data);
    if (!force && cached && Date.now() - cached.at < FRESH_MS) return;
    setLoading(true);
    const res = await loadPlannerMonth(month);
    if (current.current !== month) return; // moved on to another month meanwhile
    setLoading(false);
    if (res.ok) { setData(res.data); setError(null); } else setError(res.message);
  }, [month]);

  useEffect(() => { load(); }, [load]);
  return { data: data && data.month === month ? data : null, anyData: data, loading, error, reload: () => load(true), load };
}

export function useApprovals() {
  const [data, setData] = useState<Approvals | null>(peekApprovals);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && approvalsCache && Date.now() - approvalsCache.at < FRESH_MS) { setData(approvalsCache.data); return; }
    setLoading(true);
    const res = await plannerApi.approvals();
    setLoading(false);
    if (res.ok) { setData(res.data); setError(null); } else setError(res.message);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, setData, loading, error, reload: () => load(true), load };
}

// ---- Small helpers for the screens ----

const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (date: string) => date.slice(0, 7);
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

// "Frank", or "Frank G." when two people on the team share a first name.
export function shortNamer(people: PlannerPerson[]) {
  const counts = new Map<string, number>();
  people.forEach((p) => { const f = p.name.split(' ')[0].toLowerCase(); counts.set(f, (counts.get(f) || 0) + 1); });
  return (name: string) => {
    const parts = name.trim().split(' ');
    const f = parts[0];
    return (counts.get(f.toLowerCase()) || 0) > 1 && parts.length > 1 ? `${f} ${parts[parts.length - 1][0]}.` : f;
  };
}

// Everyone the plotter can put on a lineup, once each.
export function allPeople(m: PlannerMonth | null): PlannerPerson[] {
  if (!m) return [];
  const seen = new Map<string, PlannerPerson>();
  [...m.people.songLeaders, ...m.people.backupSingers, ...m.people.musicians, ...m.people.dancers].forEach((p) => {
    if (!seen.has(p.id)) seen.set(p.id, p);
  });
  return [...seen.values()];
}
