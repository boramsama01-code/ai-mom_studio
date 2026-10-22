CREATE TABLE "studio_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_item_id" integer,
	"external_id" text,
	"imported_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_cards_source_item_id_unique" UNIQUE("source_item_id"),
	CONSTRAINT "studio_cards_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "studio_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"panel_index" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"mime_type" text DEFAULT 'image/png' NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"job_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"provider" text,
	"model" text,
	"applied" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_cards" ADD CONSTRAINT "studio_cards_source_item_id_content_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_images" ADD CONSTRAINT "studio_images_card_id_studio_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."studio_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_card_id_studio_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."studio_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_revisions" ADD CONSTRAINT "studio_revisions_card_id_studio_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."studio_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_revisions_card" ON "studio_revisions" USING btree ("card_id","id");
--> statement-breakpoint
UPDATE "channels" SET "name" = 'Highway · 고입'
WHERE "slug" = 'opportunities' AND "name" = '아이맘 · 도전·진학';
