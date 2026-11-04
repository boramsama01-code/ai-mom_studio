import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./familyDialogueCard";
import type { FamilyEvidenceBundle, SourceAnalysis, SourceSnapshot } from "../../shared/familyEvidence";

export function familyEvidenceFixture(itemId = 1, channelId = 2): FamilyEvidenceBundle {
  const metadata = familyDialogueMetadataFixture(), now = "2026-11-04T00:00:00.000Z";
  const body = "게이츠는 인공지능이 전문 업무에서 더 좋은 성과를 낼 것이라고 전망했다. 게이츠는 인터뷰에서 인공지능의 미래를 이야기했다. 이 기사는 인물의 전망을 소개한 것으로, 모든 지능에서 인공지능이 더 우월함을 검증한 연구 결과는 아니다. 성과를 비교하려면 업무와 조건을 따로 살펴보아야 한다.";
  const snapshot: SourceSnapshot = { id: metadata.evidenceBinding.sourceSnapshotId, itemId, channelId, capturedAt: now, primarySourceId: "source-1", identityStatus: "source_record", sources: [{ id: "source-1", documentId: 1, role: "primary_article", scope: "article_body", title: "게이츠의 인공지능 전망 인터뷰", requestedUrl: "https://news.example/interview", finalUrl: "https://news.example/interview", canonicalUrl: null, publisher: "테스트 언론", publishedAt: "2026-11-01", fetchedAt: now, text: body, contentHash: "fixture-body-hash" }] };
  const analysis: SourceAnalysis = { sourceSnapshotId: snapshot.id, sourceAnalysisId: metadata.evidenceBinding.sourceAnalysisId, articleCore: "게이츠가 인터뷰에서 전한 전문 업무와 AI의 미래 전망", articleType: "forecast", facts: [
    { id: "F1", statement: "게이츠는 AI가 전문 업무에서 더 좋은 성과를 낼 것으로 전망했다.", claimType: "forecast", speaker: "빌 게이츠", sourceId: "source-1", sourceScope: "article_body", timeScope: "미래 전망", conditions: ["전문 업무의 성과"], evidenceExcerpt: "게이츠는 인공지능이 전문 업무에서 더 좋은 성과를 낼 것이라고 전망했다.", verificationStatus: "article_only" },
    { id: "F2", statement: "게이츠는 인터뷰에서 AI의 미래를 말했다.", claimType: "attributed_statement", speaker: "빌 게이츠", sourceId: "source-1", sourceScope: "article_body", timeScope: null, conditions: [], evidenceExcerpt: "게이츠는 인터뷰에서 인공지능의 미래를 이야기했다.", verificationStatus: "article_only" },
  ], essentialConditions: ["인물의 전망이며 검증된 우월성의 연구 결과가 아니다."], cannotConclude: ["모든 지능이 AI보다 낮다는 결론"], missingInformation: [], headlineBodyGap: null, conceptCandidates: [{ concept: "똑똑함", mode: "value_definition", reason: "평가 기준을 비교할 수 있는 말" }] };
  return { snapshot, analysis, research: null, researchedSources: [], evidenceSet: { ...metadata.evidenceBinding, itemId, channelId, createdAt: now, facts: analysis.facts, resources: [], sourceIds: ["source-1"] } };
}
export function familyAiDraftFixture() {
  const metadata = familyDialogueMetadataFixture(), copy = familyDialogueCardFixture();
  const summary = copy.pages[1];
  if (summary.id === "news_summary") summary.fields.facts = ["게이츠는 AI의 전문 업무 우위를 전망했어요.", "게이츠는 인터뷰에서 미래를 이야기했어요."];
  return { editorialPlan: metadata.editorialPlan, cardCopy: copy, parentGuide: metadata.parentGuide!, coverTitleCandidates: ["AI가 더 잘하면, 더 똑똑할까?"] };
}
