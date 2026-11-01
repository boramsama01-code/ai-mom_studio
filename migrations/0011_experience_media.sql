CREATE TABLE studio_media (
 id serial PRIMARY KEY,
 card_id integer NOT NULL REFERENCES studio_cards(id),
 name text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('photo','video')),
 mime_type text NOT NULL,
 bytes bytea NOT NULL,
 preview bytea,
 frame_time_ms integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX studio_media_card ON studio_media(card_id);
