-- Publication intentions have their own CAS version, independent of rendered content.
-- Existing content-item JSONB drafts continue to work without an options key.
ALTER TABLE studio_cards ADD COLUMN publication_draft jsonb;
