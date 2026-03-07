-- ============================================
-- Migration V17: Enable Real-Time for Substitute Requests,
-- Notifications, and Lineup Excuses
-- 
-- This allows the dashboard to:
-- 1. Instantly update sub request status when admin approves/rejects
-- 2. Show notification popups to backup singers when a sub opens
-- 3. Real-time excuse status updates
-- ============================================

-- Enable full replica identity so all events include full row data
ALTER TABLE lineup_substitutes REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;
ALTER TABLE lineup_excuses REPLICA IDENTITY FULL;

-- Add tables to real-time publication
ALTER PUBLICATION supabase_realtime ADD TABLE lineup_substitutes;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE lineup_excuses;
