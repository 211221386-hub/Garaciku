REVOKE ALL ON FUNCTION public.auth_login(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.auth_login(text, text)
  TO service_role;