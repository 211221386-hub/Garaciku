ALTER TABLE public.daily_note_return_itineraries
  ADD COLUMN IF NOT EXISTS start_km numeric CHECK (start_km IS NULL OR start_km >= 0),
  ADD COLUMN IF NOT EXISTS start_fuel integer CHECK (start_fuel IS NULL OR start_fuel BETWEEN 0 AND 100),
  ALTER COLUMN end_km DROP NOT NULL,
  ALTER COLUMN end_fuel DROP NOT NULL,
  ALTER COLUMN submitted_by DROP NOT NULL,
  ALTER COLUMN submitted_at DROP NOT NULL;

UPDATE public.daily_note_return_itineraries itinerary
SET start_km = note.start_km,
    start_fuel = note.start_fuel
FROM public.daily_notes note
WHERE note.id = itinerary.note_id
  AND itinerary.start_km IS NULL
  AND itinerary.start_fuel IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_note_return_start_pair'
      AND conrelid = 'public.daily_note_return_itineraries'::regclass
  ) THEN
    ALTER TABLE public.daily_note_return_itineraries
      ADD CONSTRAINT daily_note_return_start_pair
      CHECK ((start_km IS NULL) = (start_fuel IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_note_return_end_pair'
      AND conrelid = 'public.daily_note_return_itineraries'::regclass
  ) THEN
    ALTER TABLE public.daily_note_return_itineraries
      ADD CONSTRAINT daily_note_return_end_pair
      CHECK ((end_km IS NULL) = (end_fuel IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_note_return_km_order'
      AND conrelid = 'public.daily_note_return_itineraries'::regclass
  ) THEN
    ALTER TABLE public.daily_note_return_itineraries
      ADD CONSTRAINT daily_note_return_km_order
      CHECK (start_km IS NULL OR end_km IS NULL OR end_km >= start_km);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_note_return_itinerary(
  _note_id uuid,
  _user_id uuid,
  _start_km numeric,
  _start_fuel integer,
  _end_km integer,
  _end_fuel integer,
  _submit boolean,
  _parts text[],
  _damage_reports jsonb
)
RETURNS public.daily_note_return_itineraries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _note public.daily_notes;
  _itinerary public.daily_note_return_itineraries;
  _existing_itinerary public.daily_note_return_itineraries;
  _report_count integer;
BEGIN
  IF _start_km IS NULL OR _start_km < 0 OR trunc(_start_km) <> _start_km
    OR _start_fuel IS NULL OR _start_fuel NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'KM awal dan fuel awal wajib valid.';
  END IF;
  IF (_end_km IS NULL) <> (_end_fuel IS NULL)
    OR (_end_km IS NOT NULL AND (_end_km < _start_km OR _end_fuel NOT BETWEEN 0 AND 100)) THEN
    RAISE EXCEPTION 'KM akhir dan fuel akhir tidak valid.';
  END IF;
  IF _submit IS NULL OR (_submit AND (_end_km IS NULL OR _end_fuel IS NULL)) THEN
    RAISE EXCEPTION 'KM akhir dan fuel akhir wajib diisi sebelum itinerary dikirim.';
  END IF;
  IF _parts IS NULL OR cardinality(_parts) > 50
    OR (_submit AND cardinality(_parts) < 1)
    OR EXISTS (SELECT 1 FROM unnest(_parts) AS parts(value) WHERE length(btrim(value)) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Daftar part yang dibongkar tidak valid (maksimal 50 part).';
  END IF;
  IF _damage_reports IS NULL OR jsonb_typeof(_damage_reports) <> 'array' THEN
    RAISE EXCEPTION 'Daftar laporan kerusakan tidak valid.';
  END IF;

  SELECT * INTO _note
  FROM public.daily_notes
  WHERE id = _note_id
  FOR UPDATE;

  IF NOT FOUND OR _note.created_by IS DISTINCT FROM _user_id OR _note.status <> 'active' THEN
    RAISE EXCEPTION 'Investigation tidak ditemukan, bukan milik akun ini, atau sudah ditutup.';
  END IF;

  SELECT * INTO _existing_itinerary
  FROM public.daily_note_return_itineraries
  WHERE note_id = _note_id
  FOR UPDATE;
  IF FOUND AND _existing_itinerary.submitted_at IS NOT NULL AND NOT _submit THEN
    RAISE EXCEPTION 'Itinerary sudah dikirim. Simpan perubahan dengan melengkapi data pengembalian.';
  END IF;

  SELECT count(*) INTO _report_count FROM jsonb_array_elements(_damage_reports);
  IF _report_count > 20 THEN
    RAISE EXCEPTION 'Maksimal 20 laporan kerusakan per Investigation.';
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
    WHERE damage.daily_note_id IS DISTINCT FROM _note_id
      OR damage.rental_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Laporan kerusakan terhubung ke Investigation atau Transportation lain.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.damages damage
    WHERE damage.daily_note_id = _note_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(_damage_reports) AS report(id text)
        WHERE report.id = damage.id::text
      )
      AND EXISTS (SELECT 1 FROM public.damage_photos photo WHERE photo.damage_id = damage.id)
  ) THEN
    RAISE EXCEPTION 'Hapus foto laporan kerusakan sebelum menghapus laporannya.';
  END IF;

  INSERT INTO public.daily_note_return_itineraries (
    note_id, start_km, start_fuel, end_km, end_fuel, submitted_by, submitted_at, updated_at
  )
  VALUES (
    _note_id,
    _start_km,
    _start_fuel,
    _end_km,
    _end_fuel,
    CASE WHEN _submit THEN _user_id ELSE NULL END,
    CASE WHEN _submit THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (note_id) DO UPDATE
  SET start_km = EXCLUDED.start_km,
      start_fuel = EXCLUDED.start_fuel,
      end_km = EXCLUDED.end_km,
      end_fuel = EXCLUDED.end_fuel,
      submitted_by = CASE
        WHEN _submit THEN COALESCE(daily_note_return_itineraries.submitted_by, EXCLUDED.submitted_by)
        ELSE daily_note_return_itineraries.submitted_by
      END,
      submitted_at = CASE
        WHEN _submit THEN COALESCE(daily_note_return_itineraries.submitted_at, EXCLUDED.submitted_at)
        ELSE daily_note_return_itineraries.submitted_at
      END,
      updated_at = now()
  RETURNING * INTO _itinerary;

  UPDATE public.daily_notes
  SET start_km = _start_km,
      start_fuel = _start_fuel,
      end_km = CASE WHEN _submit THEN _end_km ELSE NULL END,
      end_fuel = CASE WHEN _submit THEN _end_fuel ELSE NULL END
  WHERE id = _note_id;

  DELETE FROM public.daily_note_dismantled_parts WHERE note_id = _note_id;
  INSERT INTO public.daily_note_dismantled_parts (note_id, part_name, sort_order)
  SELECT _note_id, btrim(value), ordinality::integer - 1
  FROM unnest(_parts) WITH ORDINALITY AS item(value, ordinality);

  INSERT INTO public.damages (
    id, car_id, daily_note_id, description, severity, status, reported_date, is_return_draft
  )
  SELECT
    report.id::uuid,
    _note.car_id,
    _note_id,
    btrim(report.description),
    report.severity,
    'open',
    CURRENT_DATE,
    NOT _submit AND COALESCE(_existing_itinerary.submitted_at IS NULL, true)
  FROM jsonb_to_recordset(_damage_reports) AS report(id text, description text, severity text)
  ON CONFLICT (id) DO UPDATE
  SET description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      is_return_draft = CASE
        WHEN _submit OR _existing_itinerary.submitted_at IS NOT NULL THEN false
        ELSE true
      END;

  DELETE FROM public.damages damage
  WHERE damage.daily_note_id = _note_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(_damage_reports) AS report(id text)
      WHERE report.id = damage.id::text
    );

  RETURN _itinerary;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_daily_note_return(
  _note_id uuid,
  _confirmed_by uuid,
  _user_role integer
)
RETURNS public.daily_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _itinerary public.daily_note_return_itineraries;
  _updated_note public.daily_notes;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian unit.';
  END IF;

  SELECT * INTO _itinerary
  FROM public.daily_note_return_itineraries
  WHERE note_id = _note_id;
  IF NOT FOUND
    OR _itinerary.submitted_at IS NULL
    OR _itinerary.start_km IS NULL
    OR _itinerary.start_fuel IS NULL
    OR _itinerary.end_km IS NULL
    OR _itinerary.end_fuel IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.daily_note_dismantled_parts WHERE note_id = _note_id) THEN
    RAISE EXCEPTION 'Itinerary pengembalian Investigation belum dikirim atau belum lengkap.';
  END IF;

  UPDATE public.daily_notes
  SET status = 'completed',
      start_km = _itinerary.start_km,
      start_fuel = _itinerary.start_fuel,
      end_km = _itinerary.end_km,
      end_fuel = _itinerary.end_fuel,
      return_confirmed_by = _confirmed_by,
      return_confirmed_at = now()
  WHERE id = _note_id
    AND status = 'active'
  RETURNING * INTO _updated_note;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catatan tidak ditemukan atau pengembalian sudah dikonfirmasi.';
  END IF;

  RETURN _updated_note;
END;
$$;

REVOKE ALL ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, numeric, integer, integer, integer, boolean, text[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, numeric, integer, integer, integer, boolean, text[], jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  TO service_role;
