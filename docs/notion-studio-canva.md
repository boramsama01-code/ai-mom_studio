# Notion · Studio · Canva

`/notion` connects the existing 콘텐츠 제작 data source to editable Studio drafts. It uses the Studio operator session and CSRF guard. Connecting the ChatGPT Notion or Canva plugin does not supply credentials to this application.

## One-time connection

1. In Studio → 연결 설정, save a Notion integration token. Share only the intended 콘텐츠 제작 database with that integration and enable content read/update permissions.
2. The default data source is `e5a4b4f7-f2f6-4fad-b514-1602a2b12b2b`. This is a **data source ID**, not the database ID from its URL. Override it only when selecting another tracker.
3. Connect Canva using the existing Studio OAuth flow. The new direct PPTX import path is separate from the fixed eight-page brand-template autofill path.

Tokens are stored with the existing encrypted secret store and are never returned to the browser. Do not put a token in a manuscript, URL, repository, or chat.

## Operator flow

Upload phone photos to **사진 원본** (Files), or include images inside the public manuscript section. Write a **게시용 원고** section containing sequential **1장**, **2장**, … headings. Internal review sections and source paragraphs are kept out of card copy. The thumbnail title property may differ from the first chapter headline; unchanged writeback preserves the original headline.

For card-table manuscripts, upload cover photos to the parent content row's **사진 원본** Files property. The first file is the cover; subsequent files map to the following manuscript pages in order. A covers use the photo with a black bottom fade and white title; B covers use typography and C covers use a top photo. A Notion page's own cover and body images are not cover inputs in card-table mode. The card row's **이미지URL** is currently rejected explicitly. Imported drafts synchronize later photo additions, replacements, reordering and removal; a new content row still needs its first Studio import. Use **노션 변경 확인 → 노션 → 스튜디오 적용** for an immediate refresh. Existing Canva designs are refreshed explicitly with **현재 원고로 새 디자인 만들기**.

When **카드 원고** relates to rows in the existing **카드 원고 · Canva 입력표**, those current rows are authoritative. Archived prose is not imported. Rows must have consecutive **페이지** numbers, starting with 2–20 manuscript pages. **소제목**, **본문**, **각주**, and **출처표시** are preserved; Studio title/body edits write back to matching table rows. Change subtitle, footnote, and source-label columns in Notion, then pull them into Studio. An inaccessible or malformed related row fails explicitly instead of falling back to the archive.

For native editable diagrams, set the card row's **확인메모** to **도식: 모집 달력** or **도식: 기관별 일정표**. A calendar title or first subtitle line must include a year and month, for example `2026년 11월 · 학생 지원`. Each following body line uses `11/10 | 시작 | 부산·전북` or `11/11 | 마감 | 서울·울산`. Dates must belong to that month; at most two events fit each date. An institution schedule starts with a pipe-separated 2–4-column header followed by up to eight equally sized data rows. Prefer seven rows or fewer. The subtitle, footnote, and source label are retained. The preview and PPTX share the same calendar cells and table shapes; long entries fail explicitly instead of being dropped or shrunk below the minimum text size. An image and diagram cannot occupy the same manuscript page. **도식: 접수 단계** retains the existing process diagram behavior.

Append one **원문 확인** row and one next-article row after the manuscript. The existing teaser convention is **역할=일반**, **제목=다음 편｜…**; **다음 편 예고** is also accepted as an explicit role. **QR대상URL** contains 1–24 distinct public HTTPS official URLs, one per line; **출처표시** provides their labels in the same order (newline or ` / `). Use the direct institutional notice URLs rather than a general notice-search page when those are available. Canva paginates the URLs in their original order, at most four QRs per page; 23 URLs produce six source pages. Each page keeps the source card title, explanation and footnote and shows its source range. Uploaded **원문QR** PNGs remain in Notion; Canva creates native, scannable vector QR codes from the actual URLs, keeping them out of cover-photo selection. The teaser uses its row’s title, body and qualification footnote. Output order is manuscript → source QR pages → teaser → fixed HighScoop follow page, up to 28 pages total. A larger combined deck fails before external submission instead of dropping addresses. Neither extra row is pushed back as an article paragraph.

