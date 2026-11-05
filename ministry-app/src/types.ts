// Shapes of what /api/ministry/* returns (see web/src/lib/ministryApp.js).

export type RoleType = 'Song Leader' | 'Backup Singer' | 'Instrumentalist' | 'Dancer';

export interface MinistryGroup {
  key: string | null;
  label: string;
  icon: string | null;
  positions: string[];
}

export interface Profile {
  id: string;
  memberId: string | null;
  firstname: string;
  lastname: string;
  fullName: string;
  email: string;
  birthdate: string | null;
  profilePicture: string | null;
  roles: string[];
  ministries: MinistryGroup[];
  coverableRoleTypes: RoleType[];
  ministryKeys: string[];   // 'singer' | 'musician' | 'dancer' | 'media' | 'usher'
  canPlot: boolean;         // Schedule Plotter (or Admin): plots lineups, approves requests
  canEditLyrics: boolean;   // Media team (or Admin): writes song lyrics
}

export interface Person {
  name: string;
  picture: string | null;
  // What is happening to them on this date (month and team lineups carry these)
  excuse?: 'Pending' | 'Approved' | string;  // they filed an excuse
  subRequest?: 'Pending Admin' | 'Open for Sub' | string; // they asked for a substitute
  covering?: string;                          // they are a substitute, for this person
  swap?: string;                              // a swap of this date is waiting
}

export interface Musician extends Person {
  instrument: string;
}

// Somebody a substitute replaced: still shown, greyed out, with who covers them.
export interface CoveredPerson {
  roleType: RoleType | string;
  name: string;
  picture: string | null;
  by: string;
}

export interface Song {
  title: string;
  link: string;
  instructions: string;
}

export interface Lineup {
  scheduleId: string;
  date: string;
  practiceDate: string | null;
  practiceTime: string | null;
  mine: boolean;
  myParts: string[];
  myRoleTypes: RoleType[];
  isSongLeader: boolean;
  subbedOut: boolean;
  songLeader: Person | null;
  originalSongLeader: string | null;
  backupSingers: Person[];
  musicians: Musician[];
  dancers: Person[];
  slowSongs: Song[];
  fastSongs: Song[];
  covered?: CoveredPerson[];
}

// One person's status on one date of the month view.
//   serving    on the lineup
//   rest       a lineup without them (their day off)
//   excused    their excuse was approved
//   covered    a substitute took their part
//   unplotted  no lineup made for that date yet
export type DayState = 'serving' | 'rest' | 'excused' | 'covered' | 'unplotted';
export interface MyDay {
  date: string;
  scheduleId: string | null;
  plotted: boolean;
  parts: string[];
  state: DayState;
  leader: string | null;
  practiceDate: string | null;
  practiceTime: string | null;
  excuse: { id: string; status: string; roleType: string } | null;
  sub: { id: string; status: string; roleType: string; substituteName: string | null } | null;
  covering: string | null;
  swap: { id: string; status: string; part: string; direction: 'give' | 'take'; otherName: string; otherDate: string } | null;
  attendance: string | null;
}

export interface MonthData {
  month: string; // YYYY-MM
  today: string;
  lineups: Lineup[];
  days: MyDay[];
}

// A teammate, for search: their ministry roles and positions.
export interface Member {
  id: string;
  name: string;
  picture: string | null;
  groups: { key: string | null; label: string; positions: string[] }[];
}

export interface MemberHistory extends Member {
  today: string;
  days: MyDay[];   // newest first
  served: number;  // dates served in the last six months
  rests: number;
}

export interface LyricsSection { label: string; content: string }
export interface Lyrics {
  id: string;
  title: string;
  artist: string | null;
  link: string | null;
  sections: LyricsSection[];
  preparedBy: string | null;
  updatedAt: string;
}
export interface LineupLyrics {
  date: string;
  canEdit: boolean;
  songs: { type: 'Fast Song' | 'Slow Song'; title: string; link: string; lyrics: Lyrics | null }[];
}

export interface SwapCandidate {
  part: string;
  date: string;
  scheduleId: string;
  partnerId: string;
  partnerName: string;
  partnerPicture: string | null;
}

export interface Excuse {
  id: string;
  excuse_date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | string;
  role_type: RoleType;
  admin_note?: string | null;
  reviewed_by?: string | null;
  created_at: string;
}

export interface SubRequest {
  id: string;
  date: string;
  scheduleId: string | null;
  roleType: RoleType;
  status: 'Pending Admin' | 'Open for Sub' | 'Accepted' | 'Rejected' | string;
  reason: string;
  requesterId: string;
  requesterName: string;
  substituteId: string | null;
  substituteName: string | null;
  thankYouSent: boolean;
  adminNote?: string | null;
  createdAt?: string;
}

// Two teammates with the same part trade dates (web/src/lib/ministrySwaps.js).
export type SwapStatus = 'Waiting Partner' | 'Pending Approval' | 'Approved' | 'Declined' | 'Rejected' | 'Cancelled';
export interface Swap {
  id: string;
  status: SwapStatus | string;
  part: string;
  roleType: RoleType;
  reason: string;
  requesterId: string;
  requesterName: string;
  requesterDate: string;   // the date the requester gives away
  partnerId: string;
  partnerName: string;
  partnerDate: string;     // the partner's date the requester takes
  partnerNote: string | null;
  adminNote: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  event_date: string;
  status: string;
  notes: string | null;
}

export interface HomeData {
  today: string;
  profile: Profile;
  assignments: Lineup[];
  team: Lineup[];
  excuses: Excuse[];
  substitutes: SubRequest[];
  openSubs: SubRequest[];
  attendance: AttendanceRecord[];
  month?: MonthData;         // this month: its lineups and their status per date
  members?: Member[];        // everyone in the app, for search
  swaps?: Swap[];            // swaps they asked for or were asked
  swapsForMe?: Swap[];       // swaps waiting for their answer
  pendingApprovals?: number; // for plotters: excuses, subs and swaps to review
  latestApp?: LatestApp | null; // the newest JSCI Ministry release, for the update notice
}

export interface LatestApp {
  version: string;
  apkUrl: string;
  fileName: string;
  publishedAt: string;
}

export interface Recording {
  id: string;
  title: string;
  song_type: 'Slow Song' | 'Fast Song' | string;
  google_drive_url: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string;
  file_size_bytes: number | null;
}
