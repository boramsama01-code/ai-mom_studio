/**
 * 콘텐츠 유형별 payload 스키마 (LLM 출력 검증 + 운영자 편집 검증 공용)
 */
import { z } from "zod";
import { cardCopySchema } from "./cardCopy";
import { articleAnalysisSchema, aiWorkflowSchema } from "./articleAnalysis";

const nullableStr = z.string().trim().max(2000).nullable();

export const datePointSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  })
  .nullable();

export const scheduleEntrySchema = z.object({
  kind: z.enum(["apply", "event", "reservation", "result", "correction", "other"]),
  label: nullableStr.optional(),
  round: nullableStr.optional(),
  start: datePointSchema.optional(),
  end: datePointSchema.optional(),
  raw: nullableStr.optional(),
});

export const evidenceSchema = z.object({
  field: z.string().max(60),
  source_id: z.number().int(),
  quote: z.string().max(400),
});

export const noticePayloadSchema = z.object({
  aiWorkflow: aiWorkflowSchema.optional(),
  cardCopy: cardCopySchema.optional(),
  relevance: z.enum(["relevant", "irrelevant", "uncertain"]),
  irrelevance_reason: nullableStr.optional(),
  title: nullableStr,
  organization: nullableStr,
  notice_type: z
    .enum(["입학설명회", "모집요강", "원서접수", "추가모집", "정정공고", "결과발표", "캠프모집", "대회접수", "영재교육원모집", "기타"])
    .nullable(),
  category: z.enum(["전국단위 자사고 입시", "영재학교·과학고 입시", "STEM 캠프", "STEM 대회", "영재교육원"]).nullable(),
  school_type: z.enum(["national_autonomous", "gifted", "science_high", "org"]).nullable(),
  academic_year: nullableStr,
  audience: nullableStr,
  eligibility: nullableStr,
  schedules: z.array(scheduleEntrySchema).max(20),
  deadline_type: z.enum(["fixed", "first_come", "tbd", "unknown"]),
  key_details: nullableStr,
  one_line_summary: nullableStr,
  uncertainties: z.array(z.string().max(300)).max(10),
  has_conflict: z.boolean(),
  evidence: z.array(evidenceSchema).max(30),
});
export type NoticePayload = z.infer<typeof noticePayloadSchema>;

export const sourceRefSchema = z.object({ source_id: z.number().int(), note: z.string().max(300).nullable().optional() });

export const sciencePayloadSchema = z.object({
  articleAnalysis: articleAnalysisSchema.optional(),
  aiWorkflow: aiWorkflowSchema.optional(),
  cardCopy: cardCopySchema.optional(),
  topic: z.string().max(200),
  age_band: z.string().max(60),
  key_question: z.string().max(300),
  background: z.array(z.string().max(400)).length(3),
  discussion_questions: z.array(z.string().max(300)).length(3),
  scientific_basis: z.string().max(1500),
  misconceptions: z.array(z.string().max(300)).max(5),
  parent_hints: z.array(z.string().max(300)).max(5),
  safe_activity: nullableStr.optional(),
  sources: z.array(sourceRefSchema).max(10),
  evidence: z.array(evidenceSchema).max(20),
});
export type SciencePayload = z.infer<typeof sciencePayloadSchema>;

export const currentPayloadSchema = z.object({
  articleAnalysis: articleAnalysisSchema.optional(),
  aiWorkflow: aiWorkflowSchema.optional(),
  cardCopy: cardCopySchema.optional(),
  title: z.string().max(200),
  event_at: nullableStr,
  published_at: nullableStr,
  checked_at: nullableStr,
  summary: z.string().max(1200),
  why_it_matters: z.string().max(800),
  verified_facts: z.array(z.string().max(400)).max(8),
  under_verification: z.array(z.string().max(400)).max(6),
  perspectives: z.array(z.object({ stakeholder: z.string().max(80), view: z.string().max(400) })).max(6),
  discussion_questions: z.array(z.string().max(300)).length(3),
  glossary: z.array(z.object({ term: z.string().max(60), meaning: z.string().max(300) })).max(8),
  parent_hints: z.array(z.string().max(300)).max(5),
  sources: z.array(sourceRefSchema).max(10),
  independent_source_count: z.number().int().min(0),
  evidence: z.array(evidenceSchema).max(20),
});
export type CurrentPayload = z.infer<typeof currentPayloadSchema>;

export function payloadSchemaFor(kind: string) {
  if (kind === "science_dialogue") return sciencePayloadSchema;
  if (kind === "current_dialogue") return currentPayloadSchema;
  return noticePayloadSchema;
}

/** 수동 작성용 빈 payload */
export function emptyPayload(kind: string, title = ""): Record<string, unknown> {
  if (kind === "science_dialogue")
    return {
      topic: title, age_band: "중학생", key_question: "", background: ["", "", ""], discussion_questions: ["", "", ""],
      scientific_basis: "", misconceptions: [], parent_hints: [], safe_activity: null, sources: [], evidence: [],
    };
  if (kind === "current_dialogue")
    return {
      title, event_at: null, published_at: null, checked_at: null, summary: "", why_it_matters: "", verified_facts: [],
      under_verification: [], perspectives: [], discussion_questions: ["", "", ""], glossary: [], parent_hints: [], sources: [],
      independent_source_count: 0, evidence: [],
    };
  return {
    relevance: "uncertain", irrelevance_reason: null, title, organization: null, notice_type: null, category: null, school_type: null,
    academic_year: null, audience: null, eligibility: null, schedules: [], deadline_type: "unknown", key_details: null,
    one_line_summary: null, uncertainties: [], has_conflict: false, evidence: [],
  };
}
