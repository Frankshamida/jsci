-- ============================================================
-- Church ID cards (My Profile > My ID) - run once in the Supabase SQL editor.
--
-- Adds to users:
--   emergency_name, emergency_phone  printed on the back of the ID; edited in
--                                    My Profile > About me
--   id_code        the random code in the ID's QR (sanctuaryhub/id/<code>).
--                  Reporting a card lost replaces it, so the old QR stops
--                  working.
--   id_issued_at   when the ID was issued (first opened)
--   id_valid_until the ID is valid until this day (two years)
--   id_lost_at     when the person last reported their printed card lost
--
-- Safe to run more than once. Until it is run, My ID still shows the card,
-- without the QR code, the dates and the emergency contact.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_name  text,
  ADD COLUMN IF NOT EXISTS emergency_phone text,
  ADD COLUMN IF NOT EXISTS id_code         text,
  ADD COLUMN IF NOT EXISTS id_issued_at    timestamptz,
  ADD COLUMN IF NOT EXISTS id_valid_until  date,
  ADD COLUMN IF NOT EXISTS id_lost_at      timestamptz;

-- One person per QR code.
CREATE UNIQUE INDEX IF NOT EXISTS users_id_code_key ON users (id_code) WHERE id_code IS NOT NULL;

-- Check: the six columns are there.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name IN ('emergency_name', 'emergency_phone', 'id_code', 'id_issued_at', 'id_valid_until', 'id_lost_at')
 ORDER BY column_name;
