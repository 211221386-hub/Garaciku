ALTER TABLE public.service_records
  ADD COLUMN IF NOT EXISTS created_name text NOT NULL DEFAULT '';
