CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"content_item_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"media_asset_id" integer NOT NULL,
	"card_sha256" text NOT NULL,
	"captions" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invalidated_reason" text,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"channel_id" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '중학생과 부모' NOT NULL,
	"content_type" text NOT NULL,
	"accent_color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"editorial_guide" text DEFAULT '' NOT NULL,
	"budget" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"kind" text NOT NULL,
	"origin" text DEFAULT 'collected' NOT NULL,
	"primary_source_id" integer,
	"rule_id" integer,
	"run_id" integer,
	"title" text NOT NULL,
	"category" text,
	"school_type" text,
	"relevance" text DEFAULT 'uncertain' NOT NULL,
	"evidence_status" text DEFAULT 'needs_review' NOT NULL,
	"schedule_status" text DEFAULT 'unknown' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"publish_status" text DEFAULT 'waiting' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"excluded_reason" text,
	"extracted" jsonb,
	"edited" jsonb,
	"current_revision_id" integer,
	"next_action_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"topic_key" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"revision_no" integer NOT NULL,
	"author" text NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"usage" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"source_document_id" integer NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"approval_id" integer NOT NULL,
	"destination_id" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_container_id" text,
	"external_id" text,
	"external_url" text,
	"last_error" text,
	"error_kind" text,
	"request_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"secret_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" integer,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"result" jsonb,
	"last_error" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"content_item_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"kind" text DEFAULT 'card' NOT NULL,
	"sha256" text NOT NULL,
	"mime" text DEFAULT 'image/jpeg' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"cloudinary_public_id" text,
	"cloudinary_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"school_type" text,
	"domain" text,
	"board_url" text,
	"adapter" text,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_note" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_calls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actual_calls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unconnected_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"calls":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"endpoint" text NOT NULL,
	"category_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"display" integer DEFAULT 10 NOT NULL,
	"exclude_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclude_scope" text DEFAULT 'title' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_new_count" integer,
	"last_run_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"normalized_url" text NOT NULL,
	"original_url" text NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_raw" text,
	"published_at" timestamp with time zone,
	"published_precision" text,
	"fetch_status" text DEFAULT 'not_fetched' NOT NULL,
	"fetch_error" text,
	"fetched_text" text,
	"content_hash" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_primary_source_id_source_documents_id_fk" FOREIGN KEY ("primary_source_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_rule_id_search_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."search_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_revision_id_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_sources" ADD CONSTRAINT "official_sources_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_rules" ADD CONSTRAINT "search_rules_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_content" ON "approvals" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_channel_source" ON "content_items" USING btree ("channel_id","primary_source_id");--> statement-breakpoint
CREATE INDEX "content_items_channel_status" ON "content_items" USING btree ("channel_id","review_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_revisions_unique" ON "content_revisions" USING btree ("content_item_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "content_sources_unique" ON "content_sources" USING btree ("content_item_id","source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_unique" ON "deliveries" USING btree ("approval_id","destination_id");--> statement-breakpoint
CREATE UNIQUE INDEX "destinations_channel_platform_label" ON "destinations" USING btree ("channel_id","platform","label");--> statement-breakpoint
CREATE INDEX "jobs_claim" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active" ON "jobs" USING btree ("dedupe_key") WHERE dedupe_key is not null and status in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_revision_hash" ON "media_assets" USING btree ("revision_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "official_sources_channel_name" ON "official_sources" USING btree ("channel_id","name");--> statement-breakpoint
CREATE INDEX "runs_channel_started" ON "runs" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "search_rules_unique_active" ON "search_rules" USING btree ("channel_id","endpoint","normalized_query") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_url_sample" ON "source_documents" USING btree ("normalized_url","is_sample");