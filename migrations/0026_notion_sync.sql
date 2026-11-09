CREATE TABLE "notion_sync_links" (
 "id" serial PRIMARY KEY NOT NULL,
 "notion_page_id" text NOT NULL UNIQUE,
 "notion_url" text NOT NULL,
 "channel_id" integer NOT NULL REFERENCES "channels"("id"),
 "content_item_id" integer NOT NULL UNIQUE REFERENCES "content_items"("id"),
 "source_hash" text NOT NULL,"base_copy_hash" text NOT NULL,"source_edited_at" text NOT NULL,
 "source_snapshot" jsonb NOT NULL,"photo_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "cover_style" text DEFAULT 'A' NOT NULL,"auto_sync" boolean DEFAULT true NOT NULL,"last_checked_at" timestamp with time zone,"canva" jsonb DEFAULT '{"phase":"idle"}'::jsonb NOT NULL,
 "operation_token" text,"operation_until" timestamp with time zone,"last_error" text,
 "version" integer DEFAULT 1 NOT NULL,"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notion_sync_links_channel" ON "notion_sync_links" ("channel_id");
--> statement-breakpoint
CREATE TABLE "notion_sync_photos" (
 "id" serial PRIMARY KEY NOT NULL,"link_id" integer NOT NULL REFERENCES "notion_sync_links"("id"),
 "source_key" text NOT NULL,"name" text NOT NULL,"mime_type" text NOT NULL,"bytes" bytea NOT NULL,
 "sha256" text NOT NULL,"width" integer NOT NULL,"height" integer NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notion_sync_photos_source" ON "notion_sync_photos" ("link_id","source_key");
--> statement-breakpoint
CREATE INDEX "notion_sync_photos_link" ON "notion_sync_photos" ("link_id");
