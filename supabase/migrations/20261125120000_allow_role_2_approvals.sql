CREATE OR REPLACE FUNCTION public.approve_rental_cycle_unit(
  _rental_id uuid,
  _car_id uuid,
  _approved_by uuid,
  _user_role integer
)
RETURNS public.rental_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rental public.rental_records;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat menyetujui rental.';
  END IF;

  SELECT * INTO _rental
  FROM public.rental_records
  WHERE id = _rental_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan rental tidak ditemukan atau sudah diproses.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_car_id::text, 1));
  IF EXISTS (
    SELECT 1
    FROM public.rental_records
    WHERE car_id = _car_id
      AND id <> _rental_id
      AND status IN ('pending', 'approved', 'active', 'overdue')
      AND start_date <= COALESCE(_rental.end_date, 'infinity'::date)
      AND COALESCE(end_date, 'infinity'::date) >= _rental.start_date
  ) THEN
    RAISE EXCEPTION 'Unit sudah diminta atau terbooking pada rentang tanggal tersebut.';
  END IF;

  UPDATE public.rental_records
  SET status = 'approved',
      car_id = _car_id,
      approved_by = _approved_by,
      approved_at = now()
  WHERE id = _rental_id
  RETURNING * INTO _rental;

  RETURN _rental;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_rental_cycle_unit(
  _rental_id uuid,
  _rejected_by uuid,
  _user_role integer
)
RETURNS public.rental_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rental public.rental_records;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat menolak rental.';
  END IF;

  UPDATE public.rental_records
  SET status = 'rejected',
      approved_by = _rejected_by,
      approved_at = now()
  WHERE id = _rental_id
    AND status = 'pending'
  RETURNING * INTO _rental;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan rental tidak ditemukan atau sudah diproses.';
  END IF;

  RETURN _rental;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_daily_note(
  _note_id uuid,
  _reviewed_by uuid,
  _user_role integer,
  _decision text
)
RETURNS public.daily_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated_note public.daily_notes;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat mereview Investigation.';
  END IF;

  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Keputusan review tidak valid.';
  END IF;

  UPDATE public.daily_notes
  SET status = CASE WHEN _decision = 'approved' THEN 'active' ELSE 'rejected' END,
      reviewed_by = _reviewed_by,
      reviewed_at = now()
  WHERE id = _note_id
    AND status = 'pending_approval'
  RETURNING * INTO _updated_note;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investigation tidak ditemukan atau sudah direview.';
  END IF;

  RETURN _updated_note;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_rental_cycle_unit(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_rental_cycle_unit(uuid, uuid, uuid, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.reject_rental_cycle_unit(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_rental_cycle_unit(uuid, uuid, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.review_daily_note(uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_daily_note(uuid, uuid, integer, text)
  TO service_role;
