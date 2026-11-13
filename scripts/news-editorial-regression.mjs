// Built-app regression: all HTTP APIs are isolated mocks, while preview JPEGs
// use the actual production renderer. No database, paid AI or social API is used.
// Run after `npm run build`: node --import tsx scripts/news-editorial-regression.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { preview } from "vite";
import sharp from "sharp";
import { cardCopySchema } from "../shared/cardCopy.ts";
import { isCardPageArtworkId } from "../shared/cardPageArtworkId.ts";
import { planCarousel, renderCarouselPage } from "../server/services/cardCarousel.ts";
import { discussionCardCopyFixture } from "../tests/fixtures/discussionCardCopy.ts";
import { familyCardCopySchema } from "../shared/familyDialogue.ts";
import { editorialTemplateCatalogOptions } from "../shared/templateCatalog.ts";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "../tests/fixtures/familyDialogueCard.ts";
import { familyPageTitle } from "../server/services/familyDialogueCard.ts";
import { familyEvidenceFixture } from "../tests/fixtures/familyEvidence.ts";
import { familyEvidenceView, validateFamilyEvidenceReferences } from "../server/services/familyEvidence.ts";
import { canvaLibraryItemFixture, canvaLibraryStateFixture } from "../tests/fixtures/canvaTemplateLibrary.ts";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(require.resolve("playwright", { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? "/nonexistent"] })); }
const outputDir = path.resolve("test-results/news-editorial");
await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/results.json`, "[]");
const server = await preview({ preview: { host: "127.0.0.1", port: 4177, strictPort: true } });
const origin = "http://127.0.0.1:4177", itemPath = "/api/channels/3/items/9828", copyPath = `${itemPath}/card-copy`;
const stamp = "2026-11-04T00:00:00.000Z", clone = value => structuredClone(value);
const roles = { summary: { provider: "gemini", model: "gemini-fixture-summary" }, copy: { provider: "openai", model: "gpt-fixture-copy" }, image: { provider: "openai", model: "gpt-image-fixture" } };
const channels = [{ id: 3, slug: "current-dialogue", name: "Alligodang", active: true, version: 1, accentColor: "#32756b", contentType: "current_dialogue", budget: {}, aiSettings: roles, effectiveAiSettings: roles, aiDefaultModels: { gemini: roles.summary.model, openai: roles.copy.model, anthropic: "claude-fixture", image: roles.image.model }, aiAvailability: { gemini: true, openai: true, anthropic: false } }];
const ai = { defaultProvider: "gemini", text: { gemini: true, openai: true, anthropic: false }, image: true };
const legacyCopy = () => ({ version: 1, templateKey: "set:n03", cover: { title: "기존 원고의 제목", subtitle: "직접 저장한 문구는 먼저 유지합니다" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `직접 저장한 본문 ${i + 1}`, subtitle: "원문에서 확인한 내용", body: "기존에 저장한 문구입니다. 새 제안을 확인한 뒤 명시적으로 적용하기 전까지 그대로 보존해야 합니다." })) });
const style = { layout: "minimal", collection: "n03" };
const plan = (copy, pageDesigns) => planCarousel({ kind: "current_dialogue", payload: { title: "브라우저 테스트 자료", summary: "합성 자료의 사실과 해석을 구분합니다.", cardCopy: copy, ...(pageDesigns ? { pageDesigns } : {}) }, channelName: "Alligodang", channelSlug: "news", accent: "#32756b", sourceOrg: "브라우저 테스트 자료", checkedDate: "2026-11-04" }, style);
const imageCache = new Map();
async function cardImage(copy, pageIndex, backgrounds, pageDesigns) {
  const key = JSON.stringify([copy, pageIndex, pageDesigns]);
  if (!imageCache.has(key)) imageCache.set(key, renderCarouselPage(plan(copy, pageDesigns), pageIndex, style, null, "", backgrounds));
  return imageCache.get(key);
}
const uploadImage = await sharp({ create: { width: 360, height: 450, channels: 3, background: "#a9cac2" } }).png().toBuffer();
const pasteImage = await sharp({ create: { width: 360, height: 450, channels: 3, background: "#d2a27b" } }).png().toBuffer();

function fixture() {
  const evidenceBundle = familyEvidenceFixture(9828, 3), evidence = familyEvidenceView(evidenceBundle);
  const state = { saved: { version: 3, revisionId: 30, hasSavedCopy: true, recommendedStoryFormat: "discussion8", ai: roles, copy: legacyCopy() }, writes: [], aiAttempts: 0, familyAttempts: 0, cards: [], nextAssetId: 800, nextBackgroundId: 9000, canvaLibrary: canvaLibraryStateFixture(), canvaJobs: [] };
  const backgrounds = Object.assign(new Map(), { credits: new Map() }), assets = new Map(), manualImages = [];
  const makeAsset = () => {
    const id = state.nextAssetId; state.nextAssetId += 10;
    const copy = clone(state.saved.copy);
    const titles = copy.version === 2 ? copy.pages.map(familyPageTitle) : [copy.cover, ...copy.pages].map(page => page.title);
    const asset = { id, revisionId: state.saved.revisionId, templateKey: copy.templateKey, source: "builtin", createdAt: stamp, carousel: { version: 1, altVersion: 1, rendererProvider: "builtin", cover: { kind: "typography", credit: "합성 자료 · 실제 카드 렌더러" }, pages: titles.map((title, i) => ({ id: id + i, title, sha256: `fixture-${id + i}`, altText: `합성 자료의 ${i + 1}페이지. ${title}` })) } };
    asset.carousel.pages.forEach((page, index) => assets.set(page.id, { copy, index, pageDesigns: clone(state.saved.pageDesigns) }));
    state.cards.unshift(asset); return asset;
  };
  makeAsset();
  const detail = () => {
    const payload = { title: "기존 원고의 제목", event_at: null, published_at: stamp, checked_at: stamp, summary: "이 기사는 테스트용 인터뷰의 전망을 전합니다.", why_it_matters: "사실과 전망을 구분하는 연습입니다.", verified_facts: ["인터뷰가 진행됐습니다."], under_verification: [], perspectives: [], discussion_questions: ["무엇을 평가했나요?", "무엇이 달라졌나요?", "어떤 근거가 필요한가요?"], glossary: [], parent_hints: [], sources: [], evidence: [], independent_source_count: 1, cardCopy: clone(state.saved.copy) };
    if (state.saved.copy.version === 2) for (const key of Object.keys(familyDialogueMetadataFixture())) payload[key] = clone(state.saved[key]);
    const current = { id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp };
    return {
      item: { id: 9828, channelId: 3, primarySourceId: 1, title: "기존 원고의 제목", kind: "current_dialogue", origin: "collected", version: state.saved.version, currentRevisionId: state.saved.revisionId, reviewStatus: "pending", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: payload, canvaDesign: null, createdAt: stamp, updatedAt: stamp, subcategory: null }, current,
      primary: { id: 1, title: "테스트용 인터뷰와 AI의 능력", originalUrl: "https://source.example/isolated", normalizedUrl: "https://source.example/isolated", kind: "rss_direct", publisher: "브라우저 테스트 자료", fetchStatus: "ok", fetchedText: "이 문서는 테스트를 위한 합성 인터뷰입니다. 한 전문가가 AI의 미래를 전망했습니다. 전망을 이미 입증된 연구 결과로 바꾸어 표현하지 않습니다.", snippet: "테스트 자료", publishedAt: stamp, publishedPrecision: "day", lastFetchedAt: stamp, attachments: [], meta: {}, isSample: false },
      linked: [], revisions: [current], cards: clone(state.cards), approvals: [], deliveries: [], similar: [], imageAiAvailable: true,
      publicationDraft: { version: 1, captions: { instagram: "함께 질문을 나누는 합성 테스트 카드입니다.", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } }, defaultCaptions: { instagram: "함께 질문을 나누는 합성 테스트 카드입니다.", telegram: "" },
      publicationReadiness: { ready: true, blockers: [], dryRun: true, autoPublish: false, dailyLimit: 10, expectedUsername: "fixture.only", destinations: [{ id: 20, label: "@fixture.only", platform: "instagram", configured: true }] },
    };
  };
  const studio = () => ({ card: { id: 2828, version: 2, title: detail().item.title, channel: "news", format: "카드뉴스", stage: "review", sourceItemId: 9828, script: "", caption: "", memo: "", imagePath: "", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), createdAt: stamp, updatedAt: stamp, sourceReference: { channelId: 3, itemId: 9828 }, sourceOutput: { assetId: state.cards[0].id, channelId: 3, itemId: 9828, revisionId: state.cards[0].revisionId, stale: state.cards[0].revisionId !== state.saved.revisionId, pages: state.cards[0].carousel.pages, coverCredit: "합성 테스트 자료" } }, revisions: [], jobs: [], images: [] });
  async function api(route, url) {
    const request = route.request(), pathname = url.pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : undefined;
    if (method !== "GET") state.writes.push({ path: pathname, method, body: clone(body) });
    let data;
    if (pathname === "/api/auth/me") data = { user: "fixture", demo: false, csrf: "fixture-csrf", recoveryScope: "fixture-news-editorial-20261104", authConfigured: true, demoAllowed: false };
    else if (pathname === "/api/channels") data = channels;
    else if (pathname === "/api/channels/3/today") data = { counts: { pendingReview: 1, draftsReady: 1 } };
    else if (pathname === "/api/status") data = { globalStop: false, workerConnected: true, integrations: { aiProvider: "gemini", gemini: true, openai: true, anthropic: false, flags: { dryRun: true, autoPublish: false } } };
    else if (pathname === "/api/studio/ai-status") data = ai;
    else if (pathname === "/api/canva/status") data = { connected: state.canvaLibrary.connected };
    else if (pathname === "/api/canva/editorial/status") data = { configured: state.canvaLibrary.configured, connected: state.canvaLibrary.connected, autofill: state.canvaLibrary.autofill, capabilities: state.canvaLibrary.autofill ? ["autofill"] : [], ...(!state.canvaLibrary.autofill ? { capabilityStatus: "unavailable", reason: "capability_missing", message: "현재 연결한 Canva 계정·팀에서 자동 채우기를 사용할 수 없습니다. 원본 미리보기와 Canva 직접 편집은 사용할 수 있습니다." } : {}) };
    else if (pathname === "/api/canva/template-library") data = clone(state.canvaLibrary);
    else if (pathname === "/api/canva/template-library/sync" && method === "POST") { assert.deepEqual(body, {}); data = clone(state.canvaLibrary); }
    else if (/^\/api\/canva\/template-library\/designs\/[^/]+\/preview$/.test(pathname)) return route.fulfill({ contentType: "image/png", body: uploadImage });
    else if (pathname === "/api/channels/3/canva/masters") data = { items: [] };
    else if (pathname === `${itemPath}/canva/manual-imports` && method === "POST") {
      assert.deepEqual(Object.keys(body).sort(), ["confirmed", "designId", "requestId", "version"]);
      assert.equal(body.designId, "Dmanual_browser_copy"); assert.equal(body.version, state.saved.version); assert.equal(body.confirmed, true); assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
      // Production serves already completed export assets. Prepare the fixture
      // serially rather than starting eight raster jobs from image GETs.
      for (let index = 0; index < 8; index++) manualImages[index] = await cardImage(state.saved.copy, index, backgrounds, state.saved.pageDesigns);
      data = { id: 902, requestId: body.requestId, purpose: "import", status: "queued", phase: "export_prepare", sourceRevisionId: state.saved.revisionId, sourceVersion: body.version, designId: body.designId, editUrl: `https://www.canva.com/design/${body.designId}/edit`, exportJobId: null, outputAssetId: null, outputRevisionId: null, errorCode: null, errorMessage: null, createdAt: stamp, result: { manualImport: { version: 1, kind: "manual_copy", designId: body.designId, principal: "fixture-user:fixture-team", designUpdatedAt: 1793836800, pagesHash: "a".repeat(64), capturedAt: stamp } } };
      state.canvaJobs = [data];
    }
    else if (pathname === `${itemPath}/canva/jobs/902/accept` && method === "POST") {
      const job = state.canvaJobs.find(job => job.id === 902); assert(job); assert.equal(job.status, "needs_review"); assert.equal(job.sourceRevisionId, state.saved.revisionId);
      assert.deepEqual(body, { version: state.saved.version, textConfirmedUnchanged: true });
      state.saved = { ...state.saved, version: state.saved.version + 1, revisionId: state.saved.revisionId + 1 };
      state.canvaJobs = [{ ...job, status: "ready", outputRevisionId: state.saved.revisionId }]; data = { ok: true };
    }
    else if (pathname === `${itemPath}/canva/jobs`) {
      if (method === "POST") {
        assert.equal(body.libraryDesignId, "Dlibrary_template_1"); assert.equal(body.expectedLibraryUpdatedAt, 1793836800); assert.equal(body.masterId, undefined); assert.equal(body.version, state.saved.version);
        data = { id: 901, requestId: body.requestId, purpose: "create", status: "queued", phase: "validate", sourceRevisionId: state.saved.revisionId, sourceVersion: body.version, designId: null, editUrl: null, exportJobId: null, outputAssetId: null, outputRevisionId: null, errorCode: null, errorMessage: null, createdAt: stamp, result: { libraryDesignId: body.libraryDesignId, librarySourceUpdatedAt: 1793836800 } };
        state.canvaJobs = [data];
      } else data = { items: state.canvaJobs };
    }
    else if (pathname === "/api/studio/cards/2828") data = studio();
    else if (pathname === "/api/studio/cards") data = { cards: [studio().card], ai, notes: "", notesVersion: 1 };
    else if (pathname === "/api/channels/3/templates") data = { current: "editorial:cyan", items: editorialTemplateCatalogOptions(channels[0]) };
    else if (pathname === "/api/channels/3/templates/preview") return route.fulfill({contentType:'image/jpeg',body:await cardImage({...familyDialogueCardFixture(),templateKey:url.searchParams.get('key')??'editorial:cyan'},0,backgrounds,familyDialogueMetadataFixture().pageDesigns)});
    else if (pathname === itemPath && method === "GET") data = detail();
    else if (pathname === copyPath && method === "GET") data = clone(state.saved);
    else if (pathname === copyPath && method === "PATCH") {
      assert.equal(body.version, state.saved.version, "copy changes must use the current accepted version");
      const copy = body.copy.version === 2 ? familyCardCopySchema.parse(body.copy) : cardCopySchema.parse(body.copy); plan(copy, body.pageDesigns);
      if (copy.version === 2) {
        assert.equal(body.evidence, undefined, "read-only evidence DTO must not be authored by the client");
        assert.deepEqual(validateFamilyEvidenceReferences(copy, evidenceBundle), [], "manual v2 saves must satisfy the actual evidence binding validator");
      }
      const expectedJob = copy.version === 2 && state.saved.copy.version === 1 ? 602 : state.saved.copy.storyFormat !== "discussion8" && copy.storyFormat === "discussion8" ? 502 : undefined;
      assert.equal(body.proposalJobId, expectedJob, "apply the verified proposal ID once; later manual saves must not reuse it");
      const nextRevision = state.saved.revisionId + 1;
      const metadata = copy.version === 2 ? { ...(state.saved.copy.version === 1 ? familyDialogueMetadataFixture(nextRevision) : Object.fromEntries(Object.keys(familyDialogueMetadataFixture()).map(key => [key, state.saved[key]]))), pageDesigns: clone(body.pageDesigns), fieldLocks: clone(body.fieldLocks ?? {}) } : {};
      if (copy.version === 2 && state.saved.copy.version === 2 && JSON.stringify(copy) !== JSON.stringify(state.saved.copy)) metadata.dependencies = { ...metadata.dependencies, caption: "needs_review", render: "needs_review" };
      state.saved = { ...state.saved, ...metadata, ...(copy.version === 2 ? { evidence: clone(evidence) } : {}), version: state.saved.version + 1, revisionId: nextRevision, copy: clone(copy) };
      data = clone(state.saved);
    } else if (pathname === `${copyPath}/preview` && method === "POST") {
      if (body.copy.version === 2) {
        assert.deepEqual(Object.keys(body).filter(key => key !== "proposalJobId").sort(), ["copy", "page", "pageDesigns", "version"], "v2 preview uses the strict semantic preview contract");
      }
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(body.copy, body.page, backgrounds, body.pageDesigns) });
    } else if (pathname === `${copyPath}/generate` && method === "POST") {
      if (body.formatId === "family_dialogue_8") {
        assert.equal(body.scope, "all"); assert.equal(body.version, state.saved.version); assert.equal(body.baseRevision, state.saved.revisionId); assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
        state.familyAttempts++;
        return route.fulfill({ json: { ...clone(state.saved), ...familyDialogueMetadataFixture(state.saved.revisionId), evidence: clone(evidence), copy: familyDialogueCardFixture(), scope: "all", status: "ready", reviewFlags: [], baseRevision: state.saved.revisionId, lateResult: false, jobId: 602 } });
      }
      assert.equal(body.version, state.saved.version); assert.equal(body.storyFormat, "discussion8"); assert.equal(body.refreshAnalysis, true);
      assert.equal(body.selectedPage, undefined, "rebuilding all eight pages must not be limited to the selected legacy page");
      assert.equal(body.provider, undefined, "the channel copy provider must remain the default"); assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
      state.aiAttempts++;
      if (state.aiAttempts === 1) return route.fulfill({ status: 503, json: { error: "합성 503 응답: 요약 AI가 잠시 혼잡합니다. 기존 문구는 유지했습니다.", jobId: 501, jobStatus: "failed" } });
      data = { ...clone(state.saved), copy: discussionCardCopyFixture(), model: roles.copy.model, scope: "all", selectedPage: 0, jobId: 502 };
    } else if (pathname === `${copyPath}/background` && method === "POST") {
      assert.equal(body.version, state.saved.version); assert.equal(body.mode, "upload", "this regression must not request paid background generation");
      assert(isCardPageArtworkId(body.pageId), "background uploads must use an accepted v1 or v2 page ID"); assert.match(body.requestId, /^[0-9a-f-]{36}$/i); assert.match(body.imageData, /^data:image\/png;base64,/);
      const assetId = state.nextBackgroundId++;
      const normalized = await sharp(Buffer.from(body.imageData.split(",")[1], "base64")).jpeg().toBuffer();
      backgrounds.set(assetId, normalized); backgrounds.credits.set(assetId, "직접 등록 이미지");
      data = { assetId, version: body.version, pageId: body.pageId, source: "upload", credit: "직접 등록 이미지", jobId: assetId };
    } else if (pathname.startsWith(`${copyPath}/background/`) && method === "GET") {
      const bytes = backgrounds.get(Number(pathname.split("/").at(-1))); assert(bytes);
      return route.fulfill({ contentType: "image/jpeg", body: bytes });
    } else if (pathname === `${itemPath}/card` && method === "POST") {
      assert.equal(body.version, state.saved.version); assert.notEqual(body.coverMode, "ai", "use saved uploaded imagery for the final local render");
      data = { ...clone(makeAsset()), itemVersion: state.saved.version, studioCardId: 2828 };
    } else if (/^\/api\/channels\/3\/media\/\d+\/alt-text$/.test(pathname) && method === "GET") {
      const assetId = Number(pathname.split("/").at(-2)), asset = state.cards.find(entry => entry.id === assetId); assert(asset);
      data = { version: 1, values: asset.carousel.pages.map(page => page.altText) };
    } else if (/^\/api\/channels\/3\/media\/\d+$/.test(pathname) && method === "GET") {
      const manualPage = Number(pathname.split("/").at(-1)) - 9900;
      if (manualPage >= 0 && manualPage < 8) { assert(manualImages[manualPage]); return route.fulfill({ contentType: "image/jpeg", body: manualImages[manualPage] }); }
      const asset = assets.get(Number(pathname.split("/").at(-1))); assert(asset);
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(asset.copy, asset.index, backgrounds, asset.pageDesigns) });
    } else return false;
    await route.fulfill({ json: data }); return true;
  }
  return { state, api };
}

