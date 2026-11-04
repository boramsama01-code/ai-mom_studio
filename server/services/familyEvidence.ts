import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, sourceDocuments } from "../../shared/schema";
import { familyEvidenceRecords } from "../../shared/familyEvidenceDb";
import { evidenceSetSchema, resourceResearchSchema, sourceAnalysisSchema, sourceSnapshotSchema, type EvidenceSource, type EvidenceSet, type FamilyEvidenceBundle, type FamilyEvidenceView, type ResourceResearch, type SourceAnalysis, type SourceSnapshot } from "../../shared/familyEvidence";
import { type CardCopyV2, type EvidenceBinding, type EditorialPlan, type ParentGuide, type ReviewFlag, familyFieldValue } from "../../shared/familyDialogue";
import { loadNewsEditorialSources } from "./newsEditorialSources";
import { itemPrimarySource } from "./itemSources";
import { HttpError } from "../routes/util";
import { sha256 } from "./text";

export function stableFamilyJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableFamilyJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableFamilyJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const familyHash = (value: unknown) => sha256(stableFamilyJson(value));
const norm = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

export function familyPublicSourceUrl(value: string): string | null {
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
}
export function familyEvidenceView(bundle: FamilyEvidenceBundle): FamilyEvidenceView {
  const sources = new Map([...bundle.snapshot.sources, ...bundle.researchedSources].map(source => [source.id, source]));
  return { evidenceSetId: bundle.evidenceSet.evidenceSetId, facts: bundle.evidenceSet.facts, resources: bundle.evidenceSet.resources,
    sources: [...sources.values()].map(source => ({ id: source.id, title: source.title, url: familyPublicSourceUrl(source.finalUrl), scope: source.scope, fetchedAt: source.fetchedAt })) };
}

export async function putFamilyEvidence<T extends Record<string, unknown>>(db: DB, input: { id: string; itemId: number; channelId: number; kind: "source_snapshot" | "source_analysis" | "resource_research" | "evidence_set"; fingerprint: string; sourceSnapshotId?: string; payload: T }): Promise<T> {
  await db.insert(familyEvidenceRecords).values({ id: input.id, contentItemId: input.itemId, channelId: input.channelId, kind: input.kind, fingerprint: input.fingerprint, sourceSnapshotId: input.sourceSnapshotId, payload: input.payload }).onConflictDoNothing();
  const [saved] = await db.select().from(familyEvidenceRecords).where(and(eq(familyEvidenceRecords.channelId, input.channelId), eq(familyEvidenceRecords.contentItemId, input.itemId), eq(familyEvidenceRecords.kind, input.kind), eq(familyEvidenceRecords.fingerprint, input.fingerprint)));
  if (!saved) throw new HttpError(409, "근거 버전을 저장하지 못했습니다. 기존 원고는 유지했습니다.");
  return saved.payload as T;
}

export async function captureFamilySourceSnapshot(db: DB, item: typeof contentItems.$inferSelect): Promise<SourceSnapshot | null> {
  const primary = await itemPrimarySource(db, item), available = await loadNewsEditorialSources(db, item);
  if (!primary || !available.some(source => source.source_id === primary.id && source.text.trim().length >= 100)) return null;
  const ids = available.slice(0, 20).map(source => source.source_id);
  if (!ids.includes(primary.id)) ids.unshift(primary.id);
  const docs = await db.select().from(sourceDocuments).where(inArray(sourceDocuments.id, ids.slice(0, 20)));
  const sources: EvidenceSource[] = docs.map(doc => {
    const finalUrl = typeof doc.meta.finalUrl === "string" ? doc.meta.finalUrl : typeof doc.meta.resolvedUrl === "string" ? doc.meta.resolvedUrl : doc.originalUrl;
    const manual = doc.kind === "manual_text";
    return { id: `source-${doc.id}`, documentId: doc.id, role: doc.id === primary.id ? "primary_article" : manual ? "provided" : "supporting", scope: manual ? "manual_paste" : "article_body", title: doc.title || item.title, requestedUrl: doc.originalUrl, finalUrl, canonicalUrl: typeof doc.meta.canonicalUrl === "string" ? doc.meta.canonicalUrl : null, publisher: typeof doc.meta.publisher === "string" ? doc.meta.publisher : null, publishedAt: doc.publishedRaw, fetchedAt: (doc.lastFetchedAt ?? doc.updatedAt).toISOString(), text: doc.fetchedText ?? "", contentHash: sha256(doc.fetchedText ?? "") };
  });
  const fingerprint = familyHash({ primarySourceId: primary.id, sources });
  const snapshot = sourceSnapshotSchema.parse({ id: randomUUID(), channelId: item.channelId, itemId: item.id, capturedAt: new Date().toISOString(), primarySourceId: `source-${primary.id}`, sources, identityStatus: primary.kind === "manual_text" ? "manual_paste" : "source_record" });
  return putFamilyEvidence(db, { id: snapshot.id, itemId: item.id, channelId: item.channelId, kind: "source_snapshot", fingerprint, payload: snapshot });
}

