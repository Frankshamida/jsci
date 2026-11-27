-- ============================================================
-- Our Pastors, from their accounts
--   The website's "Our Pastors" (the home page, and the Home of the
--   dashboard) lists the Pastor accounts marked to be shown there, in order,
--   with their photo (profile_picture) and title (sub_role: Senior Pastor,
--   Associate Pastor, ...). An account that is not marked - a test account,
--   a pastor's second login - is not shown. Read by /api/pastors.
--
--   users.name_prefix    how the website names them: 'Dr.', 'Ptr.' (none:
--                        'Ptr.')
--   users.website_order  1, 2, 3 ... their place under Our Pastors; empty =
--                        not shown
--
--   Then the five pastors' accounts (made on 2026-11-27) are marked, in the
--   order the website has always shown them. To add a pastor later: give the
--   account the Pastor role and a title, then set these two on it.
--
-- Run it in the Supabase SQL editor. Safe to run more than once.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS name_prefix TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_website_order ON users (website_order) WHERE website_order IS NOT NULL;

UPDATE users SET name_prefix = 'Dr.',  website_order = 1 WHERE lower(email) = 'pstr@weldonpior.com';
UPDATE users SET name_prefix = 'Dr.',  website_order = 2 WHERE lower(email) = 'pstr@dorothypior.com';
UPDATE users SET name_prefix = 'Ptr.', website_order = 3 WHERE lower(email) = 'pstr@gracelyngambe.com';
UPDATE users SET name_prefix = 'Ptr.', website_order = 4 WHERE lower(email) = 'pstr@eldangambe.com';
UPDATE users SET name_prefix = 'Ptr.', website_order = 5 WHERE lower(email) = 'pstr@psalmgambe.com';

-- Check: the five, in order.
SELECT website_order, name_prefix, firstname, lastname, sub_role, profile_picture
  FROM users WHERE website_order IS NOT NULL ORDER BY website_order;
