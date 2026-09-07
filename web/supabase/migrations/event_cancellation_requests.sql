-- ============================================================
-- Event Registration — member-requested cancellation
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
--
-- A member can no longer delete a registration outright. They RAISE A REQUEST;
-- an admin sees it, refunds what was paid, and only then is the registration
-- cancelled and moved to the recycle bin. The money has already changed hands by
-- the time someone wants out, so the row has to survive long enough for a human
-- to settle it.
-- ============================================================

-- Where the request currently stands:
--   requested  the member asked to cancel; nothing has been refunded yet
--   refunded   an admin settled the refund and released the slot
--   declined   an admin refused it; the registration stands
--   (null)     no request has been made
alter table event_registrations add column if not exists cancel_status text;
alter table event_registrations add column if not exists cancel_requested_at timestamptz;
alter table event_registrations add column if not exists cancel_reason text;

-- The refund promise the member is shown, and the audit of who settled it.
-- Two WORKING days from the request: weekends are skipped when this is computed
-- (see resolveRefundDueAt in the cancel route) because the office is closed.
alter table event_registrations add column if not exists refund_due_at timestamptz;
alter table event_registrations add column if not exists cancel_reviewed_at timestamptz;
alter table event_registrations add column if not exists cancel_reviewed_by uuid;
alter table event_registrations add column if not exists cancel_reviewed_by_name text;
alter table event_registrations add column if not exists refund_amount numeric;
alter table event_registrations add column if not exists refund_reference text;
alter table event_registrations add column if not exists refund_note text;

-- Only rows with an open request are ever queried by this, so the index carries
-- just those - it stays tiny however many registrations pile up.
create index if not exists idx_event_registrations_cancel_status
  on event_registrations (cancel_status)
  where cancel_status is not null;

-- The admin queue: every request still waiting on someone, newest first.
create or replace view event_cancellation_queue as
  select
    r.id,
    r.event_id,
    r.user_id,
    r.attendee_name,
    r.status,
    r.amount,
    r.amount_paid,
    r.payment_method,
    r.payment_reference,
    r.cancel_status,
    r.cancel_reason,
    r.cancel_requested_at,
    r.refund_due_at
  from event_registrations r
  where r.cancel_status = 'requested'
    and r.deleted_at is null
  order by r.cancel_requested_at asc;
