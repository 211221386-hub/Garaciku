ALTER TABLE public.rental_records
ADD COLUMN IF NOT EXISTS renter_phone text NOT NULL DEFAULT '';