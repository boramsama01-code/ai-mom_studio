ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_new_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Upgrade only the untouched original GED adapter; preserve pauses and operator edits.
UPDATE official_sources SET adapter_config = adapter_config || '{"maxItems":100}'::jsonb
WHERE name = 'GED 영재선발 공고' AND version = 1
  AND adapter_config = '{"format":"ged_selection","linkSelector":"a.sdown[onclick]","maxItems":10}'::jsonb;
