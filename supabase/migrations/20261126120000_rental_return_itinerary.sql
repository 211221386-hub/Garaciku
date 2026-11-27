ALTER TABLE public.damages
  ADD COLUMN IF NOT EXISTS rental_id uuid REFERENCES public.rental_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_return_draft boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_damages_rental_id
  ON public.damages(rental_id);

CREATE TABLE IF NOT EXISTS public.rental_return_itineraries (
  rental_id uuid PRIMARY KEY REFERENCES public.rental_records(id) ON DELETE CASCADE,
  start_km integer NOT NULL CHECK (start_km >= 0),
  start_fuel integer NOT NULL CHECK (start_fuel BETWEEN 0 AND 100),
  end_km integer CHECK (end_km IS NULL OR end_km >= 0),
  end_fuel integer CHECK (end_fuel IS NULL OR end_fuel BETWEEN 0 AND 100),
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((end_km IS NULL) = (end_fuel IS NULL)),
  CHECK (
    (submitted_at IS NULL AND submitted_by IS NULL)
    OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND end_km IS NOT NULL AND end_fuel IS NOT NULL)
  ),
  CHECK (end_km IS NULL OR end_km >= start_km)
);

CREATE TABLE IF NOT EXISTS public.damage_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  damage_id uuid NOT NULL REFERENCES public.damages(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_damage_photos_damage_id
  ON public.damage_photos(damage_id);

CREATE OR REPLACE FUNCTION public.enforce_rental_return_damage_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.damage_id::text, 2));
  IF (SELECT count(*) FROM public.damage_photos WHERE damage_id = NEW.damage_id) >= 5 THEN
    RAISE EXCEPTION 'Maksimal 5 foto untuk setiap laporan kerusakan.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_rental_return_damage_photo_limit ON public.damage_photos;
CREATE TRIGGER enforce_rental_return_damage_photo_limit
BEFORE INSERT ON public.damage_photos
FOR EACH ROW EXECUTE FUNCTION public.enforce_rental_return_damage_photo_limit();

ALTER TABLE public.rental_return_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damage_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rental_return_itineraries, public.damage_photos
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_return_itineraries, public.damage_photos
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rental-return-damage-photos', 'rental-return-damage-photos', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg'];

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
  IF NOT FOUND OR _rental.user_id IS DISTINCT FROM _user_id
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

CREATE OR REPLACE FUNCTION public.confirm_rental_return(
  _rental_id uuid,
  _confirmed_by uuid,
  _user_role integer
)
RETURNS public.rental_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated_rental public.rental_records;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.rental_return_itineraries
    WHERE rental_id = _rental_id
      AND submitted_at IS NOT NULL
      AND start_km IS NOT NULL
      AND start_fuel IS NOT NULL
      AND end_km IS NOT NULL
      AND end_fuel IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Peminjam belum mengirim itinerary pengembalian yang lengkap.';
  END IF;

  UPDATE public.rental_records
  SET status = 'completed',
      return_confirmed_by = _confirmed_by,
      return_confirmed_at = now()
  WHERE id = _rental_id
    AND status IN ('approved', 'active', 'overdue')
  RETURNING * INTO _updated_rental;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental tidak ditemukan, belum disetujui, atau sudah dikonfirmasi.';
  END IF;

  RETURN _updated_rental;
END;
$$;

REVOKE ALL ON FUNCTION public.save_rental_return_itinerary(uuid, uuid, integer, integer, integer, integer, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_rental_return_itinerary(uuid, uuid, integer, integer, integer, integer, boolean, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_rental_return(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_rental_return(uuid, uuid, integer)
  TO service_role;
