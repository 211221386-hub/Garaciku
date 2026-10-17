-- Restore the pre-Worker direct Supabase access model.
-- This intentionally restores broad anon/authenticated access to match the old app.

ALTER TABLE public.cars DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.completeness_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.damages DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_users ON public.users;
DROP POLICY IF EXISTS anon_insert_users ON public.users;
DROP POLICY IF EXISTS anon_update_users ON public.users;
DROP POLICY IF EXISTS anon_delete_users ON public.users;
CREATE POLICY anon_select_users ON public.users
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY anon_insert_users ON public.users
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY anon_update_users ON public.users
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_users ON public.users
  FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS anon_full_access_service_records ON public.service_records;
CREATE POLICY anon_full_access_service_records ON public.service_records
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_rental_records ON public.rental_records;
CREATE POLICY anon_full_access_rental_records ON public.rental_records
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users, public.cars,
  public.daily_notes, public.completeness_items, public.damages,
  public.service_records, public.rental_records TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated;

ALTER TABLE public.daily_notes
  DROP CONSTRAINT IF EXISTS daily_notes_start_km_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_notes_end_km_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_notes_km_order,
  DROP CONSTRAINT IF EXISTS daily_notes_start_fuel_range,
  DROP CONSTRAINT IF EXISTS daily_notes_end_fuel_range,
  DROP CONSTRAINT IF EXISTS daily_notes_date_order;

ALTER TABLE public.rental_records
  DROP CONSTRAINT IF EXISTS rental_records_date_order;