const title = page => page.locator('.card-copy-editor textarea[id$="-title"]');
const pageButtons = page => page.locator('.card-copy-dots button');
const saveButton = page => page.locator('.card-copy-savebar').getByRole('button', { name: '문구 저장', exact: true });
const settlementRemaining = deadline => {
  const remaining = deadline - Date.now();
  assert(remaining > 0, 'current editor images and local API completion must settle within 20 seconds');
  return remaining;
};
function createApiLifecycle(diagnostics, stage) {
  const requests = new Map(), producers = new Map(), waiters = new Set();
  let sequence = 0, generation = 0;
  const snapshot = () => ({ requests: [...requests.values()], producers: [...producers.values()] });
  const changed = () => { generation++; for (const notify of [...waiters]) notify(); };
  const describe = request => ({ id: ++sequence, stage: stage(), method: request.method(), path: new URL(request.url()).pathname });
  const empty = () => requests.size === 0 && producers.size === 0;
  return {
    snapshot, empty, get generation() { return generation; },
    domChanged() { changed(); },
    startRequest(request) { const detail = describe(request); requests.set(request, detail); diagnostics.push({ kind: 'api-transport-start', at: Date.now(), ...detail }); changed(); },
    finishRequest(request, error = null) {
      const detail = requests.get(request); if (!detail) return;
      requests.delete(request); diagnostics.push({ kind: 'api-transport-finished', ...detail, finishedAt: Date.now(), finishedStage: stage(), error }); changed();
    },
    startProducer(request) { const detail = requests.get(request) ?? describe(request); producers.set(request, detail); diagnostics.push({ kind: 'api-producer-start', at: Date.now(), ...detail }); changed(); },
    finishProducer(request) { const detail = producers.get(request); if (!detail) return; producers.delete(request); diagnostics.push({ kind: 'api-producer-finished', ...detail, finishedAt: Date.now(), finishedStage: stage() }); changed(); },
    waitForEmpty(deadline) {
      if (empty()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = () => { if (!empty()) return; clearTimeout(timer); waiters.delete(finish); resolve(); };
        const timer = setTimeout(() => { waiters.delete(finish); reject(new Error(`Local API work remains before document replacement: ${JSON.stringify(snapshot())}`)); }, settlementRemaining(deadline));
        waiters.add(finish); finish();
      });
    },
    waitForQuiet(deadline) {
      // networkidle may already have fired before a newly scheduled 450ms
      // preview effect. Start a fresh quiet window only after current images
      // are ready; actual request/producer/DOM changes invalidate this window.
      return new Promise((resolve, reject) => {
        const remaining = settlementRemaining(deadline), startedAt = Date.now();
        const finish = quiet => {
          clearTimeout(timer); waiters.delete(interrupted);
          diagnostics.push({ kind: 'editor-quiet-window', stage: stage(), at: Date.now(), startedAt, elapsedMs: Date.now() - startedAt, quiet, generation, ...snapshot() });
          resolve(quiet);
        };
        const interrupted = () => finish(false);
        const timer = setTimeout(() => {
          if (remaining < 500) { waiters.delete(interrupted); reject(new Error('Current editor readiness did not remain quiet within the shared 20-second deadline')); }
          else finish(true);
        }, Math.min(500, remaining));
        waiters.add(interrupted);
      });
    },
  };
}
async function currentEditorImagesReady(expectedCopyVersion) {
  const editors = [...document.querySelectorAll('.card-copy-editor')];
  if (editors.length !== 1) return false;
  const editor = editors[0], figure = editor.querySelector('.card-copy-preview'), image = figure?.querySelector('img');
  const current = () => editor.isConnected && figure?.isConnected && figure.matches(':not(.is-stale)[aria-busy="false"]')
    && figure.querySelector('img') === image && image?.complete && image.naturalWidth === 1080 && image.naturalHeight === 1350;
  if (!current() || (expectedCopyVersion === 2 && !editor.matches('.family-dialogue-editor'))) return false;
  const buttons = expectedCopyVersion === 2 ? [...editor.querySelectorAll('.family-page-strip > button')] : [];
  const layouts = buttons.map(button => button.querySelector('.family-page-layout'));
  const layoutsCurrent = () => {
    if (expectedCopyVersion !== 2) return true;
    const currentButtons = [...editor.querySelectorAll('.family-page-strip > button')];
    return buttons.length === 8 && currentButtons.length === 8 && layouts.every((layout, index) =>
      currentButtons[index] === buttons[index] && layout?.isConnected && buttons[index].querySelector('.family-page-layout') === layout
        && !buttons[index].querySelector('img'));
  };
  if (!layoutsCurrent()) return false;
  const source = image.currentSrc || image.src;
  try { await image.decode(); } catch { return false; }
  return document.querySelector('.card-copy-editor') === editor && current() && layoutsCurrent() && (image.currentSrc || image.src) === source;
}
async function previewReady(page, deadline) {
  // Observe the current image, rather than retain a decode() promise for a blob
  // that a newer preview can replace/revoke while its response is settling.
  await page.waitForFunction(async () => {
    const image = document.querySelector('.card-copy-editor .card-copy-preview:not(.is-stale)[aria-busy="false"] img');
    if (!image?.complete || image.naturalWidth !== 1080 || image.naturalHeight !== 1350) return false;
    const source = image.currentSrc || image.src;
    try { await image.decode(); } catch { return false; }
    return image === document.querySelector('.card-copy-editor .card-copy-preview:not(.is-stale)[aria-busy="false"] img')
      && (image.currentSrc || image.src) === source && image.complete && image.naturalWidth === 1080 && image.naturalHeight === 1350;
  }, undefined, deadline === undefined ? {} : { timeout: settlementRemaining(deadline) });
}
async function settleEditorPreviews(page, lifecycle) {
  const deadline = Date.now() + 20_000;
  const expectedCopyVersion = lifecycle.expectedCopyVersion;
  if (expectedCopyVersion === 2) await page.locator('.family-dialogue-editor').waitFor({ state: 'visible', timeout: settlementRemaining(deadline) });
  await previewReady(page, deadline);
  const familyCount = await page.locator('.family-dialogue-editor').count();
  lifecycle.diagnostics.push({ kind: 'family-layout-guard', stage: lifecycle.stage, at: Date.now(), expectedCopyVersion, familyCount, pendingPreviewRoutes: [...lifecycle.previewRoutes] });
  await lifecycle.inspect('after-layout-guard');
  if (expectedCopyVersion === 2) {
    // Navigation now shows eight code-native layout diagrams. Real selected
    // page pixels are verified above; all eight are visited explicitly below.
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll('.family-dialogue-editor .family-page-strip > button')];
      return buttons.length === 8 && buttons.every(button => {
        return !!button.querySelector('.family-page-layout') && !button.querySelector('img');
      });
    }, undefined, { timeout: settlementRemaining(deadline) });
  }
  await page.waitForLoadState('networkidle', { timeout: settlementRemaining(deadline) });
  while (true) {
    await lifecycle.api.waitForEmpty(deadline);
    await page.waitForFunction(currentEditorImagesReady, expectedCopyVersion, { timeout: settlementRemaining(deadline) });
    if (!lifecycle.api.empty() || !await lifecycle.api.waitForQuiet(deadline)) continue;
    const generation = lifecycle.api.generation;
    await page.waitForFunction(currentEditorImagesReady, expectedCopyVersion, { timeout: settlementRemaining(deadline) });
    if (!lifecycle.api.empty() || generation !== lifecycle.api.generation) continue;
    // Diagnostic reads cross the process boundary too. Recheck current images
    // afterwards, so a late React commit cannot turn a ready snapshot stale.
    const dom = await lifecycle.inspect('candidate-preview-boundary');
    await page.waitForFunction(currentEditorImagesReady, expectedCopyVersion, { timeout: settlementRemaining(deadline) });
    if (!lifecycle.api.empty() || generation !== lifecycle.api.generation) continue;
    settlementRemaining(deadline);
    assert.equal(lifecycle.previewRoutes.size, 0, 'controlled navigation must wait for all preview fixture producers');
    lifecycle.diagnostics.push({ kind: 'previews-settled', at: Date.now(), url: page.url(), pendingPreviewRoutes: lifecycle.previewRoutes.size, quietWindowMs: 500, expectedCopyVersion, currentReady: true, dom, generation, settlementElapsedMs: Date.now() - (deadline - 20_000), ...lifecycle.api.snapshot() });
    return;
  }
}
async function verifyAllEightCurrentPageRenders(page, lifecycle, width) {
  const editor = page.locator('.family-dialogue-editor'), buttons = editor.locator('.family-page-strip > button');
  assert.equal(await buttons.count(), 8);
  const picker = editor.getByLabel('전체 목록에서 선택', { exact: true });
  const designArea = editor.locator('details.family-whole-design');
  assert.equal(await designArea.count(), 1, 'one whole-deck design area must follow the page layout navigation');
  assert.equal(await editor.getByLabel('카드뉴스 스타일', { exact: true }).count(), 0, 'the duplicate style selector must be removed');
  assert(await designArea.evaluate(node => !!(node.closest('.family-dialogue-editor').querySelector('.family-page-strip').compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), 'design selection must follow the page layout diagrams');
  const selected = await buttons.evaluateAll(nodes => nodes.findIndex(node => node.getAttribute('aria-current') === 'step'));
  for (let index = 0; index < 8; index++) {
    await buttons.nth(index).click();
    await page.waitForFunction(pageNumber => document.querySelector('.family-dialogue-editor .card-copy-fields h4')?.textContent?.trim().startsWith(`${pageNumber}페이지 ·`), index + 1);
    await settleEditorPreviews(page, lifecycle);
    assert.match(await page.locator('.family-dialogue-editor .card-copy-preview img').getAttribute('alt'), new RegExp(`^${index + 1}페이지 `));
    lifecycle.diagnostics.push({ kind: 'actual-page-render-verified', width, page: index + 1, dimensions: [1080, 1350] });
  }
  await buttons.nth(selected < 0 ? 0 : selected).click();
  await settleEditorPreviews(page, lifecycle);
}
async function reloadEditor(page, lifecycle, label) {
  lifecycle.mark(`${label}: settling previews`); await settleEditorPreviews(page, lifecycle);
  lifecycle.mark(`${label}: reload`); await page.reload(); await previewReady(page);
  await settleEditorPreviews(page, lifecycle); lifecycle.mark(`${label}: ready`); await lifecycle.inspect('reload-ready');
}
async function saveCopy(page) {
  await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === "PATCH" && response.ok()), saveButton(page).click()]);
  await page.waitForFunction(() => [...document.querySelectorAll('.card-copy-savebar button')].some(button => button.textContent === '문구 저장' && button.disabled));
}
async function layoutFits(page, label) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, fields: [...document.querySelectorAll('.card-copy-fields textarea,.card-copy-fields input:not([type="file"])')].map(node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; }) }));
  assert(size.scroll <= size.width + 1, `${label}: horizontal overflow ${JSON.stringify(size)}`);
  for (const field of size.fields.filter(field => field.width > 0)) assert(field.x >= 0 && field.right <= size.width + 1, `${label}: field outside the viewport`);
  for (const button of await page.locator('.card-copy-savebar button').all()) {
    await button.evaluate(node => node.scrollIntoView({ block: 'center' }));
    assert(await button.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), `${label}: save or render button is obscured`);
  }
}
async function openBackground(page) {
  const editor = page.locator('.page-background-editor');
  if (!await editor.evaluate(node => node.open)) await editor.locator('summary').click();
  return editor;
}
async function pasteBackground(page) {
  await page.locator('.page-background-upload').evaluate((node, base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([bytes], 'pasted-fixture.png', { type: 'image/png' }));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, pasteImage.toString('base64'));
}

