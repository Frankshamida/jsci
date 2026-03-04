-- ============================================
-- Migration v5: Google Profile Picture Support
-- Stores the user's Google profile picture URL
-- ============================================

-- 1. Add profile_picture column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT DEFAULT NULL;
