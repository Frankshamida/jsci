-- Migration V9: Add role_type to lineup_excuses
-- Supports excuses from: Song Leader, Backup Singer, Instrumentalist, Dancer, Media
-- Also adds profile_picture column for quick display in notification cards.

ALTER TABLE lineup_excuses ADD COLUMN IF NOT EXISTS role_type TEXT DEFAULT 'Song Leader';
ALTER TABLE lineup_excuses ADD COLUMN IF NOT EXISTS profile_picture TEXT;

-- Drop old unique constraint and add new one with role_type
ALTER TABLE lineup_excuses DROP CONSTRAINT IF EXISTS lineup_excuses_user_id_excuse_date_key;
ALTER TABLE lineup_excuses ADD CONSTRAINT lineup_excuses_user_role_date_key UNIQUE (user_id, excuse_date, role_type);
