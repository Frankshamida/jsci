-- ============================================
-- SUPABASE DATABASE SCHEMA v2.0 (IDEMPOTENT)
-- Ministry Portal - Joyful Sound Church International
-- Implements: 50 Modules, 6 User Roles
-- Roles: Member, Song Leader, Leader, Pastor, Admin, Super Admin
-- Safe to run multiple times — all statements use IF NOT EXISTS / DROP IF EXISTS
-- ============================================

-- ============================================
-- 1. USERS TABLE (Updated with role field)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id TEXT UNIQUE,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  birthdate DATE,
  ministry TEXT NOT NULL DEFAULT 'Media',
  role TEXT NOT NULL DEFAULT 'Member' CHECK (role IN ('Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin')),
  security_question TEXT NOT NULL,
  security_answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Unverified',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may not exist if table was created by v1 migration
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- Add CHECK constraint for role if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'));
  END IF;
END $$;

-- Auto-generate member_id on insert
CREATE SEQUENCE IF NOT EXISTS member_id_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_member_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.member_id := 'JSCI-' || LPAD(NEXTVAL('member_id_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_member_id ON users;
CREATE TRIGGER set_member_id
  BEFORE INSERT ON users
  FOR EACH ROW
  WHEN (NEW.member_id IS NULL)
  EXECUTE FUNCTION generate_member_id();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. SCHEDULES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id TEXT UNIQUE,
  song_leader TEXT NOT NULL,
  backup_singers JSONB DEFAULT '[]',
  schedule_date DATE NOT NULL,
  practice_date DATE,
  slow_songs JSONB DEFAULT '[]',
  fast_songs JSONB DEFAULT '[]',
  submitted_by TEXT,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS schedule_id_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_schedule_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.schedule_id := 'SCH-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('schedule_id_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_schedule_id ON schedules;
CREATE TRIGGER set_schedule_id
  BEFORE INSERT ON schedules
  FOR EACH ROW
  WHEN (NEW.schedule_id IS NULL)
  EXECUTE FUNCTION generate_schedule_id();

DROP TRIGGER IF EXISTS update_schedules_updated_at ON schedules;
CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  location TEXT,
  image_url TEXT,
  created_by UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 4. EVENT RSVPs TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS event_rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'Going' CHECK (status IN ('Going', 'Maybe', 'Not Going')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- ============================================
-- 5. ANNOUNCEMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  author UUID REFERENCES users(id),
  author_name TEXT,
  is_pinned BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_announcements_updated_at ON announcements;
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 6. MINISTRY MEETINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS ministry_meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  ministry TEXT NOT NULL,
  meeting_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  created_by UUID REFERENCES users(id),
  created_by_name TEXT,
  status TEXT DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_ministry_meetings_updated_at ON ministry_meetings;
CREATE TRIGGER update_ministry_meetings_updated_at
  BEFORE UPDATE ON ministry_meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 7. MEETING RSVPs TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS meeting_rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES ministry_meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'Going' CHECK (status IN ('Going', 'Maybe', 'Not Going')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meeting_id, user_id)
);

-- ============================================
-- 8. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'danger')),
  is_read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 9. MESSAGES TABLE (Communication module)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  is_broadcast BOOLEAN DEFAULT false,
  broadcast_target TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 10. COMMUNITY POSTS TABLE (News Feed / Community Hub)
-- ============================================
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id UUID REFERENCES users(id) ON DELETE CASCADE,
  author_name TEXT,
  content TEXT NOT NULL,
  image_url TEXT,
  is_pinned BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_community_posts_updated_at ON community_posts;
CREATE TRIGGER update_community_posts_updated_at
  BEFORE UPDATE ON community_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 11. POST LIKES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS post_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- ============================================
-- 12. POST COMMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS post_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE CASCADE,
  author_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 13. ATTENDANCE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  status TEXT DEFAULT 'Present' CHECK (status IN ('Present', 'Absent', 'Late', 'Excused')),
  marked_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_attendance_updated_at ON attendance;
CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 14. MINISTRIES TABLE (for Admin/Super Admin management)
-- ============================================
CREATE TABLE IF NOT EXISTS ministries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  leader_id UUID REFERENCES users(id),
  leader_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_ministries_updated_at ON ministries;
CREATE TRIGGER update_ministries_updated_at
  BEFORE UPDATE ON ministries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Insert default ministries
