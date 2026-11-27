ALTER TABLE public.damages
  ADD COLUMN IF NOT EXISTS daily_note_id uuid REFERENCES public.daily_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_damages_daily_note_id
  ON public.damages(daily_note_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'damages_single_return_parent'
      AND conrelid = 'public.damages'::regclass
  ) THEN
    ALTER TABLE public.damages
      ADD CONSTRAINT damages_single_return_parent
      CHECK (rental_id IS NULL OR daily_note_id IS NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_note_return_itinerary(
  _note_id uuid,
  _user_id uuid,
  _end_km integer,
  _end_fuel integer,
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
  _report_count integer;
BEGIN
  IF _end_km IS NULL OR _end_km < 0 OR _end_fuel IS NULL OR _end_fuel NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Kilometer atau fuel akhir tidak valid.';
  END IF;
  IF _parts IS NULL OR cardinality(_parts) < 1 OR cardinality(_parts) > 50
    OR EXISTS (SELECT 1 FROM unnest(_parts) AS parts(value) WHERE length(btrim(value)) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Daftar part yang dibongkar wajib diisi (maksimal 50 part).';
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
  IF _note.start_km IS NOT NULL AND _end_km < _note.start_km THEN
    RAISE EXCEPTION 'Kilometer akhir harus sama dengan atau lebih besar dari kilometer awal.';
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

  INSERT INTO public.daily_note_return_itineraries (note_id, end_km, end_fuel, submitted_by, submitted_at, updated_at)
  VALUES (_note_id, _end_km, _end_fuel, _user_id, now(), now())
  ON CONFLICT (note_id) DO UPDATE
  SET end_km = EXCLUDED.end_km,
      end_fuel = EXCLUDED.end_fuel,
      submitted_by = EXCLUDED.submitted_by,
      submitted_at = EXCLUDED.submitted_at,
      updated_at = now()
  RETURNING * INTO _itinerary;

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
    false
  FROM jsonb_to_recordset(_damage_reports) AS report(id text, description text, severity text)
  ON CONFLICT (id) DO UPDATE
  SET description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      is_return_draft = false;

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

REVOKE ALL ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, integer, integer, text[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, integer, integer, text[], jsonb)
  TO service_role;
