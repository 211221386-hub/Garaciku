ALTER TABLE public.rental_records
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.rental_records
DROP CONSTRAINT IF EXISTS rental_records_status_check;

ALTER TABLE public.rental_records
ADD CONSTRAINT rental_records_status_check
CHECK (status IN ('pending', 'active', 'approved', 'rejected', 'returned', 'cancelled', 'completed'));

CREATE INDEX IF NOT EXISTS idx_rental_records_approval_status
ON public.rental_records(status);