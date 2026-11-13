-- One public News tag/master for Alligodang and its HighScoop collaborations.
-- Source topic classifications, saved copy, media and publication history stay intact.
UPDATE channels
SET card_template = 'editorial:cyan',
  creative_profile = CASE WHEN creative_profile IS NULL THEN NULL
    ELSE jsonb_set(creative_profile, '{defaultTemplate}', '"editorial:cyan"'::jsonb) END,
  version = version + 1,
  updated_at = now()
WHERE slug IN ('news','current-dialogue','science-dialogue')
  AND (card_template <> 'editorial:cyan'
    OR (creative_profile IS NOT NULL AND creative_profile->>'defaultTemplate' IS DISTINCT FROM 'editorial:cyan'));
