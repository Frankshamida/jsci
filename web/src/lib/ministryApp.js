// ============================================================
// JSCI Ministry app - what the app shows, shaped on the server
// One request (/api/ministry/home) carries everything the dashboard needs,
// so the phone makes one call when it opens instead of six, and caches it.
// ============================================================
import { getUserRoles, splitSubRole } from '@/lib/permissions';
import { describeRoleDetails, lineupParts, LINEUP_INSTRUMENTS } from '@/lib/userRoles';
import { fullNameOf } from '@/lib/ministryAuth';

// A part on a lineup -> the role_type its excuses and sub requests use.
export const ROLE_TYPE_OF_PART = { 'Song Leader': 'Song Leader', 'Backup Singer': 'Backup Singer', Dancer: 'Dancer' };
LINEUP_INSTRUMENTS.forEach(({ label }) => { ROLE_TYPE_OF_PART[label] = 'Instrumentalist'; });

// The role_types somebody can cover as a substitute, from their positions.
export function coverableRoleTypes(subRole) {
  const tokens = splitSubRole(subRole);
  const out = [];
  if (tokens.includes('Song Leaders')) out.push('Song Leader');
  if (tokens.includes('Backup Singer')) out.push('Backup Singer');
  if (tokens.some((t) => /^instrumentalists?$/i.test(t))) out.push('Instrumentalist');
  if (tokens.some((t) => /dancer/i.test(t))) out.push('Dancer');
  return out;
}

export function ministryProfile(user) {
  return {
    id: user.id,
    memberId: user.member_id,
    firstname: user.firstname,
    lastname: user.lastname,
    fullName: fullNameOf(user),
    email: user.email,
    birthdate: user.birthdate || null,
    profilePicture: user.profile_picture || null,
    roles: getUserRoles(user),
    // "Singer (PAW)" with "Song Leader", ... - as on the website's profile
    ministries: describeRoleDetails(user).map(({ key, label, icon, chips }) => ({ key: key || null, label, icon, positions: chips })),
    coverableRoleTypes: coverableRoleTypes(user.sub_role),
  };
}

const person = (name, pictures) => ({ name, picture: pictures[String(name).toLowerCase()] || null });

/**
 * One lineup as the app reads it. `mine` is set when `user` is on it.
 * @param {object} s - a schedules row
 * @param {Record<string,string>} pictures - lower-case full name -> picture url
 */
export function shapeLineup(s, user, pictures) {
  const me = fullNameOf(user).toLowerCase();
  const parts = lineupParts({ songLeader: s.song_leader, backupSingers: s.backup_singers, musicians: s.musicians, dancers: s.dancers });
  const myParts = parts[me]?.parts || [];
  const subbedOut = (s.original_song_leader || '').toLowerCase() === me;
  return {
    scheduleId: s.schedule_id,
    date: s.schedule_date,
    practiceDate: s.practice_date || null,
    practiceTime: s.practice_time || null,
    mine: myParts.length > 0 || subbedOut,
    myParts,
    myRoleTypes: [...new Set(myParts.map((p) => ROLE_TYPE_OF_PART[p]).filter(Boolean))],
    isSongLeader: myParts.includes('Song Leader'),
    subbedOut,
    songLeader: s.song_leader ? person(s.song_leader, pictures) : null,
    originalSongLeader: s.original_song_leader || null,
    backupSingers: (s.backup_singers || []).map((n) => person(n, pictures)),
    musicians: LINEUP_INSTRUMENTS.flatMap(({ token, label }) => (s.musicians?.[token] || []).map((n) => ({ ...person(n, pictures), instrument: label }))),
    dancers: (s.dancers || []).map((n) => person(n, pictures)),
    slowSongs: s.slow_songs || [],
    fastSongs: s.fast_songs || [],
  };
}
