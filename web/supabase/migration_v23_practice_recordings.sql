-- ============================================
-- Migration V23: Practice Recordings
-- Linked to schedule lineups for P&W practice
-- ============================================

CREATE TABLE IF NOT EXISTS practice_recordings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  schedule_date DATE NOT NULL,
  song_type TEXT NOT NULL CHECK (song_type IN ('Slow Song', 'Fast Song')),
  title TEXT NOT NULL,
  description TEXT,
  google_drive_file_id TEXT,
  google_drive_url TEXT,
  file_name TEXT,
  file_size_bytes BIGINT,
  mime_type TEXT DEFAULT 'audio/webm',
  duration_seconds INTEGER,
  recorded_by UUID,
  recorded_by_name TEXT NOT NULL,
  allowed_recorders JSONB DEFAULT '[]',
  status TEXT DEFAULT 'Published',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_practice_recordings_updated_at
  BEFORE UPDATE ON practice_recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE practice_recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on practice_recordings" ON practice_recordings FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_practice_recordings_schedule_id ON practice_recordings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_practice_recordings_schedule_date ON practice_recordings(schedule_date);
CREATE INDEX IF NOT EXISTS idx_practice_recordings_song_type ON practice_recordings(song_type);
CREATE INDEX IF NOT EXISTS idx_practice_recordings_recorded_by ON practice_recordings(recorded_by);

ALTER TABLE practice_recordings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE practice_recordings;
