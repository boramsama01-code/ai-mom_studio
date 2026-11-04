-- Preserve historical built-in defaults when no explicit category list was saved.
ALTER TABLE channels ADD COLUMN categories jsonb;
