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
  const backgrounds = Object.assign(new Map(), { credits: new Map() }), assets = new Map();
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
    else if (pathname === "/api/canva/editorial/status") data = { configured: state.canvaLibrary.configured, connected: state.canvaLibrary.connected, autofill: state.canvaLibrary.autofill, capabilities: state.canvaLibrary.autofill ? ["autofill"] : [] };
    else if (pathname === "/api/canva/template-library") data = clone(state.canvaLibrary);
    else if (pathname === "/api/canva/template-library/sync" && method === "POST") { assert.deepEqual(body, {}); data = clone(state.canvaLibrary); }
    else if (/^\/api\/canva\/template-library\/designs\/[^/]+\/preview$/.test(pathname)) return route.fulfill({ contentType: "image/png", body: uploadImage });
    else if (pathname === "/api/channels/3/canva/masters") data = { items: [] };
    else if (pathname === `${itemPath}/canva/jobs`) {
      if (method === "POST") {
        assert.equal(body.libraryDesignId, "Dlibrary_template_1"); assert.equal(body.expectedLibraryUpdatedAt, 1793836800); assert.equal(body.masterId, undefined); assert.equal(body.version, state.saved.version);
        data = { id: 901, requestId: body.requestId, purpose: "create", status: "queued", phase: "validate", sourceRevisionId: state.saved.revisionId, sourceVersion: body.version, designId: null, editUrl: null, exportJobId: null, outputAssetId: null, outputRevisionId: null, errorCode: null, errorMessage: null, createdAt: stamp, result: { libraryDesignId: body.libraryDesignId, librarySourceUpdatedAt: 1793836800 } };
        state.canvaJobs = [data];
      } else data = { items: state.canvaJobs };
    }
    else if (pathname === "/api/studio/cards/2828") data = studio();
    else if (pathname === "/api/studio/cards") data = { cards: [studio().card], ai, notes: "", notesVersion: 1 };
    else if (pathname === "/api/channels/3/templates") data = { current: "set:n03", items: [{ key: "set:n03", name: "뉴스 대화", description: "하나의 기사, 여러 관점", kind: "builtin", family: "news", pageCount: 5 }] };
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
async function previewReady(page) {
  const image = page.locator('.card-copy-preview:not(.is-stale)[aria-busy="false"] img'); await image.waitFor(); await image.evaluate(img => img.decode());
  assert.deepEqual(await image.evaluate(img => [img.naturalWidth, img.naturalHeight]), [1080, 1350], "editor must show the actual 4:5 production renderer output");
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
    const page = await context.newPage(), { state, api } = fixture(), errors = [], external = [], requestFailures = [];
    let stage = 'news-editorial';
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => requestFailures.push({ stage, method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText ?? 'unknown' }));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort('blockedbyclient'); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      try {
        if (await api(route, url) !== false) return;
        errors.push(`Unmocked API: ${route.request().method()} ${url.pathname}`);
        await route.fulfill({ status: 404, json: { error: 'Isolated API only' } });
      } catch (error) {
        errors.push(`Fixture rejected ${url.pathname}: ${error.message}`);
        await route.fulfill({ status: 500, json: { error: 'Synthetic fixture rejected request' } });
      }
    });
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
      await page.reload(); await title(page).waitFor(); await page.getByRole('button', { name: '5페이지 두 가지 시선 문구 편집', exact: true }).click();
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
      await page.reload(); await title(page).waitFor();
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
      await family.getByRole('button', { name: '5페이지 · 두 가지 시선', exact: true }).click();
      const viewA = family.locator('textarea[id$="-fields.viewA.body"]');
      await viewA.fill('내가 덧붙인 판단 기준도 저장하고 다시 확인할 수 있어요.');
      const familySave = family.getByRole('button', { name: '문구·디자인 저장', exact: true });
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === copyPath && response.request().method() === 'PATCH' && response.ok()), familySave.click()]);
      await family.locator('.card-copy-heading .badge', { hasText: '저장됨' }).waitFor();
      assert.equal(state.saved.copy.pages[4].fields.viewA.body, '내가 덧붙인 판단 기준도 저장하고 다시 확인할 수 있어요.');
      assert.equal(state.saved.copy.pages[4].layout, 'stacked');
      await page.reload(); await family.waitFor(); await family.getByRole('button', { name: '5페이지 · 두 가지 시선', exact: true }).click();
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
      await page.reload(); await family.waitFor(); await family.getByRole('button', { name: '2페이지 · 뉴스 요약', exact: true }).click();
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
      const stylePicker=family.getByLabel('카드뉴스 스타일',{exact:true});
      assert.equal(await stylePicker.locator('option[value^="cardnews14-"]').count(),14);
      await stylePicker.selectOption('cardnews14-cinematic-v1');
      await family.getByRole('button',{name:'1페이지 · 표지',exact:true}).click();
      await family.locator('textarea[id$="-displayOverrides.kicker"]').fill('');
      await openBackground(page);
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${copyPath}/background` && response.request().method() === 'POST' && response.ok()), family.getByLabel('페이지 배경 이미지 파일',{exact:true}).setInputFiles({name:'shared-cover.png',mimeType:'image/png',buffer:pasteImage})]);
      await family.locator('.page-background-thumb[src$="/9003"]').waitFor();
      await familySave.click();await family.locator('.card-copy-heading .badge',{hasText:'저장됨'}).waitFor();
      assert.equal(state.saved.copy.templateKey,'cardnews14-cinematic-v1');
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
      await page.reload();await family.waitFor();assert.equal(await stylePicker.inputValue(),'cardnews14-cinematic-v1');
      assert.equal(await family.locator('textarea[id$="-displayOverrides.kicker"]').inputValue(),'');
      await family.getByRole('button',{name:'2페이지 · 뉴스 요약',exact:true}).click();await openBackground(page);
      await family.locator('.page-background-thumb[src$="/9002"]').waitFor();
      await family.getByRole('button',{name:'3페이지 · 뉴스의 의미',exact:true}).click();
      assert.equal(await family.getByRole('checkbox',{name:'이 장에서 표지 사진 함께 사용'}).isChecked(),false);
      await previewReady(page);await layoutFits(page,`14-style photo reuse ${width}`);
      await page.screenshot({path:`${outputDir}/cardnews14-${width}.png`});
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
      const nativeSelect = canvaEditorial.getByRole('button', { name: '이 Canva 템플릿 선택', exact: true });
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
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ width, engine, passed: true, checks: ['legacy preservation on AI 503', 'whole eight-page proposal requires explicit apply and save', 'channel summary/copy/image roles', 'comparison columns survive reopen', 'per-page upload and paste survive save and reopen', 'eight real rendered previews', 'final eight-page deck', 'explicit v1-to-v2 revision conversion', 'v2 semantic fields save and reopen', 'manual fact evidence comparison passes actual validator and survives reopen', 'scientific mode has no invented definition', 'semantic background focal point persists', 'parent guide and stale caption are distinct', 'absent optional activity has no fields', 'no horizontal overflow or covered save action', '14 style identities', 'shared cover replacement updates only inherited pages', 'manual image and empty display value survive style selection/reopen', 'per-page photo reuse opt-out persists', 'Canva folder sync preserves the mounted editor', 'Canva folder inner-page preview and reachable native creation preserve saved copy'], mockRebuildRequests: state.aiAttempts, mockV2Requests: state.familyAttempts, uploadedBackgrounds: 5, mockNativeCreates: state.canvaJobs.length, requestFailures, actualPaidCalls: 0, publicationRequests: 0 });
      await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2)); console.log(`News editorial regression passed at ${width}px (${engine}).`);
    } catch (error) {
      results.push({ width, engine, passed: false, error: error.message, apiErrors: errors, requestFailures }); await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2));
      await page.screenshot({ path: `${outputDir}/failure-${width}.png`, fullPage: true }).catch(() => {}); await writeFile(`${outputDir}/failure-${width}.html`, await page.content()); throw error;
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.httpServer.close(); }
