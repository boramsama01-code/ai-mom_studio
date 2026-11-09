# Notion · Studio · Canva

`/notion` connects the existing 콘텐츠 제작 data source to editable Studio drafts. It uses the Studio operator session and CSRF guard. Connecting the ChatGPT Notion or Canva plugin does not supply credentials to this application.

## One-time connection

1. In Studio → 연결 설정, save a Notion integration token. Share only the intended 콘텐츠 제작 database with that integration and enable content read/update permissions.
2. The default data source is `e5a4b4f7-f2f6-4fad-b514-1602a2b12b2b`. This is a **data source ID**, not the database ID from its URL. Override it only when selecting another tracker.
3. Connect Canva using the existing Studio OAuth flow. The new direct PPTX import path is separate from the fixed eight-page brand-template autofill path.

Tokens are stored with the existing encrypted secret store and are never returned to the browser. Do not put a token in a manuscript, URL, repository, or chat.

## Operator flow

Upload phone photos to **사진 원본** (Files), or include images inside the public manuscript section. Write a **게시용 원고** section containing sequential **1장**, **2장**, … headings. Internal review sections and source paragraphs are kept out of card copy. The thumbnail title property may differ from the first chapter headline; unchanged writeback preserves the original headline.

When **카드 원고** relates to rows in the existing **카드 원고 · Canva 입력표**, those current rows are authoritative. Archived prose is not imported. Rows must have consecutive **페이지** numbers, starting with 2–10 manuscript pages. **소제목**, **본문**, **각주**, and **출처표시** are preserved; Studio title/body edits write back to matching table rows. Change subtitle, footnote, and source-label columns in Notion, then pull them into Studio. An inaccessible or malformed related row fails explicitly instead of falling back to the archive.

Append one **원문 확인** row and one next-article row after the manuscript. The existing teaser convention is **역할=일반**, **제목=다음 편｜…**; **다음 편 예고** is also accepted as an explicit role. **QR대상URL** contains 1–24 distinct public HTTPS official URLs, one per line; **출처표시** provides their labels in the same order (newline or ` / `). Use the direct institutional notice URLs rather than a general notice-search page when those are available. Canva paginates the URLs in their original order, at most four QRs per page; 23 URLs produce six source pages. Each page keeps the source card title, explanation and footnote and shows its source range. Uploaded **원문QR** PNGs remain in Notion; Canva creates native, scannable vector QR codes from the actual URLs, keeping them out of cover-photo selection. The teaser uses its row’s title, body and qualification footnote. Output order is manuscript → source QR pages → teaser → fixed HighScoop follow page, up to 13 pages total. A larger combined deck fails before external submission instead of dropping addresses. Neither extra row is pushed back as an article paragraph.

Open 노션 원고 연결, preview the article, select a destination channel and A/B/C cover, then import. Import is deduplicated by Notion page ID. Original photo bytes are private; compatible, rotated copies are embedded in PPTX. Expiring Notion photo links are not retained in source snapshots.

Linked manuscripts opt into automatic two-way synchronization. The active web worker checks due links roughly every five minutes. The existing hourly process worker also checks them when configured; Render sleep and GitHub scheduling can delay execution. Disable the per-draft switch to use manual comparison only. Only already imported links participate.

One-sided manuscript changes flow to the other side. If both sides changed, neither wins automatically: compare and explicitly choose a side. Prior Studio revisions remain available. Changing the number of chapters in Studio requires aligning the Notion chapter structure before writeback. Complex discussion/two-column document formats are rejected instead of silently dropping fields. This version synchronizes card manuscript text and attached photos; publication captions and workflow status are not synchronized.

Canva creation imports native editable text, shapes, and photos. The operator can edit the design in Canva and explicitly import the finished PNG pages. **Canva does not provide arbitrary edited text extraction in this flow.** Reconcile changed wording in Studio, then confirm the visual copy before importing the output; push the reconciled Studio manuscript to Notion separately.

The linked card editor is available directly in the main `/studio/:cardId` workspace as well as `/notion?link=:id`. It replaces the generic card renderer for linked Studio cards. Select the cover, manuscript, QR, teaser or Follow page to preview it. Title/body changes produce a debounced local JPEG using the same fitted text, original photos, bottom fade, native QR and layout primitives as the PPTX builder; Canva can still change line breaks on import or after manual editing. Preview does not call a paid AI or create a Canva design. A missing A-cover photo is shown as a prominent warning.

Save writes an immutable Studio revision with CAS checks. Structured Notion subtitles, footnotes, source labels, source URLs, teaser and internal notes stay in their original fields. The editor exposes the article body separately from a protected subtitle. Per-card emphasis is a Studio-only design override stored under stable source card IDs; it is used by preview and later Canva creation without rewriting Notion's emphasis column. If a Notion pull replaces a card, its orphaned design override is removed while surviving card overrides are retained. Unsaved edits are guarded and checkpointed with the existing device draft recovery. A background refresh shows a version conflict rather than replacing local input. Existing opt-in automatic text sync still applies after a save; Canva regeneration remains an explicit button.

While Canva import/export is pending, the 2.5-second status poll reads Studio's saved source snapshot instead of fetching every Notion row repeatedly. A fresh source check follows the settled phase, and manual source checks remain available.

No step generates paid AI text, approves publication, or publishes a post automatically. Imported material still needs editorial and source review in the existing workflow.

## Recovery and validation

Source hashes, item versions, revision IDs and durable operation tokens protect concurrent writes. Notion writes renew their lease and check ownership before mutations. A partial remote write is reported with a comparison requirement. Canva POSTs are submitted once; an unknown result is retained for inspection, never automatically recreated. Completed outputs use immutable separate output revisions.

Photos: up to 12 Notion images, 12 MB each, 100 MB per import. Local originals are capped at 200 MB per linked draft. Card manuscripts: 2–10 source chapters; optional source QR and teaser plus the native fixed HighScoop follow page are appended to the Canva design. Oversized text or QR density fails validation instead of being shortened.

Test only with an isolated PostgreSQL database. `tests/helpers.ts` drops schemas and must never be pointed at production. New integration suites mock all outbound Notion/Canva requests.
