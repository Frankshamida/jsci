-- Migration V16: Add role_type to lineup_substitutes
-- Supports substitute requests from: Song Leader, Backup Singer, Instrumentalist, Dancer
-- This allows backup singers, instrumentalists, and dancers to request substitutions for their schedules.

-- Add role_type column (defaults to 'Song Leader' for backward compatibility)
ALTER TABLE lineup_substitutes ADD COLUMN IF NOT EXISTS role_type TEXT DEFAULT 'Song Leader';

-- Drop old unique constraint and add new one including role_type
-- This allows same user to request subs for different roles on the same date
ALTER TABLE lineup_substitutes DROP CONSTRAINT IF EXISTS lineup_substitutes_requester_id_schedule_date_key;
ALTER TABLE lineup_substitutes ADD CONSTRAINT lineup_substitutes_requester_role_date_key UNIQUE (requester_id, schedule_date, role_type);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_lineup_subs_role_type ON lineup_substitutes(role_type);
