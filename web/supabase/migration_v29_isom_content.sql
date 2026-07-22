-- ============================================
-- Migration V29: ISOM Content
-- Stores editable ISOM (International School of Ministries)
-- page/section content: about text, bullet points, class start
-- date, and carousel slide images.
-- ============================================

CREATE TABLE IF NOT EXISTS isom_content (
  id SERIAL PRIMARY KEY,
  subtitle TEXT NOT NULL DEFAULT '',
  about_html TEXT NOT NULL DEFAULT '',
  bullets JSONB NOT NULL DEFAULT '[]',
  class_start_date TEXT NOT NULL DEFAULT '',
  slides JSONB NOT NULL DEFAULT '[]',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE isom_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on isom_content" ON isom_content FOR ALL USING (true) WITH CHECK (true);

-- Insert default ISOM content (matches the previous hardcoded homepage values)
INSERT INTO isom_content (subtitle, about_html, bullets, class_start_date, slides) VALUES (
  'Be equipped, empowered, and sent — a Spirit-filled ministry training program raising up the next generation of kingdom leaders.',
  '<h3>About ISOM</h3>
<p>The International School of Ministries (ISOM) is our church''s Spirit-led training program designed to raise up believers into confident, biblically-grounded servants and leaders. Through hands-on teaching, prayer, and mentorship, students grow in their walk with Christ and are equipped to serve effectively in ministry and in their communities.</p>
<p>Whether you are new to ministry or seeking to deepen your calling, ISOM offers a place to learn, grow, and be sent out to make a kingdom impact.</p>',
  '["Solid biblical foundation & sound doctrine", "Spirit-empowered prayer & worship", "Hands-on leadership & ministry training", "A heart to reach the nations for Christ"]',
  'August 2026',
  '[
    {"url": "/assets/isom-training.jpg"},
    {"url": "/assets/christian-leadership-conference.jpg"},
    {"url": "/assets/friday-bible-study.jpg"},
    {"url": "/assets/worship-service.jpg"},
    {"url": "/assets/community-outreach.jpg"}
  ]'
);