async function activateConfirmation(page, label, width) {
  // Protocol visibility excludes neither the fixed workspace header nor the
  // saved-action bar. Use a normal centred scroll before checking the real hit.
  await label.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  const geometry = await label.evaluate(node => {
    const r = node.getBoundingClientRect(), checkbox = node.querySelector('input').getBoundingClientRect();
    const point = { x: r.right - 6, y: r.y + Math.min(r.height / 2, 24) }, hit = document.elementFromPoint(point.x, point.y);
    return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, point, reachable: !!hit && node.contains(hit), outsideCheckbox: point.x > checkbox.right,
      hit: hit ? { tag: hit.tagName, className: String(hit.className), text: hit.textContent?.slice(0, 90) } : null,
      viewport: { width: innerWidth, height: innerHeight }, checkbox: { left: checkbox.left, right: checkbox.right, top: checkbox.top, bottom: checkbox.bottom } };
  });
  if (width <= 900) assert(geometry.width >= 48 && geometry.height >= 48, 'Canva confirmation must have a 48px touch label');
  assert(geometry.reachable && geometry.outsideCheckbox, `Canva label padding must activate its native checkbox: ${JSON.stringify(geometry)}`);
  if (width < 768) await page.touchscreen.tap(geometry.point.x, geometry.point.y); else await page.mouse.click(geometry.point.x, geometry.point.y);
  assert.equal(await label.locator('input').isChecked(), true);
}

