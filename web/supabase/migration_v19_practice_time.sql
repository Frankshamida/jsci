-- Migration V19: Add practice_time column to schedules table
-- This allows Song Leaders to set a specific time for practice (e.g., "14:00", "3:00 PM")

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS practice_time TEXT DEFAULT NULL;
