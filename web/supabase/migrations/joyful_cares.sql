-- ============================================================
-- Joyful Cares
--   The Pastors' care desk (Dashboard > Joyful Cares). How each ministry
--   member is doing is worked out from what the app already keeps: check-ins
--   (attendance), the lineups, excuses and substitute requests. These two
--   tables keep only what the Pastors add to that:
--
--   care_people  one row per member a Pastor has done something about:
--                  in care or not, which Pastor has them, the follow-up date,
--                  when they were last reached, when their flags were last
--                  cleared ("was there"), and the AI's last suggestion
--   care_notes   the history: notes, "reached out", taken into care,
--                  reassigned, cleared, closed - who and when
--
--   Read and written only by the server (/api/cares, with the service role
--   key): RLS is on with no policies, so the public key cannot reach them.
--   What the Pastors write about people stays between the Pastors.
--
-- Run it in the Supabase SQL editor. Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS care_people (
  member_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_care            BOOLEAN NOT NULL DEFAULT FALSE,
  in_care_since      TIMESTAMPTZ,
  assigned_to        UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_name      TEXT,
  follow_up_on       DATE,
  last_contacted_at  TIMESTAMPTZ,
  -- Absences on or before this moment no longer raise a flag.
  cleared_at         TIMESTAMPTZ,
  -- The AI's last suggestion, and what it was based on (so it is asked again
  -- only when something changed).
  ai_summary         TEXT,
  ai_step            TEXT,
  ai_step_kind       TEXT,
  ai_urgency         TEXT,
  ai_drafts          JSONB,
  ai_hash            TEXT,
  ai_at              TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_care_people_in_care ON care_people (in_care, follow_up_on);

CREATE TABLE IF NOT EXISTS care_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name  TEXT,
  kind         TEXT NOT NULL DEFAULT 'note',
  body         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_notes_kind_check CHECK (kind IN ('note', 'contacted', 'care', 'assigned', 'cleared', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_care_notes_member ON care_notes (member_id, created_at DESC);

-- Server only: RLS on, no policies.
ALTER TABLE care_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_notes ENABLE ROW LEVEL SECURITY;
