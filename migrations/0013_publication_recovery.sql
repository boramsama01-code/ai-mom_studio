ALTER TABLE content_items ADD COLUMN publication_draft jsonb;
--> statement-breakpoint
ALTER TABLE approvals ADD COLUMN request_id text, ADD COLUMN request_hash text;
--> statement-breakpoint
CREATE UNIQUE INDEX approvals_request_id ON approvals(request_id);
--> statement-breakpoint
ALTER TABLE deliveries
  ADD COLUMN destination_snapshot jsonb,
  ADD COLUMN phase text,
  ADD COLUMN last_attempt_id text,
  ADD COLUMN lease_token text,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN outcome_source text,
  ADD COLUMN resolution_note text,
  ADD COLUMN needs_reconciliation boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX deliveries_recovery ON deliveries (status, lease_expires_at);
--> statement-breakpoint
CREATE TABLE delivery_attempts (
  id text PRIMARY KEY,
  delivery_id integer NOT NULL REFERENCES deliveries(id),
  attempt_no integer NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_attempts_number UNIQUE (delivery_id, attempt_no)
);
--> statement-breakpoint
CREATE TABLE delivery_attempt_events (
  id bigserial PRIMARY KEY,
  delivery_id integer NOT NULL REFERENCES deliveries(id),
  attempt_id text REFERENCES delivery_attempts(id),
  event text NOT NULL,
  phase text,
  status text,
  source text NOT NULL,
  actor text NOT NULL,
  external_container_id text,
  external_id text,
  external_url text,
  error_kind text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX delivery_attempt_events_delivery ON delivery_attempt_events(delivery_id, id);
--> statement-breakpoint
CREATE INDEX delivery_attempt_events_attempt ON delivery_attempt_events(attempt_id, id);
--> statement-breakpoint
CREATE FUNCTION prevent_publication_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Publication attempt evidence is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER delivery_attempts_append_only BEFORE UPDATE OR DELETE ON delivery_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_publication_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER delivery_attempt_events_append_only BEFORE UPDATE OR DELETE ON delivery_attempt_events
FOR EACH ROW EXECUTE FUNCTION prevent_publication_evidence_mutation();
--> statement-breakpoint
CREATE TABLE publisher_heartbeats (
  worker_id text PRIMARY KEY,
  mode text NOT NULL,
  status text NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  last_sweep_at timestamptz,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now()
);
