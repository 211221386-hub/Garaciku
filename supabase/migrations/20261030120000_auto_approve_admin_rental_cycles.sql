CREATE OR REPLACE FUNCTION public.create_rental_cycle(
  _user_id uuid,
  _user_role integer,
  _car_ids uuid[],
  _renter_name text,
  _renter_email text,
  _renter_phone text,
  _start_date date,
  _start_time time,
  _end_date date,
  _end_time time,
  _purpose text,
  _notes text
)
RETURNS SETOF public.rental_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cycle_id uuid := gen_random_uuid();
  _car_id uuid;
  _unique_car_count integer;
  _status text;
BEGIN
  IF _user_role NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Role tidak diizinkan membuat peminjaman.';
  END IF;

  IF _car_ids IS NULL OR cardinality(_car_ids) = 0 THEN
    RAISE EXCEPTION 'Pilih minimal satu unit.';
  END IF;

  SELECT count(DISTINCT selected.car_id)
  INTO _unique_car_count
  FROM unnest(_car_ids) AS selected(car_id);

  IF _unique_car_count <> cardinality(_car_ids) THEN
    RAISE EXCEPTION 'Unit yang sama tidak boleh dipilih lebih dari sekali.';
  END IF;

  IF _start_date IS NULL OR (_end_date IS NOT NULL AND _end_date < _start_date) THEN
    RAISE EXCEPTION 'Rentang tanggal peminjaman tidak valid.';
  END IF;

  IF _end_date = _start_date AND _end_time IS NOT NULL AND _end_time <= _start_time THEN
    RAISE EXCEPTION 'Jam selesai harus setelah jam mulai.';
  END IF;

  IF _user_role IN (3, 4) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));
    IF EXISTS (
      SELECT 1
      FROM public.rental_records
      WHERE user_id = _user_id
        AND status IN ('pending', 'approved', 'active', 'overdue')
    ) THEN
      RAISE EXCEPTION 'Siklus peminjaman sebelumnya belum selesai. Tunggu sampai semua unit dikonfirmasi diterima.';
    END IF;
  END IF;

  FOR _car_id IN
    SELECT selected.car_id
    FROM unnest(_car_ids) AS selected(car_id)
    ORDER BY selected.car_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(_car_id::text, 1));
    IF EXISTS (
      SELECT 1
      FROM public.rental_records
      WHERE car_id = _car_id
        AND status IN ('pending', 'approved', 'active', 'overdue')
        AND start_date <= COALESCE(_end_date, 'infinity'::date)
        AND COALESCE(end_date, 'infinity'::date) >= _start_date
    ) THEN
      RAISE EXCEPTION 'Unit sudah terbooking pada rentang tanggal tersebut.';
    END IF;
  END LOOP;

  _status := CASE WHEN _user_role IN (1, 2) THEN 'approved' ELSE 'pending' END;

  RETURN QUERY
  INSERT INTO public.rental_records (
    cycle_id,
    car_id,
    user_id,
    renter_name,
    renter_email,
    renter_phone,
    start_date,
    start_time,
    end_date,
    end_time,
    purpose,
    notes,
    status,
    approved_by,
    approved_at
  )
  SELECT
    _cycle_id,
    selected.car_id,
    _user_id,
    _renter_name,
    _renter_email,
    _renter_phone,
    _start_date,
    _start_time,
    _end_date,
    _end_time,
    COALESCE(_purpose, ''),
    COALESCE(_notes, ''),
    _status,
    CASE WHEN _user_role IN (1, 2) THEN _user_id ELSE NULL END,
    CASE WHEN _user_role IN (1, 2) THEN now() ELSE NULL END
  FROM unnest(_car_ids) AS selected(car_id)
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_rental_cycle(uuid, integer, uuid[], text, text, text, date, time, date, time, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rental_cycle(uuid, integer, uuid[], text, text, text, date, time, date, time, text, text)
  TO service_role;
