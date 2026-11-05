ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_new_count integer NOT NULL DEFAULT 0;
