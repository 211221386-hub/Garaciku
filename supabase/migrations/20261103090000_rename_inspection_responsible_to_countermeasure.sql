DO $$
BEGIN
  IF to_regclass('public.vehicle_inspection_items') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_inspection_items'
      AND column_name = 'responsible'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_inspection_items'
      AND column_name = 'countermeasure'
  ) THEN
    ALTER TABLE public.vehicle_inspection_items RENAME COLUMN responsible TO countermeasure;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_inspection_items'
      AND column_name = 'countermeasure'
  ) THEN
    ALTER TABLE public.vehicle_inspection_items
      ADD COLUMN countermeasure text NOT NULL DEFAULT '';
  END IF;
END;
$$;
