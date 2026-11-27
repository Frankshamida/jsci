-- ============================================================
-- Sermons
--   The slides and notes behind each sermon: a PowerPoint or a PDF a Pastor
--   uploads from Dashboard > Sermons, with its title, the day it was preached,
--   who preached, the Bible passage and a short summary. Signed-in members
--   read and download them there.
--
--   The file itself is on Cloudinary (a "raw" upload in the sermons/ folder,
--   up to 10 MB on the free plan); this table keeps where it is.
--
--   Read and written only by the server (/api/sermons, with the service role
--   key): RLS is on with no policies, so the public key cannot reach it.
--
-- Run it in the Supabase SQL editor. Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS sermons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  preached_on       DATE NOT NULL,
  preacher          TEXT,
  passage           TEXT,
  summary           TEXT,
  file_url          TEXT NOT NULL,
  file_public_id    TEXT NOT NULL,
  file_name         TEXT,
  file_format       TEXT NOT NULL,
  file_bytes        INTEGER,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sermons_format_check CHECK (file_format IN ('pdf', 'ppt', 'pptx')),
  CONSTRAINT sermons_title_check CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sermons_preached ON sermons (preached_on DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sermons_file ON sermons (file_public_id);

-- Server only: RLS on, no policies.
ALTER TABLE sermons ENABLE ROW LEVEL SECURITY;
