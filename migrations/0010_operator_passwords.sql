CREATE TABLE IF NOT EXISTS "operator_credentials" (
  "username" text PRIMARY KEY NOT NULL,
  "password_hash" text,
  "version" integer DEFAULT 0 NOT NULL,
  "blocked_private_link_hash" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_password_resets" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "credential_version" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
