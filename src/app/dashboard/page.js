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

const SONG_LEADERS = ['Psalm Gambe', 'Geneveve España', 'Cathy Martinez', 'Tiffany Dañal'];
const BACKUP_OPTIONS = ['Psalm Gambe', 'Cathy Martinez', 'Tiffany Dañal', 'Geneveve España', 'Merianne Gomez', 'Ezra Gomez', 'Julie Hato', 'Jewel Gomez', 'Abby Danessa', 'Myka Dañal'];
const ALL_ROLES = ['Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'];
const ALL_MINISTRIES = ['Media', 'Praise And Worship', 'Dancers', 'Ashers'];

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
  const [userRole, setUserRole] = useState('Member');
  const [activeSection, setActiveSection] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Bible verse
  const [dailyVerse, setDailyVerse] = useState({ verse: 'Loading verse of the day...', reference: 'Loading...', explanation: '' });
  const [bibleVersion, setBibleVersion] = useState('niv');

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

  // Profile
  const [profileTab, setProfileTab] = useState('personal');
  const [profileForm, setProfileForm] = useState({ firstname: '', lastname: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // Bible Reader
  const [bibleBook, setBibleBook] = useState('Genesis');
  const [bibleChapter, setBibleChapter] = useState(1);
  const [bibleText, setBibleText] = useState('');
  const [bibleQuestion, setBibleQuestion] = useState('');
  const [bibleAnswer, setBibleAnswer] = useState('');

  // Daily Quote
  const [dailyQuote, setDailyQuote] = useState({ quote: 'Loading...', author: '' });

  // Spiritual Assistant
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Birthdays
  const [birthdayData, setBirthdayData] = useState([]);

  // Events
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState({ title: '', description: '', eventDate: '', endDate: '', location: '' });
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

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
  const [userForm, setUserForm] = useState({ firstname: '', lastname: '', username: '', password: '', ministry: 'Media', role: 'Member' });
  const [editingUser, setEditingUser] = useState(null);

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
    setUserRole(stored.role || 'Member');
    setIsVerified(stored.status === 'Verified');
    setProfileForm({ firstname: stored.firstname, lastname: stored.lastname });

    const savedDark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(savedDark);
    if (savedDark) document.body.classList.add('dark-mode');

    fetchDailyVerse(stored.ministry);
    loadScheduleData();
    loadBirthdays();
    if (stored.id) loadNotifications(stored.id);
  }, [router]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

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
    if (!isVerified && sectionId !== 'home') {
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
    if (sectionId === 'spiritual-assistant' && chatMessages.length === 0) {
      setChatMessages([{ role: 'assistant', content: `Hello ${userData?.firstname || 'friend'}! 🙏 I'm your spiritual assistant. How can I help you today?` }]);
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
      const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...userForm, securityQuestion: 'Set by admin', securityAnswer: 'admin' }) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowUserForm(false); setUserForm({ firstname: '', lastname: '', username: '', password: '', ministry: 'Media', role: 'Member' }); loadAdminUsers(); }
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
  // LINEUP HANDLERS (from original)
  // ============================================
  const handleLineupChange = (field, value) => setLineupForm((prev) => ({ ...prev, [field]: value }));
  const handleBackupChange = (i, v) => { const b = [...lineupForm.backupSingers]; b[i] = v; setLineupForm((p) => ({ ...p, backupSingers: b })); };
  const addBackupSinger = () => setLineupForm((p) => ({ ...p, backupSingers: [...p.backupSingers, ''] }));
  const handleSongChange = (type, i, field, value) => { const s = [...lineupForm[type]]; s[i] = { ...s[i], [field]: value }; setLineupForm((p) => ({ ...p, [type]: s })); };
  const addSong = (type) => setLineupForm((p) => ({ ...p, [type]: [...p[type], { title: '', link: '', lyrics: '', instructions: '' }] }));
  const removeSong = (type, i) => setLineupForm((p) => ({ ...p, [type]: p[type].filter((_, idx) => idx !== i) }));

  const submitLineup = async () => {
    if (!lineupForm.scheduleDate || !lineupForm.songLeader) { showToast('Schedule date and song leader are required', 'warning'); return; }
    setLineupLoading(true);
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songLeader: lineupForm.songLeader, scheduleDate: lineupForm.scheduleDate,
          practiceDate: lineupForm.practiceDate || null, backupSingers: lineupForm.backupSingers.filter(Boolean),
          slowSongs: lineupForm.slowSongs.filter((s) => s.title), fastSongs: lineupForm.fastSongs.filter((s) => s.title),
          submittedBy: userData?.username,
        }),
      });
      const data = await res.json();
      if (data.success) { showToast('Lineup submitted successfully!', 'success'); setLineupForm({ scheduleDate: '', practiceDate: '', songLeader: '', backupSingers: [''], slowSongs: [{ title: '', link: '', lyrics: '', instructions: '' }], fastSongs: [{ title: '', link: '', lyrics: '', instructions: '' }] }); loadScheduleData(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setLineupLoading(false); }
  };

  // ============================================
  // BIBLE READER & CHAT (from original)
  // ============================================
  const loadBibleChapter = async () => {
    setBibleText('Loading...');
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: 'You are a Bible text provider. Provide the full text of the requested Bible chapter. Use the NIV translation. Include verse numbers.' }, { role: 'user', content: `Provide the full text of ${bibleBook} chapter ${bibleChapter}.` }], temperature: 0.1, max_tokens: 4000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleText(content || 'Error loading chapter. Please try again.');
    } catch { setBibleText('Error loading chapter. Please try again.'); }
  };

  const askBibleQuestionHandler = async () => {
    if (!bibleQuestion.trim()) return;
    setBibleAnswer('Thinking...');
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `Answer questions about ${bibleBook} ${bibleChapter}. Be biblical and insightful.` }, { role: 'user', content: bibleQuestion }], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleAnswer(content || 'Error. Please try again.');
    } catch { setBibleAnswer('Error. Please try again.'); }
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
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `You are a compassionate Christian spiritual advisor for ${userData?.firstname || 'a believer'}. Provide biblical guidance, prayer support, and encouragement. Use Scripture references when appropriate.` }, ...chatMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: msg }], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No response');
      setChatMessages((p) => [...p, { role: 'assistant', content }]);
    } catch { setChatMessages((p) => [...p, { role: 'assistant', content: 'I apologize, but I encountered an error. Please try again.' }]); }
    finally { setChatLoading(false); }
  };

  // ============================================
  // PROFILE HANDLERS (from original)
  // ============================================
  const saveProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: userData.username, firstname: profileForm.firstname, lastname: profileForm.lastname }) });
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
      const verifyRes = await fetch('/api/profile/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: userData.username, password: passwordForm.currentPassword }) });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) { showToast('Current password is incorrect', 'danger'); setProfileLoading(false); return; }

      const res = await fetch('/api/profile/update-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: userData.username, newPassword: passwordForm.newPassword }) });
      const data = await res.json();
      if (data.success) { showToast('Password updated!', 'success'); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
      else showToast(data.message, 'danger');
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
  const sidebarMenu = getSidebarMenu(userRole);
  const canManage = (module) => hasPermission(userRole, module);

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="dashboard-wrapper">
      {/* Toast */}
      {toastMessage && <div className={`toast-notification toast-${toastMessage.type}`}>{toastMessage.message}</div>}

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
        <aside className={`sidebar ${sidebarOpen ? 'active' : ''}`}>
          <div className="sidebar-header">
            <div className="logo"></div>
            <div className="church-name">JOYFUL SOUND CHURCH</div>
            <div className="church-subtitle">INTERNATIONAL</div>

            <div className="user-info">
              <div className="user-avatar-container">
                <div className="user-avatar"><div className="avatar-content">{initials}</div></div>
                <div className="status-indicator">
                  <div className={`status-circle ${isVerified ? 'verified' : 'unverified'}`} title={isVerified ? 'Verified' : 'Unverified'}></div>
                </div>
              </div>
              <div className="user-details">
                <div className="user-name">{userData.firstname} {userData.lastname}</div>
                <div className="user-ministry">{userData.ministry} Ministry</div>
                <div className="user-role-badge" style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 12, background: 'rgba(255,195,0,0.2)', color: 'var(--accent)', marginTop: 4, display: 'inline-block' }}>
                  {userRole}
                </div>
              </div>
            </div>
          </div>

          <nav className="sidebar-menu">
            {sidebarMenu.map((item) => (
              <a key={item.id}
                className={`menu-item ${activeSection === item.section ? 'active' : ''} ${!isVerified && item.section !== 'home' ? 'disabled' : ''}`}
                onClick={() => showSection(item.section)}
              >
                <span className="menu-icon"><i className={item.icon}></i></span>
                <span>{item.label}</span>
                {item.section === 'messages' && unreadCount > 0 && (
                  <span className="notification-badge">{unreadCount}</span>
                )}
                {!isVerified && item.section !== 'home' && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#ffc107' }}><i className="fas fa-lock"></i></span>
                )}
              </a>
            ))}
          </nav>

          <button className="logout-btn" onClick={() => setShowLogoutModal(true)}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: 10 }}></i> Logout
          </button>
        </aside>

        {/* ============ MAIN CONTENT ============ */}
        <main className="main-content">
          <div className="content-header">
            <h1 id="pageTitle">
              {dashboardType === 'super-admin' && 'Super Admin Dashboard'}
              {dashboardType === 'admin' && 'Admin Dashboard'}
              {dashboardType === 'pastor' && 'Pastor Dashboard'}
              {dashboardType === 'ministry' && 'Ministry Portal'}
            </h1>
            <p>{userRole} — {userData.ministry} Ministry</p>
            <button className="dark-mode-toggle-header" onClick={toggleDarkMode} title="Toggle Dark Mode">
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
          </div>

          {!isVerified && (
            <div className="verification-banner">
              <h3><i className="fas fa-lock"></i> Account Pending Verification</h3>
              <p>Your account is currently under review. Please wait for administrator verification to access all features.</p>
            </div>
          )}

          {/* ========== HOME SECTION ========== */}
          <section className={`content-section ${activeSection === 'home' ? 'active' : ''}`}>
            {isVerified ? (
              <>
                <div className="welcome-message">
                  <h2><i className="fas fa-hand-sparkles"></i> Welcome back, {userData.firstname}!</h2>
                  <p>
                    {dashboardType === 'super-admin' && 'Full system access. Manage everything from here.'}
                    {dashboardType === 'admin' && 'Manage users, ministries, and system operations.'}
                    {dashboardType === 'pastor' && 'Oversee ministries, events, and your congregation.'}
                    {dashboardType === 'ministry' && "Here's what's happening in your ministry today."}
                  </p>
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
                  <div className="verse-controls">
                    <div className="version-selector">
                      <label>Version:</label>
                      {['niv', 'kjv', 'nkjv', 'cev', 'nasb'].map((v) => (
                        <button key={v} className={`version-btn ${bibleVersion === v ? 'active' : ''}`} onClick={() => setBibleVersion(v)}>{v.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                  <div className="verse-of-the-day">&ldquo;{dailyVerse.verse}&rdquo;</div>
                  <div className="verse-reference">— {dailyVerse.reference}</div>
                  {dailyVerse.explanation && <div className="verse-explanation">{dailyVerse.explanation}</div>}
                </div>

                {/* Pastors (Ministry view only) */}
                {dashboardType === 'ministry' && (
                  <>
                    <div className="pastors-section">
                      <h2><i className="fas fa-crown"></i> Our Spiritual Leaders</h2>
                      <div className="pastors-grid">
                        {PASTORS.map((p, i) => (<div key={i} className="pastor-card"><div className="pastor-photo" style={{ backgroundImage: `url('${p.photo}')`, backgroundColor: '#f8f9fa' }}></div><div className="pastor-name">{p.name}</div><div className="pastor-title">{p.title}</div></div>))}
                      </div>
                    </div>
                    <div className="church-family-section">
                      <h2><i className="fas fa-users"></i> Our Church Family Gatherings</h2>
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
                <div className="welcome-message"><h2><i className="fas fa-hand-sparkles"></i> Welcome, {userData.firstname}!</h2><p>Your account is pending verification.</p></div>
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
            <h2 className="section-title"><i className="fas fa-calendar-alt"></i> Weekly Schedule</h2>
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
            <h2 className="section-title"><i className="fas fa-calendar-alt"></i> Events</h2>

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
            <h2 className="section-title"><i className="fas fa-bullhorn"></i> Announcements</h2>

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
            <h2 className="section-title"><i className="fas fa-handshake"></i> Ministry Meetings</h2>

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
            <h2 className="section-title"><i className="fas fa-comments"></i> Community Hub</h2>

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
            <h2 className="section-title"><i className="fas fa-envelope"></i> Messages</h2>

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
            <h2 className="section-title"><i className="fas fa-clipboard-check"></i> Attendance Management</h2>

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
            <h2 className="section-title"><i className="fas fa-church"></i> Ministry Oversight</h2>
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
            <h2 className="section-title"><i className="fas fa-chart-bar"></i> Reports</h2>

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
            <h2 className="section-title"><i className="fas fa-users-cog"></i> User Management</h2>

            <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowUserForm(true); setEditingUser(null); }}>
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
                  <div className="form-group"><label>Username *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></div>
                  <div className="form-group"><label>Password *</label><input className="form-control" type="password" style={{ padding: '10px 15px' }} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Ministry</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.ministry} onChange={(e) => setUserForm({ ...userForm, ministry: e.target.value })}>
                      {ALL_MINISTRIES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Role</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                      {(userRole === ROLES.SUPER_ADMIN ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'Super Admin')).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleCreateUser}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowUserForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'var(--primary)', color: 'white' }}>
                    <th style={{ padding: 10 }}>Member ID</th>
                    <th style={{ padding: 10 }}>Name</th>
                    <th style={{ padding: 10 }}>Username</th>
                    <th style={{ padding: 10 }}>Ministry</th>
                    <th style={{ padding: 10 }}>Role</th>
                    <th style={{ padding: 10 }}>Status</th>
                    <th style={{ padding: 10 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #eee', background: u.is_active === false ? 'rgba(220,53,69,0.05)' : 'transparent' }}>
                      <td style={{ padding: 10 }}>{u.member_id}</td>
                      <td style={{ padding: 10 }}>{u.firstname} {u.lastname}</td>
                      <td style={{ padding: 10 }}>{u.username}</td>
                      <td style={{ padding: 10 }}>{u.ministry}</td>
                      <td style={{ padding: 10 }}>
                        {canManage(MODULES.ASSIGN_USER_ROLES) ? (
                          <select style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #dee2e6' }} value={u.role} onChange={(e) => handleUserAction(u.id, 'assign-role', { role: e.target.value })}>
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
            <h2 className="section-title"><i className="fas fa-church"></i> Ministry Management</h2>

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
            <h2 className="section-title"><i className="fas fa-shield-alt"></i> Roles & Permissions</h2>
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
            <h2 className="section-title"><i className="fas fa-cogs"></i> System Configuration</h2>
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
            <h2 className="section-title"><i className="fas fa-history"></i> Audit Logs</h2>
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
            <h2 className="section-title"><i className="fas fa-bible"></i> Bible Reader</h2>
            <div className="bible-controls">
              <div className="form-group" style={{ flex: 1 }}><label>Book</label>
                <select className="form-select" value={bibleBook} onChange={(e) => setBibleBook(e.target.value)} style={{ padding: '10px' }}>
                  {['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'].map((b) => (<option key={b} value={b}>{b}</option>))}
                </select>
              </div>
              <div className="form-group" style={{ width: 100 }}><label>Chapter</label><input type="number" className="form-control" value={bibleChapter} min={1} onChange={(e) => setBibleChapter(parseInt(e.target.value) || 1)} style={{ padding: '10px' }} /></div>
              <button className="btn-primary" onClick={loadBibleChapter} style={{ alignSelf: 'flex-end' }}>Read</button>
            </div>
            {bibleText && <div className="bible-text-display"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>{bibleText}</pre></div>}
            {bibleText && (
              <div className="bible-qa" style={{ marginTop: 20 }}><h3>Ask about this passage</h3>
                <div style={{ display: 'flex', gap: 10 }}><input className="form-control" placeholder="Ask a question..." value={bibleQuestion} onChange={(e) => setBibleQuestion(e.target.value)} style={{ padding: '10px 15px' }} /><button className="btn-primary" onClick={askBibleQuestionHandler}>Ask</button></div>
                {bibleAnswer && <div className="bible-answer" style={{ marginTop: 15 }}><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{bibleAnswer}</pre></div>}
              </div>
            )}
          </section>

          {/* ========== DAILY QUOTE ========== */}
          <section className={`content-section ${activeSection === 'daily-quote' ? 'active' : ''}`}>
            <h2 className="section-title"><i className="fas fa-quote-left"></i> Daily Quote</h2>
            <div className="quote-container"><div className="quote-text">&ldquo;{dailyQuote.quote}&rdquo;</div><div className="quote-author">— {dailyQuote.author}</div></div>
          </section>

          {/* ========== SPIRITUAL ASSISTANT ========== */}
          <section className={`content-section ${activeSection === 'spiritual-assistant' ? 'active' : ''}`}>
            <h2 className="section-title"><i className="fas fa-robot"></i> Spiritual Assistant</h2>
            <div className="chat-container">
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
            <h2 className="section-title"><i className="fas fa-user-circle"></i> My Profile</h2>
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
                <div className="form-group"><label>Username</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.username} readOnly /></div>
                <div className="form-group"><label>Ministry</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.ministry} readOnly /></div>
                <div className="form-group"><label>Role</label><input className="form-control" style={{ padding: '10px 15px' }} value={userRole} readOnly /></div>
                <div className="form-group"><label>Status</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.status} readOnly /></div>
                <div className="form-group"><label>Member ID</label><input className="form-control" style={{ padding: '10px 15px' }} value={userData.memberId || 'N/A'} readOnly /></div>
                <button className="btn-primary" onClick={saveProfile} disabled={profileLoading}>{profileLoading ? 'Saving...' : 'Save Changes'}</button>
              </div>
            )}

            {profileTab === 'password' && (
              <div className="profile-form">
                <div className="form-group"><label>Current Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></div>
                <div className="form-group"><label>New Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></div>
                <div className="form-group"><label>Confirm New Password</label><input type="password" className="form-control" style={{ padding: '10px 15px' }} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></div>
                {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Passwords do not match</p>}
                <button className="btn-primary" onClick={changePassword} disabled={profileLoading}>{profileLoading ? 'Updating...' : 'Update Password'}</button>
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

          {/* ========== CREATE LINEUP (Song Leader) ========== */}
          {canManage(MODULES.CREATE_SONG_LIST) && (
            <section className={`content-section ${activeSection === 'create-lineup' ? 'active' : ''}`}>
              <h2 className="section-title"><i className="fas fa-music"></i> Create Lineup</h2>
              <div className="lineup-form">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Schedule Date *</label><input type="date" className="form-control" style={{ padding: '10px 15px' }} value={lineupForm.scheduleDate} onChange={(e) => handleLineupChange('scheduleDate', e.target.value)} /></div>
                  <div className="form-group"><label>Practice Date</label><input type="date" className="form-control" style={{ padding: '10px 15px' }} value={lineupForm.practiceDate} onChange={(e) => handleLineupChange('practiceDate', e.target.value)} /></div>
                </div>
                <div className="form-group"><label>Song Leader *</label>
                  <select className="form-select" style={{ padding: '10px 15px' }} value={lineupForm.songLeader} onChange={(e) => handleLineupChange('songLeader', e.target.value)}>
                    <option value="">Select song leader</option>
                    {SONG_LEADERS.map((sl) => <option key={sl} value={sl}>{sl}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Backup Singers</label>
                  {lineupForm.backupSingers.map((singer, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                      <select className="form-select" style={{ padding: '10px 15px', flex: 1 }} value={singer} onChange={(e) => handleBackupChange(i, e.target.value)}>
                        <option value="">Select singer</option>
                        {BACKUP_OPTIONS.map((bo) => <option key={bo} value={bo}>{bo}</option>)}
                      </select>
                    </div>
                  ))}
                  {lineupForm.backupSingers.length < 5 && <button type="button" className="btn-secondary" onClick={addBackupSinger} style={{ fontSize: '0.85rem' }}><i className="fas fa-plus"></i> Add Backup Singer</button>}
                </div>

                {['slowSongs', 'fastSongs'].map((type) => (
                  <div key={type} className="song-form-section">
                    <h3><i className={`fas fa-${type === 'slowSongs' ? 'music' : 'bolt'}`}></i> {type === 'slowSongs' ? 'Slow' : 'Fast'} Songs</h3>
                    {lineupForm[type].map((song, i) => (
                      <div key={i} className="song-form-card">
                        <div className="song-form-header"><span>{type === 'slowSongs' ? 'Slow' : 'Fast'} Song {i + 1}</span>{lineupForm[type].length > 1 && <button type="button" className="btn-remove" onClick={() => removeSong(type, i)}><i className="fas fa-times"></i></button>}</div>
                        <input className="form-control" style={{ padding: '10px 15px', marginBottom: 8 }} placeholder="Song title" value={song.title} onChange={(e) => handleSongChange(type, i, 'title', e.target.value)} />
                        <input className="form-control" style={{ padding: '10px 15px', marginBottom: 8 }} placeholder="YouTube link" value={song.link} onChange={(e) => handleSongChange(type, i, 'link', e.target.value)} />
                        {song.link && extractYouTubeId(song.link) && <div className="youtube-preview"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                        <textarea className="form-control" style={{ padding: '10px 15px', marginBottom: 8 }} placeholder="Lyrics" rows={3} value={song.lyrics} onChange={(e) => handleSongChange(type, i, 'lyrics', e.target.value)}></textarea>
                        <input className="form-control" style={{ padding: '10px 15px' }} placeholder="Instructions" value={song.instructions} onChange={(e) => handleSongChange(type, i, 'instructions', e.target.value)} />
                      </div>
                    ))}
                    {lineupForm[type].length < 5 && <button type="button" className="btn-secondary" onClick={() => addSong(type)}><i className="fas fa-plus"></i> Add {type === 'slowSongs' ? 'Slow' : 'Fast'} Song</button>}
                  </div>
                ))}

                <button className="btn-primary btn-submit-lineup" onClick={submitLineup} disabled={lineupLoading}>
                  {lineupLoading ? 'Submitting...' : <><i className="fas fa-paper-plane"></i> Submit Lineup</>}
                </button>
              </div>
            </section>
          )}

        </main>
      </div>
    </div>
  );
}
