CREATE TABLE "canva_masters" (
 "id" serial PRIMARY KEY, "channel_id" integer NOT NULL REFERENCES "channels"("id"),
 "format_id" text NOT NULL DEFAULT 'family_dialogue_8', "concept_mode" text NOT NULL,
 "has_external_activity" boolean NOT NULL, "template_version" text NOT NULL,
 "source_type" text NOT NULL, "source_id" text NOT NULL, "source_updated_at" text NOT NULL, "principal" text NOT NULL,
 "dataset" jsonb NOT NULL, "dataset_hash" text NOT NULL, "page_ids" jsonb NOT NULL,
 "edit_url" text, "status" text NOT NULL DEFAULT 'ready', "validated_at" timestamptz NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "canva_master_variant_version" UNIQUE ("channel_id","format_id","concept_mode","has_external_activity","template_version")
);
--> statement-breakpoint
CREATE TABLE "canva_render_jobs" (
 "id" serial PRIMARY KEY, "channel_id" integer NOT NULL REFERENCES "channels"("id"),
 "content_item_id" integer NOT NULL REFERENCES "content_items"("id"),
 "source_revision_id" integer NOT NULL REFERENCES "content_revisions"("id"), "source_version" integer NOT NULL,
 "master_id" integer NOT NULL REFERENCES "canva_masters"("id"), "request_id" text NOT NULL,
 "request_hash" text NOT NULL, "purpose" text NOT NULL DEFAULT 'create', "principal" text NOT NULL,
 "input" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'queued', "phase" text NOT NULL DEFAULT 'validate',
 "autofill_job_id" text, "export_job_id" text, "design_id" text, "design_updated_at" text, "edit_url" text,
 "output_asset_id" integer REFERENCES "media_assets"("id"), "output_revision_id" integer REFERENCES "content_revisions"("id"),
 "result" jsonb, "lease_owner" text, "lease_until" timestamptz, "next_run_at" timestamptz NOT NULL DEFAULT now(),
 "started_at" timestamptz, "error_code" text, "error_message" text,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "canva_render_request" UNIQUE ("channel_id","request_id")
);
--> statement-breakpoint
CREATE INDEX "canva_render_queue" ON "canva_render_jobs"("status","next_run_at");
--> statement-breakpoint
CREATE TABLE "canva_asset_uploads" (
 "id" serial PRIMARY KEY, "principal" text NOT NULL, "sha256" text NOT NULL,
 "status" text NOT NULL DEFAULT 'queued', "upload_job_id" text, "asset_id" text, "error_code" text,
 "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "canva_asset_principal_hash" UNIQUE ("principal","sha256")
);
