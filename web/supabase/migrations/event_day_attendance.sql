-- ============================================================
-- Attendance, one row per day
-- Run this AFTER event_claims.sql. Safe to re-run.
--
-- event_registrations.attended is a single boolean, which is the right answer
-- for a one-evening service and the wrong one for a conference. A three-day
-- event has to answer "did they come on Day 2", and a boolean cannot: somebody
-- who came on Day 1 and went home reads identically to somebody who came to
-- all three.
--
-- It matters for more than a report. A meal is served per day, so "has this
-- person already had lunch" is really "has this person already had lunch
-- TODAY", and the counter cannot tell without knowing which days they were
-- here for.
--
-- Same shape as event_claims, for the same reasons: a row per day rather than
-- day1_attended / day2_attended columns, so a four-day event needs no
-- migration and the row carries WHEN they arrived and WHO checked them in.
-- The row EXISTING is the attendance; undoing it deletes the row.
--
-- event_registrations.attended is KEPT and maintained alongside this, meaning
-- "came on at least one day". Reports, exports and the older screens read it,
-- and quietly changing what it means would break them silently.
-- ============================================================

create table if not exists public.event_day_attendance (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  -- Denormalised from the registration, like event_claims.event_id: every
  -- read is "everyone's attendance at this event".
  event_id        uuid not null references public.events(id) on delete cascade,

  -- Numbered from 1, matching event_days.day_number. An event with no
  -- per-day schedule is day 1.
  day_number      integer not null check (day_number >= 1),

  attended_at     timestamptz not null default now(),
  attended_by     uuid references public.users(id) on delete set null,

  -- One arrival per person per day. People tap twice at a door; the second
  -- tap must not overwrite the time they actually arrived, and this is what
  -- makes that a no-op instead of a duplicate row.
  unique (registration_id, day_number)
);

create index if not exists event_day_attendance_event_idx
  on public.event_day_attendance (event_id);
create index if not exists event_day_attendance_reg_idx
  on public.event_day_attendance (registration_id);

comment on table public.event_day_attendance is
  'One row per day an attendee actually turned up. event_registrations.attended is kept in step as "came on at least one day", for the reports and older screens that read it.';
comment on column public.event_day_attendance.day_number is
  'Which day of the event, numbered from 1 to match event_days. An event with no per-day schedule is day 1.';

-- ------------------------------------------------------------
-- Backfill: everyone already marked attended came on day 1.
--
-- Not strictly true - the boolean never said which day - but it is the only
-- honest reading available, and leaving them with no day rows at all would
-- lock every one of them out of the kit and meal counters, which now require
-- an arrival. Existing check-in times are carried over rather than stamped
-- with now(), so the record stays as close to the truth as it can be.
-- ------------------------------------------------------------
insert into public.event_day_attendance (registration_id, event_id, day_number, attended_at, attended_by)
select r.id, r.event_id, 1, coalesce(r.attended_at, now()), null
from public.event_registrations r
where r.attended is true
  and r.deleted_at is null
on conflict (registration_id, day_number) do nothing;
