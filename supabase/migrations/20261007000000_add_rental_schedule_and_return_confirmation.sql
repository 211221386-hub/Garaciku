ALTER TABLE public.rental_records
ADD COLUMN IF NOT EXISTS start_time time NOT NULL DEFAULT '00:00',
ADD COLUMN IF NOT EXISTS end_time time,
ADD COLUMN IF NOT EXISTS return_confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS return_confirmed_at timestamptz;

ALTER TABLE public.rental_records
DROP CONSTRAINT IF EXISTS rental_records_status_check;

ALTER TABLE public.rental_records
ADD CONSTRAINT rental_records_status_check
CHECK (status IN ('pending', 'active', 'approved', 'overdue', 'rejected', 'returned', 'cancelled', 'completed'));

CREATE INDEX IF NOT EXISTS idx_rental_records_return_confirmation
ON public.rental_records(status, end_date, end_time);