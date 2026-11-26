-- ============================================================
-- Service videos
--   Facebook videos of past services - the Online Midweek Service first of
--   all - posted by an Admin or Super Admin from Dashboard > Live & Videos,
--   listed on the website at /midweek (each at /midweek/<slug>), and opened on
--   Facebook by anyone signed in (a free Guest account is enough).
--
--   service_videos   one row per video. `video_url` is the video's Facebook
--                    link (https://www.facebook.com/<page>/videos/<id>/, a reel,
--                    a share link ...), as the admin pasted it, tidied.
--                    `slug` is its address (/midweek/the-power-of-god), from
--                    the title; `old_slugs` the addresses it had before a
--                    rename, which redirect to the current one.
--                    `thumbnail_template` is the design its thumbnail is drawn
--                    with, from its own title, date and speaker.
--
-- Only the server (service-role client) reads and writes it: RLS on, no
-- policy. The website asks the server, which hands a video's link only to a
-- signed-in account.
-- Safe to run more than once - run it again after an update to this file.
-- ============================================================

CREATE TABLE IF NOT EXISTS service_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Midweek Service',
  speaker TEXT,                               -- who preached, if given (also on the thumbnail)
  description TEXT,                           -- the message, a passage, a note
  category TEXT NOT NULL DEFAULT 'midweek' CHECK (category IN ('midweek', 'sunday', 'special')),
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  duration_seconds INTEGER,                   -- not used now (it was read from an on-site player)
  cover_url TEXT,                             -- not used now (an uploaded picture, before the templates)
  cover_public_id TEXT,                       -- its Cloudinary id, so it is deleted with the video
  slug TEXT,                                  -- /midweek/<slug>
  old_slugs TEXT[] NOT NULL DEFAULT '{}',     -- earlier slugs, redirected to the current one
  thumbnail_template TEXT NOT NULL DEFAULT 'spotlight',
  is_published BOOLEAN NOT NULL DEFAULT TRUE, -- false: hidden from the website
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Added after the first version: the cover picture.
ALTER TABLE service_videos ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE service_videos ADD COLUMN IF NOT EXISTS cover_public_id TEXT;

-- Added for /midweek/<slug> and the thumbnail templates.
ALTER TABLE service_videos ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE service_videos ADD COLUMN IF NOT EXISTS old_slugs TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE service_videos ADD COLUMN IF NOT EXISTS thumbnail_template TEXT NOT NULL DEFAULT 'spotlight';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_videos_thumbnail_template_check') THEN
    ALTER TABLE service_videos ADD CONSTRAINT service_videos_thumbnail_template_check
      CHECK (thumbnail_template IN ('spotlight', 'calendar', 'sanctuary', 'bulletin', 'joyfulSound'));
  END IF;
END $$;

-- Every video without a slug gets one from its title, by the website's rules:
-- lowercase, accents and symbols gone, spaces to hyphens ("The Power of God"
-- -> the-power-of-god). When two titles give the same slug, the older video
-- keeps it and the others add their date (the-power-of-god-2026-12-02).
WITH base AS (
  SELECT
    v.id,
    v.service_date,
    v.created_at,
    COALESCE(NULLIF(trim(BOTH '-' FROM left(trim(BOTH '-' FROM regexp_replace(
      regexp_replace(
        lower(translate(trim(v.title),
          'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy')),
        '[''‘’`]', '', 'g'),
      '[^a-z0-9]+', '-', 'g')), 80)), ''), 'service') AS s
  FROM service_videos v
  WHERE v.slug IS NULL
),
ranked AS (
  SELECT
    b.*,
    row_number() OVER (PARTITION BY b.s ORDER BY b.service_date, b.created_at) AS n,
    row_number() OVER (PARTITION BY b.s, b.service_date ORDER BY b.created_at) AS dn,
    EXISTS (SELECT 1 FROM service_videos o WHERE o.slug = b.s OR b.s = ANY (o.old_slugs)) AS taken
  FROM base b
)
UPDATE service_videos v
SET slug = CASE
  WHEN r.n = 1 AND NOT r.taken THEN r.s
  WHEN r.dn = 1 THEN r.s || '-' || to_char(r.service_date, 'YYYY-MM-DD')
  ELSE r.s || '-' || to_char(r.service_date, 'YYYY-MM-DD') || '-' || r.dn
END
FROM ranked r
WHERE v.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_videos_slug ON service_videos (slug);
CREATE INDEX IF NOT EXISTS idx_service_videos_old_slugs ON service_videos USING GIN (old_slugs);

CREATE INDEX IF NOT EXISTS idx_service_videos_published
  ON service_videos (is_published, service_date DESC, created_at DESC);

ALTER TABLE service_videos ENABLE ROW LEVEL SECURITY;
