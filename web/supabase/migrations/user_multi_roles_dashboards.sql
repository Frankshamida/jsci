-- ============================================================
-- Multiple roles per account, and a chosen start dashboard
-- Run this in the Supabase SQL editor. Safe to re-run.
-- Run it BEFORE deploying the app change: it only adds columns, so the
-- current app keeps working, and the new app reads these columns.
--
-- additional_roles   Roles held on top of users.role, added by a Super Admin
--                    from User Management > Manage > Add Role. users.role
--                    stays the main role; e.g. a Ministry Member who is also
--                    a Pastor has role = 'Ministry Member' and
--                    additional_roles = {Pastor}. Guest is never added.
-- default_dashboard  Where the account opens after signing in: 'main' (its
--                    own dashboard) or 'event-committee'. NULL = not chosen
--                    yet; the app asks once. The ministry keys the check also
--                    allows are from an earlier version of the switcher; the
--                    app no longer saves them and reads them as "not chosen".
-- ============================================================

alter table users add column if not exists additional_roles text[] not null default '{}';

alter table users drop constraint if exists users_additional_roles_check;
alter table users add constraint users_additional_roles_check
  check (additional_roles <@ array['Church Member', 'Ministry Member', 'Pastor', 'Admin', 'Super Admin']);

alter table users add column if not exists default_dashboard text;

alter table users drop constraint if exists users_default_dashboard_check;
alter table users add constraint users_default_dashboard_check
  check (default_dashboard is null
         or default_dashboard in ('main', 'singer', 'musician', 'dancer', 'media', 'usher', 'event-committee'));
