-- Add is_unsent column to the messages table for the "unsend" feature
-- Run this in your Supabase SQL editor (Dashboard -> SQL Editor -> New Query)

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_unsent BOOLEAN DEFAULT FALSE;
