import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../../server/db";
import { contentItems, contentRevisions, sourceDocuments } from "../../shared/schema";
import { familyEvidenceRecords } from "../../shared/familyEvidenceDb";
import { emptyPayload } from "../../shared/payloads";
import { createRevision } from "../../server/content";
import { familyHash } from "../../server/services/familyEvidence";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./familyDialogueCard";
import { familyEvidenceFixture } from "./familyEvidence";

/** Isolated trusted evidence rows for PostgreSQL integration tests; no network calls. */
export async function createFamilyPgFixture(db: DB, options: { channelId?: number; rendererProvider?: "builtin" | "canva"; sourceOnly?: boolean } = {}) {
  const channelId = options.channelId ?? 2, sample = familyEvidenceFixture(1, channelId), url = `https://news.example/fixture/${randomUUID()}`;
  const [doc] = await db.insert(sourceDocuments).values({ normalizedUrl: url, originalUrl: url, kind: "news", title: sample.snapshot.sources[0].title, fetchedText: sample.snapshot.sources[0].text, fetchStatus: "ok" }).returning();
  const [created] = await db.insert(contentItems).values({ channelId, primarySourceId: doc.id, kind: "science_dialogue", title: doc.title, relevance: "relevant" }).returning();
  const bundle = familyEvidenceFixture(created.id, channelId), metadata = familyDialogueMetadataFixture(), copy = familyDialogueCardFixture();
  const sourceId = `source-${doc.id}`, snapshotId = `snapshot-${randomUUID()}`, analysisId = `analysis-${randomUUID()}`, setId = `evidence-${randomUUID()}`;
  bundle.snapshot = { ...bundle.snapshot, id: snapshotId, primarySourceId: sourceId, sources: [{ ...bundle.snapshot.sources[0], id: sourceId, documentId: doc.id, finalUrl: url, requestedUrl: url }] };
  bundle.analysis = { ...bundle.analysis, sourceSnapshotId: snapshotId, sourceAnalysisId: analysisId, facts: bundle.analysis.facts.map(fact => ({ ...fact, sourceId })) };
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
