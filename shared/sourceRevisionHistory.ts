/** Minimal API shapes used by the source editor's history; payloads are immutable. */
export type SourceRevisionSummary = {
  id: number;
  revisionNo: number;
  author: string;
  createdAt: string | Date;
  note?: string;
  model?: string | null;
};
export type SourceRevisionCurrent = { id: number; revisionNo: number; payload: Record<string, unknown> };
export type SourceRevisionSnapshot = SourceRevisionSummary & SourceRevisionCurrent & { contentItemId: number };
export type SourceRevisionRestoreResponse = {
  item: { id: number; channelId: number; version: number; currentRevisionId: number | null };
  revision: SourceRevisionSnapshot;
  restoredFrom: { id: number; revisionNo: number };
  previousRevisionId: number | null;
};

const LABELS: Record<string, string> = {
  title: "제목", topic: "주제", key_question: "핵심 질문", age_band: "대상 연령", organization: "기관",
  relevance: "관련성", irrelevance_reason: "관련 없음의 이유", audience: "대상", eligibility: "지원 자격",
  notice_type: "공고 유형", category: "카테고리", school_type: "학교 유형", academic_year: "모집 학년도",
  schedules: "일정", deadline_type: "마감 방식", key_details: "주요 내용", one_line_summary: "한 줄 요약",
  uncertainties: "확인할 점", has_conflict: "자료 간 충돌", background: "배경", scientific_basis: "과학 근거",
  discussion_questions: "대화 질문", misconceptions: "오해하기 쉬운 점", parent_hints: "부모 진행 힌트", safe_activity: "안전 관찰 활동",
  event_at: "사건 시점", published_at: "기사 게시 시점", checked_at: "정보 확인 시점", summary: "요약", why_it_matters: "중요한 이유",
  verified_facts: "확인된 사실", under_verification: "확인 중인 내용", perspectives: "관점", glossary: "용어 설명",
  sources: "참조 자료", independent_source_count: "독립 출처 수", evidence: "근거 구절",
  source_id: "자료 번호", note: "메모", field: "근거 항목", quote: "인용 구절", stakeholder: "이해관계자", view: "견해", term: "용어", meaning: "뜻",
  kind: "종류", label: "이름", round: "회차", start: "시작", end: "종료", date: "날짜", time: "시각", raw: "원문 표현",
};
const VALUES: Record<string, string> = {
  relevant: "관련 있음", irrelevant: "관련 없음", uncertain: "판단 필요", fixed: "기간 마감", first_come: "선착순", tbd: "추후 공지", unknown: "확인 필요",
  national_autonomous: "전국단위 자사고", gifted: "영재학교", science_high: "과학고", org: "기관·대학",
  apply: "접수", event: "행사·설명회", reservation: "행사 예약", result: "결과 발표", correction: "정정 안내", other: "기타",
};
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])])) : value ?? null;
}
export function sourceRevisionValue(value: unknown, key?: string): string {
  if (value === undefined || value === null || value === "") return "(비어 있음)";
  if (typeof value === "string") return ["relevance", "deadline_type", "school_type", "kind"].includes(key ?? "") ? VALUES[value] ?? value : value;
  if (typeof value === "boolean") return key === "has_conflict" ? value ? "충돌 있음" : "충돌 없음" : value ? "예" : "아니요";
  if (Array.isArray(value)) return value.length ? value.map((entry, index) => `${index + 1}. ${sourceRevisionValue(entry)}`).join("\n") : "(목록 없음)";
  const object = record(value);
  if (object) return Object.entries(object).map(([field, entry]) => `${LABELS[field] ?? field}: ${sourceRevisionValue(entry, field)}`).join("\n") || "(비어 있음)";
  return String(value);
}

export type SourceRevisionDifference = { key: string; label: string; section: "source" | "copy"; current: string; selected: string; changed: boolean };
/** Compare actual editorial text, including missing/deleted cards; ignore object key order. */
export function compareSourceRevisions(current: Record<string, unknown> | null, selected: Record<string, unknown>): SourceRevisionDifference[] {
  const latest = current ?? {}, fields: SourceRevisionDifference[] = [];
  const append = (key: string, label: string, section: SourceRevisionDifference["section"], currentValue: unknown, selectedValue: unknown, valueKey?: string) => {
    fields.push({ key, label, section, current: sourceRevisionValue(currentValue, valueKey), selected: sourceRevisionValue(selectedValue, valueKey), changed: JSON.stringify(canonical(currentValue)) !== JSON.stringify(canonical(selectedValue)) });
  };
  for (const key of [...new Set([...Object.keys(latest), ...Object.keys(selected)])]) {
    if (key === "cardCopy") continue;
    append(key, LABELS[key] ?? key, "source", latest[key], selected[key], key);
  }
  const a = record(latest.cardCopy), b = record(selected.cardCopy);
  if (a || b) {
    append("cardCopy.templateKey", "카드 디자인", "copy", a?.templateKey, b?.templateKey);
    const ac = record(a?.cover), bc = record(b?.cover);
    append("cardCopy.cover.title", "표지 제목", "copy", ac?.title, bc?.title);
    append("cardCopy.cover.subtitle", "표지 부제", "copy", ac?.subtitle, bc?.subtitle);
    const ap = Array.isArray(a?.pages) ? a.pages : [], bp = Array.isArray(b?.pages) ? b.pages : [];
    for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
      const left = record(ap[index]), right = record(bp[index]);
      for (const [key, label] of [["title", "제목"], ["subtitle", "소제목"], ["body", "본문"]])
        append(`cardCopy.pages.${index}.${key}`, `본문 카드 ${index + 1} · ${label}`, "copy", left?.[key], right?.[key]);
    }
  }
  return fields;
}