Open 노션 원고 연결, preview the article, select a destination channel and A/B/C cover, then import. Import is deduplicated by Notion page ID. Original photo bytes are private; compatible, rotated copies are embedded in PPTX. Expiring Notion photo links are not retained in source snapshots.

Linked manuscripts opt into automatic two-way synchronization. The active web worker checks due links roughly every five minutes. The existing hourly process worker also checks them when configured; Render sleep and GitHub scheduling can delay execution. Disable the per-draft switch to use manual comparison only. Only already imported links participate.

One-sided manuscript changes flow to the other side. If both sides changed, neither wins automatically: compare and explicitly choose a side. Prior Studio revisions remain available. Changing the number of chapters in Studio requires aligning the Notion chapter structure before writeback. Complex discussion/two-column document formats are rejected instead of silently dropping fields. This version synchronizes card manuscript text and attached photos; publication captions and workflow status are not synchronized.

Choosing Studio text during conflict resolution also imports the current Notion photo list. Photo bytes and order are committed with the new source baseline, so keeping Studio wording does not strand an old cover after a simultaneous Notion photo change. Failed downloads leave the last valid stored photos available.

Canva creation imports native editable text, shapes, and photos. The operator can edit the design in Canva and explicitly import the finished PNG pages. **Canva does not provide arbitrary edited text extraction in this flow.** Reconcile changed wording in Studio, then confirm the visual copy before importing the output; push the reconciled Studio manuscript to Notion separately.

The linked card editor is available directly in the main `/studio/:cardId` workspace as well as `/notion?link=:id`. It replaces the generic card renderer for linked Studio cards. Select the cover, manuscript, QR, teaser or Follow page to preview it. Title/body changes produce a debounced local JPEG using the same fitted text, original photos, bottom fade, native QR and layout primitives as the PPTX builder; Canva can still change line breaks on import or after manual editing. Preview does not call a paid AI or create a Canva design. A missing A-cover photo is shown as a prominent warning.

Interactive previews generate only the selected page's SVG. They skip the other pages, OOXML and ZIP creation, while keeping the global page number and institutional QR range. Full Canva creation still builds and validates every page. Both paths share the same text fitting and drawing primitives.

Save writes an immutable Studio revision with CAS checks. Structured Notion subtitles, footnotes, source labels, source URLs, teaser and internal notes stay in their original fields. The editor exposes the article body separately from a protected subtitle. Per-card emphasis is a Studio-only design override stored under stable source card IDs; it is used by preview and later Canva creation without rewriting Notion's emphasis column. If a Notion pull replaces a card, its orphaned design override is removed while surviving card overrides are retained. Unsaved edits are guarded and checkpointed with the existing device draft recovery. A background refresh shows a version conflict rather than replacing local input. Existing opt-in automatic text sync still applies after a save; Canva regeneration remains an explicit button.

While Canva import/export is pending, the 2.5-second status poll reads Studio's saved source snapshot instead of fetching every Notion row repeatedly. A fresh source check follows the settled phase, and manual source checks remain available.

No step generates paid AI text, approves publication, or publishes a post automatically. Imported material still needs editorial and source review in the existing workflow.

## Recovery and validation

Source hashes, item versions, revision IDs and durable operation tokens protect concurrent writes. Notion writes renew their lease and check ownership before mutations. A partial remote write is reported with a comparison requirement. Canva POSTs are submitted once; an unknown result is retained for inspection, never automatically recreated. Completed outputs use immutable separate output revisions.

