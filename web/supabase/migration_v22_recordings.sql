-- ============================================
-- Migration V22: Recordings (Google Drive Integration)
-- ============================================

CREATE TABLE IF NOT EXISTS recordings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'Worship',
  recording_date DATE,
  duration_seconds INTEGER,
  file_name TEXT,
  file_size_bytes BIGINT,
  mime_type TEXT,
  google_drive_file_id TEXT,
  google_drive_url TEXT,
  google_drive_thumbnail TEXT,
  uploaded_by UUID,
  uploaded_by_name TEXT,
  tags JSONB DEFAULT '[]',
  linked_event_id UUID,
  linked_schedule_date TEXT,
  is_public BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'Published',
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on recordings" ON recordings FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_recordings_title ON recordings(title);
CREATE INDEX IF NOT EXISTS idx_recordings_category ON recordings(category);
CREATE INDEX IF NOT EXISTS idx_recordings_recording_date ON recordings(recording_date);
CREATE INDEX IF NOT EXISTS idx_recordings_uploaded_by ON recordings(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_google_drive_file_id ON recordings(google_drive_file_id);

CREATE INDEX IF NOT EXISTS idx_recordings_search ON recordings 
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, '')));

ALTER TABLE recordings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE recordings;
