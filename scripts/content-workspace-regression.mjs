// Browser regression against the built app. Every API response is synthetic;
// external requests are blocked, and no database, AI provider or social account is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { preview } from "vite";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch {
  playwright = require(require.resolve("playwright", { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? "/nonexistent"] }));
}
const outputDir = path.resolve("test-results/workspace");
await mkdir(outputDir, { recursive: true });
const server = await preview({ preview: { host: "127.0.0.1", port: 4174, strictPort: true } });
const origin = "http://127.0.0.1:4174";
const itemPath = "/api/channels/3/items/9790";
const copyPath = `${itemPath}/card-copy`;
const stamp = "2026-11-03T00:00:00.000Z";
const clone = value => structuredClone(value);
const channels = [{ id: 3, slug: "current-dialogue", name: "Alligodang", active: true, version: 1, accentColor: "#32756b", contentType: "current_dialogue", budget: {} }];
const ai = { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false }, image: false };
const initialCopy = () => ({
  version: 1, templateKey: "set:n04",
  cover: { title: "뉴스를 읽는 가족의 시간", subtitle: "원문을 확인하고 함께 질문해요" },
  pages: Array.from({ length: 4 }, (_, index) => ({ id: `body-${index + 1}`, title: ["무슨 일이 있었나요?", "확인된 사실", "함께 생각할 질문", "오늘의 대화"][index], subtitle: "가족과 나누는 뉴스", body: `원문에서 확인한 내용을 정리한 ${index + 1}번째 카드입니다. 사실과 의견을 구분하며 이야기를 나눠 보세요.` })),
});

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const wrap = (value, length) => String(value).split("\n").flatMap(line => {
  const chars = [...line], lines = [];
  for (let index = 0; index < chars.length; index += length) lines.push(chars.slice(index, index + length).join(""));
  return lines.length ? lines : [""];
});
const imageCache = new Map();
async function cardImage(copy, pageIndex) {
  const key = JSON.stringify([copy, pageIndex]);
  if (imageCache.has(key)) return imageCache.get(key);
  const page = pageIndex ? copy.pages[pageIndex - 1] : copy.cover;
  const text = (value, x, y, size, color, width, weight = 400) => wrap(value, width).slice(0, 8).map((line, index) => `<text x="${x}" y="${y + index * size * 1.45}" font-size="${size}" fill="${color}" font-weight="${weight}">${escapeXml(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#f5f3ea"/><rect x="0" y="0" width="1080" height="24" fill="#32756b"/><g font-family="Pretendard">${text("ALLIGODANG / FAMILY NEWS", 80, 120, 28, "#32756b", 34, 600)}${text(page.title, 80, 290, 76, "#172f30", 12, 700)}${text(page.subtitle, 80, 610, 34, "#536a66", 24)}${text(pageIndex ? page.body : "오늘의 뉴스를 가족의 대화로 이어 보세요.", 80, 800, 42, "#233e3c", 21)}<line x1="80" x2="1000" y1="1230" y2="1230" stroke="#c7d4cc"/>${text("우주펭귄상회 스튜디오 · 브라우저 테스트 자료", 80, 1290, 24, "#536a66", 44)}<text x="1000" y="1290" text-anchor="end" font-size="24" fill="#32756b">${pageIndex + 1} / 5</text></g></svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [path.resolve("assets/fonts/Pretendard-Regular.ttf"), path.resolve("assets/fonts/Pretendard-Bold.ttf")], loadSystemFonts: false, defaultFontFamily: "Pretendard" } }).render().asPng();
  const bytes = await sharp(png).resize(540, 675).jpeg({ quality: 88 }).toBuffer();
  imageCache.set(key, bytes);
  return bytes;
}

function fixture() {
  const state = { publicationDraft: { version: 1, captions: { instagram: "아이와 함께 오늘의 뉴스를 읽고 서로의 질문을 나눠 보세요.", telegram: "" } }, saved: { version: 3, revisionId: 30, hasSavedCopy: true, copy: initialCopy() }, reviewStatus: "reviewed", cards: [], approvals: [], deliveries: [], writes: [], aiAttempts: 0, nextAssetId: 701 };
  const assetCopies = new Map();
  const makeAsset = () => {
    const id = state.nextAssetId; state.nextAssetId += 10;
    const copy = clone(state.saved.copy);
    const asset = { id, revisionId: state.saved.revisionId, templateKey: copy.templateKey, source: "builtin", createdAt: stamp, carousel: { version: 1, altVersion: 1, cover: { kind: "typography", credit: "원문에 근거한 카드 · 테스트 자료" }, pages: [copy.cover, ...copy.pages].map((page, index) => ({ id: id + index, title: page.title, sha256: `fixture-${id + index}`, altText: `${page.title} 내용을 설명하는 카드입니다.` })) } };
    asset.carousel.pages.forEach((page, index) => assetCopies.set(page.id, { copy, index }));
    state.cards.unshift(asset);
    return asset;
  };
  makeAsset();
  const detail = () => {
    const payload = { title: state.saved.copy.cover.title, event_at: null, published_at: stamp, checked_at: stamp, summary: "지역의 새로운 과학 소식을 가족과 함께 읽습니다.", why_it_matters: "확인한 사실과 질문을 구분하는 연습을 합니다.", verified_facts: ["지역 과학 프로그램이 열립니다."], under_verification: [], perspectives: [], discussion_questions: ["무엇을 알게 되었나요?", "어떤 근거가 있나요?", "더 확인할 점은 무엇인가요?"], glossary: [], parent_hints: [], sources: [], evidence: [], independent_source_count: 1, cardCopy: clone(state.saved.copy) };
    return {
      item: { id: 9790, channelId: 3, primarySourceId: 901, title: "뉴스를 읽는 가족의 시간", kind: "current_dialogue", origin: "collected", version: state.saved.version, currentRevisionId: state.saved.revisionId, reviewStatus: state.reviewStatus, evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: payload, canvaDesign: null, createdAt: stamp, updatedAt: stamp, subcategory: null },
      current: { id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp },
      primary: { id: 901, title: "가족과 함께 읽는 과학 프로그램 소식", originalUrl: "https://source.example/article", normalizedUrl: "https://source.example/article", kind: "rss_direct", publisher: "테스트 과학신문", fetchStatus: "ok", fetchedText: "지역 과학 프로그램이 열립니다. 공개된 안내문에서 일정을 확인하고, 참가 조건은 공식 자료를 다시 확인해 주세요. 이 본문은 브라우저 테스트를 위한 합성 자료입니다.", snippet: "가족과 나누는 과학 뉴스", publishedAt: stamp, publishedPrecision: "day", lastFetchedAt: stamp, attachments: [], meta: {}, isSample: false },
      linked: [], revisions: [{ id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp }], cards: clone(state.cards), approvals: clone(state.approvals), deliveries: clone(state.deliveries), similar: [], publicationDraft: clone(state.publicationDraft), defaultCaptions: { instagram: "아이와 함께 오늘의 뉴스를 읽고 서로의 질문을 나눠 보세요.", telegram: "" },
      publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 10, expectedUsername: "alligodang.official", destinations: [{ id: 20, label: "@alligodang.official", platform: "instagram", configured: true }] },
    };
  };
  // current-dialogue stores its Studio channel as "news" (shared/channelKeys.ts).
  // The account's display name and Instagram handle are not the saved channel key.
  const studio = () => ({ card: { id: 25, version: 2, title: detail().item.title, channel: "news", format: "카드뉴스", stage: "review", sourceItemId: 9790, script: "", caption: "", memo: "", imagePath: "", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), createdAt: stamp, updatedAt: stamp, sourceOutput: { assetId: state.cards[0].id, channelId: 3, itemId: 9790, revisionId: state.cards[0].revisionId, stale: state.cards[0].revisionId !== state.saved.revisionId, pages: state.cards[0].carousel.pages, coverCredit: "테스트 자료" } }, revisions: [], jobs: [], images: [] });
  async function api(route, url) {
    const request = route.request(), pathname = url.pathname, method = request.method();
    const body = request.postData() ? request.postDataJSON() : undefined;
    if (method !== "GET") state.writes.push({ path: pathname, method, body: clone(body) });
    let data;
    if (pathname === "/api/auth/me") data = { user: "fixture", demo: false, csrf: "fixture-csrf", authConfigured: true, demoAllowed: false };
    else if (pathname === "/api/channels") data = channels;
    else if (pathname === "/api/channels/3/today") data = { counts: { pendingReview: 1, draftsReady: 1 } };
    else if (pathname === "/api/status") data = { globalStop: false, workerConnected: true, integrations: { aiProvider: "gemini", gemini: true, openai: false, anthropic: false, flags: { dryRun: false, autoPublish: true } } };
    else if (pathname === "/api/studio/ai-status") data = ai;
    else if (pathname === "/api/canva/status") data = { connected: false };
    else if (pathname === "/api/studio/cards/25") data = studio();
    else if (pathname === "/api/studio/cards") data = { cards: [studio().card], ai, notes: "", notesVersion: 1 };
    else if (pathname === "/api/channels/3/templates") data = { current: "set:n04", items: [{ key: "set:n04", name: "뉴스 브리핑", description: "원문에서 시작하는 가족의 뉴스", kind: "builtin", family: "news", pageCount: 5 }] };
    else if (pathname === itemPath && method === "GET") data = detail();
    else if (pathname === `${itemPath}/publication-draft` && method === "PATCH") {
      assert.equal(body.version, state.publicationDraft.version);
      state.publicationDraft = { version: body.version + 1, captions: clone(body.captions) };
      data = clone(state.publicationDraft);
    }
    else if (pathname === copyPath && method === "GET") data = clone(state.saved);
    else if (pathname === copyPath && method === "PATCH") {
      assert.equal(body.version, state.saved.version, "copy saves must use the accepted version");
      state.saved = { ...state.saved, version: state.saved.version + 1, revisionId: state.saved.revisionId + 1, copy: clone(body.copy) };
      state.reviewStatus = "pending";
      data = clone(state.saved);
    } else if (pathname === `${copyPath}/preview`) {
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(body.copy, body.page) });
    } else if (pathname === `${copyPath}/generate`) {
      state.aiAttempts++;
      if (state.aiAttempts === 1) return route.fulfill({ status: 503, json: { error: "Gemini HTTP 503: Gemini 서버가 잠시 혼잡합니다. 잠시 후 다시 시도하거나 직접 편집을 이어가세요. 총 3회 시도했습니다.", jobId: 9901, jobStatus: "failed" } });
      data = { ...clone(state.saved), model: "synthetic-gemini", copy: { ...clone(state.saved.copy), cover: { title: "검토할 AI 제안", subtitle: "기존 문구는 적용 전까지 유지합니다" } } };
    } else if (pathname === `${itemPath}/card`) {
      assert.equal(body.version, state.saved.version);
      assert.notEqual(body.coverMode, "ai", "the fixture must not choose paid image generation");
      data = { ...clone(makeAsset()), studioCardId: 25 };
    } else if (pathname === `${itemPath}/review`) {
      state.reviewStatus = body.status; state.saved.version++;
      data = detail().item;
    } else if (pathname === `${itemPath}/approve`) {
      assert.equal(body.publicationDraftVersion, state.publicationDraft.version);
      assert.deepEqual(body.captions, state.publicationDraft.captions);
      assert.deepEqual(body.destinationIds, [20]);
      assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
      const id = 1000 + state.approvals.length;
      const approval = { id, revisionId: state.saved.revisionId, scheduledAt: body.timing === "later" ? body.scheduledAt : new Date().toISOString(), status: "active" };
      state.approvals.unshift(approval);
      state.deliveries.unshift({ d: { id: id + 100, approvalId: id, status: "scheduled", lastError: null, externalUrl: null, completedAt: null }, dest: { label: "@alligodang.official", platform: "instagram" } });
      data = { ok: true, destinations: 1, approval, timing: body.timing, workerStarted: body.timing === "now" };
    } else if (/^\/api\/channels\/3\/approvals\/\d+\/cancel$/.test(pathname)) {
      const id = Number(pathname.split("/").at(-2));
      state.approvals.find(approval => approval.id === id).status = "cancelled";
      state.deliveries.filter(row => row.d.approvalId === id).forEach(row => { row.d.status = "cancelled"; });
      data = { approvalCancelled: true, message: "아직 시작하지 않은 전송을 취소했습니다." };
    } else if (/^\/api\/channels\/3\/deliveries\/\d+\/reconcile$/.test(pathname)) {
      data = { ok: true, status: "unknown", message: "아직 결과를 확인하지 못했습니다." };
    } else if (/^\/api\/channels\/3\/deliveries\/\d+\/confirm-not-posted$/.test(pathname)) {
      const id = Number(pathname.split("/").at(-2));
      state.deliveries.find(entry => entry.d.id === id).d.status = "failed";
      data = { ok: true, message: "미게시 확인을 기록했습니다." };
    } else if (/^\/api\/channels\/3\/deliveries\/\d+\/retry$/.test(pathname)) {
      const id = Number(pathname.split("/").at(-2));
      const row = state.deliveries.find(entry => entry.d.id === id);
      if (row.d.status === "unknown") assert.equal(body.confirmNotPosted, true);
      row.d.status = "scheduled"; row.d.lastError = null;
      data = { ok: true, workerStarted: true };
    } else if (/^\/api\/channels\/3\/media\/\d+\/alt-text$/.test(pathname)) data = { version: 1, values: Array.from({ length: 5 }, (_, index) => `뉴스의 확인된 사실을 설명하는 ${index + 1}번째 카드입니다.`) };
    else if (/^\/api\/channels\/3\/media\/\d+$/.test(pathname)) {
      const image = assetCopies.get(Number(pathname.split("/").at(-1)));
      assert(image, "unknown synthetic media id");
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(image.copy, image.index) });
    } else return false;
    await route.fulfill({ json: data });
    return true;
  }
  return { state, api };
}

const field = (page, suffix) => page.locator(`.card-copy-editor textarea[id$="-${suffix}"]`);
const nav = (page, name) => page.getByRole("navigation", { name: "현재 콘텐츠 작업" }).getByRole("button", { name, exact: true });
const mutations = state => state.writes.filter(write => !write.path.endsWith("/preview"));
async function waitValue(page, suffix, value) {
  await page.waitForFunction(({ suffix, value }) => document.querySelector(`.card-copy-editor textarea[id$="-${suffix}"]`)?.value === value, { suffix, value });
}
async function ready(page) {
  await field(page, "title").waitFor();
  assert.equal(await page.locator(".content-workspace .card-copy-editor").count(), 1);
  assert.equal(await page.locator('.content-workspace [role="tablist"]').count(), 0);
}
async function previewReady(page) {
  const image = page.locator('.card-copy-preview:not(.is-stale)[aria-busy="false"] img');
  await image.waitFor();
  await image.evaluate(img => img.decode());
  assert(await image.evaluate(img => img.naturalWidth >= 200 && img.naturalHeight >= 250), "preview must contain a real card-sized image");
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("main *")].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right > innerWidth + 1; }).slice(0, 8).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })) }));
  assert(dimensions.scroll <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  for (const input of await page.locator(".card-copy-fields textarea").all()) {
    const box = await input.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= dimensions.width + 1, `${label}: text field outside viewport`);
  }
}
async function actionNotCovered(page) {
  for (const button of await page.locator(".card-copy-savebar button").all()) {
    await button.evaluate(node => node.scrollIntoView({ block: "end" }));
    assert(await button.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!hit && (hit === node || node.contains(hit));
    }), "save/render action must receive the hit test above navigation and notices");
  }
}
async function saveCopy(page) {
  await page.locator(".card-copy-savebar").getByRole("button", { name: "문구 저장", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".card-copy-savebar button")].some(button => button.textContent === "문구 저장" && button.disabled));
}
async function clickMutation(page, button, pathname) {
  await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === "POST" && response.ok()), button.click()]);
}

let browser;
let engine = "WebKit";
const results = [];
try {
  try { browser = await playwright.webkit.launch(); }
  catch (webkitError) {
    engine = "Chromium";
    console.log(`WebKit unavailable; using Chromium (${String(webkitError.message).split("\n")[0]})`);
    browser = await playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE, args: ["--no-zygote", "--disable-dev-shm-usage"] } : {}) });
  }
  for (const width of [393, 1280, 320, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, locale: "ko-KR", timezoneId: "Asia/Seoul", serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("spacepenguin.channel", "3"));
    const page = await context.newPage(), fixtureData = fixture(), { state } = fixtureData;
    const errors = [], blocked = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { blocked.push(url.href); return route.abort("blockedbyclient"); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      try {
        if (await fixtureData.api(route, url) !== false) return;
        errors.push(`Unexpected API: ${route.request().method()} ${url.pathname}`);
        await route.fulfill({ status: 404, json: { error: "Unmocked local API" } });
      } catch (error) {
        errors.push(`Fixture error at ${url.pathname}: ${error.message}`);
        await route.fulfill({ status: 500, json: { error: "Synthetic fixture rejected the request" } });
      }
    });
    try {
      await page.goto(origin);
      await page.locator('a[href="/studio/25"]').first().click();
      await ready(page); await previewReady(page);
      assert.equal(mutations(state).length, 0, "opening a workspace must not generate or publish");
      const workspaceNav = await page.locator(".content-workspace-nav").innerText();
      const mountedEditor = await page.locator("#card-panel").elementHandle();
      await noOverflow(page, `studio ${width}`);
      await page.screenshot({ path: `${outputDir}/workspace-${width}.png` });

      const firstTitle = "첫 카드에 저장한 제목", firstBody = "첫 번째 카드의 본문입니다.\n줄바꿈도 저장 후 그대로 유지합니다.";
      const secondTitle = "두 번째 카드의 별도 제목", secondBody = "둘째 카드에서만 고친 문구입니다. 첫 카드와 서로 섞이지 않습니다.";
      await page.getByRole("button", { name: /^1번째 본문 문구 편집/ }).click();
      await field(page, "title").fill(firstTitle); await field(page, "body").fill(firstBody);
      await page.getByLabel("보기 채널", { exact: true }).selectOption("all");
      await waitValue(page, "body", firstBody);
      await page.getByLabel("보기 채널", { exact: true }).selectOption("3");
      await waitValue(page, "body", firstBody);
      await page.goBack();
      await page.getByRole("dialog", { name: "저장하지 않은 변경이 있습니다" }).waitFor();
      await page.getByRole("button", { name: "머무르기", exact: true }).click();
      await waitValue(page, "body", firstBody);
      assert(await mountedEditor.evaluate(node => node.isConnected), "browser Back must keep the dirty editor mounted");
      const urlBefore = page.url();
      await nav(page, "자료·초안").click(); await page.locator("#source-panel").waitFor({ state: "visible" });
      assert.equal(page.url(), urlBefore, "source inspection must stay in the same workspace route");
      await noOverflow(page, `source drawer ${width}`);
      const sourceDrawer = page.locator(".content-workspace > details").filter({ has: page.locator("#source-panel") });
      await sourceDrawer.locator(":scope > summary").click();
      await nav(page, "전송 상태").click(); await page.locator("#delivery-panel").waitFor({ state: "visible" });
      await nav(page, "카드 편집").click();
      assert.equal(page.url(), urlBefore, "editing must not navigate away");
      assert(await mountedEditor.evaluate(node => node.isConnected), "local navigation must preserve the mounted editor");
      await waitValue(page, "body", firstBody);
      if (width < 768) {
        await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
        await page.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
        await waitValue(page, "body", firstBody);
      }
      await page.getByRole("button", { name: /^2번째 본문 문구 편집/ }).click();
      await field(page, "title").fill(secondTitle); await field(page, "body").fill(secondBody);
      await previewReady(page); await noOverflow(page, `edited fields ${width}`);
      await page.locator(".card-copy-fields").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outputDir}/copy-fields-${width}.png` });
      await actionNotCovered(page);
      await saveCopy(page);
      assert.equal(mutations(state).filter(write => write.path === copyPath).length, 1);
      assert.equal(state.saved.copy.pages[0].body, firstBody); assert.equal(state.saved.copy.pages[1].body, secondBody);
      await page.reload(); await ready(page);
      await page.getByRole("button", { name: /^1번째 본문 문구 편집/ }).click();
      await waitValue(page, "title", firstTitle); await waitValue(page, "body", firstBody);
      await page.getByRole("button", { name: /^2번째 본문 문구 편집/ }).click();
      await waitValue(page, "title", secondTitle); await waitValue(page, "body", secondBody);

      await page.goto(`${origin}/items/3/9790`); await ready(page);
      assert.equal(await page.locator(".content-workspace-nav").innerText(), workspaceNav, "studio and item routes must share the canonical editor");
      await page.getByRole("button", { name: /^2번째 본문 문구 편집/ }).click();
      await waitValue(page, "body", secondBody);
      await page.locator(".card-copy-ai-tools > summary").click();
      await page.getByRole("button", { name: "AI로 템플릿 문구 제안받기", exact: true }).click();
      await page.locator(".card-copy-ai-tools").getByText("Gemini HTTP 503:", { exact: false }).waitFor();
      await waitValue(page, "body", secondBody);
      await page.locator(".card-copy-ai-tools").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outputDir}/ai-recovery-${width}.png` });
      await page.locator(".card-copy-ai-tools").getByRole("button", { name: "다시 시도", exact: true }).click();
      await page.getByText("AI 문구 제안 · 아직 카드에 반영하지 않았어요", { exact: true }).waitFor();
      await waitValue(page, "body", secondBody);
      await page.getByRole("button", { name: "제안 닫기", exact: true }).click();
      assert.equal(state.aiAttempts, 2);
      await page.locator(".card-copy-ai-tools > summary").click();

      await clickMutation(page, page.locator(".card-copy-savebar").getByRole("button", { name: "게시 준비", exact: true }), `${itemPath}/card`);
      await page.locator("#publish-options[open]").waitFor();
      const caption = "화면을 다시 열어도 남아야 하는 게시물 캡션입니다.";
      await page.getByRole("textbox", { name: "인스타그램 캡션", exact: true }).fill(caption);
      assert(await page.locator(".publish-confirm input").isDisabled(), "unsaved caption must block publication confirmation");
      await page.getByRole("button", { name: "캡션 저장", exact: true }).click();
      await page.getByText("캡션 저장됨 · v2", { exact: true }).waitFor();
      await page.reload(); await ready(page); await nav(page, "게시 준비").click();
      assert.equal(await page.getByRole("textbox", { name: "인스타그램 캡션", exact: true }).inputValue(), caption);
      await page.getByRole("button", { name: "내용 확인 · 검토 완료", exact: true }).click();
      await page.getByRole("button", { name: "내용 검토 완료됨", exact: true }).waitFor();
      const now = page.getByRole("radio", { name: /^지금 게시/ }), later = page.getByRole("radio", { name: /^예약 게시/ });
      assert(await now.isChecked(), "immediate publication must be the default");
      assert.equal(await page.locator('input[type="datetime-local"]').count(), 0);
      await page.locator(".publish-timing").evaluate(node => node.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: `${outputDir}/publish-now-${width}.png` });
      await later.check();
      await page.locator('input[type="datetime-local"]').fill(new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 16));
      await noOverflow(page, `scheduled publication ${width}`);
      await page.locator(".publish-timing").evaluate(node => node.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: `${outputDir}/publish-later-${width}.png` });
      await page.locator(".publish-confirm input").check();
      await clickMutation(page, page.getByRole("button", { name: "승인하고 예약 게시", exact: true }), `${itemPath}/approve`);
      let approvalWrites = state.writes.filter(write => write.path === `${itemPath}/approve`);
      assert.equal(approvalWrites[0].body.timing, "later"); assert.match(approvalWrites[0].body.scheduledAt, /\+09:00$/);
      await page.getByRole("button", { name: "예약 취소", exact: true }).click();
      await page.getByText("승인 취소됨", { exact: true }).waitFor();
      await nav(page, "게시 준비").click(); await now.check();
      assert.equal(await page.locator('input[type="datetime-local"]').count(), 0, "date input must disappear for immediate publication");
      await page.locator(".publish-confirm input").check();
      await clickMutation(page, page.getByRole("button", { name: "승인하고 지금 게시", exact: true }), `${itemPath}/approve`);
      approvalWrites = state.writes.filter(write => write.path === `${itemPath}/approve`);
      assert.equal(approvalWrites[1].body.timing, "now"); assert(!("scheduledAt" in approvalWrites[1].body));

      state.deliveries[0].d.status = "unknown"; state.deliveries[0].d.lastError = "전송 응답을 확인하지 못했습니다.";
      await page.locator("#delivery-panel").getByRole("button", { name: /새로고침/ }).click();
      await page.getByText("게시 계정에서 확인한 결과 기록", { exact: true }).click();
      const notPosted = page.getByRole("checkbox", { name: "게시 계정에서 이 콘텐츠가 게시되지 않은 것을 확인했습니다.", exact: true });
      await notPosted.waitFor();
      assert.equal(await page.getByRole("button", { name: "다시 전송", exact: true }).count(), 0, "unresolved results cannot be retried");
      const confirmNotPosted = page.getByRole("button", { name: "미게시 확인 기록", exact: true });
      assert(await confirmNotPosted.isDisabled(), "ambiguous publication requires an explicit not-posted check");
      await notPosted.check();
      await noOverflow(page, `delivery recovery ${width}`);
      await page.locator("#delivery-panel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outputDir}/delivery-recovery-${width}.png` });
      await clickMutation(page, confirmNotPosted, `/api/channels/3/deliveries/${state.deliveries[0].d.id}/confirm-not-posted`);
      const retry = page.getByRole("button", { name: "다시 전송", exact: true });
      await clickMutation(page, retry, `/api/channels/3/deliveries/${state.deliveries[0].d.id}/retry`);
      assert.equal(state.writes.filter(write => /\/retry$/.test(write.path)).length, 1);
      assert.equal(state.writes.filter(write => /\/cancel$/.test(write.path)).length, 1);
      assert.equal(state.saved.copy.pages[0].body, firstBody); assert.equal(state.saved.copy.pages[1].body, secondBody);
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      results.push({ engine, width, result: "passed", savedPages: 2, aiRecovery: true, publicationModes: ["now", "later"], cancelAndConfirmedRetry: true, captionPersistence: true, historyGuard: true, channelPreservation: true, actionHitTests: true });
      console.log(`${engine} ${width}px: canonical workspace, two-page save/reload, unsaved navigation, AI recovery, now/later and cancel/retry passed`);
    } catch (error) {
      console.error(JSON.stringify({ width, errors, blocked, writes: mutations(state), url: page.url() }));
      await page.screenshot({ path: `${outputDir}/failure-${width}.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  await writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
