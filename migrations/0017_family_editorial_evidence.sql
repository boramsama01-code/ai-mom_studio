CREATE TABLE family_evidence_records (
  id text PRIMARY KEY,
  channel_id integer NOT NULL REFERENCES channels(id),
  content_item_id integer NOT NULL REFERENCES content_items(id),
  kind text NOT NULL CHECK (kind IN ('source_snapshot','source_analysis','resource_research','evidence_set')),
  fingerprint text NOT NULL,
  source_snapshot_id text REFERENCES family_evidence_records(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX family_evidence_record_fingerprint ON family_evidence_records(content_item_id, kind, fingerprint);
CREATE INDEX family_evidence_record_owner ON family_evidence_records(channel_id, content_item_id);
CREATE FUNCTION keep_family_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Family editorial evidence is immutable; create a new evidence record';
END;
$$;
CREATE TRIGGER family_evidence_no_update BEFORE UPDATE ON family_evidence_records FOR EACH ROW EXECUTE FUNCTION keep_family_evidence_immutable();
CREATE TABLE family_editorial_stages (
  id text PRIMARY KEY,
  channel_id integer NOT NULL REFERENCES channels(id),
  content_item_id integer NOT NULL REFERENCES content_items(id),
  stage text NOT NULL,
  input_hash text NOT NULL,
  request_id text NOT NULL,
  base_revision integer REFERENCES content_revisions(id),
  status text NOT NULL,
  result jsonb NOT NULL,
  provenance jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL
);
CREATE INDEX family_editorial_stage_cache ON family_editorial_stages(content_item_id, stage, input_hash);
CREATE INDEX family_editorial_stage_request ON family_editorial_stages(content_item_id, request_id);
CREATE UNIQUE INDEX family_editorial_stage_running ON family_editorial_stages(content_item_id, stage, input_hash) WHERE status = 'running';
