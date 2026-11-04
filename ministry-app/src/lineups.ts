// Reading lineups out of the cached dashboard.
import { useSession } from './session';
import type { HomeData, Lineup } from './types';

export function findLineup(home: HomeData | null, scheduleId: string): Lineup | null {
  if (!home) return null;
  return home.assignments.find((l) => l.scheduleId === scheduleId) || home.team.find((l) => l.scheduleId === scheduleId) || null;
}

export const useLineup = (scheduleId: string) => findLineup(useSession().home, scheduleId);

export const songCount = (l: Lineup) => l.slowSongs.length + l.fastSongs.length;

// Their upcoming lineups (still on them, not handed to a sub), soonest first.
export const upcomingMine = (home: HomeData) => home.assignments.filter((l) => l.date >= home.today && !l.subbedOut);
