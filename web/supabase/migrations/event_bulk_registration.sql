-- Bulk registration: one organiser registers several people on a single payment.
-- Each attendee still gets their own row (own QR code, own check-in); these two
-- columns are what tie those rows back together as one booking.
alter table public.event_registrations
  add column if not exists group_ref text,
  add column if not exists group_size integer,
  add column if not exists representative text,
  -- 'individual' | 'bulk' | 'admin' - how the registration was made
  add column if not exists registration_type text,
  -- the name behind it: the attendee, the group's representative, or the staff member
  add column if not exists added_by text,
  -- in what capacity: 'Attendee' | 'Representative' | 'Admin' | 'Super Admin'
  add column if not exists added_by_role text;

create index if not exists event_registrations_group_ref_idx
  on public.event_registrations (group_ref);

comment on column public.event_registrations.group_ref is
  'Shared id for every attendee registered together in one bulk submission. Null for individual registrations.';
comment on column public.event_registrations.group_size is
  'How many people were registered in that bulk submission.';
comment on column public.event_registrations.representative is
  'Name of the person who filled in the bulk form and is responsible for the group.';
comment on column public.event_registrations.registration_type is
  'How the registration was made: individual (the attendee), bulk (a representative), or admin (staff walk-in entry).';
comment on column public.event_registrations.added_by is
  'Who made it: the attendee for individual, the representative for bulk, the staff member for admin entries.';
comment on column public.event_registrations.added_by_role is
  'The capacity the entry was made in: Attendee, Representative, Admin or Super Admin.';
