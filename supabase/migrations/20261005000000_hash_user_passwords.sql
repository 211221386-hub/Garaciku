CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS password_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'password'
  ) THEN
    EXECUTE $migration$
      UPDATE public.users
      SET password_hash = extensions.crypt(password, extensions.gen_salt('bf', 12))
      WHERE password_hash IS NULL
        AND password IS NOT NULL
    $migration$;
  END IF;
END
$$;

ALTER TABLE public.users
DROP COLUMN IF EXISTS password;

CREATE OR REPLACE FUNCTION public.auth_login(_username text, _password text)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  role int,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at
  FROM public.users AS u
  WHERE u.username = _username
    AND u.is_active = true
    AND u.password_hash = extensions.crypt(_password, u.password_hash);
$$;

REVOKE ALL ON FUNCTION public.auth_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated;