import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { familyEvidenceRecords, familyEditorialStages } from "../../shared/familyEvidenceDb";
import { resourceResearchSchema, type EvidenceSource, type ResourceResearch, type SourceAnalysis, type SourceSnapshot, type VerifiedResource } from "../../shared/familyEvidence";
import type { EditorialPlan, GenerationRun } from "../../shared/familyDialogue";
import { stageProvenance } from "../../shared/aiProvenance";
import { type FamilyStageContext, runFamilyEditorialStage } from "./familyEditorialStages";
import { FAMILY_EDITORIAL_PROMPTS } from "./familyEditorialPrompts";
import { geminiResearchRequest, type GeminiResearchData } from "./geminiResearch";
import type { LlmResult } from "./llm";
import { fetchAndExtract } from "./extract";
import { familyHash, putFamilyEvidence } from "./familyEvidence";
import { currentGenerationSignal } from "./generationContext";
import { kstToday } from "./dates";
import { resolveFamilyDialogueSettings } from "../../shared/familyDialogueSettings";

const norm = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();
const draftResourceSchema = z.object({
  sourceId: z.string().min(1).max(160), kind: z.enum(["online", "paper", "visit", "definition"]), evidenceExcerpt: z.string().min(4).max(1000), connectionReason: z.string().min(1).max(1000), readingTarget: z.string().min(1).max(600), action: z.string().min(1).max(600), priority: z.number().int().min(1).max(10), visitRegion: z.string().max(200).nullable(),
  availability: z.object({ startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), evidenceExcerpt: z.string().min(4).max(1000) }).strict().nullable(),
}).strict();
const researchDraftSchema = z.object({ homeActivity: resourceResearchSchema.shape.homeActivity, verifiedResources: z.array(draftResourceSchema).max(4), operatorNotes: z.array(z.string().max(1000)).max(20) }).strict();
const dateStrings = (text: string) => [...text.matchAll(/(20\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})(?:\s*일)?/g)].map(match => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);

