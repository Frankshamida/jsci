// ============================================
// ROLE-BASED ACCESS CONTROL (RBAC) SYSTEM
// Based on Appendix R: List of Modules
// 50 Modules across 6 User Roles
// ============================================

export const ROLES = {
  GUEST: 'Guest',
  CHURCH_MEMBER: 'Church Member',
  MINISTRY_MEMBER: 'Ministry Member',
  PASTOR: 'Pastor',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
};

// Every role an account can hold, lowest to highest. This is the order of
// every role picker, and the list users.role is checked against.
export const ASSIGNABLE_ROLES = [
  ROLES.GUEST, ROLES.CHURCH_MEMBER, ROLES.MINISTRY_MEMBER,
  ROLES.PASTOR, ROLES.ADMIN, ROLES.SUPER_ADMIN,
];

// Roles retired by migrations/user_roles_restructure.sql. Member became
// Church Member (or Ministry Member when they had a ministry); Song Leader
// and Leader became Ministry Member, their extra reach now coming from the
// position they hold (see LEAD_POSITIONS). Kept so an account the migration
// has not reached, or a session cached before it ran, keeps what it had.
export const LEGACY_ROLES = {
  MEMBER: 'Member',
  SONG_LEADER: 'Song Leader',
  LEADER: 'Leader',
};

// sub_role spellings for the positions that lead a ministry team. 'Song
// Leaders' is plural because that is what the lineup screens have always
// matched (sub_role ILIKE '%Song Leaders%'); see lib/userRoles.js.
export const SONG_LEADER_POSITION = 'Song Leaders';
export const LEAD_POSITIONS = [SONG_LEADER_POSITION, 'Music Director', 'Head Dancer', 'Media Head', 'Head Usher'];
// The Schedule Plotter switch in Ministry Roles: plots the monthly lineup.
export const SCHEDULE_PLOTTER_POSITION = 'Schedule Plotter';

/**
 * Every role an account holds: its main role (users.role) first, then the
 * ones a Super Admin added on top (users.additional_roles).
 * @param {{ role?: string, additional_roles?: string[] }} user
 * @returns {string[]}
 */
export function getUserRoles(user) {
  return [...new Set([user?.role, ...(user?.additional_roles || [])].filter(Boolean))];
}

// Where a retired role sits among ASSIGNABLE_ROLES, for ranking.
const LEGACY_RANK = { [LEGACY_ROLES.MEMBER]: 1, [LEGACY_ROLES.SONG_LEADER]: 2, [LEGACY_ROLES.LEADER]: 2 };
export const roleRank = (role) => (ASSIGNABLE_ROLES.includes(role) ? ASSIGNABLE_ROLES.indexOf(role) : LEGACY_RANK[role] ?? 0);

/**
 * The highest role an account holds. It picks the dashboard, the sidebar and
 * the Permissions Control toggles; what the account may do is the union of
 * all its roles (pass getUserRoles() to hasPermission). User Management keeps
 * it in users.role (see arrangeRoles in lib/userRoles.js).
 * @returns {string}
 */
export function getEffectiveRole(user) {
  const roles = getUserRoles(user);
  if (roles.length === 0) return ROLES.GUEST;
  return roles.reduce((best, r) => (roleRank(r) > roleRank(best) ? r : best));
}

/**
 * sub_role is a comma-separated list ("Song Leaders, Backup Singer").
 * @param {string} subRole
 * @returns {string[]}
 */
