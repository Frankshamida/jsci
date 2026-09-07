-- ============================================================
-- 'installment' as a registration status of its own
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: a registration on a flexible plan was stored as 'payment_submitted',
-- which is a different thing entirely - that status means "somebody sent a
-- payment and an admin has not checked it yet". A plan has nothing waiting to
-- be checked: every peso on it was recorded by the staff member who took it.
-- Sharing the status made a plan turn up in the admin's verification bell and
-- read as "for verification" wherever the raw status was shown.
--
-- So a plan being paid down now says 'installment', and only becomes
-- 'payment_verified' when the payments add up to the total.
-- ============================================================

-- Move the plans that are already part-paid (or not started) onto the new
-- status. A settled plan is left alone - it is correctly 'payment_verified'.
update public.event_registrations
set status = 'installment'
where payment_plan = 'flexible'
  and status in ('payment_submitted', 'pending_payment')
  and coalesce(amount, 0) > 0
  and coalesce(amount_paid, 0) < coalesce(amount, 0);

-- ...and the reverse case: a plan whose payments do add up but whose status was
-- never caught up, because the total was reached by a route that predates the
-- recompute.
update public.event_registrations
set status = 'payment_verified'
where payment_plan = 'flexible'
  and status in ('payment_submitted', 'pending_payment', 'installment')
  and coalesce(amount, 0) > 0
  and coalesce(amount_paid, 0) >= coalesce(amount, 0);

comment on column public.event_registrations.status is
  'pending_payment | payment_submitted (sent, awaiting an admin check) | installment (on a flexible plan, being paid down) | payment_verified (settled) | registered (free) | cancelled.';
