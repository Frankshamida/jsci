-- ============================================================
-- News posters
--   Facebook posters (1126 x 1408) made from a news article in the poster
--   editor at /news-management/poster/<article id>. An article can have
--   several saved versions.
--
--   news_posters   one row per saved version. `data` holds everything the
--                  editor needs to draw it again:
--                  { headline, highlights: [...], subtext, showSubtext,
--                    credit, showCredit, website, facebook, imageUrl,
--                    imagePublicId, crop: { zoom, x, y }, templateLocked }
--                  `preview_url` is a small JPEG thumbnail (a data: URL)
--                  for the list of versions.
--
-- The church's default website and Facebook page for the poster footer are
-- kept in the existing system_settings table (key 'news_poster_defaults'),
-- so there is no separate settings table.
--
-- Only the server (service-role client) reads and writes it: RLS on, no
-- policy, like news_articles. Run news_articles.sql first.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS news_posters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Poster',
  template_key TEXT NOT NULL,            -- 'landscape', 'landscape_sub', 'portrait', 'portrait_sub'
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_posters_article ON news_posters(article_id, updated_at DESC);
-- Finding whether a picture is still on a poster before it is deleted.
CREATE INDEX IF NOT EXISTS idx_news_posters_image ON news_posters((data->>'imagePublicId'));

ALTER TABLE news_posters ENABLE ROW LEVEL SECURITY;

-- Tell PostgREST about the new table straight away.
NOTIFY pgrst, 'reload schema';
