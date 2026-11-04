/** Real PostgreSQL transactions; both AI HTTP providers are mocked, with no paid or production calls. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { channels, contentItems, contentRevisions, jobs, mediaAssets, sourceDocuments } from "../shared/schema";
import { emptyPayload } from "../shared/payloads";
import { defaultChannelAiSettings } from "../shared/channelAi";
import { resolveNewsEditorialResource } from "../shared/newsEditorialResource";
import { login, resetDb, setTestEnv } from "./helpers";
import { editorialAnalysis, editorialCopy, editorialSource, editorialSummary, geminiEditorialResponse, openaiEditorialResponse } from "./fixtures/newsEditorial";

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
  const settings = defaultChannelAiSettings();
  settings.summary = { provider: "gemini", model: "gemini-summary-test" };
  settings.copy = { provider: "openai", model: "gpt-copy-test" };
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

describe("two-stage news generation and partial recovery on PostgreSQL", () => {
  it("commits valid source analysis when the copy provider fails and replays that partial result without paying again", async () => {
    const f = await fixture(), body = { version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" };
    outbound.mockResolvedValueOnce(geminiEditorialResponse(editorialSummary("science_dialogue", f.doc.id))).mockResolvedValueOnce(new Response("private-provider-body", { status: 502 }));
    const result = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.generationWarnings).toEqual([expect.stringContaining("기사 요약은 저장했습니다")]);
    const saved = await latest(f.item.id);
    expect(saved.item.version).toBe(f.item.version + 1); expect(saved.item.reviewStatus).toBe("pending"); expect(saved.item.publishStatus).toBe("waiting");
    expect(saved.revision.payload.articleAnalysis).toEqual(editorialAnalysis(f.doc.id));
    expect(saved.revision.payload).not.toHaveProperty("cardCopy");
    expect(saved.revision.payload.aiWorkflow).toMatchObject({ summary: { provider: "gemini", model: "gemini-summary-test" }, copy: null, warnings: [expect.stringContaining("카드 문구는 완성하지 못했습니다")] });
    expect(saved.revision.note).toContain("카드 편집에서 문구만 다시"); expect(JSON.stringify(saved.revision)).not.toContain("private-provider-body");
    const [job] = await getDb().select().from(jobs).where(eq(jobs.id, result.body.jobId));
    expect(job).toMatchObject({ status: "succeeded", maxAttempts: 1, result: { response: { version: saved.item.version } } });
    const repeat = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(repeat.status).toBe(200); expect(repeat.body).toEqual(result.body); expect(outbound).toHaveBeenCalledTimes(2);
    expect((await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id)))).toHaveLength(2);
    expect(outbound.mock.calls[0][0]).toContain("models/gemini-summary-test:generateContent");
    expect(JSON.parse(outbound.mock.calls[1][1].body).model).toBe("gpt-copy-test");
  });

  it("recovers only card writing, keeps the proposal unsaved, and records verified model provenance only on explicit apply/save", async () => {
    const f = await fixture();
    outbound.mockResolvedValueOnce(geminiEditorialResponse(editorialSummary("science_dialogue", f.doc.id))).mockResolvedValueOnce(new Response(null, { status: 502 }));
    const generated = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" });
    expect(generated.status).toBe(200);
    const summarized = await latest(f.item.id), proposalBody = { version: summarized.item.version, requestId: randomUUID(), templateKey: "set:n03", storyFormat: "discussion8" };
    outbound.mockResolvedValueOnce(openaiEditorialResponse(editorialCopy(f.doc.id)));
    const proposed = await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(proposalBody);
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    expect(proposed.body).toMatchObject({ articleAnalysis: editorialAnalysis(f.doc.id), copy: { storyFormat: "discussion8" }, aiWorkflow: { summary: { model: "gemini-summary-test" }, copy: { model: "gpt-copy-test" } } });
    expect((await latest(f.item.id)).revision).toEqual(summarized.revision);
    expect((await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(proposalBody)).body).toEqual(proposed.body);
    expect(outbound).toHaveBeenCalledTimes(3); expect(outbound.mock.calls[2][0]).toContain("api.openai.com");
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: summarized.item.version, copy: proposed.body.copy, proposalJobId: proposed.body.jobId });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const applied = await latest(f.item.id);
    expect(applied.revision.payload.cardCopy).toEqual(proposed.body.copy);
    expect(applied.revision.payload.articleAnalysis).toEqual(editorialAnalysis(f.doc.id));
    expect(applied.revision.payload.aiWorkflow).toMatchObject({ summary: { provider: "gemini", model: "gemini-summary-test" }, copy: { provider: "openai", model: "gpt-copy-test" }, warnings: [] });
    expect(applied.revision.payload.scientific_basis).toBe(summarized.revision.payload.scientific_basis);
    expect(applied.revision.payload.evidence).toEqual(summarized.revision.payload.evidence);
    expect(outbound).toHaveBeenCalledTimes(3);
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
    expect(again.status).toBe(409); expect(again.body.jobStatus).toBe("failed"); expect(outbound).toHaveBeenCalledOnce();
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
});
