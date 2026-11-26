-- ==========================================================================
-- GIVING - online tithes, offerings and donations.
--
--   giving_campaigns  the donation drives an Admin creates ("Typhoon Relief",
--                     "Building Fund"): each on /donation/<slug> with its
--                     photos and its jar, and, when featured, beside the News
--                     articles, in the Community Hub and on the home page.
--                     (Tithes and offerings are given on /sunday-service.)
--   giving_gifts      each gift somebody sends: how much, what for, where
--                     they sent it, the reference number from their GCash,
--                     Maya or bank, and where it stands - pending until the
--                     treasurer finds it, then successful (the giver is
--                     emailed), failed or refunded.
--
-- The money itself never passes through the website: people send it to one of
-- the church's accounts in Mode of Payment (payment_methods) and tell us here.
--
-- Both tables are read and written only by the server (the service role key).
-- RLS is on with no policies, so the public key cannot list who gave what.
--
-- Run it in the Supabase SQL editor. Safe to run more than once.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS giving_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  story           TEXT,
  image_url       TEXT,
  goal_amount     NUMERIC(12, 2),
  ends_on         DATE,
  is_published    BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT giving_campaigns_goal_check CHECK (goal_amount IS NULL OR goal_amount > 0)
);

-- A donation drive's photos (up to 8), the first being its cover. Added after
-- the first version of this file; the cover is carried over.
ALTER TABLE giving_campaigns ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';
UPDATE giving_campaigns SET images = ARRAY[image_url]
  WHERE image_url IS NOT NULL AND cardinality(images) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_campaigns_slug ON giving_campaigns (slug);
CREATE INDEX IF NOT EXISTS idx_giving_campaigns_listed ON giving_campaigns (is_published, is_featured, created_at DESC);

CREATE TABLE IF NOT EXISTS giving_gifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the giver and the treasurer quote to each other: G-261126-7KQ4.
  receipt_no        TEXT NOT NULL,
  -- The secret in the giver's receipt and thank-you links. Never listed.
  token             TEXT NOT NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  donor_name        TEXT,
  donor_email       TEXT,
  is_anonymous      BOOLEAN NOT NULL DEFAULT FALSE,
  amount            NUMERIC(12, 2) NOT NULL,
  fund              TEXT NOT NULL DEFAULT 'Offering',
  campaign_id       UUID REFERENCES giving_campaigns(id) ON DELETE SET NULL,
  -- Kept with the gift, so a receipt still reads right after the campaign is
  -- renamed or deleted.
  campaign_title    TEXT,
  method_id         UUID,
  method_name       TEXT NOT NULL,
  method_category   TEXT,
  card_last4        TEXT,
  reference_no      TEXT,
  proof_url         TEXT,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  status_note       TEXT,
  source            TEXT NOT NULL DEFAULT 'online',
  given_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      UUID,
  confirmed_by_name TEXT,
  refunded_at       TIMESTAMPTZ,
  email_sent_at     TIMESTAMPTZ,
  recorded_by       UUID,
  recorded_by_name  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT giving_gifts_amount_check CHECK (amount > 0),
  CONSTRAINT giving_gifts_fund_check CHECK (fund IN ('Tithes', 'Offering', 'Donation')),
  CONSTRAINT giving_gifts_status_check CHECK (status IN ('pending', 'successful', 'failed', 'refunded')),
  CONSTRAINT giving_gifts_source_check CHECK (source IN ('online', 'admin')),
  CONSTRAINT giving_gifts_last4_check CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_gifts_receipt ON giving_gifts (receipt_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_gifts_token ON giving_gifts (token);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_user ON giving_gifts (user_id, given_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_status ON giving_gifts (status, given_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_campaign ON giving_gifts (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_email ON giving_gifts (LOWER(donor_email));

-- Server only: RLS on, no policies.
ALTER TABLE giving_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE giving_gifts ENABLE ROW LEVEL SECURITY;
