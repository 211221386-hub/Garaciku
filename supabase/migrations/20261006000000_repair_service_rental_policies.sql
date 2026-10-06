GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.service_records TO anon, authenticated;

ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_service_records" ON public.service_records;
CREATE POLICY "anon_full_access_service_records"
  ON public.service_records FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.rental_records TO anon, authenticated;

ALTER TABLE public.rental_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_rental_records" ON public.rental_records;
CREATE POLICY "anon_full_access_rental_records"
  ON public.rental_records FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);