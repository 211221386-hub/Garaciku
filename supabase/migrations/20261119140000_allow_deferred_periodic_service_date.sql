UPDATE public.cars AS car
SET periodic_service_start_date = (
  SELECT COALESCE(service.next_service_date, service.service_date)
  FROM public.service_records AS service
  WHERE service.car_id = car.id
    AND service.is_recurring
  ORDER BY
    CASE service.status
      WHEN 'scheduled' THEN 0
      WHEN 'in_progress' THEN 1
      ELSE 2
    END,
    service.service_date
  LIMIT 1
)
WHERE car.periodic_service_start_date IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.service_records AS service
    WHERE service.car_id = car.id
      AND service.is_recurring
  );

CREATE OR REPLACE FUNCTION public.create_initial_periodic_service_for_car()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.periodic_service_start_date IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.service_records (
    car_id,
    service_date,
    service_type,
    description,
    status,
    next_service_date,
    reminder_enabled,
    reminder_interval_months,
    is_recurring
  ) VALUES (
    NEW.id,
    NEW.periodic_service_start_date,
    'Servis Berkala',
    'Jadwal berkala otomatis setiap 6 bulan.',
    'scheduled',
    NEW.periodic_service_start_date,
    true,
    6,
    true
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_periodic_service_date_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.periodic_service_start_date IS NOT NULL
    AND NEW.periodic_service_start_date IS DISTINCT FROM OLD.periodic_service_start_date THEN
    RAISE EXCEPTION 'Tanggal awal service berkala hanya dapat diisi satu kali.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_periodic_service_date_change ON public.cars;
CREATE TRIGGER prevent_periodic_service_date_change
  BEFORE UPDATE OF periodic_service_start_date ON public.cars
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_periodic_service_date_change();

DROP TRIGGER IF EXISTS set_initial_periodic_service_date ON public.cars;
CREATE TRIGGER set_initial_periodic_service_date
  AFTER UPDATE OF periodic_service_start_date ON public.cars
  FOR EACH ROW
  WHEN (OLD.periodic_service_start_date IS NULL AND NEW.periodic_service_start_date IS NOT NULL)
  EXECUTE FUNCTION public.create_initial_periodic_service_for_car();

REVOKE ALL ON FUNCTION public.prevent_periodic_service_date_change()
  FROM PUBLIC, anon, authenticated;
