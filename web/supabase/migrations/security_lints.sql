-- ============================================================
-- Supabase security advisor fixes
-- Safe to re-run. Deploy the app change first (the password reset routes now
-- use the service-role client), then run this.
--
-- 1. password_resets - "Policy Exists RLS Disabled" / "RLS Disabled in Public"
--    The table holds live password-reset codes. RLS was off, and the one
--    policy on it allowed everything - so anyone with the public anon key
--    (it ships in every browser) could read every pending code. RLS goes on
--    and the allow-all policy goes away. With no policy left, the anon and
--    authenticated roles can do nothing with the table; the server's
--    service-role client (which bypasses RLS) is the only way in, which is
--    how /api/auth/send-otp, /verify-otp and /reset-password now reach it.
--
-- 2. schedule_substitute_view, event_cancellation_queue - "Security Definer View"
--    A view runs with its creator's rights by default, so it skips the RLS of
--    the tables under it for whoever queries it. security_invoker makes it
--    run with the querying user's rights instead. The app itself never reads
--    either view (the server reads the tables), so they are also taken away
--    from the anon and authenticated roles - nothing is lost by that.
-- ============================================================

-- ---- 1. password_resets ----
alter table public.password_resets enable row level security;
drop policy if exists "Allow all operations on password_resets" on public.password_resets;
revoke all on table public.password_resets from anon, authenticated;

-- Codes are ten-minute codes; anything older is only a liability.
delete from public.password_resets where expires_at < now() - interval '1 day';

-- ---- 2. views run as the person asking, and not exposed to the public API ----
alter view public.schedule_substitute_view set (security_invoker = on);
alter view public.event_cancellation_queue set (security_invoker = on);
revoke all on table public.schedule_substitute_view from anon, authenticated;
revoke all on table public.event_cancellation_queue from anon, authenticated;
