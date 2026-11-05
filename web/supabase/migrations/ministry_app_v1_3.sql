-- ============================================================
-- JSCI Ministry app 1.3
--   1. lineup_swaps            two teammates trade dates (same part)
--   2. ministry_chat_messages  group chats per ministry role, PAW Team, everyone
--   3. ministry_chat_reads     who has received / seen each chat (ticks)
--   4. attendance              GPS self check-in at church (where, when, which)
-- Safe to run more than once.
-- ============================================================

-- 1. SWAPS ---------------------------------------------------
CREATE TABLE IF NOT EXISTS lineup_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_name TEXT NOT NULL,
  requester_date DATE NOT NULL,          -- the date the requester gives away
  partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  partner_date DATE NOT NULL,            -- the partner's date the requester takes
  part TEXT NOT NULL,                    -- 'Song Leader' | 'Backup Singer' | 'Keyboard' | 'Guitar' | 'Bass' | 'Drums' | 'Dancer'
  role_type TEXT NOT NULL,               -- 'Song Leader' | 'Backup Singer' | 'Instrumentalist' | 'Dancer'
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Waiting Partner'
    CHECK (status IN ('Waiting Partner', 'Pending Approval', 'Approved', 'Declined', 'Rejected', 'Cancelled')),
  partner_note TEXT,
  admin_note TEXT,
  reviewed_by TEXT,
  responded_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lineup_swaps_requester ON lineup_swaps(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lineup_swaps_partner ON lineup_swaps(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lineup_swaps_status ON lineup_swaps(status);
CREATE INDEX IF NOT EXISTS idx_lineup_swaps_dates ON lineup_swaps(requester_date, partner_date);

-- One open swap per person and date.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lineup_swaps_open
  ON lineup_swaps(requester_id, requester_date)
  WHERE status IN ('Waiting Partner', 'Pending Approval');

CREATE OR REPLACE FUNCTION lineup_swaps_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lineup_swaps_touch ON lineup_swaps;
CREATE TRIGGER trg_lineup_swaps_touch BEFORE UPDATE ON lineup_swaps
  FOR EACH ROW EXECUTE FUNCTION lineup_swaps_touch();

-- Only the server (service-role client) reads and writes it: RLS on, no policy.
ALTER TABLE lineup_swaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lineup_swaps FROM anon, authenticated;

-- 2. GROUP CHAT MESSAGES ------------------------------------
-- room: 'all' (JSCI Ministry Members), 'paw' (PAW Team: singers, musicians,
-- dancers, media), or one ministry role: 'singer', 'musician', 'dancer',
-- 'media', 'usher'. Who may read a room is decided on the server.
CREATE TABLE IF NOT EXISTS ministry_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room TEXT NOT NULL CHECK (room IN ('all', 'paw', 'singer', 'musician', 'dancer', 'media', 'usher')),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  client_id TEXT,                        -- the phone's id for it, so a resend never doubles it
  deleted_at TIMESTAMPTZ,                -- unsent by the sender
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ministry_chat_room_time ON ministry_chat_messages(room, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ministry_chat_client ON ministry_chat_messages(sender_id, client_id) WHERE client_id IS NOT NULL;

ALTER TABLE ministry_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ministry_chat_messages FROM anon, authenticated;

-- 3. GROUP CHAT RECEIPTS ------------------------------------
-- delivered_at: the member's app last received the room's messages
-- read_at:      the member last had the room open (seen)
CREATE TABLE IF NOT EXISTS ministry_chat_reads (
  room TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (room, user_id)
);

ALTER TABLE ministry_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ministry_chat_reads FROM anon, authenticated;

-- 4. ATTENDANCE: GPS SELF CHECK-IN --------------------------
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_type TEXT;        -- 'Sunday Service' | 'Practice'
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS distance_m INTEGER;       -- metres from church at check-in
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source TEXT;              -- 'gps' | 'rfid' | 'manual'

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, event_date DESC);
