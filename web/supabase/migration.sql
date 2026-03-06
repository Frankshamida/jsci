-- ============================================
-- SUPABASE DATABASE SCHEMA
-- Ministry Portal - Joyful Sound Church International
-- ============================================

-- 1. USERS TABLE
-- Replaces the Google Sheets "Users" sheet
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id TEXT UNIQUE,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  birthdate DATE,
  ministry TEXT NOT NULL DEFAULT 'Media',
  security_question TEXT NOT NULL,
  security_answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Unverified',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate member_id on insert
CREATE OR REPLACE FUNCTION generate_member_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.member_id := 'JSCI-' || LPAD(NEXTVAL('member_id_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS member_id_seq START WITH 1;

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

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- 2. SCHEDULES TABLE
-- Replaces the Google Sheets "Schedules" sheet
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

-- Auto-generate schedule_id
CREATE OR REPLACE FUNCTION generate_schedule_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.schedule_id := 'SCH-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('schedule_id_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS schedule_id_seq START WITH 1;

CREATE TRIGGER set_schedule_id
  BEFORE INSERT ON schedules
  FOR EACH ROW
  WHEN (NEW.schedule_id IS NULL)
  EXECUTE FUNCTION generate_schedule_id();

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- 3. ANNOUNCEMENTS TABLE (for future use)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  author TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read/write for the app (using service role or anon key with policies)
CREATE POLICY "Allow all operations on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on schedules" ON schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on announcements" ON announcements FOR ALL USING (true) WITH CHECK (true);


-- 5. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_ministry ON users(ministry);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedules_song_leader ON schedules(song_leader);
