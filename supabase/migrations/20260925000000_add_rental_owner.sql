ALTER TABLE public.rental_records
ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS idx_rental_records_user_id
ON public.rental_records(user_id);