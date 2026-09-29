CREATE TABLE "card_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer,
	"name" text NOT NULL,
	"layout" text DEFAULT 'classic' NOT NULL,
	"text_tone" text DEFAULT 'dark' NOT NULL,
	"overlay" integer DEFAULT 0 NOT NULL,
	"background" "bytea" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "card_template" text DEFAULT 'builtin:classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "canva_brand_template_id" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "canva_design" jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "source" text DEFAULT 'builtin' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;