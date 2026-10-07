-- ============================================================
-- An attendee exempted - worth their registration fee
-- Run this in the Supabase SQL editor. Safe to re-run (run it again if you
-- ran an earlier copy: it adds exempt_cover).
--
-- Somebody serving at the event - an usher, the worship team, the committee -
-- is registered like anybody else and given a room. Marked from the room
-- board (Accommodation), with a note saying what they serve as.
--
-- The exemption is worth the registration fee (amount less their extras), and
-- pays whatever they still owe, up to that. Nothing already paid is given back
-- (see lib/exemption.js):
--
--   nothing paid yet           the fee is waived; accommodation they still pay
--   fee already paid (online)  their accommodation is free
--   accommodation added later  free too, while the exemption has any left
--
-- amount is what the attendee OWES (see registration_discount.sql), so what
-- is waived comes off it and every total on the event (Cash to Collect, the
-- money tiles, the verifier's report) reads only what is still to take. With
-- nothing left to pay they are settled ('registered', or paid if what they
-- paid covers the rest). An extra the exemption paid for carries `waived` on
-- its snapshot in addons, so cancelling it refunds nothing never paid.
-- Taking the exemption back puts everything waived back on them:
--
--   exempt_note         "Usher", "Worship Team" - shown in the room and at the
--                       verification desk as "Exemption: Usher"
--   exempt_cover        what the exemption is worth: the registration fee
--   exempt_amount       what it has waived so far (never more than the cover)
--   exempt_prev_status  the status they had then
--   exempted_at / _by / _by_name   when and by whom; set = exempted
-- ============================================================

alter table public.event_registrations
  add column if not exists exempt_note text,
  add column if not exists exempt_amount numeric(10, 2) not null default 0,
  add column if not exists exempt_prev_status text,
  add column if not exists exempted_at timestamptz,
  add column if not exists exempted_by uuid references public.users (id) on delete set null,
  add column if not exists exempted_by_name text,
  add column if not exists exempt_cover numeric(10, 2) not null default 0;

-- Exempted under the earlier copy, which always waived the whole fee: what it
-- waived is what it was worth.
update public.event_registrations
   set exempt_cover = exempt_amount
 where exempted_at is not null and exempt_cover = 0 and exempt_amount > 0;

comment on column public.event_registrations.exempt_note is
  'What they serve as (Usher, Worship Team). Set with exempted_at.';
comment on column public.event_registrations.exempt_cover is
  'What the exemption is worth - their registration fee when they were exempted.';
comment on column public.event_registrations.exempt_amount is
  'What the exemption has waived so far - added back onto amount if it is taken back.';
