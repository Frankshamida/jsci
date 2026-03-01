-- ============================================
-- MIGRATION: Guest role + nullable ministry
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Drop the old role CHECK constraint (it doesn't include 'Guest')
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Add the updated role CHECK constraint WITH 'Guest' included
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('Guest', 'Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'));

-- 3. Make ministry column nullable (Guests have no ministry assigned)
ALTER TABLE users ALTER COLUMN ministry DROP NOT NULL;

-- 4. Set default role to 'Guest' for new users
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'Guest';

-- 5. Make ministry default to NULL
ALTER TABLE users ALTER COLUMN ministry SET DEFAULT NULL;

-- 6. Update any existing users without a role to 'Guest'
UPDATE users SET role = 'Guest' WHERE role IS NULL;
