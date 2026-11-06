// Built application, authenticated metadata fixtures, no provider/AI/publishing calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { preview } from 'vite';
import { emptyStudioCard } from '../shared/studio.ts';
import { emptyPayload } from '../shared/payloads.ts';
import { cardCopyFixture } from '../tests/fixtures/cardCopy.ts';

const require = createRequire(import.meta.url); let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '/nonexistent'] })); }
const output = path.resolve('test-results/asset-library-browser'); await mkdir(output, { recursive: true }); await writeFile(`${output}/results.json`, '[]');
const server = await preview({ preview: { host: '127.0.0.1', port: 4179, strictPort: true } });
const origin = 'http://127.0.0.1:4179', stamp = '2026-11-06T03:00:00.000Z';
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
    else if (p === '/api/channels/1/templates') data = { current: 'set:n03', items: [] };
    else return false;
    await route.fulfill({ json: structuredClone(data) }); return true;
  }
  return { route, writes, queries, card: () => card };
}
async function hit(page, locator, width) { await locator.scrollIntoViewIfNeeded(); const r = await locator.boundingBox(); assert(r && r.width >= 48 && (width >= 768 || r.height >= 48), '48px mobile interaction'); assert(await locator.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'visible reachable interaction'); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow'); }
let browser, engine = 'WebKit'; const results = [];
try {
  try { browser = await playwright.webkit.launch(); } catch (error) { if (process.env.CI) throw error; engine = 'Chromium'; browser = await playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE } : {}) }); }
  for (const width of (process.env.ASSET_LIBRARY_WIDTHS ? process.env.ASSET_LIBRARY_WIDTHS.split(',').map(Number) : [320, 393, 1280])) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('spacepenguin.channel', '1')); context.setDefaultTimeout(20_000);
    const page = await context.newPage(), fixtureState = fixture(), errors = [], external = [], requests = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await context.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin !== origin) { external.push(url.href); return route.abort('blockedbyclient'); } if (!url.pathname.startsWith('/api/')) return route.continue(); requests.push({ path: url.pathname, method: route.request().method() }); try { if (await fixtureState.route(route, url) !== false) return; errors.push(`Unmocked API ${url.pathname}`); return route.fulfill({ status: 404, json: { error: 'Isolated asset fixture' } }); } catch (error) { errors.push(`${url.pathname}: ${error.message}`); return route.fulfill({ status: 500, json: { error: error.message } }); } });
    try {
      await page.goto(`${origin}/assets?tab=results`); const gallery = page.locator('.asset-results'); await gallery.getByRole('heading', { name: '승인 이미지·저장 영상', exact: true }).waitFor();
      for (const label of ['채널', '결과 종류', '기록 범위', '콘텐츠·파일 이름']) await hit(page, gallery.getByLabel(label, { exact: true }), width);
      await gallery.getByLabel('채널', { exact: true }).selectOption('2'); await gallery.getByRole('button', { name: '대조할 승인 이미지 2 · 승인 이미지 비교', exact: true }).waitFor(); assert(new URL(page.url()).pathname === '/assets', 'channel switch must retain Assets');
      await gallery.getByLabel('채널', { exact: true }).selectOption('1');
      await gallery.getByLabel('결과 종류', { exact: true }).selectOption('image'); await gallery.getByLabel('기록 범위', { exact: true }).selectOption('history'); await gallery.getByLabel('콘텐츠·파일 이름', { exact: true }).fill('과거'); await gallery.getByRole('button', { name: '결과 찾기', exact: true }).click();
      await gallery.getByRole('button', { name: '다음 결과', exact: true }).click(); const card = gallery.getByRole('button', { name: '과거 작업 승인 이미지 · 승인 이미지 비교', exact: true }); await card.waitFor(); await hit(page, card, width); await card.click();
      const detail = gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }); await detail.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.asset-result-comparison img')].length === 2 && [...document.querySelectorAll('.asset-result-comparison img')].every(image => image.complete && image.naturalWidth === 1080)); await noOverflow(page);
      await detail.screenshot({ path: `${output}/${width}-selected-current.png` });
      const history = detail.getByRole('link', { name: '저장 작업 버전 비교', exact: true }); await hit(page, history, width); await history.click(); await page.getByRole('heading', { name: '저장 작업 버전 비교', exact: true }).waitFor(); await page.getByText('과거 완성 이미지 작업', { exact: true }).waitFor();
      assert.equal(fixtureState.writes.length, 0, 'history URL entry must not write');
      const title = page.getByRole('textbox', { name: '게시물 제목', exact: true }); await title.fill('보존할 임시 제목'); const restore = page.getByRole('button', { name: '이 작업을 새 초안으로 복원', exact: true }); await hit(page, restore, width); await restore.click(); await page.getByRole('button', { name: '머무르기', exact: true }).click(); assert.equal(await title.inputValue(), '보존할 임시 제목'); assert.equal(fixtureState.writes.length, 0);
      await restore.click(); await page.getByRole('button', { name: '버리고 이동', exact: true }).click(); const confirm = page.getByRole('button', { name: '확인 후 새 초안으로 복원', exact: true }); await confirm.waitFor(); assert.equal(fixtureState.writes.length, 0); await hit(page, confirm, width); await confirm.click(); await page.getByText('작업 v1을 새 초안 v71으로 복원했습니다. 다시 검토하고 승인해 주세요.', { exact: true }).waitFor(); assert.equal(fixtureState.card().finishedDeck.pages[0].imageId, 20); assert.equal(fixtureState.card().sourceItemId, 90); assert.deepEqual(fixtureState.writes.map(row => row.path), ['/api/studio/cards/8/restore']);
      await page.goBack(); await gallery.waitFor(); assert.equal(await gallery.getByLabel('결과 종류', { exact: true }).inputValue(), 'image'); assert.equal(await gallery.getByLabel('기록 범위', { exact: true }).inputValue(), 'history'); assert.equal(await gallery.getByLabel('콘텐츠·파일 이름', { exact: true }).inputValue(), '과거'); await gallery.getByText('2페이지', { exact: true }).waitFor(); await gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }).waitFor();
      await gallery.getByRole('button', { name: '이전 결과', exact: true }).click(); await gallery.getByRole('button', { name: '대조할 승인 이미지 1 · 승인 이미지 비교', exact: true }).click(); await gallery.getByRole('link', { name: '원고 버전 비교', exact: true }).click(); await page.getByRole('heading', { name: '원고 버전 비교', exact: true }).waitFor(); await page.getByText('과거 원고 질문', { exact: true }).waitFor(); assert(await page.locator('.source-revision-history').evaluate(node => node.closest('details').open), 'source deep link opens history drawer'); assert.equal(fixtureState.writes.filter(row => !row.path.endsWith('/card-copy/preview')).length, 1, 'source URL cannot restore');
      // The editor starts its local preview after a debounce. A missing image
      // cannot prove settlement; require the current decoded output first.
      await page.locator('.card-copy-editor .card-copy-preview').first().scrollIntoViewIfNeeded();
      await page.waitForFunction(async () => {
        const selector = '.card-copy-editor .card-copy-preview:not(.is-stale)[aria-busy="false"] img';
        const image = document.querySelector(selector);
        if (!image?.complete || image.naturalWidth !== 1080 || image.naturalHeight !== 1350) return false;
        const source = image.currentSrc || image.src;
        try { await image.decode(); } catch { return false; }
        return image === document.querySelector(selector) && (image.currentSrc || image.src) === source
          && image.complete && image.naturalWidth === 1080 && image.naturalHeight === 1350;
      });
      await page.waitForLoadState('networkidle'); await page.goBack(); await gallery.waitFor();
      await gallery.getByLabel('결과 종류', { exact: true }).selectOption('video'); await gallery.getByRole('button', { name: '저장한 원본 장면 영상 · 저장 영상 비교', exact: true }).waitFor(); assert.equal(await gallery.locator('video').count(), 0, 'gallery video thumbnails never fetch video bodies'); assert.equal(requests.filter(row => row.path === '/api/studio/media/60').length, 0);
      await gallery.getByRole('button', { name: '저장한 원본 장면 영상 · 저장 영상 비교', exact: true }).click(); const player = gallery.getByRole('region', { name: '선택한 결과 비교', exact: true }).locator('video'); await player.waitFor(); assert.equal(await player.getAttribute('preload'), 'none'); assert.equal(await player.getAttribute('autoplay'), null); assert.equal(await player.getAttribute('src'), '/api/studio/media/60?download=1'); await gallery.getByText('현재 버전에는 연결된 완성 결과가 없습니다. 이전 파일로 대신 표시하지 않습니다.', { exact: true }).waitFor();
      await noOverflow(page); await gallery.screenshot({ path: `${output}/${width}-saved-video-poster.png` }); assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ width, engine, result: 'pass', channelStaysInAssets: true, contextRestored: true, exactOldRevisionGet: true, guardedExplicitRestoreOnly: true, sourceHistoryReadOnly: true, videoPosterOnly: true, writes: fixtureState.writes, screenshots: [`${output}/${width}-selected-current.png`, `${output}/${width}-saved-video-poster.png`] });
    } catch (error) { await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true }); await writeFile(`${output}/${width}-failure.html`, await page.content()); results.push({ width, engine, result: 'fail', error: error.message, errors, external, requests, writes: fixtureState.writes, queries: fixtureState.queries }); throw error; }
    finally { await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); await context.close(); }
  }
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await server.httpServer.close(); }
