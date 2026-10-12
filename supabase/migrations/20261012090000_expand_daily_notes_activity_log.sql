ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS start_km numeric,
  ADD COLUMN IF NOT EXISTS end_km numeric,
  ADD COLUMN IF NOT EXISTS start_fuel numeric,
  ADD COLUMN IF NOT EXISTS end_fuel numeric;

UPDATE public.daily_notes
SET start_date = note_date,
    end_date = note_date
WHERE start_date IS NULL OR end_date IS NULL;

ALTER TABLE public.daily_notes
  ALTER COLUMN start_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN end_date SET NOT NULL;