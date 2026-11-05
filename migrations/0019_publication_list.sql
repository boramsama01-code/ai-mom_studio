ALTER TABLE "deliveries" ADD COLUMN "list_state" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "list_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "list_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_list_state_valid" CHECK ("list_state" IN ('active', 'archived', 'trashed'));
--> statement-breakpoint
CREATE INDEX "deliveries_list" ON "deliveries" USING btree ("channel_id", "list_state");
