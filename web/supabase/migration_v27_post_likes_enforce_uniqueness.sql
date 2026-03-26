-- ============================================
-- Migration v27: Re-enforce one reaction per user per post
-- ============================================
-- Use this if duplicates are still appearing after v26.

-- 1) Normalize reaction_type to 'heart' where NULL
UPDATE post_likes SET reaction_type = 'heart' WHERE reaction_type IS NULL;

-- 2) Deduplicate by (post_id, user_id), keep the most recent
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY post_id, user_id
    ORDER BY created_at DESC NULLS LAST, id DESC
  ) AS rn
  FROM post_likes
)
DELETE FROM post_likes
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3) Drop any existing unique constraints on post_likes to reset
ALTER TABLE post_likes DROP CONSTRAINT IF EXISTS post_likes_post_id_user_id_key;
ALTER TABLE post_likes DROP CONSTRAINT IF EXISTS post_likes_post_id_user_id_reaction_type_key;
ALTER TABLE post_likes DROP CONSTRAINT IF EXISTS post_likes_unique_user_post;

-- 4) Add the correct unique constraint (one reaction per user per post)
ALTER TABLE post_likes
  ADD CONSTRAINT post_likes_unique_user_post UNIQUE (post_id, user_id);
