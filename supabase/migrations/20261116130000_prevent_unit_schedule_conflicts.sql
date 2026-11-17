ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.daily_notes
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.daily_notes
  DROP CONSTRAINT IF EXISTS daily_notes_status_check,
  ADD CONSTRAINT daily_notes_status_check
    CHECK (status IN ('pending_approval', 'active', 'completed', 'rejected'));

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

CREATE OR REPLACE FUNCTION public.check_daily_note_schedule_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('pending_approval', 'active') THEN
    PERFORM public.assert_unit_schedule_available(
      NEW.car_id,
      NEW.start_date,
      NEW.end_date,
      NULL,
      NEW.id,
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_service_schedule_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.check_rental_schedule_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('pending', 'approved', 'active', 'overdue') THEN
    PERFORM public.assert_unit_schedule_available(
      NEW.car_id,
      NEW.start_date,
      COALESCE(NEW.end_date, 'infinity'::date),
      NEW.id,
      NULL,
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_notes_schedule_conflict ON public.daily_notes;
CREATE TRIGGER daily_notes_schedule_conflict
  BEFORE INSERT OR UPDATE OF car_id, start_date, end_date, status
  ON public.daily_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.check_daily_note_schedule_conflict();

DROP TRIGGER IF EXISTS service_records_schedule_conflict ON public.service_records;
CREATE TRIGGER service_records_schedule_conflict
  BEFORE INSERT OR UPDATE OF car_id, service_date, status
  ON public.service_records
  FOR EACH ROW
  EXECUTE FUNCTION public.check_service_schedule_conflict();

DROP TRIGGER IF EXISTS rental_records_schedule_conflict ON public.rental_records;
CREATE TRIGGER rental_records_schedule_conflict
  BEFORE INSERT OR UPDATE OF car_id, start_date, end_date, status
  ON public.rental_records
  FOR EACH ROW
  EXECUTE FUNCTION public.check_rental_schedule_conflict();

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
  IF _user_role <> 1 THEN
    RAISE EXCEPTION 'Hanya Super Admin (Role 1) yang dapat mereview Investigation.';
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

REVOKE ALL ON FUNCTION public.assert_unit_schedule_available(uuid, date, date, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_daily_note_schedule_conflict()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_service_schedule_conflict()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rental_schedule_conflict()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_daily_note(uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_daily_note(uuid, uuid, integer, text)
  TO service_role;
