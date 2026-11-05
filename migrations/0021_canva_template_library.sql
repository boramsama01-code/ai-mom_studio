CREATE TABLE "canva_library_designs" (
  "id" serial PRIMARY KEY, "principal" text NOT NULL,
  "folder_id" text NOT NULL, "source_type" text NOT NULL, "source_id" text NOT NULL,
  "title" text NOT NULL, "source_updated_at" text, "metadata_version" text,
  "edit_url" text, "page_count" integer, "pages" jsonb NOT NULL DEFAULT '[]',
  "dataset" jsonb NOT NULL DEFAULT '{}', "dataset_hash" text, "status" text NOT NULL DEFAULT 'unavailable', "reason" text,
  "seen_at" timestamptz NOT NULL, "synced_at" timestamptz,
  "preview_version" text, "preview_status" text NOT NULL DEFAULT 'pending', "preview_updated_at" timestamptz,
  "preview_error_code" text, "preview_error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "canva_library_design_source" ON "canva_library_designs" ("principal","source_type","source_id");
--> statement-breakpoint
CREATE INDEX "canva_library_folder" ON "canva_library_designs" ("principal","folder_id");
--> statement-breakpoint
CREATE TABLE "canva_library_preview_jobs" (
  "id" serial PRIMARY KEY, "design_id" integer NOT NULL REFERENCES "canva_library_designs"("id"),
  "source_version" text NOT NULL, "pages" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'queued', "phase" text NOT NULL DEFAULT 'prepare',
  "export_job_id" text, "previous_export_job_ids" jsonb NOT NULL DEFAULT '[]'::jsonb, "lease_owner" text, "lease_until" timestamptz,
  "next_run_at" timestamptz NOT NULL DEFAULT now(), "error_code" text, "error_message" text,
  "attempts" integer NOT NULL DEFAULT 0, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "canva_library_preview_version" ON "canva_library_preview_jobs" ("design_id","source_version");
--> statement-breakpoint
CREATE INDEX "canva_library_preview_queue" ON "canva_library_preview_jobs" ("status","next_run_at");
--> statement-breakpoint
CREATE TABLE "canva_library_previews" (
  "id" serial PRIMARY KEY, "design_id" integer NOT NULL REFERENCES "canva_library_designs"("id"),
  "page" integer NOT NULL, "source_version" text NOT NULL, "mime" text NOT NULL,
  "width" integer NOT NULL, "height" integer NOT NULL, "sha256" text NOT NULL, "bytes" bytea NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "canva_library_preview_page" ON "canva_library_previews" ("design_id","page");
