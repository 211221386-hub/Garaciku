# Worker-Only Table User Security

The app authenticates against `public.users` through the Cloudflare Worker. The Worker verifies the password using `auth_login`, issues a signed app token, reloads the user's active role for each request, and proxies allowlisted table operations to Supabase. The app must not call Supabase tables directly.

## Before deploy

1. Back up the Supabase database and test the migration in a staging project.
2. Confirm `public.users.password_hash` and `public.auth_login(text,text)` exist. Do not run any migration that drops either one.
3. Ensure the PostgreSQL `extensions.crypt` function used by `auth_login` is available.
4. Configure Worker variables:
   - `SUPABASE_URL`: Supabase project URL.
   - `APP_ORIGIN`: exact app origin, such as `https://garaciku.211221386.workers.dev`.
5. Configure Worker secrets using the Cloudflare dashboard or `wrangler secret put`:
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key. Never expose it as an `EXPO_PUBLIC_*` variable.
   - `APP_JWT_SECRET`: random secret of at least 32 bytes.
   - `RENTAL_AUTOMATION_URL`: Power Automate webhook URL.
6. If running the Express API, set `APP_JWT_SECRET` to the same value, set `APP_ORIGIN`, and keep `DATABASE_URL` private.

Remove `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_RENTAL_AUTOMATION_URL` from app build environments. For native builds, set only `EXPO_PUBLIC_API_BASE_URL` to the Worker origin. Rotate the existing Power Automate webhook URL before storing its replacement as `RENTAL_AUTOMATION_URL`, since the previous URL was exposed through a public environment variable.

## Deploy order

1. Set Worker variables and secrets.
2. Deploy the current app and Worker; set `EXPO_PUBLIC_API_BASE_URL` for native apps. Web apps use their current origin.
3. Verify login for all roles and test every allowed/denied operation in staging.
4. Run `20261015100000_lock_app_tables_to_worker.sql` in Supabase SQL Editor. It removes old table policies, revokes direct grants from `PUBLIC`, `anon`, and `authenticated`, grants table access to `service_role`, restricts the login RPC to `service_role`, and adds data constraints.
5. Re-test the app and confirm direct REST requests using the anon key fail.

Do not run the migration before the Worker is configured and deployed: once direct grants are revoked, only requests through the Worker can access app tables.

## Operational hardening

Configure Cloudflare rate-limiting rules for `/api/auth/login`, `/api/data/*`, `/api/rental-created`, and `/api/rental-approved`. Rotate any webhook URL previously bundled into a public app build. Store secrets only in Cloudflare Worker secrets and server environment variables.
