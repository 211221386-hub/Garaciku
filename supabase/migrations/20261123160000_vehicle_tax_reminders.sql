ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS annual_tax_due_date date,
  ADD COLUMN IF NOT EXISTS plate_tax_due_date date,
  ADD COLUMN IF NOT EXISTS annual_tax_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS plate_tax_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION public.prevent_vehicle_tax_due_date_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.confirm_vehicle_tax', true) IS DISTINCT FROM 'on' THEN
    IF OLD.annual_tax_due_date IS NOT NULL
      AND NEW.annual_tax_due_date IS DISTINCT FROM OLD.annual_tax_due_date THEN
      RAISE EXCEPTION 'Jatuh tempo pajak tahunan hanya berubah setelah konfirmasi pajak.';
    END IF;
    IF OLD.plate_tax_due_date IS NOT NULL
      AND NEW.plate_tax_due_date IS DISTINCT FROM OLD.plate_tax_due_date THEN
      RAISE EXCEPTION 'Jatuh tempo pajak 5 tahunan hanya berubah setelah konfirmasi pajak.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_vehicle_tax_due_date_change ON public.cars;
CREATE TRIGGER prevent_vehicle_tax_due_date_change
  BEFORE UPDATE OF annual_tax_due_date, plate_tax_due_date ON public.cars
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vehicle_tax_due_date_change();

CREATE OR REPLACE FUNCTION public.confirm_vehicle_tax(
  _car_id uuid,
  _tax_type text,
  _expected_due_date date,
  _user_role integer
)
RETURNS public.cars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _car public.cars;
  _current_due_date date;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat mengonfirmasi pajak kendaraan.';
  END IF;
  IF _tax_type NOT IN ('annual', 'plate') THEN
    RAISE EXCEPTION 'Jenis pajak kendaraan tidak valid.';
  END IF;

  SELECT * INTO _car
  FROM public.cars
  WHERE id = _car_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mobil tidak ditemukan.';
  END IF;

  _current_due_date := CASE _tax_type
    WHEN 'annual' THEN _car.annual_tax_due_date
    ELSE _car.plate_tax_due_date
  END;
  IF _current_due_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo pajak belum diatur.';
  END IF;
  IF _current_due_date IS DISTINCT FROM _expected_due_date THEN
    RAISE EXCEPTION 'Jadwal pajak sudah berubah. Muat ulang data sebelum mengonfirmasi.';
  END IF;
  IF CURRENT_DATE < _current_due_date - 7 THEN
    RAISE EXCEPTION 'Pajak baru dapat dikonfirmasi mulai 7 hari sebelum jatuh tempo.';
  END IF;

  PERFORM set_config('app.confirm_vehicle_tax', 'on', true);
  IF _tax_type = 'annual' THEN
    UPDATE public.cars
    SET annual_tax_due_date = annual_tax_due_date + INTERVAL '1 year',
        annual_tax_confirmed_at = now()
    WHERE id = _car_id
    RETURNING * INTO _car;
  ELSE
    UPDATE public.cars
    SET plate_tax_due_date = plate_tax_due_date + INTERVAL '5 years',
        plate_tax_confirmed_at = now()
    WHERE id = _car_id
    RETURNING * INTO _car;
  END IF;
  RETURN _car;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_unit_schedule_available(
  _car_id uuid,
  _start_date date,
  _end_date date,
  _exclude_rental_id uuid DEFAULT NULL,
  _exclude_note_id uuid DEFAULT NULL,
  _exclude_service_id uuid DEFAULT NULL,
  _allow_maintenance boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _car public.cars;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_car_id::text, 1));

  SELECT * INTO _car
  FROM public.cars
  WHERE id = _car_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unit tidak ditemukan.';
  END IF;

  IF _car.operational_status = 'inactive' THEN
    RAISE EXCEPTION 'Unit berstatus Inactive dan tidak dapat digunakan.';
  END IF;
  IF _car.operational_status = 'under_maintenance' AND NOT _allow_maintenance THEN
    RAISE EXCEPTION 'Unit sedang dalam perawatan dan tidak dapat digunakan.';
  END IF;

  IF NOT _allow_maintenance AND (
    (_car.annual_tax_due_date IS NOT NULL AND (
      (_car.annual_tax_due_date <= CURRENT_DATE AND _end_date >= CURRENT_DATE)
      OR _car.annual_tax_due_date BETWEEN _start_date AND _end_date
    ))
    OR (_car.plate_tax_due_date IS NOT NULL AND (
      (_car.plate_tax_due_date <= CURRENT_DATE AND _end_date >= CURRENT_DATE)
      OR _car.plate_tax_due_date BETWEEN _start_date AND _end_date
    ))
  ) THEN
    RAISE EXCEPTION 'Pajak kendaraan jatuh tempo dan unit tidak dapat digunakan sampai pajak dikonfirmasi.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rental_records
    WHERE car_id = _car_id
      AND id IS DISTINCT FROM _exclude_rental_id
      AND status IN ('pending', 'approved', 'active', 'overdue')
      AND start_date <= _end_date
      AND COALESCE(end_date, 'infinity'::date) >= _start_date
  ) THEN
    RAISE EXCEPTION 'Unit sudah terbooking pada rentang tanggal tersebut.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.daily_notes
    WHERE car_id = _car_id
      AND id IS DISTINCT FROM _exclude_note_id
      AND status IN ('pending_approval', 'active')
      AND start_date <= _end_date
      AND end_date >= _start_date
  ) THEN
    RAISE EXCEPTION 'Unit sedang digunakan untuk Investigation pada rentang tanggal tersebut.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.service_records
    WHERE car_id = _car_id
      AND id IS DISTINCT FROM _exclude_service_id
      AND status = 'scheduled'
      AND service_date BETWEEN _start_date AND _end_date
  ) THEN
    RAISE EXCEPTION 'Unit memiliki jadwal Service pada rentang tanggal tersebut.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_vehicle_tax_due_date_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_vehicle_tax(uuid, text, date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_vehicle_tax(uuid, text, date, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.assert_unit_schedule_available(uuid, date, date, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
