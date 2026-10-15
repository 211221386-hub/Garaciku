DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'users', 'cars', 'daily_notes', 'completeness_items', 'damages',
        'service_records', 'rental_records'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completeness_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users, public.cars, public.daily_notes,
  public.completeness_items, public.damages, public.service_records,
  public.rental_records FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users, public.cars,
  public.daily_notes, public.completeness_items, public.damages,
  public.service_records, public.rental_records TO service_role;

REVOKE ALL ON FUNCTION public.auth_login(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO service_role;

ALTER TABLE public.daily_notes
  DROP CONSTRAINT IF EXISTS daily_notes_start_km_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_notes_end_km_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_notes_km_order,
  DROP CONSTRAINT IF EXISTS daily_notes_start_fuel_range,
  DROP CONSTRAINT IF EXISTS daily_notes_end_fuel_range,
  DROP CONSTRAINT IF EXISTS daily_notes_date_order,
  ADD CONSTRAINT daily_notes_start_km_nonnegative CHECK (start_km IS NULL OR start_km >= 0) NOT VALID,
  ADD CONSTRAINT daily_notes_end_km_nonnegative CHECK (end_km IS NULL OR end_km >= 0) NOT VALID,
  ADD CONSTRAINT daily_notes_km_order CHECK (start_km IS NULL OR end_km IS NULL OR end_km >= start_km) NOT VALID,
  ADD CONSTRAINT daily_notes_start_fuel_range CHECK (start_fuel IS NULL OR start_fuel BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT daily_notes_end_fuel_range CHECK (end_fuel IS NULL OR end_fuel BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT daily_notes_date_order CHECK (end_date >= start_date) NOT VALID;

ALTER TABLE public.rental_records
  DROP CONSTRAINT IF EXISTS rental_records_date_order,
  ADD CONSTRAINT rental_records_date_order CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID;
