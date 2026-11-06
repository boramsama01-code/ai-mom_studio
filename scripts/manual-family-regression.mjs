// Built UI, actual production raster previews, isolated HTTP fixtures only.
// The supplied template/example is never treated as independently verified news.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';
import { familyManualCreateSchema } from '../shared/familyManual.ts';
import { resolveFamilyDisplay } from '../shared/familyDisplay.ts';
import { defaultPageDesigns, familyCardCopySchema, familyFieldDescriptors, familyFieldValue, FAMILY_PAGE_LABELS } from '../shared/familyDialogue.ts';
import { familyEvidenceView } from '../server/services/familyEvidence.ts';
import { planCarousel, renderCarouselPage } from '../server/services/cardCarousel.ts';
import { canvaLibraryStateFixture } from '../tests/fixtures/canvaTemplateLibrary.ts';

const require = createRequire(import.meta.url); let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '/nonexistent'] })); }
const example = familyManualCreateSchema.parse(JSON.parse(await readFile(new URL('../tests/fixtures/manualFamilyTemplateExample.json', import.meta.url), 'utf8')));
const output = path.resolve('test-results/manual-family'); await mkdir(output, { recursive: true }); await writeFile(`${output}/results.json`, '[]');
const server = await preview({ preview: { host: '127.0.0.1', port: 4178, strictPort: true } });
const origin = 'http://127.0.0.1:4178', stamp = '2026-11-06T03:00:00.000Z', itemPath = '/api/channels/3/items/39';
const roles = { summary: { provider: 'gemini', model: 'gemini-fixture-summary' }, copy: { provider: 'openai', model: 'gpt-fixture-copy' }, image: { provider: 'openai', model: 'gpt-image-fixture' } };
const ai = { defaultProvider: 'gemini', text: { gemini: false, openai: false, anthropic: false }, image: false };
const channels = [{ id: 3, slug: 'current-dialogue', name: 'ALLligodang', active: true, version: 1, contentType: 'current_dialogue', accentColor: '#32756b', aiSettings: roles, effectiveAiSettings: roles, aiAvailability: { gemini: false, openai: false, anthropic: false }, aiDefaultModels: { gemini: roles.summary.model, openai: roles.copy.model, anthropic: 'claude-fixture', image: roles.image.model }, budget: {} }];
const clone = value => structuredClone(value), imageCache = new Map();
async function render(copy, page, pageDesigns) {
  const key = JSON.stringify([copy, page, pageDesigns]);
  if (!imageCache.has(key)) {
    const style = { layout: 'minimal', collection: 'n03' }, plan = planCarousel({ kind: 'current_dialogue', payload: { title: example.title, summary: '제공 템플릿 예시', cardCopy: copy, pageDesigns }, channelName: 'ALLligodang', channelSlug: 'news', accent: '#32756b', sourceOrg: '제공 문서 · 검증된 뉴스 아님', checkedDate: '2026-11-06' }, style);
    imageCache.set(key, renderCarouselPage(plan, page, style));
  }
  return imageCache.get(key);
}
function fixture() {
  const state = { body: null, writes: [], saved: null, payload: null, evidence: null };
  const card = () => ({ id: 88, version: 1, title: state.body.title, channel: 'news', format: '카드뉴스', stage: 'writing', sourceItemId: 39, sourceReference: { channelId: 3, itemId: 39 }, panels: Array.from({ length: 4 }, () => ({ scene: '', dialogue: '', imageId: null })), script: '', caption: '', memo: '', imagePath: '', createdAt: stamp, updatedAt: stamp });
  const current = () => ({ id: 99, revisionNo: 1, author: 'operator', payload: state.payload, createdAt: stamp, note: '제공 문서·직접 작성한 8장 원고 저장 · AI 호출 없음' });
  async function route(route, url) {
    const request = route.request(), pathname = url.pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : undefined;
    if (method !== 'GET') state.writes.push({ pathname, body: clone(body) });
    let data;
    if (pathname === '/api/auth/me') data = { user: 'manual-fixture', csrf: 'fixture', demo: false, recoveryScope: 'manual-browser-fixture-20261106', authConfigured: true, demoAllowed: false };
    else if (pathname === '/api/channels') data = channels;
    else if (pathname === '/api/channels/3/today') data = { counts: { pendingReview: 0, draftsReady: 0 } };
    else if (pathname === '/api/status') data = { globalStop: false, workerConnected: true, integrations: { aiProvider: 'gemini', gemini: false, openai: false, anthropic: false, flags: { dryRun: true, autoPublish: false } } };
    else if (pathname === '/api/studio/ai-status') data = ai;
    else if (pathname === '/api/studio/cards' && method === 'GET') data = { cards: state.body ? [card()] : [], ai, notes: '', notesVersion: 1 };
    else if (pathname === '/api/channels/3/items/manual-family' && method === 'POST') {
      assert.equal(state.body, null, 'one explicit creation only'); const saved = familyManualCreateSchema.parse(body);
      assert.equal(saved.title, example.title); assert.deepEqual(saved.copy.pages.map(page => page.fields), example.copy.pages.map(page => page.fields)); assert.equal(saved.copy.templateKey, example.copy.templateKey); assert.deepEqual(saved.source, example.source); assert.deepEqual(saved.factBindings, example.factBindings);
      for (const [index, page] of saved.copy.pages.entries()) {
        const actual = resolveFamilyDisplay(page), expected = resolveFamilyDisplay(example.copy.pages[index]);
        for (const key of Object.keys(example.copy.pages[index].displayOverrides ?? {})) assert.equal(actual[key], expected[key], `exact displayed ${index + 1} / ${key} must survive ordinary form input`);
      }
      for (const binding of saved.factBindings) assert(saved.source.text.includes(binding.excerpt), 'provided excerpt must be literal');
      state.body = saved; const copy = clone(saved.copy), facts = saved.factBindings.map((binding, index) => ({ id: `F${index + 1}`, statement: familyFieldValue(copy, binding.fieldPath), claimType: binding.claimType, speaker: null, sourceId: 'provided-document', sourceScope: 'provided_document', timeScope: null, conditions: [], evidenceExcerpt: binding.excerpt, verificationStatus: 'article_only' }));
      copy.pages[1].claimRefs = facts.map((fact, index) => ({ fieldPath: `fields.facts.${index}`, claimType: fact.claimType, factIds: [fact.id], resourceIds: [] }));
      const metadata = { editorialPlan: { articleCore: saved.title, coreQuestion: copy.pages[3].fields.question, thinkingSkill: 'perspectives', keyConcept: copy.pages[5].fields.concept, conceptMode: copy.pages[5].fields.mode, connectionReason: '운영자가 제공 문서를 읽고 직접 작성한 대화 원고입니다.', essentialConditions: [], questionCandidates: [copy.pages[3].fields.question], resourceNeeds: [] }, evidenceBinding: { sourceSnapshotId: 'provided-snapshot', sourceAnalysisId: 'operator-analysis', evidenceSetId: 'provided-evidence', resourceResearchId: null }, pageDesigns: defaultPageDesigns(), parentGuide: null, captionPackage: null, visualBriefs: {}, editorialReview: null, fieldLocks: {}, generationRuns: [], dependencies: { caption: 'not_generated', visuals: 'not_generated', review: 'not_generated', render: 'needs_review' } };
      state.evidence = familyEvidenceView({ snapshot: { sources: [{ id: 'provided-document', title: saved.source.title, finalUrl: saved.source.url, scope: 'provided_document', fetchedAt: stamp }] }, evidenceSet: { evidenceSetId: 'provided-evidence', facts, resources: [] }, researchedSources: [] });
      state.saved = { version: 2, revisionId: 99, copy, ...metadata, evidence: state.evidence, hasSavedCopy: true };
      state.payload = { title: saved.title, summary: '제공된 템플릿 예시이며 외부 뉴스를 검증한 내용이 아닙니다.', cardCopy: copy, ...metadata, rendererProvider: 'builtin', manualAuthoring: { origin: 'operator', independentlyVerified: false }, checked_at: stamp, verified_facts: [], under_verification: [], sources: [], discussion_questions: [], glossary: [], parent_hints: [], perspectives: [] };
      return route.fulfill({ status: 201, json: { requestId: saved.requestId, itemId: 39, studioCardId: 88, version: 2, revisionId: 99 } });
    }
    else if (pathname === '/api/studio/cards/88' && state.body) data = { card: card(), revisions: [], jobs: [], images: [] };
    else if (pathname === itemPath && state.body) data = { item: { id: 39, channelId: 3, title: state.body.title, kind: 'current_dialogue', origin: 'manual', version: 2, currentRevisionId: 99, reviewStatus: 'pending', evidenceStatus: 'needs_review', relevance: 'relevant', publishStatus: 'waiting', excluded: false, edited: state.payload, createdAt: stamp, updatedAt: stamp }, current: current(), primary: { id: 1, title: state.body.source.title, originalUrl: state.body.source.url, normalizedUrl: state.body.source.url, kind: 'manual_text', fetchStatus: 'ok', fetchedText: state.body.source.text, snippet: '', meta: { independentlyVerified: false }, attachments: [], lastFetchedAt: stamp }, linked: [], revisions: [current()], cards: [], approvals: [], deliveries: [], similar: [], canonicalStudioCardId: 88, imageAiAvailable: false, publicationDraft: { version: 1, captions: { instagram: '', telegram: '' }, options: { destinationIds: [], timing: 'now', scheduledAtKst: '' } }, defaultCaptions: { instagram: '', telegram: '' }, publicationReadiness: { ready: false, blockers: ['QA 예시는 게시하지 않습니다.'], destinations: [], dryRun: true, autoPublish: false } };
    else if (pathname === `${itemPath}/card-copy` && method === 'GET' && state.saved) data = state.saved;
    else if (pathname === `${itemPath}/card-copy/preview` && method === 'POST' && state.saved) {
      assert.equal(body.version, 2); familyCardCopySchema.parse(body.copy); return route.fulfill({ contentType: 'image/jpeg', body: await render(body.copy, body.page, body.pageDesigns) });
    }
    else if (pathname === '/api/channels/3/templates') data = { current: 'set:n03', items: [{ key: 'set:n03', name: '뉴스 대화', description: '', kind: 'builtin', family: 'news', pageCount: 5 }] };
    else if (pathname === '/api/canva/status') data = { connected: true };
    else if (pathname === '/api/canva/editorial/status') data = { configured: true, connected: true, autofill: false, capabilities: [], capabilityStatus: 'unavailable', reason: 'capability_missing' };
    else if (pathname === '/api/canva/template-library') data = canvaLibraryStateFixture({ autofill: false });
    else if (pathname === '/api/channels/3/canva/masters' || pathname === `${itemPath}/canva/jobs`) data = { items: [] };
    else return false;
    await route.fulfill({ json: clone(data) }); return true;
  }
  return { state, route };
}
async function hit(page, locator, width) {
  await locator.scrollIntoViewIfNeeded();
  const r = await locator.boundingBox(); assert(r && r.width >= 48 && (width > 900 || r.height >= 48), 'primary action must have a 48px mobile hit area');
  assert(await locator.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'primary action must be reachable');
}
let browser, engine = 'WebKit'; const results = [];
try {
  try { browser = await playwright.webkit.launch(); } catch (error) { if (process.env.CI) throw error; engine = 'Chromium'; browser = await playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE } : {}) }); }
  const widths = process.env.MANUAL_FAMILY_WIDTHS ? process.env.MANUAL_FAMILY_WIDTHS.split(',').map(Number) : [320, 393, 1280];
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('spacepenguin.channel', '3')); context.setDefaultTimeout(20_000);
    const page = await context.newPage(), { state, route } = fixture(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await context.route('**/*', async request => { const url = new URL(request.request().url()); if (url.origin !== origin) { external.push(url.href); return request.abort('blockedbyclient'); } if (!url.pathname.startsWith('/api/')) return request.continue(); try { if (await route(request, url) !== false) return; errors.push(`Unmocked API ${url.pathname}`); await request.fulfill({ status: 404, json: { error: 'Isolated fixture' } }); } catch (error) { errors.push(`${url.pathname}: ${error.message}`); await request.fulfill({ status: 500, json: { error: error.message } }); } });
    try {
      await page.goto(`${origin}/?start=free&channel=news&mode=manual`);
      const start = page.getByRole('button', { name: 'AI 없이 8장 원고 직접 작성', exact: true }); await start.waitFor(); await hit(page, start, width); await start.click();
      const form = page.getByRole('form', { name: '직접 작성 8장 원고' }); await form.waitFor();
      if (width === 1280) {
        await form.getByLabel('8장 원고 파일', { exact: true }).setInputFiles({ name: 'provided-template-eight.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(example)) });
        await page.waitForFunction(title => document.querySelector('[aria-label="8장 작업 제목"]')?.value === title, example.title);
      } else {
        await form.getByLabel('8장 작업 제목', { exact: true }).fill(example.title); await form.getByLabel('제공 자료 제목', { exact: true }).fill(example.source.title); await form.getByLabel('제공 자료 주소', { exact: true }).fill(example.source.url); await form.getByLabel('제공 자료 본문', { exact: true }).fill(example.source.text);
        await form.getByLabel('직접 작성 8장 디자인', { exact: true }).selectOption(example.copy.templateKey);
        for (const [index, sourcePage] of example.copy.pages.entries()) {
          await form.getByRole('button', { name: `${index + 1} ${FAMILY_PAGE_LABELS[sourcePage.id]}`, exact: true }).click();
          for (const field of familyFieldDescriptors(sourcePage)) {
            const value = familyFieldValue(example.copy, field.fieldPath);
            if (Array.isArray(value)) for (const [i, text] of value.entries()) await form.getByLabel(`${field.label} ${i + 1}`, { exact: true }).fill(text);
            else await form.getByLabel(field.label, { exact: true }).fill(typeof value === 'string' ? value : '');
          }
          if (sourcePage.id === 'news_summary') for (const [i, binding] of example.factBindings.entries()) await form.getByLabel(`근거 ${i + 1} 원문 구절`, { exact: true }).fill(binding.excerpt);
          const display = form.getByText('이 장의 표시 문구 · 선택', { exact: true });
          if (!await display.evaluate(node => node.parentElement.open)) await display.click();
          for (const [key, value] of Object.entries(sourcePage.displayOverrides ?? {})) {
            const { readingDisplayDescriptors, readingProfileForTemplateKey } = await import('../shared/readingCardProfiles.ts');
            const descriptor = readingDisplayDescriptors(readingProfileForTemplateKey(example.copy.templateKey), sourcePage).find(field => field.key === key);
            if (descriptor) await form.getByLabel(`직접 작성 ${descriptor.label}`, { exact: true }).fill(value);
          }
        }
      }
      assert.equal(state.writes.length, 0, 'typing or importing a file must not create server content');
      const save = form.getByRole('button', { name: '직접 쓴 8장 원고 저장', exact: true }); assert.equal(await save.isDisabled(), true);
      const label = form.locator('.manual-family-confirm'); await hit(page, label, width);
      const padding = await label.evaluate(node => { const r = node.getBoundingClientRect(), input = node.querySelector('input').getBoundingClientRect(); return { x: r.right - 7, y: r.y + 20, outside: r.right - 7 > input.right }; }); assert(padding.outside);
      if (width < 768) await page.touchscreen.tap(padding.x, padding.y); else await page.mouse.click(padding.x, padding.y);
      assert.equal(await label.locator('input').isChecked(), true); await hit(page, save, width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'manual form must fit the viewport');
      await page.screenshot({ path: `${output}/provided-form-${width}.png` }); await save.click();
      await page.waitForURL('**/studio/88?mode=manual'); await page.getByRole('region', { name: '가족 대화 8장 카드 편집기' }).waitFor();
      const image = page.locator('.card-copy-preview:not(.is-stale)[aria-busy="false"] img'); await image.waitFor();
      await page.waitForFunction(() => { const img = document.querySelector('.card-copy-preview:not(.is-stale)[aria-busy="false"] img'); return img?.complete && img.naturalWidth === 1080 && img.naturalHeight === 1350; });
      assert.equal(await page.locator('.family-page-strip button').count(), 8); await page.getByRole('form', { name: 'Canva 사본 8장 가져오기' }).waitFor();
      assert.deepEqual(state.saved.generationRuns, []); assert.equal(state.payload.manualAuthoring.independentlyVerified, false); assert(state.evidence.facts.every(fact => fact.sourceScope === 'provided_document' && fact.verificationStatus === 'article_only'));
      assert.deepEqual(state.writes.filter(value => !value.pathname.endsWith('/preview')).map(value => value.pathname), ['/api/channels/3/items/manual-family']);
      assert.deepEqual(errors, []); assert.deepEqual(external, []); await page.screenshot({ path: `${output}/manual-editor-${width}.png` });
      results.push({ width, engine, passed: true, example: 'exact preserved Canva template text, supplied example, not verified news', input: width === 1280 ? 'manuscript file plus explicit comparison' : 'ordinary eight-page fields plus source/excerpts', sourceScope: 'provided_document', newContentRequests: 1, aiCalls: 0, publicationRequests: 0, realRenderer: true }); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); console.log(`Manual family regression passed at ${width}px (${engine}).`);
    } catch (error) { results.push({ width, engine, passed: false, error: error.message, apiErrors: errors, external }); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true }).catch(() => {}); throw error; }
    finally { await context.close(); }
  }
} finally { await browser?.close(); await server.httpServer.close(); }
