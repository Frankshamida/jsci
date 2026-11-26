-- ============================================================
-- Poster templates
--   The SVG templates the news poster editor draws with
--   (/news-management/poster/<article id>). Each follows the template
--   "contract" - known layer ids and data- attributes, see
--   web/src/lib/posterSvgSanitize.js - so every editor control works on it.
--
--   source 'builtin'   the gold card templates that ship with the site
--                      (web/src/lib/posterBuiltins.js). The server adds and
--                      updates them by itself the first time the editor
--                      lists templates; their `defaults` are never touched.
--   source 'imported'  SVG files an Admin imported. The SVG is cleaned
--                      (no scripts, no outside links, no @import) in the
--                      browser and again on the server before it is saved.
--
--   capabilities  which contract parts the SVG has (shown at import)
--   defaults      the style a template starts with ("Set as template
--                 default" in the editor): colours, gradients, photo
--                 filters, logos and their effects
--   thumbnail_url a small JPEG (data: URL) for the template picker
--
-- Saved posters (news_posters) keep the template's key in template_key and
-- every style choice in data.style.
--
-- Only the server (service-role client) reads and writes it: RLS on, no
-- policy. Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS poster_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,              -- e.g. 'jsci-05-split-gold'
  name TEXT NOT NULL,
  svg TEXT NOT NULL,                     -- sanitized SVG
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  source TEXT NOT NULL DEFAULT 'imported' CHECK (source IN ('builtin', 'imported')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poster_templates_active ON poster_templates(is_active, source, created_at);

ALTER TABLE poster_templates ENABLE ROW LEVEL SECURITY;

-- Tell PostgREST about the new table straight away.
NOTIFY pgrst, 'reload schema';
