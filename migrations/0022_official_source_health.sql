ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE official_sources ADD COLUMN IF NOT EXISTS last_new_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Upgrade only the untouched original GED adapter; preserve pauses and operator edits.
UPDATE official_sources SET adapter_config = adapter_config || '{"maxItems":100}'::jsonb,
  verification_note = CASE WHEN verification_note = '공개 모집요강 목록과 자료 팝업 GET 응답 확인. 최신 목록 10개를 확인하며 중등·청소년 단서를 우선. 게시일·접수 마감은 목록에 없으므로 미확인으로 유지. 첨부 HWP/HWPX는 운영자 확인 필요.'
    THEN '공개 모집요강 목록을 100건씩, 호출 한도 내 최대 10페이지 확인합니다. 중등·청소년 단서를 우선하며 게시일·접수 마감은 원문 확인 전까지 미확인입니다. 첨부 HWP/HWPX는 직접 확인이 필요합니다.'
    ELSE verification_note END
WHERE name = 'GED 영재선발 공고' AND version = 1
  AND adapter_config = '{"format":"ged_selection","linkSelector":"a.sdown[onclick]","maxItems":10}'::jsonb;
