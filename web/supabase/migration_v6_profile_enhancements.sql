-- ============================================
-- Migration v6: Profile Enhancements
-- Adds life_verse column for user's favorite Bible verse
-- birthdate column already exists from migration.sql
-- ============================================

-- 1. Add life_verse column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS life_verse TEXT DEFAULT NULL;

-- 2. Ensure birthdate column exists (it should already from original migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate DATE DEFAULT NULL;

-- 3. Create storage bucket for profile pictures (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile', 'profile', true)
-- ON CONFLICT (id) DO NOTHING;

-- 4. Storage policy: Allow authenticated users to upload their own profile pictures
-- CREATE POLICY "Users can upload their own profile picture"
-- ON storage.objects FOR INSERT
-- WITH CHECK (bucket_id = 'profile');

-- CREATE POLICY "Anyone can view profile pictures"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'profile');

-- CREATE POLICY "Users can update their own profile picture"
-- ON storage.objects FOR UPDATE
-- USING (bucket_id = 'profile');

-- CREATE POLICY "Users can delete their own profile picture"
-- ON storage.objects FOR DELETE
-- USING (bucket_id = 'profile');
