-- ============================================
-- Chat Presence + Private Messenger Support
-- Safe to run multiple times (idempotent)
-- ============================================

-- 1) Ensure messages table exists for private chat
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

ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_target TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 2) Add online/offline presence fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_last_seen TIMESTAMPTZ;

-- 3) Performance indexes for chat list/thread
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver_created
  ON messages(sender_id, receiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender_read
  ON messages(receiver_id, sender_id, is_read);

CREATE INDEX IF NOT EXISTS idx_messages_is_broadcast_created
  ON messages(is_broadcast, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_chat_presence
  ON users(chat_is_online, chat_last_seen DESC);

-- 4) RLS + broad policy (matches existing project pattern)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON messages;
CREATE POLICY "Allow all" ON messages FOR ALL USING (true) WITH CHECK (true);

-- 5) Add is_unsent column for the unsend feature
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_unsent BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
