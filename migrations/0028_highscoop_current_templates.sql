-- Replace the selectable HighScoop default, retaining old draft/template keys.
-- Other brands and all saved manuscripts, images and Canva work stay unchanged.
UPDATE channels
SET card_template = CASE upper(accent_color)
  WHEN '#5ED7B5' THEN 'highscoop:experience'
  WHEN '#BAA0FF' THEN 'highscoop:competition'
  WHEN '#72A7FF' THEN 'highscoop:admissions'
  WHEN '#FFD166' THEN 'highscoop:conversation'
  WHEN '#57C7E3' THEN 'highscoop:news'
  ELSE 'highscoop:gifted' END,
  updated_at = now()
WHERE (slug IN ('opportunities','highscoop','highway') OR trim(name) ~* '^(Highscoop|하이스쿱|하이웨이)([[:space:]]*[·|:]|[[:space:]]*$)')
  AND card_template NOT IN ('highscoop:gifted','highscoop:experience','highscoop:competition','highscoop:admissions','highscoop:conversation','highscoop:news');
