ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false;

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
  must_reset_password boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.is_active, u.must_reset_password, u.created_at
  FROM public.users AS u
  WHERE u.username = _username
    AND u.is_active = true
    AND u.password_hash = extensions.crypt(_password, u.password_hash);
$$;

REVOKE ALL ON FUNCTION public.auth_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.auth_register(text, text, text, text, text);

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
  must_reset_password boolean,
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
  RETURNING users.id, users.username, users.full_name, users.email, users.phone, users.role,
            users.is_active, users.must_reset_password, users.created_at;
$$;

REVOKE ALL ON FUNCTION public.auth_register(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_register(text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.bulk_import_users(_accounts jsonb)
RETURNS TABLE (user_id uuid, username text, role integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _account jsonb;
  _username text;
  _role integer;
  _password text;
  _created_id uuid;
BEGIN
  IF _accounts IS NULL OR jsonb_typeof(_accounts) <> 'array' OR jsonb_array_length(_accounts) = 0 OR jsonb_array_length(_accounts) > 500 THEN
    RAISE EXCEPTION 'Daftar akun harus berupa array dengan 1 sampai 500 akun.';
  END IF;

  FOR _account IN SELECT value FROM jsonb_array_elements(_accounts) AS entries(value)
  LOOP
    _username := btrim(COALESCE(_account->>'username', ''));
    _password := _account->>'password';
    BEGIN
      _role := (_account->>'role')::integer;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Role akun % harus berupa angka 1 sampai 4.', _username;
    END;

    IF _username !~ '^[A-Za-z0-9._-]{3,30}$' THEN
      RAISE EXCEPTION 'Username akun tidak valid: %.', _username;
    END IF;
    IF _role IS NULL OR _role NOT IN (1, 2, 3, 4) THEN
      RAISE EXCEPTION 'Role akun % harus berupa angka 1 sampai 4.', _username;
    END IF;
    IF _password IS NULL OR length(_password) < 8 OR length(_password) > 128 THEN
      RAISE EXCEPTION 'Password sementara akun % harus 8 sampai 128 karakter.', _username;
    END IF;

    INSERT INTO public.users (username, full_name, email, phone, role, is_active, password_hash, must_reset_password)
    VALUES (_username, '', '', '', _role, true, extensions.crypt(_password, extensions.gen_salt('bf', 12)), true)
    RETURNING id INTO _created_id;

    user_id := _created_id;
    username := _username;
    role := _role;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_import_users(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_users(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_user_first_login(
  _user_id uuid,
  _full_name text,
  _email text,
  _phone text,
  _new_password text
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  email text,
  phone text,
  role int,
  is_active boolean,
  must_reset_password boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE public.users AS u
  SET full_name = btrim(_full_name),
      email = lower(btrim(_email)),
      phone = btrim(_phone),
      password_hash = extensions.crypt(_new_password, extensions.gen_salt('bf', 12)),
      must_reset_password = false
  WHERE u.id = _user_id
    AND u.is_active = true
    AND u.must_reset_password = true
    AND length(btrim(_full_name)) BETWEEN 1 AND 100
    AND btrim(_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND length(btrim(_phone)) BETWEEN 7 AND 30
    AND length(_new_password) BETWEEN 8 AND 128
  RETURNING u.id, u.username, u.full_name, u.email, u.phone, u.role, u.is_active, u.must_reset_password, u.created_at;
$$;

REVOKE ALL ON FUNCTION public.complete_user_first_login(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_user_first_login(uuid, text, text, text, text) TO service_role;