INSERT INTO ministries (name, description) VALUES
  ('Media', 'Media and audio/visual ministry'),
  ('Praise And Worship', 'Praise and worship music ministry'),
  ('Dancers', 'Dance and movement ministry'),
  ('Ashers', 'Ushering and hospitality ministry')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 15. ROLES TABLE (for Super Admin role management)
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Insert default roles
INSERT INTO roles (name, description, permissions) VALUES
  ('Member', 'Basic church member', '["view_dashboard","view_profile","update_profile","change_password","view_schedule","view_events","view_announcements","view_community","create_posts","like_comment_posts","view_messages","send_messages","rsvp_events","rsvp_meetings","view_meetings","view_reports","logout"]'),
  ('Song Leader', 'Praise and worship song leader', '["view_dashboard","view_profile","update_profile","change_password","view_schedule","view_events","view_announcements","view_community","create_posts","like_comment_posts","view_messages","send_messages","send_updates_pastors","rsvp_events","rsvp_meetings","view_meetings","create_meetings","update_meetings","create_lineup","update_lineup","assign_singers","view_reports","view_ministry_reports","logout"]'),
  ('Leader', 'Ministry leader', '["view_dashboard","view_profile","update_profile","change_password","view_schedule","view_events","view_announcements","view_community","create_posts","like_comment_posts","view_messages","send_messages","send_updates_pastors","rsvp_events","rsvp_meetings","view_meetings","create_meetings","update_meetings","view_reports","view_ministry_reports","logout"]'),
  ('Pastor', 'Church pastor', '["view_pastor_dashboard","view_analytics","view_bible_verses","view_all_ministries","view_ministry_members","assign_members","create_schedule","update_schedule","create_events","update_events","delete_events","view_event_participants","create_announcements","view_announcements","update_announcements","delete_announcements","view_attendance","mark_attendance","update_attendance","delete_attendance","send_broadcasts","view_community_extended","pin_posts","view_ministry_updates","generate_reports","view_profile","update_profile","logout"]'),
  ('Admin', 'System administrator', '["view_admin_dashboard","view_system_analytics","view_bible_verses","create_users","view_users","update_users","deactivate_users","activate_users","reset_passwords","create_ministry","view_ministry","update_ministry","delete_ministry","assign_users_ministry","create_events","view_events","update_events","delete_events","create_announcements","view_announcements","update_announcements","delete_announcements","view_attendance","mark_attendance","update_attendance","delete_attendance","generate_reports","view_reports","export_reports","send_broadcasts","view_profile","update_profile","logout"]'),
  ('Super Admin', 'Full system access', '["all"]')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 16. AUDIT LOGS TABLE (for Super Admin)
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 17. SYSTEM SETTINGS TABLE (for Super Admin)
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
  ('church_name', '"Joyful Sound Church International"', 'Church name displayed across the portal'),
  ('bible_verse_api', '"groq"', 'Bible verse API provider'),
  ('theme_primary_color', '"#926C15"', 'Primary brand color'),
  ('theme_secondary_color', '"#C9980B"', 'Secondary brand color'),
  ('enable_2fa', 'false', 'Enable two-factor authentication'),
  ('maintenance_mode', 'false', 'Enable maintenance mode')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ministry_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first, then recreate
DROP POLICY IF EXISTS "Allow all" ON users;
DROP POLICY IF EXISTS "Allow all" ON schedules;
DROP POLICY IF EXISTS "Allow all" ON announcements;
DROP POLICY IF EXISTS "Allow all" ON events;
DROP POLICY IF EXISTS "Allow all" ON event_rsvps;
DROP POLICY IF EXISTS "Allow all" ON ministry_meetings;
DROP POLICY IF EXISTS "Allow all" ON meeting_rsvps;
DROP POLICY IF EXISTS "Allow all" ON notifications;
DROP POLICY IF EXISTS "Allow all" ON messages;
DROP POLICY IF EXISTS "Allow all" ON community_posts;
DROP POLICY IF EXISTS "Allow all" ON post_likes;
DROP POLICY IF EXISTS "Allow all" ON post_comments;
DROP POLICY IF EXISTS "Allow all" ON attendance;
DROP POLICY IF EXISTS "Allow all" ON ministries;
DROP POLICY IF EXISTS "Allow all" ON roles;
DROP POLICY IF EXISTS "Allow all" ON audit_logs;
DROP POLICY IF EXISTS "Allow all" ON system_settings;

CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON announcements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON event_rsvps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON ministry_meetings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON meeting_rsvps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON community_posts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON post_likes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON post_comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON ministries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON system_settings FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_ministry ON users(ministry);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_meetings_ministry ON ministry_meetings(ministry);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_community_posts_active ON community_posts(is_active);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(event_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
