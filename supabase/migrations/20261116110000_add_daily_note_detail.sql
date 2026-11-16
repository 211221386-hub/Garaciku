ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT '';
