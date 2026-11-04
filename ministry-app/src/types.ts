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
}

export interface Person {
  name: string;
  picture: string | null;
}

export interface Musician extends Person {
  instrument: string;
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
}

export interface Excuse {
  id: string;
  excuse_date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | string;
  role_type: RoleType;
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
