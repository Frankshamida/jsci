-- ============================================================
-- Call Attendee
--
-- Staff phone the people registered for an event - "are you still coming,
-- and do you still need the room?" - from the event's Call Attendee tab. The
-- call itself happens on the phone; what comes back is recorded here, on the
-- registration, so the next person at the desk knows who has already been
-- reached and what they said.
--
--   call_status   null (not called yet) | 'confirmed' | 'no_accommodation'
--                 | 'call_back' | 'no_answer' | 'not_coming'
--
--   no_accommodation = coming to the event, but no longer wants the room.
--
-- Safe to run more than once.
-- ============================================================

alter table public.event_registrations
  add column if not exists call_status        text,
  add column if not exists call_note          text,
  add column if not exists call_attempts      integer not null default 0,
  add column if not exists call_last_at       timestamptz,   -- when the last call was logged
  add column if not exists call_last_by       uuid,          -- the account that logged it
  add column if not exists call_last_by_name  text;          -- and their name, for the list

create index if not exists event_registrations_call_status_idx
  on public.event_registrations (event_id, call_status);

comment on column public.event_registrations.call_status is
  'Call Attendee: null = not called yet | confirmed | no_accommodation | call_back | no_answer | not_coming.';

-- Refresh the API's view of the table so the new columns can be written at once.
notify pgrst, 'reload schema';
