import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../../server/db";
import { contentItems, contentRevisions, sourceDocuments } from "../../shared/schema";
import { familyEvidenceRecords } from "../../shared/familyEvidenceDb";
import { emptyPayload } from "../../shared/payloads";
import { createRevision } from "../../server/content";
import { familyHash } from "../../server/services/familyEvidence";
import { familyDialogueCardFixture, familyDialogueMetadataFixture, scientificFamilyCardFixture } from "./familyDialogueCard";
import { familyEvidenceFixture } from "./familyEvidence";
import { sha256 } from "../../server/services/text";

/** Isolated trusted evidence rows for PostgreSQL integration tests; no network calls. */
export async function createFamilyPgFixture(db: DB, options: { channelId?: number; rendererProvider?: "builtin" | "canva"; sourceOnly?: boolean; scientific?: boolean; numericForecast?: boolean } = {}) {
  const channelId = options.channelId ?? 2, sample = familyEvidenceFixture(1, channelId), url = `https://news.example/fixture/${randomUUID()}`;
  const definition = "평균 속력은 이동한 거리를 걸린 시간으로 나눈 값이다.", forecast = "게이츠는 2030년 평가 대상 12개 전문 업무에서 인공지능이 더 좋은 성과를 낼 것이라고 전망했다.";
  if (options.scientific) sample.snapshot.sources[0].text += `\n${definition}`;
  if (options.numericForecast) sample.snapshot.sources[0].text = sample.snapshot.sources[0].text.replace(sample.analysis.facts[0].evidenceExcerpt, forecast);
  const [doc] = await db.insert(sourceDocuments).values({ normalizedUrl: url, originalUrl: url, kind: "news", title: sample.snapshot.sources[0].title, fetchedText: sample.snapshot.sources[0].text, fetchStatus: "ok" }).returning();
  const [created] = await db.insert(contentItems).values({ channelId, primarySourceId: doc.id, kind: "science_dialogue", title: doc.title, relevance: "relevant" }).returning();
  const bundle = familyEvidenceFixture(created.id, channelId), metadata = familyDialogueMetadataFixture(), copy = options.scientific ? scientificFamilyCardFixture() : familyDialogueCardFixture();
  const sourceId = `source-${doc.id}`, snapshotId = `snapshot-${randomUUID()}`, analysisId = `analysis-${randomUUID()}`, setId = `evidence-${randomUUID()}`;
  bundle.snapshot = { ...bundle.snapshot, id: snapshotId, primarySourceId: sourceId, sources: [{ ...bundle.snapshot.sources[0], id: sourceId, documentId: doc.id, finalUrl: url, requestedUrl: url, text: doc.fetchedText!, contentHash: sha256(doc.fetchedText!) }] };
  bundle.analysis = { ...bundle.analysis, sourceSnapshotId: snapshotId, sourceAnalysisId: analysisId, facts: bundle.analysis.facts.map(fact => ({ ...fact, sourceId })) };
  if (options.scientific) {
    bundle.analysis.facts.push({ id: "F3", statement: definition, claimType: "research_finding", speaker: null, sourceId, sourceScope: "article_body", timeScope: null, conditions: [], evidenceExcerpt: definition, verificationStatus: "article_only" });
    bundle.analysis.articleType = "mixed";
    bundle.analysis.conceptCandidates.push({ concept: "평균 속력", mode: "scientific_explanation", reason: "원문의 통용 정의 구절을 대조하는 격리 테스트" });
    metadata.editorialPlan = { ...metadata.editorialPlan, keyConcept: "평균 속력", conceptMode: "scientific_explanation" };
  }
  if (options.numericForecast) {
    bundle.analysis.facts[0] = { ...bundle.analysis.facts[0], statement: forecast, evidenceExcerpt: forecast, timeScope: "2030년", conditions: ["평가 대상 12개 전문 업무"] };
    if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts[0] = "게이츠는 2030년 평가 대상 12개 전문 업무에서 AI가 앞설 것으로 전망했어요.";
  }
  bundle.evidenceSet = { ...bundle.evidenceSet, evidenceSetId: setId, sourceSnapshotId: snapshotId, sourceAnalysisId: analysisId, sourceIds: [sourceId], facts: bundle.analysis.facts };
  metadata.evidenceBinding = { evidenceSetId: setId, sourceSnapshotId: snapshotId, sourceAnalysisId: analysisId, resourceResearchId: null };
  metadata.dependencies.caption = "current";
  metadata.captionPackage!.sourceCredit = [{ title: doc.title, publisher: "테스트 언론", url }];
  await db.insert(familyEvidenceRecords).values({ id: snapshotId, channelId, contentItemId: created.id, kind: "source_snapshot", fingerprint: familyHash(bundle.snapshot), payload: bundle.snapshot });
  await db.insert(familyEvidenceRecords).values({ id: analysisId, channelId, contentItemId: created.id, kind: "source_analysis", fingerprint: familyHash(bundle.analysis), sourceSnapshotId: snapshotId, payload: bundle.analysis });
  await db.insert(familyEvidenceRecords).values({ id: setId, channelId, contentItemId: created.id, kind: "evidence_set", fingerprint: familyHash(bundle.evidenceSet), sourceSnapshotId: snapshotId, payload: bundle.evidenceSet });
  const payload: Record<string, unknown> = { ...emptyPayload("science_dialogue", created.title), ...(options.sourceOnly ? {} : { cardCopy: copy, ...metadata, rendererProvider: options.rendererProvider ?? "builtin" }) };
  const revision = await createRevision(db, { contentItemId: created.id, author: "operator", payload, note: "격리된 가족 대화 테스트" });
  if (!options.sourceOnly) {
    metadata.captionPackage!.contentRevision = revision.id; payload.captionPackage = metadata.captionPackage;
    await db.update(contentRevisions).set({ payload }).where(eq(contentRevisions.id, revision.id));
  }
  await db.update(contentItems).set({ edited: payload }).where(eq(contentItems.id, created.id));
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, created.id));
  return { item, revision: { ...revision, payload }, metadata, copy, bundle, doc };
}
