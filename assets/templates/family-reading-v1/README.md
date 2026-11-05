# 사진 교체에 견디는 인스타그램 카드뉴스 레이아웃 v2

1080×1350px, 8장, 두 스타일. 1~7장의 SVG는 색 면·선·사진창 경계만 포함합니다. 텍스트, 로고, 사진, 사진용 대체 텍스트는 SVG에 없습니다. 텍스트 46개와 이미지 4개는 Canva native 요소로 따로 배치합니다.

- `../../../shared/readingCardLayout.json`: 모든 페이지의 색·기하 요소·텍스트/이미지 좌표.
- `ink_lime/`, `cobalt_paper/`: 각 7개 배경 SVG.
- P08은 기존 #102D49 공통 엔딩을 유지하므로 새 SVG를 생성하지 않았습니다. 좌표는 명세에 포함했습니다.

## 주의할 구현 경계

본문을 줄바꿈한 뒤 고정 위치의 형광펜 띠에 맞추는 방식은 쓰지 않습니다. 문구를 수정하면 잘못된 구절이 강조될 수 있기 때문입니다. 2~3장의 안전한 기본값은 본문 바깥의 작은 색 막대입니다. 정확한 인라인 강조는 Canva 문자범위/줄배치 API를 검증한 뒤 별도 활성화해야 합니다.

텍스트 상자는 모두 위 정렬이며 `lineHeight`는 배수입니다. `maxLines`와 `height` 중 하나를 넘으면 편집 화면에서 해당 필드를 표시하고 원고/배치를 조정합니다. 자동 축소나 자르기는 사용하지 않습니다. 긴 한글 제목은 실제 글꼴로 확인해야 합니다.

이 파일은 레이아웃 원본입니다. Canva 등록 완료나 실제 8장 export 성공을 뜻하지 않습니다.

## Studio and Canva contract

`shared/readingCardLayout.json` is the canonical coordinate contract used by the Studio renderer and both profiles in `shared/readingCardProfiles.ts`. The SVGs contain only decorative backgrounds; text and photographs remain separate editable elements in Canva. A Studio profile being selectable does not mark any live Canva design ready.

- Studio template keys: `reading-ink-lime-v1`, `reading-cobalt-paper-v1`.
- Master versions: each template key followed by `-20261104`.
- Mapping: `family-reading-8/v1.0`; 46 text fields and four image fields.
- Photo slots: cover 936×480, discussion 936×360, activity 936×310. Studio preview and Canva uploads share the same crop, focal-point, brightness and overlay preparation.
- P08 profile slot: x84/y1170/110×110 with `contain`. The approved 1536×1024 PNG therefore occupies 110×73.333 at x84/y1188.333 in Canva; no crop or logo redesign is required.
- Approved source: `assets/branding/allligodang-bw.png`, SHA-256 `743e3a9bddc5465a08970900eb078148c19aadedd80b55a328a2b4c0bfe25908`. The recorded Canva asset is provenance only; runtime uploads the verified original through its existing account-scoped asset cache.
- Studio uses the bundled Noto Sans KR font. Canva font family/element opacity were not fully controllable through the editing tool. Matching fields and geometry do not imply pixel-identical output; final exported pages still require a visual check.
- Inline sentence highlighting is not enabled. Pages 2–3 use an accent bar outside the text.
- Explicit line breaks count toward `maxLines`. Overflow returns the exact field for editing; the renderer never shrinks type or clips excess text.

Live master registration must validate an actual 8-page 1080×1350 design, page identities, version and exact 46-text/four-image dataset. Existing legacy masters keep their previous mapping and validation. Final Canva page ordering/save approval, registration and production deployment are separate from these source assets.

The final source design must also match an approved profile/version/source binding in `shared/readingCanvaMasters.ts`. That list remains empty until final preview approval, save and dataset verification; identical field names alone do not prove that the selected visual style is the correct original.