export function validateFamilySourceAnalysis(analysis: SourceAnalysis, snapshot: SourceSnapshot): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (analysis.sourceSnapshotId !== snapshot.id) flags.push({ path: "sourceSnapshotId", code: "wrong_snapshot", message: "기사 분석이 다른 원문 버전을 가리킵니다." });
  for (const fact of analysis.facts) {
    const source = snapshot.sources.find(candidate => candidate.id === fact.sourceId);
    if (!source || !norm(source.text).includes(norm(fact.evidenceExcerpt))) flags.push({ path: `facts.${fact.id}.evidenceExcerpt`, code: "unsupported_excerpt", message: "사실의 근거 구절이 지정한 원문에 없습니다." });
    if (source && (fact.sourceScope !== source.scope || fact.verificationStatus === "primary_checked" && source.scope !== "primary_body")) flags.push({ path: `facts.${fact.id}.sourceScope`, code: "overstated_scope", message: "실제로 읽은 자료 범위보다 강하게 검증 상태를 표시했습니다." });
    if ((fact.claimType === "forecast" || fact.claimType === "attributed_statement") && !fact.speaker?.trim()) flags.push({ path: `facts.${fact.id}.speaker`, code: "missing_speaker", message: "발언·전망의 주체를 남겨 주세요." });
    else if (source && ["forecast", "attributed_statement"].includes(fact.claimType) && !namedIn(source.text, fact.speaker)) flags.push({ path: `facts.${fact.id}.speaker`, code: "unsupported_speaker", message: "지정한 발언자의 이름을 실제 원문에서 확인하지 못했습니다." });
  }
  return flags;
}

export async function createFamilyEvidenceSet(db: DB, item: typeof contentItems.$inferSelect, snapshot: SourceSnapshot, analysis: SourceAnalysis, research: ResourceResearch | null, researchedSources: EvidenceSource[]): Promise<EvidenceSet> {
  const fingerprint = familyHash({ snapshot: snapshot.id, analysis: analysis.sourceAnalysisId, research: research?.resourceResearchId ?? null });
  const set = evidenceSetSchema.parse({ evidenceSetId: randomUUID(), sourceSnapshotId: snapshot.id, sourceAnalysisId: analysis.sourceAnalysisId, resourceResearchId: research?.resourceResearchId ?? null, channelId: item.channelId, itemId: item.id, createdAt: new Date().toISOString(), facts: analysis.facts, resources: research?.verifiedResources ?? [], sourceIds: [...new Set([...snapshot.sources, ...researchedSources].map(source => source.id))] });
  return putFamilyEvidence(db, { id: set.evidenceSetId, itemId: item.id, channelId: item.channelId, kind: "evidence_set", fingerprint, sourceSnapshotId: snapshot.id, payload: set });
}

export async function loadFamilyEvidence(db: DB, item: { id: number; channelId: number }, binding: EvidenceBinding): Promise<FamilyEvidenceBundle> {
  const ids = [binding.evidenceSetId, binding.sourceSnapshotId, binding.sourceAnalysisId, ...(binding.resourceResearchId ? [binding.resourceResearchId] : [])];
  const rows = await db.select().from(familyEvidenceRecords).where(and(eq(familyEvidenceRecords.contentItemId, item.id), eq(familyEvidenceRecords.channelId, item.channelId), inArray(familyEvidenceRecords.id, ids)));
  const read = (id: string, kind: string) => {
    const row = rows.find(value => value.id === id && value.kind === kind);
    if (!row) throw new HttpError(409, "이 원고에 연결된 고정 근거 묶음을 찾을 수 없습니다. 다른 콘텐츠의 근거는 사용할 수 없습니다.");
    return row.payload;
  };
  const snapshot = sourceSnapshotSchema.parse(read(binding.sourceSnapshotId, "source_snapshot"));
  const analysis = sourceAnalysisSchema.parse(read(binding.sourceAnalysisId, "source_analysis"));
  const researchPayload = binding.resourceResearchId ? read(binding.resourceResearchId, "resource_research") : null;
  const research = researchPayload ? resourceResearchSchema.parse(researchPayload.data) : null;
  const researchedSources = researchPayload && Array.isArray(researchPayload.sources) ? researchPayload.sources as EvidenceSource[] : [];
  const evidenceSet = evidenceSetSchema.parse(read(binding.evidenceSetId, "evidence_set"));
  if (analysis.sourceSnapshotId !== snapshot.id || evidenceSet.sourceSnapshotId !== binding.sourceSnapshotId || evidenceSet.sourceAnalysisId !== binding.sourceAnalysisId || evidenceSet.resourceResearchId !== binding.resourceResearchId || evidenceSet.itemId !== item.id || evidenceSet.channelId !== item.channelId) throw new HttpError(409, "근거 묶음의 원문·분석·자료 버전이 서로 맞지 않습니다.");
  return { snapshot, analysis, research, evidenceSet, researchedSources };
}

