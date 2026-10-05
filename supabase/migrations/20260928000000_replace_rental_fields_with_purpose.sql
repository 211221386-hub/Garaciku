ALTER TABLE public.rental_records
ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '';

ALTER TABLE public.rental_records
DROP COLUMN IF EXISTS daily_rate,
DROP COLUMN IF EXISTS pickup_location;