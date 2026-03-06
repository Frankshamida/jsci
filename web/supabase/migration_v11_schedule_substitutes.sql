-- Migration V11: Schedule Substitutes Tracking
-- Adds original_song_leader tracking directly in schedules table
-- This makes substitute display clean and consistent across all views
-- Run this in Supabase SQL Editor

-- Add original song leader columns to schedules table
-- When a substitute is accepted, original_song_leader stores who was originally assigned
-- song_leader gets updated to the substitute's name
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS original_song_leader TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS original_song_leader_id UUID;

-- Create a clean view for schedule substitutes (optional, for easy querying)
CREATE OR REPLACE VIEW schedule_substitute_view AS
SELECT 
  s.id,
  s.schedule_id,
  s.song_leader AS current_song_leader,
  s.original_song_leader,
  s.original_song_leader_id,
  s.backup_singers,
  s.schedule_date,
  s.practice_date,
  s.slow_songs,
  s.fast_songs,
  s.submitted_by,
  s.status,
  CASE WHEN s.original_song_leader IS NOT NULL THEN true ELSE false END AS has_substitute
FROM schedules s
ORDER BY s.schedule_date DESC;

-- Index for quick lookups on substituted schedules
CREATE INDEX IF NOT EXISTS idx_schedules_original_leader ON schedules(original_song_leader);

-- Backfill: For any existing accepted substitutes, populate the original_song_leader columns
-- This handles data that was already substituted before this migration
DO $$
DECLARE
  sub RECORD;
BEGIN
  FOR sub IN 
    SELECT ls.requester_name, ls.requester_id, ls.schedule_date, ls.substitute_name
    FROM lineup_substitutes ls
    WHERE ls.status = 'Accepted'
  LOOP
    UPDATE schedules 
    SET original_song_leader = sub.requester_name,
        original_song_leader_id = sub.requester_id
    WHERE schedule_date = sub.schedule_date
      AND original_song_leader IS NULL;
  END LOOP;
END $$;
