CREATE TABLE family_manual_requests (
  request_id text PRIMARY KEY,
  channel_id integer NOT NULL REFERENCES channels(id),
  request_hash text NOT NULL,
  content_item_id integer NOT NULL REFERENCES content_items(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
