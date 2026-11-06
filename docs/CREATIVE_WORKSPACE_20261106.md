# Creative workspace · 2026-11-06

## Verified baseline and authorization

- GitHub main: `42c643d2161db59be2b78ceabf15b1eaa48c4298`. Open PR #22 is an older conflicting draft-sync change; preserve it.
- Main Render service: `spacepenguin`, `srv-dbjep0ou01pc73f8rf80`; both Render deploy metadata and public /api/health confirm this SHA, connected PostgreSQL and configured authentication.
- React 19, Vite, TypeScript, TanStack Query, Wouter; Express 5, Drizzle, external Neon PostgreSQL. Revisions, media, jobs and publication evidence are already persistent.
- Free Render web instance; inline publication while awake; process.yml recovers pending work at minute 17 hourly. Exact-minute scheduling is not guaranteed. No new paid infrastructure is proposed.
- The user authorized deletion of only the old `ai-mom-studio` web service. It was deleted on 2026-11-06 KST using the authenticated Render dashboard: `srv-dat0vbg473hc73e9l5r0`. Independent Render service listing confirms it is absent; `spacepenguin`, `woori-ledger-boram` and `nodeul-news` remain. The main health endpoint independently reports PostgreSQL connected, authentication configured and unchanged revision `42c643d`. No database or shared environment group was deleted.
- Local baseline typecheck and production build passed. The local execution environment disconnected immediately afterward, before implementation. Continue through a feature branch and actual CI; do not infer tests or browser inspection passed.

## Evidence and order

| Problem | Reproduction | Impact | Cause | Improvement | Verification |
|---|---|---|---|---|---|
| Manual creation can duplicate after a lost response | Create, lose response, retry | Disconnected duplicate drafts | No persistent creation receipt | Actor-scoped idempotency key | Concurrent PostgreSQL requests, changed-body rejection |
| Board loses filters and position | Search, open a card, return | Repeated filtering | Component-only state | Per-user/channel view state, scroll restore | Browser back, reload, independent channel scopes |
| Resumed editor does not recheck server | Modify from device B, return to A | Late conflict detection | Focus refetch disabled | Focus/reconnect reads, preserve edits and CAS | Two sessions and stale-save rejection |
| Creation defaults depend on brand-name conditions | Add channel, choose formats | Wrong starting editor | Hardcoded choices | Channel creative profile, explicit start routes | Channel isolation, news/manual/media |
| Numeric overview dominates content | Board with saved imagery | Hard to find next work | Metrics-first layout | Thumbnail-led resume/review, compact counts | Same-content desktop/mobile comparison |
| Template and character entry points are scattered | Find approved artwork | Repeated navigation | Separate entry points | Asset workspace | Aspect ratios, selected state, keyboard |
| Canva link lacks copy/return context | Open, edit externally, return | Ambiguous sync state | External navigation only | Save before open, copy link, explicit refresh | Return/failure preserves manuscript |

## Art direction

Compare two real implementations on identical content: A, a light editorial desk with warm neutral surfaces, 26px headings and generous portrait previews; B, a graphite navigator with dark rail, cooler surfaces and a denser gallery. A is the preferred hypothesis for prolonged Korean writing and faithful thumbnail colour judgement. Use approved brand artwork; avoid decorative gradient headers. Deep teal primary action, distinct semantic status tones. Spacing 4/8/12/16/24/32; 48px mobile controls; 16px inputs; 160ms transitions with reduced-motion support.

