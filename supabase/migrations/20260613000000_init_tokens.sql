-- Supabase Migration: Besta Bot Token System
-- This migration is automatically applied when linked via GitHub Integration.

CREATE TABLE public.tokens (
    id SERIAL PRIMARY KEY,
    token_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'unclaimed',
    duration_days INTEGER NOT NULL,
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    hwid TEXT,
    is_trial BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

-- Allow the bot (via anon key) to READ tokens for validation
CREATE POLICY "Allow public read access"
ON public.tokens FOR SELECT
TO public
USING (true);

-- Allow the bot to UPDATE tokens (activate unclaimed tokens, bind HWID, mark expired)
CREATE POLICY "Allow public update access"
ON public.tokens FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- Allow the bot to INSERT trial tokens automatically
CREATE POLICY "Allow public insert for trials"
ON public.tokens FOR INSERT
TO public
WITH CHECK (is_trial = true);
