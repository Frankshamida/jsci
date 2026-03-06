-- ============================================
-- MIGRATION: Email-based auth + Google OAuth + OTP password reset
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add email column (primary login identifier)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Add google_id column for Google OAuth
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- 3. Backfill: copy existing usernames into email BEFORE dropping username
UPDATE users SET email = username WHERE email IS NULL AND username IS NOT NULL;

-- 4. Drop the username column entirely
ALTER TABLE users DROP COLUMN IF EXISTS username;

-- 5. Make security_question and security_answer nullable (removed from signup)
ALTER TABLE users ALTER COLUMN security_question DROP NOT NULL;
ALTER TABLE users ALTER COLUMN security_answer DROP NOT NULL;

-- 6. Add unique constraint on email
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END $$;

-- 7. Make email NOT NULL (now that it's backfilled)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

-- 8. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- 9. Password Resets table (for OTP)
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);

-- 10. RLS policy for password_resets (allow all operations for the app)
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on password_resets" ON password_resets FOR ALL USING (true) WITH CHECK (true);

-- 10. Auto-clean expired OTPs (optional — run periodically or via cron)
-- DELETE FROM password_resets WHERE expires_at < NOW();