Public primary references: [Buffer Create](https://buffer.com/create), [Buffer Ideas](https://support.buffer.com/en-us/articles/creating-ideas-in-buffer-7gu7n0Hyyq), [Canva Get design](https://www.canva.dev/docs/connect/api-reference/designs/get-design/), [Canva folder items](https://www.canva.dev/docs/apps/rest-apis/reference/folders/list-folder-items/), [Canva exports](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/). Mobbin refused access because of a paid-plan restriction; no upgrade was purchased and no unseen Mobbin screen is evidence.

## Resume point

Implement through `feat/creative-workspace-20261106`; retain each actual check and failure below. Do not call external AI, publish to SNS, delete data, change public access or add paid services. Produce a reviewable PR; merging to main would auto-deploy and requires its own explicit outcome record.


## Implementation checkpoint

PR #73 initially persisted commits through `04d63db3b74286479e3a87e535da5feca8135312`. Subsequent head `3c7232f` and follow-ups below supersede this checkpoint. The obsolete Render service has been deleted as recorded above; the main service and shared DB/environment groups remain intact.


Baseline CI run 42122117526 passed 208 files / 2131 tests in 447.61 seconds, then passed the production build and renderer memory checks. It was cancelled at the 30-minute job limit while Playwright's system dependencies downloaded from azure.archive.ubuntu.com. This was a browser dependency installation failure, not an application test failure. The PR changes that mirror to the official Ubuntu archive and retains WebKit as the required engine; it does not silently downgrade the browser gate.


## Verified continuation

- PR head `3c7232f` passed changed-contract PostgreSQL tests, all 210 files / 2,137 tests, typecheck, build, renderer memory checks, mobile WebKit, one-page editing and news editorial checks (CI 42128741725). The run finished with two browser failures: document width 405px at a 393px new-channel board, and an inaccessible manuscript field inside a closed advanced section. Neither is counted as a pass.
- Local UI checks passed 22 tests; working-preview changes passed 29 UI tests and typecheck.
- Follow-up work in the working tree adds a shared selected-cut preview beside the editor on PC, a collapsible mobile preview, manuscript before AI tools, explicit uncertain-upload wording, final-video media-type validation and video revision recovery. These changes require a final combined CI run.
- Browser dependency installation now succeeds after the official Ubuntu mirror change. No new paid server, database or scheduler was provisioned.
- Interruption hardening: browser failures now retain URL, rendered text, visible fields, errors and a screenshot in CI artifacts; layout diagnostics include the header, navigation and notifications. Local manuscript placement is corrected, the channel select is constrained to its control width, and the legacy `.studio` blue override is removed so controls use the shared teal token. These corrections still require combined WebKit verification.

## Production data inspection (read only)

On 2026-11-06 KST the connected Neon project `spacepenguin` (`flat-fog-21307904`), production branch `br-spring-union-b3nlmrvs`, was inspected in explicitly read-only transactions. No schema, rows, accounts or settings were changed. There are five active channels, including the existing untitled webtoon channel, and one archived consolidation channel. Do not reduce the directory to four hardcoded brands. The database contains 32 studio contents (12 in trash), 31 stored studio images and 2 uploaded media records. Preserve all of them.

Non-sample source documents: 304 have a successfully fetched body; 4,710 are not fetched; 724 failed; 26 blocked; 342 unsupported. These are historical status totals, not a current failure rate. A saved URL must not be presented as a verified article body. Failed generic jobs last finished in October; no queued/running generic job was observed in this snapshot. No Canva editorial render job exists in production, so real-account Canva export/import is still unverified. The connector's Canva access is not evidence that the studio app has OAuth permission.

The main Render live deploy remains `dep-dbmg76gu01pc7389ckv0`, revision `42c643d2161db59be2b78ceabf15b1eaa48c4298`; PR changes have not been deployed. The obsolete service is independently absent from the Render service list.

Follow-up review found the existing photo upload path stores a metadata-stripped JPEG up to 1600px, while video bytes remain original. Video UI now states this distinction and uses “편집용 사진 받기” versus “영상 원본 받기”; it does not promise original photo preservation. Existing uploaded bytes are unchanged. The 12MB photo / 25MB video / 100MB-per-content caps remain in place. Full-size source photo storage, video composition and encoding need a separately designed storage/execution path.

## Resume after a1d1e81

CI 42132576077 passed typecheck, 27 changed-contract tests, 210 files / 2,138 total tests, build, renderer memory and the existing mobile/content/news/automatic browser checks. Two gates remain open. The 393px channel board still reports 405px document width, while every element's bounding rectangle fits. New diagnostics inspect overflowing text, internal scroll widths and fully restored subtree layout effects; no overflow is hidden to pass a test. The creative script confirmed the manuscript is visible after the placement fix; its exact label lookup still included the textarea's initial content. Explicit accessible names fix that lookup and make labels stable for assistive tools. The synthetic Instagram OAuth configuration read was also missing and is now supplied with the actual response shape.

CI now runs PostgreSQL and browser jobs independently, with an early artifact upload for creative/channel failures. Both remain required; no test or browser engine is removed. New local preview selection / Canva return, clipboard-denial and failed-import checks pass 59 UI tests. Visual polish removes redundant vertical gaps and aligns mobile save actions to the right. The next combined run must verify all pending changes before the PR leaves draft.

The 6642eb0 browser diagnostics isolate the overflow to the channel control: its visible width is 155px but WebKit reports 183px of native select content. The header starts that control at x=222, yielding document width 405px. Hiding the header alone removes it; hiding main, sidebar, navigation or notifications does not. The fix contains only this native select label, applies ellipsis, retains the complete option and title, and moves the visible keyboard focus ring to its wrapper. No page-wide overflow suppression is added. The 360px capture/edit/conflict/video/save/reopen/assets scenario passed. A later viewport filled the already-saved subtitle and correctly found Save disabled; reset scenario fixtures and unique subtitle values fix this test error. Viewport checks now collect all screenshots and then fail the aggregate if any scenario failed.

## Visual review of b16c76c

All five creative viewports (360/393/430/768/1440px) and both channel viewports (393/1280px) passed. The entire browser job, including the existing mobile, content, news and automatic workflows, passed CI 42136876590. Its PostgreSQL/typecheck/build job also passed. These are actual built screens and real PostgreSQL tests; browser APIs are synthetic, with external generation and posting blocked.

Direction A is selected: warm neutral desk, 26px title, 24px gallery gaps, original-ratio imagery and light navigation. B was rendered on the same content with graphite navigation, cooler surfaces, 22px titles, 12px gaps and shorter previews. A gives Korean writing and colourful artwork more room. B remains a comparison artifact, not a new theme setting.

Human inspection found Retry below the mobile fold on an initial read failure. Final polish places the error and Retry where the overview was, and reserves the first-content illustration for a genuine empty result. A browser assertion requires recovery to be visible without scrolling. Manual-mode copy now describes direct writing/import as a normal route rather than only an API-error fallback.

Offline browser script transfer was 363,868 bytes before and 372,163 after (+8,295), so no overall initial-download speed improvement is claimed. The previously measured local entry gzip changed from 96.78kB to 94.08kB; added workspace CSS also costs bytes. These are not Render cold-start measurements. The 6642eb0 Node22 renderer QA completed seven offline requests with peak RSS 496.83MiB, close to the free plan limit; existing shared heavy-work admission control remains in place.

## Execution interruption and durable evidence

The local exec-server transport disconnected again during final review and failed to recover after 45 seconds. This is a verified execution-environment interruption; it does not establish the cause of a ChatGPT conversation error. GitHub operations and CI remained available. Final UI patches were reconstructed from the exact b16c76c file contents, applied with unique-context guards and committed through GitHub. No production rows or credentials were changed.

Before/after screens and both directions are now assembled into workspace-review.png directly in CI, using existing Sharp and repository fonts. The source, screenshots, JSON results, diagnostics and review PNG remain reproducible without an interactive execution session. The final polish still requires its own complete CI outcome before this PR leaves draft.

## Concurrent main update preserved

During final review main advanced to 7b2bf40c7bff473bcb1f5d91cb328ed4713f7bca via PR #74 (Canva token endpoint error `code` handling). Its only changed files are server/services/canva.ts and tests/canva-rest.test.ts; neither overlaps the workspace changes. Both exact main blobs were brought into a two-parent merge of the feature branch. The immutable visual baseline remains 42c643d because this main update changes server OAuth error handling, not the screens. Recheck actual production revision separately from the PR head at delivery.

Visual capture now awaits only visible images with a five-second bound before screenshotting. This corrects an observed timing race in the asset logo capture; it does not redraw or replace brand artwork. All application changes remain on the feature branch.


## Image readiness gate correction

The merged main revision passed typecheck, all 210 files / 2,147 tests, build and the seven-request Node22 renderer check (peak RSS 486.43MiB). In CI 42140553290 all older browser workflows passed; the new creative gate failed at the final home return in 430/768/1440px with WebKit `EncodingError: Aborted by source change`. No API error or production write occurred. The helper had retained decode promises for image nodes being replaced during navigation. It now samples the currently connected, visible DOM each animation frame, requires complete images with positive natural width and two stable frames, and still fails after eight seconds for a missing/broken image. Failure screenshots bypass this readiness gate so diagnostics survive the original error. This is a correction to the capture harness; it does not alter app rendering or brand artwork. Verify the asset logo visually in the next run before marking the PR ready.


## Explicit cross-device handoff gate

The viewport suite deliberately resets its fixture for fair visual comparison. A separate handoff scenario now keeps one shared synthetic server while using independent mobile (393px) and PC (1440px) browser contexts with separate storage: capture on mobile, save the first manuscript, open that exact ID on PC, append and save, reload PC and mobile, and assert the server version and single-card count. This tests the actual client handoff path; PostgreSQL durability remains covered by the separate real-database tests. It must pass before delivery and must not be reported as live-device or production-account verification.


## Asset gallery evidence

Final visual coverage also visits the default asset template tab at every viewport, asserts all fourteen registered eight-page sets remain available without Canva OAuth, and checks overflow and loaded thumbnails before switching to brands. The library API fixture explicitly reports disconnected/unconfigured status; it does not simulate a successful Canva account connection. The review PNG now includes the native-ratio template gallery, brand guide, quick capture and first-load recovery screen in addition to both directions and before/after editor/mobile views. This closes an inspection gap where only the brand tab had been captured.


## Registered brand originals connected

Final asset review found preserved HighScoop and ALLligodang originals in the existing hashed profile registry that were not shown in the new brand guide. Channel creative profiles now optionally select a registered logo ID, in addition to an HTTPS URL. Only the compatibility boundary supplies initial IDs for the existing brands; new channels remain data-configured. Selection persists independently with the channel version and does not rewrite original files or old content. The existing ALL white-logo registry entry specifies a dark proof background; no colour filter or raster edit is applied. Shared previews keep the selection on image failure and show a recovery message. A new authenticated read route serves only hash-verified registry entries with private caching. Tests require anonymous 401, arbitrary-path 404, exact original bytes and real PostgreSQL round-trip/isolation. Browser captures use the same three original PNGs and assert all three remain displayed. No asset was made public or deleted. These changes require a fresh final CI outcome.


## Final copy and operational record polish

The channel default-design control now resolves persisted IDs through the existing design registry to readable names. The embedded asset gallery owns one page heading; standalone /design keeps its heading and existing functions. Its all-channel guidance describes browsing and per-channel defaults without an empty-result illustration. BRANDING.md now records the authorized old-service deletion and existing production service, keeps the GitHub repository name, and warns that the legacy root Blueprint is not the live configuration. Do not reapply it to recreate the deleted service. These are the last planned changes before final combined verification; add further changes only for a reproduced failure.


## Concurrent PR checkpoint preserved

Before updating the feature ref, GitHub returned an uncertain mutation error. A read of the actual ref found d9f2ce00ff3678b0bb8fa64109a4aa1f521f64f4, a concurrent child of 3e7d02b that adds per-logo loaded-source, scroll-visible screenshots and the ALL dark-background assertion. Those QA changes are compatible and preserved verbatim. The four final copy/document files are applied to that current tree, guarded by its exact SHA. The abandoned c11532c commit object was never used to overwrite the branch. Recheck the final ref and all required checks before delivery.


## Native memory budget follow-up

At a90d308, all 210 files / 2,148 tests, typecheck, build and every browser workflow passed CI 42144474742, but the memory probe measured 529.96 MiB. Its old CLI checked completion without a budget; a green job did not prove suitability for a 512 MiB service. Earlier runs varied around 486–497 MiB, so this is a newly measured operational risk, not proof that the logo UI caused a regression.

The existing one-at-a-time raster gate and four-page admission remain. Rasterization now uses one short-lived OS process rather than a worker thread, and waits for process close before releasing admission; native image allocator state is reclaimed with the process. JPEG settings, artwork, fonts and page geometry are unchanged. The child uses one Sharp thread, no cache and MALLOC_ARENA_MAX=2; it has no DB/job/provider work. This is an in-service child process, not a new Render service or paid worker. Sharp's documented Linux allocator fragmentation is a plausible contributor, not a measured attribution: https://sharp.pixelplumbing.com/performance/ . Node IPC reference: https://nodejs.org/api/child_process.html .

The memory probe now includes live parent+child RSS and a conservative overlap using the child's own peak; shared pages may be double-counted. It prints phase metrics to logs and fails a 448 MiB budget, leaving 64 MiB for request/DB overhead relative to the free plan. It neither caps the heap nor forces GC or lowers output resolution. Memory runs in its own CI job for prompt feedback, while the full DB/build/browser gates remain. Verify new lifecycle/output-parity tests and actual measured results before delivery; do not describe the 529.96 MiB run as a memory pass.


## Process experiment rejected; allocator/cache configuration candidate

CI 42146478241 measured 423.73 MiB parent RSS but **586.70 MiB total** when the raster child was included. The new budget correctly failed. Separate processes do not fit the existing plan and are rejected; they are not deployed. Keep the established bounded single-worker/thread architecture.

The next candidate follows Sharp's documented glibc allocator guidance: MALLOC_ARENA_MAX=2 is set before the production Node process starts via the existing POSIX npm start command, and the memory probe starts its compiled Node process with the identical setting. Sharp operation caching is disabled and pixel concurrency is one in both the main renderer and native worker. JPEG quality, dimensions, font source files, SVG layout, admission and deadlines remain unchanged. This is a trade of caching/parallelism for memory, not an upgrade or a hidden heap cap. The budget still requires <=448 MiB, and historical process RSS includes all worker threads. The process lifecycle experiment is fully reverted. Confirm the measured result and output parity before making a performance claim.
