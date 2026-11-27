CREATE OR REPLACE FUNCTION public.save_rental_return_itinerary(
  _rental_id uuid,
  _user_id uuid,
  _start_km integer,
  _start_fuel integer,
  _end_km integer,
  _end_fuel integer,
  _submit boolean,
  _damage_reports jsonb
)
RETURNS public.rental_return_itineraries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rental public.rental_records;
  _itinerary public.rental_return_itineraries;
  _existing_itinerary public.rental_return_itineraries;
  _report_count integer;
BEGIN
  IF _start_km IS NULL OR _start_km < 0
    OR _start_fuel IS NULL OR _start_fuel NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'KM awal dan fuel awal wajib valid.';
  END IF;
  IF (_end_km IS NULL) <> (_end_fuel IS NULL)
    OR (_end_km IS NOT NULL AND (_end_km < _start_km OR _end_fuel NOT BETWEEN 0 AND 100)) THEN
    RAISE EXCEPTION 'KM akhir dan fuel akhir tidak valid.';
  END IF;
  IF _submit AND (_end_km IS NULL OR _end_fuel IS NULL) THEN
    RAISE EXCEPTION 'KM akhir dan fuel akhir wajib diisi sebelum pengembalian dikirim.';
  END IF;
  IF _damage_reports IS NULL OR jsonb_typeof(_damage_reports) <> 'array' THEN
    RAISE EXCEPTION 'Daftar laporan kerusakan tidak valid.';
  END IF;

  SELECT * INTO _rental
  FROM public.rental_records
  WHERE id = _rental_id
  FOR UPDATE;
  IF NOT FOUND OR _rental.user_id IS DISTINCT FROM _user_id::text
    OR _rental.status NOT IN ('approved', 'active', 'overdue')
    OR _rental.return_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transportation tidak ditemukan, bukan milik akun ini, atau sudah diterima Admin.';
  END IF;

  SELECT * INTO _existing_itinerary
  FROM public.rental_return_itineraries
  WHERE rental_id = _rental_id
  FOR UPDATE;
  IF FOUND AND _existing_itinerary.submitted_at IS NOT NULL AND NOT _submit THEN
    RAISE EXCEPTION 'Itinerary sudah dikirim. Gunakan simpan perubahan pengembalian.';
  END IF;

  SELECT count(*) INTO _report_count FROM jsonb_array_elements(_damage_reports);
  IF _report_count > 20 THEN
    RAISE EXCEPTION 'Maksimal 20 laporan kerusakan per Transportation.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_damage_reports) AS report(id text, description text, severity text)
    WHERE report.id IS NULL
      OR report.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR length(btrim(COALESCE(report.description, ''))) NOT BETWEEN 1 AND 500
      OR report.severity IS NULL
      OR report.severity NOT IN ('low', 'medium', 'high')
  ) OR (
    SELECT count(DISTINCT report.id)
    FROM jsonb_to_recordset(_damage_reports) AS report(id text)
  ) <> _report_count THEN
    RAISE EXCEPTION 'Deskripsi, tingkat keparahan, atau ID laporan kerusakan tidak valid.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_damage_reports) AS report(id text)
    JOIN public.damages damage ON damage.id = report.id::uuid
    WHERE damage.rental_id IS DISTINCT FROM _rental_id
  ) THEN
    RAISE EXCEPTION 'Laporan kerusakan terhubung ke Transportation lain.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.damages damage
    WHERE damage.rental_id = _rental_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(_damage_reports) AS report(id text)
        WHERE report.id = damage.id::text
      )
      AND EXISTS (SELECT 1 FROM public.damage_photos photo WHERE photo.damage_id = damage.id)
  ) THEN
    RAISE EXCEPTION 'Hapus foto laporan kerusakan sebelum menghapus laporannya.';
  END IF;

  INSERT INTO public.rental_return_itineraries (
    rental_id, start_km, start_fuel, end_km, end_fuel, submitted_by, submitted_at, updated_at
  )
  VALUES (
    _rental_id,
    _start_km,
    _start_fuel,
    _end_km,
    _end_fuel,
    CASE WHEN _submit THEN _user_id ELSE NULL END,
    CASE WHEN _submit THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (rental_id) DO UPDATE
  SET start_km = EXCLUDED.start_km,
      start_fuel = EXCLUDED.start_fuel,
      end_km = EXCLUDED.end_km,
      end_fuel = EXCLUDED.end_fuel,
      submitted_by = CASE
        WHEN _submit THEN COALESCE(rental_return_itineraries.submitted_by, EXCLUDED.submitted_by)
        ELSE rental_return_itineraries.submitted_by
      END,
      submitted_at = CASE
        WHEN _submit THEN COALESCE(rental_return_itineraries.submitted_at, EXCLUDED.submitted_at)
        ELSE rental_return_itineraries.submitted_at
      END,
      updated_at = now()
  RETURNING * INTO _itinerary;

  INSERT INTO public.damages (
    id, car_id, rental_id, description, severity, status, reported_date, is_return_draft
  )
  SELECT
    report.id::uuid,
    _rental.car_id,
    _rental_id,
    btrim(report.description),
    report.severity,
    'open',
    CURRENT_DATE,
    NOT COALESCE(_existing_itinerary.submitted_at IS NOT NULL, false) AND NOT _submit
  FROM jsonb_to_recordset(_damage_reports) AS report(id text, description text, severity text)
  ON CONFLICT (id) DO UPDATE
  SET description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      is_return_draft = CASE
        WHEN _submit OR _existing_itinerary.submitted_at IS NOT NULL THEN false
        ELSE true
      END;

  DELETE FROM public.damages damage
  WHERE damage.rental_id = _rental_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(_damage_reports) AS report(id text)
      WHERE report.id = damage.id::text
    );

  RETURN _itinerary;
END;
$$;

REVOKE ALL ON FUNCTION public.save_rental_return_itinerary(uuid, uuid, integer, integer, integer, integer, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_rental_return_itinerary(uuid, uuid, integer, integer, integer, integer, boolean, jsonb)
  TO service_role;
