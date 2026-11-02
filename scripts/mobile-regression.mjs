// Browser regression runs in GitHub Actions against the built app with synthetic API data.
// No production credentials, database, AI requests, collection jobs or social posts are used.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { preview } from "vite";
import { webkit } from "playwright";

const server = await preview({ preview: { host: "127.0.0.1", port: 4173, strictPort: true } });
const browser = await webkit.launch();
await mkdir("test-results/mobile", { recursive: true });
const channels = [
  { id: 1, slug: "opportunities", name: "Highscoop", handle: "highscoop.official" },
  { id: 3, slug: "current-dialogue", name: "Alligodang", handle: "alligodang.official" },
  { id: 106, slug: "penguin", name: "우주펭귄상회", handle: "spacepenguin.co" },
  { id: 107, slug: "fryday", name: "Fryday", handle: "fryday.official.kr" },
].map(c => ({ ...c, active: true, version: 1, accentColor: "#2563eb", contentType: "manual", budget: {} }));
const profile = { label: "과학·시사", count: 2, missing: 0, active: 1, paused: 1, removed: 0, rules: [
  { query: "과학 뉴스", endpoint: "news", state: "active" }, { query: "인공지능", endpoint: "news", state: "paused" },
] };
const row = { ...channels[1], queries: 1, discoveryQueries: 0, boards: 0, budget: 12, profile, newItems: 128, pending: 128, fetched: 0, jobs: [], lastRun: null };
const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1 && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1;
try {
  for (const width of [320, 393, 430, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    await context.addInitScript(() => localStorage.setItem("spacepenguin.channel", "3"));
    const page = await context.newPage(), errors = [], writes = [];
    page.on("pageerror", e => errors.push(e.message));
    let autoCollect = true;
    await page.route("**/api/**", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      let data;
      if (req.method() !== "GET") writes.push({ path, body: req.postDataJSON() });
      if (path === "/api/auth/me") data = { user: "test", demo: false, csrf: "fixture", authConfigured: true, demoAllowed: false };
      else if (path === "/api/channels") data = channels;
      else if (/\/channels\/\d+\/today$/.test(path)) data = { counts: { pendingReview: 128, draftsReady: 0 } };
      else if (path === "/api/status") data = { globalStop: false, workerConnected: true, integrations: { flags: {} } };
      else if (path === "/api/collection/overview") data = { date: url.searchParams.get("date"), timezone: "Asia/Seoul", autoCollect, globalStop: false, searchReady: true, naverReady: false, sourceMode: "public_rss", publicFeeds: ["테스트신문"], inlineWorker: true, nextAt: "2026-11-02T20:13:00Z", lastScheduledAt: null, channels: [row] };
      else if (path === "/api/settings/auto-collect") { autoCollect = req.postDataJSON().enabled; data = { ok: true }; }
      else if (path === "/api/collection/collect") data = { inline: true, requested: [{ channelId: req.postDataJSON().channelId }] };
      else if (path === "/api/studio/instagram/accounts") data = { accounts: channels.map(c => ({ channelId: c.id, channelName: c.name, expectedUsername: c.handle, destinations: [] })) };
      else if (path === "/api/studio/instagram/oauth/config") data = { configured: true, missing: [], appId: "123456", redirectUri: "https://studio.example/api/studio/instagram/oauth/callback" };
      else { errors.push(`Unexpected API: ${path}`); return route.fulfill({ status: 404, json: { error: path } }); }
      await route.fulfill({ json: data });
    });
    try {
      await page.goto("http://127.0.0.1:4173/today");
      await page.locator(".collection-toolbar").waitFor();
      const boxes = await Promise.all([".collection-today", ".collection-date input", ".collection-refresh", ".collection-run"].map(s => page.locator(s).boundingBox()));
      for (const box of boxes) assert(box && box.x >= 0 && box.x + box.width <= width + 1, `control outside ${width}px viewport`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert(!overlap(boxes[i], boxes[j]), `controls overlap at ${width}px`);
      await page.getByRole("button", { name: "새로고침", exact: true }).click();
      const checkbox = page.getByRole("checkbox", { name: "매일 자동 수집" });
      const checkBox = await checkbox.boundingBox();
      assert(checkBox.width >= 18 && checkBox.width <= 24 && checkBox.height <= 24, "checkbox has inherited full-size input dimensions");
      await Promise.all([page.waitForResponse(r => r.url().endsWith("/settings/auto-collect") && r.status() === 200), checkbox.click()]);
      await page.waitForFunction(() => document.querySelector('.collection-summary input[type="checkbox"]')?.checked === false);
      await page.locator(".collection-preset summary").click();
      assert.equal(await page.getByRole("button", { name: /새 검색어 .*개 추가/ }).count(), 0);
      await page.getByRole("button", { name: "이 채널 지금 수집", exact: true }).click();
      await page.getByText("1개 채널의 수집을 시작했습니다.", { exact: false }).waitFor();
      assert(writes.some(w => w.path === "/api/settings/auto-collect" && w.body.enabled === false));
      assert(writes.some(w => w.path === "/api/collection/collect" && w.body.channelId === 3));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}px`);
      await page.screenshot({ path: `test-results/mobile/collection-${width}.png`, fullPage: true });
      await page.goto("http://127.0.0.1:4173/settings?tab=instagram");
      await page.locator(".instagram-account").first().waitFor();
      assert.equal(await page.locator(".instagram-account").count(), 4);
      for (const c of channels) assert.equal(await page.locator(`.instagram-account a[href="https://www.instagram.com/${c.handle}/"]`).count(), 1);
      assert.equal(await page.getByText("연결 전", { exact: true }).count(), 4);
      await page.getByRole("button", { name: "이 계정 연결하기", exact: true }).first().click();
      await page.getByRole("button", { name: "이미 발급한 토큰으로 연결", exact: true }).click();
      assert.equal(await page.getByLabel("게시할 계정").inputValue(), "highscoop.official");
      assert.equal(await page.getByLabel("게시할 계정").getAttribute("readonly"), "");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `settings overflow at ${width}px`);
      await page.screenshot({ path: `test-results/mobile/accounts-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      console.log(`WebKit ${width}px: date/buttons, checkbox tap, channel collection, four account routes passed`);
    } catch (e) {
      console.error(JSON.stringify({ width, errors, writes, controls: await page.locator('.collection-toolbar, .collection-summary input[type="checkbox"]').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, checked: n.checked, rect: n.getBoundingClientRect().toJSON() }))) }));
      await page.screenshot({ path: `test-results/mobile/failure-${width}.png`, fullPage: true });
      throw e;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
