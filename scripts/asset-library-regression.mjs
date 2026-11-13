// Built application, authenticated metadata fixtures, no provider/AI/publishing calls.
import assert from 'node:assert/strict';
import { editorialTemplateCatalogOptions } from '../shared/templateCatalog.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { preview } from 'vite';
import { emptyStudioCard } from '../shared/studio.ts';
import { emptyPayload } from '../shared/payloads.ts';
import { cardCopyFixture } from '../tests/fixtures/cardCopy.ts';

const require = createRequire(import.meta.url); let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '/nonexistent'] })); }
const output = path.resolve('test-results/asset-library-browser'); await mkdir(output, { recursive: true }); await writeFile(`${output}/results.json`, '[]');
const origin = 'http://127.0.0.1:4179', stamp = '2026-11-06T03:00:00.000Z';
const videoFixturePath = '/api/studio/media/60?download=1';
// Offline-generated #32756b, silent64x64/0.2s/5-frame baseline H264. This is
// synthetic test footage, not an app-generated output or a publication receipt.
const syntheticMp4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM6bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmR0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAAAAABAAAAAAHcbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABh21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUdzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBQsAe/+EAGGdCwB6mERCbARAAAAMAEAAAAwMg8WLhGAEABmjIQgksgAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAG5QAABuUAAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAACmQAAAAoAAAAKAAAACgAAAAsAAAAUc3RjbwAAAAAAAAABAAADagAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAALKbWRhdAAAAnMGBf//b9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxNzIgYzFjOTkzMSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0xNiBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTMxIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTI4LjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAeZYiCBniMUAAQz44ABqOAAINt999dddddddddddeAAAAABkGaHAzwjAAAAAZBmioC/CMAAAAGQZo7AvwjAAAAB0GaSQCvCMA=', 'base64');
const syntheticMp4Sha256 = 'c7ed4bf464ac52c6f0916ee8ab92c01c33080c29ce528a78ed2945a97cf7ab09';
assert.equal(syntheticMp4.length, 1580); assert.equal(createHash('sha256').update(syntheticMp4).digest('hex'), syntheticMp4Sha256);
function syntheticVideoResponse(request, response, next) {
  if (request.url !== videoFixturePath || !['GET', 'HEAD'].includes(request.method)) return next();
  const size = syntheticMp4.length;
  response.setHeader('Content-Type', 'video/mp4'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store');
  let start = 0, end = size - 1;
  if (request.method === 'GET' && request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    let valid = !!match && (match[1] !== '' || match[2] !== '');
    if (valid) {
      if (match[1] === '') { const suffix = Number(match[2]); valid = Number.isSafeInteger(suffix) && suffix > 0; start = Math.max(0, size - suffix); }
      else { start = Number(match[1]); end = match[2] === '' ? size - 1 : Number(match[2]); valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < size && end >= start; end = Math.min(end, size - 1); }
    }
    if (!valid) { response.statusCode = 416; response.setHeader('Content-Range', `bytes */${size}`); response.setHeader('Content-Length', '0'); return response.end(); }
    response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  const bytes = syntheticMp4.subarray(start, end + 1);
  response.setHeader('Content-Length', String(bytes.length)); response.end(request.method === 'HEAD' ? undefined : bytes);
}
// configurePreviewServer runs before Vite's proxy middleware. Native WebKit
// media requests can bypass Playwright's route interception, so use real local
// HTTP for this single known synthetic file; every other API stays isolated.
const server = await preview({ plugins: [{ name: 'asset-library-synthetic-video', configurePreviewServer(server) { server.middlewares.use(syntheticVideoResponse); } }], preview: { host: '127.0.0.1', port: 4179, strictPort: true } });
async function verifySyntheticVideoHttp() {
  const url = `${origin}${videoFixturePath}`;
  for (const [range, start, end] of [[null, 0, 1579], ['bytes=0-31', 0, 31], ['bytes=1500-', 1500, 1579], ['bytes=-16', 1564, 1579]]) {
    const response = await fetch(url, range ? { headers: { range } } : {});
    assert.equal(response.status, range ? 206 : 200); assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    if (range) assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/1580`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticMp4.subarray(start, end + 1));
  }
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '1580'); assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const range of ['bytes=1580-', 'bytes=12-3', 'bytes=0-1,4-5', 'bytes=-0']) {
    const response = await fetch(url, { headers: { range } }); assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */1580'); assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
}
const ai = { defaultProvider: 'gemini', text: { gemini: false, openai: false, anthropic: false }, image: false };
const channels = [{ id: 1, slug: 'current-dialogue', name: '대화 채널', active: true, version: 1, contentType: 'current_dialogue', accentColor: '#32756b', categories: [] }, { id: 2, slug: 'space-penguin', name: '펭귄 채널', active: true, version: 1, contentType: 'science_dialogue', accentColor: '#426b91', categories: [] }];
const pictures = await Promise.all(['#d8e9e4', '#e9dcbb'].map(async (color, index) => sharp(Buffer.from(`<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="1350" fill="${color}"/><text x="100" y="300" font-size="100">SAVED ${index + 1}</text></svg>`)).jpeg().toBuffer()));
function fixture() {
  let card = { ...emptyStudioCard(), id: 8, title: '현재 완성 이미지 작업', channel: 'news', version: 70, sourceItemId: 90, createdAt: stamp, updatedAt: stamp, finishedDeck: { pages: [{ imageId: 50, name: 'current.jpg', altText: '현재 저장된 이미지입니다.' }] }, sourceOutput: { assetId: 100, channelId: 1, itemId: 90, revisionId: 91, stale: false, pages: [{ id: 100, title: '발행 결과' }], coverCredit: '' } };
  const revision = { id: 2, cardId: 8, version: 1, snapshot: { ...emptyStudioCard(), channel: 'news', title: '과거 완성 이미지 작업', finishedDeck: { pages: [{ imageId: 20, name: 'old.jpg', altText: '과거에 저장한 이미지입니다.' }] } }, instruction: '직접 저장', provider: null, model: null, applied: true, createdAt: stamp };
  const currentSource = { id: 4, revisionNo: 2, author: 'operator', createdAt: stamp, payload: { ...emptyPayload('science_dialogue', '현재 원고'), key_question: '현재 질문', cardCopy: cardCopyFixture('set:n03') } };
  const oldSource = { ...structuredClone(currentSource), id: 3, contentItemId: 9, revisionNo: 1, payload: { ...structuredClone(currentSource.payload), key_question: '과거 원고 질문' } };
  const writes = [], queries = [];
  const image = (cid, id = 40, studio = false) => ({ key: `image:${cid}:${id}`, kind: 'image', assetId: id, title: studio ? '과거 작업 승인 이미지' : `대조할 승인 이미지 ${cid}`, name: 'approved.jpg', channelId: cid, channelName: channels[cid - 1].name, createdAt: stamp, mimeType: 'image/jpeg', sha256: 'a'.repeat(64), width: 1080, height: 1350, pageCount: 8, previewUrl: `/api/channels/${cid}/media/${id}`, downloadUrl: `/api/channels/${cid}/media/${id}?download=1`, bundleDownloadUrl: `/api/channels/${cid}/media/${id}/deck.zip`, current: false, approval: { id: 10, status: 'invalidated', approvedAt: stamp, approvedBy: 'QA 운영자' }, source: { itemId: studio ? 90 : 9, sourceRevisionId: studio ? 91 : 3, sourceRevisionNo: 1, studioCardId: 8, studioRevisionId: studio ? 2 : null, studioVersion: studio ? 1 : null, currentVersion: studio ? card.version : 4 }, editorUrl: studio ? '/studio/8' : `/items/${cid}/9`, historyUrl: studio ? '/studio/8?tab=history&revision=2' : `/items/${cid}/9?tab=history&revision=3`, currentPreview: { assetId: 41, kind: 'image', previewUrl: `/api/channels/${cid}/media/41`, downloadUrl: `/api/channels/${cid}/media/41?download=1`, mimeType: 'image/jpeg', sourceRevisionId: 4, studioVersion: null, approvalStatus: null } });
  async function route(route, url) {
    const method = route.request().method(), p = url.pathname, body = route.request().postData() ? route.request().postDataJSON() : undefined; let data;
    if (method !== 'GET') writes.push({ path: p, method, body });
    if (p === '/api/auth/me') data = { user: 'asset-browser-qa', csrf: 'fixture', demo: false, recoveryScope: 'assets-20261106', authConfigured: true, demoAllowed: false };
    else if (p === '/api/channels') data = channels;
    else if (/^\/api\/channels\/\d+\/today$/.test(p)) data = { counts: { pendingReview: 0 } };
    else if (p === '/api/status') data = { globalStop: false, workerConnected: true, integrations: { flags: { dryRun: true, autoPublish: false } } };
    else if (p === '/api/assets/library') {
      const query = Object.fromEntries(url.searchParams); queries.push(query); const cid = query.channelId === '2' ? 2 : 1, offset = Number(query.offset || 0);
      if (query.kind === 'video') data = { items: [{ ...image(cid, 60), key: `video:${cid}:60`, kind: 'video', title: '저장한 원본 장면 영상', mimeType: 'video/mp4', pageCount: 1, approval: null, current: true, previewUrl: '/api/assets/library/videos/60/preview', downloadUrl: '/api/studio/media/60?download=1', bundleDownloadUrl: null, currentPreview: null }], hasMore: false, nextOffset: null, filters: query };
      else data = { items: [image(cid, offset ? 64 : 40, offset > 0)], hasMore: offset === 0, nextOffset: offset === 0 ? 24 : null, filters: query };
    }
    else if (/^\/api\/(?:channels\/\d+\/media\/\d+|studio\/images\/\d+|assets\/library\/videos\/\d+\/preview)$/.test(p)) return route.fulfill({ contentType: 'image/jpeg', body: pictures[/\/(?:41|50)$/.test(p) ? 1 : 0] });
    else if (p === '/api/studio/ai-status') data = ai;
    else if (p === '/api/canva/status') data = { connected: false };
    else if (p === '/api/studio/instagram/oauth/config') data = { configured: false, reason: 'isolated_fixture' };
    else if (p === '/api/studio/cards' && method === 'GET') data = { cards: [card], revisions: [], ai, notes: '', notesVersion: 1 };
    else if (p === '/api/studio/cards/8' && method === 'GET') data = { card, revisions: [], jobs: [] }; // exact RID is older than the recent list
    else if (p === '/api/studio/cards/8/revisions/2') data = revision;
    else if (p === '/api/studio/cards/8/restore' && method === 'POST') { assert.deepEqual(body, { version: card.version, revisionId: 2 }); card = { ...card, ...structuredClone(revision.snapshot), version: card.version + 1 }; data = card; }
    else if (p === '/api/studio/cards/8/publication') data = { channelId: 1, channelName: channels[0].name, expectedUsername: null, ready: false, blockers: ['QA 자료 · 게시 금지'], dailyLimit: 0, dryRun: true, autoPublish: false, destinations: [], deliveries: [], publicationDraft: { version: 0 } };
    else if (p === '/api/channels/1/items/9') data = { item: { id: 9, channelId: 1, title: '원고 버전 확인', origin: 'manual', kind: 'science_dialogue', version: 4, currentRevisionId: 4, reviewStatus: 'pending', evidenceStatus: 'needs_review', relevance: 'relevant', publishStatus: 'waiting', excluded: false, edited: currentSource.payload }, current: currentSource, revisions: [currentSource], primary: null, linked: [], cards: [], approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: '', telegram: '' }, publicationDraft: { version: 0, captions: { instagram: '', telegram: '' }, options: { destinationIds: [], timing: 'now', scheduledAtKst: '' } }, publicationReadiness: { ready: false, blockers: ['게시 금지'], destinations: [], dryRun: true, autoPublish: false } };
    else if (p === '/api/channels/1/items/9/revisions/3') data = oldSource;
    else if (p === '/api/channels/1/items/9/card-copy' && method === 'GET') data = { version: 4, revisionId: 4, hasSavedCopy: true, copy: currentSource.payload.cardCopy };
    else if (p === '/api/channels/1/items/9/card-copy/preview' && method === 'POST') return route.fulfill({ contentType: 'image/jpeg', body: pictures[1] });
    else if (p === '/api/channels/1/templates') data = { current: 'editorial:cyan', items: editorialTemplateCatalogOptions({slug:'news',name:'알리고당'}) };
    else if (p === '/api/channels/1/templates/preview') return route.fulfill({contentType:'image/jpeg',body:pictures[1]});
    else return false;
    await route.fulfill({ json: structuredClone(data) }); return true;
  }
  return { route, writes, queries, card: () => card };
}
async function hit(page, locator, width) { await locator.scrollIntoViewIfNeeded(); const r = await locator.boundingBox(); assert(r && r.width >= 48 && (width >= 768 || r.height >= 48), '48px mobile interaction'); assert(await locator.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'visible reachable interaction'); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow'); }
const settlementRemaining = deadline => {
  const remaining = deadline - Date.now();
  assert(remaining > 0, 'current asset images and local API completion must settle within 20 seconds');
  return remaining;
};
function createAssetLifecycle(record) {
  const requests = new Map(), producers = new Map(), waiters = new Set();
  let sequence = 0, generation = 0;
  const snapshot = () => ({ requests: [...requests.values()], producers: [...producers.values()] });
  const changed = () => { generation++; for (const notify of [...waiters]) notify(); };
  const describe = request => ({ id: ++sequence, method: request.method(), url: request.url() });
  const empty = () => requests.size === 0 && producers.size === 0;
  return {
    snapshot, empty, get generation() { return generation; }, domChanged: changed,
    startRequest(request) { const detail = describe(request); requests.set(request, detail); record('api-transport-start', detail); changed(); },
    finishRequest(request, error = null) {
      const detail = requests.get(request); if (!detail) return;
      requests.delete(request); record('api-transport-finished', { ...detail, error }); changed();
    },
    startProducer(request) { const detail = requests.get(request) ?? describe(request); producers.set(request, detail); record('api-producer-start', detail); changed(); },
    finishProducer(request) {
      const detail = producers.get(request); if (!detail) return;
      producers.delete(request); record('api-producer-finished', detail); changed();
    },
    waitForEmpty(deadline) {
      if (empty()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = () => { if (!empty()) return; clearTimeout(timer); waiters.delete(finish); resolve(); };
        const timer = setTimeout(() => { waiters.delete(finish); reject(new Error(`Local API work remains before asset navigation: ${JSON.stringify(snapshot())}`)); }, settlementRemaining(deadline));
        waiters.add(finish); finish();
      });
    },
    waitForQuiet(deadline) {
      // This is a new event-interruptible window, not a latched networkidle.
      // The source editor can schedule another preview after its450ms effect.
      return new Promise((resolve, reject) => {
        const remaining = settlementRemaining(deadline), startedAt = Date.now();
        const finish = quiet => { clearTimeout(timer); waiters.delete(interrupted); record('asset-quiet-window', { quiet, elapsedMs: Date.now() - startedAt, generation, ...snapshot() }); resolve(quiet); };
        const interrupted = () => finish(false);
        const timer = setTimeout(() => {
          if (remaining < 500) { waiters.delete(interrupted); reject(new Error('Asset images did not remain quiet within the shared20-second deadline')); }
          else finish(true);
        }, Math.min(500, remaining));
        waiters.add(interrupted);
      });
    },
  };
}
async function currentAssetImagesReady(mode) {
  const selector = mode === 'source' ? '.card-copy-editor' : mode === 'studio' ? '.studio-history-entry' : '.asset-results';
  const scopes = [...document.querySelectorAll(selector)];
  if (scopes.length !== 1) return false;
  const scope = scopes[0], generation = window.__assetReadinessGeneration;
  const figure = mode === 'source' ? scope.querySelector('.card-copy-preview') : null;
  if (mode === 'source' && (!figure || !figure.matches(':not(.is-stale)[aria-busy="false"]'))) return false;
  const visible = image => { const rect = image.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; };
  // Lazy images outside the viewport have no active visual consumer yet.
  const images = mode === 'source' ? [...figure.querySelectorAll('img')] : [...scope.querySelectorAll('img')].filter(visible);
  if (mode === 'source' && images.length !== 1) return false;
  const current = () => scope.isConnected && document.querySelector(selector) === scope
    && generation === window.__assetReadinessGeneration
    && (mode !== 'source' || figure.isConnected && figure.matches(':not(.is-stale)[aria-busy="false"]') && figure.querySelector('img') === images[0]);
  for (const image of images) {
    const source = image.currentSrc || image.src;
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
    if ((mode === 'source' || image.closest('.asset-result-comparison')) && (image.naturalWidth !== 1080 || image.naturalHeight !== 1350)) return false;
    try { await image.decode(); } catch { return false; }
    if (!current() || !image.isConnected || !scope.contains(image) || (image.currentSrc || image.src) !== source) return false;
  }
  return current();
}
async function settleAssetNavigation(page, lifecycle, record, mode, label, deadline = Date.now() + 20_000) {
  const startedAt = deadline - 20_000;
  while (true) {
    await lifecycle.waitForEmpty(deadline);
    await page.waitForFunction(currentAssetImagesReady, mode, { timeout: settlementRemaining(deadline) });
    const quietDomGeneration = await page.evaluate(() => window.__assetReadinessGeneration);
    if (!lifecycle.empty() || !await lifecycle.waitForQuiet(deadline)) continue;
    const generation = lifecycle.generation;
    const dom = await page.evaluate(() => ({ generation: window.__assetReadinessGeneration, href: location.href }));
    await page.waitForFunction(currentAssetImagesReady, mode, { timeout: settlementRemaining(deadline) });
    const current = await page.evaluate(() => ({ generation: window.__assetReadinessGeneration, href: location.href }));
    if (!lifecycle.empty() || generation !== lifecycle.generation || quietDomGeneration !== dom.generation || dom.generation !== current.generation || dom.href !== current.href) continue;
    settlementRemaining(deadline);
    record('asset-navigation-settled', { label, mode, currentReady: true, quietWindowMs: 500, generation, dom, settlementElapsedMs: Date.now() - startedAt, ...lifecycle.snapshot() });
    return;
  }
}
let browser, engine = 'WebKit'; const results = [];
try {
  await verifySyntheticVideoHttp();
  try { browser = await playwright.webkit.launch(); } catch (error) { if (process.env.CI) throw error; engine = 'Chromium'; browser = await playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE } : {}) }); }
  for (const width of (process.env.ASSET_LIBRARY_WIDTHS ? process.env.ASSET_LIBRARY_WIDTHS.split(',').map(Number) : [320, 393, 1280])) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('spacepenguin.channel', '1')); context.setDefaultTimeout(20_000);
    const page = await context.newPage(), fixtureState = fixture(), errors = [], external = [], requests = [], diagnostics = [], requestFailures = [];
    const startedAt = Date.now(), requestStarts = new WeakMap(); let stage = 'opening', scenarioError = null;
    const record = (kind, detail = {}) => diagnostics.push({ kind, stage, at: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...detail });
    const mark = name => { stage = name; record('stage'); };
    const lifecycle = createAssetLifecycle(record);
    await page.exposeBinding('__assetReadinessChanged', () => lifecycle.domChanged());
    await page.addInitScript(() => {
      window.__assetReadinessGeneration = 0;
      const scope = '.card-copy-editor, .asset-results, .studio-history-entry';
      const withinScope = node => node instanceof Element && (node.matches(scope) || !!node.closest(scope) || !!node.querySelector(scope));
      const changed = () => {
        window.__assetReadinessGeneration++;
        // Closing a document can cancel this diagnostic bridge. Product errors
        // still reach the unchanged fatal console/pageerror handlers below.
        void window.__assetReadinessChanged().catch(() => {});
      };
      new MutationObserver(records => {
        if (records.some(record => withinScope(record.target) || [...record.addedNodes, ...record.removedNodes].some(withinScope))) changed();
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'aria-busy'] });
      for (const event of ['load', 'error']) document.addEventListener(event, value => {
        if (value.target instanceof HTMLImageElement && value.target.closest(scope)) changed();
      }, { capture: true, passive: true });
    });
    const tracedRequest = request => request.url().includes('/api/') || ['image', 'media', 'fetch'].includes(request.resourceType());
    // Native media loaders can reach the local preview server without emitting
    // Playwright request events. Observe only; do not serve or alter a response.
    const observePreviewRequest = (request, response) => {
      if (!request.url?.startsWith('/api/')) return;
      const detail = { url: new URL(request.url, origin).href, method: request.method, resourceType: 'preview-http', range: request.headers.range ?? null, startedStage: stage, startedElapsedMs: Date.now() - startedAt };
      record('preview-http-request', detail);
      response.once('finish', () => record('preview-http-response', { ...detail, status: response.statusCode }));
      request.once('aborted', () => record('preview-http-aborted', detail));
    };
    server.httpServer.on('request', observePreviewRequest);
    page.on('request', request => {
      const detail = { url: request.url(), method: request.method(), resourceType: request.resourceType(), startedStage: stage, startedElapsedMs: Date.now() - startedAt };
      requestStarts.set(request, detail); if (tracedRequest(request)) record('request', detail);
      const url = new URL(request.url()); if (url.origin === origin && url.pathname.startsWith('/api/')) lifecycle.startRequest(request);
    });
    page.on('requestfinished', request => { lifecycle.finishRequest(request); if (tracedRequest(request)) record('requestfinished', requestStarts.get(request)); });
    page.on('requestfailed', request => { const detail = { ...requestStarts.get(request), url: request.url(), method: request.method(), resourceType: request.resourceType(), error: request.failure()?.errorText ?? null }; lifecycle.finishRequest(request, detail.error); requestFailures.push(detail); record('requestfailed', detail); });
    page.on('response', response => { if (response.status() >= 400) record('http-error', { ...requestStarts.get(response.request()), url: response.url(), status: response.status() }); });
    page.on('pageerror', error => { errors.push(error.message); record('pageerror', { message: error.message }); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); record('console-error', { message: message.text(), location: message.location() }); } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort('blockedbyclient'); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push({ path: url.pathname, method: route.request().method() });
      if (`${url.pathname}${url.search}` === videoFixturePath && ['GET', 'HEAD'].includes(route.request().method())) return route.continue();
      const producer = route.request(); lifecycle.startProducer(producer);
      try { if (await fixtureState.route(route, url) !== false) return; errors.push(`Unmocked API ${url.pathname}`); return await route.fulfill({ status: 404, json: { error: 'Isolated asset fixture' } }); }
      catch (error) { errors.push(`${url.pathname}: ${error.message}`); return await route.fulfill({ status: 500, json: { error: error.message } }); }
      finally { lifecycle.finishProducer(producer); }
    });
    try {
      mark('initial gallery'); await page.goto(`${origin}/assets?tab=results`); const gallery = page.locator('.asset-results'); await gallery.getByRole('heading', { name: '승인 이미지·저장 영상', exact: true }).waitFor();
      for (const label of ['채널', '결과 종류', '기록 범위', '콘텐츠·파일 이름']) await hit(page, gallery.getByLabel(label, { exact: true }), width);
      mark('switch to channel 2'); await gallery.getByLabel('채널', { exact: true }).selectOption('2'); await gallery.getByRole('button', { name: '대조할 승인 이미지 2 · 승인 이미지 비교', exact: true }).waitFor(); assert(new URL(page.url()).pathname === '/assets', 'channel switch must retain Assets');
      mark('switch to channel 1'); await gallery.getByLabel('채널', { exact: true }).selectOption('1');
      mark('filter historical images');
      await gallery.getByLabel('결과 종류', { exact: true }).selectOption('image'); await gallery.getByLabel('기록 범위', { exact: true }).selectOption('history'); await gallery.getByLabel('콘텐츠·파일 이름', { exact: true }).fill('과거'); await gallery.getByRole('button', { name: '결과 찾기', exact: true }).click();
      await gallery.getByRole('button', { name: '다음 결과', exact: true }).click(); const card = gallery.getByRole('button', { name: '과거 작업 승인 이미지 · 승인 이미지 비교', exact: true }); await card.waitFor(); await hit(page, card, width); await card.click();
      mark('selected image comparison'); const detail = gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }); await detail.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.asset-result-comparison img')].length === 2 && [...document.querySelectorAll('.asset-result-comparison img')].every(image => image.complete && image.naturalWidth === 1080)); await noOverflow(page);
      await detail.screenshot({ path: `${output}/${width}-selected-current.png` });
      mark('open Studio version history'); const history = detail.getByRole('link', { name: '저장 작업 버전 비교', exact: true }); await hit(page, history, width); await settleAssetNavigation(page, lifecycle, record, 'gallery', 'gallery to Studio history'); await history.click(); await page.getByRole('heading', { name: '저장 작업 버전 비교', exact: true }).waitFor(); await page.getByText('과거 완성 이미지 작업', { exact: true }).waitFor();
      assert.equal(fixtureState.writes.length, 0, 'history URL entry must not write');
      mark('dirty restore cancellation'); const title = page.getByRole('textbox', { name: '게시물 제목', exact: true }); await title.fill('보존할 임시 제목'); const restore = page.getByRole('button', { name: '이 작업을 새 초안으로 복원', exact: true }); await hit(page, restore, width); await restore.click(); await page.getByRole('button', { name: '머무르기', exact: true }).click(); assert.equal(await title.inputValue(), '보존할 임시 제목'); assert.equal(fixtureState.writes.length, 0);
      mark('explicit Studio restore');
      await restore.click(); await page.getByRole('button', { name: '버리고 이동', exact: true }).click(); const confirm = page.getByRole('button', { name: '확인 후 새 초안으로 복원', exact: true }); await confirm.waitFor(); assert.equal(fixtureState.writes.length, 0); await hit(page, confirm, width); await confirm.click(); await page.getByText('작업 v1을 새 초안 v71으로 복원했습니다. 다시 검토하고 승인해 주세요.', { exact: true }).waitFor(); assert.equal(fixtureState.card().finishedDeck.pages[0].imageId, 20); assert.equal(fixtureState.card().sourceItemId, 90); assert.deepEqual(fixtureState.writes.map(row => row.path), ['/api/studio/cards/8/restore']);
      mark('return from Studio history'); await settleAssetNavigation(page, lifecycle, record, 'studio', 'Studio history to gallery'); await page.goBack(); await gallery.waitFor(); assert.equal(await gallery.getByLabel('결과 종류', { exact: true }).inputValue(), 'image'); assert.equal(await gallery.getByLabel('기록 범위', { exact: true }).inputValue(), 'history'); assert.equal(await gallery.getByLabel('콘텐츠·파일 이름', { exact: true }).inputValue(), '과거'); await gallery.getByText('2페이지', { exact: true }).waitFor(); await gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }).waitFor();
      mark('open source revision history'); await gallery.getByRole('button', { name: '이전 결과', exact: true }).click(); await gallery.getByRole('button', { name: '대조할 승인 이미지 1 · 승인 이미지 비교', exact: true }).click(); await settleAssetNavigation(page, lifecycle, record, 'gallery', 'gallery to source history'); await gallery.getByRole('link', { name: '원고 버전 비교', exact: true }).click(); await page.getByRole('heading', { name: '원고 버전 비교', exact: true }).waitFor(); await page.getByText('과거 원고 질문', { exact: true }).waitFor(); assert(await page.locator('.source-revision-history').evaluate(node => node.closest('details').open), 'source deep link opens history drawer'); assert.equal(fixtureState.writes.filter(row => !row.path.endsWith('/card-copy/preview')).length, 1, 'source URL cannot restore');
      // The editor starts its local preview after a debounce. A missing image
      // cannot prove settlement; require the current decoded output first.
      mark('wait for current source preview'); const sourceDeadline = Date.now() + 20_000; await page.locator('.card-copy-editor .card-copy-preview').first().scrollIntoViewIfNeeded({ timeout: settlementRemaining(sourceDeadline) });
      await page.waitForFunction(async () => {
        const selector = '.card-copy-editor .card-copy-preview:not(.is-stale)[aria-busy="false"] img';
        const image = document.querySelector(selector);
        if (!image?.complete || image.naturalWidth !== 1080 || image.naturalHeight !== 1350) return false;
        const source = image.currentSrc || image.src;
        try { await image.decode(); } catch { return false; }
        return image === document.querySelector(selector) && (image.currentSrc || image.src) === source
          && image.complete && image.naturalWidth === 1080 && image.naturalHeight === 1350;
      }, undefined, { timeout: settlementRemaining(sourceDeadline) });
      await page.waitForLoadState('networkidle', { timeout: settlementRemaining(sourceDeadline) }); await settleAssetNavigation(page, lifecycle, record, 'source', 'source history to gallery', sourceDeadline); mark('return from source history'); await page.goBack(); await gallery.waitFor();
      mark('filter saved videos'); await gallery.getByLabel('결과 종류', { exact: true }).selectOption('video'); await gallery.getByRole('button', { name: '저장한 원본 장면 영상 · 저장 영상 비교', exact: true }).waitFor(); assert.equal(await gallery.locator('video').count(), 0, 'gallery video thumbnails never fetch video bodies'); assert.equal(requests.filter(row => row.path === '/api/studio/media/60').length, 0);
      assert.equal(diagnostics.filter(event => event.kind === 'preview-http-request' && event.url === `${origin}${videoFixturePath}`).length, 0, 'gallery must not fetch the video body through a native media loader');
      mark('select saved video'); await gallery.getByRole('button', { name: '저장한 원본 장면 영상 · 저장 영상 비교', exact: true }).click(); const player = gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }).locator('video'); await player.waitFor(); assert.equal(await player.getAttribute('preload'), 'none'); assert.equal(await player.getAttribute('autoplay'), null); assert.equal(await player.getAttribute('src'), '/api/studio/media/60?download=1'); await gallery.getByText('현재 버전에는 연결된 완성 결과가 없습니다. 이전 파일로 대신 표시하지 않습니다.', { exact: true }).waitFor();
      await noOverflow(page); await gallery.screenshot({ path: `${output}/${width}-saved-video-poster.png` }); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(requestFailures, []);
      results.push({ width, engine, result: 'pass', channelStaysInAssets: true, contextRestored: true, exactOldRevisionGet: true, guardedExplicitRestoreOnly: true, sourceHistoryReadOnly: true, videoPosterOnly: true, writes: fixtureState.writes, diagnostics, screenshots: [`${output}/${width}-selected-current.png`, `${output}/${width}-saved-video-poster.png`] });
    } catch (error) { scenarioError = error; try { await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true }); await writeFile(`${output}/${width}-failure.html`, await page.content()); } catch (captureError) { record('failure-capture-error', { message: captureError.message }); } results.push({ width, engine, result: 'fail', error: error.message, errors, external, requestFailures, requests, writes: fixtureState.writes, queries: fixtureState.queries, diagnostics }); throw error; }
    finally {
      let closeError = null;
      if (!scenarioError) {
        try { await settleAssetNavigation(page, lifecycle, record, 'gallery', 'successful context close'); }
        catch (error) { closeError = error; }
      }
      mark('closing browser context');
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      try { await context.close(); } catch (error) { closeError ??= error; }
      server.httpServer.off('request', observePreviewRequest);
      const result = results.at(-1), httpErrors = diagnostics.filter(event => event.kind === 'http-error' || event.kind === 'preview-http-response' && event.status >= 400);
      if (result?.result === 'pass') {
        result.videoHttpFixture = { synthetic: true, bytes: 1580, sha256: syntheticMp4Sha256, rangeContractVerified: true, nativeRequests: diagnostics.filter(event => event.kind === 'preview-http-request' && event.url === `${origin}${videoFixturePath}`), nativeResponses: diagnostics.filter(event => event.kind === 'preview-http-response' && event.url === `${origin}${videoFixturePath}`) };
        if (closeError || httpErrors.length || errors.length || external.length || requestFailures.length) {
          result.result = 'fail'; result.error = closeError?.message ?? 'Unexpected HTTP, console, request or external error including context close'; result.errors = errors; result.external = external; result.httpErrors = httpErrors; result.requestFailures = requestFailures;
          await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
          if (closeError) throw closeError;
          assert.deepEqual({ httpErrors, errors, external, requestFailures }, { httpErrors: [], errors: [], external: [], requestFailures: [] });
        }
      }
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
  }
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await server.httpServer.close(); }
