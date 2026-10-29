ALTER TABLE public.service_records
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_initial_periodic_service_for_car()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  initial_service_date date;
BEGIN
  initial_service_date := ((NEW.created_at AT TIME ZONE 'Asia/Jakarta')::date + INTERVAL '6 months')::date;

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
    initial_service_date,
    'Servis Berkala',
    'Jadwal berkala otomatis setiap 6 bulan.',
    'scheduled',
    initial_service_date,
    true,
    6,
    true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_initial_periodic_service_for_car ON public.cars;
CREATE TRIGGER create_initial_periodic_service_for_car
AFTER INSERT ON public.cars
FOR EACH ROW
EXECUTE FUNCTION public.create_initial_periodic_service_for_car();