function fieldText(copy: CardCopyV2, pageId: string, relative: string) {
  const value = familyFieldValue(copy, relative.startsWith("pages.") ? relative : `pages.${pageId}.${relative}`);
  return Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
}
function namedIn(text: string, name: string | null) {
  if (!name) return false;
  const full = norm(name), last = full.split(" ").at(-1)!;
  return norm(text).includes(full) || [...last].length >= 2 && norm(text).includes(last);
}
const numericTokens = (text: string) => [...text.matchAll(/\d+(?:\.\d+)?\s*(?:%|년|명|개월|개|주|배|도|일)?/g)].map(match => match[0].replace(/\s+/g, ""));
export function validateFamilyEvidenceReferences(copy: CardCopyV2, bundle: FamilyEvidenceBundle, plan?: EditorialPlan, parentGuide?: ParentGuide | null): ReviewFlag[] {
  const flags: ReviewFlag[] = [], facts = new Map(bundle.evidenceSet.facts.map(fact => [fact.id, fact])), resources = new Map(bundle.evidenceSet.resources.map(resource => [resource.id, resource]));
  for (const page of copy.pages) {
    for (const ref of page.claimRefs) {
      const path = `pages.${page.id}.${ref.fieldPath.replace(new RegExp(`^pages\\.${page.id}\\.`), "")}`;
      if (familyFieldValue(copy, path) === undefined) flags.push({ path, code: "invalid_evidence_path", message: "근거는 현재 페이지에 실제로 있는 문구 칸에 연결해 주세요." });
      if (ref.factIds.some(id => !facts.has(id)) || ref.resourceIds.some(id => !resources.has(id))) flags.push({ path, code: "unknown_evidence", message: "이 revision의 고정 근거 묶음에 없는 사실·자료 ID입니다." });
      if (["reported_event", "research_finding", "attributed_statement", "forecast"].includes(ref.claimType) && !ref.factIds.length && !ref.resourceIds.length) flags.push({ path, code: "missing_evidence", message: "사실·발언·전망 문구에 실제 근거를 연결해 주세요." });
      const linked = ref.factIds.map(id => facts.get(id)).filter(fact => !!fact);
      const linkedResources = ref.resourceIds.map(id => resources.get(id)).filter(resource => !!resource);
      const factualTypes = ["reported_event", "research_finding", "attributed_statement", "forecast"];
      if (page.id === "news_summary" && /^pages\.news_summary\.fields\.facts(?:\.[0-2])?$/.test(path)) {
        const changedForecast = linked.some(fact => fact.claimType === "forecast") && ref.claimType !== "forecast";
        const changedStatement = !linked.some(fact => fact.claimType === "forecast") && linked.some(fact => fact.claimType === "attributed_statement") && ref.claimType !== "attributed_statement";
        if (!factualTypes.includes(ref.claimType) || linked.some(fact => !factualTypes.includes(fact.claimType)) || changedForecast || changedStatement) flags.push({ path, code: "summary_claim_type", message: "뉴스 요약은 근거의 사실·발언·전망 유형을 유지해야 합니다. 질문·해석·가정으로 바꿔 근거 확인을 생략할 수 없습니다." });
      }
      if (page.id === "concept" && page.fields.mode === "scientific_explanation" && path === "pages.concept.fields.acceptedDefinition") {
        const allowedFact = (fact: typeof linked[number]) => ["reported_event", "research_finding"].includes(fact.claimType) && !["conflicting", "insufficient"].includes(fact.verificationStatus) && fact.sourceScope !== "search_result";
        const allowedResource = (resource: typeof linkedResources[number]) => ["definition", "paper", "online"].includes(resource.kind) && resource.scope !== "search_result";
        if (!["reported_event", "research_finding"].includes(ref.claimType) || !linked.length && !linkedResources.length || linked.some(fact => !allowedFact(fact)) || linkedResources.some(resource => !allowedResource(resource))) flags.push({ path, code: "definition_evidence_type", message: "통용 정의에는 실제 읽은 정의·논문·설명 자료 또는 확인된 사실을 연결해 주세요. 전망·발언·가정이나 방문 안내를 정의의 근거로 쓸 수 없습니다." });
      }
      if (linked.some(fact => fact.claimType === "forecast" || fact.claimType === "attributed_statement") && ["reported_event", "research_finding"].includes(ref.claimType)) flags.push({ path, code: "claim_promotion", message: "발언·전망을 입증된 사건·연구 결과로 바꿀 수 없습니다." });
      const sentence = fieldText(copy, page.id, ref.fieldPath), pageText = JSON.stringify(page.fields);
      if (ref.claimType === "forecast" && (!/(전망|예측|예상|가능성|내다보|수 있)/.test(sentence) || !linked.some(fact => namedIn(pageText, fact.speaker)))) flags.push({ path, code: "forecast_attribution", message: "미래 전망의 발언자·조건·불확실성을 유지해 주세요." });
      if (ref.claimType === "attributed_statement" && !linked.some(fact => namedIn(pageText, fact.speaker))) flags.push({ path, code: "statement_attribution", message: "확인된 발언자의 이름을 같은 카드에 남겨 주세요." });
      const numericConditions = linked.flatMap(fact => [...fact.conditions, fact.timeScope ?? ""]).flatMap(numericTokens), pageNumbers = new Set(numericTokens(pageText));
      if (["reported_event", "research_finding", "attributed_statement", "forecast"].includes(ref.claimType) && numericConditions.some(value => !pageNumbers.has(value))) flags.push({ path, code: "numeric_condition_lost", message: "근거의 시점·인원·평가 범위 같은 수치 조건을 같은 카드에 유지해 주세요." });
    }
    if (page.id === "news_summary") page.fields.facts.forEach((_fact, index) => {
      if (!page.claimRefs.some(ref => ["fields.facts", `fields.facts.${index}`, `pages.news_summary.fields.facts.${index}`].includes(ref.fieldPath) && (ref.factIds.length || ref.resourceIds.length))) flags.push({ path: `pages.news_summary.fields.facts.${index}`, code: "missing_fact_binding", message: "뉴스 요약의 각 사실에 근거를 연결해 주세요." });
    });
    if (page.id === "concept" && page.fields.mode === "scientific_explanation" && !page.claimRefs.some(ref => ["fields.acceptedDefinition", "pages.concept.fields.acceptedDefinition"].includes(ref.fieldPath) && (ref.factIds.length || ref.resourceIds.length))) flags.push({ path: "pages.concept.fields.acceptedDefinition", code: "definition_needs_source", message: "과학적 통용 정의의 실제 근거가 필요합니다." });
    if (page.id === "activity") {
      for (const [field, activity] of [["homeActivity", page.fields.homeActivity], ["optionalActivity", page.fields.optionalActivity]] as const) {
        if (!activity) continue;
        const resource = activity.resourceId ? resources.get(activity.resourceId) : null;
        if (activity.resourceId && !resource || field === "optionalActivity" && (!resource || !resource.recommendationEligible)) flags.push({ path: `pages.activity.fields.${field}`, code: "invalid_activity_resource", message: "추가 활동에는 실제 확인되고 추천이 허용된 자료를 선택해 주세요." });
        if (resource?.kind === "visit" && bundle.research?.appliedVisitScope === "off") flags.push({ path: `pages.activity.fields.${field}`, code: "visit_disabled", message: "방문 활동이 꺼져 있어 온라인·집 활동만 사용할 수 있습니다." });
      }
    }
  }
  const discussion = copy.pages.find(page => page.id === "discussion");
  if (plan && discussion?.id === "discussion" && discussion.fields.question !== plan.coreQuestion) flags.push({ path: "pages.discussion.fields.question", code: "question_mismatch", message: "확정 편집 기획과 카드의 중심 질문을 일치시켜 주세요." });
  if (plan && parentGuide && parentGuide.coreQuestion !== plan.coreQuestion) flags.push({ path: "parentGuide.coreQuestion", code: "question_mismatch", message: "부모 안내와 확정 중심 질문을 일치시켜 주세요." });
  return flags;
}
