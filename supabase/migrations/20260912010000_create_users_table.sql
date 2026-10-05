CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role int NOT NULL DEFAULT 4,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (1, 2, 3, 4));

INSERT INTO users (username, password, full_name, role, is_active)
VALUES
  ('admin', 'admin123', 'Administrator', 1, true),
  ('operator', 'operator123', 'Operator', 2, true),
  ('staff', 'staff123', 'Staff', 3, true),
  ('viewer', 'viewer123', 'Viewer', 4, true)
ON CONFLICT (username) DO NOTHING;
