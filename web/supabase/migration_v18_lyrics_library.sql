-- ============================================
-- Migration V18: Lyrics Library for Multimedia Team
-- 
-- Allows Media Ministry (Multimedia role) to:
-- 1. Create, edit, and manage song lyrics
-- 2. AI auto-detects title, artist, language from YouTube
-- 3. Rich-text formatted lyrics with verse sections
-- 4. Link prepared lyrics to Song Leader lineups
-- 5. Searchable library with language filter
-- ============================================

-- 1. LYRICS LIBRARY TABLE
CREATE TABLE IF NOT EXISTS lyrics_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  language TEXT DEFAULT 'English', -- 'English', 'Tagalog', 'Bisaya', 'Mixed'
  youtube_link TEXT,
  lyrics_html TEXT, -- Rich HTML content with formatting (bold, sections, etc.)
  lyrics_plain TEXT, -- Plain text version for search
  sections JSONB DEFAULT '[]', -- Array of { type: 'Verse 1'|'Chorus'|'Bridge'|etc., content: '...' }
  prepared_by UUID REFERENCES users(id),
  prepared_by_name TEXT,
  status TEXT DEFAULT 'Draft', -- 'Draft', 'Published'
  linked_schedule_dates JSONB DEFAULT '[]', -- Array of schedule dates this lyrics is linked to
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE TRIGGER update_lyrics_library_updated_at
  BEFORE UPDATE ON lyrics_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE lyrics_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on lyrics_library" ON lyrics_library FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lyrics_library_title ON lyrics_library(title);
CREATE INDEX IF NOT EXISTS idx_lyrics_library_language ON lyrics_library(language);
CREATE INDEX IF NOT EXISTS idx_lyrics_library_artist ON lyrics_library(artist);
CREATE INDEX IF NOT EXISTS idx_lyrics_library_status ON lyrics_library(status);
CREATE INDEX IF NOT EXISTS idx_lyrics_library_prepared_by ON lyrics_library(prepared_by);

-- Full text search index for lyrics content
CREATE INDEX IF NOT EXISTS idx_lyrics_library_search ON lyrics_library USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(artist, '') || ' ' || coalesce(lyrics_plain, '')));

-- Enable realtime for lyrics_library
ALTER TABLE lyrics_library REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE lyrics_library;
