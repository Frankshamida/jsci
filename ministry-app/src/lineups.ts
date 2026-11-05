// Reading lineups out of the cached dashboard and the months seen so far.
import { useSession } from './session';
import { cachedLineup } from './months';
import type { HomeData, Lineup, Person } from './types';

export function findLineup(home: HomeData | null, scheduleId: string): Lineup | null {
  if (!home) return null;
  return home.month?.lineups.find((l) => l.scheduleId === scheduleId)
    || home.team.find((l) => l.scheduleId === scheduleId)
    || home.assignments.find((l) => l.scheduleId === scheduleId)
    || cachedLineup(scheduleId);
}

export const useLineup = (scheduleId: string) => findLineup(useSession().home, scheduleId);

export const songCount = (l: Lineup) => l.slowSongs.length + l.fastSongs.length;

// Everyone on a lineup.
export const peopleOn = (l: Lineup): Person[] => [
  ...(l.songLeader ? [l.songLeader] : []), ...l.backupSingers, ...l.musicians, ...l.dancers,
];

// Their upcoming lineups (still on them, not handed to a sub), soonest first.
export const upcomingMine = (home: HomeData) => home.assignments.filter((l) => l.date >= home.today && !l.subbedOut);
