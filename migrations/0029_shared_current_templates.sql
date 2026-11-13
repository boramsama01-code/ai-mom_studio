-- Channel defaults and the selectable catalog use one current kit. Existing
-- copies, page designs, evidence, artwork and historical template keys stay intact.
UPDATE channels
SET card_template = CASE upper(accent_color)
  WHEN '#5ED7B5' THEN 'editorial:mint'
  WHEN '#BAA0FF' THEN 'editorial:purple'
  WHEN '#72A7FF' THEN 'editorial:blue'
  WHEN '#FFD166' THEN 'editorial:yellow'
  WHEN '#57C7E3' THEN 'editorial:cyan'
  ELSE 'editorial:red' END,
  version = version + 1,
  updated_at = now()
WHERE card_template NOT IN (
  'editorial:red','editorial:mint','editorial:purple','editorial:blue','editorial:yellow','editorial:cyan',
  'highscoop:gifted','highscoop:experience','highscoop:competition','highscoop:admissions','highscoop:conversation','highscoop:news'
);

-- Update only the default for future work, preserving the rest of each brand guide.
UPDATE channels
SET creative_profile = jsonb_set(creative_profile, '{defaultTemplate}', to_jsonb(card_template)),
  version = version + 1,
  updated_at = now()
WHERE creative_profile IS NOT NULL
  AND coalesce(creative_profile->>'defaultTemplate', '') NOT IN (
    'editorial:red','editorial:mint','editorial:purple','editorial:blue','editorial:yellow','editorial:cyan',
    'highscoop:gifted','highscoop:experience','highscoop:competition','highscoop:admissions','highscoop:conversation','highscoop:news'
  );
