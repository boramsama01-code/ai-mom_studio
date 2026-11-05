/** Real PostgreSQL transactions; both AI HTTP providers are mocked, with no paid or production calls. */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { channels, contentItems, contentRevisions, jobs, mediaAssets, sourceDocuments } from "../shared/schema";
import { emptyPayload } from "../shared/payloads";
import { defaultChannelRoleSettings } from "../shared/channelAi";
import { familyEvidenceRecords } from "../shared/familyEvidenceDb";
import { createFamilyProviderMock } from "./fixtures/familyProvider";
import { resolveNewsEditorialResource } from "../shared/newsEditorialResource";
import { login, resetDb, setTestEnv } from "./helpers";
import { editorialAnalysis, editorialCopy, editorialSource, editorialSummary, geminiEditorialResponse, openaiEditorialResponse } from "./fixtures/newsEditorial";
import { cardCopyFixture } from "./fixtures/cardCopy";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const { createRevision } = await import("../server/content");
let app: ReturnType<typeof createApp>;
const outbound = vi.fn();
beforeAll(async () => { await resetDb(); app = createApp(); });
beforeEach(async () => {
  outbound.mockReset().mockImplementation(() => { throw new Error("Unexpected external request in isolated editorial tests"); });
  vi.stubGlobal("fetch", outbound);
  vi.stubEnv("GEMINI_API_KEY", "editorial-pg-test-key"); vi.stubEnv("OPENAI_API_KEY", "editorial-pg-test-key");
  const settings = defaultChannelRoleSettings();
  settings.roleModels.article_analysis = { provider: "gemini", model: "gemini-summary-test" };
  settings.roleModels.card_copy = { provider: "openai", model: "gpt-copy-test" };
  settings.editorial = { additionalResourcesAutoSearch: false, visitScope: "off" };
  await getDb().update(channels).set({ aiSettings: settings }).where(eq(channels.id, 2));
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture(withSavedCopy = false) {
  const { agent, csrf } = await login(app), headers = { "x-csrf-token": csrf }, source = editorialSource();
  const { item, originalRevision, doc, payload } = await getDb().transaction(async tx => {
    const url = `https://example.test/news/${randomUUID()}`;
    const [doc] = await tx.insert(sourceDocuments).values({ normalizedUrl: url, originalUrl: url, kind: "news", title: source.title, fetchedText: source.text, fetchStatus: "ok", publishedRaw: source.published }).returning();
    const [created] = await tx.insert(contentItems).values({ channelId: 2, primarySourceId: doc.id, kind: "science_dialogue", title: "운영자의 원문 제목", relevance: "relevant" }).returning();
    const payload = { ...emptyPayload("science_dialogue", "운영자의 원문 제목"), ...(withSavedCopy ? { cardCopy: editorialCopy(doc.id) } : {}) };
    if (payload.cardCopy) payload.cardCopy.cover.title = "운영자가 보존하려는 카드 제목";
    const originalRevision = await createRevision(tx, { contentItemId: created.id, author: "operator", payload });
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, created.id));
    return { item, originalRevision, doc, payload };
  });
  return { agent, headers, item, originalRevision, doc, payload, endpoint: `/api/channels/2/items/${item.id}` };
}
async function latest(itemId: number) {
  const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, itemId));
  const [revision] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId!));
  return { item, revision };
}

// The already-deployed editor's Zod object schema discards new unknown fields.
const legacyEditorCopySchema = z.object({
  version: z.literal(1), templateKey: z.string(),
  cover: z.object({ title: z.string(), subtitle: z.string() }),
  pages: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), body: z.string() })).min(1).max(9),
});
async function decoratedFixture() {
  const f = await fixture(true), copy = editorialCopy(f.doc.id);
  const bytes = await sharp({ create: { width: 16, height: 20, channels: 3, background: "#355745" } }).jpeg().toBuffer();
  const [asset] = await getDb().insert(mediaAssets).values({ channelId: 2, contentItemId: f.item.id, revisionId: f.originalRevision.id, kind: "card_page_art", source: "upload", mime: "image/jpeg", width: 16, height: 20, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }).returning();
  copy.cover.background = { assetId: asset.id, opacity: 75 };
  copy.pages[3].background = { assetId: asset.id, opacity: 55 };
  copy.pages[5].resource = resolveNewsEditorialResource(f.doc.id, [{ source_id: f.doc.id, title: f.doc.title, url: f.doc.originalUrl, text: f.doc.fetchedText! }])!;
  const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return { ...f, copy, asset, before: await latest(f.item.id) };
}

