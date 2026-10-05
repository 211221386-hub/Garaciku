ALTER TABLE public.service_records
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS next_service_date date,
  ADD COLUMN IF NOT EXISTS next_service_mileage int,
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_interval_months int,
  ADD COLUMN IF NOT EXISTS reminder_interval_mileage int;

ALTER TABLE public.service_records
  DROP CONSTRAINT IF EXISTS service_records_status_check;

ALTER TABLE public.service_records
  ADD CONSTRAINT service_records_status_check
  CHECK (status IN ('completed', 'scheduled'));

CREATE INDEX IF NOT EXISTS idx_service_records_next_service_date
  ON public.service_records(next_service_date)
  WHERE reminder_enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.service_records TO anon, authenticated;

ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_service_records" ON public.service_records;
CREATE POLICY "anon_full_access_service_records"
  ON public.service_records FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
