'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES, MODULES, hasPermission, hasAnyPermission, getSidebarMenu, getDashboardType } from '@/lib/permissions';
import './dashboard.css';

// ============================================
// CONSTANTS
// ============================================
const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const ALL_ROLES = ['Guest', 'Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'];
const ALL_MINISTRIES = ['Praise And Worship', 'Media', 'Dancers', 'Ashers', 'Pastors', 'Teachers'];

// Event types that admin can enable for users
const USER_EVENT_TYPES = ['Event', 'Meeting', 'Bible Study', 'Prayer Meeting', 'Fellowship', 'Outreach', 'Workshop', 'Other'];

// Ministry → Sub-Role mapping (Admin picks ministry, then sub-role dropdown shows these)
const MINISTRY_SUB_ROLES = {
  'Praise And Worship': ['Song Leaders', 'Song Leader Backupers', 'Instrumentalists', 'Dancers'],
  'Media': ['Lyrics', 'Multimedia'],
  'Dancers': ['Choreographer', 'Dancer'],
  'Ashers': ['Head Usher', 'Usher'],
  'Pastors': ['Senior Pastor', 'Associate Pastor', 'Youth Pastor'],
  'Teachers': ['Sunday School', 'Bible Study', 'ISOM'],
};

// Bible version options
const BIBLE_VERSIONS = [
  { value: 'NIV', label: 'NIV', fullName: 'New International Version' },
  { value: 'NKJV', label: 'NKJV', fullName: 'New King James Version' },
  { value: 'AMP', label: 'AMP', fullName: 'Amplified Bible' },
  { value: 'CEV', label: 'CEV', fullName: 'Contemporary English Version' },
  { value: 'CEBUANO', label: 'Cebuano', fullName: 'Cebuano (Ang Biblia)' },
  { value: 'TAGALOG', label: 'Tagalog', fullName: 'Tagalog (Ang Bibliya)' },
];

// Bible book -> chapter count mapping
const BIBLE_BOOKS = {
  'Genesis':50,'Exodus':40,'Leviticus':27,'Numbers':36,'Deuteronomy':34,'Joshua':24,'Judges':21,'Ruth':4,
  '1 Samuel':31,'2 Samuel':24,'1 Kings':22,'2 Kings':25,'1 Chronicles':29,'2 Chronicles':36,'Ezra':10,
  'Nehemiah':13,'Esther':10,'Job':42,'Psalms':150,'Proverbs':31,'Ecclesiastes':12,'Song of Solomon':8,
  'Isaiah':66,'Jeremiah':52,'Lamentations':5,'Ezekiel':48,'Daniel':12,'Hosea':14,'Joel':3,'Amos':9,
  'Obadiah':1,'Jonah':4,'Micah':7,'Nahum':3,'Habakkuk':3,'Zephaniah':3,'Haggai':2,'Zechariah':14,'Malachi':4,
  'Matthew':28,'Mark':16,'Luke':24,'John':21,'Acts':28,'Romans':16,'1 Corinthians':16,'2 Corinthians':13,
  'Galatians':6,'Ephesians':6,'Philippians':4,'Colossians':4,'1 Thessalonians':5,'2 Thessalonians':3,
  '1 Timothy':6,'2 Timothy':4,'Titus':3,'Philemon':1,'Hebrews':13,'James':5,'1 Peter':5,'2 Peter':3,
  '1 John':5,'2 John':1,'3 John':1,'Jude':1,'Revelation':22,
};

