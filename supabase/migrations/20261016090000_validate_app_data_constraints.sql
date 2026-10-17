ALTER TABLE public.daily_notes
  VALIDATE CONSTRAINT daily_notes_start_km_nonnegative,
  VALIDATE CONSTRAINT daily_notes_end_km_nonnegative,
  VALIDATE CONSTRAINT daily_notes_km_order,
  VALIDATE CONSTRAINT daily_notes_start_fuel_range,
  VALIDATE CONSTRAINT daily_notes_end_fuel_range,
  VALIDATE CONSTRAINT daily_notes_date_order;

ALTER TABLE public.rental_records
  VALIDATE CONSTRAINT rental_records_date_order;