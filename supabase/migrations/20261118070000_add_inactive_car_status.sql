ALTER TABLE public.cars
  DROP CONSTRAINT IF EXISTS cars_operational_status_check;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_operational_status_check
  CHECK (operational_status IN ('ready', 'under_maintenance', 'inactive'));

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
  _operational_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_car_id::text, 1));

  SELECT operational_status
  INTO _operational_status
  FROM public.cars
  WHERE id = _car_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unit tidak ditemukan.';
  END IF;

  IF _operational_status = 'inactive' THEN
    RAISE EXCEPTION 'Unit berstatus Inactive dan tidak dapat digunakan.';
  END IF;

  IF _operational_status = 'under_maintenance' AND NOT _allow_maintenance THEN
    RAISE EXCEPTION 'Unit sedang dalam perawatan dan tidak dapat digunakan.';
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

CREATE OR REPLACE FUNCTION public.check_service_schedule_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _operational_status text;
BEGIN
  SELECT operational_status
  INTO _operational_status
  FROM public.cars
  WHERE id = NEW.car_id;

  IF _operational_status = 'inactive' THEN
    RAISE EXCEPTION 'Unit berstatus Inactive dan tidak dapat digunakan.';
  END IF;

  IF NEW.status = 'scheduled' THEN
    PERFORM public.assert_unit_schedule_available(
      NEW.car_id,
      NEW.service_date,
      NEW.service_date,
      NULL,
      NULL,
      NEW.id,
      true
    );
  END IF;
  RETURN NEW;
END;
$$;
