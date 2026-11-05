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
