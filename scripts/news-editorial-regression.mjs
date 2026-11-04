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
import { planCarousel, renderCarouselPage } from "../server/services/cardCarousel.ts";
import { discussionCardCopyFixture } from "../tests/fixtures/discussionCardCopy.ts";

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
const roles = { summary: { provider: "gemini", model: "fixture-summary" }, copy: { provider: "openai", model: "fixture-copy" }, image: { provider: "openai", model: "fixture-image" } };
const channels = [{ id: 3, slug: "current-dialogue", name: "Alligodang", active: true, version: 1, accentColor: "#32756b", contentType: "current_dialogue", budget: {}, ai: roles }];
const ai = { defaultProvider: "gemini", text: { gemini: true, openai: true, anthropic: false }, image: true };
const legacyCopy = () => ({ version: 1, templateKey: "set:n03", cover: { title: "기존 원고의 제목", subtitle: "직접 저장한 문구는 먼저 유지합니다" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `직접 저장한 본문 ${i + 1}`, subtitle: "원문에서 확인한 내용", body: "기존에 저장한 문구입니다. 새 제안을 확인한 뒤 명시적으로 적용하기 전까지 그대로 보존해야 합니다." })) });
const style = { layout: "minimal", collection: "n03" };
const plan = copy => planCarousel({ kind: "current_dialogue", payload: { title: "브라우저 테스트 자료", summary: "합성 자료의 사실과 해석을 구분합니다.", cardCopy: copy }, channelName: "Alligodang", channelSlug: "news", accent: "#32756b", sourceOrg: "브라우저 테스트 자료", checkedDate: "2026-11-04" }, style);
const imageCache = new Map();
async function cardImage(copy, pageIndex, backgrounds) {
  const key = JSON.stringify([copy, pageIndex]);
  if (!imageCache.has(key)) imageCache.set(key, renderCarouselPage(plan(copy), pageIndex, style, null, "", backgrounds));
  return imageCache.get(key);
}
const uploadImage = await sharp({ create: { width: 360, height: 450, channels: 3, background: "#a9cac2" } }).png().toBuffer();
const pasteImage = await sharp({ create: { width: 360, height: 450, channels: 3, background: "#d2a27b" } }).png().toBuffer();

