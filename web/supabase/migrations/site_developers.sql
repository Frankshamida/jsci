-- ============================================================
-- Meet the Developers
--   The "Welcome to SanctuaryHub" window on the website: the capstone team's
--   cards (photo, name, role) and the window's words. Admins edit them in
--   Dashboard > Developers; the website reads them from /api/developers.
--
--   site_developers           one row per developer, in display order
--   site_developer_settings   one row (id = 1): badge, headline,
--                             description, and whether the window opens by
--                             itself on the homepage
--
--   Photos are on Cloudinary (JSCI-System/developers, 700 x 1000 WebP); a
--   row keeps the URL and the public id, so a replaced or deleted photo is
--   removed there too.
--
--   Read and written only by the server (service role key): RLS is on with
--   no policies, so the public key cannot reach these tables.
--
-- Run it in the Supabase SQL editor. Safe to run more than once: the seed
-- rows go in only while the tables are empty.
-- ============================================================

CREATE TABLE IF NOT EXISTS site_developers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surname          TEXT NOT NULL,
  given_names      TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL DEFAULT '',
  role_icon        TEXT NOT NULL DEFAULT 'code',
  photo_url        TEXT,
  photo_public_id  TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_developers_surname_check CHECK (length(trim(surname)) > 0),
  CONSTRAINT site_developers_icon_check CHECK (role_icon IN ('clipboard', 'pen', 'code'))
);

CREATE INDEX IF NOT EXISTS idx_site_developers_order ON site_developers (sort_order, created_at);

CREATE TABLE IF NOT EXISTS site_developer_settings (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  badge        TEXT NOT NULL DEFAULT 'Capstone Project 2026',
  headline     TEXT NOT NULL DEFAULT 'Welcome to SanctuaryHub',
  description  TEXT NOT NULL DEFAULT '',
  auto_show    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_developer_settings_one_row CHECK (id = 1)
);

-- Server only: RLS on, no policies.
ALTER TABLE site_developers ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_developer_settings ENABLE ROW LEVEL SECURITY;

-- ---- Seed: the capstone team (photos are added in Dashboard > Developers) ----
INSERT INTO site_developers (surname, given_names, role, role_icon, sort_order)
SELECT v.surname, v.given_names, v.role, v.role_icon, v.sort_order
FROM (VALUES
  ('BEROL',   'Niña Mae H.',       'Project Manager',      'clipboard', 0),
  ('DIMOL',   'Chen A.',           'UI / UX Design',       'pen',       1),
  ('GOMEZ',   'Frank Dweezel',     'Full Stack Developer', 'code',      2),
  ('QUIAMCO', 'Ray Ellison A.',    'Full Stack Developer', 'code',      3)
) AS v(surname, given_names, role, role_icon, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM site_developers);

INSERT INTO site_developer_settings (id, badge, headline, description, auto_show)
VALUES (
  1,
  'Capstone Project 2026',
  'Welcome to SanctuaryHub',
  'Designed and developed by students of the College of Computer Studies, University of Cebu, for Joyful Sound Church – International. Meet the team behind the platform.',
  TRUE
)
ON CONFLICT (id) DO NOTHING;
