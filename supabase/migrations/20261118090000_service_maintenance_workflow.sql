ALTER TABLE public.service_records
  DROP CONSTRAINT IF EXISTS service_records_status_check;

ALTER TABLE public.service_records
  ADD CONSTRAINT service_records_status_check
  CHECK (status IN ('completed', 'scheduled', 'in_progress'));

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unit tidak ditemukan.';
  END IF;

  IF _operational_status = 'inactive' AND NEW.status IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'Unit berstatus Inactive dan tidak dapat digunakan.';
  END IF;

  IF NEW.status IN ('scheduled', 'in_progress') THEN
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

CREATE OR REPLACE FUNCTION public.enforce_service_workflow_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start_date date;
BEGIN
  IF OLD.status = 'scheduled' AND NEW.status = 'in_progress' THEN
    IF NOT OLD.reminder_enabled THEN
      RAISE EXCEPTION 'Service ini bukan jadwal reminder yang dapat dimulai.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.service_records
      WHERE car_id = OLD.car_id
        AND id <> OLD.id
        AND status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'Unit sudah memiliki service yang sedang dikerjakan.';
    END IF;

    _start_date := COALESCE(OLD.next_service_date, OLD.service_date)
      - CASE WHEN OLD.is_recurring THEN 7 ELSE 2 END;
    IF CURRENT_DATE < _start_date THEN
      RAISE EXCEPTION 'Service baru dapat dimulai saat memasuki jendela reminder.';
    END IF;
  ELSIF OLD.status = 'scheduled' AND NEW.status = 'completed' THEN
    RAISE EXCEPTION 'Mulai service terlebih dahulu sebelum menandai selesai.';
  ELSIF OLD.status = 'in_progress' AND NEW.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'Service yang sedang dikerjakan hanya dapat diselesaikan.';
  ELSIF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Service yang sudah selesai tidak dapat dibuka kembali.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_service_operational_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    UPDATE public.cars
    SET operational_status = 'under_maintenance'
    WHERE id = NEW.car_id;
  ELSIF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    UPDATE public.cars
    SET operational_status = 'ready'
    WHERE id = NEW.car_id
      AND operational_status = 'under_maintenance';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_car_available_during_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.operational_status <> 'under_maintenance'
    AND EXISTS (
      SELECT 1
      FROM public.service_records
      WHERE car_id = NEW.id
        AND status = 'in_progress'
    ) THEN
    RAISE EXCEPTION 'Unit tidak dapat diaktifkan sebelum service yang sedang berjalan diselesaikan.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_deleting_service_in_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'in_progress' THEN
    RAISE EXCEPTION 'Selesaikan service yang sedang berjalan sebelum menghapus catatannya.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS service_workflow_transition ON public.service_records;
CREATE TRIGGER service_workflow_transition
  BEFORE UPDATE OF status ON public.service_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_service_workflow_transition();

DROP TRIGGER IF EXISTS service_sync_operational_status ON public.service_records;
CREATE TRIGGER service_sync_operational_status
  AFTER UPDATE OF status ON public.service_records
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_service_operational_status();

DROP TRIGGER IF EXISTS prevent_car_available_during_service ON public.cars;
CREATE TRIGGER prevent_car_available_during_service
  BEFORE UPDATE OF operational_status ON public.cars
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_car_available_during_service();

DROP TRIGGER IF EXISTS prevent_deleting_service_in_progress ON public.service_records;
CREATE TRIGGER prevent_deleting_service_in_progress
  BEFORE DELETE ON public.service_records
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_deleting_service_in_progress();

REVOKE ALL ON FUNCTION public.enforce_service_workflow_transition()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_service_operational_status()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_car_available_during_service()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_deleting_service_in_progress()
  FROM PUBLIC, anon, authenticated;
