-- ============================================
-- Migration v26: Enforce one reaction per user per post
-- ============================================
-- Goal: stop duplicate reactions by the same user on the same post.
-- Steps: normalize reaction_type, dedupe existing rows, and add a unique constraint.

-- 1) Backfill NULL reaction types to default 'heart' (safety)
UPDATE post_likes SET reaction_type = 'heart' WHERE reaction_type IS NULL;

-- 2) Remove duplicate rows per (post_id, user_id), keeping the most recent
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY post_id, user_id
    ORDER BY created_at DESC NULLS LAST, id DESC
  ) AS rn
  FROM post_likes
)
DELETE FROM post_likes
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3) Drop any old unique constraints so we can set the correct one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_likes_post_id_user_id_key'
  ) THEN
    ALTER TABLE post_likes DROP CONSTRAINT post_likes_post_id_user_id_key;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_likes_post_id_user_id_reaction_type_key'
  ) THEN
    ALTER TABLE post_likes DROP CONSTRAINT post_likes_post_id_user_id_reaction_type_key;
  END IF;
END$$;

-- 4) Enforce one reaction per user per post
ALTER TABLE post_likes
  ADD CONSTRAINT post_likes_unique_user_post UNIQUE (post_id, user_id);
