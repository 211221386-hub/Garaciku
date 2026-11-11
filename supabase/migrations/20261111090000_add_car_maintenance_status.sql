ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'ready';

ALTER TABLE public.cars
  DROP CONSTRAINT IF EXISTS cars_operational_status_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_operational_status_check
  CHECK (operational_status IN ('ready', 'under_maintenance'));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cars TO anon, authenticated;

ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_cars" ON public.cars;
CREATE POLICY "anon_full_access_cars"
  ON public.cars FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