/** A model chooses only a fetched source. Its title, URL, scope and check time come from the server. */
export function verifyFamilyResourceCandidate(candidate: z.infer<typeof draftResourceSchema>, source: EvidenceSource | undefined, options: { visitScope: "off" | "region" | "national"; activityRegion?: string; today: string; recommendationEligible: boolean }): { resource: Omit<VerifiedResource, "id"> | null; reason: string | null } {
  if (!source || source.text.trim().length < 100 || source.scope === "search_result") return { resource: null, reason: "본문·초록을 실제 확인하지 못한 검색 결과는 추천에서 제외했습니다." };
  try { const url = new URL(source.finalUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { return { resource: null, reason: "공개 원문 주소를 확인하지 못한 자료는 추천에서 제외했습니다." }; }
  const corpus = norm(source.text);
  if (!corpus.includes(norm(candidate.evidenceExcerpt))) return { resource: null, reason: "추가 자료의 근거 구절이 실제 확인한 페이지와 달라 제외했습니다." };
  if (source.scope === "abstract" && /(?:본문|전체\s*논문|그림\s*\d|표\s*\d)/.test(candidate.readingTarget)) return { resource: null, reason: "초록만 확인한 자료에 본문·그림 열람을 권하지 않았습니다." };
  let availability: VerifiedResource["availability"] = null;
  if (candidate.kind === "visit") {
    if (options.visitScope === "off" || options.visitScope === "region" && !options.activityRegion) return { resource: null, reason: "방문 활동이 허용되지 않아 온라인·집 활동만 남겼습니다." };
    if (options.visitScope === "region" && (!candidate.visitRegion || !norm(candidate.visitRegion).includes(norm(options.activityRegion!)) || !norm(`${source.title} ${source.text}`).includes(norm(options.activityRegion!)))) return { resource: null, reason: "요청한 지역과 실제 프로그램의 연결을 확인하지 못해 방문 추천을 제외했습니다." };
    const evidence = candidate.availability;
    if (!evidence || !corpus.includes(norm(evidence.evidenceExcerpt))) return { resource: null, reason: "기관 이름만 확인됐고 전시·프로그램의 이용 가능 시점은 확인하지 못했습니다." };
    const dates = dateStrings(evidence.evidenceExcerpt);
    if ([evidence.startsAt, evidence.endsAt].some(date => date && !dates.includes(date))) return { resource: null, reason: "방문 기간의 날짜가 실제 안내와 일치하지 않아 제외했습니다." };
    if (evidence.startsAt && evidence.startsAt > options.today || evidence.endsAt && evidence.endsAt < options.today) return { resource: null, reason: "현재 이용 가능한 기간이 아니어서 방문 추천에서 제외했습니다." };
    if (!evidence.endsAt && !/(상설|연중|permanent|ongoing)/i.test(evidence.evidenceExcerpt)) return { resource: null, reason: "현재 이용 가능 여부가 불분명한 방문 활동은 제외했습니다." };
    availability = { ...evidence, detail: evidence.evidenceExcerpt };
  }
  return { resource: { sourceId: source.id, kind: candidate.kind, title: source.title, publisher: source.publisher, url: source.finalUrl, scope: source.scope, checkedAt: source.fetchedAt, evidenceExcerpt: candidate.evidenceExcerpt, connectionReason: candidate.connectionReason, readingTarget: candidate.readingTarget, action: candidate.action, priority: candidate.priority, recommendationEligible: options.recommendationEligible && candidate.kind !== "definition", visitRegion: candidate.kind === "visit" ? candidate.visitRegion : null, availability }, reason: null };
}

const fallbackActivity = () => ({ title: "주장과 근거 나눠 보기", materials: ["기사 원문", "종이와 펜"], steps: ["원문에서 주장 한 문장과 그 근거를 찾아 서로 다른 표시를 해요.", "더 확인하고 싶은 점을 하나 적고 서로의 이유를 들어요."], minutes: 5, closingQuestion: "어떤 정보를 더 알면 생각을 바꿀 수 있을까요?" });

const searchDataSchema = z.object({ text: z.string().max(24000), searchPerformed: z.boolean(), queries: z.array(z.string().max(500)).max(12), sources: z.array(z.object({ url: z.string().url().max(4000), title: z.string().max(500), verification: z.literal("search_result") })).max(12) });
/** A search can be charged even when its response is lost. Admit it durably
 * before network I/O, just like copy and image stages. */
export async function runRecordedFamilyResourceSearch(context: FamilyStageContext, inputHash: string, user: string): Promise<LlmResult<GeminiResearchData>> {
  const selected = context.plan.roles.resource_research;
  const readRows = () => context.db.select().from(familyEditorialStages).where(and(eq(familyEditorialStages.channelId, context.channelId), eq(familyEditorialStages.contentItemId, context.itemId), eq(familyEditorialStages.stage, "resource_search"), eq(familyEditorialStages.inputHash, inputHash))).orderBy(desc(familyEditorialStages.finishedAt));
  const reuse = (rows: Awaited<ReturnType<typeof readRows>>): LlmResult<GeminiResearchData> | null => {
    for (const row of rows.filter(value => value.status === "ready")) {
      const parsed = searchDataSchema.safeParse(row.result.data);
      if (!parsed.success) continue;
      const provenance = row.provenance as GenerationRun["provenance"];
      context.runs.push({ id: row.id, stage: "resource_research", status: "ready", baseRevision: row.baseRevision, inputHash, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString(), provenance, error: null });
      return { ok: true, data: parsed.data, model: provenance?.actualModel ?? selected.model, usage: { inputTokens: provenance?.inputTokens ?? 0, outputTokens: provenance?.outputTokens ?? 0 }, provenance: provenance ?? undefined, usageStatus: provenance?.usageStatus ?? "usage_unknown", droppedEvidence: 0 };
    }
    return null;
  };
  const blocked = (): LlmResult<GeminiResearchData> => ({ ok: false, kind: "api", error: "같은 자료 검색이 처리 중이거나 이전 응답이 미확정이어서 유료 검색을 반복하지 않았습니다. 기존 원고와 집에서 하는 활동은 유지됩니다.", provenance: stageProvenance(context.plan, "resource_research"), usageStatus: "usage_unknown" });
  const rows = await readRows(), cached = reuse(rows); if (cached) return cached;
  if (rows.length && context.allowPaidRetry === false) return blocked();
  const abandoned = rows.filter(row => row.status === "running" && row.requestId !== context.requestId && row.startedAt.getTime() < Date.now() - 180_000);
  if (abandoned.length) await context.db.update(familyEditorialStages).set({ status: "failed", result: { error: "이전 검색 요청의 결과·사용량 미확정. 새 요청은 운영자가 명시적으로 시작했습니다." }, finishedAt: new Date() }).where(and(inArray(familyEditorialStages.id, abandoned.map(row => row.id)), eq(familyEditorialStages.status, "running")));
  const id = randomUUID(), startedAt = new Date();
  const admitted = await context.db.insert(familyEditorialStages).values({ id, channelId: context.channelId, contentItemId: context.itemId, stage: "resource_search", inputHash, requestId: context.requestId, baseRevision: context.baseRevision, status: "running", result: { status: "running" }, provenance: stageProvenance(context.plan, "resource_research"), startedAt, finishedAt: startedAt }).onConflictDoNothing().returning({ id: familyEditorialStages.id });
  if (!admitted.length) return blocked();
  const raced = reuse(await readRows());
  if (raced) { await context.db.update(familyEditorialStages).set({ status: "cancelled", result: { reusedCompletedStage: true }, finishedAt: new Date() }).where(eq(familyEditorialStages.id, id)); return raced; }
  const search = await geminiResearchRequest({ system: FAMILY_EDITORIAL_PROMPTS.common, user, model: selected.model, budget: context.budget, signal: currentGenerationSignal(), maxTokens: 2500 });
  const finishedAt = new Date(), provenance = stageProvenance(context.plan, "resource_research", search.provenance);
  context.runs.push({ id, stage: "resource_research", status: search.ok ? "ready" : "failed", baseRevision: context.baseRevision, inputHash, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), provenance, error: search.ok ? null : search.error });
  await context.db.update(familyEditorialStages).set({ status: search.ok ? "ready" : "failed", result: search.ok ? { data: search.data } : { error: search.error }, provenance, finishedAt }).where(eq(familyEditorialStages.id, id));
  return search;
}

export async function researchFamilyResources(context: FamilyStageContext, input: { snapshot: SourceSnapshot; analysis: SourceAnalysis; editorialPlan: EditorialPlan; needsDefinition: boolean; force?: boolean }): Promise<{ data: ResourceResearch; sources: EvidenceSource[] }> {
  const settings = resolveFamilyDialogueSettings(context.plan.editorial);
  const selected = context.plan.roles.resource_research;
  const baseFingerprint = familyHash({ snapshot: input.snapshot.id, analysis: input.analysis.sourceAnalysisId, plan: input.editorialPlan, settings, selected, needsDefinition: input.needsDefinition, ...(input.force ? { requestId: context.requestId } : {}) });
  const [cached] = await context.db.select().from(familyEvidenceRecords).where(and(eq(familyEvidenceRecords.channelId, context.channelId), eq(familyEvidenceRecords.contentItemId, context.itemId), eq(familyEvidenceRecords.kind, "resource_research"), or(eq(familyEvidenceRecords.fingerprint, baseFingerprint), sql`${familyEvidenceRecords.payload}->>'cacheBaseFingerprint' = ${baseFingerprint}`))).orderBy(desc(familyEvidenceRecords.createdAt)).limit(1);
  let fingerprint = baseFingerprint;
  if (cached) {
    const data = resourceResearchSchema.parse(cached.payload.data), retryable = cached.payload.retryable === true || ["failed", "not_connected"].includes(data.searchStatus);
    if (!retryable || context.allowPaidRetry !== true) return { data, sources: cached.payload.sources as EvidenceSource[] };
    // Only a new explicit request retries an incomplete optional stage. Keep
    // the failed evidence immutable and reuse the most recent completed retry.
    fingerprint = familyHash({ retryOf: baseFingerprint, requestId: context.requestId });
  }
  const resourceResearchId = randomUUID(), operatorNotes: string[] = [];
  const sources: EvidenceSource[] = input.snapshot.sources.filter(source => source.role !== "primary_article").slice(0, 4);
  const providedIds = new Set(sources.map(source => source.id));
  const shouldSearch = settings.additionalResourcesAutoSearch || input.needsDefinition;
  let searchStatus: ResourceResearch["searchStatus"] = shouldSearch ? "not_connected" : "off";
  if (input.needsDefinition && !settings.additionalResourcesAutoSearch) operatorNotes.push("추천자료 자동 탐색은 꺼져 있습니다. 확정한 과학 개념의 필수 정의 근거만 별도로 확인합니다.");
  if (shouldSearch && selected.provider !== "gemini") operatorNotes.push("선택한 자료 조사 공급자의 검색 연결은 지원되지 않습니다. Gemini 검색 연결을 선택하거나 확인할 자료를 직접 연결해 주세요. 다른 공급자를 몰래 호출하지 않았습니다.");
  else if (shouldSearch && context.budget.limit - context.budget.used < 4) operatorNotes.push("필수 문구 작성 예산을 남기기 위해 추가 검색을 시작하지 않았습니다. 호출 예산을 늘린 뒤 자료 조사를 명시적으로 다시 요청할 수 있습니다.");
  else if (shouldSearch) {
    const search = await runRecordedFamilyResourceSearch(context, baseFingerprint, JSON.stringify({ purpose: input.needsDefinition ? "핵심 과학 개념의 통용 정의 근거 및 허용된 추가 자료" : "기사와 연결된 실제 추가 활동 자료", editorialPlan: input.editorialPlan, visitScope: settings.visitScope, ...(settings.activityRegion ? { activityRegion: settings.activityRegion } : {}), onlineResources: settings.additionalResourcesAutoSearch, instruction: "공식 원자료를 우선해 실제 검색 결과를 확인하세요. 존재하지 않는 URL이나 방문 가능 날짜를 만들지 마세요." }));
    if (!search.ok) { searchStatus = search.kind === "not_configured" ? "not_connected" : "failed"; operatorNotes.push(search.error); }
    else {
      searchStatus = search.data.sources.length ? "completed" : "no_results";
      if (!search.data.searchPerformed) operatorNotes.push("실제 검색 자료가 반환되지 않아 확인한 추천자료로 표시하지 않았습니다.");
      let extraCalls = 0;
      for (const candidate of search.data.sources.slice(0, 4)) {
        currentGenerationSignal()?.throwIfAborted();
        const result = await fetchAndExtract(candidate.url, undefined, { takeExtraCall: () => ++extraCalls <= 2 });
        if (!result.ok || result.text.trim().length < 100) { operatorNotes.push(`${candidate.title || "검색 자료"}: ${result.ok ? "본문이 충분하지 않습니다." : result.error}`.slice(0, 1000)); continue; }
        const abstract = /(?:arxiv\.org\/abs\/|\/abstract(?:\/|$))/i.test(result.finalUrl);
        sources.push({ id: `research-${familyHash({ url: result.finalUrl, hash: result.hash }).slice(0, 24)}`, documentId: null, role: "researched", scope: abstract ? "abstract" : result.contentKind === "pdf" ? "provided_document" : "web_page", title: result.title || candidate.title || "제공 문서", requestedUrl: candidate.url, finalUrl: result.finalUrl, canonicalUrl: null, publisher: new URL(result.finalUrl).hostname, publishedAt: null, fetchedAt: new Date().toISOString(), text: result.text, contentHash: result.hash });
      }
    }
  }
  let homeActivity = fallbackActivity(), normalizationIncomplete = sources.length > 0 && context.budget.limit - context.budget.used < 3;
  const verifiedResources: VerifiedResource[] = [];
  if (sources.length && context.budget.limit - context.budget.used >= 3) {
    const normalized = await runFamilyEditorialStage(context, { stage: "resource_research", role: "resource_research", schema: researchDraftSchema, prompt: `${FAMILY_EDITORIAL_PROMPTS.resources}\n메타데이터는 앱이 부여한다. verifiedResources에는 sourceId와 실제 읽은 구절·활동만 적고 URL·제목·시각·자료 ID를 만들지 마라. sourceScope=abstract인 자료는 초록에서 확인한 부분만 제안한다.`, data: { currentDateKST: kstToday(new Date()), resourceResearchId, additionalResourcesAutoSearch: settings.additionalResourcesAutoSearch, visitScope: settings.visitScope, ...(settings.activityRegion ? { activityRegion: settings.activityRegion } : {}), editorialPlan: input.editorialPlan, sourceAnalysis: input.analysis, providedResources: sources, operatorNotes }, cacheData: { fingerprint, sources }, maxTokens: 6000 });
    if (normalized.status === "ready" && normalized.data) {
      homeActivity = normalized.data.homeActivity;
      operatorNotes.push(...normalized.data.operatorNotes);
      for (const candidate of normalized.data.verifiedResources) {
        const source = sources.find(value => value.id === candidate.sourceId);
        const verification = verifyFamilyResourceCandidate(candidate, source, { ...settings, today: kstToday(new Date()), recommendationEligible: settings.additionalResourcesAutoSearch || providedIds.has(candidate.sourceId) });
        if (verification.resource) verifiedResources.push({ id: `R${verifiedResources.length + 1}`, ...verification.resource });
        else if (verification.reason) operatorNotes.push(verification.reason);
      }
    } else { normalizationIncomplete = true; operatorNotes.push(...normalized.reviewFlags.map(flag => flag.message)); }
  }
  const data = resourceResearchSchema.parse({ resourceResearchId, appliedVisitScope: settings.visitScope, homeActivity, verifiedResources, operatorNotes: operatorNotes.slice(0, 30), searchStatus });
  return putFamilyEvidence(context.db, { id: resourceResearchId, itemId: context.itemId, channelId: context.channelId, kind: "resource_research", fingerprint, sourceSnapshotId: input.snapshot.id, payload: { data, sources, cacheBaseFingerprint: baseFingerprint, retryable: normalizationIncomplete || ["failed", "not_connected"].includes(searchStatus) } });
}
