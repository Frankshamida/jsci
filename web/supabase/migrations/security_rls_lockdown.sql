-- ============================================================================
-- SECURITY: lock the database to the server.
--
-- Until now most tables carried a policy like
--     CREATE POLICY "Allow all" ON users FOR ALL USING (true)
-- and the public (anon) key ships in every visitor's browser. Anyone could use
-- it to read every account (emails, password hashes), every registration and
-- payment, every private message - and to change or delete any of it.
--
-- After this file:
--   * every table in `public` has row level security ON
--   * every existing policy in `public` is dropped - whatever its name, so
--     tables added outside these migration files are covered too
--   * the anon and authenticated roles lose all table, sequence and function
--     rights in `public`; the service_role (the website's server, which
--     bypasses RLS) keeps all of them
--   * the public key may read exactly two things, both already public on the
--     website: published events, and published news articles
--   * tables made later get no rights for anon/authenticated by default
--
-- All reads and writes go through the website's API routes, which use the
-- service role key (src/lib/supabase.js: on the server, `supabase` is the
-- service-role client).
--
-- BEFORE RUNNING:
--   1. Deploy the website code that goes with this (the Google sign-in and the
--      attendance list now go through the server).
--   2. Make sure SUPABASE_SERVICE_ROLE_KEY is set in Vercel (Settings >
--      Environment Variables). Without it the server falls back to the public
--      key and every page that reads the database stops working.
-- Run in the Supabase SQL editor. Safe to run more than once. The last query
-- lists anything still open; an empty result means the lock is complete.
-- ============================================================================

BEGIN;

-- ---- 1. Every policy in public, gone; RLS on for every table ----
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'Could not drop policy % on %.% (not the owner)', r.policyname, r.schemaname, r.tablename;
    END;
  END LOOP;

  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'Could not enable RLS on %.% (not the owner)', r.schemaname, r.tablename;
    END;
  END LOOP;
END $$;

-- ---- 2. No rights for the public key; all of them for the server ----
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;      -- tables and views
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Tables, sequences and functions made from now on (by this role): no rights
-- for anon/authenticated unless a migration grants them on purpose.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ---- 3. What the public may read: only what the website already shows everyone ----
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Published events (the home page's events, an event's own page).
GRANT SELECT ON public.events TO anon, authenticated;
CREATE POLICY "Public reads published events" ON public.events
  FOR SELECT TO anon, authenticated
  USING (is_active IS TRUE AND is_published IS TRUE);

-- Published news (/news).
GRANT SELECT ON public.news_articles TO anon, authenticated;
CREATE POLICY "Public reads published news" ON public.news_articles
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

COMMIT;

-- ---- 4. Check: anything still open? (Empty result = locked.) ----
SELECT 'RLS off' AS problem, schemaname || '.' || tablename AS object, NULL AS detail
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity IS NOT TRUE
UNION ALL
SELECT 'policy other than the two public reads', schemaname || '.' || tablename, policyname
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (schemaname, tablename, policyname) NOT IN (
      ('public', 'events', 'Public reads published events'),
      ('public', 'news_articles', 'Public reads published news'))
UNION ALL
SELECT 'public key can ' || lower(privilege_type), table_schema || '.' || table_name, grantee
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    AND NOT (table_name IN ('events', 'news_articles') AND privilege_type = 'SELECT')
ORDER BY 1, 2;
