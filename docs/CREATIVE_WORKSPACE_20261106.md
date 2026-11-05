# Creative workspace · 2026-11-06

## Verified baseline and authorization

- GitHub main: `42c643d2161db59be2b78ceabf15b1eaa48c4298`. Open PR #22 is an older conflicting draft-sync change; preserve it.
- Main Render service: `spacepenguin`, `srv-dbjep0ou01pc73f8rf80`; both Render deploy metadata and public /api/health confirm this SHA, connected PostgreSQL and configured authentication.
- React 19, Vite, TypeScript, TanStack Query, Wouter; Express 5, Drizzle, external Neon PostgreSQL. Revisions, media, jobs and publication evidence are already persistent.
- Free Render web instance; inline publication while awake; process.yml recovers pending work at minute 17 hourly. Exact-minute scheduling is not guaranteed. No new paid infrastructure is proposed.
- User authorized deletion of the old `ai-mom-studio` Render service, not its database or shared environment group. The connected Render tool has no delete operation, no Render REST credential is available, and the connected desktop is offline. Deletion is UNEXECUTED. Verify legacy OAuth callbacks before removal.
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
