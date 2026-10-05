/*
# Create rental_records table (single-tenant, no auth)

## Overview
Replaces the service_records feature with a rental car tracking system.
Users can record rental transactions for each car — renter name, rental period,
daily rate, total cost, and rental status.

## New Tables
1. `rental_records` — rental transactions tied to a car.
   - id (uuid PK)
   - car_id (uuid FK -> cars.id ON DELETE CASCADE)
   - renter_name (text) — name of the person renting the car
   - start_date (date) — when the rental begins
   - end_date (date, nullable) — when the rental ends (null = ongoing)
   - daily_rate (numeric, nullable) — price per day
   - total_cost (numeric, nullable) — total rental cost
   - pickup_location (text) — where the car is picked up
   - status (text) — 'active' | 'returned' | 'cancelled'
   - notes (text, nullable) — additional notes
   - created_at (timestamptz)

## Security
- RLS enabled on rental_records.
- Allow anon + authenticated full CRUD (single-tenant, intentionally shared).
- USING (true) / WITH CHECK (true) documented as intentional for no-auth app.

## Notes
1. Foreign key cascades on delete so removing a car cleans up its rentals.
2. Index on car_id speeds up per-car rental queries.
*/

CREATE TABLE IF NOT EXISTS rental_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  renter_name text NOT NULL DEFAULT '',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  daily_rate numeric,
  total_cost numeric,
  pickup_location text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_records_car_id ON rental_records(car_id);

-- RLS (Row Level Security) disabled untuk PostgreSQL lokal
-- RLS hanya diperlukan untuk Supabase (yang punya role 'anon' dan 'authenticated')
-- Jika ingin enable RLS di local, uncomment section dibawah ini

-- ALTER TABLE rental_records ENABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS "anon_select_rental_records" ON rental_records;
-- CREATE POLICY "anon_select_rental_records" ON rental_records FOR SELECT
--   TO anon, authenticated USING (true);

-- DROP POLICY IF EXISTS "anon_insert_rental_records" ON rental_records;
-- CREATE POLICY "anon_insert_rental_records" ON rental_records FOR INSERT
--   TO anon, authenticated WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_update_rental_records" ON rental_records;
-- CREATE POLICY "anon_update_rental_records" ON rental_records FOR UPDATE
--   TO anon, authenticated USING (true) WITH CHECK (true);

-- DROP POLICY IF EXISTS "anon_delete_rental_records" ON rental_records;
-- CREATE POLICY "anon_delete_rental_records" ON rental_records FOR DELETE
--   TO anon, authenticated USING (true);
