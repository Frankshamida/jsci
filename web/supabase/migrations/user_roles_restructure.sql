-- ============================================================
-- User roles restructure
-- Run this in the Supabase SQL editor. Safe to re-run.
-- Deploy the app change FIRST, then run this straight after: the new code
-- still understands the old roles, but the old code does not understand the
-- new ones.
--
-- Roles go from
--   Guest, Member, Song Leader, Leader, Pastor, Admin, Super Admin
-- to
--   Guest, Church Member, Ministry Member, Pastor, Admin, Super Admin
--
--   Member with a ministry     -> Ministry Member
--   Member without a ministry  -> Church Member
--   Song Leader                -> Ministry Member. 'Song Leaders' is added to
--                                 their sub_role when missing: that position is
--                                 what now opens the lineup, so they keep it.
--   Leader                     -> Ministry Member. Scheduling ministry meetings
--                                 now comes with a lead position (Song Leader,
--                                 Music Director, Head Dancer, Media Head, Head
--                                 Usher). The query at the bottom lists former
--                                 Leaders who hold none, so they can be given one.
--
-- No columns are added. A Ministry Member's ministry role and positions, and
-- a Pastor's titles, are kept in the existing ministry / sub_role columns.
-- ============================================================

begin;

-- ---- 1. Snapshot of every account's role details, before anything changes ----
-- Re-running keeps the first snapshot. RLS on with no policy: only the
-- service-role client can read it, as with password_resets.
create table if not exists users_role_backup (
  user_id uuid primary key,
  role text,
  ministry text,
  sub_role text,
  allowed_event_types jsonb,
  backed_up_at timestamptz default now()
);
alter table users_role_backup enable row level security;

insert into users_role_backup (user_id, role, ministry, sub_role, allowed_event_types)
select id, role, ministry, sub_role, allowed_event_types from users
on conflict (user_id) do nothing;

-- ---- 2. Accounts ----
-- The old check only allows the old names, so it goes first.
alter table users drop constraint if exists users_role_check;

update users
set sub_role = case when coalesce(trim(sub_role), '') = '' then 'Song Leaders' else sub_role || ', Song Leaders' end,
    ministry = coalesce(nullif(trim(ministry), ''), 'Praise And Worship')
where role = 'Song Leader'
  and coalesce(sub_role, '') not ilike '%Song Leaders%';

update users set role = 'Ministry Member' where role in ('Song Leader', 'Leader');
update users set role = 'Ministry Member' where role = 'Member' and nullif(trim(ministry), '') is not null;
update users set role = 'Church Member'   where role = 'Member';

alter table users add constraint users_role_check
  check (role in ('Guest', 'Church Member', 'Ministry Member', 'Pastor', 'Admin', 'Super Admin'));

-- ---- 3. Roles & Permissions list ----
insert into roles (name, description, permissions) values
  ('Church Member', 'Belongs to the church but does not serve in a ministry',
   '["view_dashboard","view_profile","update_profile","change_password","view_schedule","view_events","view_announcements","view_community","create_posts","like_comment_posts","view_messages","send_messages","rsvp_events","rsvp_meetings","view_meetings","view_reports","logout"]'),
  ('Ministry Member', 'Serves in a ministry (Praise & Worship, Media, Ushers). Lead positions add meetings; Song Leaders add the lineup',
   '["view_dashboard","view_profile","update_profile","change_password","view_schedule","view_events","view_announcements","view_community","create_posts","like_comment_posts","view_messages","send_messages","rsvp_events","rsvp_meetings","view_meetings","view_reports","logout"]')
on conflict (name) do nothing;

delete from roles where name in ('Member', 'Song Leader', 'Leader');

-- ---- 4. Permissions Control toggles ----
-- No row means "on". The old roles' rows are left in place (unused) so the
-- change can be undone.

-- Church Member takes Member's toggles as they are.
insert into role_permissions_control (role, feature_key, enabled, updated_by)
select 'Church Member', feature_key, enabled, updated_by
from role_permissions_control
where role = 'Member'
on conflict (role, feature_key) do nothing;

-- Ministry Member merges Member, Song Leader and Leader. A feature is turned
-- off only where all three had it off, so nobody loses a screen they used.
-- (The lineup itself stays limited to Song Leaders by the app, not by toggles.)
insert into role_permissions_control (role, feature_key, enabled)
select 'Ministry Member', feature_key, false
from role_permissions_control
where role in ('Member', 'Song Leader', 'Leader') and enabled = false
group by feature_key
having count(distinct role) = 3
on conflict (role, feature_key) do nothing;

-- ---- 5. Events limited to certain roles ----
-- "Member" covered both kinds of member, so it becomes both.
update events e
set allowed_roles = (
  select array_agg(r order by array_position(
    array['Guest', 'Church Member', 'Ministry Member', 'Pastor', 'Admin', 'Super Admin'], r))
  from (
    select distinct unnest(case old.role
      when 'Member'      then array['Church Member', 'Ministry Member']
      when 'Song Leader' then array['Ministry Member']
      when 'Leader'      then array['Ministry Member']
      else array[old.role]
    end) as r
    from unnest(e.allowed_roles) as old(role)
  ) mapped
)
where e.allowed_roles && array['Member', 'Song Leader', 'Leader'];

commit;

-- ---- Review: former Leaders without a lead position ----
-- They can no longer schedule ministry meetings. Give each one a position in
-- User Management > Manage > Edit User (e.g. Head Usher, Media Head).
select u.member_id, u.firstname, u.lastname, u.ministry, u.sub_role
from users u
join users_role_backup b on b.user_id = u.id
where b.role = 'Leader'
  and u.role = 'Ministry Member'
  and not exists (
    select 1 from unnest(string_to_array(coalesce(u.sub_role, ''), ',')) as t(token)
    where trim(t.token) in ('Song Leaders', 'Music Director', 'Head Dancer', 'Media Head', 'Head Usher')
  );

-- ---- To undo ----
-- Puts every account back to its snapshot (later edits to ministry / sub_role
-- / event permissions are lost too). Accounts created after this migration
-- have a new role name; give them an old one first or the check will fail.
--
-- begin;
-- alter table users drop constraint if exists users_role_check;
-- update users u
--   set role = b.role, ministry = b.ministry, sub_role = b.sub_role, allowed_event_types = b.allowed_event_types
--   from users_role_backup b where b.user_id = u.id;
-- alter table users add constraint users_role_check
--   check (role in ('Guest', 'Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'));
-- commit;
