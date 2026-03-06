-- Migration V10: Lineup Substitutes
-- Adds substitute request system for Song Leaders
-- Run this in Supabase SQL Editor

-- Create the lineup_substitutes table
CREATE TABLE IF NOT EXISTS lineup_substitutes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID NOT NULL,
  requester_name TEXT NOT NULL,
  requester_profile_picture TEXT,
  schedule_id TEXT,
  schedule_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending Admin',
  -- Statuses: 'Pending Admin' | 'Open for Sub' | 'Accepted' | 'Rejected' | 'Cancelled'
  substitute_id UUID,
  substitute_name TEXT,
  substitute_profile_picture TEXT,
  admin_note TEXT,
  reviewed_by TEXT,
  thank_you_sent BOOLEAN DEFAULT false,
  thank_you_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(requester_id, schedule_date)
);

-- Enable RLS
ALTER TABLE lineup_substitutes ENABLE ROW LEVEL SECURITY;

-- Allow all operations (app uses service role key)
CREATE POLICY "Allow all for lineup_substitutes" ON lineup_substitutes FOR ALL USING (true);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_lineup_subs_requester ON lineup_substitutes(requester_id);
CREATE INDEX IF NOT EXISTS idx_lineup_subs_substitute ON lineup_substitutes(substitute_id);
CREATE INDEX IF NOT EXISTS idx_lineup_subs_status ON lineup_substitutes(status);
CREATE INDEX IF NOT EXISTS idx_lineup_subs_date ON lineup_substitutes(schedule_date);
