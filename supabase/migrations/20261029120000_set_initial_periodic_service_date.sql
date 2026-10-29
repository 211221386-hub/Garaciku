ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS periodic_service_start_date date;

CREATE OR REPLACE FUNCTION public.create_initial_periodic_service_for_car()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  initial_service_date date;
BEGIN
  initial_service_date := COALESCE(
    NEW.periodic_service_start_date,
    ((NEW.created_at AT TIME ZONE 'Asia/Jakarta')::date + INTERVAL '6 months')::date
  );

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