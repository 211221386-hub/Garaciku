ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';

DROP FUNCTION IF EXISTS public.auth_login(text, text);

CREATE FUNCTION public.auth_login(_username text, _password text)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  email text,
  phone text,
  role int,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
  FROM public.users AS u
  WHERE u.username = _username
    AND u.is_active = true
    AND u.password_hash = extensions.crypt(_password, u.password_hash);
$$;

REVOKE ALL ON FUNCTION public.auth_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.auth_register(text, text, text);

CREATE FUNCTION public.auth_register(
  _username text,
  _full_name text,
  _email text,
  _phone text,
  _password text
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  email text,
  phone text,
  role int,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO public.users (username, full_name, email, phone, role, is_active, password_hash)
  SELECT btrim(_username), btrim(_full_name), btrim(_email), btrim(_phone), 4, true,
         extensions.crypt(_password, extensions.gen_salt('bf', 12))
  WHERE btrim(_username) ~ '^[A-Za-z0-9._-]{3,30}$'
    AND length(btrim(_full_name)) BETWEEN 1 AND 100
    AND btrim(_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND length(btrim(_phone)) BETWEEN 7 AND 30
    AND length(_password) BETWEEN 8 AND 128
  ON CONFLICT (username) DO NOTHING
  RETURNING users.id, users.username, users.full_name, users.email, users.phone, users.role, users.is_active, users.created_at;
$$;

REVOKE ALL ON FUNCTION public.auth_register(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_register(text, text, text, text, text) TO service_role;