export function splitSubRole(subRole) {
  return String(subRole || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// All 50 modules organized by category
export const MODULES = {
  // === PUBLIC ACCESS (No login required) ===
  VIEW_HOMEPAGE: 'view_homepage',
  VIEW_BIBLE_VERSE: 'view_bible_verse',
  VIEW_PUBLIC_ANNOUNCEMENTS: 'view_public_announcements',
  VIEW_PUBLIC_EVENTS: 'view_public_events',
  VIEW_PUBLIC_COMMUNITY: 'view_public_community',
  SIGN_UP: 'sign_up',
  LOGIN: 'login',

  // === MINISTRY DASHBOARD (Church Members, Ministry Members) ===
  VIEW_MINISTRY_DASHBOARD: 'view_ministry_dashboard',
  VIEW_NOTIFICATIONS: 'view_notifications',
  VIEW_BIBLE_VERSES: 'view_bible_verses',

  // === PROFILE MANAGEMENT ===
  VIEW_PROFILE: 'view_profile',
  UPDATE_PROFILE: 'update_profile',
  CHANGE_PASSWORD: 'change_password',

  // === MINISTRY SCHEDULE ===
  VIEW_SCHEDULE: 'view_schedule',
  VIEW_ASSIGNED_TASKS: 'view_assigned_tasks',
  MARK_ATTENDANCE_SELF: 'mark_attendance_self',

  // === MINISTRY MEETINGS ===
  VIEW_MINISTRY_MEETINGS: 'view_ministry_meetings',
  CREATE_MINISTRY_MEETING: 'create_ministry_meeting',
  UPDATE_MINISTRY_MEETING: 'update_ministry_meeting',
  RSVP_MEETING: 'rsvp_meeting',

  // === EVENTS & ANNOUNCEMENTS ===
  VIEW_EVENTS: 'view_events',
  VIEW_ANNOUNCEMENTS: 'view_announcements',
  RSVP_EVENT: 'rsvp_event',

  // === COMMUNICATION ===
  VIEW_MESSAGES: 'view_messages',
  SEND_MESSAGES: 'send_messages',
  SEND_UPDATES_PASTORS: 'send_updates_pastors',

  // === COMMUNITY HUB / NEWS FEED ===
  VIEW_COMMUNITY_POSTS: 'view_community_posts',
  CREATE_POSTS: 'create_posts',
  LIKE_COMMENT_POSTS: 'like_comment_posts',

  // === SONG LINEUP MANAGEMENT (Song Leader position only) ===
  CREATE_SONG_LIST: 'create_song_list',
  ADD_REMOVE_SONGS: 'add_remove_songs',
  UPDATE_SONG_LINEUP: 'update_song_lineup',
  ASSIGN_SINGERS: 'assign_singers',
  // Plot the monthly lineup: who leads and who sings backup on each date
  // (Admin, and a Ministry Member with the Schedule Plotter switch on).
  PLAN_LINEUP: 'plan_lineup',

  // === REPORTS & LOGOUT ===
  VIEW_PERSONAL_REPORTS: 'view_personal_reports',
  VIEW_MINISTRY_REPORTS: 'view_ministry_reports',
  LOGOUT: 'logout',

  // === PASTOR MODULES ===
  VIEW_PASTOR_DASHBOARD: 'view_pastor_dashboard',
  VIEW_ANALYTICS: 'view_analytics',
  VIEW_ALL_MINISTRIES: 'view_all_ministries',
  VIEW_MINISTRY_MEMBERS: 'view_ministry_members',
  ASSIGN_MEMBERS_MINISTRY: 'assign_members_ministry',
  CREATE_MINISTRY_SCHEDULE: 'create_ministry_schedule',
  UPDATE_MINISTRY_SCHEDULE: 'update_ministry_schedule',
  CREATE_EVENTS: 'create_events',
  UPDATE_EVENTS: 'update_events',
  DELETE_EVENTS: 'delete_events',
  VIEW_EVENT_PARTICIPANTS: 'view_event_participants',
  CREATE_ANNOUNCEMENTS: 'create_announcements',
  UPDATE_ANNOUNCEMENTS: 'update_announcements',
  DELETE_ANNOUNCEMENTS: 'delete_announcements',
  VIEW_ATTENDANCE: 'view_attendance',
  MARK_ATTENDANCE: 'mark_attendance',
  UPDATE_ATTENDANCE: 'update_attendance',
  DELETE_ATTENDANCE: 'delete_attendance',
  SEND_BROADCASTS: 'send_broadcasts',
  VIEW_ALL_POSTS: 'view_all_posts',
  PIN_POSTS: 'pin_posts',
  VIEW_MINISTRY_UPDATES: 'view_ministry_updates',
  GENERATE_REPORTS: 'generate_reports',
  EXPORT_REPORTS: 'export_reports',

  // === ADMIN MODULES ===
  VIEW_ADMIN_DASHBOARD: 'view_admin_dashboard',
  VIEW_SYSTEM_ANALYTICS: 'view_system_analytics',
  CREATE_USERS: 'create_users',
  VIEW_USERS: 'view_users',
  UPDATE_USERS: 'update_users',
  DEACTIVATE_USERS: 'deactivate_users',
  ACTIVATE_USERS: 'activate_users',
  RESET_PASSWORDS: 'reset_passwords',
  CREATE_MINISTRY: 'create_ministry',
  VIEW_MINISTRY: 'view_ministry',
  UPDATE_MINISTRY: 'update_ministry',
  DELETE_MINISTRY: 'delete_ministry',
  ASSIGN_USERS_MINISTRY: 'assign_users_ministry',

  // === SUPER ADMIN MODULES ===
  VIEW_SUPER_ADMIN_DASHBOARD: 'view_super_admin_dashboard',
  VIEW_COMPLETE_ANALYTICS: 'view_complete_analytics',
  MANAGE_BIBLE_VERSES_API: 'manage_bible_verses_api',
  DELETE_USERS: 'delete_users',
  ASSIGN_USER_ROLES: 'assign_user_roles',
  CREATE_ROLES: 'create_roles',
  VIEW_ROLES: 'view_roles',
  UPDATE_ROLES: 'update_roles',
  DELETE_ROLES: 'delete_roles',
  ASSIGN_PERMISSIONS: 'assign_permissions',
  ASSIGN_MINISTRY_LEADERS: 'assign_ministry_leaders',
  VIEW_UPDATE_SETTINGS: 'view_update_settings',
  CONFIGURE_EMAIL_API: 'configure_email_api',
  MANAGE_THEME_BRANDING: 'manage_theme_branding',
  BACKUP_RESTORE_DB: 'backup_restore_db',
  VIEW_DB_STATISTICS: 'view_db_statistics',
  VIEW_ACTIVITY_LOGS: 'view_activity_logs',
  SECURITY_SETTINGS: 'security_settings',
  FULL_EVENTS_CONTROL: 'full_events_control',
  CUSTOM_REPORTS: 'custom_reports',
  EXPORT_ALL_DATA: 'export_all_data',

  // === RECORDINGS (Google Drive) ===
  VIEW_RECORDINGS: 'view_recordings',
  UPLOAD_RECORDINGS: 'upload_recordings',
  EDIT_RECORDINGS: 'edit_recordings',
  DELETE_RECORDINGS: 'delete_recordings',

  // === USER EVENT CREATION MODULES ===
  CREATE_USER_EVENTS: 'create_user_events',
  VIEW_USER_EVENTS: 'view_user_events',
  EDIT_USER_EVENTS: 'edit_user_events',
  DELETE_USER_EVENTS: 'delete_user_events',
  VIEW_USER_EVENT_RSVPS: 'view_user_event_rsvps',
  MANAGE_USER_EVENT_PERMISSIONS: 'manage_user_event_permissions',
  VIEW_ALL_USER_EVENTS: 'view_all_user_events',
};

// What every church member gets: Church Members, and Ministry Members before
// any position they hold is counted.
const MEMBER_PERMISSIONS = [
  // Public Access
  MODULES.VIEW_HOMEPAGE, MODULES.VIEW_BIBLE_VERSE, MODULES.VIEW_PUBLIC_ANNOUNCEMENTS,
  MODULES.VIEW_PUBLIC_EVENTS, MODULES.VIEW_PUBLIC_COMMUNITY, MODULES.LOGIN,
  // Ministry Dashboard
  MODULES.VIEW_MINISTRY_DASHBOARD, MODULES.VIEW_NOTIFICATIONS, MODULES.VIEW_BIBLE_VERSES,
  // Profile Management
  MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.CHANGE_PASSWORD,
  // Recordings
  MODULES.VIEW_RECORDINGS,
  // Ministry Schedule
  MODULES.VIEW_SCHEDULE, MODULES.VIEW_ASSIGNED_TASKS, MODULES.MARK_ATTENDANCE_SELF,
  // Ministry Meetings (View & RSVP only)
  MODULES.VIEW_MINISTRY_MEETINGS, MODULES.RSVP_MEETING,
  // Events & Announcements
  MODULES.VIEW_EVENTS, MODULES.VIEW_ANNOUNCEMENTS, MODULES.RSVP_EVENT,
  // Communication (View & Send only)
  MODULES.VIEW_MESSAGES, MODULES.SEND_MESSAGES,
  // Community Hub
  MODULES.VIEW_COMMUNITY_POSTS, MODULES.CREATE_POSTS, MODULES.LIKE_COMMENT_POSTS,
  // Reports & Logout
  MODULES.VIEW_PERSONAL_REPORTS, MODULES.LOGOUT,
];

// What the retired Leader role added: a Ministry Member holding any of
// LEAD_POSITIONS gets it.
const TEAM_LEAD_PERMISSIONS = [
  MODULES.CREATE_MINISTRY_MEETING, MODULES.UPDATE_MINISTRY_MEETING,
  MODULES.SEND_UPDATES_PASTORS, MODULES.VIEW_MINISTRY_REPORTS,
];

// What the retired Song Leader role added on top: running the song lineup.
const SONG_LEADER_PERMISSIONS = [
  MODULES.CREATE_SONG_LIST, MODULES.ADD_REMOVE_SONGS, MODULES.UPDATE_SONG_LINEUP, MODULES.ASSIGN_SINGERS,
  MODULES.UPLOAD_RECORDINGS,
];

function positionPermissions(subRole) {
  const positions = splitSubRole(subRole);
  const granted = [];
  if (positions.some((p) => LEAD_POSITIONS.includes(p))) granted.push(...TEAM_LEAD_PERMISSIONS);
  if (positions.includes(SONG_LEADER_POSITION)) granted.push(...SONG_LEADER_PERMISSIONS);
  if (positions.includes(SCHEDULE_PLOTTER_POSITION)) granted.push(MODULES.PLAN_LINEUP);
  return granted;
}

// Role → Module access mapping (from Appendix R)
export const ROLE_PERMISSIONS = {
  [ROLES.GUEST]: [
    // Public Access
    MODULES.VIEW_HOMEPAGE, MODULES.VIEW_BIBLE_VERSE, MODULES.VIEW_PUBLIC_ANNOUNCEMENTS,
    MODULES.VIEW_PUBLIC_EVENTS, MODULES.VIEW_PUBLIC_COMMUNITY, MODULES.LOGIN,
    // Limited Dashboard
    MODULES.VIEW_MINISTRY_DASHBOARD,
    // Profile Management
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.CHANGE_PASSWORD,
    // Events (view & RSVP)
    MODULES.VIEW_EVENTS, MODULES.RSVP_EVENT,
    // NOTE: no Community Hub modules. The hub is for the church body, not for
    // visitors, so a Guest gets neither the feed nor posting. See
    // GUEST_BLOCKED_SECTIONS below, which keeps the section itself unreachable.
    // Logout
    MODULES.LOGOUT,
  ],

  [ROLES.CHURCH_MEMBER]: MEMBER_PERMISSIONS,

  // Position-based extras are added in hasPermission(), from the sub_role.
  [ROLES.MINISTRY_MEMBER]: MEMBER_PERMISSIONS,

  // --- Retired roles (see LEGACY_ROLES), unchanged ---
  [LEGACY_ROLES.MEMBER]: MEMBER_PERMISSIONS,

  [LEGACY_ROLES.SONG_LEADER]: [
    // All Member permissions
    MODULES.VIEW_HOMEPAGE, MODULES.VIEW_BIBLE_VERSE, MODULES.VIEW_PUBLIC_ANNOUNCEMENTS,
    MODULES.VIEW_PUBLIC_EVENTS, MODULES.VIEW_PUBLIC_COMMUNITY, MODULES.LOGIN,
    MODULES.VIEW_MINISTRY_DASHBOARD, MODULES.VIEW_NOTIFICATIONS, MODULES.VIEW_BIBLE_VERSES,
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.CHANGE_PASSWORD,
    MODULES.VIEW_SCHEDULE, MODULES.VIEW_ASSIGNED_TASKS, MODULES.MARK_ATTENDANCE_SELF,
    MODULES.VIEW_MINISTRY_MEETINGS, MODULES.RSVP_MEETING,
    MODULES.VIEW_EVENTS, MODULES.VIEW_ANNOUNCEMENTS, MODULES.RSVP_EVENT,
    MODULES.VIEW_MESSAGES, MODULES.SEND_MESSAGES,
    MODULES.VIEW_COMMUNITY_POSTS, MODULES.CREATE_POSTS, MODULES.LIKE_COMMENT_POSTS,
    MODULES.VIEW_PERSONAL_REPORTS, MODULES.LOGOUT,
    // Additional Song Leader permissions
    MODULES.CREATE_MINISTRY_MEETING, MODULES.UPDATE_MINISTRY_MEETING,
    MODULES.SEND_UPDATES_PASTORS,
    MODULES.CREATE_SONG_LIST, MODULES.ADD_REMOVE_SONGS, MODULES.UPDATE_SONG_LINEUP, MODULES.ASSIGN_SINGERS,
    MODULES.VIEW_MINISTRY_REPORTS,
    // Recordings
    MODULES.VIEW_RECORDINGS, MODULES.UPLOAD_RECORDINGS,
  ],

  [LEGACY_ROLES.LEADER]: [
    // All Member permissions
    MODULES.VIEW_HOMEPAGE, MODULES.VIEW_BIBLE_VERSE, MODULES.VIEW_PUBLIC_ANNOUNCEMENTS,
    MODULES.VIEW_PUBLIC_EVENTS, MODULES.VIEW_PUBLIC_COMMUNITY, MODULES.LOGIN,
    MODULES.VIEW_MINISTRY_DASHBOARD, MODULES.VIEW_NOTIFICATIONS, MODULES.VIEW_BIBLE_VERSES,
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.CHANGE_PASSWORD,
    MODULES.VIEW_SCHEDULE, MODULES.VIEW_ASSIGNED_TASKS, MODULES.MARK_ATTENDANCE_SELF,
    MODULES.VIEW_MINISTRY_MEETINGS, MODULES.RSVP_MEETING,
    MODULES.VIEW_EVENTS, MODULES.VIEW_ANNOUNCEMENTS, MODULES.RSVP_EVENT,
    MODULES.VIEW_MESSAGES, MODULES.SEND_MESSAGES,
    MODULES.VIEW_COMMUNITY_POSTS, MODULES.CREATE_POSTS, MODULES.LIKE_COMMENT_POSTS,
    MODULES.VIEW_PERSONAL_REPORTS, MODULES.LOGOUT,
    // Additional Leader permissions
    MODULES.CREATE_MINISTRY_MEETING, MODULES.UPDATE_MINISTRY_MEETING,
    MODULES.SEND_UPDATES_PASTORS,
    MODULES.VIEW_MINISTRY_REPORTS,
  ],

  [ROLES.PASTOR]: [
    // Pastor Dashboard
    MODULES.VIEW_PASTOR_DASHBOARD, MODULES.VIEW_ANALYTICS, MODULES.VIEW_BIBLE_VERSES,
    // Ministry Oversight
    MODULES.VIEW_ALL_MINISTRIES, MODULES.VIEW_MINISTRY_MEMBERS,
    MODULES.ASSIGN_MEMBERS_MINISTRY, MODULES.CREATE_MINISTRY_SCHEDULE, MODULES.UPDATE_MINISTRY_SCHEDULE,
    // Events: view only (create/edit/delete are Admin & Super Admin only)
    MODULES.VIEW_EVENTS, MODULES.VIEW_EVENT_PARTICIPANTS,
    // Announcements Management
    MODULES.CREATE_ANNOUNCEMENTS, MODULES.VIEW_ANNOUNCEMENTS,
    MODULES.UPDATE_ANNOUNCEMENTS, MODULES.DELETE_ANNOUNCEMENTS,
    // Attendance Management
    MODULES.VIEW_ATTENDANCE, MODULES.MARK_ATTENDANCE, MODULES.UPDATE_ATTENDANCE, MODULES.DELETE_ATTENDANCE,
    // Communication
    MODULES.SEND_BROADCASTS, MODULES.VIEW_MESSAGES, MODULES.SEND_MESSAGES,
    // Community Hub Extended
    MODULES.VIEW_ALL_POSTS, MODULES.PIN_POSTS, MODULES.VIEW_MINISTRY_UPDATES,
    MODULES.VIEW_COMMUNITY_POSTS, MODULES.CREATE_POSTS, MODULES.LIKE_COMMENT_POSTS,
    // Reports & Profile
    MODULES.GENERATE_REPORTS, MODULES.EXPORT_REPORTS,
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.LOGOUT,
    // Recordings
    MODULES.VIEW_RECORDINGS, MODULES.UPLOAD_RECORDINGS, MODULES.EDIT_RECORDINGS, MODULES.DELETE_RECORDINGS,
    // Events & Schedule view
    MODULES.VIEW_EVENTS, MODULES.VIEW_SCHEDULE,
    // User Events oversight
    MODULES.VIEW_ALL_USER_EVENTS, MODULES.VIEW_USER_EVENT_RSVPS,
    MODULES.EDIT_USER_EVENTS, MODULES.DELETE_USER_EVENTS,
  ],

  [ROLES.ADMIN]: [
    // Admin Dashboard
    MODULES.VIEW_ADMIN_DASHBOARD, MODULES.VIEW_SYSTEM_ANALYTICS, MODULES.VIEW_BIBLE_VERSES,
    // User Management
    MODULES.CREATE_USERS, MODULES.VIEW_USERS, MODULES.UPDATE_USERS,
    MODULES.DEACTIVATE_USERS, MODULES.ACTIVATE_USERS, MODULES.RESET_PASSWORDS,
    // Ministry Management
    MODULES.CREATE_MINISTRY, MODULES.VIEW_MINISTRY, MODULES.UPDATE_MINISTRY,
    MODULES.DELETE_MINISTRY, MODULES.ASSIGN_USERS_MINISTRY,
    // Events Management
    MODULES.CREATE_EVENTS, MODULES.VIEW_EVENTS, MODULES.UPDATE_EVENTS, MODULES.DELETE_EVENTS,
    // Announcements Management
    MODULES.CREATE_ANNOUNCEMENTS, MODULES.VIEW_ANNOUNCEMENTS,
    MODULES.UPDATE_ANNOUNCEMENTS, MODULES.DELETE_ANNOUNCEMENTS,
    // Attendance Management
    MODULES.VIEW_ATTENDANCE, MODULES.MARK_ATTENDANCE, MODULES.UPDATE_ATTENDANCE, MODULES.DELETE_ATTENDANCE,
    // Song Lineup Management (Admin can create/manage all lineups)
    MODULES.CREATE_SONG_LIST, MODULES.ADD_REMOVE_SONGS, MODULES.UPDATE_SONG_LINEUP, MODULES.ASSIGN_SINGERS,
    MODULES.PLAN_LINEUP,
    // Recordings
    MODULES.VIEW_RECORDINGS, MODULES.UPLOAD_RECORDINGS, MODULES.EDIT_RECORDINGS, MODULES.DELETE_RECORDINGS,
    // User Event Permissions Management
    MODULES.MANAGE_USER_EVENT_PERMISSIONS, MODULES.VIEW_ALL_USER_EVENTS,
    MODULES.VIEW_USER_EVENT_RSVPS, MODULES.EDIT_USER_EVENTS, MODULES.DELETE_USER_EVENTS,
    // Reports, Communication & Profile
    MODULES.GENERATE_REPORTS, MODULES.VIEW_PERSONAL_REPORTS, MODULES.EXPORT_REPORTS,
    MODULES.SEND_BROADCASTS, MODULES.VIEW_MESSAGES, MODULES.SEND_MESSAGES,
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.LOGOUT,
    MODULES.VIEW_SCHEDULE,
  ],

  [ROLES.SUPER_ADMIN]: [
    // Super Admin has ALL permissions
    'all',
  ],
};

/**
 * Check if a user has access to a specific module
 * @param {string|string[]} userRole - The user's role, or every role they
 *   hold (getUserRoles); with several, any one of them is enough.
 * @param {string} module - The module constant to check
 * @param {string} [subRole] - The user's sub_role. A Ministry Member's reach
 *   also depends on the position they hold (Song Leader, Head Usher, ...).
 * @returns {boolean}
 */
export function hasPermission(userRole, module, subRole) {
  if (Array.isArray(userRole)) return userRole.some((r) => hasPermission(r, module, subRole));
  if (!userRole || !module) return false;
  if (userRole === ROLES.SUPER_ADMIN) return true;

  const permissions = ROLE_PERMISSIONS[userRole];
  if (!permissions) return false;
  if (permissions.includes('all')) return true;
  if (permissions.includes(module)) return true;

  return userRole === ROLES.MINISTRY_MEMBER && positionPermissions(subRole).includes(module);
}

/**
 * Check if user has any of the given permissions
 * @param {string} userRole
 * @param {string[]} modules
 * @param {string} [subRole]
 * @returns {boolean}
 */
export function hasAnyPermission(userRole, modules, subRole) {
  if (!userRole || !modules?.length) return false;
  return modules.some(m => hasPermission(userRole, m, subRole));
}

/**
 * Get the dashboard type for a role
 * @param {string} role
 * @returns {string}
 */
export function getDashboardType(role) {
  switch (role) {
    case ROLES.SUPER_ADMIN: return 'super-admin';
    case ROLES.ADMIN: return 'admin';
    case ROLES.PASTOR: return 'pastor';
    case ROLES.GUEST: return 'guest';
    default: return 'ministry'; // Church Member, Ministry Member (and the retired Member, Song Leader, Leader)
  }
}

/**
 * Get sidebar menu items based on user role. For anyone but a Super Admin
 * this is every item there is; filter it with canAccessSection().
 * @param {string} role - the account's highest role (getEffectiveRole)
 * @returns {Array}
 */
export function getSidebarMenu(role) {
  // Super Admin: full admin menu with system management items
  if (getDashboardType(role) === 'super-admin') {
    return [
      { id: 'home', icon: 'fas fa-tachometer-alt', label: 'Dashboard', section: 'home' },
      { id: 'users', icon: 'fas fa-users-cog', label: 'User Management', section: 'user-management' },
      { id: 'roles', icon: 'fas fa-shield-alt', label: 'Roles & Permissions', section: 'roles-permissions' },
      { id: 'ministries', icon: 'fas fa-church', label: 'Ministry Management', section: 'ministry-management' },
      { id: 'schedule', icon: 'fas fa-calendar-week', label: 'Weekly Schedule', section: 'weekly-schedule' },
      { id: 'praise-worship', icon: 'fas fa-hands-praying', label: 'Praise & Worship', section: 'praise-worship' },
      { id: 'song-playlist', icon: 'fas fa-compact-disc', label: 'Song Playlist', section: 'song-playlist' },
      { id: 'lineup', icon: 'fas fa-music', label: 'Assign Lineup', section: 'create-lineup' },
      { id: 'meetings', icon: 'fas fa-handshake', label: 'Ministry Meetings', section: 'ministry-meetings' },
      { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events-management' },
      { id: 'community-events', icon: 'fas fa-calendar-day', label: 'Community Events', section: 'community-events' },
      { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements-management' },
      { id: 'attendance', icon: 'fas fa-clipboard-check', label: 'Attendance', section: 'attendance-management' },
      { id: 'rfid', icon: 'fas fa-id-card', label: 'Events RFID', section: 'rfid-reader' },
      { id: 'accommodation', icon: 'fas fa-bed', label: 'Accommodation', section: 'accommodation' },
      { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
      { id: 'live-stream-mgmt', icon: 'fas fa-broadcast-tower', label: 'Live Streams', section: 'live-stream-management' },
      { id: 'recordings', icon: 'fas fa-microphone-alt', label: 'Recordings', section: 'recordings' },
      { id: 'messages', icon: 'fas fa-envelope', label: 'Chat', section: 'messages' },
      { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
      { id: 'permissions-control', icon: 'fas fa-toggle-on', label: 'Permissions Control', section: 'permissions-control' },
      { id: 'system', icon: 'fas fa-cogs', label: 'System Config', section: 'system-config' },
      { id: 'isom', icon: 'fas fa-graduation-cap', label: 'ISOM Management', section: 'isom-management' },
      { id: 'isom-inquiries', icon: 'fas fa-user-graduate', label: 'ISOM Inquiries', section: 'isom-inquiries' },
      { id: 'payment-methods', icon: 'fas fa-money-check-dollar', label: 'Mode of Payment', section: 'payment-methods' },
      { id: 'terms-conditions', icon: 'fas fa-file-contract', label: 'Terms & Conditions', section: 'terms-conditions' },
      { id: 'audit', icon: 'fas fa-history', label: 'Audit Logs', section: 'audit-logs' },
      { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
      { id: 'assistant', icon: 'fas fa-robot', label: 'Spiritual Assistant', section: 'spiritual-assistant' },
      { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
    ];
  }

  // ============================================
  // EVERY OTHER ROLE
  // The full list a non-Super-Admin could ever have. Who actually sees each
  // item is strict and by role: SECTION_ACCESS below, applied with
  // canAccessSection(). Permissions Control can then hide more, never add.
  // ============================================
  return [
    { id: 'home', icon: 'fas fa-home', label: 'Home', section: 'home' },
    { id: 'schedule', icon: 'fas fa-calendar-week', label: 'Weekly Schedule', section: 'weekly-schedule' },
    { id: 'praise-worship', icon: 'fas fa-hands-praying', label: 'Praise & Worship', section: 'praise-worship' },
    { id: 'song-playlist', icon: 'fas fa-compact-disc', label: 'Song Playlist', section: 'song-playlist' },
    { id: 'lineup', icon: 'fas fa-music', label: 'Assign Lineup', section: 'create-lineup' },
    { id: 'meetings', icon: 'fas fa-handshake', label: 'Ministry Meetings', section: 'ministry-meetings' },
    { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events' },
    { id: 'community-events', icon: 'fas fa-calendar-day', label: 'Community Events', section: 'community-events' },
    { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements' },
    { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
    { id: 'live-stream-mgmt', icon: 'fas fa-broadcast-tower', label: 'Live Streams', section: 'live-stream-management' },
    { id: 'recordings', icon: 'fas fa-microphone-alt', label: 'Recordings', section: 'recordings' },
    { id: 'messages', icon: 'fas fa-envelope', label: 'Chat', section: 'messages' },
    { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
    { id: 'assistant', icon: 'fas fa-robot', label: 'Spiritual Assistant', section: 'spiritual-assistant' },
    { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
    { id: 'attendance', icon: 'fas fa-clipboard-check', label: 'Attendance', section: 'attendance-management' },
    { id: 'users', icon: 'fas fa-users-cog', label: 'User Management', section: 'user-management' },
    { id: 'ministries', icon: 'fas fa-church', label: 'Ministry Management', section: 'ministry-management' },
    { id: 'my-created-events', icon: 'fas fa-calendar-plus', label: 'My Events', section: 'my-created-events' },
    { id: 'user-events-oversight', icon: 'fas fa-calendar-plus', label: 'User Events', section: 'user-events-oversight' },
    { id: 'rfid', icon: 'fas fa-id-card', label: 'Events RFID', section: 'rfid-reader' },
    { id: 'accommodation', icon: 'fas fa-bed', label: 'Accommodation', section: 'accommodation' },
    { id: 'isom-inquiries', icon: 'fas fa-user-graduate', label: 'ISOM Inquiries', section: 'isom-inquiries' },
    { id: 'payment-methods', icon: 'fas fa-money-check-dollar', label: 'Mode of Payment', section: 'payment-methods' },
    { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
  ];
}

// ============================================
// SECTION ACCESS - strict, by role
// Who owns each dashboard section. An account sees a section when ANY role
// it holds owns it; every other section stays out of its sidebar and cannot
// be opened, not even from a link. Permissions Control can still turn an
// owned section off, but never turns one on. Super Admin owns everything.
//   roles      - these roles own it
//   ministries - so does a Ministry Member serving in one of these
//   modules    - so does whoever has any of these permissions (positions
//                count: a Song Leader has CREATE_SONG_LIST)
//   eventTypes - so does an account given event-creation permissions
// A section missing from this table is not a sidebar section and is open.
// ============================================
const EVERYONE = [ROLES.GUEST, ROLES.CHURCH_MEMBER, ROLES.MINISTRY_MEMBER, ROLES.PASTOR, ROLES.ADMIN];
const MEMBERS_AND_UP = [ROLES.CHURCH_MEMBER, ROLES.MINISTRY_MEMBER, ROLES.PASTOR, ROLES.ADMIN];
const PAW_MINISTRIES = ['Praise And Worship', 'Media'];
const SUPER_ADMIN_ONLY = { roles: [] };

export const SECTION_ACCESS = {
  'home': { roles: EVERYONE },
  'my-profile': { roles: EVERYONE },
  'events': { roles: EVERYONE },
  'announcements': { roles: EVERYONE },
  'community-events': { roles: MEMBERS_AND_UP },
  'community-hub': { roles: MEMBERS_AND_UP },
  'messages': { roles: MEMBERS_AND_UP },
  'recordings': { roles: MEMBERS_AND_UP },
  'reports': { roles: MEMBERS_AND_UP },
  'weekly-schedule': { roles: MEMBERS_AND_UP },
  // Ministry work: Ministry Members (Praise & Worship / Media for the PAW screens)
  'ministry-meetings': { roles: [ROLES.MINISTRY_MEMBER, ROLES.PASTOR, ROLES.ADMIN] },
  'praise-worship': { roles: [ROLES.PASTOR, ROLES.ADMIN], ministries: PAW_MINISTRIES },
  'song-playlist': { roles: [ROLES.PASTOR, ROLES.ADMIN], ministries: PAW_MINISTRIES },
  // Song Leaders add songs there; Schedule Plotters plot the month there.
  'create-lineup': { modules: [MODULES.CREATE_SONG_LIST, MODULES.PLAN_LINEUP] },
  'my-created-events': { eventTypes: true },
  // Pastoral oversight
  'user-events-oversight': { roles: [ROLES.PASTOR] },
  'isom-inquiries': { roles: [ROLES.PASTOR, ROLES.ADMIN] },
  'payment-methods': { roles: [ROLES.PASTOR, ROLES.ADMIN] },
  'events-management': { roles: [ROLES.PASTOR, ROLES.ADMIN] },
  'announcements-management': { roles: [ROLES.PASTOR, ROLES.ADMIN] },
  // People & Roles - Admin only
  'attendance-management': { roles: [ROLES.ADMIN] },
  'user-management': { roles: [ROLES.ADMIN] },
  'ministry-management': { roles: [ROLES.ADMIN] },
  // Resources - Admin only
  'bible-reader': { roles: [ROLES.ADMIN] },
  'spiritual-assistant': { roles: [ROLES.ADMIN] },
  // Running an event - Admin only
  'live-stream-management': { roles: [ROLES.ADMIN] },
  'rfid-reader': { roles: [ROLES.ADMIN] },
  'accommodation': { roles: [ROLES.ADMIN] },
  // System
  'roles-permissions': SUPER_ADMIN_ONLY,
  'permissions-control': SUPER_ADMIN_ONLY,
  'system-config': SUPER_ADMIN_ONLY,
  'isom-management': SUPER_ADMIN_ONLY,
  'terms-conditions': SUPER_ADMIN_ONLY,
  'audit-logs': SUPER_ADMIN_ONLY,
  'cloudinary-usage': SUPER_ADMIN_ONLY,
};

// A retired role counts as the role it became.
const AS_CURRENT_ROLE = {
  [LEGACY_ROLES.MEMBER]: ROLES.CHURCH_MEMBER,
  [LEGACY_ROLES.SONG_LEADER]: ROLES.MINISTRY_MEMBER,
  [LEGACY_ROLES.LEADER]: ROLES.MINISTRY_MEMBER,
};

/**
 * May an account open this section? See SECTION_ACCESS.
 * @param {string} section
 * @param {{ roles: string[], subRole?: string, ministries?: string[], eventTypes?: string[] }} account
 *   roles from getUserRoles(); ministries every ministry served in
 * @returns {boolean}
 */
export function canAccessSection(section, { roles = [], subRole, ministries = [], eventTypes = [] } = {}) {
  if (roles.includes(ROLES.SUPER_ADMIN)) return true;
  const rule = SECTION_ACCESS[section];
  if (!rule) return true;
  const held = roles.map((r) => AS_CURRENT_ROLE[r] || r);
  if (rule.roles?.some((r) => held.includes(r))) return true;
  if (rule.ministries && held.includes(ROLES.MINISTRY_MEMBER) && ministries.some((m) => rule.ministries.includes(m))) return true;
  if (rule.modules?.some((m) => hasPermission(roles, m, subRole))) return true;
  if (rule.eventTypes && eventTypes.length > 0) return true;
  return false;
}

/**
 * Validate API route access
 * @param {string} userRole
 * @param {string} requiredPermission
 * @returns {{ allowed: boolean, message: string }}
 */
export function validateAccess(userRole, requiredPermission) {
  if (hasPermission(userRole, requiredPermission)) {
    return { allowed: true, message: 'Access granted' };
  }
  return {
    allowed: false,
    message: `Access denied. Your role (${userRole}) does not have permission for this action.`,
  };
}

// ============================================
// FEATURE CONTROLS (SuperAdmin Toggle System)
// Defines all toggleable features/buttons grouped by category
// ============================================
export const FEATURE_CONTROLS = {
  // --- Sidebar Sections (hide/show entire sidebar items) ---
  'sidebar.schedule': { label: 'Weekly Schedule', category: 'Sidebar Sections', icon: 'fas fa-calendar-week', description: 'Show Weekly Schedule in sidebar' },
  'sidebar.praise_worship': { label: 'Praise & Worship', category: 'Sidebar Sections', icon: 'fas fa-hands-praying', description: 'Show Praise & Worship in sidebar' },
  'sidebar.song_playlist': { label: 'Song Playlist', category: 'Sidebar Sections', icon: 'fas fa-compact-disc', description: 'Show Song Playlist in sidebar' },
  'sidebar.lineup': { label: 'Create / Assign Lineup', category: 'Sidebar Sections', icon: 'fas fa-music', description: 'Show Create/Assign Lineup in sidebar' },
  'sidebar.meetings': { label: 'Ministry Meetings', category: 'Sidebar Sections', icon: 'fas fa-handshake', description: 'Show Ministry Meetings in sidebar' },
  'sidebar.events': { label: 'Events', category: 'Sidebar Sections', icon: 'fas fa-calendar-alt', description: 'Show Events in sidebar' },
  'sidebar.community_events': { label: 'Community Events', category: 'Sidebar Sections', icon: 'fas fa-calendar-day', description: 'Show Community Events in sidebar' },
  'sidebar.announcements': { label: 'Announcements', category: 'Sidebar Sections', icon: 'fas fa-bullhorn', description: 'Show Announcements in sidebar' },
  'sidebar.community': { label: 'Community Hub', category: 'Sidebar Sections', icon: 'fas fa-comments', description: 'Show Community Hub in sidebar' },
  'sidebar.messages': { label: 'Messages', category: 'Sidebar Sections', icon: 'fas fa-envelope', description: 'Show Messages in sidebar' },
  'sidebar.bible': { label: 'Bible Reader', category: 'Sidebar Sections', icon: 'fas fa-bible', description: 'Show Bible Reader in sidebar' },
  'sidebar.assistant': { label: 'Spiritual Assistant', category: 'Sidebar Sections', icon: 'fas fa-robot', description: 'Show Spiritual Assistant in sidebar' },
  'sidebar.reports': { label: 'Reports', category: 'Sidebar Sections', icon: 'fas fa-chart-bar', description: 'Show Reports in sidebar' },
  'sidebar.attendance': { label: 'Attendance', category: 'Sidebar Sections', icon: 'fas fa-clipboard-check', description: 'Show Attendance in sidebar' },
  'sidebar.user_management': { label: 'User Management', category: 'Sidebar Sections', icon: 'fas fa-users-cog', description: 'Show User Management in sidebar' },
  'sidebar.ministry_management': { label: 'Ministry Management', category: 'Sidebar Sections', icon: 'fas fa-church', description: 'Show Ministry Management in sidebar' },
  'sidebar.user_events': { label: 'My Events / User Events', category: 'Sidebar Sections', icon: 'fas fa-calendar-plus', description: 'Show My Events in sidebar' },
  'sidebar.live_streams': { label: 'Live Streams Management', category: 'Sidebar Sections', icon: 'fas fa-broadcast-tower', description: 'Show Live Stream Management in sidebar (Admin only)' },
  'sidebar.recordings': { label: 'Recordings', category: 'Sidebar Sections', icon: 'fas fa-microphone-alt', description: 'Show Recordings in sidebar' },
  'sidebar.accommodation': { label: 'Accommodation', category: 'Sidebar Sections', icon: 'fas fa-bed', description: 'Show Accommodation (event rooms) in sidebar' },
  'sidebar.profile': { label: 'My Profile', category: 'Sidebar Sections', icon: 'fas fa-user', description: 'Show My Profile in sidebar' },

  // --- Profile ---
  'profile.update': { label: 'Update Profile', category: 'Profile', icon: 'fas fa-user-edit', description: 'Allow users to update their profile information' },
  'profile.change_password': { label: 'Change Password', category: 'Profile', icon: 'fas fa-key', description: 'Allow users to change their password' },
  'profile.upload_picture': { label: 'Upload Profile Picture', category: 'Profile', icon: 'fas fa-camera', description: 'Allow users to upload a profile picture' },

  // --- Schedule ---
  'schedule.view': { label: 'View Schedule', category: 'Schedule', icon: 'fas fa-calendar-week', description: 'Allow viewing the weekly schedule' },

  // --- Meetings ---
  'meetings.view': { label: 'View Meetings', category: 'Meetings', icon: 'fas fa-handshake', description: 'Allow viewing ministry meetings' },
  'meetings.create': { label: 'Create Meeting', category: 'Meetings', icon: 'fas fa-plus-circle', description: 'Allow creating new ministry meetings' },
  'meetings.rsvp': { label: 'RSVP to Meeting', category: 'Meetings', icon: 'fas fa-check-circle', description: 'Allow RSVP to meetings' },

  // --- Events ---
  'events.view': { label: 'View Events', category: 'Events', icon: 'fas fa-calendar-alt', description: 'Allow viewing events' },
  'events.create': { label: 'Create Event', category: 'Events', icon: 'fas fa-calendar-plus', description: 'Allow creating new events' },
  'events.edit': { label: 'Edit Event', category: 'Events', icon: 'fas fa-edit', description: 'Allow editing events' },
  'events.delete': { label: 'Delete Event', category: 'Events', icon: 'fas fa-trash', description: 'Allow deleting events' },
  'events.rsvp': { label: 'RSVP to Event', category: 'Events', icon: 'fas fa-check-circle', description: 'Allow RSVP to events' },

  // --- Announcements ---
  'announcements.view': { label: 'View Announcements', category: 'Announcements', icon: 'fas fa-bullhorn', description: 'Allow viewing announcements' },
  'announcements.create': { label: 'Create Announcement', category: 'Announcements', icon: 'fas fa-plus', description: 'Allow creating announcements' },
  'announcements.edit': { label: 'Edit Announcement', category: 'Announcements', icon: 'fas fa-edit', description: 'Allow editing announcements' },
  'announcements.delete': { label: 'Delete Announcement', category: 'Announcements', icon: 'fas fa-trash', description: 'Allow deleting announcements' },

  // --- Community Hub ---
  'community.view_posts': { label: 'View Posts', category: 'Community Hub', icon: 'fas fa-newspaper', description: 'Allow viewing community posts' },
  'community.create_post': { label: 'Create Post', category: 'Community Hub', icon: 'fas fa-pen', description: 'Allow creating community posts' },
  'community.like_comment': { label: 'Like & Comment', category: 'Community Hub', icon: 'fas fa-heart', description: 'Allow liking and commenting on posts' },
  'community.pin_post': { label: 'Pin Post', category: 'Community Hub', icon: 'fas fa-thumbtack', description: 'Allow pinning posts' },

  // --- Messages ---
  'messages.view': { label: 'View Messages', category: 'Messages', icon: 'fas fa-envelope', description: 'Allow viewing messages' },
  'messages.send': { label: 'Send Message', category: 'Messages', icon: 'fas fa-paper-plane', description: 'Allow sending messages' },
  'messages.broadcast': { label: 'Send Broadcast', category: 'Messages', icon: 'fas fa-bullhorn', description: 'Allow sending broadcast messages' },

  // --- Praise & Worship ---
  'paw.view': { label: 'View Praise & Worship', category: 'Praise & Worship', icon: 'fas fa-hands-praying', description: 'Allow viewing Praise & Worship section' },
  'paw.create_lineup': { label: 'Create Lineup', category: 'Praise & Worship', icon: 'fas fa-music', description: 'Allow creating song lineups' },
  'paw.edit_lineup': { label: 'Edit Lineup', category: 'Praise & Worship', icon: 'fas fa-edit', description: 'Allow editing song lineups' },
  'paw.delete_lineup': { label: 'Delete Lineup', category: 'Praise & Worship', icon: 'fas fa-trash', description: 'Allow deleting song lineups' },
  'paw.assign_singers': { label: 'Assign Singers', category: 'Praise & Worship', icon: 'fas fa-users', description: 'Allow assigning singers to lineup' },

  // --- Attendance ---
  'attendance.view': { label: 'View Attendance', category: 'Attendance', icon: 'fas fa-clipboard-list', description: 'Allow viewing attendance records' },
  'attendance.mark': { label: 'Mark Attendance', category: 'Attendance', icon: 'fas fa-clipboard-check', description: 'Allow marking attendance' },
  'attendance.edit': { label: 'Edit Attendance', category: 'Attendance', icon: 'fas fa-edit', description: 'Allow editing attendance records' },
  'attendance.delete': { label: 'Delete Attendance', category: 'Attendance', icon: 'fas fa-trash', description: 'Allow deleting attendance records' },

  // --- Reports ---
  'reports.view': { label: 'View Reports', category: 'Reports', icon: 'fas fa-chart-bar', description: 'Allow viewing reports' },
  'reports.generate': { label: 'Generate Reports', category: 'Reports', icon: 'fas fa-file-alt', description: 'Allow generating reports' },
  'reports.export': { label: 'Export Reports', category: 'Reports', icon: 'fas fa-download', description: 'Allow exporting reports' },

  // --- User Management (Admin) ---
  'users.view': { label: 'View Users', category: 'User Management', icon: 'fas fa-users', description: 'Allow viewing user list' },
  'users.create': { label: 'Create User', category: 'User Management', icon: 'fas fa-user-plus', description: 'Allow creating new users' },
  'users.edit': { label: 'Edit User', category: 'User Management', icon: 'fas fa-user-edit', description: 'Allow editing user details' },
  'users.deactivate': { label: 'Deactivate User', category: 'User Management', icon: 'fas fa-user-slash', description: 'Allow deactivating users' },
  'users.reset_password': { label: 'Reset Password', category: 'User Management', icon: 'fas fa-unlock-alt', description: 'Allow resetting user passwords' },

  // --- Ministry Management ---
  'ministry.view': { label: 'View Ministries', category: 'Ministry Management', icon: 'fas fa-church', description: 'Allow viewing ministries' },
  'ministry.create': { label: 'Create Ministry', category: 'Ministry Management', icon: 'fas fa-plus', description: 'Allow creating new ministries' },
  'ministry.edit': { label: 'Edit Ministry', category: 'Ministry Management', icon: 'fas fa-edit', description: 'Allow editing ministry details' },
  'ministry.delete': { label: 'Delete Ministry', category: 'Ministry Management', icon: 'fas fa-trash', description: 'Allow deleting ministries' },

  // --- Bible & Spiritual ---
  'bible.reader': { label: 'Bible Reader', category: 'Bible & Spiritual', icon: 'fas fa-bible', description: 'Allow access to Bible Reader' },
  'bible.spiritual_assistant': { label: 'Spiritual Assistant', category: 'Bible & Spiritual', icon: 'fas fa-robot', description: 'Allow access to AI Spiritual Assistant' },

  // --- Recordings ---
  'recordings.view': { label: 'View Recordings', category: 'Recordings', icon: 'fas fa-play-circle', description: 'Allow viewing and playing recordings' },
  'recordings.upload': { label: 'Upload Recordings', category: 'Recordings', icon: 'fas fa-cloud-upload-alt', description: 'Allow uploading recordings to Google Drive' },
  'recordings.edit': { label: 'Edit Recordings', category: 'Recordings', icon: 'fas fa-edit', description: 'Allow editing recording details' },
  'recordings.delete': { label: 'Delete Recordings', category: 'Recordings', icon: 'fas fa-trash', description: 'Allow deleting recordings' },

  // --- User Events ---
  'user_events.create': { label: 'Create User Events', category: 'User Events', icon: 'fas fa-calendar-plus', description: 'Allow creating community events' },
  'user_events.browse': { label: 'Browse User Events', category: 'User Events', icon: 'fas fa-calendar-day', description: 'Allow browsing community events' },
  'user_events.rsvp': { label: 'RSVP User Events', category: 'User Events', icon: 'fas fa-check-circle', description: 'Allow RSVP to community events' },
};

/**
 * Get all feature categories
 * @returns {string[]}
 */
export function getFeatureCategories() {
  const categories = new Set();
  Object.values(FEATURE_CONTROLS).forEach((f) => categories.add(f.category));
  return Array.from(categories);
}

/**
 * Get features grouped by category
 * @returns {Object}
 */
export function getFeaturesByCategory() {
  const grouped = {};
  Object.entries(FEATURE_CONTROLS).forEach(([key, feat]) => {
    if (!grouped[feat.category]) grouped[feat.category] = [];
    grouped[feat.category].push({ key, ...feat });
  });
  return grouped;
}

/**
 * Check if a feature is enabled for a role given the permission overrides
 * SuperAdmin always has access. If no override exists, feature is enabled by default.
 * @param {string} userRole
 * @param {string} featureKey
 * @param {Object} permissionOverrides - Map of "role::feature_key" → boolean
 * @returns {boolean}
 */
export function isFeatureEnabled(userRole, featureKey, permissionOverrides = {}) {
  if (!userRole || !featureKey) return true;
  if (userRole === ROLES.SUPER_ADMIN) return true;

  const overrideKey = `${userRole}::${featureKey}`;
  if (overrideKey in permissionOverrides) {
    return permissionOverrides[overrideKey];
  }
  // Default: enabled
  return true;
}

/**
 * Map sidebar section IDs to their feature key for toggle control.
 * 'home' is never hidden — always accessible.
 */
/**
 * Sections a Guest can never open, no matter what the SuperAdmin toggles say.
 */
export const GUEST_BLOCKED_SECTIONS = new Set(['community-hub']);

export const SIDEBAR_FEATURE_MAP = {
  'weekly-schedule': 'sidebar.schedule',
  'praise-worship': 'sidebar.praise_worship',
  'song-playlist': 'sidebar.song_playlist',
  'create-lineup': 'sidebar.lineup',
  'ministry-meetings': 'sidebar.meetings',
  'events': 'sidebar.events',
  'events-management': 'sidebar.events',
  'community-events': 'sidebar.community_events',
  'announcements': 'sidebar.announcements',
  'announcements-management': 'sidebar.announcements',
  'community-hub': 'sidebar.community',
  'live-stream-management': 'sidebar.live_streams',
  'recordings': 'sidebar.recordings',
  'messages': 'sidebar.messages',
  'bible-reader': 'sidebar.bible',
  'spiritual-assistant': 'sidebar.assistant',
  'reports': 'sidebar.reports',
  'attendance-management': 'sidebar.attendance',
  'rfid-reader': 'sidebar.rfid',
  'accommodation': 'sidebar.accommodation',
  'user-management': 'sidebar.user_management',
  'ministry-management': 'sidebar.ministry_management',
  'ministry-oversight': 'sidebar.ministry_management',
  'my-created-events': 'sidebar.user_events',
  'user-events-oversight': 'sidebar.user_events',
  'my-profile': 'sidebar.profile',
};

/**
 * Map sidebar section IDs to their related action-level feature keys.
 * If ALL action features for a section are explicitly disabled, the sidebar item is also hidden.
 * This ensures that when SuperAdmin disables e.g. all Events features, the Events sidebar disappears.
 */
export const SIDEBAR_ACTION_FEATURES = {
  'weekly-schedule': ['schedule.view'],
  'praise-worship': ['paw.view', 'paw.create_lineup', 'paw.edit_lineup', 'paw.delete_lineup', 'paw.assign_singers'],
  'create-lineup': ['paw.create_lineup', 'paw.edit_lineup', 'paw.assign_singers'],
  'ministry-meetings': ['meetings.view', 'meetings.create', 'meetings.rsvp'],
  'events': ['events.view', 'events.create', 'events.edit', 'events.delete', 'events.rsvp'],
  'events-management': ['events.view', 'events.create', 'events.edit', 'events.delete', 'events.rsvp'],
  'community-events': ['user_events.browse', 'user_events.rsvp'],
  'announcements': ['announcements.view', 'announcements.create', 'announcements.edit', 'announcements.delete'],
  'announcements-management': ['announcements.view', 'announcements.create', 'announcements.edit', 'announcements.delete'],
  'community-hub': ['community.view_posts', 'community.create_post', 'community.like_comment'],
  'live-stream-management': ['community.view_posts'],
  'recordings': ['recordings.view', 'recordings.upload', 'recordings.edit', 'recordings.delete'],
  'messages': ['messages.view', 'messages.send', 'messages.broadcast'],
  'bible-reader': ['bible.reader'],
  'spiritual-assistant': ['bible.spiritual_assistant'],
  'reports': ['reports.view', 'reports.generate', 'reports.export'],
  'attendance-management': ['attendance.view', 'attendance.mark', 'attendance.edit', 'attendance.delete'],
  'user-management': ['users.view', 'users.create', 'users.edit', 'users.deactivate', 'users.reset_password'],
  'ministry-management': ['ministry.view', 'ministry.create', 'ministry.edit', 'ministry.delete'],
  'ministry-oversight': ['ministry.view'],
  'my-created-events': ['user_events.create'],
  'user-events-oversight': ['user_events.create'],
  'my-profile': ['profile.update', 'profile.change_password', 'profile.upload_picture'],
};

/**
 * Check if a sidebar item should be visible for a role.
 * Hidden if:
 *   1. The sidebar-level feature key (sidebar.*) is explicitly disabled, OR
 *   2. ALL related action-level feature keys are explicitly disabled.
 * If no overrides exist, defaults to visible.
 * @param {string} userRole
 * @param {string} sectionId - The sidebar section ID
 * @param {Object} permissionOverrides - Map of "role::feature_key" -> boolean
 * @returns {boolean}
 */
export function isSidebarItemEnabled(userRole, sectionId, permissionOverrides = {}) {
  if (!userRole || !sectionId) return true;
  if (sectionId === 'home') return true;
  if (userRole === ROLES.SUPER_ADMIN) return true;

  // Guests never reach these, whatever the Permissions Control toggles say.
  // This is a policy of the app rather than a setting, so it is checked before
  // the overrides and cannot be turned back on from the toggle screen.
  if (userRole === ROLES.GUEST && GUEST_BLOCKED_SECTIONS.has(sectionId)) return false;

  // Check 1: sidebar-level toggle (e.g. sidebar.events)
  const sidebarKey = SIDEBAR_FEATURE_MAP[sectionId];
  if (sidebarKey) {
    const sidebarOverride = `${userRole}::${sidebarKey}`;
    if (sidebarOverride in permissionOverrides && !permissionOverrides[sidebarOverride]) {
      return false;
    }
  }

  // Check 2: action-level toggles (e.g. events.view, events.create, ...)
  // If ALL related action features are explicitly set to false, hide the sidebar item
  const actionKeys = SIDEBAR_ACTION_FEATURES[sectionId];
  if (actionKeys && actionKeys.length > 0) {
    const explicitlySet = actionKeys.filter(key => `${userRole}::${key}` in permissionOverrides);
    // Only hide if at least one action key has been explicitly set AND all explicit ones are disabled
    if (explicitlySet.length > 0) {
      const allDisabled = explicitlySet.every(key => !permissionOverrides[`${userRole}::${key}`]);
      if (allDisabled) return false;
    }
  }

  return true;
}
