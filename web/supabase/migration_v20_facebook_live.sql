-- ============================================
-- Migration V20: Facebook Live Streams
-- Adds tables for live stream management,
-- real-time comments, and heart reactions
-- ============================================

-- 1. Live Streams table
CREATE TABLE IF NOT EXISTS live_streams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  iframe_url TEXT NOT NULL,
  caption TEXT DEFAULT 'Sunday Service Live',
  title TEXT DEFAULT 'Sunday Service Live',
  posted_by UUID,
  posted_by_name TEXT,
  is_active BOOLEAN DEFAULT true,
  is_live BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Live Stream Reactions (hearts)
CREATE TABLE IF NOT EXISTS live_stream_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id UUID REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  reaction_type TEXT DEFAULT 'heart',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Live Stream Comments
CREATE TABLE IF NOT EXISTS live_stream_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id UUID REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  user_picture TEXT,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES live_stream_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Live Stream Comment Likes (hearts on comments)
CREATE TABLE IF NOT EXISTS live_stream_comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID REFERENCES live_stream_comments(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

-- Enable RLS
ALTER TABLE live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_stream_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_stream_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_stream_comment_likes ENABLE ROW LEVEL SECURITY;

-- Policies for live_streams
CREATE POLICY "Anyone can view live streams" ON live_streams FOR SELECT USING (true);
CREATE POLICY "Admins can insert live streams" ON live_streams FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update live streams" ON live_streams FOR UPDATE USING (true);
CREATE POLICY "Admins can delete live streams" ON live_streams FOR DELETE USING (true);

-- Policies for live_stream_reactions
CREATE POLICY "Anyone can view reactions" ON live_stream_reactions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can react" ON live_stream_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can remove own reactions" ON live_stream_reactions FOR DELETE USING (true);

-- Policies for live_stream_comments
CREATE POLICY "Anyone can view comments" ON live_stream_comments FOR SELECT USING (true);
CREATE POLICY "Authenticated users can comment" ON live_stream_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own comments" ON live_stream_comments FOR UPDATE USING (true);
CREATE POLICY "Users can delete own comments" ON live_stream_comments FOR DELETE USING (true);

-- Policies for live_stream_comment_likes
CREATE POLICY "Anyone can view comment likes" ON live_stream_comment_likes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can like" ON live_stream_comment_likes FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can unlike" ON live_stream_comment_likes FOR DELETE USING (true);

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE live_streams;
ALTER PUBLICATION supabase_realtime ADD TABLE live_stream_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE live_stream_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE live_stream_comment_likes;

-- Indexes for performance
CREATE INDEX idx_live_stream_reactions_stream ON live_stream_reactions(stream_id);
CREATE INDEX idx_live_stream_comments_stream ON live_stream_comments(stream_id);
CREATE INDEX idx_live_stream_comments_parent ON live_stream_comments(parent_id);
CREATE INDEX idx_live_stream_comment_likes_comment ON live_stream_comment_likes(comment_id);
CREATE INDEX idx_live_streams_active ON live_streams(is_active, is_live);
