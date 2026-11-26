-- ============================================================
-- Sunday Service
--   The church's Facebook Lives (live_streams), posted by an Admin or Super
--   Admin from Dashboard > Social Media > Sunday Service and shown on the
--   website at /sunday-service (each one at /sunday-service/<slug>), where
--   anyone signed in (a free Guest account is enough) watches it.
--
--   This adds to live_streams what the Midweek Service videos have:
--     service_date         the day of the service (was: the day it was posted)
--     speaker, description who preached, and a note about the message
--     slug                 its address. A plain "Sunday Service" is its date
--                          (/sunday-service/2026-11-29); a service with a
--                          title of its own gets the title
--                          (/sunday-service/faith-over-fear)
--     old_slugs            addresses it had before, redirected to the new one
--     thumbnail_template   the design its thumbnail is drawn with, from its
--                          own title, date and speaker
--
--   It also closes live_streams to writes from the browser: posting, editing
--   and deleting now go through the server (/api/live-streams/manage), which
--   checks for an Admin or Super Admin. Reading stays open - the Community Hub
--   and the live page listen for changes.
--
-- Safe to run more than once.
-- ============================================================

ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS service_date DATE;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS speaker TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS old_slugs TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS thumbnail_template TEXT NOT NULL DEFAULT 'spotlight';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_streams_thumbnail_template_check') THEN
    ALTER TABLE live_streams ADD CONSTRAINT live_streams_thumbnail_template_check
      CHECK (thumbnail_template IN ('spotlight', 'calendar', 'sanctuary', 'bulletin', 'joyfulSound'));
  END IF;
END $$;

-- The streams posted before: their date is the day they were posted, in the
-- Philippines. New ones get today's unless the dashboard gives one.
UPDATE live_streams
SET service_date = (COALESCE(created_at, NOW()) AT TIME ZONE 'Asia/Manila')::date
WHERE service_date IS NULL;
ALTER TABLE live_streams ALTER COLUMN service_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Manila')::date);

-- Every stream without a slug gets one, by the website's rules: a plain title
-- ("Sunday Service Live") gives the date; any other title gives the title,
-- lowercase, accents and symbols gone, spaces to hyphens. When two give the
-- same slug, the older keeps it and the others add their date, then -2, -3.
WITH named AS (
  SELECT
    v.id,
    v.service_date,
    v.created_at,
    COALESCE(NULLIF(trim(BOTH '-' FROM left(trim(BOTH '-' FROM regexp_replace(
      regexp_replace(
        lower(translate(trim(COALESCE(NULLIF(trim(v.title), ''), v.caption, '')),
          'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy')),
        '[''‘’`]', '', 'g'),
      '[^a-z0-9]+', '-', 'g')), 80)), ''), 'service') AS t
  FROM live_streams v
  WHERE v.slug IS NULL
),
base AS (
  SELECT
    n.*,
    to_char(n.service_date, 'YYYY-MM-DD') AS d,
    CASE WHEN n.t IN ('sunday', 'sunday-service', 'sunday-service-live', 'sunday-live', 'sunday-worship',
                      'sunday-worship-service', 'live', 'live-service', 'service', 'worship-service',
                      'sunday-celebration-service')
      THEN to_char(n.service_date, 'YYYY-MM-DD') ELSE n.t END AS s
  FROM named n
),
ranked AS (
  SELECT
    b.*,
    row_number() OVER (PARTITION BY b.s ORDER BY b.service_date, b.created_at) AS n,
    row_number() OVER (PARTITION BY b.s, b.service_date ORDER BY b.created_at) AS dn,
    EXISTS (SELECT 1 FROM live_streams o WHERE o.slug = b.s OR b.s = ANY (o.old_slugs)) AS taken
  FROM base b
)
UPDATE live_streams v
SET slug = CASE
  WHEN r.n = 1 AND NOT r.taken THEN r.s
  -- the slug is the date already: straight to -2, -3
  WHEN r.s = r.d THEN r.s || '-' || (r.n + CASE WHEN r.taken THEN 1 ELSE 0 END)
  WHEN r.dn = 1 THEN r.s || '-' || r.d
  ELSE r.s || '-' || r.d || '-' || r.dn
END
FROM ranked r
WHERE v.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_streams_slug ON live_streams (slug);
CREATE INDEX IF NOT EXISTS idx_live_streams_old_slugs ON live_streams USING GIN (old_slugs);
CREATE INDEX IF NOT EXISTS idx_live_streams_listed ON live_streams (is_active, service_date DESC, created_at DESC);

-- Writes only through the server (the service role is not bound by these).
DROP POLICY IF EXISTS "Admins can insert live streams" ON live_streams;
DROP POLICY IF EXISTS "Admins can update live streams" ON live_streams;
DROP POLICY IF EXISTS "Admins can delete live streams" ON live_streams;
