ALTER TABLE "notion_sync_links" ADD COLUMN "canva_auto_save" jsonb DEFAULT '{"enabled":true,"phase":"idle"}'::jsonb NOT NULL;