describe("two-stage news generation and partial recovery on PostgreSQL", () => {
  it("commits valid source analysis when the copy provider fails and replays that partial result without paying again", async () => {
    const f = await fixture(), body = { version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" };
    const mock = createFamilyProviderMock({ failStages: new Set(["card_copy"]) }); outbound.mockImplementation(mock.fetch);
    const result = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.generationWarnings).toContainEqual(expect.stringContaining("기사 분석은 저장했습니다"));
    const saved = await latest(f.item.id);
    expect(saved.item.version).toBe(f.item.version + 1); expect(saved.item.reviewStatus).toBe("pending"); expect(saved.item.publishStatus).toBe("waiting");
    const [analysis] = await getDb().select().from(familyEvidenceRecords).where(and(eq(familyEvidenceRecords.contentItemId, f.item.id), eq(familyEvidenceRecords.kind, "source_analysis")));
    expect(analysis.payload.facts).toHaveLength(2); expect(saved.revision.payload.generationRuns).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "article_analysis", status: "ready" }), expect.objectContaining({ stage: "card_copy", status: "failed" })]));
    expect(saved.revision.payload).not.toHaveProperty("cardCopy");
    expect(saved.revision.payload.aiWorkflow).toMatchObject({ summary: { provider: "gemini", model: "gemini-summary-test" }, copy: null });
    expect(saved.revision.note).toContain("복구 가능"); expect(JSON.stringify(saved.revision)).not.toContain("isolated upstream error body");
    const [job] = await getDb().select().from(jobs).where(eq(jobs.id, result.body.jobId));
    expect(job).toMatchObject({ status: "succeeded", maxAttempts: 1, result: { response: { version: saved.item.version } } });
    const repeat = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(repeat.status).toBe(200); expect(repeat.body).toEqual(result.body); expect(outbound).toHaveBeenCalledTimes(3);
    expect((await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id)))).toHaveLength(2);
    expect(outbound.mock.calls[0][0]).toContain("models/gemini-summary-test:generateContent");
    expect(JSON.parse(outbound.mock.calls[1][1].body).model).toBe("gpt-copy-test");
  });

  it("recovers only card writing, keeps the proposal unsaved, and records verified model provenance only on explicit apply/save", async () => {
    const f = await fixture();
    const failures = new Set<import("./fixtures/familyProvider").FamilyMockStage>(["card_copy"]), mock = createFamilyProviderMock({ failStages: failures }); outbound.mockImplementation(mock.fetch);
    const generated = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" });
    expect(generated.status).toBe(200);
    const summarized = await latest(f.item.id), proposalBody = { version: summarized.item.version, requestId: randomUUID(), baseRevision: summarized.revision.id, templateKey: "set:n03", formatId: "family_dialogue_8", scope: "all" };
    failures.clear();
    const proposed = await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(proposalBody);
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    expect(proposed.body).toMatchObject({ copy: { version: 2, formatId: "family_dialogue_8" }, pageDesigns: { cover: { background: { kind: "image" } } } });
    expect((await latest(f.item.id)).revision).toEqual(summarized.revision);
    expect((await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(proposalBody)).body).toEqual(proposed.body);
    expect(mock.calls.filter(call => call.stage === "article_analysis")).toHaveLength(1); expect(mock.calls.filter(call => call.stage === "card_copy")).toHaveLength(2);
    const callsBeforeSave = outbound.mock.calls.length;
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: summarized.item.version, copy: proposed.body.copy, pageDesigns: proposed.body.pageDesigns, fieldLocks: proposed.body.fieldLocks, parentGuide: proposed.body.parentGuide, captionPackage: proposed.body.captionPackage, proposalJobId: proposed.body.jobId });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const applied = await latest(f.item.id);
    expect(applied.revision.payload.cardCopy).toEqual(proposed.body.copy);
    expect(applied.revision.payload.evidenceBinding).toEqual(proposed.body.evidenceBinding);
    expect(applied.revision.payload.aiWorkflow).toMatchObject({ summary: { provider: "gemini", model: "gemini-summary-test" }, copy: { provider: "openai", model: "gpt-copy-test" }, warnings: [] });
    expect(applied.revision.payload.scientific_basis).toBe(summarized.revision.payload.scientific_basis);
    expect(applied.revision.payload.evidence).toEqual(summarized.revision.payload.evidence);
    expect(outbound).toHaveBeenCalledTimes(callsBeforeSave);
  });

  it("refreshes source analysis without replacing a saved operator deck or charging the copy provider", async () => {
    const f = await fixture(true);
    outbound.mockResolvedValueOnce(geminiEditorialResponse(editorialSummary("science_dialogue", f.doc.id)));
    const generated = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const saved = await latest(f.item.id);
    expect(saved.revision.payload.cardCopy).toEqual(f.payload.cardCopy);
    expect(saved.revision.payload.articleAnalysis).toEqual(editorialAnalysis(f.doc.id));
    expect(saved.revision.note).toContain("저장된 카드 문구는 유지");
    expect(outbound).toHaveBeenCalledOnce(); expect(outbound.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
  });

  it("leaves the original revision intact on a fabricated source quote and does not replay the failed request", async () => {
    const f = await fixture(true), analysis = editorialAnalysis(f.doc.id);
    analysis.claims[1].quote = "이 기사에는 등장하지 않은 연구 결과입니다";
    outbound.mockResolvedValueOnce(geminiEditorialResponse({ ...editorialSummary("science_dialogue", f.doc.id), articleAnalysis: analysis }));
    const body = { version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" };
    const failed = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(failed.status).toBe(400); expect(failed.body.error).toContain("원문과 일치하지");
    const saved = await latest(f.item.id);
    expect(saved.item.version).toBe(f.item.version); expect(saved.revision).toEqual(f.originalRevision);
    const again = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(again.status).toBe(422); expect(again.body.jobStatus).toBe("failed"); expect(outbound).toHaveBeenCalledOnce();
  });

  it("saves a canonical reference from this item's actually fetched primary source without calling AI", async () => {
    const f = await fixture(true), copy = editorialCopy(f.doc.id);
    copy.pages[5].resource = resolveNewsEditorialResource(f.doc.id, [{ source_id: f.doc.id, title: f.doc.title, url: f.doc.originalUrl, text: f.doc.fetchedText! }])!;
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await latest(f.item.id)).revision.payload.cardCopy).toEqual(copy);
    expect(outbound).not.toHaveBeenCalled();
  });

  it.each(["another item's source", "forged title", "forged URL"])("refuses %s in card save, preview and final rendering", async alteration => {
    const f = await fixture(true), other = await fixture(true), copy = editorialCopy(f.doc.id);
    const canonical = resolveNewsEditorialResource(f.doc.id, [{ source_id: f.doc.id, title: f.doc.title, url: f.doc.originalUrl, text: f.doc.fetchedText! }])!;
    copy.pages[5].resource = alteration === "another item's source"
      ? { sourceId: other.doc.id, title: other.doc.title, url: other.doc.originalUrl }
      : { ...canonical, ...(alteration === "forged title" ? { title: "존재하지 않는 논문 제목" } : { url: "https://invented.test/false-resource" }) };
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(409); expect(saved.body.error).toContain("참고자료");
    const preview = await f.agent.post(`${f.endpoint}/card-copy/preview`).set(f.headers).send({ version: f.item.version, copy, page: 6, coverMode: "typography" });
    expect(preview.status, JSON.stringify(preview.body)).toBe(409); expect(preview.body.error).toContain("참고자료");
    expect((await latest(f.item.id)).revision.id).toBe(f.originalRevision.id);
    // Simulate a legacy/tampered stored revision: rendering must independently recheck ownership.
    await getDb().transaction(async tx => createRevision(tx, { contentItemId: f.item.id, author: "operator", payload: { ...f.payload, cardCopy: copy } }));
    const render = await f.agent.post(`${f.endpoint}/card`).set(f.headers).send({ version: f.item.version, coverMode: "typography" });
    expect(render.status, JSON.stringify(render.body)).toBe(422); expect(render.body.error).toContain("참고자료");
    expect(await getDb().select().from(mediaAssets).where(eq(mediaAssets.contentItemId, f.item.id))).toHaveLength(0);
    expect(outbound).not.toHaveBeenCalled();
  });

  it.each([7, 4])("rejects a stale client's %i-body legacy serialization without erasing eight-page metadata", async bodyCount => {
    const f = await decoratedFixture(), legacy = legacyEditorCopySchema.parse(f.copy);
    legacy.pages = legacy.pages.slice(0, bodyCount);
    legacy.cover.title = "이전 편집기에서 수정한 표지";
    expect(legacy).not.toHaveProperty("storyFormat");
    expect(legacy.pages[3]).not.toHaveProperty("columns");
    expect(legacy.cover).not.toHaveProperty("background");
    const revisionsBefore = await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id));
    const rejected = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.before.item.version, copy: legacy });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    expect(rejected.body).toMatchObject({ code: "editor_reload_required", error: expect.stringContaining("새로고침") });
    const after = await latest(f.item.id);
    expect(after.item.version).toBe(f.before.item.version);
    expect(after.item.currentRevisionId).toBe(f.before.item.currentRevisionId);
    expect(after.item.edited).toEqual(f.before.item.edited);
    expect(after.revision).toEqual(f.before.revision);
    expect(after.revision.payload.cardCopy).toEqual(f.copy);
    expect(await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).toEqual(revisionsBefore);
    expect(await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, f.asset.id))).toHaveLength(1);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("continues to accept modern eight-page edits and explicit removal of a selected background or resource", async () => {
    const f = await decoratedFixture(), edited = structuredClone(f.copy);
    edited.pages[3].columns![0].body = "같은 사실을 다른 기준으로 비교해요.";
    delete edited.cover.background; delete edited.pages[3].background; delete edited.pages[5].resource;
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.before.item.version, copy: edited });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await latest(f.item.id)).revision.payload.cardCopy).toEqual(edited);
    expect((await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.before.revision.id)))[0].payload.cardCopy).toEqual(f.copy);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("keeps legacy five-page saves working for an existing legacy draft", async () => {
    const f = await fixture(), legacy = cardCopyFixture("set:n03");
    const first = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy: legacy });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    legacy.pages[0].body = "기존 다섯 장 형식도 계속 수정할 수 있어요.";
    const second = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: first.body.version, copy: legacy });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await latest(f.item.id)).revision.payload.cardCopy).toEqual(legacy);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("preserves trusted analysis/model history and card copy when a source editor omits or spoofs their fields", async () => {
    const f = await decoratedFixture(), workflow = { version: 1, summary: { provider: "gemini", model: "trusted-summary-model" }, copy: { provider: "openai", model: "trusted-copy-model" }, warnings: ["추가 원문 대조가 필요합니다."] };
    const trusted = { ...f.before.revision.payload, articleAnalysis: editorialAnalysis(f.doc.id), aiWorkflow: workflow };
    await getDb().transaction(async tx => createRevision(tx, { contentItemId: f.item.id, author: "llm", payload: trusted }));
    for (const spoof of [false, true]) {
      const current = await latest(f.item.id);
      const payload = { ...emptyPayload("science_dialogue", "수동으로 바꾼 원문 요약"), scientific_basis: `수동 편집 ${spoof ? "둘" : "하나"}`, ...(spoof ? { articleAnalysis: { version: 99, claims: ["변조"] }, aiWorkflow: { version: 99, summary: "변조" }, cardCopy: legacyEditorCopySchema.parse(f.copy) } : {}) };
      const edited = await f.agent.patch(f.endpoint).set(f.headers).send({ version: current.item.version, payload });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const saved = await latest(f.item.id);
      expect(saved.revision.payload.scientific_basis).toBe(payload.scientific_basis);
      expect(saved.revision.payload.articleAnalysis).toEqual(trusted.articleAnalysis);
      expect(saved.revision.payload.aiWorkflow).toEqual(workflow);
      expect(saved.revision.payload.cardCopy).toEqual(f.copy);
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it("does not let a source editor mint server-owned analysis or model records where none were saved", async () => {
    const f = await fixture();
    const payload = { ...editorialSummary("science_dialogue", f.doc.id), aiWorkflow: { version: 1, summary: { provider: "gemini", model: "never-executed" }, copy: null, warnings: [] } };
    const edited = await f.agent.patch(f.endpoint).set(f.headers).send({ version: f.item.version, payload });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const saved = await latest(f.item.id);
    expect(saved.revision.payload).not.toHaveProperty("articleAnalysis"); expect(saved.revision.payload).not.toHaveProperty("aiWorkflow");
    expect(outbound).not.toHaveBeenCalled();
  });
});
