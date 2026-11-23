-- ============================================================
-- News
--   Articles written by an Admin or Super Admin (Dashboard > News, and the
--   editor at /news-studio) and read by anyone at /news.
--
--   news_articles   one row per article. The body is a list of blocks
--                   (text, image, gallery, image beside text, quote ...) in
--                   `content`; `content_text` is the same body as plain text,
--                   for search and for the AI tools. Images live in
--                   Cloudinary; their public ids are kept so a deleted or
--                   replaced picture is removed from Cloudinary too.
--
-- Only the server (service-role client) reads and writes it: RLS on, no
-- policy. The public pages read published articles through the server.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,                        -- /news/<slug>
  summary TEXT,
  category TEXT NOT NULL DEFAULT 'Church News',
  tags TEXT[] NOT NULL DEFAULT '{}',
  content JSONB NOT NULL DEFAULT '[]'::jsonb, -- the blocks
  content_text TEXT NOT NULL DEFAULT '',
  featured_image_url TEXT,                   -- the thumbnail and the top picture
  featured_image_public_id TEXT,
  image_public_ids TEXT[] NOT NULL DEFAULT '{}', -- every picture in the body
  source_url TEXT,                           -- where the story came from, if anywhere
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_featured BOOLEAN NOT NULL DEFAULT FALSE, -- the big story at the top of /news
  views INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Added after the first version: the Tagalog and Bisaya (Cebuano) versions
-- of the article, written with the AI in the editor and checked there.
--   { "tl": { "fields": { "title": "...", "b:<block>:html": "..." }, "sourceHash": "...", "at": "...", "reviewed": true }, "ceb": { ... } }
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_articles_slug ON news_articles(slug);
CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_category ON news_articles(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_views ON news_articles(status, views DESC);

ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

-- One more view, counted in the database so two readers at the same moment
-- both count. Returns the new total.
CREATE OR REPLACE FUNCTION news_article_viewed(p_id UUID)
RETURNS INTEGER
LANGUAGE sql
AS $$
  UPDATE news_articles SET views = views + 1
  WHERE id = p_id AND status = 'published'
  RETURNING views;
$$;

-- Tell PostgREST about the new table straight away.
NOTIFY pgrst, 'reload schema';
