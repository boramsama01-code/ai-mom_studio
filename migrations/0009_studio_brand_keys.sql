-- Change only the current board's channel key; preserve original imports and history.
-- Existing foreign keys, source content, media and publishing approvals are untouched.
WITH updated AS (
  UPDATE studio_cards
  SET content = jsonb_set(content, '{channel}', '"highscoop"'::jsonb),
      version = version + 1, updated_at = now()
  WHERE content->>'channel' = 'highway'
  RETURNING id, version, content
)
INSERT INTO studio_revisions (card_id, version, snapshot, instruction, applied)
SELECT id, version, content, 'Highscoop 채널 식별자 정리', true FROM updated;
