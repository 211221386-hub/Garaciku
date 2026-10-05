

CREATE TABLE IF NOT EXISTS cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  year int,
  plate_number text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completeness_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_present boolean NOT NULL DEFAULT true,
  reminder_type text NOT NULL DEFAULT 'general',
  next_due_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS damages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'low',
  status text NOT NULL DEFAULT 'open',
  reported_date date NOT NULL DEFAULT CURRENT_DATE,
  resolved_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  service_type text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  cost numeric,
  mileage int,
  workshop text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS idx_daily_notes_car_id ON daily_notes(car_id);
CREATE INDEX IF NOT EXISTS idx_completeness_car_id ON completeness_items(car_id);
CREATE INDEX IF NOT EXISTS idx_damages_car_id ON damages(car_id);
CREATE INDEX IF NOT EXISTS idx_service_records_car_id ON service_records(car_id);


-- RLS (Row Level Security) disabled untuk PostgreSQL lokal
-- RLS hanya diperlukan untuk Supabase (yang punya role 'anon' dan 'authenticated')
-- Jika ingin enable RLS di local, uncomment section dibawah ini

-- ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_notes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE completeness_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE damages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;

-- cars policies (single-tenant: anon + authenticated)
-- DROP POLICY IF EXISTS "anon_select_cars" ON cars;
-- CREATE POLICY "anon_select_cars" ON cars FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_cars" ON cars;
-- CREATE POLICY "anon_insert_cars" ON cars FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_cars" ON cars;
-- CREATE POLICY "anon_update_cars" ON cars FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_cars" ON cars;
-- CREATE POLICY "anon_delete_cars" ON cars FOR DELETE
--   TO anon, authenticated USING (true);

-- daily_notes policies
-- DROP POLICY IF EXISTS "anon_select_daily_notes" ON daily_notes;
-- CREATE POLICY "anon_select_daily_notes" ON daily_notes FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_daily_notes" ON daily_notes;
-- CREATE POLICY "anon_insert_daily_notes" ON daily_notes FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_daily_notes" ON daily_notes;
-- CREATE POLICY "anon_update_daily_notes" ON daily_notes FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_daily_notes" ON daily_notes;
-- CREATE POLICY "anon_delete_daily_notes" ON daily_notes FOR DELETE
--   TO anon, authenticated USING (true);

-- completeness_items policies
-- DROP POLICY IF EXISTS "anon_select_completeness_items" ON completeness_items;
-- CREATE POLICY "anon_select_completeness_items" ON completeness_items FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_completeness_items" ON completeness_items;
-- CREATE POLICY "anon_insert_completeness_items" ON completeness_items FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_completeness_items" ON completeness_items;
-- CREATE POLICY "anon_update_completeness_items" ON completeness_items FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_completeness_items" ON completeness_items;
-- CREATE POLICY "anon_delete_completeness_items" ON completeness_items FOR DELETE
--   TO anon, authenticated USING (true);

-- damages policies
-- DROP POLICY IF EXISTS "anon_select_damages" ON damages;
-- CREATE POLICY "anon_select_damages" ON damages FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_damages" ON damages;
-- CREATE POLICY "anon_insert_damages" ON damages FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_damages" ON damages;
-- CREATE POLICY "anon_update_damages" ON damages FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_damages" ON damages;
-- CREATE POLICY "anon_delete_damages" ON damages FOR DELETE
--   TO anon, authenticated USING (true);

-- service_records policies
-- DROP POLICY IF EXISTS "anon_select_service_records" ON service_records;
-- CREATE POLICY "anon_select_service_records" ON service_records FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_service_records" ON service_records;
-- CREATE POLICY "anon_insert_service_records" ON service_records FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_service_records" ON service_records;
-- CREATE POLICY "anon_update_service_records" ON service_records FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_service_records" ON service_records;
-- CREATE POLICY "anon_delete_service_records" ON service_records FOR DELETE
--   TO anon, authenticated USING (true);
