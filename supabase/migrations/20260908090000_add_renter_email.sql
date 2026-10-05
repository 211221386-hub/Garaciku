-- Add the required renter contact email to rental records.
ALTER TABLE rental_records
  ADD COLUMN IF NOT EXISTS renter_email text NOT NULL DEFAULT '';

COMMENT ON COLUMN rental_records.renter_email IS 'Email address used to contact the renter';
