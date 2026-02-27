// ============================================
// ROLE-BASED ACCESS CONTROL (RBAC) SYSTEM
// Based on Appendix R: List of Modules
// 50 Modules across 6 User Roles
// ============================================

export const ROLES = {
  MEMBER: 'Member',
  SONG_LEADER: 'Song Leader',
  LEADER: 'Leader',
  PASTOR: 'Pastor',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
};

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

  // === MINISTRY DASHBOARD (Members, Song Leader, Leader) ===
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

  // === SONG LINEUP MANAGEMENT (Song Leader only) ===
  CREATE_SONG_LIST: 'create_song_list',
  ADD_REMOVE_SONGS: 'add_remove_songs',
  UPDATE_SONG_LINEUP: 'update_song_lineup',
  ASSIGN_SINGERS: 'assign_singers',

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
};

// Role → Module access mapping (from Appendix R)
export const ROLE_PERMISSIONS = {
  [ROLES.MEMBER]: [
    // Public Access
    MODULES.VIEW_HOMEPAGE, MODULES.VIEW_BIBLE_VERSE, MODULES.VIEW_PUBLIC_ANNOUNCEMENTS,
    MODULES.VIEW_PUBLIC_EVENTS, MODULES.VIEW_PUBLIC_COMMUNITY, MODULES.LOGIN,
    // Ministry Dashboard
    MODULES.VIEW_MINISTRY_DASHBOARD, MODULES.VIEW_NOTIFICATIONS, MODULES.VIEW_BIBLE_VERSES,
    // Profile Management
    MODULES.VIEW_PROFILE, MODULES.UPDATE_PROFILE, MODULES.CHANGE_PASSWORD,
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
  ],

  [ROLES.SONG_LEADER]: [
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
  ],

  [ROLES.LEADER]: [
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
    // Events Management
    MODULES.CREATE_EVENTS, MODULES.UPDATE_EVENTS, MODULES.DELETE_EVENTS, MODULES.VIEW_EVENT_PARTICIPANTS,
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
    // Events & Schedule view
    MODULES.VIEW_EVENTS, MODULES.VIEW_SCHEDULE,
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
 * @param {string} userRole - The user's role
 * @param {string} module - The module constant to check
 * @returns {boolean}
 */
export function hasPermission(userRole, module) {
  if (!userRole || !module) return false;
  if (userRole === ROLES.SUPER_ADMIN) return true;

  const permissions = ROLE_PERMISSIONS[userRole];
  if (!permissions) return false;
  if (permissions.includes('all')) return true;

  return permissions.includes(module);
}

/**
 * Check if user has any of the given permissions
 * @param {string} userRole
 * @param {string[]} modules
 * @returns {boolean}
 */
export function hasAnyPermission(userRole, modules) {
  if (!userRole || !modules?.length) return false;
  if (userRole === ROLES.SUPER_ADMIN) return true;
  return modules.some(m => hasPermission(userRole, m));
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
    default: return 'ministry'; // Member, Song Leader, Leader
  }
}

/**
 * Get sidebar menu items based on user role
 * @param {string} role
 * @returns {Array}
 */
export function getSidebarMenu(role) {
  const dashboardType = getDashboardType(role);

  if (dashboardType === 'super-admin') {
    return [
      { id: 'home', icon: 'fas fa-tachometer-alt', label: 'Dashboard', section: 'home' },
      { id: 'users', icon: 'fas fa-users-cog', label: 'User Management', section: 'user-management' },
      { id: 'roles', icon: 'fas fa-shield-alt', label: 'Roles & Permissions', section: 'roles-permissions' },
      { id: 'ministries', icon: 'fas fa-church', label: 'Ministry Management', section: 'ministry-management' },
      { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events-management' },
      { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements-management' },
      { id: 'attendance', icon: 'fas fa-clipboard-check', label: 'Attendance', section: 'attendance-management' },
      { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
      { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
      { id: 'system', icon: 'fas fa-cogs', label: 'System Config', section: 'system-config' },
      { id: 'audit', icon: 'fas fa-history', label: 'Audit Logs', section: 'audit-logs' },
      { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
      { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
    ];
  }

  if (dashboardType === 'admin') {
    return [
      { id: 'home', icon: 'fas fa-tachometer-alt', label: 'Dashboard', section: 'home' },
      { id: 'users', icon: 'fas fa-users-cog', label: 'User Management', section: 'user-management' },
      { id: 'ministries', icon: 'fas fa-church', label: 'Ministry Management', section: 'ministry-management' },
      { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events-management' },
      { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements-management' },
      { id: 'attendance', icon: 'fas fa-clipboard-check', label: 'Attendance', section: 'attendance-management' },
      { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
      { id: 'messages', icon: 'fas fa-envelope', label: 'Messages', section: 'messages' },
      { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
      { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
      { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
    ];
  }

  if (dashboardType === 'pastor') {
    return [
      { id: 'home', icon: 'fas fa-tachometer-alt', label: 'Dashboard', section: 'home' },
      { id: 'ministries', icon: 'fas fa-church', label: 'Ministry Oversight', section: 'ministry-oversight' },
      { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events-management' },
      { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements-management' },
      { id: 'attendance', icon: 'fas fa-clipboard-check', label: 'Attendance', section: 'attendance-management' },
      { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
      { id: 'messages', icon: 'fas fa-envelope', label: 'Messages', section: 'messages' },
      { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
      { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
      { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
    ];
  }

  // Ministry dashboard (Member, Song Leader, Leader)
  const menu = [
    { id: 'home', icon: 'fas fa-home', label: 'Home', section: 'home' },
    { id: 'schedule', icon: 'fas fa-calendar-week', label: 'Weekly Schedule', section: 'weekly-schedule' },
  ];

  // Song Leader gets Create Lineup
  if (role === ROLES.SONG_LEADER) {
    menu.push({ id: 'lineup', icon: 'fas fa-music', label: 'Create Lineup', section: 'create-lineup' });
  }

  // Song Leader & Leader get Ministry Meetings create
  if (role === ROLES.SONG_LEADER || role === ROLES.LEADER) {
    menu.push({ id: 'meetings', icon: 'fas fa-handshake', label: 'Ministry Meetings', section: 'ministry-meetings' });
  } else {
    menu.push({ id: 'meetings', icon: 'fas fa-handshake', label: 'Ministry Meetings', section: 'ministry-meetings' });
  }

  menu.push(
    { id: 'events', icon: 'fas fa-calendar-alt', label: 'Events', section: 'events' },
    { id: 'announcements', icon: 'fas fa-bullhorn', label: 'Announcements', section: 'announcements' },
    { id: 'community', icon: 'fas fa-comments', label: 'Community Hub', section: 'community-hub' },
    { id: 'messages', icon: 'fas fa-envelope', label: 'Messages', section: 'messages' },
    { id: 'bible', icon: 'fas fa-bible', label: 'Bible Reader', section: 'bible-reader' },
    { id: 'quote', icon: 'fas fa-quote-right', label: 'Daily Quote', section: 'daily-quote' },
    { id: 'assistant', icon: 'fas fa-robot', label: 'Spiritual Assistant', section: 'spiritual-assistant' },
    { id: 'reports', icon: 'fas fa-chart-bar', label: 'Reports', section: 'reports' },
    { id: 'profile', icon: 'fas fa-user', label: 'My Profile', section: 'my-profile' },
  );

  return menu;
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
