-- ============================================================
-- Joy's Knowledge
--   Documents a Super Admin gives Joy, the AI assistant on the public home
--   page (Dashboard > System Configuration > Joy's Knowledge). Each file is
--   read to plain text when it is uploaded and cut into short sections; when
--   a visitor asks Joy something, the sections that match the question are
--   given to the AI with it (src/lib/joyKnowledge.js).
--
--   1. joy_knowledge_docs    one row per document, note or link
--   2. joy_knowledge_chunks  its text, in sections of about 1,100 characters
--
-- Only the server (service-role client) reads and writes these: RLS on, no
-- policy - so a visitor can ask Joy, but cannot download the documents.
-- Safe to run more than once.
-- ============================================================

-- 1. DOCUMENTS ----------------------------------------------
CREATE TABLE IF NOT EXISTS joy_knowledge_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  file_name TEXT,                        -- NULL for a note or a link typed in the dashboard
  file_type TEXT NOT NULL DEFAULT 'note', -- 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'note' | 'link'
  url TEXT,                              -- for a link: where it goes
  file_size INTEGER,                     -- bytes, as uploaded
  char_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- off: kept, but Joy does not read it
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Links came after the first version of this file: add the column to a table
-- that was created without it.
ALTER TABLE joy_knowledge_docs ADD COLUMN IF NOT EXISTS url TEXT;

CREATE INDEX IF NOT EXISTS idx_joy_knowledge_docs_active ON joy_knowledge_docs(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_joy_knowledge_docs_file ON joy_knowledge_docs(file_name);

ALTER TABLE joy_knowledge_docs ENABLE ROW LEVEL SECURITY;

-- 2. SECTIONS -----------------------------------------------
CREATE TABLE IF NOT EXISTS joy_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES joy_knowledge_docs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,                  -- order within the document
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_joy_knowledge_chunks_doc_idx ON joy_knowledge_chunks(doc_id, idx);

ALTER TABLE joy_knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Tell PostgREST about the new tables straight away.
NOTIFY pgrst, 'reload schema';
