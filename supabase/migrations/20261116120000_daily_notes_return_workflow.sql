ALTER TABLE public.daily_notes
  RENAME COLUMN name TO created_name;

ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS return_confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_confirmed_at timestamptz;

UPDATE public.daily_notes
SET status = 'completed'
WHERE status = 'active';

ALTER TABLE public.daily_notes
  ADD CONSTRAINT daily_notes_status_check
  CHECK (status IN ('active', 'completed'));

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
  _updated_note public.daily_notes;
BEGIN
  IF _user_role NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian unit.';
  END IF;

  UPDATE public.daily_notes
  SET status = 'completed',
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

REVOKE ALL ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_daily_note_return(uuid, uuid, integer)
  TO service_role;