function fixture() {
  const state = { saved: { version: 3, revisionId: 30, hasSavedCopy: true, recommendedStoryFormat: "discussion8", ai: roles, copy: legacyCopy() }, writes: [], aiAttempts: 0, cards: [], nextAssetId: 800, nextBackgroundId: 9000 };
  const backgrounds = Object.assign(new Map(), { credits: new Map() }), assets = new Map();
  const makeAsset = () => {
    const id = state.nextAssetId; state.nextAssetId += 10;
    const copy = clone(state.saved.copy);
    const asset = { id, revisionId: state.saved.revisionId, templateKey: copy.templateKey, source: "builtin", createdAt: stamp, carousel: { version: 1, altVersion: 1, cover: { kind: "typography", credit: "합성 자료 · 실제 카드 렌더러" }, pages: [copy.cover, ...copy.pages].map((page, i) => ({ id: id + i, title: page.title, sha256: `fixture-${id + i}`, altText: `합성 자료의 ${i + 1}페이지. ${page.title}` })) } };
    asset.carousel.pages.forEach((page, index) => assets.set(page.id, { copy, index }));
    state.cards.unshift(asset); return asset;
  };
  makeAsset();
  const detail = () => {
    const payload = { title: "기존 원고의 제목", event_at: null, published_at: stamp, checked_at: stamp, summary: "이 기사는 테스트용 인터뷰의 전망을 전합니다.", why_it_matters: "사실과 전망을 구분하는 연습입니다.", verified_facts: ["인터뷰가 진행됐습니다."], under_verification: [], perspectives: [], discussion_questions: ["무엇을 평가했나요?", "무엇이 달라졌나요?", "어떤 근거가 필요한가요?"], glossary: [], parent_hints: [], sources: [], evidence: [], independent_source_count: 1, cardCopy: clone(state.saved.copy) };
    const current = { id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp };
    return {
      item: { id: 9828, channelId: 3, primarySourceId: 1, title: "기존 원고의 제목", kind: "current_dialogue", origin: "collected", version: state.saved.version, currentRevisionId: state.saved.revisionId, reviewStatus: "pending", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: payload, canvaDesign: null, createdAt: stamp, updatedAt: stamp, subcategory: null }, current,
      primary: { id: 1, title: "테스트용 인터뷰와 AI의 능력", originalUrl: "https://source.example/isolated", normalizedUrl: "https://source.example/isolated", kind: "rss_direct", publisher: "브라우저 테스트 자료", fetchStatus: "ok", fetchedText: "이 문서는 테스트를 위한 합성 인터뷰입니다. 한 전문가가 AI의 미래를 전망했습니다. 전망을 이미 입증된 연구 결과로 바꾸어 표현하지 않습니다.", snippet: "테스트 자료", publishedAt: stamp, publishedPrecision: "day", lastFetchedAt: stamp, attachments: [], meta: {}, isSample: false },
      linked: [], revisions: [current], cards: clone(state.cards), approvals: [], deliveries: [], similar: [], imageAiAvailable: true, ai: roles,
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
    else if (pathname === "/api/canva/status") data = { connected: false };
    else if (pathname === "/api/studio/cards/2828") data = studio();
    else if (pathname === "/api/studio/cards") data = { cards: [studio().card], ai, notes: "", notesVersion: 1 };
    else if (pathname === "/api/channels/3/templates") data = { current: "set:n03", items: [{ key: "set:n03", name: "뉴스 대화", description: "하나의 기사, 여러 관점", kind: "builtin", family: "news", pageCount: 5 }] };
    else if (pathname === itemPath && method === "GET") data = detail();
    else if (pathname === copyPath && method === "GET") data = clone(state.saved);
    else if (pathname === copyPath && method === "PATCH") {
      assert.equal(body.version, state.saved.version, "copy changes must use the current accepted version");
      const copy = cardCopySchema.parse(body.copy); plan(copy);
      state.saved = { ...state.saved, version: state.saved.version + 1, revisionId: state.saved.revisionId + 1, copy: clone(copy) };
      data = clone(state.saved);
    } else if (pathname === `${copyPath}/preview` && method === "POST") {
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(body.copy, body.page, backgrounds) });
    } else if (pathname === `${copyPath}/generate` && method === "POST") {
      assert.equal(body.version, state.saved.version); assert.equal(body.storyFormat, "discussion8"); assert.equal(body.refreshAnalysis, true);
      assert.equal(body.selectedPage, undefined, "rebuilding all eight pages must not be limited to the selected legacy page");
      assert.equal(body.provider, undefined, "the channel copy provider must remain the default"); assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
      state.aiAttempts++;
      if (state.aiAttempts === 1) return route.fulfill({ status: 503, json: { error: "합성 503 응답: 요약 AI가 잠시 혼잡합니다. 기존 문구는 유지했습니다.", jobId: 501, jobStatus: "failed" } });
      data = { ...clone(state.saved), copy: discussionCardCopyFixture(), model: roles.copy.model, scope: "all", selectedPage: 0, jobId: 502 };
    } else if (pathname === `${copyPath}/background` && method === "POST") {
      assert.equal(body.version, state.saved.version); assert.equal(body.mode, "upload", "this regression must not request paid background generation");
      assert.match(body.pageId, /^body-[1-7]$/); assert.match(body.requestId, /^[0-9a-f-]{36}$/i); assert.match(body.imageData, /^data:image\/png;base64,/);
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
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(asset.copy, asset.index, backgrounds) });
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
    const page = await context.newPage(), { state, api } = fixture(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
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
      assert.match(await page.locator('.card-copy-story-action').innerText(), /기사 요약 Gemini · 문구 GPT/);
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
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `${itemPath}/card` && response.ok()), page.locator('.card-copy-savebar').getByRole('button', { name: '이미지 생성·갱신', exact: true }).click()]);
      assert.equal(state.cards[0].carousel.pages.length, 8);
      await page.getByRole('button', { name: '이미지 확인 · 게시 준비 열기', exact: true }).click();
      const final = page.locator('.card-carousel'); await final.waitFor(); assert.equal(await final.locator('.page-dots button').count(), 8);
      await final.locator('.page-dots button').nth(4).click();
      const finalImage = final.locator('.card-carousel-stage img'); await finalImage.evaluate(img => img.decode());
      assert.deepEqual(await finalImage.evaluate(img => [img.naturalWidth, img.naturalHeight]), [1080, 1350]);
      await finalImage.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${outputDir}/final-${width}.png` });
      assert.equal(state.writes.filter(write => write.path.endsWith('/background')).length, 2);
      assert.equal(state.writes.filter(write => /\/(approve|publish|deliveries)(\/|$)/.test(write.path)).length, 0);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ width, engine, passed: true, checks: ['legacy preservation on AI 503', 'whole eight-page proposal requires explicit apply and save', 'channel summary/copy/image roles', 'comparison columns survive reopen', 'per-page upload and paste survive save and reopen', 'eight real rendered previews', 'final eight-page deck', 'no horizontal overflow or covered save action'], mockRebuildRequests: state.aiAttempts, uploadedBackgrounds: 2, actualPaidCalls: 0, publicationRequests: 0 });
      await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2)); console.log(`News editorial regression passed at ${width}px (${engine}).`);
    } catch (error) {
      results.push({ width, engine, passed: false, error: error.message, apiErrors: errors }); await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2));
      await page.screenshot({ path: `${outputDir}/failure-${width}.png`, fullPage: true }).catch(() => {}); await writeFile(`${outputDir}/failure-${width}.html`, await page.content()); throw error;
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.httpServer.close(); }
