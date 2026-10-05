ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_users" ON public.users;
CREATE POLICY "anon_select_users"
ON public.users
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "anon_insert_users" ON public.users;
CREATE POLICY "anon_insert_users"
ON public.users
FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_users" ON public.users;
CREATE POLICY "anon_update_users"
ON public.users
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_users" ON public.users;
CREATE POLICY "anon_delete_users"
ON public.users
FOR DELETE
TO anon
USING (true);