async function manualCanvaImport(page, state, width, lifecycle) {
  // A fresh document observes the independently advertised no-Autofill account.
  // All job and image responses remain synthetic; this tests the built UI only.
  state.canvaJobs = []; state.canvaLibrary.autofill = false;
  state.canvaLibrary.items = state.canvaLibrary.items.map(item => ({ ...item, status: 'needs_fields', canCreate: false,
    reason: '현재 연결한 Canva 계정·팀에는 자동 채우기 기능이 없습니다.' }));
  await reloadEditor(page, lifecycle, 'manual Canva account capability');
  const editorial = page.locator('.canva-editorial'), manual = editorial.getByRole('form', { name: 'Canva 사본 8장 가져오기' }); await manual.waitFor();
  const before = clone(state.saved), writesBefore = state.writes.length;
  const manualDetails = editorial.locator('.canva-manual-import');
  assert.equal(await manualDetails.count(), 1, 'there must be only one manual request form');
  assert(await manualDetails.evaluate(node => !!(node.compareDocumentPosition(node.parentElement.querySelector('.canva-library-entry')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'manual import must precede the large folder preview');
  const automatic = editorial.locator('details.canva-automatic-tools');
  assert.equal(await automatic.evaluate(node => node.open), false, 'unavailable automatic production must not dominate the manual account path');
  const library = editorial.locator('details.canva-library-entry');
  assert.equal(await library.evaluate(node => node.open), true, 'a connected manual account can browse its source templates directly');
  assert.equal(await library.evaluate(node => !!node.closest('.canva-automatic-tools')), false, 'shared template browsing must remain outside automatic-only settings');
  await automatic.locator(':scope > summary').click();
  assert.equal(await editorial.getByRole('button', { name: 'Canva 8장 만들기', exact: true }).isDisabled(), true);
  await manual.getByRole('textbox', { name: '가져올 Canva 사본 링크 또는 ID' }).fill('Dmanual_browser_copy');
  await activateConfirmation(page, manual.locator('label.canva-manual-confirm').nth(0), width);
  await manualDetails.locator(':scope > summary').click();
  await editorial.getByRole('button', { name: '직접 편집한 사본 가져오기', exact: true }).click();
  await manual.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '가져올 Canva 사본 링크 또는 ID');
  assert.equal(await manual.getByRole('textbox', { name: '가져올 Canva 사본 링크 또는 ID' }).inputValue(), 'Dmanual_browser_copy');
  assert.equal(await manual.locator('label.canva-manual-confirm').nth(0).locator('input').isChecked(), true, 'opening the entry must preserve existing acknowledgement state');
  assert.equal(state.writes.slice(writesBefore).filter(write => !write.path.endsWith('/preview')).length, 0, 'the capability action opens the form without submitting a job');
  const manualSource = state.canvaLibrary.items[1];
  await manualDetails.locator(':scope > summary').click();
  await library.getByRole('button', { name: `${manualSource.title} 미리보기`, exact: true }).click();
  const innerPage = library.locator('.canva-library-pages button').nth(1);
  await innerPage.scrollIntoViewIfNeeded();
  const innerPageBounds = await innerPage.boundingBox();
  if (width <= 900) assert(innerPageBounds.width >= 48 && innerPageBounds.height >= 48, 'Canva inner-page browsing needs a 48px touch target');
  if (width < 768) await page.touchscreen.tap(innerPageBounds.x + innerPageBounds.width / 2, innerPageBounds.y + innerPageBounds.height / 2);
  else await innerPage.click();
  assert.equal(await innerPage.getAttribute('aria-pressed'), 'true');
  assert.equal(await library.getByRole('button', { name: '자동 채우기로 선택', exact: true }).count(), 0, 'a manual-only account must not be presented a disabled automatic template choice');
  const chooseManual = library.getByRole('button', { name: '직접 편집용으로 선택', exact: true });
  assert.equal(await chooseManual.isEnabled(), true, 'no-Autofill and needs_fields must still allow direct-edit reference selection');
  await chooseManual.scrollIntoViewIfNeeded();
  if (width <= 900) { const target = await chooseManual.boundingBox(); assert(target.width >= 48 && target.height >= 48); }
  await chooseManual.click();
  await manual.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '가져올 Canva 사본 링크 또는 ID');
  assert.equal(await manual.getByRole('textbox', { name: '가져올 Canva 사본 링크 또는 ID' }).inputValue(), 'Dmanual_browser_copy');
  assert.equal(await manual.locator('label.canva-manual-confirm').nth(0).locator('input').isChecked(), true, 'manual template selection must preserve current copy acknowledgement');
  assert((await editorial.locator('[data-testid="canva-manual-template-selection"]').innerText()).includes(manualSource.title));
  assert.equal(state.writes.slice(writesBefore).filter(write => !write.path.endsWith('/preview')).length, 0, 'reference selection cannot create, edit, export or save a design');
  assert.deepEqual(state.saved, before);
  await page.screenshot({ path: `${outputDir}/canva-manual-entry-${width}.png` });
  const input = manual.getByRole('textbox', { name: '가져올 Canva 사본 링크 또는 ID' }), submit = manual.getByRole('button', { name: '이 사본의 8장 가져오기', exact: true });
  await input.fill(manualSource.designId); assert.equal(await submit.isDisabled(), true, 'the selected reference original can never be imported as a copy');
  await input.fill('https://www.canva.com.attacker.example/design/Dmanual_browser_copy/edit'); assert.equal(await submit.isDisabled(), true);
  await input.fill('https://www.canva.com/design/Dmanual_browser_copy/edit?utm_content=private-share-query');
  const confirmations = manual.locator('label.canva-manual-confirm'); await activateConfirmation(page, confirmations.nth(0), width);
  assert.equal(await submit.isDisabled(), true); await activateConfirmation(page, confirmations.nth(1), width);
  await submit.scrollIntoViewIfNeeded(); if (width <= 900) assert((await submit.boundingBox()).height >= 48, 'manual import button must be 48px high');
  await submit.click(); await editorial.getByText('완성된 디자인 확인 중', { exact: true }).waitFor();
  assert.equal(state.writes.filter(write => write.path === `${itemPath}/canva/manual-imports`).length, 1);
  assert.deepEqual(state.saved, before, 'import enqueue cannot change the manuscript or version');
  const queued = state.canvaJobs[0];
  state.canvaJobs = [{ ...queued, status: 'needs_review', phase: 'complete', exportJobId: 'fixture-manual-export', outputAssetId: 9900, outputRevisionId: before.revisionId + 1,
    result: { ...queued.result, pages: Array.from({ length: 8 }, (_, index) => ({ id: 9900 + index, sha256: 'b'.repeat(64), title: `직접 편집한 사본 ${index + 1}` })), originals: Array.from({ length: 8 }, (_, index) => ({ id: 10000 + index, sha256: 'c'.repeat(64), page: index + 1 })) } }];
  await editorial.getByText('직접 편집한 Canva 사본에서 가져온 8장입니다.', { exact: false }).waitFor();
  const images = editorial.locator('.canva-export-grid img'); assert.equal(await images.count(), 8);
  await images.evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
  for (const dimensions of await images.evaluateAll(nodes => nodes.map(node => [node.naturalWidth, node.naturalHeight]))) assert.deepEqual(dimensions, [1080, 1350]);
  await editorial.getByText('이미지 8 / 8장 불러옴', { exact: true }).waitFor();
  await reloadEditor(page, lifecycle, 'manual Canva existing review reopen');
  await editorial.getByText('이미지 8 / 8장 불러옴', { exact: true }).waitFor();
  await images.evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
  assert.equal(await submit.isDisabled(), true, 'an existing current-manuscript review must block a new import after reopening');
  const reviewSummary = editorial.locator('summary').filter({ hasText: '실제 Canva 출력 8장' });
  assert.match(await reviewSummary.innerText(), /검토·저장 필요/);
  const reviewDetails = reviewSummary.locator('..');
  await reviewSummary.click();
  assert.equal(await reviewDetails.evaluate(node => node.open), false);
  const resumeReview = manual.getByRole('button', { name: '가져온 8장 검토·저장', exact: true });
  await resumeReview.scrollIntoViewIfNeeded();
  if (width <= 900) assert((await resumeReview.boundingBox()).height >= 48, 'the existing-review action must be 48px high');
  const writesBeforeReview = state.writes.filter(write => !write.path.endsWith('/preview')).length;
  await resumeReview.click();
  await page.waitForFunction(() => document.activeElement?.tagName === 'SUMMARY' && document.activeElement.textContent?.includes('실제 Canva 출력 8장'));
  assert.equal(await reviewDetails.evaluate(node => node.open), true);
  assert.equal(state.writes.filter(write => !write.path.endsWith('/preview')).length, writesBeforeReview, 'review navigation must not enqueue, accept or modify anything');
  assert.equal(state.writes.filter(write => write.path === `${itemPath}/canva/manual-imports`).length, 1);
  assert.equal(state.writes.filter(write => write.path === `${itemPath}/canva/jobs/902/accept`).length, 0);
  assert.deepEqual(state.saved, before, 'reopening and finding an existing review must preserve the manuscript');
  const accept = editorial.getByRole('button', { name: '확인한 8장을 새 버전으로 저장', exact: true }); assert.equal(await accept.isDisabled(), true);
  const review = editorial.locator('label.check').filter({ hasText: '8장의 모든 문구가 현재 스튜디오 원고와 같은지 확인했습니다.' });
  assert.equal(await review.locator('input').isChecked(), false, 'review navigation never supplies the final text confirmation');
  await activateConfirmation(page, review, width); await accept.scrollIntoViewIfNeeded();
  await layoutFits(page, `manual Canva import ${width}`);
  await manual.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${outputDir}/canva-manual-form-${width}.png` });
  await review.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${outputDir}/canva-manual-review-${width}.png` });
  await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${itemPath}/canva/jobs/902/accept` && response.ok()), accept.click()]);
  assert.equal(state.saved.version, before.version + 1); assert.equal(state.saved.revisionId, before.revisionId + 1); assert.deepEqual(state.saved.copy, before.copy);
  // The response can arrive before the invalidated editor query adopts it.
  // Do not mistake the preceding version's ready image for accepted output.
  await page.waitForFunction(version => document.querySelector('.family-dialogue-editor .card-copy-heading .badge')?.textContent?.trim() === `저장됨 · 버전 ${version}`, state.saved.version);
  await editorial.getByText('이미지 8 / 8장 불러옴', { exact: true }).waitFor({ state: 'attached' });
  assert.deepEqual(state.writes.slice(writesBefore).filter(write => !write.path.endsWith('/preview')).map(write => write.path), [`${itemPath}/canva/manual-imports`, `${itemPath}/canva/jobs/902/accept`], 'manual UI must enqueue and explicitly accept only, without creating, editing or uploading a Canva design');
  await settleEditorPreviews(page, lifecycle);
}

let browser, engine = "WebKit";
const results = [];
try {
  try { browser = await playwright.webkit.launch(); }
  catch (error) {
    if (process.env.CI) throw error; // The CI gate promises actual WebKit, not an invisible fallback.
    engine = "Chromium"; console.log(`WebKit unavailable locally; using Chromium: ${String(error.message).split('\n')[0]}`);
    browser = await playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE, args: ['--no-zygote', '--disable-dev-shm-usage'] } : {}) });
  }
  const widths = process.env.NEWS_EDITORIAL_WIDTHS ? process.env.NEWS_EDITORIAL_WIDTHS.split(',').map(Number) : [320, 393, 1280];
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
    context.setDefaultTimeout(20_000); await context.addInitScript(() => localStorage.setItem('spacepenguin.channel', '3'));
    const page = await context.newPage(), { state, api } = fixture(), errors = [], external = [], requestFailures = [], diagnostics = [];
    let stage = 'news-editorial';
    const lifecycle = { api: createApiLifecycle(diagnostics, () => stage), previewRoutes: new Set(), diagnostics, get stage() { return stage; }, get expectedCopyVersion() { return state.saved.copy.version; }, mark: value => { stage = value; diagnostics.push({ kind: 'stage', stage, at: Date.now() }); },
      inspect: async label => {
        const requestedAt = Date.now(), pendingAtRequest = [...lifecycle.previewRoutes];
        const dom = await page.evaluate(() => window.__familySelectionSnapshot?.() ?? { url: location.href, diagnosticSnapshotUnavailable: true }).catch(error => ({ diagnosticError: String(error.message) }));
        diagnostics.push({ kind: 'editor-readiness-snapshot', label, stage, at: Date.now(), requestedAt, expectedVersion: state.saved.version, expectedCopyVersion: state.saved.copy.version, expectedRevision: state.saved.revisionId, pendingAtRequest, pendingAtReceipt: [...lifecycle.previewRoutes], dom });
        return dom;
      },
    };
    await page.exposeBinding('__recordFamilySelection', (_source, event) => { diagnostics.push({ kind: 'family-dom', stage, at: Date.now(), ...event }); });
    await page.exposeBinding('__editorReadinessChanged', () => lifecycle.api.domChanged());
    await page.addInitScript(() => {
      const withinEditor = node => node instanceof Element && (node.matches('.card-copy-editor') || !!node.closest('.card-copy-editor') || !!node.querySelector('.card-copy-editor'));
      const changed = () => {
        // This notification only invalidates the harness's quiet window. A
        // closing document can cancel the bridge, never a product error.
        void window.__editorReadinessChanged().catch(() => {});
      };
      new MutationObserver(records => {
        if (records.some(record => withinEditor(record.target) || [...record.addedNodes, ...record.removedNodes].some(withinEditor))) changed();
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'aria-busy'] });
      for (const event of ['load', 'error']) document.addEventListener(event, value => {
        if (value.target instanceof HTMLImageElement && value.target.closest('.card-copy-editor')) changed();
      }, { capture: true, passive: true });
    });
    await page.addInitScript(() => {
      const documentId = crypto.randomUUID(), identities = new WeakMap(); let nextId = 1, lastState = '', count = 0;
      const identity = node => { if (!node) return null; if (!identities.has(node)) identities.set(node, nextId++); return identities.get(node); };
      const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const describe = node => node instanceof Element ? { nodeId: identity(node), tag: node.tagName, id: node.id, className: String(node.className), label: node.getAttribute('aria-label'), text: node.textContent?.slice(0, 100), connected: node.isConnected, rect: rect(node) } : null;
      const snapshot = () => {
        const editor = document.querySelector('.family-dialogue-editor'), strip = editor?.querySelector('.family-page-strip');
        const page5 = strip?.querySelector('button[aria-label="5페이지 · 두 가지 시선"]'), field = editor?.querySelector('textarea[id$="-fields.viewA.body"]');
        const layouts = [...(strip?.querySelectorAll('.family-page-layout') ?? [])], image = document.querySelector('.card-copy-editor .card-copy-preview img');
        return { documentId, browserAt: Date.now(), url: location.href, readyState: document.readyState, editorId: identity(editor), editorConnected: !!editor?.isConnected,
          familyCount: document.querySelectorAll('.family-dialogue-editor').length, copyEditorCount: document.querySelectorAll('.card-copy-editor').length, savedBadge: editor?.querySelector('.card-copy-heading .badge')?.textContent ?? null,
          layoutDiagramCount: layouts.length, navigationImageCount: strip?.querySelectorAll('img').length ?? 0,
          selectedPreview: image ? { nodeId: identity(image), src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, stale: !!image.closest('.is-stale'), busy: image.closest('[aria-busy]')?.getAttribute('aria-busy') } : null,
          selected: strip?.querySelector('[aria-current="step"]')?.getAttribute('aria-label') ?? null,
          heading: editor?.querySelector('.card-copy-fields h4')?.textContent ?? null, scrollX, scrollY, scrollLeft: strip?.scrollLeft ?? null, stripRect: rect(strip), page5: describe(page5), viewA: field ? { nodeId: identity(field), id: field.id, connected: field.isConnected, rect: rect(field) } : null };
      };
      window.__familySelectionSnapshot = snapshot;
      const record = (eventType, detail = {}) => {
        if (++count > 2000) return;
        const event = { eventType, browserAt: Date.now(), ...snapshot(), ...detail };
        // A document may close while this diagnostic-only bridge is in flight.
        // Product event handlers and their errors are never intercepted.
        void window.__recordFamilySelection(event).catch(() => {});
      };
      for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'focusin']) document.addEventListener(name, event => {
        if (!document.querySelector('.family-dialogue-editor')) return;
        const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : event.changedTouches?.[0] ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY } : null;
        record(name, { target: describe(event.target), button: describe(event.target instanceof Element ? event.target.closest('button') : null), eventPath: event.composedPath().slice(0, 8).map(describe).filter(Boolean), point, hit: point ? describe(document.elementFromPoint(point.x, point.y)) : null, trusted: event.isTrusted });
      }, { capture: true, passive: true });
      document.addEventListener('scroll', event => { if (event.target instanceof Element && event.target.matches('.family-page-strip')) record('strip-scroll'); }, { capture: true, passive: true });
      new MutationObserver(() => {
        const state = snapshot(), signature = JSON.stringify({ editorId: state.editorId, selected: state.selected, heading: state.heading, page5Id: state.page5?.nodeId, viewAId: state.viewA?.nodeId });
        if (signature !== lastState) { lastState = signature; record('selection-or-mount-mutation'); }
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    });
    const isLocalApi = request => { const url = new URL(request.url()); return url.origin === origin && url.pathname.startsWith('/api/'); };
    page.on('request', request => { if (isLocalApi(request)) lifecycle.api.startRequest(request); });
    page.on('requestfinished', request => lifecycle.api.finishRequest(request));
    page.on('requestfailed', request => lifecycle.api.finishRequest(request, request.failure()?.errorText ?? 'unknown'));
    page.on('pageerror', error => { errors.push(error.message); diagnostics.push({ kind: 'pageerror', stage, at: Date.now(), url: page.url(), message: error.message, stack: error.stack }); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) diagnostics.push({ kind: 'document-navigation', stage, at: Date.now(), url: frame.url() }); });
    page.on('requestfailed', request => requestFailures.push({ stage, at: Date.now(), method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText ?? 'unknown' }));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort('blockedbyclient'); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const producerRequest = route.request(); lifecycle.api.startProducer(producerRequest);
      const preview = url.pathname === `${copyPath}/preview` ? { stage, at: Date.now(), page: route.request().postDataJSON()?.page, version: route.request().postDataJSON()?.version } : null;
      if (preview) { lifecycle.previewRoutes.add(preview); diagnostics.push({ kind: 'preview-fixture-start', ...preview }); }
      try {
        if (await api(route, url) !== false) return;
        errors.push(`Unmocked API: ${route.request().method()} ${url.pathname}`);
        await route.fulfill({ status: 404, json: { error: 'Isolated API only' } });
      } catch (error) {
        errors.push(`Fixture rejected ${url.pathname}: ${error.message}`);
        await route.fulfill({ status: 500, json: { error: 'Synthetic fixture rejected request' } });
      } finally {
        lifecycle.api.finishProducer(producerRequest);
        if (preview) { lifecycle.previewRoutes.delete(preview); diagnostics.push({ kind: 'preview-fixture-settled', stage, at: Date.now(), page: preview.page, version: preview.version, pendingPreviewRoutes: lifecycle.previewRoutes.size }); }
      }
    });
    let scenarioError = null;
    try {
      await page.goto(`${origin}/studio/2828`); await title(page).waitFor(); await previewReady(page);
      assert.equal(await pageButtons(page).count(), 5); assert.equal(state.writes.filter(write => !write.path.endsWith('/preview')).length, 0);
      // The three crop views reuse the same real cover and do not save, publish,
      // regenerate or modify its pixels. Check actual CSS geometry on mobile too.
      const cropPreview = page.locator('.card-copy-editor .cover-crop-preview').first();
      const originalSource = await cropPreview.locator('img').getAttribute('src');
      const writesBeforeCrop = state.writes.length;
      for (const [label, expectedRatio] of [['정방형 1:1', 1], ['프로필 3:4', .75], ['전체 4:5', .8]]) {
        await cropPreview.getByRole('button', {name:label,exact:true}).click();
        const frame = await cropPreview.locator('figure').boundingBox();
        assert(frame && Math.abs(frame.width / frame.height - expectedRatio) < .01, `${label} must use real crop geometry`);
        assert.equal(await cropPreview.locator('img').getAttribute('src'), originalSource);
        assert.equal(await cropPreview.locator('img').evaluate(image => getComputedStyle(image).objectFit), 'cover');
      }
      await cropPreview.getByLabel('안전영역 표시', {exact:true}).check();
      assert.equal(await cropPreview.locator('.cover-crop-guide').count(), 1);
      await layoutFits(page, `cover crop ${width}`);
      await cropPreview.screenshot({path:`${outputDir}/cover-crop-${width}.png`});
      await cropPreview.getByLabel('안전영역 표시', {exact:true}).uncheck();
      assert.equal(state.writes.length, writesBeforeCrop, 'crop controls must not mutate content or call AI');
      const sourceModels = await page.locator('[data-testid="source-role-models"]').textContent();
      for (const selection of Object.values(roles)) assert(sourceModels?.includes(selection.model), `source editor must use the channel's resolved ${selection.model} model`);
      await page.locator('details.card-copy-legacy-tools > summary').click();
      assert.match(await page.locator('.card-copy-legacy-tools .card-copy-story-action').innerText(), /기사 요약 Gemini · 문구 GPT/);
      const original = clone(state.saved.copy), rebuild = page.getByRole('button', { name: '8장 뉴스 대화로 다시 구성', exact: true });
      await rebuild.click(); await page.getByText(/합성 503 응답/).waitFor();
      assert.equal(await title(page).inputValue(), original.cover.title); assert.deepEqual(state.saved.copy, original); assert.equal(await pageButtons(page).count(), 5);
      await rebuild.click(); await page.locator('.card-copy-proposal').waitFor();
      assert.equal(state.aiAttempts, 2); assert.deepEqual(state.saved.copy, original, 'receiving the eight-page proposal must not replace the accepted copy');
      assert.equal(await pageButtons(page).count(), 5); assert.equal(await title(page).inputValue(), original.cover.title);
      await page.getByRole('button', { name: '8장 제안을 편집기에 적용', exact: true }).click();
      assert.equal(await pageButtons(page).count(), 8); assert.deepEqual(state.saved.copy, original, 'applying a proposal is still an unsaved edit');
      await saveCopy(page); assert.equal(state.saved.copy.storyFormat, 'discussion8'); assert.equal(state.saved.copy.pages.length, 7);
      await page.getByRole('button', { name: '5페이지 두 가지 시선 문구 편집', exact: true }).click();
      const first = page.locator('textarea[id$="-column-0-body"]'), second = page.locator('textarea[id$="-column-1-body"]');
      const otherColumn = await second.inputValue(), changed = '정확한 답뿐 아니라 답을 고른 이유도 함께 살펴봐요. 내가 중요하게 생각한 근거를 한 문장으로 적어 봅니다.';
      await first.fill(changed); await previewReady(page); await layoutFits(page, `comparison ${width}`);
      await page.screenshot({ path: `${outputDir}/comparison-${width}.png` }); await saveCopy(page);
      assert.equal(state.saved.copy.pages[3].columns[0].body, changed); assert.equal(state.saved.copy.pages[3].columns[1].body, otherColumn);
      await reloadEditor(page, lifecycle, 'legacy comparison reopen'); await title(page).waitFor(); await page.getByRole('button', { name: '5페이지 두 가지 시선 문구 편집', exact: true }).click();
      assert.equal(await first.inputValue(), changed); assert.equal(await second.inputValue(), otherColumn); assert.equal(await pageButtons(page).count(), 8);

      // Upload one page, paste another. Both results remain local choices until copy save.
      let backgroundEditor = await openBackground(page), beforeUpload = clone(state.saved.copy);
      await backgroundEditor.getByLabel('페이지 배경 이미지 파일').setInputFiles({ name: 'uploaded-fixture.png', mimeType: 'image/png', buffer: uploadImage });
      await backgroundEditor.getByAltText('선택한 페이지 배경').waitFor();
      assert.deepEqual(state.saved.copy, beforeUpload, 'upload must not silently replace saved page metadata');
      await saveCopy(page); assert.equal(state.saved.copy.pages[3].background.assetId, 9000);
      for (const index of [0, 1, 2, 4, 5, 6]) assert.deepEqual(state.saved.copy.pages[index], beforeUpload.pages[index]);
      await page.getByRole('button', { name: '6페이지 나만의 개념 정의 문구 편집', exact: true }).click();
      backgroundEditor = await openBackground(page); await pasteBackground(page);
      await backgroundEditor.getByAltText('선택한 페이지 배경').waitFor(); await saveCopy(page);
      assert.equal(state.saved.copy.pages[4].background.assetId, 9001); assert.equal(state.saved.copy.pages[3].background.assetId, 9000);
      await previewReady(page); await layoutFits(page, `page background ${width}`);
      await page.screenshot({ path: `${outputDir}/background-${width}.png` });
      await reloadEditor(page, lifecycle, 'legacy page backgrounds reopen'); await title(page).waitFor();
      for (const index of [4, 5]) {
        await pageButtons(page).nth(index).click(); await openBackground(page); await page.locator('.page-background-thumb').waitFor();
        assert.match(await page.locator('.page-background-thumb').getAttribute('src'), new RegExp(`/background/${index === 4 ? 9000 : 9001}$`));
      }
      // Each page has its own complete, real rendered result including the closing.
      for (let index = 0; index < 8; index++) { await pageButtons(page).nth(index).click(); await previewReady(page); }
      assert.match(await page.locator('.card-copy-preview-column').innerText(), /닫는 표지/);
      const coverOptions = page.locator('details.content-options').filter({ has: page.locator('summary', { hasText: '표지·이미지 설정' }) }).first();
      await coverOptions.locator('summary').click(); await coverOptions.locator('select').selectOption('reuse');
      const [renderResponse] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${itemPath}/card` && response.request().method() === 'POST' && response.ok()), page.locator('.card-copy-savebar').getByRole('button', { name: '이미지 생성·갱신', exact: true }).click()]);
      const rendered = await renderResponse.json();
      assert.equal(rendered.carousel.pages.length, 8); assert.equal(state.cards[0].id, rendered.id);
      const final = page.locator('.card-carousel');
      // A render response starts a separate item refresh. Wait for that new
      // artifact's identity even while the publication details are still closed.
      await final.locator(`.card-carousel-stage img[src="/api/channels/3/media/${rendered.carousel.pages[0].id}"]`).waitFor({ state: 'attached' });
      await page.getByRole('button', { name: '이미지 확인 · 게시 준비 열기', exact: true }).click();
      // AltTextEditor has its own eight-page selector. Count the rendered
      // carousel's navigation rather than combining two independent controls.
      const finalPageButtons = final.locator('.card-carousel-controls > .page-dots > button');
      await final.waitFor(); assert.equal(await finalPageButtons.count(), 8);
      await finalPageButtons.nth(4).click();
      const finalImage = final.locator(`.card-carousel-stage img[src="/api/channels/3/media/${rendered.carousel.pages[4].id}"]`);
      await finalImage.waitFor(); await finalImage.evaluate(img => img.decode());
      assert.deepEqual(await finalImage.evaluate(img => [img.naturalWidth, img.naturalHeight]), [1080, 1350]);
      await finalImage.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${outputDir}/final-${width}.png` });
      assert.equal(state.writes.filter(write => write.path.endsWith('/background')).length, 2);
      assert.equal(state.writes.filter(write => /\/(approve|publish|deliveries)(\/|$)/.test(write.path)).length, 0);
      // A v2 conversion has a different schema and must be explicit. The old
      // deck and its final assets remain intact until this save succeeds.
      await page.getByRole('button', { name: '새 8장 형식 자동 제안', exact: true }).click();
      const convert = page.getByRole('button', { name: '새 8장 원고로 저장·전환', exact: true }); await convert.waitFor();
      assert.equal(state.saved.copy.version, 1);
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === 'PATCH' && response.ok()), convert.click()]);
      const family = page.locator('.family-dialogue-editor'); await family.waitFor();
      assert.equal(state.saved.copy.version, 2); assert.equal(await family.locator('.family-page-strip>button').count(), 8);
      const beforeLayoutTour = clone(state.saved), beforeLayoutWrites = state.writes.length;
      await verifyAllEightCurrentPageRenders(page, lifecycle, width);
      assert.deepEqual(state.saved, beforeLayoutTour, 'layout navigation must not change the saved manuscript');
      assert.equal(state.writes.slice(beforeLayoutWrites).filter(write => !write.path.endsWith('/preview')).length, 0, 'visiting all eight real page previews must not save or generate content');
      await family.locator('.family-page-strip').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outputDir}/page-layout-and-design-${width}.png` });
      await family.getByRole('button', { name: '5페이지 · 두 가지 시선', exact: true }).click();
      const viewA = family.locator('textarea[id$="-fields.viewA.body"]');
      await viewA.fill('내가 덧붙인 판단 기준도 저장하고 다시 확인할 수 있어요.');
      const familySave = family.getByRole('button', { name: '문구·디자인 저장', exact: true });
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === 'PATCH' && response.ok()), familySave.click()]);
      await family.locator('.card-copy-heading .badge', { hasText: '저장됨' }).waitFor();
      assert.equal(state.saved.copy.pages[4].fields.viewA.body, '내가 덧붙인 판단 기준도 저장하고 다시 확인할 수 있어요.');
      assert.equal(state.saved.copy.pages[4].layout, 'stacked');
      await reloadEditor(page, lifecycle, 'family comparison reopen'); await family.waitFor(); lifecycle.mark('family comparison reopen: before page5 click'); await family.getByRole('button', { name: '5페이지 · 두 가지 시선', exact: true }).click(); lifecycle.mark('family comparison reopen: page5 click completed');
      assert.equal(await viewA.inputValue(), '내가 덧붙인 판단 기준도 저장하고 다시 확인할 수 있어요.');
      await previewReady(page); await layoutFits(page, `v2 views ${width}`);
      await page.screenshot({ path: `${outputDir}/v2-perspectives-${width}.png` });
      await family.getByRole('button', { name: '6페이지 · 개념 다듬기', exact: true }).click();
      const conceptMode = family.getByLabel('개념을 다루는 방식', { exact: false });
      const originalDefinition = await family.locator('textarea[id$="-fields.definitionA"]').inputValue();
      await conceptMode.selectOption('scientific_explanation');
      assert.equal(await family.locator('textarea[id$="-fields.acceptedDefinition"]').inputValue(), '');
      assert.equal(await familySave.isDisabled(), true, 'changing concept mode must not invent a scientific definition');
      await conceptMode.selectOption('value_definition');
      assert.equal(await family.locator('textarea[id$="-fields.definitionA"]').inputValue(), originalDefinition);
      await family.getByRole('button', { name: '2페이지 · 뉴스 요약', exact: true }).click();
      assert.equal(await family.locator('.family-facts textarea').count(), 2);
      // Manual facts must retain real source references even when every AI is
      // unavailable. This same interaction runs at all three viewport widths.
      const factText = '게이츠는 AI가 전문 업무에서 앞설 가능성을 전망했어요.';
      const firstFact = family.locator('textarea[id$="-fields.facts.0"]');
      const originalSiblingRefs = clone(state.saved.copy.pages[1].claimRefs.filter(ref => ref.fieldPath === 'fields.facts.1'));
      const familyAttemptsBeforeManual = state.familyAttempts;
      await firstFact.fill(factText);
      const evidenceControl = family.locator('.family-field-evidence[data-field-path="pages.news_summary.fields.facts.0"]');
      await evidenceControl.locator('summary').click();
      assert.match(await evidenceControl.innerText(), /재연결 필요/);
      assert.match(await evidenceControl.innerText(), /발언자: 빌 게이츠/);
      assert.match(await evidenceControl.innerText(), /전문 업무의 성과/);
      const connectEvidence = evidenceControl.getByRole('button', { name: '대조한 근거를 이 칸에 연결', exact: true });
      assert.equal(await connectEvidence.isDisabled(), true);
      await evidenceControl.locator('[data-evidence-id="fact:F1"]').check();
      assert.equal(await connectEvidence.isDisabled(), true, 'selection alone must not count as a source comparison');
      await evidenceControl.locator('[data-evidence-confirm]').check();
      await layoutFits(page, `v2 evidence confirmation ${width}`);
      await evidenceControl.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${outputDir}/v2-evidence-${width}.png` });
      await connectEvidence.click();
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === 'PATCH' && response.ok()), familySave.click()]);
      await family.locator('.card-copy-heading .badge', { hasText: '저장됨' }).waitFor();
      assert.equal(state.saved.copy.pages[1].fields.facts[0], factText);
      assert.deepEqual(state.saved.copy.pages[1].claimRefs.find(ref => ref.fieldPath === 'fields.facts.0'), { fieldPath: 'fields.facts.0', claimType: 'forecast', factIds: ['F1'], resourceIds: [] });
      assert.deepEqual(state.saved.copy.pages[1].claimRefs.filter(ref => ref.fieldPath === 'fields.facts.1'), originalSiblingRefs);
      assert.equal(state.familyAttempts, familyAttemptsBeforeManual, 'manual evidence comparison must not call AI');
      await reloadEditor(page, lifecycle, 'family evidence reopen'); await family.waitFor(); await family.getByRole('button', { name: '2페이지 · 뉴스 요약', exact: true }).click();
      assert.equal(await firstFact.inputValue(), factText);
      assert.match(await evidenceControl.locator('summary').innerText(), /연결됨/);
      await openBackground(page);
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${copyPath}/background` && response.ok()), family.getByLabel('페이지 배경 이미지 파일', { exact: true }).setInputFiles({ name: 'v2-source-background.png', mimeType: 'image/png', buffer: uploadImage })]);
      await family.locator('.page-background-thumb[src$="/9002"]').waitFor();
      await family.locator('.family-design > summary').click();
      const focusSlider = family.locator('.family-design label').filter({ hasText: '가로 초점' }).locator('input');
      await focusSlider.evaluate(node => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, '80'); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === 'PATCH' && response.ok()), familySave.click()]);
      await family.locator('.card-copy-heading .badge', { hasText: '저장됨' }).waitFor();
      assert.equal(state.saved.pageDesigns.news_summary.background.assetId, 9002); assert.equal(state.saved.pageDesigns.news_summary.background.focalX, 80);
      assert.equal(state.saved.pageDesigns.perspectives.background.kind, 'brand', 'background changes must remain scoped to one semantic page');
      await family.locator('.family-parent-guide > summary').click(); assert.equal(await family.locator('.family-timing li').count(), 4);
      assert.match(await family.locator('.family-caption > summary').innerText(), /재검토 필요/);
      await family.getByRole('button', { name: '7페이지 · 작은 활동', exact: true }).click();
      assert.equal(await family.locator('textarea[id$="-fields.optionalActivity.action"]').count(), 0);
      await previewReady(page); await layoutFits(page, `v2 optional activity ${width}`);
      await page.screenshot({ path: `${outputDir}/v2-activity-${width}.png` });
      // The source handoff adds profiles, never overwrites the accepted copy or a page photo.
      const beforeStyle=clone(state.saved.copy);
      const stylePicker=family.getByLabel('전체 목록에서 선택',{exact:true});
      const designArea=family.locator('details.family-whole-design');
      if(!await designArea.evaluate(node=>node.open))await designArea.locator(':scope > summary').click();
      assert.equal(await stylePicker.locator('option[value^="editorial:"]').count(),1);
      assert.equal(await stylePicker.locator('option[value^="cardnews14-"]').count(),0);
      const gallery=designArea.getByRole('group',{name:'현재 채널 마스터 1종',exact:true});
      assert.equal(await gallery.getByRole('button').count(),1);
      const designWritesBefore=state.writes.length;
      const cinematicCard=gallery.getByRole('button',{name:'뉴스 마스터 선택',exact:true});
      await cinematicCard.click();
      assert.equal(await cinematicCard.getAttribute('aria-pressed'),'true');
      assert.equal(await stylePicker.inputValue(),'editorial:cyan');
      await cinematicCard.locator('img').evaluate(image=>image.decode());
      await settleEditorPreviews(page,lifecycle);
      assert.equal(state.writes.slice(designWritesBefore).filter(write=>!write.path.endsWith('/preview')).length,0,'a visual design choice must not save or call AI');
      assert.deepEqual(state.saved.copy,beforeStyle,'a design choice remains a draft until explicit save');
      await designArea.locator(':scope > summary').scrollIntoViewIfNeeded();
      await page.screenshot({path:`${outputDir}/whole-deck-design-choice-${width}.png`});
      // A current color change preserves every page setting. Reusing the cover
      // is a separate, explicit per-page choice rather than an automatic rewrite.
      await family.getByRole('button',{name:'3페이지 · 뉴스의 의미',exact:true}).click();
      await family.getByRole('checkbox',{name:'이 장에서 표지 사진 함께 사용'}).check();
      await family.getByRole('button',{name:'1페이지 · 표지',exact:true}).click();
      await family.locator('textarea[id$="-displayOverrides.kicker"]').fill('');
      await openBackground(page);
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${copyPath}/background` && response.request().method() === 'POST' && response.ok()), family.getByLabel('페이지 배경 이미지 파일',{exact:true}).setInputFiles({name:'shared-cover.png',mimeType:'image/png',buffer:pasteImage})]);
      await family.locator('.page-background-thumb[src$="/9003"]').waitFor();
      await familySave.click();await family.locator('.card-copy-heading .badge',{hasText:'저장됨'}).waitFor();
      assert.equal(state.saved.copy.templateKey,'editorial:cyan');
      assert.equal(state.saved.copy.pages[0].displayOverrides.kicker,'');
      assert.deepEqual(state.saved.copy.pages[1].fields,beforeStyle.pages[1].fields);
      assert.equal(state.saved.pageDesigns.news_summary.background.assetId,9002);
      assert.equal(state.saved.pageDesigns.implication.background.inheritCover,true);
      await family.getByRole('button',{name:'3페이지 · 뉴스의 의미',exact:true}).click();
      assert.equal(await family.getByRole('checkbox',{name:'이 장에서 표지 사진 함께 사용'}).isChecked(),true);
      await previewReady(page);await openBackground(page);
      await family.locator('.page-background-thumb[src$="/9003"]').waitFor();
      await family.getByRole('button',{name:'1페이지 · 표지',exact:true}).click();await openBackground(page);
      await family.getByLabel('페이지 배경 이미지 파일',{exact:true}).setInputFiles({name:'replacement-cover.png',mimeType:'image/png',buffer:uploadImage});
      await family.locator('.page-background-thumb[src$="/9004"]').waitFor();await familySave.click();
      await family.locator('.card-copy-heading .badge',{hasText:'저장됨'}).waitFor();
      await family.getByRole('button',{name:'3페이지 · 뉴스의 의미',exact:true}).click();await openBackground(page);
      await family.locator('.page-background-thumb[src$="/9004"]').waitFor();await previewReady(page);
      await family.getByRole('checkbox',{name:'이 장에서 표지 사진 함께 사용'}).uncheck();
      await familySave.click();await family.locator('.card-copy-heading .badge',{hasText:'저장됨'}).waitFor();
      await reloadEditor(page,lifecycle,'family photo reuse reopen');await family.waitFor();assert.equal(await stylePicker.inputValue(),'editorial:cyan');
      assert.equal(await family.locator('textarea[id$="-displayOverrides.kicker"]').inputValue(),'');
      await family.getByRole('button',{name:'2페이지 · 뉴스 요약',exact:true}).click();await openBackground(page);
      await family.locator('.page-background-thumb[src$="/9002"]').waitFor();
      await family.getByRole('button',{name:'3페이지 · 뉴스의 의미',exact:true}).click();
      assert.equal(await family.getByRole('checkbox',{name:'이 장에서 표지 사진 함께 사용'}).isChecked(),false);
      await previewReady(page);await layoutFits(page,`current-news photo reuse ${width}`);
      await page.screenshot({path:`${outputDir}/current-news-${width}.png`});
      assert.equal(state.familyAttempts,familyAttemptsBeforeManual,'style changes and shared photos never call paid AI');
      assert.equal(state.writes.filter(write => write.path.endsWith('/background')).length,5);
      assert.equal(state.writes.filter(write => /\/(approve|publish|deliveries)(\/|$)/.test(write.path)).length, 0);
      // Sync the connected folder through the real UI instead of reloading the
      // editor while its serial, delayed thumbnail requests may still be active.
      // Strict page-error and external-request checks remain in place.
      stage = 'canva-library-sync';
      const savedBeforeCanva = clone(state.saved.copy);
      const familyEditor = await family.elementHandle();
      const canvaEditorial = page.locator('.canva-editorial'); await canvaEditorial.waitFor();
      await canvaEditorial.locator('.canva-library-entry > summary').click();
      assert.equal(await canvaEditorial.locator('.canva-library-card').count(), 0);
      state.canvaLibrary = canvaLibraryStateFixture({ items: Array.from({ length: 14 }, (_, index) => canvaLibraryItemFixture({ designId: `Dlibrary_template_${index + 1}`, title: `${index + 1} · Canva 표지와 내지${index === 0 ? ' — 긴 디자인 이름도 전체 확인' : ''}`, ...(index === 13 ? { status: 'needs_fields', canCreate: false, reason: '새 디자인의 원고 필드를 연결해 주세요.' } : {}) })) });
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/canva/template-library/sync' && response.request().method() === 'POST' && response.ok()),
        canvaEditorial.getByRole('button', { name: '지금 동기화', exact: true }).click(),
      ]);
      await canvaEditorial.locator('.canva-library-card').first().waitFor();
      assert.equal(await canvaEditorial.locator('.canva-library-card').count(), 14);
      assert.equal(await familyEditor.evaluate(node => node.isConnected), true, 'folder sync must preserve the mounted copy editor');
      assert.deepEqual(state.saved.copy, savedBeforeCanva, 'folder sync must preserve the saved copy');
      assert.equal(state.writes.filter(write => write.path === '/api/canva/template-library/sync').length, 1);
      await canvaEditorial.getByRole('button', { name: '4페이지', exact: true }).click();
      await canvaEditorial.locator('.canva-library-large img').evaluate(image => image.decode());
      assert.match(await canvaEditorial.locator('.canva-library-large img').getAttribute('src'), /page=3/);
      const nativeSelect = canvaEditorial.getByRole('button', { name: '자동 채우기로 선택', exact: true });
      await nativeSelect.scrollIntoViewIfNeeded(); assert.equal(await nativeSelect.isEnabled(), true);
      assert(await nativeSelect.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'Canva template selection must be reachable');
      await nativeSelect.click();
      await canvaEditorial.getByRole('button', { name: '4페이지', exact: true }).click();
      const nativeCreate = canvaEditorial.getByRole('button', { name: 'Canva 8장 만들기', exact: true });
      await nativeCreate.scrollIntoViewIfNeeded(); assert.equal(await nativeCreate.isEnabled(), true);
      assert(await nativeCreate.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'Canva creation must be reachable');
      await layoutFits(page, `Canva folder library ${width}`);
      const libraryBox = await canvaEditorial.locator('.canva-library-detail').boundingBox();
      assert(libraryBox && libraryBox.x >= 0 && libraryBox.x + libraryBox.width <= width + 1, 'Canva inner-page detail must fit the viewport');
      await canvaEditorial.screenshot({ path: `${outputDir}/canva-library-${width}.png` });
      await nativeCreate.click(); await canvaEditorial.getByText('템플릿 확인 중', { exact: true }).waitFor();
      assert.equal(state.writes.filter(write => write.path === `${itemPath}/canva/jobs`).length, 1);
      assert.deepEqual(state.saved.copy, savedBeforeCanva, 'native selection and creation must preserve the authoring layout and copy');
      lifecycle.mark('manual-canva-import'); await manualCanvaImport(page, state, width, lifecycle);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      // Record manual completion separately from the earlier native create.
      const manualImports = state.writes.filter(write => write.path === `${itemPath}/canva/manual-imports`).length;
      assert.equal(manualImports, 1);
      lifecycle.mark('successful context close'); await settleEditorPreviews(page, lifecycle);
      await context.close();
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ width, engine, passed: true, checks: ['legacy preservation on AI 503', 'whole eight-page proposal requires explicit apply and save', 'channel summary/copy/image roles', 'comparison columns survive reopen', 'per-page upload and paste survive save and reopen', 'eight real rendered previews', 'final eight-page deck', 'explicit v1-to-v2 revision conversion', 'v2 semantic fields save and reopen', 'manual fact evidence comparison passes actual validator and survives reopen', 'scientific mode has no invented definition', 'semantic background focal point persists', 'parent guide and stale caption are distinct', 'absent optional activity has no fields', 'no horizontal overflow or covered save action', 'six current color identities', 'shared cover replacement updates only inherited pages', 'manual image and empty display value survive style selection/reopen', 'per-page photo reuse opt-out persists', 'Canva folder sync preserves the mounted editor', 'Canva folder inner-page preview and reachable native creation preserve saved copy'], mockRebuildRequests: state.aiAttempts, mockV2Requests: state.familyAttempts, uploadedBackgrounds: 5, mockNativeCreates: state.canvaJobs.length, requestFailures, actualPaidCalls: 0, publicationRequests: 0 });
      Object.assign(results.at(-1), { manualImports, manualImportReview: true, manualConfirmationPaddingHitTests: true });
      Object.assign(results.at(-1), { previewLifecycleSettled: true, diagnostics });
      results.at(-1).checks.push('No-Autofill manual copy safe-ID import, existing review after reload without duplicate POST, 48px review navigation and explicit new-version acceptance');
      await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2)); console.log(`News editorial regression passed at ${width}px (${engine}).`);
    } catch (error) {
      scenarioError = error;
      const previewState = await page.evaluate(() => {
        const sample = image => image ? { src: image.currentSrc || image.getAttribute('src'), complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, stale: image.classList.contains('is-stale'), top: image.getBoundingClientRect().top } : null;
        return { saved: document.querySelector('.family-dialogue-editor .card-copy-heading .badge')?.textContent,
          selected: sample(document.querySelector('.card-copy-preview img')),
          pageLayouts: [...document.querySelectorAll('.family-page-strip > button')].map(button => ({ label: button.getAttribute('aria-label'), diagramPresent: !!button.querySelector('.family-page-layout'), unexpectedImage: sample(button.querySelector('img')) })) };
      }).catch(() => null);
      results.push({ width, engine, passed: false, error: error.message, apiErrors: errors, requestFailures, diagnostics, previewState, pageClosed: page.isClosed(), pendingPreviewRoutes: lifecycle.previewRoutes.size, ...lifecycle.api.snapshot() }); await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2));
      if (!page.isClosed()) {
        await page.screenshot({ path: `${outputDir}/failure-viewport-${width}.png` }).catch(() => {});
        await page.screenshot({ path: `${outputDir}/failure-${width}.png`, fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => null);
        if (html !== null) await writeFile(`${outputDir}/failure-${width}.html`, html);
      }
      throw error;
    } finally {
      try { await context.close(); }
      catch (error) { if (!scenarioError) throw error; diagnostics.push({ kind: 'failure-teardown-error', at: Date.now(), message: error.message }); }
    }
  }
} finally { await browser?.close(); await server.httpServer.close(); }