// Verse count per chapter for each book (accurate per KJV canon)
const VERSES_PER_CHAPTER = {
  'Genesis':[31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  'Exodus':[22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  'Leviticus':[17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  'Numbers':[54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  'Deuteronomy':[46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  'Joshua':[18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  'Judges':[36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  'Ruth':[22,23,18,22],
  '1 Samuel':[28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,43,15,23,28,18,34,40,44,13,22],
  '2 Samuel':[27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  '1 Kings':[53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  '2 Kings':[18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  '1 Chronicles':[54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  '2 Chronicles':[17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  'Ezra':[11,70,13,24,17,22,28,36,15,44],
  'Nehemiah':[11,20,32,23,19,19,73,18,38,39,36,47,31],
  'Esther':[22,23,15,17,14,14,10,17,32,3],
  'Job':[22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  'Psalms':[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  'Proverbs':[33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31],
  'Ecclesiastes':[18,26,22,16,20,12,29,17,18,20,10,14],
  'Song of Solomon':[17,17,11,16,16,13,13,14],
  'Isaiah':[31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  'Jeremiah':[19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  'Lamentations':[22,22,66,22,22],
  'Ezekiel':[28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  'Daniel':[21,49,30,37,31,28,28,27,27,21,45,13],
  'Hosea':[11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  'Joel':[20,32,21],
  'Amos':[15,16,15,13,27,14,17,14,15],
  'Obadiah':[21],
  'Jonah':[17,10,10,11],
  'Micah':[16,13,12,13,15,16,20],
  'Nahum':[15,13,19],
  'Habakkuk':[17,20,19],
  'Zephaniah':[18,15,20],
  'Haggai':[15,23],
  'Zechariah':[21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  'Malachi':[14,17,18,6],
  'Matthew':[25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  'Mark':[45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  'Luke':[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  'John':[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  'Acts':[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  'Romans':[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians':[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,10],
  '2 Corinthians':[24,17,18,18,21,18,16,24,15,18,33,21,14],
  'Galatians':[24,21,29,31,26,18],
  'Ephesians':[23,22,21,32,33,24],
  'Philippians':[30,30,21,23],
  'Colossians':[29,23,25,18],
  '1 Thessalonians':[10,20,13,18,28],
  '2 Thessalonians':[12,17,18],
  '1 Timothy':[20,15,16,16,25,21],
  '2 Timothy':[18,26,17,22],
  'Titus':[16,15,15],
  'Philemon':[25],
  'Hebrews':[14,18,19,16,14,20,28,13,28,39,40,29,25],
  'James':[27,26,18,17,20],
  '1 Peter':[25,25,22,19,14],
  '2 Peter':[21,22,18],
  '1 John':[10,29,24,21,21],
  '2 John':[13],
  '3 John':[14],
  'Jude':[25],
  'Revelation':[20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
};

// Simple markdown renderer for Bible answers
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let key = 0;
  for (let line of lines) {
    // Bold: **text**
    let processed = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    if (line.startsWith('### ')) {
      elements.push(<h4 key={key++} className="bible-ans-heading" dangerouslySetInnerHTML={{ __html: processed.slice(4) }} />);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={key++} className="bible-ans-heading" dangerouslySetInnerHTML={{ __html: processed.slice(3) }} />);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<div key={key++} className="bible-ans-list-item" dangerouslySetInnerHTML={{ __html: processed }} />);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={key++} className="bible-ans-para" dangerouslySetInnerHTML={{ __html: processed }} />);
    }
  }
  return elements;
}

const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: '/assets/dr-weldon-pior.png' },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: '/assets/dr-dorothy-pior.png' },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: '/assets/ptr-gracelyn-gambe.png' },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: '/assets/ptr-eldan-gambe.png' },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: '/assets/ptr-psalm-gambe.png' },
];

const GATHERINGS = [
  { title: 'Sunday Worship Service', desc: 'Our church family united in powerful worship and biblical teaching every Sunday', photo: '/assets/worship-service.jpg' },
  { title: 'Pastor Appreciation', desc: 'Honoring and celebrating our dedicated pastors for their faithful service and leadership', photo: '/assets/pastor-appreciation.jpg' },
  { title: 'Youth Ministry Event', desc: 'Dynamic youth gatherings filled with fun, fellowship, and spiritual growth', photo: '/assets/youth-event.jpg' },
  { title: 'Community Outreach', desc: 'Extending God\'s love through practical service and evangelism in our community', photo: '/assets/community-outreach.jpg' },
  { title: 'Christian Leadership Conference', desc: 'Equipping and empowering leaders for effective ministry and spiritual guidance', photo: '/assets/christian-leadership-conference.jpg' },
  { title: 'Baptism Service', desc: 'Powerful moments of public declaration of faith through water baptism', photo: '/assets/baptism-service.jpg' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study and discussion for spiritual growth and deeper understanding', photo: '/assets/friday-bible-study.jpg' },
  { title: 'ISOM', desc: 'International School of Ministry training for leadership development and ministry equipping', photo: '/assets/isom-training.jpg' },
];

// ============================================
// DASHBOARD COMPONENT
// ============================================
export default function DashboardPage() {
  const router = useRouter();

  // Core state
  const [userData, setUserData] = useState(null);
  const [userRole, setUserRole] = useState('Guest');
  const [activeSection, setActiveSection] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Pastors carousel
  const [pastorCarouselIndex, setPastorCarouselIndex] = useState(0);

  // Bible verse
  const [dailyVerse, setDailyVerse] = useState({ verse: 'Loading verse of the day...', reference: 'Loading...', explanation: '' });
  const [bibleVersion, setBibleVersion] = useState('NIV');

  // Schedules
  const [scheduleData, setScheduleData] = useState([]);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // Create Lineup
  const [lineupForm, setLineupForm] = useState({
    scheduleDate: '', practiceDate: '', songLeader: '',
    backupSingers: [''], slowSongs: [{ title: '', link: '', lyrics: '', instructions: '' }],
    fastSongs: [{ title: '', link: '', lyrics: '', instructions: '' }],
  });
  const [lineupLoading, setLineupLoading] = useState(false);
  const [lineupView, setLineupView] = useState('calendar'); // 'calendar' | 'form' | 'success'
  const [lineupSelectedDate, setLineupSelectedDate] = useState(null);
  const [lineupCalendarMonth, setLineupCalendarMonth] = useState(new Date());

  // AI Song Scanner
  // Key format: "slowSongs-0", "fastSongs-1", etc.
  // Value: { status: 'scanning'|'safe'|'explicit'|'warning'|'error', message: string, details: string }
  const [songScanResults, setSongScanResults] = useState({});
  const songScanTimers = useRef({});

  // My Lineups
  const [myLineups, setMyLineups] = useState([]);
  const [editingLineup, setEditingLineup] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Backup Singers (fetched from DB)
  const [backupSingerOptions, setBackupSingerOptions] = useState([]);

  // Song Leader options (for admin to pick from)
  const [songLeaderOptions, setSongLeaderOptions] = useState([]);

  // Detail popup for Song Leader viewing other dates
  const [lineupDetailPopup, setLineupDetailPopup] = useState(null); // { songLeader, backupSingers, date }

  // Profile
  const [profileTab, setProfileTab] = useState('personal');
  const [profileForm, setProfileForm] = useState({ firstname: '', lastname: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [setPasswordFormData, setSetPasswordFormData] = useState({ newPassword: '', confirmPassword: '' });
  const [hasLocalPassword, setHasLocalPassword] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Bible Reader
  const [bibleBook, setBibleBook] = useState('Genesis');
  const [bibleChapter, setBibleChapter] = useState(1);
  const [bibleVerse, setBibleVerse] = useState('');
  const [bibleText, setBibleText] = useState('');
  const [bibleQuestion, setBibleQuestion] = useState('');
  const [bibleAnswer, setBibleAnswer] = useState('');
  const [highlightPopup, setHighlightPopup] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [directScripture, setDirectScripture] = useState('');
  const [answerCopied, setAnswerCopied] = useState(false);
  const bibleTextRef = useRef(null);

  // Daily Quote
  const [dailyQuote, setDailyQuote] = useState({ quote: 'Loading...', author: '' });

  // Spiritual Assistant
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMemoryLoaded, setChatMemoryLoaded] = useState(false);
  const chatEndRef = useRef(null);

  // Birthdays
  const [birthdayData, setBirthdayData] = useState([]);

  // Events
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState({ title: '', description: '', eventDate: '', endDate: '', location: '' });
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  // User-Created Events (enabled by admin)
  const [userEvents, setUserEvents] = useState([]);
  const [userEventForm, setUserEventForm] = useState({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
  const [showUserEventForm, setShowUserEventForm] = useState(false);
  const [editingUserEvent, setEditingUserEvent] = useState(null);
  const [userEventRsvps, setUserEventRsvps] = useState(null); // { data, grouped, counts }
  const [viewingUserEventRsvps, setViewingUserEventRsvps] = useState(null); // event object
  const [allUserEventsForPastor, setAllUserEventsForPastor] = useState([]);
  const [pastorViewingEvent, setPastorViewingEvent] = useState(null);
  const [pastorEventRsvps, setPastorEventRsvps] = useState(null);
  const [eventPermissionsUser, setEventPermissionsUser] = useState(null); // user being edited for event perms
  const [eventPermissionsForm, setEventPermissionsForm] = useState([]); // array of selected types
  const [browseUserEvents, setBrowseUserEvents] = useState([]); // all user events (for browsing/RSVP)
  const [myEventsTab, setMyEventsTab] = useState('mine'); // 'mine' or 'browse'

  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({ title: '', content: '', isPinned: false });
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);

  // Meetings
  const [meetings, setMeetings] = useState([]);
  const [meetingForm, setMeetingForm] = useState({ title: '', description: '', meetingDate: '', location: '' });
  const [showMeetingForm, setShowMeetingForm] = useState(false);

  // Community Hub
  const [communityPosts, setCommunityPosts] = useState([]);
  const [newPostContent, setNewPostContent] = useState('');
  const [commentInputs, setCommentInputs] = useState({});
  const [postComments, setPostComments] = useState({});
  const [showComments, setShowComments] = useState({});

  // Messages
  const [messages, setMessages] = useState([]);
  const [messageTab, setMessageTab] = useState('inbox');
  const [messageForm, setMessageForm] = useState({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' });
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  // Attendance
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Reports
  const [reportData, setReportData] = useState(null);

  // Admin: Users Management
  const [adminUsers, setAdminUsers] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' });
  const [editingUser, setEditingUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Admin: Ministry Management
  const [ministriesList, setMinistriesList] = useState([]);
  const [ministryForm, setMinistryForm] = useState({ name: '', description: '' });
  const [showMinistryForm, setShowMinistryForm] = useState(false);

  // Super Admin: Roles
  const [rolesList, setRolesList] = useState([]);

  // Super Admin: Audit Logs
  const [auditLogs, setAuditLogs] = useState([]);

  // Super Admin: System Settings
  const [systemSettings, setSystemSettings] = useState({});

  // Logout
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Welcome Modal (for new users)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeVerse, setWelcomeVerse] = useState({ verse: '', reference: '' });

  // ============================================
  // INITIALIZATION
  // ============================================
  useEffect(() => {
    const stored = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (!stored || !stored.firstname) {
      router.replace('/login');
      return;
    }
    setUserData(stored);
    setUserRole(stored.role || 'Guest');
    setIsVerified(stored.status === 'Verified');
    setProfileForm({ firstname: stored.firstname, lastname: stored.lastname });
    setHasLocalPassword(stored.hasPassword !== false);

    const savedDark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(savedDark);
    if (savedDark) document.body.classList.add('dark-mode');

    // Load saved Bible version preference
    const savedVersion = localStorage.getItem('bibleVersionPref');
    if (savedVersion) setBibleVersion(savedVersion);

    // Load chat memory for this user
    try {
      const chatKey = `chatMemory_${stored.email || stored.id}`;
      const savedChat = localStorage.getItem(chatKey);
      if (savedChat) {
        const parsed = JSON.parse(savedChat);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChatMessages(parsed);
        }
      }
    } catch { /* silent */ }
    setChatMemoryLoaded(true);

    // Welcome modal for new/first-time users
    const welcomeKey = `welcomed_${stored.email || stored.id}`;
    if (!localStorage.getItem(welcomeKey)) {
      const WELCOME_VERSES = [
        { verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.', reference: 'Jeremiah 29:11' },
        { verse: 'The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you; the Lord turn his face toward you and give you peace.', reference: 'Numbers 6:24-26' },
        { verse: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!', reference: '2 Corinthians 5:17' },
        { verse: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', reference: 'Proverbs 3:5-6' },
        { verse: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', reference: 'Joshua 1:9' },
        { verse: 'I can do all this through him who gives me strength.', reference: 'Philippians 4:13' },
        { verse: 'Come to me, all you who are weary and burdened, and I will give you rest.', reference: 'Matthew 11:28' },
        { verse: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.', reference: 'Isaiah 40:31' },
        { verse: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.', reference: 'Romans 8:28' },
        { verse: 'The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul.', reference: 'Psalm 23:1-3' },
      ];
      const randomVerse = WELCOME_VERSES[Math.floor(Math.random() * WELCOME_VERSES.length)];
      setWelcomeVerse(randomVerse);
      setShowWelcomeModal(true);
    }

    fetchDailyVerse(stored.ministry);
    loadScheduleData();
    loadBirthdays();
    if (stored.id) loadNotifications(stored.id);

    // Refresh allowed_event_types from server (in case admin changed permissions)
    if (stored.id) {
      fetch(`/api/admin/users?action=get-event-permissions&userId=${stored.id}`)
        .then(r => r.json())
        .then(result => {
          if (result.success) {
            const updatedTypes = result.allowed_event_types || [];
            const current = stored.allowed_event_types || [];
            if (JSON.stringify(updatedTypes) !== JSON.stringify(current)) {
              const updated = { ...stored, allowed_event_types: updatedTypes };
              setUserData(updated);
              sessionStorage.setItem('userData', JSON.stringify(updated));
            }
          }
        })
        .catch(() => { /* silent - use cached data */ });
    }
  }, [router]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Persist chat memory to localStorage
  useEffect(() => {
    if (!chatMemoryLoaded || !userData?.email) return;
    const chatKey = `chatMemory_${userData.email || userData.id}`;
    if (chatMessages.length > 0) {
      // Keep last 50 messages to avoid localStorage overflow
      const toSave = chatMessages.slice(-50);
      localStorage.setItem(chatKey, JSON.stringify(toSave));
    }
  }, [chatMessages, chatMemoryLoaded, userData]);

  // ============================================
  // TOAST
  // ============================================
  const showToast = useCallback((message, type = 'info') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // ============================================
  // DARK MODE
  // ============================================
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
  };

  // ============================================
  // NAVIGATION
  // ============================================
  const showSection = (sectionId) => {
    const isGuestRole = userRole === 'Guest';
    if (!isVerified && !isGuestRole && sectionId !== 'home') {
      showToast('🔒 Please wait for account verification to access this feature', 'warning');
      return;
    }
    setActiveSection(sectionId);
    setSidebarOpen(false);

    // Load data on section visit
    if (sectionId === 'daily-quote') fetchDailyQuote();
    if (sectionId === 'events' || sectionId === 'events-management') loadEvents();
    if (sectionId === 'announcements' || sectionId === 'announcements-management') loadAnnouncements();
    if (sectionId === 'ministry-meetings') loadMeetings();
    if (sectionId === 'community-hub') loadCommunityPosts();
    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'attendance-management') loadAttendance();
    if (sectionId === 'reports') loadReports();
    if (sectionId === 'user-management') loadAdminUsers();
    if (sectionId === 'ministry-management' || sectionId === 'ministry-oversight') loadMinistries();
    if (sectionId === 'roles-permissions') loadRoles();
    if (sectionId === 'audit-logs') loadAuditLogs();
    if (sectionId === 'system-config') loadSystemSettings();
    if (sectionId === 'create-lineup') { loadScheduleData(); if (userRole === 'Admin' || userRole === 'Super Admin') { loadBackupSingers(); loadSongLeaders(); } }
    if (sectionId === 'my-lineups') loadScheduleData();
    if (sectionId === 'my-created-events') { loadUserEvents(); loadBrowseUserEvents(); }
    if (sectionId === 'community-events') loadBrowseUserEvents();
    if (sectionId === 'user-events-oversight') loadAllUserEventsForPastor();
    if (sectionId === 'spiritual-assistant' && chatMessages.length === 0) {
      setChatMessages([{ role: 'assistant', content: `Hello ${userData?.firstname || 'friend'}! 🙏 I'm your Spiritual AI Assistant. How can I help you today?\n\n⚠️ Disclaimer: While I can provide biblical guidance and encouragement, it is important that you also maintain your personal communication with God through prayer and His Word to receive true wisdom. I am just your AI Assistant — the Holy Spirit is your ultimate Counselor and Guide.` }]);
    }
  };

  // ============================================
  // DATA FETCHERS
  // ============================================
  const fetchDailyVerse = async (ministry) => {
    try {
      const cacheKey = 'dailyVerseCache';
      const cached = localStorage.getItem(cacheKey);
      const today = new Date().toDateString();
      if (cached) { const c = JSON.parse(cached); if (c.date === today && c.verse?.verse) { setDailyVerse(c.verse); return; } }

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: `You provide daily Bible verses for church ministry members (${ministry || 'general'} ministry). Return ONLY a JSON object: {"verse":"...", "reference":"Book Chapter:Verse", "explanation":"brief 1-2 sentence explanation"}` },
            { role: 'user', content: `Provide an encouraging Bible verse for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` },
          ],
          temperature: 0.8, max_tokens: 300,
        }),
      });
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('No response');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const verse = JSON.parse(jsonMatch[0]);
        setDailyVerse(verse);
        localStorage.setItem(cacheKey, JSON.stringify({ date: today, verse }));
      }
    } catch { setDailyVerse({ verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you.', reference: 'Jeremiah 29:11', explanation: '' }); }
  };

  const loadScheduleData = async () => {
    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      if (data.success) setScheduleData(data.data.map((s) => ({ ...s, scheduleDate: s.schedule_date, songLeader: s.song_leader, backupSingers: s.backup_singers || [], practiceDate: s.practice_date, slowSongs: s.slow_songs || [], fastSongs: s.fast_songs || [] })));
    } catch { /* silent */ }
  };

  const loadBirthdays = async () => {
    try {
      const res = await fetch('/api/members/birthdates');
      const data = await res.json();
      if (data.success) setBirthdayData(data.data);
    } catch { /* silent */ }
  };

  const loadNotifications = async (userId) => {
    try {
      const res = await fetch(`/api/notifications?userId=${userId}`);
      const data = await res.json();
      if (data.success) {
        setNotifications(data.data);
        setUnreadCount(data.data.filter((n) => !n.is_read).length);
      }
    } catch { /* silent */ }
  };

  const loadEvents = async () => {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      if (data.success) setEvents(data.data);
    } catch { /* silent */ }
  };

  const loadAnnouncements = async () => {
    try {
      const res = await fetch('/api/announcements');
      const data = await res.json();
      if (data.success) setAnnouncements(data.data);
    } catch { /* silent */ }
  };

  const loadMeetings = async () => {
    try {
      const res = await fetch(`/api/meetings?upcoming=true`);
      const data = await res.json();
      if (data.success) setMeetings(data.data);
    } catch { /* silent */ }
  };

  const loadCommunityPosts = async () => {
    try {
      const res = await fetch('/api/community');
      const data = await res.json();
      if (data.success) setCommunityPosts(data.data);
    } catch { /* silent */ }
  };

  const loadMessages = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/messages?userId=${userData.id}&type=${messageTab}`);
      const data = await res.json();
      if (data.success) setMessages(data.data);
    } catch { /* silent */ }
  };

  const loadAttendance = async () => {
    try {
      const res = await fetch(`/api/attendance?eventDate=${attendanceDate}`);
      const data = await res.json();
      if (data.success) setAttendanceRecords(data.data);
    } catch { /* silent */ }
  };

  const loadReports = async () => {
    try {
      const dashType = getDashboardType(userRole);
      const type = dashType === 'ministry' ? 'personal' : 'overview';
      const url = type === 'personal' ? `/api/reports?type=personal&userId=${userData?.id}` : '/api/reports?type=overview';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) setReportData(data.data);
    } catch { /* silent */ }
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) { setAdminUsers(data.data); setAllUsers(data.data); }
    } catch { /* silent */ }
  };

  const loadMinistries = async () => {
    try {
      const res = await fetch('/api/admin/ministries');
      const data = await res.json();
      if (data.success) setMinistriesList(data.data);
    } catch { /* silent */ }
  };

  const loadRoles = async () => {
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) setRolesList(data.data);
    } catch { /* silent */ }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs');
      const data = await res.json();
      if (data.success) setAuditLogs(data.data);
    } catch { /* silent */ }
  };

  const loadSystemSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      if (data.success) setSystemSettings(data.data);
    } catch { /* silent */ }
  };

  // User-Created Events
  const loadUserEvents = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/user-events?createdBy=${userData.id}&userId=${userData.id}`);
      const data = await res.json();
      if (data.success) setUserEvents(data.data);
    } catch { /* silent */ }
  };

  const loadAllUserEventsForPastor = async () => {
    try {
      const res = await fetch(`/api/user-events?all=true&userId=${userData?.id}`);
      const data = await res.json();
      if (data.success) setAllUserEventsForPastor(data.data);
    } catch { /* silent */ }
  };

  const loadBrowseUserEvents = async () => {
    try {
      const res = await fetch(`/api/user-events?upcoming=true&userId=${userData?.id}`);
      const data = await res.json();
      if (data.success) setBrowseUserEvents(data.data);
    } catch { /* silent */ }
  };

  const loadUserEventRsvps = async (eventId) => {
    try {
      const res = await fetch(`/api/user-events/rsvp?eventId=${eventId}`);
      const data = await res.json();
      if (data.success) setUserEventRsvps(data);
    } catch { /* silent */ }
  };

  const loadPastorEventRsvps = async (eventId) => {
    try {
      const res = await fetch(`/api/user-events/rsvp?eventId=${eventId}`);
      const data = await res.json();
      if (data.success) setPastorEventRsvps(data);
    } catch { /* silent */ }
  };

  // ============================================
  // ACTION HANDLERS
  // ============================================

  // -- Events --
  const handleEventSubmit = async () => {
    try {
      const method = editingEvent ? 'PUT' : 'POST';
      const body = editingEvent
        ? { id: editingEvent.id, title: eventForm.title, description: eventForm.description, eventDate: eventForm.eventDate, endDate: eventForm.endDate, location: eventForm.location }
        : { ...eventForm, createdBy: userData?.id };
      const res = await fetch('/api/events', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowEventForm(false); setEditingEvent(null); setEventForm({ title: '', description: '', eventDate: '', endDate: '', location: '' }); loadEvents(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    const res = await fetch(`/api/events?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadEvents();
  };

  const handleEventRSVP = async (eventId, status) => {
    const res = await fetch('/api/events/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId, userId: userData?.id, status }) });
    const data = await res.json();
    if (data.success) showToast(`RSVP: ${status}`, 'success');
  };

  // -- Announcements --
  const handleAnnouncementSubmit = async () => {
    try {
      const method = editingAnnouncement ? 'PUT' : 'POST';
      const body = editingAnnouncement
        ? { id: editingAnnouncement.id, ...announcementForm }
        : { ...announcementForm, author: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}` };
      const res = await fetch('/api/announcements', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowAnnouncementForm(false); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', isPinned: false }); loadAnnouncements(); }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    const res = await fetch(`/api/announcements?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAnnouncements();
  };

  // -- Meetings --
  const handleMeetingSubmit = async () => {
    try {
      const body = { ...meetingForm, ministry: userData?.ministry, createdBy: userData?.id, createdByName: `${userData?.firstname} ${userData?.lastname}` };
      const res = await fetch('/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowMeetingForm(false); setMeetingForm({ title: '', description: '', meetingDate: '', location: '' }); loadMeetings(); }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleMeetingRSVP = async (meetingId, status) => {
    const res = await fetch('/api/meetings/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId, userId: userData?.id, status }) });
    const data = await res.json();
    if (data.success) showToast(`RSVP: ${status}`, 'success');
  };

  // -- User-Created Events --
  const handleUserEventSubmit = async () => {
    try {
      if (editingUserEvent) {
        const res = await fetch('/api/user-events', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingUserEvent.id,
            userId: userData?.id,
            userRole,
            title: userEventForm.title,
            description: userEventForm.description,
            eventType: userEventForm.eventType,
            eventDate: userEventForm.eventDate,
            endDate: userEventForm.endDate,
            location: userEventForm.location,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Event updated successfully!', 'success');
          setShowUserEventForm(false);
          setEditingUserEvent(null);
          setUserEventForm({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
          loadUserEvents();
          if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
        } else showToast(data.message, 'danger');
      } else {
        const res = await fetch('/api/user-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...userEventForm,
            createdBy: userData?.id,
            createdByName: `${userData?.firstname} ${userData?.lastname}`,
            ministry: userData?.ministry || null,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Event created successfully!', 'success');
          setShowUserEventForm(false);
          setUserEventForm({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
          loadUserEvents();
        } else showToast(data.message, 'danger');
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteUserEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    const res = await fetch(`/api/user-events?id=${id}&userId=${userData?.id}&userRole=${userRole}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) {
      loadUserEvents();
      if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
    }
  };

  const handleUserEventRSVP = async (eventId, status) => {
    try {
      const res = await fetch('/api/user-events/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, userId: userData?.id, status }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`RSVP: ${status}`, 'success');
        loadUserEvents();
        loadBrowseUserEvents();
        if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleUpdateEventPermissions = async (userId, allowedTypes) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, action: 'update-event-permissions', allowed_event_types: allowedTypes }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Event permissions updated!', 'success');
        setEventPermissionsUser(null);
        loadAdminUsers();
        // If admin updated their own permissions, refresh local session
        if (userId === userData?.id) {
          const updated = { ...userData, allowed_event_types: allowedTypes };
          setUserData(updated);
          sessionStorage.setItem('userData', JSON.stringify(updated));
        }
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  // -- Community Hub --
  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return;
    const res = await fetch('/api/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorId: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}`, content: newPostContent }) });
    const data = await res.json();
    if (data.success) { setNewPostContent(''); loadCommunityPosts(); showToast('Post shared!', 'success'); }
  };

  const handleLikePost = async (postId) => {
    const res = await fetch('/api/community/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, userId: userData?.id }) });
    if ((await res.json()).success) loadCommunityPosts();
  };

  const loadPostComments = async (postId) => {
    const res = await fetch(`/api/community/comments?postId=${postId}`);
    const data = await res.json();
    if (data.success) setPostComments((prev) => ({ ...prev, [postId]: data.data }));
  };

  const handleAddComment = async (postId) => {
    const content = commentInputs[postId];
    if (!content?.trim()) return;
    const res = await fetch('/api/community/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, authorId: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}`, content }) });
    if ((await res.json()).success) { setCommentInputs((p) => ({ ...p, [postId]: '' })); loadPostComments(postId); loadCommunityPosts(); }
  };

  const handlePinPost = async (postId, isPinned) => {
    await fetch('/api/community', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, isPinned: !isPinned }) });
    loadCommunityPosts();
  };

  // -- Messages --
  const handleSendMessage = async () => {
    const body = { senderId: userData?.id, ...messageForm };
    const res = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { showToast(data.message, 'success'); setShowMessageForm(false); setMessageForm({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' }); loadMessages(); }
  };

  // -- Attendance (Admin) --
  const handleMarkAttendance = async (userId, status) => {
    const res = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, eventDate: attendanceDate, status, markedBy: userData?.id }) });
    const data = await res.json();
    if (data.success) { showToast('Attendance marked', 'success'); loadAttendance(); }
  };

  // -- Admin: User Management --
  const handleCreateUser = async () => {
    try {
      const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowUserForm(false); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); loadAdminUsers(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setUserForm({ firstname: user.firstname, lastname: user.lastname, email: user.email, password: '', ministry: user.ministry || '', sub_role: user.sub_role || '', role: user.role || 'Guest' });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    try {
      const updates = { id: editingUser.id, firstname: userForm.firstname, lastname: userForm.lastname, ministry: userForm.ministry, sub_role: userForm.sub_role, role: userForm.role };
      const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      const data = await res.json();
      if (data.success) { showToast('User updated successfully!', 'success'); setShowEditModal(false); setEditingUser(null); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); loadAdminUsers(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleUserAction = async (userId, action, extra = {}) => {
    const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: userId, action, ...extra }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAdminUsers();
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Permanently delete this user? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAdminUsers();
  };

  // -- Admin: Ministry Management --
  const handleMinistrySubmit = async () => {
    const res = await fetch('/api/admin/ministries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ministryForm) });
    const data = await res.json();
    if (data.success) { showToast(data.message, 'success'); setShowMinistryForm(false); setMinistryForm({ name: '', description: '' }); loadMinistries(); }
  };

  // ============================================
  // LINEUP HANDLERS
  // ============================================
  const loadBackupSingers = async () => {
    try {
      const res = await fetch('/api/lineup/singers?type=backupers');
      const data = await res.json();
      if (data.success) setBackupSingerOptions(data.data || []);
    } catch (e) { console.error('Failed to load backup singers:', e); }
  };

  const loadSongLeaders = async () => {
    try {
      const res = await fetch('/api/lineup/singers?type=song-leaders');
      const data = await res.json();
      if (data.success) setSongLeaderOptions(data.data || []);
    } catch (e) { console.error('Failed to load song leaders:', e); }
  };

  const isAdmin = userRole === 'Admin' || userRole === 'Super Admin';

  const handleLineupChange = (field, value) => setLineupForm((prev) => ({ ...prev, [field]: value }));
  const handleBackupChange = (i, v) => { const b = [...lineupForm.backupSingers]; b[i] = v; setLineupForm((p) => ({ ...p, backupSingers: b })); };
  const addBackupSinger = () => setLineupForm((p) => ({ ...p, backupSingers: [...p.backupSingers, ''] }));
  const removeBackupSinger = (i) => setLineupForm((p) => ({ ...p, backupSingers: p.backupSingers.filter((_, idx) => idx !== i) }));
  const addSong = (type) => setLineupForm((p) => ({ ...p, [type]: [...p[type], { title: '', link: '', lyrics: '', instructions: '' }] }));
  const removeSong = (type, i) => {
    setLineupForm((p) => ({ ...p, [type]: p[type].filter((_, idx) => idx !== i) }));
    setSongScanResults((prev) => { const n = { ...prev }; delete n[`${type}-${i}`]; return n; });
  };

  // AI Song Content Scanner
  const scanSongContent = async (type, index, title, link) => {
    const key = `${type}-${index}`;
    if (!title && !link) {
      setSongScanResults((prev) => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    if (!title && !link) return; // Need at least a title or link to scan

    setSongScanResults((prev) => ({ ...prev, [key]: { status: 'scanning', message: 'AI is scanning this song...', details: '' } }));

    try {
      // Step 1: If YouTube link is provided, fetch the actual video title & channel
      let videoTitle = '';
      let videoChannel = '';
      if (link) {
        try {
          const ytId = link.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (ytId) {
            const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId[1]}`);
            const oembedData = await oembedRes.json();
            if (oembedData.title) videoTitle = oembedData.title;
            if (oembedData.author_name) videoChannel = oembedData.author_name;
          }
        } catch { /* could not fetch video info, continue with title only */ }
      }

      // Step 2: Build detailed context for AI
      let songContext = '';
      if (title) songContext += `User-entered song title: "${title}"\n`;
      if (videoTitle) songContext += `Actual YouTube video title: "${videoTitle}"\n`;
      if (videoChannel) songContext += `YouTube channel: "${videoChannel}"\n`;
      if (link) songContext += `YouTube link: ${link}\n`;

      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'system',
              content: `You are a church worship song content reviewer. Your job is to analyze songs and determine if they are appropriate for church worship use.

You will receive the user-entered song title AND the actual YouTube video title (fetched from YouTube). Use BOTH to make your judgment. The YouTube title is more reliable — pay close attention to it.

Check for:
1. Explicit language (profanity, vulgar words, "explicit" tags)
2. Sexual content or innuendo
3. Violence, dark or harmful themes
4. Drug/alcohol glorification
5. Content that contradicts Christian worship values
6. If the YouTube title mentions "explicit", "18+", "parental advisory", or contains profanity — flag it immediately
7. If it's a well-known secular pop/rap/R&B/rock song NOT intended for worship — flag as warning

Respond ONLY with a valid JSON object (no markdown, no code fences, no extra text) in this exact format:
{"verdict": "safe" or "explicit" or "warning", "reason": "brief 1-sentence explanation", "youtubeTitle": "the actual YouTube title if available"}

- "safe" = song is appropriate for church worship (hymns, gospel, praise & worship)
- "explicit" = song has explicit/inappropriate content and should NOT be used in church
- "warning" = song is secular or has borderline content; the song leader should review before using`
            },
            {
              role: 'user',
              content: `Analyze this song for church worship use:\n${songContext}\nIs this appropriate for a church worship service?`
            }
          ],
          temperature: 0.1,
          max_tokens: 250,
        }),
      });

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content?.trim();

      if (content) {
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            const ytInfo = videoTitle ? `YouTube: "${videoTitle}"${videoChannel ? ` by ${videoChannel}` : ''}` : '';
            setSongScanResults((prev) => ({
              ...prev,
              [key]: {
                status: result.verdict || 'safe',
                message: result.verdict === 'safe' ? '✓ Appropriate for worship'
                  : result.verdict === 'explicit' ? '✕ Explicit content — not recommended'
                  : '⚠ Caution — review before using',
                details: result.reason + (ytInfo ? `\n${ytInfo}` : ''),
              }
            }));
            return;
          }
        } catch { /* fallback below */ }
      }
      setSongScanResults((prev) => ({ ...prev, [key]: { status: 'safe', message: '✓ No issues detected', details: videoTitle ? `YouTube: "${videoTitle}"` : '' } }));
    } catch {
      setSongScanResults((prev) => ({ ...prev, [key]: { status: 'error', message: 'Could not scan', details: 'AI scan failed. Please review manually.' } }));
    }
  };

  // Debounced song change handler — triggers AI scan when title or link changes
  const handleSongChange = (type, i, field, value) => {
    const s = [...lineupForm[type]]; s[i] = { ...s[i], [field]: value }; setLineupForm((p) => ({ ...p, [type]: s }));

    // Auto-scan when title or link changes
    if (field === 'title' || field === 'link') {
      const timerKey = `${type}-${i}`;
      if (songScanTimers.current[timerKey]) clearTimeout(songScanTimers.current[timerKey]);

      const updatedSong = { ...s[i], [field]: value };
      // Trigger scan if there's a title OR a YouTube link
      if (updatedSong.title || updatedSong.link) {
        songScanTimers.current[timerKey] = setTimeout(() => {
          scanSongContent(type, i, updatedSong.title, updatedSong.link);
        }, 1200); // Wait 1.2s after user stops typing
      } else {
        // Clear scan if both title and link are removed
        setSongScanResults((prev) => { const n = { ...prev }; delete n[timerKey]; return n; });
      }
    }
  };

  // Manual re-scan trigger
  const rescanSong = (type, i) => {
    const song = lineupForm[type][i];
    if (song?.title || song?.link) scanSongContent(type, i, song.title, song.link);
  };

  const resetLineupForm = () => {
    setLineupForm({ scheduleDate: '', practiceDate: '', songLeader: '', backupSingers: [''], slowSongs: [{ title: '', link: '', lyrics: '', instructions: '' }], fastSongs: [{ title: '', link: '', lyrics: '', instructions: '' }] });
    setLineupSelectedDate(null);
    setLineupView('calendar');
    setEditingLineup(null);
    setSongScanResults({});
    setLineupDetailPopup(null);
  };

  const handleLineupDateSelect = (dateStr) => {
    if (isAdmin) {
      // Admin: check if lineup already exists for this date
      const existing = scheduleData.find(s => s.scheduleDate === dateStr);
      if (existing) {
        showToast('A lineup already exists for this date. Go to All Lineups to edit it.', 'warning');
        return;
      }
      setLineupSelectedDate(dateStr);
      setLineupForm(prev => ({ ...prev, scheduleDate: dateStr, songLeader: '', backupSingers: [''] }));
      setLineupView('form');
      loadBackupSingers();
      loadSongLeaders();
    } else {
      // Song Leader: can only click their assigned dates
      const existing = scheduleData.find(s => s.scheduleDate === dateStr);
      if (!existing) return;
      const myName = userData ? `${userData.firstname} ${userData.lastname}` : '';
      if (existing.songLeader !== myName) {
        // Show detail popup for this date
        setLineupDetailPopup({ songLeader: existing.songLeader, backupSingers: existing.backupSingers || [], date: dateStr, slowSongs: existing.slowSongs || [], fastSongs: existing.fastSongs || [] });
        return;
      }
      // This is their assigned date — open form to add/edit songs
      setLineupSelectedDate(dateStr);
      setEditingLineup(existing);
      setLineupForm({
        scheduleDate: existing.scheduleDate,
        practiceDate: existing.practiceDate || '',
        songLeader: existing.songLeader,
        backupSingers: existing.backupSingers?.length ? existing.backupSingers : [''],
        slowSongs: existing.slowSongs?.length ? existing.slowSongs : [{ title: '', link: '', lyrics: '', instructions: '' }],
        fastSongs: existing.fastSongs?.length ? existing.fastSongs : [{ title: '', link: '', lyrics: '', instructions: '' }],
      });
      setLineupView('form');
    }
  };

  const submitLineup = async () => {
    if (!lineupForm.scheduleDate) { showToast('Schedule date is required', 'warning'); return; }

    // Admin only assigns — no songs required
    if (isAdmin) {
      if (!lineupForm.songLeader) { showToast('Please select a Song Leader', 'warning'); return; }
    } else {
      // Song Leader must add at least one song
      if (!lineupForm.slowSongs.some(s => s.title) && !lineupForm.fastSongs.some(s => s.title)) { showToast('Please add at least one song', 'warning'); return; }
    }

    const songLeaderName = lineupForm.songLeader || (userData ? `${userData.firstname} ${userData.lastname}` : '');
    if (!songLeaderName) { showToast('Please select a Song Leader', 'warning'); return; }

    // Find song leader's ID for notifications (admin created lineups)
    let songLeaderId = null;
    if (isAdmin) {
      const leaderMatch = songLeaderOptions.find(sl => sl.name === songLeaderName);
      if (leaderMatch) songLeaderId = leaderMatch.id;
    }

    setLineupLoading(true);
    try {
      const isEditing = !!editingLineup;
      const res = await fetch('/api/schedules', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing && { scheduleId: editingLineup.scheduleId }),
          songLeader: songLeaderName, scheduleDate: lineupForm.scheduleDate,
          practiceDate: lineupForm.practiceDate || null, backupSingers: lineupForm.backupSingers.filter(Boolean),
          slowSongs: lineupForm.slowSongs.filter((s) => s.title), fastSongs: lineupForm.fastSongs.filter((s) => s.title),
          submittedBy: userData?.email,
          songLeaderId: songLeaderId,
          notifyLeader: isAdmin && songLeaderId ? true : false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLineupView('success');
        loadScheduleData();
        setTimeout(() => { resetLineupForm(); }, 3000);
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setLineupLoading(false); }
  };

  const deleteLineup = async (scheduleId) => {
    try {
      const res = await fetch(`/api/schedules?scheduleId=${scheduleId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Lineup deleted successfully!', 'success'); loadScheduleData(); setDeleteConfirmId(null); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const startEditLineup = (lineup) => {
    setEditingLineup(lineup);
    setLineupForm({
      scheduleDate: lineup.scheduleDate, practiceDate: lineup.practiceDate || '',
      songLeader: lineup.songLeader, backupSingers: lineup.backupSingers?.length ? lineup.backupSingers : [''],
      slowSongs: lineup.slowSongs?.length ? lineup.slowSongs : [{ title: '', link: '', lyrics: '', instructions: '' }],
      fastSongs: lineup.fastSongs?.length ? lineup.fastSongs : [{ title: '', link: '', lyrics: '', instructions: '' }],
    });
    setLineupView('form');
    setActiveSection('create-lineup');
    if (isAdmin) { loadBackupSingers(); loadSongLeaders(); }
  };

  // Get lineups: admin sees all, song leader sees own
  const getMyLineups = () => {
    if (isAdmin) {
      return scheduleData.sort((a, b) => new Date(b.scheduleDate) - new Date(a.scheduleDate));
    }
    return scheduleData.filter(s => s.submittedBy === userData?.email || s.songLeader === `${userData?.firstname} ${userData?.lastname}`).sort((a, b) => new Date(b.scheduleDate) - new Date(a.scheduleDate));
  };

  // Get dates where current user is assigned as Song Leader (for calendar highlight)
  const getAssignedDates = () => {
    if (!userData) return [];
    const myName = `${userData.firstname} ${userData.lastname}`;
    return scheduleData.filter(s => s.songLeader === myName).map(s => s.scheduleDate);
  };

  // Get backup singers for a date where current user is assigned as Song Leader
  const getAssignedBackups = (dateStr) => {
    const schedule = scheduleData.find(s => s.scheduleDate === dateStr);
    return schedule?.backupSingers || [];
  };

  // Lineup calendar helpers
  const getLineupCalendarDays = () => {
    const year = lineupCalendarMonth.getFullYear();
    const month = lineupCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  };

  const isLineupDateTaken = (day) => {
    if (!day) return false;
    const dateStr = `${lineupCalendarMonth.getFullYear()}-${String(lineupCalendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return scheduleData.some(s => s.scheduleDate === dateStr);
  };

  const isLineupDatePast = (day) => {
    if (!day) return false;
    const date = new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth(), day);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // ============================================
  // BIBLE READER & CHAT (from original)
  // ============================================
  const loadBibleChapter = async (book, chapter, verse, version) => {
    const b = book || bibleBook;
    const c = chapter || bibleChapter;
    const v = verse || bibleVerse;
    const ver = version || bibleVersion;
    setBibleText('Loading...');
    setBibleAnswer('');
    const verseReq = v ? ` verse ${v}` : '';
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === ver)?.fullName || ver;
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `You are a Bible text provider. Provide the full text of the requested Bible chapter or verse. Use the ${versionLabel} translation. Include verse numbers. If the translation is Cebuano, provide the Cebuano version (Ang Pulong Sa Dios or similar). If Tagalog, provide the Tagalog version (Ang Salita ng Dios or similar). Be accurate to the requested translation.` }, { role: 'user', content: `Provide the full text of ${b} chapter ${c}${verseReq} in the ${versionLabel} translation.` }], temperature: 0.1, max_tokens: 4000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleText(content || 'Error loading chapter. Please try again.');
    } catch { setBibleText('Error loading chapter. Please try again.'); }
  };

  // Get verse count for a specific book and chapter
  const getVerseCount = (book, chapter) => {
    const chapters = VERSES_PER_CHAPTER[book];
    if (!chapters || chapter < 1 || chapter > chapters.length) return 30; // fallback
    return chapters[chapter - 1];
  };

  // Direct scripture lookup: e.g. "Ephesians 6:1" or "1 John 3:16"
  const loadDirectScripture = () => {
    if (!directScripture.trim()) return;
    const match = directScripture.trim().match(/^(\d?\s?[A-Za-z\s]+?)\s+(\d+)(?::(\d+(?:-\d+)?))?$/i);
    if (!match) { setBibleText('Invalid format. Try: "Ephesians 6:1" or "John 3:16-17"'); return; }
    const bookName = match[1].trim();
    const chap = parseInt(match[2]);
    const verse = match[3] || '';
    // Find matching book
    const found = Object.keys(BIBLE_BOOKS).find(b => b.toLowerCase() === bookName.toLowerCase());
    if (!found) { setBibleText(`Book "${bookName}" not found. Check spelling.`); return; }
    setBibleBook(found);
    setBibleChapter(chap);
    setBibleVerse(verse);
    loadBibleChapter(found, chap, verse);
  };

  const askBibleQuestionHandler = async () => {
    if (!bibleQuestion.trim()) return;
    setBibleAnswer('Thinking...');
    setAnswerCopied(false);
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === bibleVersion)?.fullName || bibleVersion;
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `Answer questions about ${bibleBook} ${bibleChapter} (${versionLabel} translation). Be biblical and insightful. Use markdown headings (**Context:**, **Meaning:**, **Application:**). Keep it well structured.` }, { role: 'user', content: bibleQuestion }], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleAnswer(content || 'Error. Please try again.');
    } catch { setBibleAnswer('Error. Please try again.'); }
  };

  const copyBibleAnswer = () => {
    if (!bibleAnswer) return;
    navigator.clipboard.writeText(bibleAnswer).then(() => {
      setAnswerCopied(true);
      setTimeout(() => setAnswerCopied(false), 2000);
    });
  };

  // Highlight-to-Ask: detect text selection in Bible text
  useEffect(() => {
    const handleSelection = (e) => {
      // Don't dismiss popup if clicking the Ask button itself
      if (e.target.closest && e.target.closest('.highlight-ask-btn')) return;
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText && bibleTextRef.current && bibleTextRef.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = bibleTextRef.current.getBoundingClientRect();
        setHighlightPopup({
          visible: true,
          x: rect.left - parentRect.left + rect.width / 2,
          y: rect.top - parentRect.top - 10,
          text: selectedText,
        });
      } else if (!selectedText) {
        // Only hide if there's no selection at all
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || !sel.toString().trim()) {
            setHighlightPopup(prev => prev.visible ? { ...prev, visible: false } : prev);
          }
        }, 200);
      }
    };
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, []);

  const askHighlightedText = () => {
    if (!highlightPopup.text) return;
    const question = `Explain this scripture: "${highlightPopup.text}"`;
    setBibleQuestion(question);
    setHighlightPopup({ visible: false, x: 0, y: 0, text: '' });
    window.getSelection()?.removeAllRanges();
    setAnswerCopied(false);
    setBibleAnswer('Thinking...');
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === bibleVersion)?.fullName || bibleVersion;
    fetch(GROQ_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `Answer questions about ${bibleBook} ${bibleChapter} (${versionLabel} translation). Be biblical and insightful. Use markdown headings (**Context:**, **Meaning:**, **Application:**). Keep it well structured.` }, { role: 'user', content: question }], temperature: 0.7, max_tokens: 1000 }),
    }).then(r => r.json()).then(data => {
      setBibleAnswer(data?.choices?.[0]?.message?.content || 'Error. Please try again.');
    }).catch(() => setBibleAnswer('Error. Please try again.'));
  };

  const fetchDailyQuote = async () => {
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: 'Generate an inspiring Christian quote. Format: QUOTE|AUTHOR' }, { role: 'user', content: 'Give me one inspiring Christian quote for today.' }], temperature: 0.9, max_tokens: 200 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No response');
      const parts = content.split('|');
      setDailyQuote({ quote: parts[0]?.trim() || 'Faith is taking the first step even when you don\'t see the whole staircase.', author: parts[1]?.trim() || 'Martin Luther King Jr.' });
    } catch { setDailyQuote({ quote: 'Faith is taking the first step even when you don\'t see the whole staircase.', author: 'Martin Luther King Jr.' }); }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages((p) => [...p, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      // Build conversation history from memory (last 20 messages for context)
      const historyMessages = chatMessages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [
          { role: 'system', content: `You are a compassionate Christian spiritual AI advisor for ${userData?.firstname || 'a believer'} who serves in ${userData?.ministry || 'ministry'}. Provide biblical guidance, prayer support, and encouragement. Use Scripture references when appropriate. You have memory of previous conversations with this user — use the conversation history to provide personalized and contextual responses. Always remind yourself: you are an AI assistant; encourage the user to also seek God directly through prayer and His Word.` },
          ...historyMessages,
          { role: 'user', content: msg }
        ], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No response');
      setChatMessages((p) => [...p, { role: 'assistant', content }]);
    } catch { setChatMessages((p) => [...p, { role: 'assistant', content: 'I apologize, but I encountered an error. Please try again.' }]); }
    finally { setChatLoading(false); }
  };

  // Clear chat memory
  const clearChatMemory = () => {
    const chatKey = `chatMemory_${userData?.email || userData?.id}`;
    localStorage.removeItem(chatKey);
    setChatMessages([{ role: 'assistant', content: `Chat history cleared! 🙏 Hello ${userData?.firstname || 'friend'}, how can I help you today?\n\n⚠️ Disclaimer: While I can provide biblical guidance and encouragement, it is important that you also maintain your personal communication with God through prayer and His Word to receive true wisdom. I am just your AI Assistant — the Holy Spirit is your ultimate Counselor and Guide.` }]);
    showToast('Chat history cleared', 'success');
  };

  // ============================================
  // PROFILE HANDLERS (from original)
  // ============================================
  const saveProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, firstname: profileForm.firstname, lastname: profileForm.lastname }) });
      const data = await res.json();
      if (data.success) { const updated = { ...userData, firstname: profileForm.firstname, lastname: profileForm.lastname }; setUserData(updated); sessionStorage.setItem('userData', JSON.stringify(updated)); showToast('Profile updated!', 'success'); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  const changePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { showToast('Passwords do not match', 'warning'); return; }
    if (passwordForm.newPassword.length < 8) { showToast('Password must be at least 8 characters', 'warning'); return; }
    setProfileLoading(true);
    try {
      const verifyRes = await fetch('/api/profile/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, password: passwordForm.currentPassword }) });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) { showToast('Current password is incorrect', 'danger'); setProfileLoading(false); return; }

      const res = await fetch('/api/profile/update-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, newPassword: passwordForm.newPassword }) });
      const data = await res.json();
      if (data.success) { showToast('Password updated!', 'success'); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  const handleSetPassword = async () => {
    if (setPasswordFormData.newPassword !== setPasswordFormData.confirmPassword) { showToast('Passwords do not match', 'warning'); return; }
    if (setPasswordFormData.newPassword.length < 8) { showToast('Password must be at least 8 characters', 'warning'); return; }
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, newPassword: setPasswordFormData.newPassword }) });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        setSetPasswordFormData({ newPassword: '', confirmPassword: '' });
        setHasLocalPassword(true);
        const updated = { ...userData, hasPassword: true };
        setUserData(updated);
        sessionStorage.setItem('userData', JSON.stringify(updated));
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  // ============================================
  // LOGOUT
  // ============================================
  const confirmLogout = () => { sessionStorage.removeItem('userData'); localStorage.removeItem('userData'); router.replace('/login'); };

  // ============================================
  // HELPERS
  // ============================================
  const generateCalendar = () => {
    const year = calendarDate.getFullYear(); const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks = []; let days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) { days.push(d); if (days.length === 7) { weeks.push(days); days = []; } }
    if (days.length > 0) { while (days.length < 7) days.push(null); weeks.push(days); }
    return weeks;
  };

  const hasSchedule = (day) => {
    if (!day) return false;
    const dateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return scheduleData.some((s) => s.scheduleDate === dateStr);
  };

  const getScheduleForDate = (dateStr) => scheduleData.find((s) => s.scheduleDate === dateStr);
  const formatDate = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); };
  const formatDateTime = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const extractYouTubeId = (url) => { if (!url) return null; const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/); return m ? m[1] : null; };

  const getTodaysBirthdays = () => {
    const today = new Date(); const m = today.getMonth() + 1; const d = today.getDate();
    return birthdayData.filter((b) => { if (!b.birthdate) return false; const bd = new Date(b.birthdate); return bd.getMonth() + 1 === m && bd.getDate() === d; });
  };

  const getUpcomingBirthdays = (days = 30) => {
    const today = new Date(); const end = new Date(today.getTime() + days * 86400000);
    return birthdayData.filter((b) => { if (!b.birthdate) return false; const bd = new Date(b.birthdate); bd.setFullYear(today.getFullYear()); return bd > today && bd <= end; }).sort((a, b) => { const ad = new Date(a.birthdate); ad.setFullYear(today.getFullYear()); const bd2 = new Date(b.birthdate); bd2.setFullYear(today.getFullYear()); return ad - bd2; });
  };

  const todaysBirthdays = getTodaysBirthdays();
  const upcomingBirthdays = getUpcomingBirthdays(30);

  // ============================================
  // RENDER GUARD
  // ============================================
  if (!userData) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ width: 80, height: 80, backgroundImage: "url('/assets/LOGO.png')", backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', marginBottom: 20 }}></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const initials = `${userData.firstname?.[0] || ''}${userData.lastname?.[0] || ''}`.toUpperCase();
  const dashboardType = getDashboardType(userRole);
  const sidebarMenu = getSidebarMenu(userRole, userData);
  const canManage = (module) => hasPermission(userRole, module);

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="dashboard-wrapper">
      {/* Toast */}
      {toastMessage && <div className={`toast-notification toast-${toastMessage.type}`}>{toastMessage.message}</div>}

      {/* Welcome Modal */}
      {showWelcomeModal && (
        <div className="welcome-modal-overlay" onClick={() => {
          const welcomeKey = `welcomed_${userData?.email || userData?.id}`;
          localStorage.setItem(welcomeKey, 'true');
          setShowWelcomeModal(false);
        }}>
          <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
            <div className="welcome-modal-glow"></div>
            <div className="welcome-modal-header">
              <div className="welcome-modal-cross">✝</div>
              <h2>Welcome to Joyful Sound Church</h2>
              <p className="welcome-modal-subtitle">International Ministry Portal</p>
            </div>
            <div className="welcome-modal-body">
              <div className="welcome-modal-greeting">
                <span className="welcome-wave">👋</span>
                <h3>Hello, {userData?.firstname || 'Beloved'}!</h3>
                <p>We&apos;re so glad you&apos;re here. God has a wonderful plan for you.</p>
              </div>
              <div className="welcome-modal-verse">
                <div className="verse-icon">📖</div>
                <blockquote>&ldquo;{welcomeVerse.verse}&rdquo;</blockquote>
                <cite>— {welcomeVerse.reference}</cite>
              </div>
              <button className="welcome-modal-btn" onClick={() => {
                const welcomeKey = `welcomed_${userData?.email || userData?.id}`;
                localStorage.setItem(welcomeKey, 'true');
                setShowWelcomeModal(false);
              }}>
                <i className="fas fa-dove"></i> Begin My Journey
              </button>
            </div>
            <div className="welcome-modal-footer">
              <span>🕊️ The joy of the Lord is your strength — Nehemiah 8:10</span>
            </div>
          </div>
        </div>
      )}

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="logout-modal" style={{ display: 'flex' }}>
          <div className="logout-modal-content">
            <div className="logout-modal-header">
              <div className="logout-modal-icon"><i className="fas fa-sign-out-alt"></i></div>
              <h3>Confirm Logout</h3><p>Ministry Portal</p>
            </div>
            <div className="logout-modal-body">
              <p>Are you sure you want to logout from your account?</p>
              <div className="logout-modal-actions">
                <button className="logout-modal-btn logout-modal-cancel" onClick={() => setShowLogoutModal(false)}><i className="fas fa-times"></i> Cancel</button>
                <button className="logout-modal-btn logout-modal-confirm" onClick={confirmLogout}><i className="fas fa-sign-out-alt"></i> Logout</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Detail Modal */}
      {selectedSchedule && (
        <div className="schedule-modal" style={{ display: 'flex' }} onClick={() => setSelectedSchedule(null)}>
          <div className="schedule-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="schedule-modal-header">
              <h3><i className="fas fa-calendar-alt"></i> Schedule Details</h3>
              <button className="modal-close-btn" onClick={() => setSelectedSchedule(null)}><i className="fas fa-times"></i></button>
            </div>
            <div className="schedule-modal-body">
              <p><strong>Date:</strong> {formatDate(selectedSchedule.scheduleDate)}</p>
              <p><strong>Song Leader:</strong> {selectedSchedule.songLeader}</p>
              {selectedSchedule.backupSingers?.length > 0 && <p><strong>Backup:</strong> {selectedSchedule.backupSingers.join(', ')}</p>}
              {selectedSchedule.practiceDate && <p><strong>Practice:</strong> {formatDate(selectedSchedule.practiceDate)}</p>}
              {selectedSchedule.slowSongs?.length > 0 && (
                <div className="song-section"><h4><i className="fas fa-music"></i> Slow Songs</h4>
                  {selectedSchedule.slowSongs.map((song, i) => (
                    <div key={i} className="song-detail-card">
                      <p className="song-title">{song.title}</p>
                      {song.link && extractYouTubeId(song.link) && <div className="youtube-embed"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                      {song.lyrics && <pre className="song-lyrics">{song.lyrics}</pre>}
                      {song.instructions && <p className="song-instructions"><strong>Instructions:</strong> {song.instructions}</p>}
                    </div>
                  ))}
                </div>
              )}
              {selectedSchedule.fastSongs?.length > 0 && (
                <div className="song-section"><h4><i className="fas fa-bolt"></i> Fast Songs</h4>
                  {selectedSchedule.fastSongs.map((song, i) => (
                    <div key={i} className="song-detail-card">
                      <p className="song-title">{song.title}</p>
                      {song.link && extractYouTubeId(song.link) && <div className="youtube-embed"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                      {song.lyrics && <pre className="song-lyrics">{song.lyrics}</pre>}
                      {song.instructions && <p className="song-instructions"><strong>Instructions:</strong> {song.instructions}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Toggle */}
      <button className="mobile-menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
      {sidebarOpen && <div className="overlay active" onClick={() => setSidebarOpen(false)}></div>}

      <div className="dashboard-container">
        {/* ============ SIDEBAR ============ */}
        <aside className={`sidebar ${sidebarOpen ? 'active' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Top: Logo + Brand (vertical) */}
          <div className="sidebar-top">
            <div className="sidebar-brand">
              <div className="logo">
                <img src="/assets/LOGO.png" alt="JSCI Logo" />
              </div>
              <div className="brand-text">
                <span className="brand-name">JOYFUL SOUND</span>
                <span className="brand-sub">CHURCH INTERNATIONAL</span>
              </div>
            </div>
          </div>

          {/* Menu */}
          <nav className="sidebar-menu">
            <div className="menu-section-label">Menu</div>
            {sidebarMenu.map((item) => {
              const isGuestRole = userRole === 'Guest';
              const isLocked = !isVerified && !isGuestRole && item.section !== 'home';
              return (
                <a key={item.id}
                  className={`menu-item ${activeSection === item.section ? 'active' : ''} ${isLocked ? 'disabled' : ''}`}
                  onClick={() => showSection(item.section)}
                  title={sidebarCollapsed ? item.label : ''}
                >
                  <span className="menu-icon"><i className={item.icon}></i></span>
                  <span className="menu-label">{item.label}</span>
                  {item.section === 'messages' && unreadCount > 0 && (
                    <span className="notification-badge">{unreadCount}</span>
                  )}
                  {isLocked && (
                    <span className="menu-lock"><i className="fas fa-lock"></i></span>
                  )}
                </a>
              );
            })}
          </nav>

          {/* Bottom: Collapse toggle + User card + Logout + Theme */}
          <div className="sidebar-bottom">
            <button className="collapse-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? 'Expand' : 'Collapse'}>
              <i className={`fas fa-chevron-${sidebarCollapsed ? 'right' : 'left'}`}></i>
              <span className="collapse-label">{sidebarCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
            <div className="sidebar-user-card" onClick={() => showSection('my-profile')}>
              <div className="sidebar-avatar">
                {userData.profile_picture ? (
                  <img src={userData.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar-initials">{initials}</span>
                )}
                <div className={`sidebar-status-dot ${isVerified ? 'verified' : 'unverified'}`}></div>
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{userData.firstname} {userData.lastname}</div>
                <div className="sidebar-user-email">{userData.email}</div>
              </div>
              <div className="sidebar-role-pill">{userRole}</div>
            </div>

            <button className="logout-btn" onClick={() => setShowLogoutModal(true)}>
              <i className="fas fa-sign-out-alt"></i>
              <span className="logout-label">Logout</span>
            </button>

            <div className="sidebar-theme-toggle">
              <button className={`theme-btn ${!darkMode ? 'active' : ''}`} onClick={() => { if (darkMode) toggleDarkMode(); }}>
                <i className="fas fa-sun"></i> <span className="theme-label">Light</span>
              </button>
              <button className={`theme-btn ${darkMode ? 'active' : ''}`} onClick={() => { if (!darkMode) toggleDarkMode(); }}>
                <i className="fas fa-moon"></i> <span className="theme-label">Dark</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ============ MAIN CONTENT ============ */}
        <main className="main-content">

          {!isVerified && userRole !== 'Guest' && (
            <div className="verification-banner">
              <h3><i className="fas fa-lock"></i> Account Pending Verification</h3>
              <p>Your account is currently under review. Please wait for administrator verification to access all features.</p>
            </div>
          )}

          {/* ========== HOME SECTION ========== */}
          <section className={`content-section ${activeSection === 'home' ? 'active' : ''}`}>
            <h2 className="section-title">Home</h2>
            {isVerified ? (
              <>
                <div className="welcome-card">
                  <div className="welcome-card-glow"></div>
                  <div className="welcome-card-abstract">
                    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="120" cy="80" r="60" fill="rgba(255,195,0,0.06)" />
                      <circle cx="160" cy="120" r="45" fill="rgba(255,195,0,0.04)" />
                      <circle cx="80" cy="140" r="30" fill="rgba(255,255,255,0.03)" />
                      <path d="M10,180 Q60,100 120,160 T200,100" stroke="rgba(255,195,0,0.12)" strokeWidth="1.5" fill="none" />
                      <path d="M0,140 Q80,60 160,130 T240,80" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
                      <path d="M30,200 Q100,120 180,180" stroke="rgba(255,195,0,0.08)" strokeWidth="1" fill="none" />
                    </svg>
                  </div>
                  <div className="welcome-card-content">
                    <div className="welcome-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                    <h2 className="welcome-greeting">{(() => {
                      const greetings = [
                        `Welcome home, ${userData.firstname}. We're so glad you're here.`,
                        `It's a joy to see you, ${userData.firstname}.`,
                        `You are a blessing to this ministry, ${userData.firstname}.`,
                        `We're better because you're here, ${userData.firstname}.`,
                        `You belong here, ${userData.firstname}.`,
                        `Grace and peace to you, ${userData.firstname}.`,
                        `May God refresh your heart today, ${userData.firstname}.`,
                        `The Lord has something beautiful for you today, ${userData.firstname}.`,
                        `Walk boldly in faith today, ${userData.firstname}.`,
                        `Your service matters, ${userData.firstname}. Heaven sees it.`,
                        `Welcome, ${userData.firstname}. Thank you for serving faithfully.`,
                        `Your dedication blesses many, ${userData.firstname}.`,
                        `Lead with love today, ${userData.firstname}.`,
                        `Your impact in this ministry is powerful, ${userData.firstname}.`,
                        `Let's serve with excellence today, ${userData.firstname}.`,
                        `Welcome, ${userData.firstname}. Let's grow together.`,
                        `Good to see you, ${userData.firstname}.`,
                        `Shine for His glory today, ${userData.firstname}.`,
                        `Ready for today's mission, ${userData.firstname}?`,
                        `Glad you're here, ${userData.firstname}.`,
                      ];
                      const dayIndex = new Date().getDate() % greetings.length;
                      return greetings[dayIndex];
                    })()}</h2>
                  </div>
                </div>

                {/* Dashboard Stats */}
                {(dashboardType === 'admin' || dashboardType === 'super-admin' || dashboardType === 'pastor') && (
                  <div className="stats-container">
                    <div className="stat-card" onClick={() => showSection('user-management')}><div className="stat-icon"><i className="fas fa-users"></i></div><div className="stat-value">{adminUsers.length || '—'}</div><div className="stat-label">Total Users</div></div>
                    <div className="stat-card" onClick={() => showSection('events-management')}><div className="stat-icon"><i className="fas fa-calendar-alt"></i></div><div className="stat-value">{events.length || '—'}</div><div className="stat-label">Events</div></div>
                    <div className="stat-card" onClick={() => showSection('announcements-management')}><div className="stat-icon"><i className="fas fa-bullhorn"></i></div><div className="stat-value">{announcements.length || '—'}</div><div className="stat-label">Announcements</div></div>
                    <div className="stat-card"><div className="stat-icon"><i className="fas fa-church"></i></div><div className="stat-value">{ministriesList.length || '4'}</div><div className="stat-label">Ministries</div></div>
                  </div>
                )}

                {/* Bible Verse */}
                <div className="bible-verse-container">
                  <div className="verse-of-the-day">&ldquo;{dailyVerse.verse}&rdquo;</div>
                  <div className="verse-reference">— {dailyVerse.reference}</div>
                  {dailyVerse.explanation && <div className="verse-explanation">{dailyVerse.explanation}</div>}
                </div>

                {/* Pastors (Ministry view only) */}
                {dashboardType === 'ministry' && (
                  <>
                    <div className="pastors-section">
                      <div className="pastors-big-title">OUR PASTORS</div>
                      <div className="pastors-carousel">
                        <div className="pastors-backdrop">
                          <svg viewBox="0 0 900 480" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                            <defs>
                              {/* Golden flare gradient */}
                              <radialGradient id="pgFlare1" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,195,0,0.28)" />
                                <stop offset="40%" stopColor="rgba(201,152,11,0.12)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </radialGradient>
                              <radialGradient id="pgFlare2" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,195,0,0.22)" />
                                <stop offset="50%" stopColor="rgba(201,152,11,0.08)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </radialGradient>
                              <radialGradient id="pgFlare3" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,215,80,0.18)" />
                                <stop offset="100%" stopColor="rgba(255,195,0,0)" />
                              </radialGradient>
                              {/* Sweep line gradients */}
                              <linearGradient id="pgSweep1" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="rgba(146,108,21,0)" />
                                <stop offset="30%" stopColor="rgba(201,152,11,0.25)" />
                                <stop offset="70%" stopColor="rgba(201,152,11,0.25)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </linearGradient>
                              <linearGradient id="pgSweep2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="rgba(146,108,21,0)" />
                                <stop offset="50%" stopColor="rgba(255,195,0,0.15)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </linearGradient>
                              {/* Star sparkle */}
                              <filter id="pgGlow">
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                              </filter>
                            </defs>

                            {/* === Large ambient golden flares === */}
                            <ellipse cx="450" cy="240" rx="350" ry="200" fill="url(#pgFlare1)" />
                            <ellipse cx="200" cy="200" rx="220" ry="160" fill="url(#pgFlare2)" />
                            <ellipse cx="720" cy="220" rx="220" ry="160" fill="url(#pgFlare2)" />
                            {/* Smaller accent flares */}
                            <ellipse cx="100" cy="120" rx="100" ry="80" fill="url(#pgFlare3)" />
                            <ellipse cx="800" cy="100" rx="110" ry="80" fill="url(#pgFlare3)" />
                            <ellipse cx="450" cy="400" rx="250" ry="80" fill="url(#pgFlare3)" />

                            {/* === Sweeping elegant arcs === */}
                            <path d="M0,380 Q250,80 450,200 Q650,320 900,80" stroke="url(#pgSweep1)" strokeWidth="1.5" fill="none" />
                            <path d="M0,320 Q300,120 500,240 Q700,360 900,160" stroke="rgba(201,152,11,0.15)" strokeWidth="1" fill="none" />
                            <path d="M50,400 Q450,20 850,400" stroke="url(#pgSweep2)" strokeWidth="1.2" fill="none" />
                            <path d="M100,420 Q450,80 800,420" stroke="rgba(146,108,21,0.1)" strokeWidth="0.8" fill="none" />

                            {/* === Decorative golden circles === */}
                            <circle cx="120" cy="160" r="90" stroke="rgba(201,152,11,0.12)" strokeWidth="1" fill="none" />
                            <circle cx="120" cy="160" r="60" stroke="rgba(201,152,11,0.08)" strokeWidth="0.6" fill="none" />
                            <circle cx="780" cy="180" r="100" stroke="rgba(201,152,11,0.12)" strokeWidth="1" fill="none" />
                            <circle cx="780" cy="180" r="65" stroke="rgba(201,152,11,0.08)" strokeWidth="0.6" fill="none" />
                            <circle cx="450" cy="240" r="220" stroke="rgba(146,108,21,0.06)" strokeWidth="0.8" fill="none" />
                            <circle cx="450" cy="240" r="280" stroke="rgba(146,108,21,0.04)" strokeWidth="0.5" fill="none" />

                            {/* === Bokeh dots === */}
                            <circle cx="80" cy="100" r="6" fill="rgba(255,195,0,0.18)" />
                            <circle cx="160" cy="60" r="4" fill="rgba(255,195,0,0.14)" />
                            <circle cx="60" cy="300" r="5" fill="rgba(201,152,11,0.16)" />
                            <circle cx="840" cy="90" r="5" fill="rgba(255,195,0,0.18)" />
                            <circle cx="800" cy="340" r="6" fill="rgba(201,152,11,0.16)" />
                            <circle cx="870" cy="260" r="4" fill="rgba(255,195,0,0.12)" />
                            <circle cx="300" cy="50" r="3.5" fill="rgba(255,195,0,0.14)" />
                            <circle cx="600" cy="40" r="3" fill="rgba(255,195,0,0.12)" />
                            <circle cx="350" cy="420" r="4" fill="rgba(201,152,11,0.14)" />
                            <circle cx="550" cy="430" r="3.5" fill="rgba(201,152,11,0.12)" />

                            {/* === Diamond sparkles with glow === */}
                            <g filter="url(#pgGlow)">
                              <path d="M130,90 L138,102 L130,114 L122,102 Z" fill="rgba(255,195,0,0.25)" />
                              <path d="M770,80 L778,92 L770,104 L762,92 Z" fill="rgba(255,195,0,0.25)" />
                              <path d="M50,250 L56,260 L50,270 L44,260 Z" fill="rgba(201,152,11,0.2)" />
                              <path d="M850,280 L856,290 L850,300 L844,290 Z" fill="rgba(201,152,11,0.2)" />
                            </g>

                            {/* === Cross sparkle accents (4-pointed stars) === */}
                            <g filter="url(#pgGlow)">
                              <path d="M90,200 L93,190 L96,200 L93,210 Z" fill="rgba(255,215,80,0.3)" />
                              <path d="M88,197 L93,194 L98,197 L93,200 Z" fill="rgba(255,215,80,0.3)" />
                            </g>
                            <g filter="url(#pgGlow)">
                              <path d="M810,160 L813,150 L816,160 L813,170 Z" fill="rgba(255,215,80,0.3)" />
                              <path d="M808,157 L813,154 L818,157 L813,160 Z" fill="rgba(255,215,80,0.3)" />
                            </g>
                            <g filter="url(#pgGlow)">
                              <path d="M450,60 L453,48 L456,60 L453,72 Z" fill="rgba(255,215,80,0.2)" />
                              <path d="M447,57 L453,54 L459,57 L453,60 Z" fill="rgba(255,215,80,0.2)" />
                            </g>

                            {/* === Horizontal ornamental lines === */}
                            <line x1="60" y1="240" x2="360" y2="240" stroke="url(#pgSweep2)" strokeWidth="0.8" />
                            <line x1="540" y1="240" x2="840" y2="240" stroke="url(#pgSweep2)" strokeWidth="0.8" />
                          </svg>
                        </div>
                        <div className="pastors-carousel-track">
                          {PASTORS.map((p, i) => {
                            const offset = (i - pastorCarouselIndex + PASTORS.length) % PASTORS.length;
                            const isCenter = offset === 0;
                            const isLeft1 = offset === PASTORS.length - 1;
                            const isRight1 = offset === 1;
                            const isLeft2 = offset === PASTORS.length - 2;
                            const isRight2 = offset === 2;
                            let posClass = 'pastors-card-hidden';
                            if (isCenter) posClass = 'pastors-card-center';
                            else if (isLeft1) posClass = 'pastors-card-left-1';
                            else if (isRight1) posClass = 'pastors-card-right-1';
                            else if (isLeft2) posClass = 'pastors-card-left-2';
                            else if (isRight2) posClass = 'pastors-card-right-2';
                            return (
                              <div key={i} className={`pastors-carousel-card ${posClass}`} onClick={() => setPastorCarouselIndex(i)}>
                                <div className="pastors-carousel-img" style={{ backgroundImage: `url('${p.photo}')` }}></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="pastors-carousel-dots">
                        {PASTORS.map((_, i) => (<span key={i} className={`pastors-dot ${i === pastorCarouselIndex ? 'active' : ''}`} onClick={() => setPastorCarouselIndex(i)}></span>))}
                      </div>
                      <div className="pastors-carousel-info">
                        <div className="pastors-carousel-name">
                          <span className="pastors-name-line"></span>
                          <span>{PASTORS[pastorCarouselIndex].name}</span>
                          <span className="pastors-name-line"></span>
                        </div>
                        <div className="pastors-carousel-role">
                          <span className="pastors-role-arrow">&#9664;</span>
                          <span>{PASTORS[pastorCarouselIndex].title}</span>
                          <span className="pastors-role-arrow">&#9654;</span>
                        </div>
                      </div>
                    </div>
                    <div className="church-family-section">
                      <h2>Our Church Family Gatherings</h2>
                      <p style={{ color: '#6c757d', marginBottom: 20 }}>Celebrating fellowship and community</p>
                      <div className="family-gathering-grid">
                        {GATHERINGS.map((g, i) => (<div key={i} className="gathering-card"><div className="gathering-photo" style={{ backgroundImage: `url('${g.photo}')`, backgroundColor: '#e9ecef' }}></div><div className="gathering-info"><div className="gathering-title">{g.title}</div><div className="gathering-description">{g.desc}</div></div></div>))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div>
                <div className="welcome-message"><h2>Welcome, {userData.firstname}!</h2><p>Your account is pending verification.</p></div>
                <div className="bible-verse-container">
                  <div className="verse-of-the-day">&ldquo;For I know the plans I have for you,&rdquo; declares the Lord, &ldquo;plans to prosper you and not to harm you, plans to give you hope and a future.&rdquo;</div>
                  <div className="verse-reference">— Jeremiah 29:11</div>
                </div>
                <div className="stats-container">
                  <div className="stat-card"><div className="stat-icon"><i className="fas fa-hourglass-half"></i></div><div className="stat-value">Pending</div><div className="stat-label">Account Status</div></div>
                  <div className="stat-card"><div className="stat-icon"><i className="fas fa-clock"></i></div><div className="stat-value">24-48h</div><div className="stat-label">Verification Time</div></div>
                </div>
              </div>
            )}
          </section>

          {/* ========== WEEKLY SCHEDULE ========== */}
          <section className={`content-section ${activeSection === 'weekly-schedule' ? 'active' : ''}`}>
            <h2 className="section-title">Weekly Schedule</h2>
            <div className="schedule-calendar">
              <div className="calendar-header">
                <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}><i className="fas fa-chevron-left"></i></button>
                <h3>{calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}><i className="fas fa-chevron-right"></i></button>
              </div>
              <table className="calendar-table"><thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>{generateCalendar().map((week, wi) => (
                  <tr key={wi}>{week.map((day, di) => {
                    const dateStr = day ? `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                    const hasEvent = hasSchedule(day);
                    const isToday = day && new Date().toDateString() === new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day).toDateString();
                    return (<td key={di} className={`calendar-day ${!day ? 'empty' : ''} ${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}`} onClick={() => { if (hasEvent) { const s = getScheduleForDate(dateStr); if (s) setSelectedSchedule(s); } }}>{day && <span className="day-number">{day}</span>}{hasEvent && <span className="event-dot"></span>}</td>);
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
            <h3 style={{ margin: '20px 0 10px', color: 'var(--primary)' }}><i className="fas fa-clock"></i> Upcoming Services</h3>
            <div className="schedule-cards">
              {scheduleData.filter((s) => new Date(s.scheduleDate) >= new Date()).sort((a, b) => new Date(a.scheduleDate) - new Date(b.scheduleDate)).slice(0, 6).map((s, i) => (
                <div key={i} className="upcoming-schedule-card" onClick={() => setSelectedSchedule(s)}>
                  <div className="schedule-card-date">{formatDate(s.scheduleDate)}</div>
                  <div className="schedule-card-leader"><i className="fas fa-microphone"></i> {s.songLeader}</div>
                  <div className="schedule-card-songs">{s.slowSongs?.length || 0} slow • {s.fastSongs?.length || 0} fast songs</div>
                </div>
              ))}
              {scheduleData.filter((s) => new Date(s.scheduleDate) >= new Date()).length === 0 && <p style={{ color: '#6c757d' }}>No upcoming schedules found.</p>}
            </div>
            {todaysBirthdays.length > 0 && (
              <div className="birthday-section"><h3><i className="fas fa-birthday-cake"></i> Birthday Today! 🎂</h3>
                {todaysBirthdays.map((b, i) => (<div key={i} className="birthday-card"><span className="birthday-name">{b.fullName}</span><span className="birthday-ministry">{b.ministry}</span></div>))}
              </div>
            )}
          </section>

          {/* ========== EVENTS ========== */}
          <section className={`content-section ${(activeSection === 'events' || activeSection === 'events-management') ? 'active' : ''}`}>
            <h2 className="section-title">Events</h2>

            {canManage(MODULES.CREATE_EVENTS) && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowEventForm(true); setEditingEvent(null); setEventForm({ title: '', description: '', eventDate: '', endDate: '', location: '' }); }}>
                <i className="fas fa-plus"></i> Create Event
              </button>
            )}

            {showEventForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingEvent ? 'Edit Event' : 'New Event'}</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Event Date *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} /></div>
                  <div className="form-group"><label>End Date</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleEventSubmit}><i className="fas fa-save"></i> {editingEvent ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => setShowEventForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="events-grid">
              {events.map((evt) => (
                <div key={evt.id} className="event-card" style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                  <h3 style={{ color: 'var(--primary)', marginBottom: 8 }}>{evt.title}</h3>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {canManage(MODULES.RSVP_EVENT) && (
                      <>
                        <button className="btn-small btn-success" onClick={() => handleEventRSVP(evt.id, 'Going')}>Going</button>
                        <button className="btn-small btn-warning" onClick={() => handleEventRSVP(evt.id, 'Maybe')}>Maybe</button>
                        <button className="btn-small btn-secondary" onClick={() => handleEventRSVP(evt.id, 'Not Going')}>Not Going</button>
                      </>
                    )}
                    {canManage(MODULES.UPDATE_EVENTS) && (
                      <button className="btn-small btn-primary" onClick={() => { setEditingEvent(evt); setEventForm({ title: evt.title, description: evt.description || '', eventDate: evt.event_date?.slice(0, 16), endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '' }); setShowEventForm(true); }}><i className="fas fa-edit"></i></button>
                    )}
                    {canManage(MODULES.DELETE_EVENTS) && (
                      <button className="btn-small btn-danger" onClick={() => handleDeleteEvent(evt.id)}><i className="fas fa-trash"></i></button>
                    )}
                  </div>
                </div>
              ))}
              {events.length === 0 && <p style={{ color: '#6c757d' }}>No events found.</p>}
            </div>
          </section>

          {/* ========== ANNOUNCEMENTS ========== */}
          <section className={`content-section ${(activeSection === 'announcements' || activeSection === 'announcements-management') ? 'active' : ''}`}>
            <h2 className="section-title">Announcements</h2>

            {canManage(MODULES.CREATE_ANNOUNCEMENTS) && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowAnnouncementForm(true); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', isPinned: false }); }}>
                <i className="fas fa-plus"></i> Create Announcement
              </button>
            )}

            {showAnnouncementForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Content *</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={4} value={announcementForm.content} onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 15 }}><input type="checkbox" checked={announcementForm.isPinned} onChange={(e) => setAnnouncementForm({ ...announcementForm, isPinned: e.target.checked })} /> Pin this announcement</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleAnnouncementSubmit}><i className="fas fa-save"></i> {editingAnnouncement ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => setShowAnnouncementForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Birthday Announcements */}
            {todaysBirthdays.length > 0 && (
              <div className="birthday-section"><h3><i className="fas fa-birthday-cake"></i> Happy Birthday! 🎂</h3>
                {todaysBirthdays.map((b, i) => (<div key={i} className="birthday-card"><span className="birthday-name">{b.fullName}</span> — <span className="birthday-ministry">{b.ministry}</span></div>))}
              </div>
            )}

            {announcements.map((ann) => (
              <div key={ann.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: ann.is_pinned ? '4px solid var(--accent)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ color: 'var(--primary)' }}>{ann.is_pinned && <i className="fas fa-thumbtack" style={{ marginRight: 8, color: 'var(--accent)' }}></i>}{ann.title}</h3>
                    <p style={{ color: '#6c757d', margin: '8px 0' }}>{ann.content}</p>
                    <small style={{ color: '#adb5bd' }}>By {ann.author_name || 'Admin'} • {formatDateTime(ann.created_at)}</small>
                  </div>
                  {canManage(MODULES.UPDATE_ANNOUNCEMENTS) && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button className="btn-small btn-primary" onClick={() => { setEditingAnnouncement(ann); setAnnouncementForm({ title: ann.title, content: ann.content, isPinned: ann.is_pinned }); setShowAnnouncementForm(true); }}><i className="fas fa-edit"></i></button>
                      {canManage(MODULES.DELETE_ANNOUNCEMENTS) && <button className="btn-small btn-danger" onClick={() => handleDeleteAnnouncement(ann.id)}><i className="fas fa-trash"></i></button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {announcements.length === 0 && upcomingBirthdays.length > 0 && (
              <div className="birthday-section" style={{ marginTop: 20 }}>
                <h3><i className="fas fa-calendar-alt"></i> Upcoming Birthdays (Next 30 Days)</h3>
                {upcomingBirthdays.map((b, i) => (<div key={i} className="birthday-card"><span className="birthday-name">{b.fullName}</span> — {new Date(b.birthdate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>))}
              </div>
            )}
          </section>

          {/* ========== MINISTRY MEETINGS ========== */}
          <section className={`content-section ${activeSection === 'ministry-meetings' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Meetings</h2>

            {canManage(MODULES.CREATE_MINISTRY_MEETING) && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => setShowMeetingForm(true)}>
                <i className="fas fa-plus"></i> Schedule Meeting
              </button>
            )}

            {showMeetingForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>Schedule New Meeting</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.title} onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={meetingForm.description} onChange={(e) => setMeetingForm({ ...meetingForm, description: e.target.value })} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Date & Time *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.meetingDate} onChange={(e) => setMeetingForm({ ...meetingForm, meetingDate: e.target.value })} /></div>
                  <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.location} onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleMeetingSubmit}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowMeetingForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {meetings.map((mtg) => (
              <div key={mtg.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)' }}>{mtg.title}</h3>
                {mtg.description && <p style={{ color: '#6c757d', margin: '8px 0' }}>{mtg.description}</p>}
                <p><i className="fas fa-clock"></i> {formatDateTime(mtg.meeting_date)} <span className={`badge badge-${mtg.status === 'Scheduled' ? 'primary' : mtg.status === 'Completed' ? 'success' : 'danger'}`} style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem' }}>{mtg.status}</span></p>
                {mtg.location && <p><i className="fas fa-map-marker-alt"></i> {mtg.location}</p>}
                <small style={{ color: '#adb5bd' }}>By {mtg.created_by_name} • {mtg.ministry}</small>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-small btn-success" onClick={() => handleMeetingRSVP(mtg.id, 'Going')}>Going</button>
                  <button className="btn-small btn-warning" onClick={() => handleMeetingRSVP(mtg.id, 'Maybe')}>Maybe</button>
                  <button className="btn-small btn-secondary" onClick={() => handleMeetingRSVP(mtg.id, 'Not Going')}>Not Going</button>
                </div>
              </div>
            ))}
            {meetings.length === 0 && <p style={{ color: '#6c757d' }}>No upcoming meetings.</p>}
          </section>

          {/* ========== COMMUNITY HUB ========== */}
          <section className={`content-section ${activeSection === 'community-hub' ? 'active' : ''}`}>
            <h2 className="section-title">Community Hub</h2>

            {canManage(MODULES.CREATE_POSTS) && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <textarea className="form-control" style={{ padding: '12px 15px', marginBottom: 10 }} placeholder="Share something with the community..." rows={3} value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)} />
                <button className="btn-primary" onClick={handleCreatePost} disabled={!newPostContent.trim()}>
                  <i className="fas fa-paper-plane"></i> Post
                </button>
              </div>
            )}

            {communityPosts.map((post) => (
              <div key={post.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: post.is_pinned ? '4px solid var(--accent)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ color: 'var(--primary)' }}>{post.author_name}</strong>
                    {post.is_pinned && <i className="fas fa-thumbtack" style={{ marginLeft: 8, color: 'var(--accent)' }}></i>}
                    <small style={{ display: 'block', color: '#adb5bd' }}>{formatDateTime(post.created_at)}</small>
                  </div>
                  {canManage(MODULES.PIN_POSTS) && (
                    <button className="btn-small" onClick={() => handlePinPost(post.id, post.is_pinned)} title={post.is_pinned ? 'Unpin' : 'Pin'}>
                      <i className="fas fa-thumbtack"></i>
                    </button>
                  )}
                </div>
                <p style={{ margin: '12px 0', lineHeight: 1.6 }}>{post.content}</p>
                <div style={{ display: 'flex', gap: 15, alignItems: 'center', color: '#6c757d', fontSize: '0.9rem' }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => handleLikePost(post.id)}>
                    <i className="fas fa-heart"></i> {post.likeCount || 0}
                  </button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => { setShowComments((p) => ({ ...p, [post.id]: !p[post.id] })); if (!postComments[post.id]) loadPostComments(post.id); }}>
                    <i className="fas fa-comment"></i> {post.commentCount || 0}
                  </button>
                </div>

                {showComments[post.id] && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
                    {(postComments[post.id] || []).map((c) => (
                      <div key={c.id} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: '2px solid var(--accent)' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{c.author_name}</strong>
                        <p style={{ margin: '4px 0', fontSize: '0.9rem' }}>{c.content}</p>
                        <small style={{ color: '#adb5bd' }}>{formatDateTime(c.created_at)}</small>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input className="form-control" style={{ padding: '8px 12px', flex: 1 }} placeholder="Write a comment..." value={commentInputs[post.id] || ''} onChange={(e) => setCommentInputs((p) => ({ ...p, [post.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(post.id); }} />
                      <button className="btn-primary" style={{ padding: '8px 16px' }} onClick={() => handleAddComment(post.id)}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {communityPosts.length === 0 && <p style={{ color: '#6c757d' }}>No posts yet. Be the first to share!</p>}
          </section>

          {/* ========== MESSAGES ========== */}
          <section className={`content-section ${activeSection === 'messages' ? 'active' : ''}`}>
            <h2 className="section-title">Messages</h2>

            <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
              {['inbox', 'sent', 'broadcast'].map((tab) => (
                <button key={tab} className={`btn-small ${messageTab === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMessageTab(tab); setTimeout(loadMessages, 100); }}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
              <button className="btn-primary" onClick={() => { setShowMessageForm(true); if (allUsers.length === 0) loadAdminUsers(); }}>
                <i className="fas fa-pen"></i> Compose
              </button>
              {canManage(MODULES.SEND_BROADCASTS) && (
                <button className="btn-warning" onClick={() => { setShowMessageForm(true); setMessageForm((p) => ({ ...p, isBroadcast: true })); }}>
                  <i className="fas fa-broadcast-tower"></i> Broadcast
                </button>
              )}
            </div>

            {showMessageForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{messageForm.isBroadcast ? 'Send Broadcast' : 'New Message'}</h3>
                {!messageForm.isBroadcast && (
                  <div className="form-group"><label>To</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={messageForm.receiverId} onChange={(e) => setMessageForm({ ...messageForm, receiverId: e.target.value })}>
                      <option value="">Select recipient</option>
                      {allUsers.filter((u) => u.id !== userData?.id).map((u) => (<option key={u.id} value={u.id}>{u.firstname} {u.lastname} ({u.role})</option>))}
                    </select>
                  </div>
                )}
                <div className="form-group"><label>Subject</label><input className="form-control" style={{ padding: '10px 15px' }} value={messageForm.subject} onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })} /></div>
                <div className="form-group"><label>Message *</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={4} value={messageForm.content} onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleSendMessage}><i className="fas fa-paper-plane"></i> Send</button>
                  <button className="btn-secondary" onClick={() => { setShowMessageForm(false); setMessageForm({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' }); }}>Cancel</button>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} style={{ padding: 15, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', opacity: msg.is_read ? 0.8 : 1, borderLeft: msg.is_read ? 'none' : '3px solid var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{msg.subject || '(No subject)'}</strong>
                  <small style={{ color: '#adb5bd' }}>{formatDateTime(msg.created_at)}</small>
                </div>
                <p style={{ margin: '8px 0', color: '#6c757d' }}>{msg.content}</p>
                {msg.is_broadcast && <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12, background: 'rgba(255,195,0,0.2)', color: 'var(--accent)' }}>Broadcast</span>}
              </div>
            ))}
            {messages.length === 0 && <p style={{ color: '#6c757d' }}>No messages.</p>}
          </section>

          {/* ========== ATTENDANCE MANAGEMENT ========== */}
          <section className={`content-section ${activeSection === 'attendance-management' ? 'active' : ''}`}>
            <h2 className="section-title">Attendance Management</h2>

            <div style={{ display: 'flex', gap: 15, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Date</label>
                <input type="date" className="form-control" style={{ padding: '10px 15px' }} value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={loadAttendance}>Load</button>
            </div>

            {canManage(MODULES.MARK_ATTENDANCE) && adminUsers.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ marginBottom: 10 }}>Quick Mark</h3>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ padding: 8, borderBottom: '2px solid #dee2e6', textAlign: 'left' }}>Member</th><th style={{ padding: 8, borderBottom: '2px solid #dee2e6' }}>Ministry</th><th style={{ padding: 8, borderBottom: '2px solid #dee2e6' }}>Action</th></tr></thead>
                    <tbody>
                      {adminUsers.filter((u) => u.status === 'Verified').map((u) => (
                        <tr key={u.id}>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{u.firstname} {u.lastname}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{u.ministry}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <button className="btn-small btn-success" onClick={() => handleMarkAttendance(u.id, 'Present')}>P</button>
                              <button className="btn-small btn-danger" onClick={() => handleMarkAttendance(u.id, 'Absent')}>A</button>
                              <button className="btn-small btn-warning" onClick={() => handleMarkAttendance(u.id, 'Late')}>L</button>
                              <button className="btn-small btn-secondary" onClick={() => handleMarkAttendance(u.id, 'Excused')}>E</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <h3 style={{ marginBottom: 10 }}>Records for {attendanceDate}</h3>
            {attendanceRecords.map((rec) => (
              <div key={rec.id} style={{ padding: 12, background: 'var(--bg-card)', borderRadius: 8, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{rec.users?.firstname} {rec.users?.lastname} ({rec.users?.ministry})</span>
                <span className={`badge badge-${rec.status === 'Present' ? 'success' : rec.status === 'Absent' ? 'danger' : rec.status === 'Late' ? 'warning' : 'secondary'}`} style={{ padding: '4px 12px', borderRadius: 12, fontWeight: 600 }}>{rec.status}</span>
              </div>
            ))}
            {attendanceRecords.length === 0 && <p style={{ color: '#6c757d' }}>No attendance records for this date.</p>}
          </section>

          {/* ========== MINISTRY OVERSIGHT (Pastor) ========== */}
          <section className={`content-section ${activeSection === 'ministry-oversight' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Oversight</h2>
            {ministriesList.map((min) => (
              <div key={min.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)' }}>{min.name}</h3>
                {min.description && <p style={{ color: '#6c757d' }}>{min.description}</p>}
                {min.leader_name && <p><i className="fas fa-user-tie"></i> Leader: {min.leader_name}</p>}
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12, background: min.is_active ? 'rgba(40,167,69,0.2)' : 'rgba(220,53,69,0.2)', color: min.is_active ? '#28a745' : '#dc3545' }}>
                  {min.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
            {ministriesList.length === 0 && <p style={{ color: '#6c757d' }}>No ministries found.</p>}
          </section>

          {/* ========== REPORTS ========== */}
          <section className={`content-section ${activeSection === 'reports' ? 'active' : ''}`}>
            <h2 className="section-title">Reports</h2>

            {reportData && dashboardType !== 'ministry' && (
              <div className="stats-container" style={{ marginBottom: 20 }}>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-users"></i></div><div className="stat-value">{reportData.totalUsers || 0}</div><div className="stat-label">Total Users</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-user-check"></i></div><div className="stat-value">{reportData.verifiedUsers || 0}</div><div className="stat-label">Verified Users</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-calendar"></i></div><div className="stat-value">{reportData.totalEvents || 0}</div><div className="stat-label">Events</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-music"></i></div><div className="stat-value">{reportData.totalSchedules || 0}</div><div className="stat-label">Schedules</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-bullhorn"></i></div><div className="stat-value">{reportData.totalAnnouncements || 0}</div><div className="stat-label">Announcements</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-comments"></i></div><div className="stat-value">{reportData.totalPosts || 0}</div><div className="stat-label">Community Posts</div></div>
              </div>
            )}

            {reportData && dashboardType !== 'ministry' && reportData.roleDistribution && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 15, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)', marginBottom: 15 }}>Users by Role</h3>
                {Object.entries(reportData.roleDistribution).map(([role, count]) => (
                  <div key={role} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <span>{role}</span><strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}

            {reportData && dashboardType === 'ministry' && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 15 }}>
                <h3 style={{ color: 'var(--primary)', marginBottom: 15 }}>Your Attendance Summary</h3>
                {reportData.summary && Object.entries(reportData.summary).map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <span>{status}</span><strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}

            {!reportData && <p style={{ color: '#6c757d' }}>Loading reports...</p>}
          </section>

          {/* ========== USER MANAGEMENT (Admin/Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'user-management' ? 'active' : ''}`}>
            <h2 className="section-title">User Management</h2>

            <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowUserForm(true); setEditingUser(null); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); }}>
              <i className="fas fa-plus"></i> Create User
            </button>

            {showUserForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>Create New User</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>First Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.firstname} onChange={(e) => setUserForm({ ...userForm, firstname: e.target.value })} /></div>
                  <div className="form-group"><label>Last Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.lastname} onChange={(e) => setUserForm({ ...userForm, lastname: e.target.value })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Email Address *</label><input className="form-control" type="email" style={{ padding: '10px 15px' }} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></div>
                  <div className="form-group"><label>Password *</label><input className="form-control" type="password" style={{ padding: '10px 15px' }} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Ministry</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.ministry} onChange={(e) => setUserForm({ ...userForm, ministry: e.target.value, sub_role: '' })}>
                      <option value="">— No Ministry —</option>
                      {ALL_MINISTRIES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Ministry Role</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.sub_role} onChange={(e) => setUserForm({ ...userForm, sub_role: e.target.value })} disabled={!userForm.ministry || !MINISTRY_SUB_ROLES[userForm.ministry]}>
                      <option value="">— Select Role —</option>
                      {(MINISTRY_SUB_ROLES[userForm.ministry] || []).map((sr) => <option key={sr} value={sr}>{sr}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 15 }}><label>System Role</label>
                  <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                    {(userRole === ROLES.SUPER_ADMIN ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'Super Admin')).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleCreateUser}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowUserForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Edit User Modal */}
            {showEditModal && editingUser && (
              <div className="edit-user-modal-overlay" onClick={() => setShowEditModal(false)}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-user-edit"></i> Edit User</h3>
                    <button className="btn-close-modal" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                      <div className="form-group"><label>First Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.firstname} onChange={(e) => setUserForm({ ...userForm, firstname: e.target.value })} /></div>
                      <div className="form-group"><label>Last Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.lastname} onChange={(e) => setUserForm({ ...userForm, lastname: e.target.value })} /></div>
                    </div>
                    <div className="form-group"><label>Email</label><input className="form-control" style={{ padding: '10px 15px', background: '#f0f0f0' }} value={userForm.email} disabled /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                      <div className="form-group"><label>Ministry</label>
                        <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.ministry} onChange={(e) => setUserForm({ ...userForm, ministry: e.target.value, sub_role: '' })}>
                          <option value="">— No Ministry —</option>
                          {ALL_MINISTRIES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label>Ministry Role</label>
                        <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.sub_role} onChange={(e) => setUserForm({ ...userForm, sub_role: e.target.value })} disabled={!userForm.ministry || !MINISTRY_SUB_ROLES[userForm.ministry]}>
                          <option value="">— Select Role —</option>
                          {(MINISTRY_SUB_ROLES[userForm.ministry] || []).map((sr) => <option key={sr} value={sr}>{sr}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-group"><label>System Role</label>
                      <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                        {(userRole === ROLES.SUPER_ADMIN ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'Super Admin')).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="edit-user-modal-footer">
                    <button className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                    <button className="btn-primary" onClick={handleUpdateUser}><i className="fas fa-save"></i> Save Changes</button>
                  </div>
                </div>
              </div>
            )}

            {/* Event Permissions Modal */}
            {eventPermissionsUser && (
              <div className="edit-user-modal-overlay" onClick={() => setEventPermissionsUser(null)}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-calendar-check"></i> Event Creation Permissions</h3>
                    <button className="btn-close-modal" onClick={() => setEventPermissionsUser(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body">
                    <div style={{ padding: '12px 16px', background: 'rgba(0,123,255,0.05)', borderRadius: 10, marginBottom: 15, border: '1px solid rgba(0,123,255,0.15)' }}>
                      <strong>{eventPermissionsUser.firstname} {eventPermissionsUser.lastname}</strong>
                      <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>{eventPermissionsUser.email} • {eventPermissionsUser.role}</div>
                    </div>
                    <p style={{ marginBottom: 12, fontSize: '0.9rem', color: '#6c757d' }}>
                      Select which types of events this user can create. When enabled, a &quot;My Events&quot; section will appear in their sidebar.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {USER_EVENT_TYPES.map((type) => {
                        const isChecked = eventPermissionsForm.includes(type);
                        return (
                          <label key={type} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                            borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s',
                            background: isChecked ? 'rgba(40,167,69,0.08)' : 'var(--bg-card)',
                            border: isChecked ? '2px solid #28a745' : '2px solid #dee2e6',
                          }}>
                            <input type="checkbox" checked={isChecked} onChange={() => {
                              setEventPermissionsForm((prev) =>
                                isChecked ? prev.filter((t) => t !== type) : [...prev, type]
                              );
                            }} style={{ accentColor: '#28a745' }} />
                            <span style={{ fontWeight: isChecked ? 600 : 400, color: isChecked ? '#28a745' : 'inherit' }}>{type}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
                      <button className="btn-small" style={{ fontSize: '0.8rem', color: '#28a745', background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                        onClick={() => setEventPermissionsForm([...USER_EVENT_TYPES])}>Select All</button>
                      <button className="btn-small" style={{ fontSize: '0.8rem', color: '#dc3545', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                        onClick={() => setEventPermissionsForm([])}>Clear All</button>
                    </div>
                  </div>
                  <div className="edit-user-modal-footer">
                    <button className="btn-secondary" onClick={() => setEventPermissionsUser(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => handleUpdateEventPermissions(eventPermissionsUser.id, eventPermissionsForm)}>
                      <i className="fas fa-save"></i> Save Permissions
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'var(--primary)', color: 'white' }}>
                    <th style={{ padding: 10 }}>Member ID</th>
                    <th style={{ padding: 10 }}>Name</th>
                    <th style={{ padding: 10 }}>Email</th>
                    <th style={{ padding: 10 }}>Ministry</th>
                    <th style={{ padding: 10 }}>Ministry Role</th>
                    <th style={{ padding: 10 }}>System Role</th>
                    <th style={{ padding: 10 }}>Status</th>
                    <th style={{ padding: 10 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #eee', background: u.is_active === false ? 'rgba(220,53,69,0.05)' : 'transparent' }}>
                      <td style={{ padding: 10 }}>{u.member_id}</td>
                      <td style={{ padding: 10 }}>{u.firstname} {u.lastname}</td>
                      <td style={{ padding: 10, fontSize: '0.8rem' }}>{u.email}</td>
                      <td style={{ padding: 10 }}>
                        {u.ministry ? <span className="ministry-badge">{u.ministry}</span> : <span style={{ color: '#aaa' }}>—</span>}
                      </td>
                      <td style={{ padding: 10 }}>
                        {u.sub_role ? <span className="sub-role-badge">{u.sub_role}</span> : <span style={{ color: '#aaa' }}>—</span>}
                      </td>
                      <td style={{ padding: 10 }}>
                        {canManage(MODULES.ASSIGN_USER_ROLES) ? (
                          <select style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.8rem' }} value={u.role} onChange={(e) => handleUserAction(u.id, 'assign-role', { role: e.target.value })}>
                            {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : <span>{u.role}</span>}
                      </td>
                      <td style={{ padding: 10 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', background: u.status === 'Verified' ? 'rgba(40,167,69,0.2)' : u.status === 'Deactivated' ? 'rgba(220,53,69,0.2)' : 'rgba(255,193,7,0.2)', color: u.status === 'Verified' ? '#28a745' : u.status === 'Deactivated' ? '#dc3545' : '#ffc107' }}>
                          {u.status}
                        </span>
                      </td>
                      <td style={{ padding: 10 }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn-small btn-info" onClick={() => handleEditUser(u)} title="Edit User"><i className="fas fa-edit"></i></button>
                          <button className="btn-small" style={{ background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', border: '1px solid rgba(146,108,21,0.3)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem' }} onClick={() => { setEventPermissionsUser(u); setEventPermissionsForm(u.allowed_event_types || []); }} title="Event Permissions">
                            <i className="fas fa-calendar-check"></i>
                            {(u.allowed_event_types || []).length > 0 && <span style={{ marginLeft: 3, fontSize: '0.7rem', fontWeight: 700 }}>{(u.allowed_event_types || []).length}</span>}
                          </button>
                          {u.status === 'Unverified' && <button className="btn-small btn-success" onClick={() => handleUserAction(u.id, 'verify')} title="Verify"><i className="fas fa-check"></i></button>}
                          {u.is_active !== false && <button className="btn-small btn-warning" onClick={() => handleUserAction(u.id, 'deactivate')} title="Deactivate"><i className="fas fa-ban"></i></button>}
                          {u.is_active === false && <button className="btn-small btn-success" onClick={() => handleUserAction(u.id, 'activate')} title="Activate"><i className="fas fa-check-circle"></i></button>}
                          <button className="btn-small btn-primary" onClick={() => handleUserAction(u.id, 'reset-password')} title="Reset Password"><i className="fas fa-key"></i></button>
                          {canManage(MODULES.DELETE_USERS) && <button className="btn-small btn-danger" onClick={() => handleDeleteUser(u.id)} title="Delete"><i className="fas fa-trash"></i></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {adminUsers.length === 0 && <p style={{ color: '#6c757d', marginTop: 15 }}>No users found.</p>}
          </section>

          {/* ========== MINISTRY MANAGEMENT (Admin/Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'ministry-management' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Management</h2>

            <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => setShowMinistryForm(true)}>
              <i className="fas fa-plus"></i> Create Ministry
            </button>

            {showMinistryForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>New Ministry</h3>
                <div className="form-group"><label>Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={ministryForm.name} onChange={(e) => setMinistryForm({ ...ministryForm, name: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={ministryForm.description} onChange={(e) => setMinistryForm({ ...ministryForm, description: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleMinistrySubmit}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowMinistryForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {ministriesList.map((min) => (
              <div key={min.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: 'var(--primary)' }}>{min.name}</h3>
                  {min.description && <p style={{ color: '#6c757d', margin: '4px 0' }}>{min.description}</p>}
                  {min.leader_name && <small><i className="fas fa-user-tie"></i> {min.leader_name}</small>}
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: '0.75rem', background: min.is_active ? 'rgba(40,167,69,0.2)' : 'rgba(220,53,69,0.2)', color: min.is_active ? '#28a745' : '#dc3545' }}>{min.is_active !== false ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))}
          </section>

          {/* ========== ROLES & PERMISSIONS (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'roles-permissions' ? 'active' : ''}`}>
            <h2 className="section-title">Roles &amp; Permissions</h2>
            {rolesList.map((role) => (
              <div key={role.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12 }}>
                <h3 style={{ color: 'var(--primary)' }}>{role.name}</h3>
                <p style={{ color: '#6c757d' }}>{role.description}</p>
                <div style={{ marginTop: 8 }}>
                  <small style={{ color: '#adb5bd' }}>Permissions: {typeof role.permissions === 'string' ? JSON.parse(role.permissions).length : (role.permissions?.length || 0)}</small>
                </div>
              </div>
            ))}
            {rolesList.length === 0 && <p style={{ color: '#6c757d' }}>Loading roles...</p>}
          </section>

          {/* ========== SYSTEM CONFIG (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'system-config' ? 'active' : ''}`}>
            <h2 className="section-title">System Configuration</h2>
            {Object.entries(systemSettings).map(([key, value]) => (
              <div key={key} style={{ padding: 15, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</strong>
                  <p style={{ color: '#6c757d', fontSize: '0.85rem', margin: 0 }}>{JSON.stringify(value)}</p>
                </div>
              </div>
            ))}
            {Object.keys(systemSettings).length === 0 && <p style={{ color: '#6c757d' }}>Loading settings...</p>}
          </section>

          {/* ========== AUDIT LOGS (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'audit-logs' ? 'active' : ''}`}>
            <h2 className="section-title">Audit Logs</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--primary)', color: 'white' }}>
                    <th style={{ padding: 8 }}>Time</th>
                    <th style={{ padding: 8 }}>User</th>
                    <th style={{ padding: 8 }}>Action</th>
                    <th style={{ padding: 8 }}>Resource</th>
                    <th style={{ padding: 8 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{formatDateTime(log.created_at)}</td>
                      <td style={{ padding: 8 }}>{log.user_name || 'System'}</td>
                      <td style={{ padding: 8 }}>{log.action}</td>
                      <td style={{ padding: 8 }}>{log.resource}</td>
                      <td style={{ padding: 8 }}>{JSON.stringify(log.details || {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auditLogs.length === 0 && <p style={{ color: '#6c757d', marginTop: 15 }}>No audit logs found.</p>}
          </section>

          {/* ========== BIBLE READER ========== */}
          <section className={`content-section ${activeSection === 'bible-reader' ? 'active' : ''}`}>
            <h2 className="section-title">Bible Reader</h2>

            {/* Direct Scripture Input */}
            <div className="bible-direct-input">
              <div className="bible-direct-icon"><i className="fas fa-search"></i></div>
              <input
                className="form-control"
                placeholder='Go to scripture directly — e.g. "Ephesians 6:1" or "John 3:16-17"'
                value={directScripture}
                onChange={(e) => setDirectScripture(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadDirectScripture()}
              />
              <button className="btn-primary" onClick={loadDirectScripture}><i className="fas fa-arrow-right"></i> Go</button>
            </div>

            <div className="bible-divider"><span>or browse</span></div>

            {/* Bible Version Selector */}
            <div className="bible-version-bar">
              <label><i className="fas fa-globe"></i> Translation:</label>
              <div className="bible-version-pills">
                {BIBLE_VERSIONS.map((v) => (
                  <button
                    key={v.value}
                    className={`bible-version-pill ${bibleVersion === v.value ? 'active' : ''}`}
                    onClick={() => {
                      setBibleVersion(v.value);
                      localStorage.setItem('bibleVersionPref', v.value);
                    }}
                    title={v.fullName}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Book / Chapter / Verse Dropdowns */}
            <div className="bible-controls">
              <div className="form-group" style={{ flex: 2 }}><label>Book</label>
                <select className="form-select" value={bibleBook} onChange={(e) => { setBibleBook(e.target.value); setBibleChapter(1); setBibleVerse(''); }} style={{ padding: '10px' }}>
                  {Object.keys(BIBLE_BOOKS).map((b) => (<option key={b} value={b}>{b}</option>))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}><label>Chapter</label>
                <select className="form-select" value={bibleChapter} onChange={(e) => { setBibleChapter(parseInt(e.target.value)); setBibleVerse(''); }} style={{ padding: '10px' }}>
                  {Array.from({ length: BIBLE_BOOKS[bibleBook] || 1 }, (_, i) => i + 1).map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}><label>Verse <span style={{ fontSize: '0.75rem', color: '#999' }}>(optional)</span></label>
                <select className="form-select" value={bibleVerse} onChange={(e) => setBibleVerse(e.target.value)} style={{ padding: '10px' }}>
                  <option value="">All</option>
                  {Array.from({ length: getVerseCount(bibleBook, bibleChapter) }, (_, i) => i + 1).map((v) => (<option key={v} value={v}>{v}</option>))}
                </select>
              </div>
              <button className="btn-primary" onClick={() => loadBibleChapter()} style={{ alignSelf: 'flex-end', padding: '10px 24px' }}><i className="fas fa-book-open"></i> Read</button>
            </div>

            {/* Bible Text Display */}
            {bibleText && <div className="bible-text-display" ref={bibleTextRef} style={{ position: 'relative' }}><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>{bibleText}</pre>
              {highlightPopup.visible && (
                <button className="highlight-ask-btn" onMouseDown={(e) => e.preventDefault()} onClick={askHighlightedText} style={{ position: 'absolute', left: highlightPopup.x, top: highlightPopup.y, transform: 'translate(-50%, -100%)' }}>
                  <i className="fas fa-question-circle"></i> Ask about this
                </button>
              )}
            </div>}

            {/* Ask about this passage */}
            {bibleText && (
              <div className="bible-qa" style={{ marginTop: 20 }}>
                <h3><i className="fas fa-comment-dots"></i> Ask about this passage</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="form-control" placeholder="Ask a question about this scripture..." value={bibleQuestion} onChange={(e) => setBibleQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askBibleQuestionHandler()} style={{ padding: '10px 15px' }} />
                  <button className="btn-primary" onClick={askBibleQuestionHandler}><i className="fas fa-paper-plane"></i> Ask</button>
                </div>
                {bibleAnswer && bibleAnswer !== 'Thinking...' && (
                  <div className="bible-answer-card" style={{ marginTop: 15 }}>
                    <div className="bible-answer-header">
                      <span><i className="fas fa-lightbulb"></i> AI Explanation</span>
                      <button className="bible-copy-btn" onClick={copyBibleAnswer}>
                        <i className={answerCopied ? 'fas fa-check' : 'fas fa-copy'}></i> {answerCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="bible-answer-body">{renderMarkdown(bibleAnswer)}</div>
                  </div>
                )}
                {bibleAnswer === 'Thinking...' && (
                  <div className="bible-thinking" style={{ marginTop: 15 }}>
                    <div className="bible-thinking-dots"><span></span><span></span><span></span></div>
                    <span>Analyzing scripture...</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ========== DAILY QUOTE ========== */}
          <section className={`content-section ${activeSection === 'daily-quote' ? 'active' : ''}`}>
            <h2 className="section-title">Daily Quote</h2>
            <div className="quote-container"><div className="quote-text">&ldquo;{dailyQuote.quote}&rdquo;</div><div className="quote-author">— {dailyQuote.author}</div></div>
          </section>

          {/* ========== SPIRITUAL ASSISTANT ========== */}
          <section className={`content-section ${activeSection === 'spiritual-assistant' ? 'active' : ''}`}>
            <h2 className="section-title">Spiritual AI Assistant</h2>

            {/* Disclaimer Banner */}
            <div className="ai-disclaimer">
              <div className="ai-disclaimer-icon"><i className="fas fa-exclamation-triangle"></i></div>
              <div className="ai-disclaimer-text">
                <strong>Important Reminder:</strong> It is important to have a personal communication between you and God to receive true wisdom. Read His Word, pray always, and seek the Holy Spirit's guidance. <em>I am just your AI Assistant</em> — not a replacement for your relationship with God.
                <div className="ai-disclaimer-verse">&ldquo;If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.&rdquo; — <strong>James 1:5</strong></div>
              </div>
            </div>

            <div className="chat-container">
              <div className="chat-header">
                <span><i className="fas fa-cross"></i> Spiritual AI Assistant</span>
                <button className="chat-clear-btn" onClick={clearChatMemory} title="Clear chat history">
                  <i className="fas fa-trash-alt"></i> Clear History
                </button>
              </div>
              <div className="chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-message ${msg.role === 'user' ? 'user-message' : 'assistant-message'}`}>
                    <div className="message-content">
                      {msg.role === 'assistant' && <div className="message-avatar"><i className="fas fa-cross"></i></div>}
                      <div className="message-text"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{msg.content}</pre></div>
                    </div>
                  </div>
                ))}
                {chatLoading && <div className="chat-message assistant-message"><div className="message-content"><div className="message-avatar"><i className="fas fa-cross"></i></div><div className="typing-indicator"><span></span><span></span><span></span></div></div></div>}
                <div ref={chatEndRef}></div>
              </div>
              <div className="chat-input-container">
                <textarea className="chat-input" placeholder="Ask a spiritual question..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }} rows={1}></textarea>
                <button className="chat-send-btn" onClick={sendChatMessage} disabled={chatLoading}><i className="fas fa-paper-plane"></i></button>
              </div>
            </div>
          </section>

          {/* ========== MY PROFILE ========== */}
          <section className={`content-section ${activeSection === 'my-profile' ? 'active' : ''}`}>
            <h2 className="section-title">My Profile</h2>

            {/* Profile Header Card */}
            <div className="profile-header-card">
              <div className="profile-header-bg"></div>
              <div className="profile-header-content">
                <div className="profile-header-avatar">
                  {userData.profile_picture ? (
                    <img src={userData.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="profile-header-initials">{initials}</span>
                  )}
                  <div className={`profile-header-status ${isVerified ? 'verified' : 'unverified'}`}>
                    <i className={`fas fa-${isVerified ? 'check' : 'clock'}`}></i>
                  </div>
                </div>
                <div className="profile-header-info">
                  <h3 className="profile-header-name">{userData.firstname} {userData.lastname}</h3>
                  <p className="profile-header-email">{userData.email}</p>
                  <div className="profile-header-meta">
                    <span className="profile-header-role"><i className="fas fa-shield-alt"></i> {userRole}</span>
                    {userData.ministry && <span className="profile-header-ministry"><i className="fas fa-church"></i> {userData.ministry}</span>}
                    <span className={`profile-header-badge ${isVerified ? 'verified' : 'unverified'}`}>{isVerified ? 'Verified' : 'Pending'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="profile-tabs">
              <button className={`profile-tab ${profileTab === 'personal' ? 'active' : ''}`} onClick={() => setProfileTab('personal')}>Personal Info</button>
              <button className={`profile-tab ${profileTab === 'password' ? 'active' : ''}`} onClick={() => setProfileTab('password')}>Change Password</button>
              <button className={`profile-tab ${profileTab === 'preferences' ? 'active' : ''}`} onClick={() => setProfileTab('preferences')}>Preferences</button>
            </div>

            {profileTab === 'personal' && (
              <div className="profile-form">
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>First Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={profileForm.firstname} onChange={(e) => setProfileForm({ ...profileForm, firstname: e.target.value })} /></div>
                  <div className="form-group"><label>Last Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={profileForm.lastname} onChange={(e) => setProfileForm({ ...profileForm, lastname: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Email Address</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.email || ''} readOnly /></div>
                {userRole !== 'Guest' && (
                  <>
                    <div className="form-group"><label>Ministry</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.ministry || 'Not Assigned'} readOnly /></div>
                    <div className="form-group"><label>Role</label><input className="form-control" style={{ padding: '10px 15px' }} value={userRole} readOnly /></div>
                    <div className="form-group"><label>Status</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.status || ''} readOnly /></div>
                    <div className="form-group"><label>Member ID</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.memberId || 'N/A'} readOnly /></div>
                  </>
                )}
                <button className="btn-primary" onClick={saveProfile} disabled={profileLoading}>{profileLoading ? 'Saving...' : 'Save Changes'}</button>
              </div>
            )}

            {profileTab === 'password' && (
              <div className="profile-form">
                {userData.isGoogleUser && !hasLocalPassword ? (
                  <>
                    <div style={{ padding: '16px 20px', background: 'rgba(255,195,0,0.1)', borderRadius: 12, marginBottom: 20, border: '1px solid rgba(255,195,0,0.3)' }}>
                      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent)' }}>
                        <i className="fas fa-info-circle" style={{ marginRight: 8 }}></i>
                        You signed up with Google. Set a password below so you can also log in manually with your email and password.
                      </p>
                    </div>
                    <div className="form-group"><label>New Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} placeholder="At least 8 characters" value={setPasswordFormData.newPassword} onChange={(e) => setSetPasswordFormData({ ...setPasswordFormData, newPassword: e.target.value })} /></div>
                    <div className="form-group"><label>Confirm Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} placeholder="Confirm your password" value={setPasswordFormData.confirmPassword} onChange={(e) => setSetPasswordFormData({ ...setPasswordFormData, confirmPassword: e.target.value })} /></div>
                    {setPasswordFormData.confirmPassword && setPasswordFormData.newPassword !== setPasswordFormData.confirmPassword && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Passwords do not match</p>}
                    <button className="btn-primary" onClick={handleSetPassword} disabled={profileLoading}>{profileLoading ? 'Setting Password...' : 'Set Password'}</button>
                  </>
                ) : (
                  <>
                    {userData.isGoogleUser && hasLocalPassword && (
                      <div style={{ padding: '16px 20px', background: 'rgba(40,167,69,0.1)', borderRadius: 12, marginBottom: 20, border: '1px solid rgba(40,167,69,0.3)' }}>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#28a745' }}>
                          <i className="fas fa-check-circle" style={{ marginRight: 8 }}></i>
                          Password set! You can now log in with your email and password, or continue using Google.
                        </p>
                      </div>
                    )}
                    <div className="form-group"><label>Current Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></div>
                    <div className="form-group"><label>New Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></div>
                    <div className="form-group"><label>Confirm New Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></div>
                    {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Passwords do not match</p>}
                    <button className="btn-primary" onClick={changePassword} disabled={profileLoading}>{profileLoading ? 'Updating...' : 'Update Password'}</button>
                  </>
                )}
              </div>
            )}

            {profileTab === 'preferences' && (
              <div className="profile-form">
                <div className="preference-item">
                  <div><strong>Dark Mode</strong><p style={{ color: '#6c757d', fontSize: '0.85rem' }}>Toggle dark theme for the dashboard</p></div>
                  <label className="switch"><input type="checkbox" checked={darkMode} onChange={toggleDarkMode} /><span className="slider round"></span></label>
                </div>
              </div>
            )}
          </section>

          {/* ========== COMMUNITY EVENTS (All users can browse & RSVP) ========== */}
          <section className={`content-section ${activeSection === 'community-events' ? 'active' : ''}`}>
            <h2 className="section-title">Community Events</h2>
            <p style={{ color: '#6c757d', marginBottom: 20 }}>Browse events created by members and let them know if you&apos;re attending!</p>

            {/* RSVP Detail Modal for Community Events */}
            {viewingUserEventRsvps && activeSection === 'community-events' && (
              <div className="edit-user-modal-overlay" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-users"></i> Responses — {viewingUserEventRsvps.title}</h3>
                    <button className="btn-close-modal" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {userEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 20, flexWrap: 'wrap' }}>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#28a745' }}>{userEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffc107' }}>{userEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc3545' }}>{userEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = userEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 15 }}>
                              <h4 style={{ color, marginBottom: 8, fontSize: '0.9rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>{r.users?.ministry || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(userEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            <div className="events-grid">
              {browseUserEvents.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid #17a2b8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(23,162,184,0.15)', color: '#17a2b8', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                      <p style={{ color: '#6c757d', fontSize: '0.8rem', margin: 0 }}><i className="fas fa-user"></i> By: {evt.creator_name || 'Unknown'}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8, marginTop: 8 }}>{evt.description}</p>}
                  <p style={{ margin: '4px 0' }}><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.end_date && <p style={{ margin: '4px 0' }}><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                  {evt.location && <p style={{ margin: '4px 0' }}><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}

                  {/* RSVP Buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    {evt.myRsvp && <span style={{ fontSize: '0.8rem', color: '#6c757d', marginRight: 4 }}>Your response: <strong style={{ color: evt.myRsvp === 'Going' ? '#28a745' : evt.myRsvp === 'Maybe' ? '#e0a800' : '#dc3545' }}>{evt.myRsvp}</strong></span>}
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Going' ? '#28a745' : 'rgba(40,167,69,0.15)', color: evt.myRsvp === 'Going' ? '#fff' : '#28a745', border: '1px solid #28a745' }} onClick={() => handleUserEventRSVP(evt.id, 'Going')}>
                      <i className="fas fa-check"></i> Going
                    </button>
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Maybe' ? '#ffc107' : 'rgba(255,193,7,0.15)', color: evt.myRsvp === 'Maybe' ? '#fff' : '#e0a800', border: '1px solid #ffc107' }} onClick={() => handleUserEventRSVP(evt.id, 'Maybe')}>
                      <i className="fas fa-question"></i> Maybe
                    </button>
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Not Going' ? '#dc3545' : 'rgba(220,53,69,0.15)', color: evt.myRsvp === 'Not Going' ? '#fff' : '#dc3545', border: '1px solid #dc3545' }} onClick={() => handleUserEventRSVP(evt.id, 'Not Going')}>
                      <i className="fas fa-times"></i> Not Going
                    </button>
                    <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses">
                      <i className="fas fa-users"></i> Responses
                    </button>
                  </div>
                </div>
              ))}
              {browseUserEvents.length === 0 && <p style={{ color: '#6c757d' }}>No community events at this time. Check back later!</p>}
            </div>
          </section>

          {/* ========== MY CREATED EVENTS (Users with event permissions) ========== */}
          <section className={`content-section ${activeSection === 'my-created-events' ? 'active' : ''}`}>
            <h2 className="section-title">My Events</h2>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #eee' }}>
              <button onClick={() => setMyEventsTab('mine')} style={{ padding: '10px 24px', border: 'none', borderBottom: myEventsTab === 'mine' ? '3px solid var(--primary)' : '3px solid transparent', background: 'transparent', color: myEventsTab === 'mine' ? 'var(--primary)' : '#6c757d', fontWeight: myEventsTab === 'mine' ? 700 : 500, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s' }}>
                <i className="fas fa-calendar-alt"></i> My Events
              </button>
              <button onClick={() => { setMyEventsTab('browse'); loadBrowseUserEvents(); }} style={{ padding: '10px 24px', border: 'none', borderBottom: myEventsTab === 'browse' ? '3px solid var(--primary)' : '3px solid transparent', background: 'transparent', color: myEventsTab === 'browse' ? 'var(--primary)' : '#6c757d', fontWeight: myEventsTab === 'browse' ? 700 : 500, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s' }}>
                <i className="fas fa-globe"></i> Browse All Events
              </button>
            </div>

            {/* ===== MY EVENTS TAB ===== */}
            {myEventsTab === 'mine' && <>

            {(userData?.allowed_event_types || userData?.allowedEventTypes || []).length > 0 && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => {
                setShowUserEventForm(true);
                setEditingUserEvent(null);
                setUserEventForm({ title: '', description: '', eventType: (userData?.allowed_event_types || userData?.allowedEventTypes || [])[0] || 'Event', eventDate: '', endDate: '', location: '' });
              }}>
                <i className="fas fa-plus"></i> Create Event
              </button>
            )}

            {/* Create/Edit Form */}
            {showUserEventForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingUserEvent ? 'Edit Event' : 'Create New Event'}</h3>
                <div className="form-group">
                  <label>Event Type *</label>
                  <select className="form-select" style={{ padding: '10px 15px' }} value={userEventForm.eventType} onChange={(e) => setUserEventForm({ ...userEventForm, eventType: e.target.value })}>
                    {(userData?.allowed_event_types || userData?.allowedEventTypes || []).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.title} onChange={(e) => setUserEventForm({ ...userEventForm, title: e.target.value })} placeholder="Event title" /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={userEventForm.description} onChange={(e) => setUserEventForm({ ...userEventForm, description: e.target.value })} placeholder="Event description..." /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Event Date *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.eventDate} onChange={(e) => setUserEventForm({ ...userEventForm, eventDate: e.target.value })} /></div>
                  <div className="form-group"><label>End Date</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.endDate} onChange={(e) => setUserEventForm({ ...userEventForm, endDate: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.location} onChange={(e) => setUserEventForm({ ...userEventForm, location: e.target.value })} placeholder="Event location" /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleUserEventSubmit}><i className="fas fa-save"></i> {editingUserEvent ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => { setShowUserEventForm(false); setEditingUserEvent(null); }}>Cancel</button>
                </div>
              </div>
            )}

            {/* RSVP Detail Modal */}
            {viewingUserEventRsvps && (
              <div className="edit-user-modal-overlay" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-users"></i> Responses — {viewingUserEventRsvps.title}</h3>
                    <button className="btn-close-modal" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {userEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 20, flexWrap: 'wrap' }}>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#28a745' }}>{userEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffc107' }}>{userEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc3545' }}>{userEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = userEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 15 }}>
                              <h4 style={{ color, marginBottom: 8, fontSize: '0.9rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>{r.users?.ministry || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(userEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Events List */}
            <div className="events-grid">
              {userEvents.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid var(--primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600, marginBottom: 6, display: 'inline-block' }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.end_date && <p><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses"><i className="fas fa-users"></i> Responses</button>
                    <button className="btn-small btn-primary" onClick={() => {
                      setEditingUserEvent(evt);
                      setUserEventForm({
                        title: evt.title, description: evt.description || '',
                        eventType: evt.event_type, eventDate: evt.event_date?.slice(0, 16),
                        endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '',
                      });
                      setShowUserEventForm(true);
                    }}><i className="fas fa-edit"></i> Edit</button>
                    <button className="btn-small btn-danger" onClick={() => handleDeleteUserEvent(evt.id)}><i className="fas fa-trash"></i> Delete</button>
                  </div>
                </div>
              ))}
              {userEvents.length === 0 && <p style={{ color: '#6c757d' }}>You have not created any events yet. Click &quot;Create Event&quot; to get started!</p>}
            </div>

            </>}

            {/* ===== BROWSE ALL EVENTS TAB ===== */}
            {myEventsTab === 'browse' && <>
              <p style={{ color: '#6c757d', marginBottom: 15 }}>Discover events created by other members and let them know if you&apos;re attending!</p>
              <div className="events-grid">
                {browseUserEvents.filter(evt => evt.created_by !== userData?.id).map((evt) => (
                  <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid #17a2b8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(23,162,184,0.15)', color: '#17a2b8', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                        <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                        <p style={{ color: '#6c757d', fontSize: '0.8rem', margin: 0 }}><i className="fas fa-user"></i> By: {evt.creator_name || 'Unknown'}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                      </div>
                    </div>
                    {evt.description && <p style={{ color: '#6c757d', marginBottom: 8, marginTop: 8 }}>{evt.description}</p>}
                    <p style={{ margin: '4px 0' }}><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                    {evt.end_date && <p style={{ margin: '4px 0' }}><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                    {evt.location && <p style={{ margin: '4px 0' }}><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}

                    {/* RSVP Buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                      {evt.myRsvp && <span style={{ fontSize: '0.8rem', color: '#6c757d', marginRight: 4 }}>Your response: <strong style={{ color: evt.myRsvp === 'Going' ? '#28a745' : evt.myRsvp === 'Maybe' ? '#e0a800' : '#dc3545' }}>{evt.myRsvp}</strong></span>}
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Going' ? '#28a745' : 'rgba(40,167,69,0.15)', color: evt.myRsvp === 'Going' ? '#fff' : '#28a745', border: '1px solid #28a745' }} onClick={() => handleUserEventRSVP(evt.id, 'Going')}>
                        <i className="fas fa-check"></i> Going
                      </button>
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Maybe' ? '#ffc107' : 'rgba(255,193,7,0.15)', color: evt.myRsvp === 'Maybe' ? '#fff' : '#e0a800', border: '1px solid #ffc107' }} onClick={() => handleUserEventRSVP(evt.id, 'Maybe')}>
                        <i className="fas fa-question"></i> Maybe
                      </button>
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Not Going' ? '#dc3545' : 'rgba(220,53,69,0.15)', color: evt.myRsvp === 'Not Going' ? '#fff' : '#dc3545', border: '1px solid #dc3545' }} onClick={() => handleUserEventRSVP(evt.id, 'Not Going')}>
                        <i className="fas fa-times"></i> Not Going
                      </button>
                      <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses">
                        <i className="fas fa-users"></i> Responses
                      </button>
                    </div>
                  </div>
                ))}
                {browseUserEvents.filter(evt => evt.created_by !== userData?.id).length === 0 && <p style={{ color: '#6c757d' }}>No events from other members at this time.</p>}
              </div>
            </>}

          </section>

          {/* ========== USER EVENTS OVERSIGHT (Pastor/Admin) ========== */}
          <section className={`content-section ${activeSection === 'user-events-oversight' ? 'active' : ''}`}>
            <h2 className="section-title">User-Created Events</h2>
            <p style={{ color: '#6c757d', marginBottom: 20 }}>View and manage events created by users who have been granted event creation permissions.</p>

            {/* Pastor RSVP Detail Modal */}
            {pastorViewingEvent && (
              <div className="edit-user-modal-overlay" onClick={() => { setPastorViewingEvent(null); setPastorEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 650 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-info-circle"></i> Event Details</h3>
                    <button className="btn-close-modal" onClick={() => { setPastorViewingEvent(null); setPastorEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 550, overflowY: 'auto' }}>
                    <div style={{ marginBottom: 20 }}>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600 }}>{pastorViewingEvent.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginTop: 8, marginBottom: 6 }}>{pastorViewingEvent.title}</h3>
                      {pastorViewingEvent.description && <p style={{ color: '#6c757d', marginBottom: 10 }}>{pastorViewingEvent.description}</p>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 15 }}>
                        <div style={{ padding: 12, background: 'rgba(146,108,21,0.05)', borderRadius: 8 }}>
                          <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>Date & Time</div>
                          <div style={{ fontWeight: 600 }}>{formatDateTime(pastorViewingEvent.event_date)}</div>
                        </div>
                        {pastorViewingEvent.location && (
                          <div style={{ padding: 12, background: 'rgba(146,108,21,0.05)', borderRadius: 8 }}>
                            <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>Location</div>
                            <div style={{ fontWeight: 600 }}>{pastorViewingEvent.location}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: 12, background: 'rgba(0,123,255,0.05)', borderRadius: 8, border: '1px solid rgba(0,123,255,0.15)', marginBottom: 15 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: 4 }}>Created By</div>
                        <div style={{ fontWeight: 600 }}>{pastorViewingEvent.created_by_name || (pastorViewingEvent.users ? `${pastorViewingEvent.users.firstname} ${pastorViewingEvent.users.lastname}` : 'Unknown')}</div>
                        <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                          {pastorViewingEvent.users?.ministry && <span><i className="fas fa-church" style={{ marginRight: 4 }}></i>{pastorViewingEvent.users.ministry}</span>}
                          {pastorViewingEvent.users?.role && <span style={{ marginLeft: 12 }}><i className="fas fa-user-tag" style={{ marginRight: 4 }}></i>{pastorViewingEvent.users.role}</span>}
                        </div>
                      </div>
                    </div>

                    <h4 style={{ marginBottom: 10, color: 'var(--primary)' }}><i className="fas fa-users"></i> User Responses</h4>
                    {pastorEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 15, flexWrap: 'wrap' }}>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#28a745' }}>{pastorEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ffc107' }}>{pastorEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#dc3545' }}>{pastorEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = pastorEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 12 }}>
                              <h4 style={{ color, marginBottom: 6, fontSize: '0.85rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, marginBottom: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee', fontSize: '0.9rem' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.78rem', color: '#6c757d' }}>{r.users?.ministry || ''} • {r.users?.role || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(pastorEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Event Cards */}
            <div className="events-grid">
              {allUserEventsForPastor.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid var(--primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 2 }}>{evt.title}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ padding: '8px 12px', background: 'rgba(0,123,255,0.05)', borderRadius: 8, border: '1px solid rgba(0,123,255,0.15)', marginTop: 8, fontSize: '0.85rem' }}>
                    <i className="fas fa-user" style={{ marginRight: 6, color: '#007bff' }}></i>
                    <strong>Created by:</strong> {evt.created_by_name || (evt.users ? `${evt.users.firstname} ${evt.users.lastname}` : 'Unknown')}
                    {evt.users?.ministry && <span style={{ marginLeft: 10, color: '#6c757d' }}>({evt.users.ministry})</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn-small btn-info" onClick={() => { setPastorViewingEvent(evt); loadPastorEventRsvps(evt.id); }}><i className="fas fa-eye"></i> View Details & Responses</button>
                    <button className="btn-small btn-primary" onClick={() => {
                      setEditingUserEvent(evt);
                      setUserEventForm({
                        title: evt.title, description: evt.description || '',
                        eventType: evt.event_type, eventDate: evt.event_date?.slice(0, 16),
                        endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '',
                      });
                      setShowUserEventForm(true);
                    }}><i className="fas fa-edit"></i> Edit</button>
                    <button className="btn-small btn-danger" onClick={() => handleDeleteUserEvent(evt.id)}><i className="fas fa-trash"></i> Delete</button>
                  </div>
                </div>
              ))}
              {allUserEventsForPastor.length === 0 && <p style={{ color: '#6c757d' }}>No user-created events found.</p>}
            </div>
          </section>

          {/* ========== CREATE LINEUP (Song Leader) ========== */}
          {canManage(MODULES.CREATE_SONG_LIST) && (
            <section className={`content-section ${activeSection === 'create-lineup' ? 'active' : ''}`}>
              <h2 className="section-title">{isAdmin ? (editingLineup ? 'Edit Assignment' : 'Assign Lineup') : (editingLineup ? 'Edit Songs' : 'Create Lineup')}</h2>

              {/* SUCCESS VIEW */}
              {lineupView === 'success' && (
                <div className="lineup-success-container">
                  <div className="lineup-success-icon"><i className="fas fa-check-circle"></i></div>
                  <h3>{isAdmin ? (editingLineup ? 'Assignment Updated!' : 'Lineup Assigned!') : (editingLineup ? 'Songs Updated!' : 'Songs Submitted!')}</h3>
                  <p>{isAdmin ? <>Song Leader and Backupers have been {editingLineup ? 'updated' : 'assigned'} for <strong>{formatDate(lineupForm.scheduleDate)}</strong>. The Song Leader will be notified.</> : <>Your songs for <strong>{formatDate(lineupForm.scheduleDate)}</strong> have been {editingLineup ? 'updated' : 'saved'}.</>}</p>
                  <button className="btn-primary" onClick={resetLineupForm} style={{ marginTop: 20, padding: '12px 30px' }}><i className="fas fa-plus"></i> {isAdmin ? 'Assign Another' : 'Back to Calendar'}</button>
                </div>
              )}

              {/* CALENDAR VIEW — pick a date first */}
              {lineupView === 'calendar' && (
                <div className="lineup-calendar-container">
                  <div className="lineup-calendar-info">
                    <i className="fas fa-info-circle"></i>
                    <span>{isAdmin ? 'Select a date to assign a Song Leader and Backupers' : 'Tap your assigned date to add songs. Tap other dates to view details.'}</span>
                  </div>

                  {/* Song Leader: show assigned dates info */}
                  {!isAdmin && getAssignedDates().length > 0 && (
                    <div className="lineup-assigned-info" style={{ background: 'rgba(146,108,21,0.08)', border: '1px solid rgba(146,108,21,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: 'var(--primary)' }}><i className="fas fa-star" style={{ marginRight: 8 }}></i>Your Assigned Dates</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {getAssignedDates().map(dateStr => {
                          const backups = getAssignedBackups(dateStr);
                          const isPast = new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
                          return (
                            <div key={dateStr} style={{ background: isPast ? '#ccc' : 'linear-gradient(135deg, var(--primary), var(--secondary))', color: isPast ? '#666' : '#fff', padding: '8px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, opacity: isPast ? 0.6 : 1 }}>
                              <div>{formatDate(dateStr)} {isPast && '(Past)'}</div>
                              {backups.length > 0 && <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: 2 }}><i className="fas fa-users" style={{ marginRight: 4 }}></i>{backups.join(', ')}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="lineup-calendar-card">
                    <div className="lineup-cal-header">
                      <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() - 1))}><i className="fas fa-chevron-left"></i></button>
                      <h3>{lineupCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                      <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() + 1))}><i className="fas fa-chevron-right"></i></button>
                    </div>
                    <div className="lineup-cal-weekdays">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="lineup-cal-weekday">{d}</div>)}
                    </div>
                    <div className="lineup-cal-grid">
                      {getLineupCalendarDays().map((day, i) => {
                        const taken = isLineupDateTaken(day);
                        const past = isLineupDatePast(day);
                        const today = day && new Date().getDate() === day && new Date().getMonth() === lineupCalendarMonth.getMonth() && new Date().getFullYear() === lineupCalendarMonth.getFullYear();
                        const dateStr = day ? `${lineupCalendarMonth.getFullYear()}-${String(lineupCalendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                        const schedule = day && taken ? scheduleData.find(s => s.scheduleDate === dateStr) : null;
                        const leaderName = schedule ? schedule.songLeader : '';
                        const leaderFirstName = leaderName ? leaderName.split(' ')[0] : '';
                        const assigned = !isAdmin && day && getAssignedDates().includes(dateStr);
                        const assignedAndPast = assigned && past;
                        const assignedAndFuture = assigned && !past;
                        const slViewable = !isAdmin && day && taken && !assigned;
                        return (
                          <div key={i} className={`lineup-cal-day${!day ? ' empty' : ''}${isAdmin && taken ? ' admin-taken' : (!isAdmin && taken && !assigned ? ' taken' : '')}${past ? ' past' : ''}${today ? ' today' : ''}${assignedAndFuture ? ' assigned' : ''}${assignedAndPast ? ' assigned-past' : ''}${slViewable ? ' viewable' : ''}`}
                            onClick={() => {
                              if (!day) return;
                              if (isAdmin) {
                                if (past || taken) return; // Grayed out — no click
                                handleLineupDateSelect(dateStr);
                              } else {
                                // Song Leader
                                if (assignedAndPast) { showToast('This date has already passed. You cannot edit past lineups.', 'warning'); return; }
                                if (taken) {
                                  handleLineupDateSelect(dateStr);
                                  return;
                                }
                              }
                            }}
                            title={isAdmin ? (taken ? `Assigned to ${leaderName}` : past ? 'Past date' : 'Click to assign') : (assignedAndFuture ? 'Your assigned date — click to add songs' : assignedAndPast ? 'Past assigned date' : slViewable ? `Assigned to ${leaderName} — click to view` : past ? 'Past date' : '')}>
                            {day && <span className="lineup-cal-day-num">{day}</span>}
                            {taken && day && leaderFirstName && <span className="lineup-cal-leader-name">{leaderFirstName}</span>}
                            {assignedAndFuture && day && <div className="lineup-cal-dot" style={{ background: 'var(--accent)' }}></div>}
                          </div>
                        );
                      })}
                    </div>
                    <div className="lineup-cal-legend">
                      {isAdmin && <span><span className="legend-dot available"></span> Available</span>}
                      <span><span className="legend-dot" style={{ background: '#bbb' }}></span> Assigned</span>
                      {!isAdmin && <span><span className="legend-dot" style={{ background: 'var(--accent)' }}></span> You&apos;re Assigned</span>}
                      <span><span className="legend-dot past"></span> Past Date</span>
                    </div>
                  </div>

                  {/* Detail Popup — Song Leader viewing another date's assignment */}
                  {lineupDetailPopup && (
                    <div className="lineup-detail-overlay" onClick={() => setLineupDetailPopup(null)}>
                      <div className="lineup-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <button className="lineup-detail-close" onClick={() => setLineupDetailPopup(null)}><i className="fas fa-times"></i></button>
                        <div className="lineup-detail-modal-header">
                          <i className="fas fa-calendar-day"></i>
                          <h3>{formatDate(lineupDetailPopup.date)}</h3>
                        </div>
                        <div className="lineup-detail-modal-body">
                          <div className="lineup-detail-row">
                            <i className="fas fa-microphone" style={{ color: 'var(--primary)' }}></i>
                            <div>
                              <span className="lineup-detail-label">Song Leader</span>
                              <span className="lineup-detail-value">{lineupDetailPopup.songLeader}</span>
                            </div>
                          </div>
                          <div className="lineup-detail-row">
                            <i className="fas fa-users" style={{ color: 'var(--secondary)' }}></i>
                            <div>
                              <span className="lineup-detail-label">Backupers</span>
                              <span className="lineup-detail-value">{lineupDetailPopup.backupSingers.length > 0 ? lineupDetailPopup.backupSingers.join(', ') : 'No backupers assigned'}</span>
                            </div>
                          </div>
                          {(lineupDetailPopup.slowSongs.length > 0 || lineupDetailPopup.fastSongs.length > 0) && (
                            <div className="lineup-detail-songs">
                              <span className="lineup-detail-label" style={{ marginBottom: 8, display: 'block' }}>Songs</span>
                              {lineupDetailPopup.slowSongs.map((s, i) => <div key={`s-${i}`} className="lineup-detail-song-pill slow"><i className="fas fa-music"></i> {s.title}</div>)}
                              {lineupDetailPopup.fastSongs.map((s, i) => <div key={`f-${i}`} className="lineup-detail-song-pill fast"><i className="fas fa-bolt"></i> {s.title}</div>)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* FORM VIEW — after date is selected */}
              {lineupView === 'form' && (
                <div className="lineup-form-modern">
                  {/* Selected Date Banner */}
                  <div className="lineup-date-banner">
                    <div className="lineup-date-banner-left">
                      <i className="fas fa-calendar-check"></i>
                      <div>
                        <span className="lineup-date-label">Schedule Date</span>
                        <span className="lineup-date-value">{formatDate(lineupForm.scheduleDate)}</span>
                      </div>
                    </div>
                    {!editingLineup && isAdmin && <button className="btn-change-date" onClick={() => { setLineupView('calendar'); setLineupSelectedDate(null); }}><i className="fas fa-pen"></i> Change</button>}
                    {!isAdmin && <button className="btn-change-date" onClick={() => { resetLineupForm(); }}><i className="fas fa-arrow-left"></i> Back</button>}
                  </div>

                  {isAdmin ? (
                    <>
                      {/* ===== ADMIN FORM: Assign Song Leader + Backupers only ===== */}
                      <div className="lineup-details-row">
                        <div className="lineup-detail-card" style={{ flex: '1 1 100%' }}>
                          <label><i className="fas fa-microphone"></i> Assign Song Leader</label>
                          <select className="form-select lineup-leader-select" value={lineupForm.songLeader} onChange={(e) => handleLineupChange('songLeader', e.target.value)}>
                            <option value="">-- Select Song Leader --</option>
                            {songLeaderOptions.map((sl) => (
                              <option key={sl.id} value={sl.name}>{sl.name}</option>
                            ))}
                          </select>
                          {songLeaderOptions.length === 0 && (
                            <p style={{ color: '#aaa', fontSize: '0.82rem', margin: '8px 0 0' }}>
                              <i className="fas fa-info-circle"></i> No Song Leaders found. Assign users with Ministry: Praise And Worship, Sub Role: Song Leaders.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="lineup-backup-section">
                        <label><i className="fas fa-users"></i> Assign Backupers</label>
                        {backupSingerOptions.length === 0 && (
                          <p style={{ color: '#aaa', fontSize: '0.85rem', margin: '6px 0' }}>
                            <i className="fas fa-info-circle"></i> No Backupers found. Assign users with Ministry: Praise And Worship, Sub Role: Song Leader Backupers.
                          </p>
                        )}
                        <div className="lineup-backup-list">
                          {lineupForm.backupSingers.map((singer, i) => (
                            <div key={i} className="lineup-backup-item">
                              <select className="form-select" value={singer} onChange={(e) => handleBackupChange(i, e.target.value)}>
                                <option value="">Select backuper</option>
                                {backupSingerOptions.map((bo) => <option key={bo.id} value={bo.name}>{bo.name}</option>)}
                              </select>
                              {lineupForm.backupSingers.length > 1 && <button className="btn-remove-sm" onClick={() => removeBackupSinger(i)}><i className="fas fa-times"></i></button>}
                            </div>
                          ))}
                        </div>
                        {lineupForm.backupSingers.length < 5 && <button className="btn-add-subtle" onClick={addBackupSinger}><i className="fas fa-plus"></i> Add Backuper</button>}
                      </div>

                      {/* Submit (Admin) */}
                      <div className="lineup-submit-row">
                        <button className="btn-secondary" onClick={resetLineupForm}><i className="fas fa-arrow-left"></i> Cancel</button>
                        <button className="btn-primary btn-submit-lineup" onClick={submitLineup} disabled={lineupLoading}>
                          {lineupLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 18, height: 18, marginRight: 8 }}></div> Saving...</> : <><i className="fas fa-user-check"></i> {editingLineup ? 'Update Assignment' : 'Assign Lineup'}</>}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* ===== SONG LEADER FORM: View assignment + add songs ===== */}
                      {/* Assignment Info (read-only) */}
                      <div className="lineup-assignment-info">
                        <div className="lineup-assignment-row">
                          <div className="lineup-assignment-item">
                            <i className="fas fa-microphone" style={{ color: 'var(--primary)' }}></i>
                            <div>
                              <span className="lineup-assignment-label">Song Leader</span>
                              <span className="lineup-assignment-value">{lineupForm.songLeader}</span>
                            </div>
                          </div>
                          <div className="lineup-assignment-item">
                            <i className="fas fa-users" style={{ color: 'var(--secondary)' }}></i>
                            <div>
                              <span className="lineup-assignment-label">Backupers</span>
                              <span className="lineup-assignment-value">{lineupForm.backupSingers.filter(s => s).length > 0 ? lineupForm.backupSingers.filter(s => s).join(', ') : 'None assigned'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Practice Date */}
                      <div className="lineup-details-row">
                        <div className="lineup-detail-card" style={{ flex: '1 1 100%' }}>
                          <label><i className="fas fa-calendar-alt"></i> Practice Date</label>
                          <input type="date" className="form-control" value={lineupForm.practiceDate} onChange={(e) => handleLineupChange('practiceDate', e.target.value)} />
                        </div>
                      </div>

                      {/* Two-Column Songs: Slow & Fast side by side */}
                      <div className="lineup-songs-grid">
                        {['slowSongs', 'fastSongs'].map((type) => (
                          <div key={type} className="lineup-song-column">
                            <div className={`lineup-song-column-header ${type}`}>
                              <i className={`fas fa-${type === 'slowSongs' ? 'music' : 'bolt'}`}></i>
                              <span>{type === 'slowSongs' ? 'Slow Songs' : 'Fast Songs'}</span>
                              <span className="song-count-badge">{lineupForm[type].filter(s => s.title).length}</span>
                            </div>
                            <div className="lineup-song-list">
                              {lineupForm[type].map((song, i) => {
                                const scanKey = `${type}-${i}`;
                                const scan = songScanResults[scanKey];
                                return (
                                <div key={i} className={`lineup-song-card${song.title ? ' has-title' : ''}${scan?.status === 'explicit' ? ' scan-explicit' : scan?.status === 'warning' ? ' scan-warning' : scan?.status === 'safe' ? ' scan-safe' : ''}`}>
                                  <div className="lineup-song-card-header">
                                    <span className="lineup-song-num">{type === 'slowSongs' ? '🎵' : '⚡'} Song {i + 1}</span>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                      {(song.title || song.link) && <button className="btn-scan-song" onClick={() => rescanSong(type, i)} title="Scan with AI"><i className="fas fa-shield-alt"></i></button>}
                                      {lineupForm[type].length > 1 && <button className="btn-remove-sm" onClick={() => removeSong(type, i)}><i className="fas fa-trash-alt"></i></button>}
                                    </div>
                                  </div>

                                  {/* AI Scan Result Badge */}
                                  {scan && (
                                    <div className={`song-scan-badge scan-${scan.status}`}>
                                      <div className="song-scan-icon">
                                        {scan.status === 'scanning' && <div className="scan-spinner"></div>}
                                        {scan.status === 'safe' && <i className="fas fa-check-circle"></i>}
                                        {scan.status === 'explicit' && <i className="fas fa-exclamation-triangle"></i>}
                                        {scan.status === 'warning' && <i className="fas fa-exclamation-circle"></i>}
                                        {scan.status === 'error' && <i className="fas fa-question-circle"></i>}
                                      </div>
                                      <div className="song-scan-text">
                                        <span className="song-scan-label">{scan.message}</span>
                                        {scan.details && <span className="song-scan-details">{scan.details}</span>}
                                      </div>
                                    </div>
                                  )}

                                  <input className="form-control" placeholder="Song title *" value={song.title} onChange={(e) => handleSongChange(type, i, 'title', e.target.value)} />
                                  <input className="form-control" placeholder="YouTube link (optional)" value={song.link} onChange={(e) => handleSongChange(type, i, 'link', e.target.value)} />
                                  {song.link && extractYouTubeId(song.link) && <div className="youtube-preview"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                                  <textarea className="form-control" placeholder="Lyrics (optional)" rows={2} value={song.lyrics} onChange={(e) => handleSongChange(type, i, 'lyrics', e.target.value)}></textarea>
                                  <input className="form-control" placeholder="Instructions (optional)" value={song.instructions} onChange={(e) => handleSongChange(type, i, 'instructions', e.target.value)} />
                                </div>
                                );
                              })}
                            </div>
                            {lineupForm[type].length < 5 && <button className="btn-add-song" onClick={() => addSong(type)}><i className="fas fa-plus-circle"></i> Add {type === 'slowSongs' ? 'Slow' : 'Fast'} Song</button>}
                          </div>
                        ))}
                      </div>

                      {/* Submit (Song Leader) */}
                      <div className="lineup-submit-row">
                        <button className="btn-secondary" onClick={resetLineupForm}><i className="fas fa-arrow-left"></i> Cancel</button>
                        <button className="btn-primary btn-submit-lineup" onClick={submitLineup} disabled={lineupLoading}>
                          {lineupLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 18, height: 18, marginRight: 8 }}></div> Saving...</> : <><i className="fas fa-paper-plane"></i> {editingLineup ? 'Update Songs' : 'Submit Songs'}</>}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ========== MY LINEUPS / ALL ASSIGNMENTS ========== */}
          {canManage(MODULES.CREATE_SONG_LIST) && (
            <section className={`content-section ${activeSection === 'my-lineups' ? 'active' : ''}`}>
              <h2 className="section-title">{isAdmin ? 'All Assignments' : 'My Lineups'}</h2>
              {getMyLineups().length === 0 ? (
                <div className="lineup-empty-state">
                  <i className="fas fa-music"></i>
                  <h3>{isAdmin ? 'No Assignments Yet' : 'No Lineups Yet'}</h3>
                  <p>{isAdmin ? 'No Song Leaders have been assigned yet. Start by creating an assignment!' : 'You have no assigned dates yet. Your Admin will assign you.'}</p>
                  {isAdmin && <button className="btn-primary" onClick={() => { resetLineupForm(); setActiveSection('create-lineup'); }} style={{ marginTop: 15, padding: '12px 25px' }}><i className="fas fa-plus"></i> Assign Lineup</button>}
                </div>
              ) : (
                <div className="my-lineups-grid">
                  {getMyLineups().map((lineup) => {
                    const hasSongs = (lineup.slowSongs?.length > 0 && lineup.slowSongs.some(s => s.title)) || (lineup.fastSongs?.length > 0 && lineup.fastSongs.some(s => s.title));
                    return (
                    <div key={lineup.scheduleId} className="my-lineup-card">
                      <div className="my-lineup-card-header">
                        <div className="my-lineup-date-badge">
                          <span className="mlc-month">{new Date(lineup.scheduleDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                          <span className="mlc-day">{new Date(lineup.scheduleDate).getDate()}</span>
                          <span className="mlc-year">{new Date(lineup.scheduleDate).getFullYear()}</span>
                        </div>
                        <div className="my-lineup-info">
                          <h4>{formatDate(lineup.scheduleDate)}</h4>
                          <p><i className="fas fa-microphone"></i> {lineup.songLeader}</p>
                          {lineup.backupSingers?.length > 0 && <p className="backup-text"><i className="fas fa-users"></i> {lineup.backupSingers.join(', ')}</p>}
                          {lineup.practiceDate && <p className="practice-text"><i className="fas fa-calendar-alt"></i> Practice: {formatDate(lineup.practiceDate)}</p>}
                          {isAdmin && lineup.submittedBy && (
                            <p className="submitted-by-text"><i className="fas fa-user-edit"></i> Created by: {lineup.submittedBy}</p>
                          )}
                          {!isAdmin && !hasSongs && (
                            <p style={{ color: 'var(--accent)', fontSize: '0.8rem', marginTop: 4 }}><i className="fas fa-exclamation-circle"></i> Songs not yet added</p>
                          )}
                        </div>
                      </div>
                      {hasSongs && (
                        <div className="my-lineup-songs-row">
                          <div className="my-lineup-song-group slow">
                            <span className="song-group-label"><i className="fas fa-music"></i> Slow</span>
                            {lineup.slowSongs?.length > 0 && lineup.slowSongs.some(s => s.title) ? lineup.slowSongs.filter(s => s.title).map((s, i) => <span key={i} className="song-pill">{s.title}</span>) : <span className="no-songs">None</span>}
                          </div>
                          <div className="my-lineup-song-group fast">
                            <span className="song-group-label"><i className="fas fa-bolt"></i> Fast</span>
                            {lineup.fastSongs?.length > 0 && lineup.fastSongs.some(s => s.title) ? lineup.fastSongs.filter(s => s.title).map((s, i) => <span key={i} className="song-pill">{s.title}</span>) : <span className="no-songs">None</span>}
                          </div>
                        </div>
                      )}
                      <div className="my-lineup-actions">
                        {isAdmin ? (
                          <>
                            <button className="btn-edit-lineup" onClick={() => startEditLineup(lineup)}><i className="fas fa-edit"></i> Edit Assignment</button>
                            {deleteConfirmId === lineup.scheduleId ? (
                              <div className="delete-confirm-inline">
                                <span>Delete?</span>
                                <button className="btn-confirm-yes" onClick={() => deleteLineup(lineup.scheduleId)}><i className="fas fa-check"></i> Yes</button>
                                <button className="btn-confirm-no" onClick={() => setDeleteConfirmId(null)}><i className="fas fa-times"></i> No</button>
                              </div>
                            ) : (
                              <button className="btn-delete-lineup" onClick={() => setDeleteConfirmId(lineup.scheduleId)}><i className="fas fa-trash-alt"></i> Delete</button>
                            )}
                          </>
                        ) : (
                          <button className="btn-edit-lineup" onClick={() => startEditLineup(lineup)}><i className="fas fa-edit"></i> {hasSongs ? 'Edit Songs' : 'Add Songs'}</button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

        </main>
      </div>
    </div>
  );
}
