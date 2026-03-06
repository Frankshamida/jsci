-- Migration: Add admin_access_password column to users table
-- This password is used to gate access to the Permissions Control panel

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_access_password TEXT DEFAULT NULL;

-- Add a comment for documentation
COMMENT ON COLUMN users.admin_access_password IS 'SHA-256 hashed password for gating access to Permission Control panel. Set by Admin/Super Admin in My Profile → Security tab.';
