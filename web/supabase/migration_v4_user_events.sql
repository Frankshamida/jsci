-- ============================================
-- Migration v4: User-Created Events System
-- Allows Admin to enable users to create Events,
-- Meetings, Bible Study, Prayer Meeting, etc.
-- ============================================

-- 1. Add event_creator permission column to users table
-- This JSONB column stores which event types the user can create
-- Example: ["Event", "Meeting", "Bible Study", "Prayer Meeting"]
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_event_types JSONB DEFAULT '[]';

-- 2. USER EVENTS TABLE
-- Events created by enabled users (separate from admin/pastor events)
CREATE TABLE IF NOT EXISTS user_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'Event' CHECK (event_type IN ('Event', 'Meeting', 'Bible Study', 'Prayer Meeting', 'Fellowship', 'Outreach', 'Workshop', 'Other')),
  event_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  location TEXT,
  image_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by_name TEXT,
  ministry TEXT,
  is_active BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled', 'Completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_user_events_updated_at ON user_events;
CREATE TRIGGER update_user_events_updated_at
  BEFORE UPDATE ON user_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 3. USER EVENT RSVPs TABLE
CREATE TABLE IF NOT EXISTS user_event_rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES user_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'Going' CHECK (status IN ('Going', 'Maybe', 'Not Going')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

DROP TRIGGER IF EXISTS update_user_event_rsvps_updated_at ON user_event_rsvps;
CREATE TRIGGER update_user_event_rsvps_updated_at
  BEFORE UPDATE ON user_event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 4. RLS Policies
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON user_events;
DROP POLICY IF EXISTS "Allow all" ON user_event_rsvps;

CREATE POLICY "Allow all" ON user_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON user_event_rsvps FOR ALL USING (true) WITH CHECK (true);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_user_events_created_by ON user_events(created_by);
CREATE INDEX IF NOT EXISTS idx_user_events_event_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_date ON user_events(event_date);
CREATE INDEX IF NOT EXISTS idx_user_events_active ON user_events(is_active);
CREATE INDEX IF NOT EXISTS idx_user_event_rsvps_event ON user_event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_user_event_rsvps_user ON user_event_rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_users_allowed_event_types ON users USING GIN (allowed_event_types);
