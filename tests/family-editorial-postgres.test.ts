/** Real PostgreSQL locks/immutable records, with every external provider mocked. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { channels, contentItems, contentRevisions, mediaAssets } from "../shared/schema";
import { familyEditorialStages, familyEvidenceRecords } from "../shared/familyEvidenceDb";
import { defaultChannelRoleSettings } from "../shared/channelAi";
import { emptyPayload } from "../shared/payloads";
import { login, resetDb, setTestEnv } from "./helpers";
import { createFamilyPgFixture } from "./fixtures/familyEvidencePg";
import { createFamilyProviderMock, type FamilyMockStage } from "./fixtures/familyProvider";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { editorialPlanSchema } from "../shared/familyDialogue";
import { familyExecutionPlan } from "../server/services/familyEditorial";
import { runFamilyEditorialStage } from "../server/services/familyEditorialStages";
import { researchFamilyResources, runRecordedFamilyResourceSearch } from "../server/services/familyResourceResearch";
import { LlmBudget } from "../server/services/llm";
import { sha256 } from "../server/services/text";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const { renderCardForItem } = await import("../server/worker/publish");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
beforeEach(async () => {
  vi.stubEnv("GEMINI_API_KEY", "isolated-family-summary-key"); vi.stubEnv("OPENAI_API_KEY", "isolated-family-copy-image-key");
  const aiSettings = defaultChannelRoleSettings(); aiSettings.editorial = { additionalResourcesAutoSearch: false, visitScope: "off" };
  aiSettings.roleModels.article_analysis = { provider: "gemini", model: "gemini-family-summary" };
  aiSettings.roleModels.card_copy = { provider: "openai", model: "gpt-family-copy" };
  aiSettings.roleModels.image_generation = { provider: "openai", model: "gpt-image-family" };
  await getDb().update(channels).set({ aiSettings }).where(eq(channels.id, 2));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external call in isolated family PostgreSQL tests"); }));
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await closeDb(); });
async function fixture(options: Parameters<typeof createFamilyPgFixture>[1] = {}) {
  const f = await createFamilyPgFixture(getDb(), options), { agent, csrf } = await login(app);
  return { ...f, agent, headers: { "x-csrf-token": csrf }, endpoint: `/api/channels/${f.item.channelId}/items/${f.item.id}` };
}
async function latest(id: number) {
  const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, id));
  const [revision] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId!));
  return { item, revision };
}
function saveBody(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return { version: f.item.version, copy: f.copy, pageDesigns: f.metadata.pageDesigns, fieldLocks: f.metadata.fieldLocks, parentGuide: f.metadata.parentGuide, captionPackage: f.metadata.captionPackage, ...extra };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe("v2 article generation and durable proposal application", () => {
  it("makes a complete new eight-page draft with exactly one default image and replays the whole request", async () => {
    const f = await fixture({ sourceOnly: true }), mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const body = { version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" };
    const result = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = await latest(f.item.id), payload = saved.revision.payload as any;
    expect(payload.cardCopy).toMatchObject({ version: 2, formatId: "family_dialogue_8" }); expect(payload.cardCopy.pages).toHaveLength(8);
    expect(payload.pageDesigns.cover.background).toMatchObject({ kind: "image", assetId: expect.any(Number) });
    expect(payload.captionPackage.contentRevision).toBe(saved.revision.id); expect(payload.dependencies.caption).toBe("current");
    expect(payload.parentGuide.coreQuestion).toBe(payload.editorialPlan.coreQuestion); expect(payload.captionPackage.coreQuestion).toBe(payload.editorialPlan.coreQuestion);
    expect(saved.item.reviewStatus).toBe("pending"); expect(saved.item.publishStatus).toBe("waiting");
    const [art] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, payload.pageDesigns.cover.background.assetId));
    expect(art).toMatchObject({ contentItemId: f.item.id, channelId: 2, kind: "card_page_art", mime: "image/jpeg", source: "ai" });
    expect(mock.calls.filter(call => call.stage === "image_generation")).toHaveLength(1);
    const count = mock.calls.length, replay = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(replay.status).toBe(200); expect(replay.body).toEqual(result.body); expect(mock.calls).toHaveLength(count);
    expect((await latest(f.item.id)).revision).toEqual(saved.revision);
    const [original] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.revision.id));
    expect(original.payload).toEqual(f.revision.payload);
  });
  it("keeps complete text and caption after an image failure and permits an explicit separate image retry", async () => {
    const f = await fixture({ sourceOnly: true }), failures = new Set<FamilyMockStage>(["image_generation"]), mock = createFamilyProviderMock({ failStages: failures }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const body = { version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" };
    const result = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = await latest(f.item.id), payload = saved.revision.payload as any;
    expect(payload.cardCopy.pages).toHaveLength(8); expect(payload.parentGuide).toBeTruthy(); expect(payload.captionPackage).toBeTruthy();
    expect(payload.pageDesigns.cover.background.kind).toBe("brand"); expect(result.body.generationWarnings.join(" ")).toContain("표지");
    expect(payload.generationRuns).toContainEqual(expect.objectContaining({ stage: "image_generation", status: "failed", provenance: expect.objectContaining({ usageStatus: "usage_unknown" }) }));
    const count = mock.calls.length;
    expect((await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send(body)).status).toBe(200); expect(mock.calls).toHaveLength(count);
    failures.clear();
    const art = await f.agent.post(`${f.endpoint}/card-copy/background`).set(f.headers).send({ version: saved.item.version, requestId: randomUUID(), pageId: "cover", mode: "ai" });
    expect(art.status, JSON.stringify(art.body)).toBe(200); expect((await latest(f.item.id)).revision).toEqual(saved.revision);
    const pageDesigns = structuredClone(payload.pageDesigns); pageDesigns.cover.background = { ...pageDesigns.cover.background, kind: "image", assetId: art.body.assetId };
    const applied = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: saved.item.version, copy: payload.cardCopy, pageDesigns, fieldLocks: payload.fieldLocks, parentGuide: payload.parentGuide, captionPackage: payload.captionPackage });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200); expect(applied.body.captionPackage.contentRevision).toBe(applied.body.revisionId); expect(applied.body.dependencies.caption).toBe("current");
    expect(mock.calls.filter(call => call.stage === "image_generation")).toHaveLength(2);
  });
  it("stores a field proposal without saving it and changes only that field on explicit CAS apply", async () => {
    const f = await fixture(), mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const body = { version: f.item.version, requestId: randomUUID(), formatId: "family_dialogue_8", templateKey: "set:n03", scope: "field", baseRevision: f.revision.id, pageId: "cover", allowedFieldPaths: ["pages.cover.fields.headline"] };
    const proposed = await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(body);
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200); expect(proposed.body.lateResult).toBe(false); expect(mock.calls.map(call => call.stage)).toEqual(["partial_copy"]);
    expect((await latest(f.item.id)).revision).toEqual(f.revision);
    expect((await f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send(body)).body).toEqual(proposed.body); expect(mock.calls).toHaveLength(1);
    const applied = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy: proposed.body.copy, proposalJobId: proposed.body.jobId }));
    expect(applied.status, JSON.stringify(applied.body)).toBe(200); expect(applied.body.copy.pages.slice(1)).toEqual(f.copy.pages.slice(1));
    expect(applied.body.dependencies.caption).toBe("needs_review"); expect(applied.body.pageDesigns).toEqual(f.metadata.pageDesigns);
  });
  it("retains a late AI response for comparison without allowing it to overwrite a newer operator save", async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), mock = createFamilyProviderMock({ onStage: async call => { if (call.stage === "partial_copy") { entered.resolve(); await release.promise; } } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const request = f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), formatId: "family_dialogue_8", templateKey: "set:n03", scope: "field", baseRevision: f.revision.id, pageId: "cover", allowedFieldPaths: ["pages.cover.fields.headline"] }).then(value => value);
    await entered.promise;
    const manual = structuredClone(f.copy); if (manual.pages[0].id === "cover") manual.pages[0].fields.headline = "운영자가 뒤에 직접 쓴 제목";
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy: manual }));
    expect(saved.status).toBe(200); release.resolve();
    const proposed = await request; expect(proposed.status, JSON.stringify(proposed.body)).toBe(200); expect(proposed.body.lateResult).toBe(true);
    const rejected = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { version: saved.body.version, copy: proposed.body.copy, proposalJobId: proposed.body.jobId }));
    expect(rejected.status).toBe(409); expect((await latest(f.item.id)).revision.payload.cardCopy).toEqual(manual); expect(mock.calls).toHaveLength(1);
  });
  it("pins summary/copy/image models when channel settings change during generation", async () => {
    const f = await fixture({ sourceOnly: true });
    const mock = createFamilyProviderMock({ onStage: async call => { if (call.stage === "article_analysis") { const aiSettings = defaultChannelRoleSettings(); aiSettings.roleModels.card_copy = { provider: "openai", model: "gpt-new-unadmitted" }; aiSettings.roleModels.image_generation = { provider: "openai", model: "gpt-image-new-unadmitted" }; await getDb().update(channels).set({ aiSettings }).where(eq(channels.id, 2)); } } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const result = await f.agent.post(`${f.endpoint}/generate`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), templateKey: "set:n03" });
    expect(result.status, JSON.stringify(result.body)).toBe(200); expect(mock.calls.find(call => call.stage === "card_copy")?.body.model).toBe("gpt-family-copy"); expect(mock.calls.find(call => call.stage === "image_generation")?.body.model).toBe("gpt-image-family");
  });
});

describe("v2 PostgreSQL ownership and compatibility boundaries", () => {
  it("saves manually edited facts only after explicitly reconnecting the current owned evidence", async () => {
    const f = await fixture(), read = await f.agent.get(`${f.endpoint}/card-copy`); expect(read.status).toBe(200);
    const fact = read.body.evidence.facts.find((value: any) => value.id === "F1");
    expect(fact).toMatchObject({ claimType: "forecast", speaker: "빌 게이츠", timeScope: "미래 전망", conditions: ["전문 업무의 성과"], evidenceExcerpt: expect.any(String), sourceScope: "article_body" });
    const copy = structuredClone(f.copy), summary = copy.pages[1];
    if (summary.id !== "news_summary") throw new Error("summary fixture missing");
    summary.fields.facts[0] = "게이츠는 전문 업무에서 AI가 앞설 가능성을 이야기했어요.";
    summary.claimRefs = summary.claimRefs.filter(ref => ref.fieldPath !== "fields.facts.0");
    const unbound = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy }));
    expect(unbound.status).toBe(422); expect(unbound.body.code).toBe("missing_fact_binding"); expect((await latest(f.item.id)).revision).toEqual(f.revision);
    summary.claimRefs.push({ fieldPath: "fields.facts.0", claimType: fact.claimType, factIds: [fact.id], resourceIds: [] });
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200); expect(saved.body.copy).toEqual(copy); expect(saved.body.evidenceBinding).toEqual(f.metadata.evidenceBinding);
    expect(saved.body.dependencies.caption).toBe("needs_review"); expect((await latest(f.item.id)).item.reviewStatus).toBe("pending");
    const [original] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.revision.id)); expect(original).toEqual(f.revision); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unknown evidence, forecast promotion and factual-summary type bypasses after manual editing", async () => {
    const f = await fixture();
    for (const mutation of [
      { factIds: ["F99"], claimType: "forecast", resourceIds: [], code: "unknown_evidence" },
      { factIds: ["F1"], claimType: "forecast", resourceIds: ["R99"], code: "unknown_evidence" },
      { factIds: ["F1"], claimType: "research_finding", resourceIds: [], code: "summary_claim_type" },
      { factIds: ["F1"], claimType: "question", resourceIds: [], code: "summary_claim_type" },
      { factIds: ["F1"], claimType: "editorial_interpretation", resourceIds: [], code: "summary_claim_type" },
      { factIds: ["F1"], claimType: "hypothetical", resourceIds: [], code: "summary_claim_type" },
    ]) {
      const copy = structuredClone(f.copy), { code, ...ref } = mutation;
      copy.pages[1].claimRefs[0] = { ...copy.pages[1].claimRefs[0], ...ref } as typeof copy.pages[1]["claimRefs"][number];
      const response = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy }));
      expect(response.status, JSON.stringify(response.body)).toBe(422); expect(response.body.code).toBe(code);
    }
    const copy = structuredClone(f.copy); if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts[0] = "게이츠는 AI가 인간보다 우월하다고 입증했어요.";
    const certainty = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy })); expect(certainty.status).toBe(422); expect(certainty.body.code).toBe("forecast_attribution");
    expect((await latest(f.item.id)).revision).toEqual(f.revision); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves numeric forecast conditions and permits a science definition only with its own qualified evidence", async () => {
    const f = await fixture({ numericForecast: true }), copy = structuredClone(f.copy);
    if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts[0] = "게이츠는 AI가 전문 업무에서 앞설 것으로 전망했어요.";
    const dropped = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy })); expect(dropped.status).toBe(422); expect(dropped.body.code).toBe("numeric_condition_lost");
    if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts[0] = "게이츠는 12030년 평가 대상 112개 전문 업무에서 AI가 앞설 가능성을 말했어요.";
    const changedNumbers = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy })); expect(changedNumbers.status).toBe(422); expect(changedNumbers.body.code).toBe("numeric_condition_lost");
    if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts[0] = "게이츠는 2030년 평가 대상 12개 전문 업무에서 AI가 앞설 가능성을 말했어요.";
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy })); expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const science = await fixture({ scientific: true }), definition = structuredClone(science.copy), concept = definition.pages[5];
    if (concept.id !== "concept" || concept.fields.mode !== "scientific_explanation") throw new Error("science fixture missing");
    concept.fields.acceptedDefinition = "평균 속력은 이동 거리를 걸린 시간으로 나눈 값입니다.";
    concept.claimRefs = [{ fieldPath: "fields.acceptedDefinition", claimType: "research_finding", factIds: ["F1"], resourceIds: [] }];
    const wrong = await science.agent.patch(`${science.endpoint}/card-copy`).set(science.headers).send(saveBody(science, { copy: definition })); expect(wrong.status).toBe(422); expect(wrong.body.code).toBe("definition_evidence_type");
    concept.claimRefs[0].factIds = ["F3"];
    const linked = await science.agent.patch(`${science.endpoint}/card-copy`).set(science.headers).send(saveBody(science, { copy: definition })); expect(linked.status, JSON.stringify(linked.body)).toBe(200); expect(linked.body.copy).toEqual(definition); expect(fetch).not.toHaveBeenCalled();
  });
  it("admits a paid stage once under PostgreSQL concurrency and reuses its completed result", async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), mock = createFamilyProviderMock({ onStage: async call => { if (call.stage === "editorial_plan") { entered.resolve(); await release.promise; } } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const [channel] = await getDb().select().from(channels).where(eq(channels.id, f.item.channelId));
    const context = () => ({ db: getDb(), itemId: f.item.id, channelId: f.item.channelId, baseRevision: f.revision.id, requestId: randomUUID(), plan: familyExecutionPlan(channel, f.revision.id, f.bundle.snapshot.id), budget: new LlmBudget(3), runs: [], allowPaidRetry: true });
    const input = { stage: "editorial_plan" as const, role: "card_copy" as const, schema: editorialPlanSchema, prompt: "격리된 동시성 검증", data: { sourceAnalysis: f.bundle.analysis, articleBody: f.bundle.snapshot.sources[0].text } };
    const first = runFamilyEditorialStage(context(), input); await entered.promise;
    try { const second = await runFamilyEditorialStage(context(), input); expect(second.reviewFlags).toContainEqual(expect.objectContaining({ code: "stage_in_progress" })); expect(mock.calls).toHaveLength(1); } finally { release.resolve(); }
    expect((await first).status).toBe("ready"); expect((await runFamilyEditorialStage(context(), input)).status).toBe("ready"); expect(mock.calls).toHaveLength(1);
    const receipts = await getDb().select().from(familyEditorialStages).where(and(eq(familyEditorialStages.contentItemId, f.item.id), eq(familyEditorialStages.stage, "editorial_plan")));
    expect(receipts).toHaveLength(1); expect(receipts[0].status).toBe("ready");
  });
  it("records grounded search before HTTP and blocks a concurrent or abandoned automatic duplicate", async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), inputHash = sha256("isolated grounded search");
    const mock = createFamilyProviderMock({ onStage: async call => { if (call.stage === "resource_search") { const running = await getDb().select().from(familyEditorialStages).where(and(eq(familyEditorialStages.contentItemId, f.item.id), eq(familyEditorialStages.stage, "resource_search"), eq(familyEditorialStages.status, "running"))); expect(running).toHaveLength(1); entered.resolve(); await release.promise; } } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const [channel] = await getDb().select().from(channels).where(eq(channels.id, f.item.channelId));
    const context = () => ({ db: getDb(), itemId: f.item.id, channelId: f.item.channelId, baseRevision: f.revision.id, requestId: randomUUID(), plan: familyExecutionPlan(channel, f.revision.id, f.bundle.snapshot.id), budget: new LlmBudget(3), runs: [], allowPaidRetry: true });
    const first = runRecordedFamilyResourceSearch(context(), inputHash, "{}"); await entered.promise;
    try { const second = await runRecordedFamilyResourceSearch(context(), inputHash, "{}"); expect(second.ok).toBe(false); expect(mock.calls).toHaveLength(1); } finally { release.resolve(); }
    expect((await first).ok).toBe(true); expect((await runRecordedFamilyResourceSearch(context(), inputHash, "{}")).ok).toBe(true); expect(mock.calls).toHaveLength(1);
    const unknownHash = sha256("lost search response"), now = new Date();
    await getDb().insert(familyEditorialStages).values({ id: randomUUID(), channelId: f.item.channelId, contentItemId: f.item.id, stage: "resource_search", inputHash: unknownHash, requestId: randomUUID(), baseRevision: f.revision.id, status: "running", result: { status: "running" }, startedAt: new Date(now.getTime() - 300_000), finishedAt: now });
    expect((await runRecordedFamilyResourceSearch({ ...context(), allowPaidRetry: false }, unknownHash, "{}")).ok).toBe(false); expect(mock.calls).toHaveLength(1);
  });
  it("keeps a failed optional search immutable, permits an explicit recovery, then caches that successful recovery", async () => {
    const f = await fixture(), failures = new Set<FamilyMockStage>(["resource_search"]), mock = createFamilyProviderMock({ failStages: failures, failStatus: 401 }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const [channel] = await getDb().select().from(channels).where(eq(channels.id, f.item.channelId));
    const plan = { ...familyExecutionPlan(channel, f.revision.id, f.bundle.snapshot.id), editorial: { additionalResourcesAutoSearch: true, visitScope: "off" as const } };
    const context = () => ({ db: getDb(), itemId: f.item.id, channelId: f.item.channelId, baseRevision: f.revision.id, requestId: randomUUID(), plan, budget: new LlmBudget(12), runs: [], allowPaidRetry: true });
    const input = { snapshot: f.bundle.snapshot, analysis: f.bundle.analysis, editorialPlan: f.metadata.editorialPlan, needsDefinition: false };
    const failed = await researchFamilyResources(context(), input); expect(failed.data.searchStatus).toBe("failed"); expect(mock.calls).toHaveLength(1);
    expect((await researchFamilyResources({ ...context(), allowPaidRetry: false }, input)).data).toEqual(failed.data); expect(mock.calls).toHaveLength(1);
    failures.clear();
    const recovered = await researchFamilyResources(context(), input); expect(recovered.data.searchStatus).toBe("no_results"); expect(recovered.data.resourceResearchId).not.toBe(failed.data.resourceResearchId); expect(mock.calls).toHaveLength(2);
    expect((await researchFamilyResources(context(), input)).data).toEqual(recovered.data); expect(mock.calls).toHaveLength(2);
    const [original] = await getDb().select().from(familyEvidenceRecords).where(eq(familyEvidenceRecords.id, failed.data.resourceResearchId)); expect(original.payload.data).toEqual(failed.data);
  });
  it("confirms a manually saved caption without AI, preserving text, question, historical copy and publication inputs", async () => {
    const f = await fixture({ rendererProvider: "canva" }), instagram = `  직접 수정한 게시 문장입니다.\n\n${f.metadata.editorialPlan.coreQuestion}\n `;
    const captions = { instagram, telegram: "다른 채널의 입력은 유지합니다." };
    const publication = await f.agent.patch(`${f.endpoint}/publication-draft`).set(f.headers).send({ version: 0, captions, options: { destinationIds: [], timing: "later", scheduledAtKst: "" } }); expect(publication.status).toBe(200);
    const response = await f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send({ version: f.item.version, publicationDraftVersion: publication.body.version, textConfirmed: true });
    expect(response.status, JSON.stringify(response.body)).toBe(200); expect(response.body.captionPackage).toMatchObject({ origin: "manual", contentRevision: response.body.revisionId, fullCaption: instagram, confirmation: { comparedRevision: f.revision.id, captionHash: sha256(instagram) } });
    expect(response.body.captionPackage).not.toHaveProperty("hook"); expect(response.body.captionPackage).not.toHaveProperty("hashtags"); expect(response.body.dependencies.caption).toBe("current"); expect(response.body.canvaOutputReused).toBe(false);
    const current = await latest(f.item.id); expect(current.item.publicationDraft).toEqual(publication.body); expect(current.item.reviewStatus).toBe("pending"); expect(current.revision.payload.cardCopy).toEqual(f.copy); expect(current.revision.payload.evidenceBinding).toEqual(f.metadata.evidenceBinding);
    const [original] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.revision.id)); expect(original).toEqual(f.revision); expect(fetch).not.toHaveBeenCalled();
    const replay = await f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send({ version: current.item.version, publicationDraftVersion: publication.body.version, textConfirmed: true }); expect(replay.status).toBe(200); expect(replay.body.revisionId).toBe(response.body.revisionId); expect(replay.body.version).toBe(response.body.version);
  });
  it("rejects stale publication/card versions and mismatched questions without replacing the saved draft", async () => {
    const f = await fixture(), captions = { instagram: "아직 현재 카드의 질문을 넣지 않은 캡션", telegram: "기존 입력" };
    const publication = await f.agent.patch(`${f.endpoint}/publication-draft`).set(f.headers).send({ version: 0, captions }); expect(publication.status).toBe(200);
    const request = { version: f.item.version, publicationDraftVersion: publication.body.version, textConfirmed: true };
    expect((await f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send({ ...request, publicationDraftVersion: 0 })).status).toBe(409);
    expect((await f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send({ ...request, version: f.item.version + 1 })).status).toBe(409);
    expect((await f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send(request)).status).toBe(422);
    const current = await latest(f.item.id); expect(current.revision).toEqual(f.revision); expect(current.item.publicationDraft).toEqual(publication.body); expect(fetch).not.toHaveBeenCalled();
  });
  it("drops obsolete false locks while rejecting enabled locks for missing fields", async () => {
    const f = await fixture(), missing = "pages.concept.fields.acceptedDefinition";
    const ignored = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { fieldLocks: { [missing]: false } }));
    expect(ignored.status, JSON.stringify(ignored.body)).toBe(200); expect(ignored.body.fieldLocks).toEqual({});
    const rejected = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { version: ignored.body.version, fieldLocks: { [missing]: true } }));
    expect(rejected.status).toBe(400); expect((await latest(f.item.id)).revision).toEqual(f.revision);
  });
  it("allows only one of two concurrent saves at the same version", async () => {
    const f = await fixture(), a = structuredClone(f.copy), b = structuredClone(f.copy);
    if (a.pages[0].id === "cover") a.pages[0].fields.headline = "첫 번째 동시 편집";
    if (b.pages[0].id === "cover") b.pages[0].fields.headline = "두 번째 동시 편집";
    const replies = await Promise.all([f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy: a })), f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy: b }))]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409]); expect((await latest(f.item.id)).item.version).toBe(f.item.version + 1);
    expect(await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).toHaveLength(2);
  });
  it("rejects stale v1 clients and preserves the complete stored v2 revision", async () => {
    const f = await fixture();
    const response = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy: cardCopyFixture("set:n03") });
    expect(response.status).toBe(409); expect(response.body.code).toBe("editor_reload_required"); expect((await latest(f.item.id)).revision).toEqual(f.revision);
  });
  it("preserves evidence/metadata when a source editor omits them or submits forged replacements", async () => {
    const f = await fixture();
    const payload = { ...emptyPayload("science_dialogue", "수동 원문 수정"), scientific_basis: "운영자가 확인한 원문의 설명입니다.", cardCopy: cardCopyFixture(), evidenceBinding: { evidenceSetId: "other-item" }, editorialPlan: { coreQuestion: "무단 변경" }, generationRuns: [], rendererProvider: "canva", canvaExport: { forged: true } };
    const saved = await f.agent.patch(f.endpoint).set(f.headers).send({ version: f.item.version, payload });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const current = await latest(f.item.id);
    expect(current.revision.payload.cardCopy).toEqual(f.copy); expect(current.revision.payload.evidenceBinding).toEqual(f.metadata.evidenceBinding); expect(current.revision.payload.editorialPlan).toEqual(f.metadata.editorialPlan); expect(current.revision.payload.rendererProvider).toBe("builtin"); expect(current.revision.payload).not.toHaveProperty("canvaExport");
  });
  it("rejects forged resource refs in save, preview and final rendering without creating images", async () => {
    const f = await fixture(), copy = structuredClone(f.copy);
    if (copy.pages[6].id === "activity") copy.pages[6].fields.optionalActivity = { label: "잘못된 자료", action: "다른 항목의 논문을 읽어 보세요.", resourceId: "R99" };
    const save = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { copy })); expect(save.status).toBe(422);
    const preview = await f.agent.post(`${f.endpoint}/card-copy/preview`).set(f.headers).send({ version: f.item.version, copy, pageDesigns: f.metadata.pageDesigns, page: 6 }); expect(preview.status).toBe(422);
    await getDb().update(contentRevisions).set({ payload: { ...f.revision.payload, cardCopy: copy } }).where(eq(contentRevisions.id, f.revision.id));
    expect(await renderCardForItem(getDb(), f.item.id, new Date(), "set:n03", { version: f.item.version, coverMode: "typography" })).toMatchObject({ ok: false, code: "invalid_payload" });
    expect(await getDb().select().from(mediaAssets).where(eq(mediaAssets.contentItemId, f.item.id))).toHaveLength(0);
  });
  it("does not accept another item's evidence binding even when every referenced fact ID exists there", async () => {
    const a = await fixture(), b = await fixture();
    const save = await a.agent.patch(`${a.endpoint}/card-copy`).set(a.headers).send(saveBody(a, { evidenceBinding: b.metadata.evidenceBinding })); expect(save.status).toBe(400);
    await getDb().update(contentRevisions).set({ payload: { ...a.revision.payload, evidenceBinding: b.metadata.evidenceBinding } }).where(eq(contentRevisions.id, a.revision.id));
    const preview = await a.agent.post(`${a.endpoint}/card-copy/preview`).set(a.headers).send({ version: a.item.version, copy: a.copy, pageDesigns: a.metadata.pageDesigns, page: 0 }); expect(preview.status).toBe(409);
    expect(await renderCardForItem(getDb(), a.item.id, new Date(), "set:n03", { version: a.item.version, coverMode: "typography" })).toMatchObject({ ok: false, code: "invalid_payload" });
  });
  it("rejects database updates to a fixed evidence record", async () => {
    const f = await fixture();
    await expect(getDb().update(familyEvidenceRecords).set({ payload: { altered: true } }).where(eq(familyEvidenceRecords.id, f.metadata.evidenceBinding.sourceAnalysisId))).rejects.toThrow();
    const [record] = await getDb().select().from(familyEvidenceRecords).where(eq(familyEvidenceRecords.id, f.metadata.evidenceBinding.sourceAnalysisId));
    expect(record.payload).toEqual(f.bundle.analysis);
  });
  it("rebinds a caption after background-only saves and leaves a repeated save as a no-op", async () => {
    const f = await fixture(), designs = structuredClone(f.metadata.pageDesigns); designs.cover.background.overlay = 53;
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send(saveBody(f, { pageDesigns: designs })); expect(saved.status).toBe(200);
    expect(saved.body.captionPackage.contentRevision).toBe(saved.body.revisionId); expect(saved.body.dependencies.caption).toBe("current");
    const repeated = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: saved.body.version, copy: saved.body.copy, pageDesigns: saved.body.pageDesigns, fieldLocks: saved.body.fieldLocks, parentGuide: saved.body.parentGuide, captionPackage: saved.body.captionPackage });
    expect(repeated.status).toBe(200); expect(repeated.body.revisionId).toBe(saved.body.revisionId); expect(repeated.body.version).toBe(saved.body.version);
  });
  it("keeps Canva-selected revisions from being silently rendered by the builtin worker", async () => {
    const f = await fixture({ rendererProvider: "canva" });
    const http = await f.agent.post(`${f.endpoint}/card`).set(f.headers).send({ version: f.item.version, requestId: randomUUID(), coverMode: "typography" }); expect(http.status).toBe(409);
    expect(await renderCardForItem(getDb(), f.item.id, new Date(), "set:n03", { version: f.item.version })).toMatchObject({ ok: false, code: "conflict" });
    expect(await getDb().select().from(mediaAssets).where(eq(mediaAssets.contentItemId, f.item.id))).toHaveLength(0);
  });
});
