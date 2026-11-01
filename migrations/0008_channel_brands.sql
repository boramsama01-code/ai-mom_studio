UPDATE channels SET name = CASE slug
  WHEN 'opportunities' THEN 'Highscoop'
  WHEN 'science-dialogue' THEN 'Alligodang · 과학'
  WHEN 'current-dialogue' THEN 'Alligodang'
  WHEN 'fryday' THEN 'Fryday'
END, version = version + 1, updated_at = now()
WHERE slug IN ('opportunities', 'science-dialogue', 'current-dialogue', 'fryday')
  AND name IS DISTINCT FROM CASE slug
    WHEN 'opportunities' THEN 'Highscoop'
    WHEN 'science-dialogue' THEN 'Alligodang · 과학'
    WHEN 'current-dialogue' THEN 'Alligodang'
    WHEN 'fryday' THEN 'Fryday'
  END;
--> statement-breakpoint
-- Only untouched starter copy changes. Keep user-written text and every older revision.
WITH updated AS (
  UPDATE studio_cards SET content = content || '{"title": "Highscoop · 첫 인사와 채널 소개", "memo": "채널 이름 확정: 하이스쿱 · Highscoop.\n엄마 펨펨과 함께 찾는 고입의 길.\n특목고를 중심으로 자사고·영재학교의 입시 소식과 모집요강, 설명회 정보를 다룰 예정.\n소개 문구, 프로필 이미지, 첫 게시물 원고를 정리합니다."}'::jsonb,
    version = version + 1, updated_at = now()
  WHERE external_id = 'sites:seed-highway-intro' AND content->>'title' = 'Highway · 첫 인사와 채널 소개' AND content->>'memo' = '채널 이름 확정: 하이웨이 · Highway.
엄마 펨펨과 함께 찾는 고입의 길.
특목고를 중심으로 자사고·영재학교의 입시 소식과 모집요강, 설명회 정보를 다룰 예정.
소개 문구, 프로필 이미지, 첫 게시물 원고를 정리합니다.'
  RETURNING id, version, content
)
INSERT INTO studio_revisions (card_id, version, snapshot, instruction, applied)
SELECT id, version, content, '확정 채널명 반영', true FROM updated;
--> statement-breakpoint
WITH updated AS (
  UPDATE studio_cards SET content = content || '{"title": "Alligodang · 첫 인사와 채널 소개", "memo": "채널 이름 확정: 알리고당 · Alligodang.\n아빠 펭펭과 함께 뉴스·과학·AI·사회 등 다양한 이슈를 아이와 이야기합니다.\n가족 여행 콘텐츠는 실제로 아이와 함께 가본 곳만 다룹니다.\n프로필과 첫 게시물 원고를 정리합니다."}'::jsonb,
    version = version + 1, updated_at = now()
  WHERE external_id = 'sites:seed-news-name' AND content->>'title' = '시사 채널 · 이름 정하기' AND content->>'memo' = '아빠 펭펭의 지구 특파원 설정을 바탕으로 채널 이름을 정합니다.
현재 이름은 미정입니다. 지구 통신실은 세계관 속 장소 이름이며 확정된 채널명이 아닙니다.'
  RETURNING id, version, content
)
INSERT INTO studio_revisions (card_id, version, snapshot, instruction, applied)
SELECT id, version, content, '확정 채널명 반영', true FROM updated;
--> statement-breakpoint
UPDATE app_settings SET value = jsonb_build_object('notes', '확정: 모브랜드는 우주펭귄상회 · Space Penguin Company.
확정: 고입 전문 채널 이름은 하이스쿱 · Highscoop. 엄마 펨펨이 안내하는 특목고 중심의 고입 콘텐츠.
운영 방향: 우주펭귄상회는 가족의 이야기와 캐릭터를 쌓는 콘텐츠 IP 채널.
설정: 고향은 남극성-09. 김펭귄은 최고의 감자튀김을 만들어 고향에 전하고 싶어 한다.
확정: 알리고당 · Alligodang은 아이와 함께 나누는 뉴스·과학·세상 이야기.
미정: 우주펭귄상회 최종 슬로건, 게시 일정.
보드의 완료는 내부 제작 완료를 뜻하며 실제 SNS 게시 여부를 의미하지 않는다.', 'version', coalesce((value->>'version')::int, 1) + 1), updated_at = now()
WHERE key = 'studio_notes' AND value->>'notes' = '확정: 모브랜드는 우주펭귄상회 · Space Penguin Company.
확정: 고입 전문 채널 이름은 하이웨이 · Highway. 엄마 펨펨이 안내하는 특목고 중심의 고입 콘텐츠.
운영 방향: 우주펭귄상회는 가족의 이야기와 캐릭터를 쌓는 콘텐츠 IP 채널.
설정: 고향은 남극성-09. 김펭귄은 최고의 감자튀김을 만들어 고향에 전하고 싶어 한다.
미정: 시사 채널 이름, 우주펭귄상회 최종 슬로건, 게시 일정.
보드의 완료는 내부 제작 완료를 뜻하며 실제 SNS 게시 여부를 의미하지 않는다.';
