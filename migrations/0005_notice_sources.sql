-- Public recruitment boards verified on 2026-10-27. Preserve any existing operator settings.
INSERT INTO official_sources (channel_id, name, school_type, domain, board_url, adapter, adapter_config, enabled, verified_at, verification_note)
SELECT id, 'GED 영재선발 공고', 'org', 'ged.kedi.re.kr', 'https://ged.kedi.re.kr/slct/noti/slctNotiStat.do', 'generic_board',
  '{"format":"ged_selection","linkSelector":"a.sdown[onclick]","maxItems":10}'::jsonb, true, now(),
  '공개 모집요강 목록과 자료 팝업 GET 응답 확인. 최신 목록 10개를 확인하며 중등·청소년 단서를 우선. 게시일·접수 마감은 목록에 없으므로 미확인으로 유지. 첨부 HWP/HWPX는 운영자 확인 필요.'
FROM channels WHERE slug = 'opportunities'
ON CONFLICT (channel_id, name) DO NOTHING;
--> statement-breakpoint
INSERT INTO official_sources (channel_id, name, school_type, domain, board_url, adapter, adapter_config, enabled, verified_at, verification_note)
SELECT id, '사이언스올 교육·캠프', 'org', 'scienceall.com', 'https://www.scienceall.com/brd/board/407/L/menu/293', 'generic_board',
  '{"linkSelector":"a[href*=\"bbsSn=\"]:has(.cate:contains(\"교육·캠프\"))","titleSelector":"div > p","maxItems":20}'::jsonb, true, now(),
  '한국과학창의재단 과학문화포털 공개 교육·캠프 목록 확인. 기관 재게시 자료를 포함하며 신청 가능 여부는 주최기관에서 재확인. 목록의 행사기간을 게시일로 사용하지 않음.'
FROM channels WHERE slug = 'opportunities'
ON CONFLICT (channel_id, name) DO NOTHING;
