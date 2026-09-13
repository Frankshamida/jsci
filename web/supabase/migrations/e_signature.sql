-- ============================================================
-- E-Signature
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- One signature per account, held on the account rather than in a table of its
-- own. A person has one signature the way they have one name: there is nothing
-- to list, nothing to page through, and no row that can go missing while the
-- account it belongs to is still there.
--
--   signature_name     the PRINTED name - what is typed under the line. Kept
--                      separate from firstname/lastname on purpose: a
--                      signature block says "Ptr. Juan D. Dela Cruz" or
--                      "Juan Dela Cruz, CPA", and neither is what the account
--                      was registered under. Whoever signs decides how their
--                      name is printed.
--   signature_url      the public URL of the drawn mark, stored as WebP.
--   signature_path     where that file sits in the bucket, so replacing a
--                      signature can delete the one it replaced instead of
--                      leaving every version anybody ever drew behind.
--   signature_updated_at  when it was last set. A signature block on a
--                      document is worth being able to date.
--
-- The image itself lives in the existing public `profile` storage bucket under
-- signatures/, beside the avatars and the payment channel logos - no new
-- bucket to provision, and the same public-read rules already apply.
-- ============================================================

alter table public.users
  add column if not exists signature_url text,
  add column if not exists signature_path text,
  add column if not exists signature_name text,
  add column if not exists signature_updated_at timestamptz;

-- The only question ever asked of these columns is "does this person have a
-- signature", asked one account at a time while a receipt is being drawn. A
-- partial index keeps that to the handful of accounts that have set one rather
-- than the whole user table.
create index if not exists users_signature_idx
  on public.users (id)
  where signature_url is not null;
