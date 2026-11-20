ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

WITH unique_user_names AS (
  SELECT full_name, min(id::text)::uuid AS user_id
  FROM public.users
  WHERE btrim(full_name) <> ''
  GROUP BY full_name
  HAVING count(*) = 1
)
UPDATE public.daily_notes AS note
SET created_by = user_names.user_id
FROM unique_user_names AS user_names
WHERE note.created_by IS NULL
  AND note.created_name = user_names.full_name;

CREATE INDEX IF NOT EXISTS idx_daily_notes_created_by
  ON public.daily_notes(created_by);
