CREATE TABLE IF NOT EXISTS public.daily_note_return_itineraries (
  note_id uuid PRIMARY KEY REFERENCES public.daily_notes(id) ON DELETE CASCADE,
  end_km integer NOT NULL CHECK (end_km >= 0),
  end_fuel integer NOT NULL CHECK (end_fuel BETWEEN 0 AND 100),
  submitted_by uuid NOT NULL REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_note_dismantled_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.daily_notes(id) ON DELETE CASCADE,
  part_name text NOT NULL CHECK (length(btrim(part_name)) BETWEEN 1 AND 160),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_daily_note_dismantled_parts_note
  ON public.daily_note_dismantled_parts(note_id, sort_order);

CREATE TABLE IF NOT EXISTS public.daily_note_return_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.daily_notes(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_note_return_photos_note
  ON public.daily_note_return_photos(note_id);

ALTER TABLE public.daily_note_return_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_note_dismantled_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_note_return_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.daily_note_return_itineraries, public.daily_note_dismantled_parts, public.daily_note_return_photos
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_note_return_itineraries, public.daily_note_dismantled_parts, public.daily_note_return_photos
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('daily-note-return-photos', 'daily-note-return-photos', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg'];

CREATE OR REPLACE FUNCTION public.save_daily_note_return_itinerary(
  _note_id uuid,
  _user_id uuid,
  _end_km integer,
  _end_fuel integer,
  _parts text[]
)
RETURNS public.daily_note_return_itineraries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _note public.daily_notes;
  _itinerary public.daily_note_return_itineraries;
  _part_count integer;
BEGIN
  IF _end_km IS NULL OR _end_km < 0 OR _end_fuel IS NULL OR _end_fuel NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Kilometer atau fuel akhir tidak valid.';
  END IF;
  IF _parts IS NULL OR cardinality(_parts) < 1 OR cardinality(_parts) > 50
    OR EXISTS (SELECT 1 FROM unnest(_parts) AS parts(value) WHERE length(btrim(value)) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Daftar part yang dibongkar wajib diisi (maksimal 50 part).';
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
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.daily_note_dismantled_parts WHERE note_id = _note_id
  ) THEN
    RAISE EXCEPTION 'Itinerary pengembalian Investigation belum dikirim.';
  END IF;

  UPDATE public.daily_notes
  SET status = 'completed',
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

REVOKE ALL ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, integer, integer, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_note_return_itinerary(uuid, uuid, integer, integer, text[])
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  TO service_role;
