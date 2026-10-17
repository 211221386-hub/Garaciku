CREATE OR REPLACE FUNCTION public.auth_register(_username text, _full_name text, _password text)
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
  INSERT INTO public.users (username, full_name, role, is_active, password_hash)
  SELECT btrim(_username), btrim(_full_name), 4, true, extensions.crypt(_password, extensions.gen_salt('bf', 12))
  WHERE btrim(_username) ~ '^[A-Za-z0-9._-]{3,30}$'
    AND length(btrim(_full_name)) BETWEEN 1 AND 100
    AND length(_password) BETWEEN 8 AND 128
  ON CONFLICT (username) DO NOTHING
  RETURNING users.id, users.username, users.full_name, users.role, users.is_active, users.created_at;
$$;

REVOKE ALL ON FUNCTION public.auth_register(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_register(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_register(text, text, text) TO service_role;