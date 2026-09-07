-- ============================================================
-- A contact number on an event
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: a registration is not the end of the conversation. Somebody's name is
-- spelled wrong, they need to change which extras they took, they can no longer
-- come - and the confirmation screen was a dead end, with nobody to tell.
--
-- The number belongs to the EVENT rather than to the church as a whole, because
-- a conference in Cebu and one in Leyte are usually run by different people.
-- `contact_name` is who picks up, so a registrant knows who they are calling.
-- ============================================================

alter table public.events
  add column if not exists contact_number text,
  add column if not exists contact_name text;

comment on column public.events.contact_number is
  'Number registrants can call or text about their registration. Rendered as a tel: link on the confirmation screen.';
comment on column public.events.contact_name is
  'Who answers that number - the person or desk responsible for this event.';
