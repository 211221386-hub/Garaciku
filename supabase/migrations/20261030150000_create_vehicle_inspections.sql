CREATE TABLE IF NOT EXISTS public.vehicle_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  inspector_user_id uuid NOT NULL REFERENCES public.users(id),
  inspector_name text NOT NULL,
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  mileage integer NOT NULL CHECK (mileage >= 0),
  model_snapshot text NOT NULL DEFAULT '',
  plate_snapshot text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved')),
  checked_prepared_by uuid REFERENCES public.users(id),
  checked_prepared_name text,
  checked_prepared_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_name text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_inspections_checked_prepared_consistency CHECK (
    (checked_prepared_by IS NULL AND checked_prepared_name IS NULL AND checked_prepared_at IS NULL)
    OR (checked_prepared_by IS NOT NULL AND checked_prepared_name IS NOT NULL AND checked_prepared_at IS NOT NULL)
  ),
  CONSTRAINT vehicle_inspections_approval_consistency CHECK (
    (status <> 'approved' AND approved_by IS NULL AND approved_name IS NULL AND approved_at IS NULL)
    OR (status = 'approved' AND approved_by IS NOT NULL AND approved_name IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_car_created
  ON public.vehicle_inspections(car_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_status_created
  ON public.vehicle_inspections(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.vehicle_inspections(id) ON DELETE CASCADE,
  category text NOT NULL,
  item_name text NOT NULL,
  result text NOT NULL CHECK (result IN ('ok', 'ng')),
  remark text NOT NULL DEFAULT '',
  responsible text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, sort_order)
);

ALTER TABLE public.vehicle_inspection_items
  ADD CONSTRAINT vehicle_inspection_items_ng_requires_remark
  CHECK (result <> 'ng' OR length(btrim(remark)) > 0);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_items_inspection
  ON public.vehicle_inspection_items(inspection_id, sort_order);

CREATE TABLE IF NOT EXISTS public.vehicle_inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.vehicle_inspection_items(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspection_photos_item
  ON public.vehicle_inspection_photos(item_id);

CREATE OR REPLACE FUNCTION public.enforce_vehicle_inspection_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.item_id::text, 2));
  IF (SELECT count(*) FROM public.vehicle_inspection_photos WHERE item_id = NEW.item_id) >= 5 THEN
    RAISE EXCEPTION 'Maksimal 5 foto untuk setiap butir pengecekan.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vehicle_inspection_photo_limit ON public.vehicle_inspection_photos;
CREATE TRIGGER enforce_vehicle_inspection_photo_limit
BEFORE INSERT ON public.vehicle_inspection_photos
FOR EACH ROW EXECUTE FUNCTION public.enforce_vehicle_inspection_photo_limit();

ALTER TABLE public.vehicle_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_inspection_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_inspection_photos
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_inspection_photos
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_vehicle_inspection(
  _inspection_id uuid,
  _approved_by uuid,
  _approved_name text,
  _user_role integer
)
RETURNS public.vehicle_inspections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inspection public.vehicle_inspections;
BEGIN
  IF _user_role <> 1 THEN
    RAISE EXCEPTION 'Hanya Role 1 yang dapat memberikan Approved.';
  END IF;

  UPDATE public.vehicle_inspections
  SET status = 'approved',
      approved_by = _approved_by,
      approved_name = btrim(_approved_name),
      approved_at = now()
  WHERE id = _inspection_id
    AND status = 'pending_approval'
    AND checked_prepared_by IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.vehicle_inspection_items
      WHERE inspection_id = _inspection_id
    )
  RETURNING * INTO _inspection;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengecekan tidak ditemukan, belum diperiksa Role 2, atau sudah disetujui.';
  END IF;

  RETURN _inspection;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_vehicle_inspection(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_vehicle_inspection(uuid, uuid, text, integer)
  TO service_role;
