ALTER TABLE search_rules ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS subcategory text;
CREATE INDEX IF NOT EXISTS content_items_channel_subcategory ON content_items(channel_id, subcategory, created_at);
