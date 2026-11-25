ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS need_trial_outside boolean NOT NULL DEFAULT false;
