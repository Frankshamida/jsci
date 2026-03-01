-- Migration v3: Add sub_role column to users table
-- This stores the ministry-specific role (e.g., Singers, Instrumentalists, Lyrics, etc.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_role TEXT DEFAULT NULL;

-- Update RLS or indexes if needed
CREATE INDEX IF NOT EXISTS idx_users_sub_role ON users(sub_role);
CREATE INDEX IF NOT EXISTS idx_users_ministry ON users(ministry);
