-- ============================================
-- Migration V15: Enable Real-Time for Users Table
-- Allows the dashboard to receive instant updates
-- when admin changes role, ministry, verification, etc.
-- ============================================

-- Enable full replica identity so DELETE events include the row data
ALTER TABLE users REPLICA IDENTITY FULL;

-- Add users table to real-time publication
ALTER PUBLICATION supabase_realtime ADD TABLE users;
