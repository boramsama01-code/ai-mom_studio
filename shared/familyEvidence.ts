import { z } from "zod";
import { evidenceBindingSchema, FAMILY_CLAIM_TYPES } from "./familyDialogue";

const id = z.string().min(1).max(160);
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const FAMILY_SOURCE_SCOPES = ["article_body", "primary_body", "abstract", "provided_document", "manual_paste", "web_page", "search_result"] as const;
export const evidenceSourceSchema = z.object({
  id, documentId: z.number().int().positive().nullable(), role: z.enum(["primary_article", "supporting", "provided", "researched"]), scope: z.enum(FAMILY_SOURCE_SCOPES),
  title: text(1000), requestedUrl: text(4000), finalUrl: text(4000), canonicalUrl: text(4000).nullable(), publisher: text(300).nullable(), publishedAt: text(100).nullable(), fetchedAt: z.string().datetime(), text: text(100_000, 0), contentHash: text(160),
}).strict();
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export const sourceSnapshotSchema = z.object({ id, channelId: z.number().int().positive(), itemId: z.number().int().positive(), capturedAt: z.string().datetime(), primarySourceId: id, sources: z.array(evidenceSourceSchema).min(1).max(20), identityStatus: z.enum(["source_record", "manual_paste", "needs_source"]) }).strict();
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export const familyFactSchema = z.object({
  id: z.string().regex(/^F[1-9][0-9]*$/), statement: text(1000), claimType: z.enum(FAMILY_CLAIM_TYPES.filter(value => value !== "question") as ["reported_event", "research_finding", "attributed_statement", "forecast", "editorial_interpretation", "hypothetical"]),
  speaker: text(200).nullable(), sourceId: id, sourceScope: z.enum(FAMILY_SOURCE_SCOPES), timeScope: text(300).nullable(), conditions: z.array(text(400)).max(8), evidenceExcerpt: text(600), verificationStatus: z.enum(["article_only", "primary_checked", "conflicting", "insufficient"]),
}).strict();
export type FamilyFact = z.infer<typeof familyFactSchema>;
export const sourceAnalysisSchema = z.object({
  sourceSnapshotId: id, sourceAnalysisId: id, articleCore: text(600), articleType: z.enum(["research", "report", "interview", "opinion", "forecast", "explanation", "mixed"]), facts: z.array(familyFactSchema).min(1).max(5), essentialConditions: z.array(text(400)).max(12), cannotConclude: z.array(text(400)).max(12), missingInformation: z.array(text(400)).max(12), headlineBodyGap: text(1000).nullable(), conceptCandidates: z.array(z.object({ concept: text(100), mode: z.enum(["value_definition", "scientific_explanation"]), reason: text(400) }).strict()).max(3),
}).strict().refine(value => new Set(value.facts.map(fact => fact.id)).size === value.facts.length, "사실 ID가 중복되었습니다.");
export type SourceAnalysis = z.infer<typeof sourceAnalysisSchema>;
export const verifiedResourceSchema = z.object({
  id: z.string().regex(/^R[1-9][0-9]*$/), sourceId: id, kind: z.enum(["online", "paper", "visit", "definition"]), title: text(1000), publisher: text(300).nullable(), url: text(4000), scope: z.enum(FAMILY_SOURCE_SCOPES), checkedAt: z.string().datetime(),
  evidenceExcerpt: text(1000), connectionReason: text(1000), readingTarget: text(600), action: text(600), priority: z.number().int().min(1).max(10), recommendationEligible: z.boolean(),
  visitRegion: text(200).nullable(), availability: z.object({ startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), detail: text(600), evidenceExcerpt: text(1000) }).strict().nullable(),
}).strict();
export type VerifiedResource = z.infer<typeof verifiedResourceSchema>;
export const resourceResearchSchema = z.object({
  resourceResearchId: id, appliedVisitScope: z.enum(["off", "region", "national"]), homeActivity: z.object({ title: text(100), materials: z.array(text(100)).max(8), steps: z.array(text(400)).min(1).max(5), minutes: z.number().int().min(1).max(30), closingQuestion: text(300) }).strict(),
  verifiedResources: z.array(verifiedResourceSchema).max(6), operatorNotes: z.array(text(1000)).max(30), searchStatus: z.enum(["off", "not_connected", "failed", "no_results", "completed"]),
}).strict();
export type ResourceResearch = z.infer<typeof resourceResearchSchema>;
export const evidenceSetSchema = z.object({ ...evidenceBindingSchema.shape, channelId: z.number().int().positive(), itemId: z.number().int().positive(), createdAt: z.string().datetime(), facts: z.array(familyFactSchema).max(12), resources: z.array(verifiedResourceSchema).max(6), sourceIds: z.array(id).min(1).max(30) }).strict();
export type EvidenceSet = z.infer<typeof evidenceSetSchema>;
export type FamilyEvidenceBundle = { snapshot: SourceSnapshot; analysis: SourceAnalysis; research: ResourceResearch | null; evidenceSet: EvidenceSet; researchedSources: EvidenceSource[] };
/** Read-only inspection DTO. Article bodies stay in the owned immutable records. */
export type FamilyEvidenceView = {
  evidenceSetId: string;
  facts: FamilyFact[];
  resources: VerifiedResource[];
  sources: Array<{ id: string; title: string; url: string | null; scope: EvidenceSource["scope"]; fetchedAt: string }>;
};