Photos: up to 12 Notion images, 12 MB each, 100 MB per import. Local originals are capped at 200 MB per linked draft. Card manuscripts: 2–20 source chapters; optional source QR and teaser plus the native fixed HighScoop follow page are appended to the Canva design, up to 28 output pages. The generic AI card-copy limits remain unchanged. Oversized text or QR density fails validation instead of being shortened.

Test only with an isolated PostgreSQL database. `tests/helpers.ts` drops schemas and must never be pointed at production. New integration suites mock all outbound Notion/Canva requests.

## Logo calendars and institution guides

**도식: 로고 모집 달력** uses the original bundled education-office CI PNGs in real month cells. Start the body with `2026년 11월 · 학생 지원 기준`, then use one region per line: `11/11 | 마감 | 서울`. Kinds are **시작**, **마감**, **사전** (a separate preliminary submission), and **조건부** (for example, an unfilled-course round). `의정부` uses the Gyeonggi logo while retaining its local label. Unknown aliases, duplicate events and excessive density fail explicitly. Week heights adapt to the events; images retain their original proportions. At most six events fit a date and 48 fit a calendar. A crowded month must be split into additional calendar pages.

**도식: 모집 안내** uses this body contract, without adding a table-header row:

```text
2026년 현재 학년 · 공고별 지원 자격 확인
[모집]
수학·과학 | 초6 | 해당 신규 과정
[전형]
학생 지원 | ~11/11 | GED · 18시
교사 추천 | ~11/12 | GED 추천
평가 | 12/5 | 과정별 방식
[서류]
공통 | GED 온라인 지원서
조건부 | 해당자 증빙 · 기관별 기한
미확인 | 별도 연구계획서: 주요강 미기재
```

The first table has 1–6 rows, the process has 2–5 actual stages, and documents have 1–3 rows. **[기관별 모집]** replaces **[모집]** for comparisons; its three columns are institution/course, fields/current grades, and submission-stage deadlines. Document states are **공통**, **조건부**, **없음명시**, **미확인**, and **선택**. `없음명시` requires an explicit source statement for the named applicant group. A missing mention is `미확인`, never proof that a document is unnecessary. GED teacher nomination is separate from a paper recommendation, and a research plan is separate from a personal statement. Keep the source's current-grade versus education-year distinction; do not infer ages. Put material differences on supplementary cards or in another regional volume. All cells and process boxes are editable text/shapes in Canva; previews use the same layout and reject overflow without deleting words.

## Full-page interiors and actual admission periods

Cover A/B/C keeps its original geometry and safe area (x96–984, y207–1143). All later manuscript, source QR, teaser and Follow pages use the larger interior frame x64–1016, y64–1286. Real institution-table and guide-table cells are horizontally centred; their fitted line block is vertically centred using the same layout in SVG and editable PPTX. QR symbols are rebuilt at integer pixel positions and module sizes inside the expanded frame, rather than stretching their modules.

**도식: 모집 기간표** opts a card into `admissions_timeline`. Its optional first line is a subtitle. Then enter this exact header and 1–10 real periods:

```text
2027학년도 모집 · 실제 접수일은 2026년
기관·과정 | 시작일 | 마감일 | 구분
서울 신규 | 2026-11-04 | 2026-11-11 18:00 | 학생 접수
같은 지역의 다른 과정 | 2026-11-20 | 2026-11-23 | 연계 접수
의정부 | 2026-11-30 | 2026-12-04 | 학생 접수
```

The four kinds are **학생 접수**, **추가 모집**, **사전 제출**, and **연계 접수**. Dates must be actual `YYYY-MM-DD` values, with `HH:mm` only when the source states a time; `24:00` is permitted only as an explicit end time. The axis and bars show calendar-date positions, and each row prints its exact supplied date/time labels. A missing time stays missing. Each input row remains a separate bar: do not merge disjoint periods merely because their region is the same. Unknown start dates belong in a separate institution table; this parser rejects missing endpoints instead of inferring them. Split more than ten periods into additional pages. Every bar, label and date tick remains editable, and overflow fails without truncating the source copy.
