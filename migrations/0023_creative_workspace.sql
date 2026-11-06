ALTER TABLE channels ADD COLUMN IF NOT EXISTS creative_profile jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_receipts (
  key text PRIMARY KEY,
  payload_hash text NOT NULL,
  resource_id integer NOT NULL REFERENCES studio_cards(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
