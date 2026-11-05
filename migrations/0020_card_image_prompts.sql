CREATE TABLE "card_image_prompts" (
  "content_item_id" integer NOT NULL REFERENCES "content_items"("id"),
  "channel_id" integer NOT NULL REFERENCES "channels"("id"),
  "page_id" text NOT NULL,
  "prompt" text,
  "instruction" text NOT NULL DEFAULT '',
  "version" integer NOT NULL DEFAULT 0,
  "based_on_revision_id" integer REFERENCES "content_revisions"("id"),
  "last_generation" jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("content_item_id", "page_id")
);
