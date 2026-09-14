-- A signed-in member registering a group.
--
-- A bulk submission writes one row per attendee, and those rows belong to the
-- people on the roster - not to the account that filled the form in. `user_id`
-- therefore stays null on everyone except the representative's own slot, which
-- is genuinely theirs (their QR, their cancellation, their "already
-- registered" check).
--
-- That left nothing tying the OTHER rows back to the member who booked and
-- paid for them, so "My Registrations" could not show the group they hold.
-- This column is that tie: the account that made the booking, stamped on every
-- row of it. Null for a guest booking made without an account.
alter table public.event_registrations
  add column if not exists registered_by_user_id uuid;

create index if not exists event_registrations_registered_by_idx
  on public.event_registrations (registered_by_user_id);

comment on column public.event_registrations.registered_by_user_id is
  'The signed-in account that submitted this registration. Set on every row of a bulk booking so the representative can see the whole group in My Registrations. Null for guest registrations and for staff-entered walk-ins.';
-- A signed-in member registering a group.
--
-- A bulk submission writes one row per attendee, and those rows belong to the
-- people on the roster - not to the account that filled the form in. `user_id`
-- therefore stays null on everyone except the representative's own slot, which
-- is genuinely theirs (their QR, their cancellation, their "already
-- registered" check).
--
-- That left nothing tying the OTHER rows back to the member who booked and
-- paid for them, so "My Registrations" could not show the group they hold.
-- This column is that tie: the account that made the booking, stamped on every
-- row of it. Null for a guest booking made without an account.
alter table public.event_registrations
  add column if not exists registered_by_user_id uuid;

create index if not exists event_registrations_registered_by_idx
  on public.event_registrations (registered_by_user_id);

comment on column public.event_registrations.registered_by_user_id is
  'The signed-in account that submitted this registration. Set on every row of a bulk booking so the representative can see the whole group in My Registrations. Null for guest registrations and for staff-entered walk-ins.';
