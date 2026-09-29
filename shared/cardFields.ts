/**
 * 카드에 들어갈 글자를 "필드"로 정리 — Canva 자동 채우기·대량 제작 CSV·망고보드 복사에 공통 사용
 * 키(key)는 Canva 데이터 필드 이름으로 그대로 쓰도록 영문 소문자로 고정한다.
 */
import { formatScheduleLines } from "./format";

export type CardField = { key: string; label: string; value: string };

type Any = Record<string, any>;

export const CARD_FIELD_KEYS: Record<string, Array<{ key: string; label: string }>> = {
  notice: [
    { key: "title", label: "제목" },
    { key: "category", label: "분류" },
    { key: "audience", label: "대상" },
    { key: "schedule", label: "일정" },
    { key: "summary", label: "핵심 한 줄" },
    { key: "details", label: "주요 내용" },
    { key: "source", label: "출처" },
    { key: "checked", label: "확인일" },
    { key: "channel", label: "채널" },
  ],
  science_dialogue: [
    { key: "title", label: "핵심 질문" },
    { key: "topic", label: "주제" },
    { key: "background", label: "배경" },
    { key: "q1", label: "질문 1" },
    { key: "q2", label: "질문 2" },
    { key: "q3", label: "질문 3" },
    { key: "tip", label: "부모 진행 팁" },
    { key: "source", label: "출처" },
    { key: "checked", label: "확인일" },
    { key: "channel", label: "채널" },
  ],
  current_dialogue: [
    { key: "title", label: "제목" },
    { key: "summary", label: "무슨 일이 있었나" },
    { key: "why", label: "왜 중요할까" },
    { key: "q1", label: "질문 1" },
    { key: "q2", label: "질문 2" },
    { key: "q3", label: "질문 3" },
    { key: "tip", label: "부모 진행 팁" },
    { key: "source", label: "출처" },
    { key: "checked", label: "확인일" },
    { key: "channel", label: "채널" },
  ],
};

export function cardFields(kind: string, p: Any, ctx: { sourceOrg: string | null; checkedDate: string; channelName: string }): CardField[] {
  const qs = (p.discussion_questions ?? []) as string[];
  const values: Record<string, string> = {
    source: ctx.sourceOrg ?? "",
    checked: ctx.checkedDate,
    channel: ctx.channelName,
    tip: (p.parent_hints ?? [])[0] ?? "",
    q1: qs[0] ?? "",
    q2: qs[1] ?? "",
    q3: qs[2] ?? "",
  };
  if (kind === "science_dialogue") {
    Object.assign(values, { title: p.key_question ?? "", topic: p.topic ?? "", background: (p.background ?? []).filter(Boolean).join(" ") });
  } else if (kind === "current_dialogue") {
    Object.assign(values, { title: p.title ?? "", summary: p.summary ?? "", why: p.why_it_matters ?? "" });
  } else {
    Object.assign(values, {
      title: p.title ?? "",
      category: p.category ?? "",
      audience: [p.audience, p.eligibility].filter(Boolean).join(" · "),
      schedule: formatScheduleLines(p.schedules ?? []).join("\n"),
      summary: p.one_line_summary ?? "",
      details: p.key_details ?? "",
    });
  }
  return (CARD_FIELD_KEYS[kind] ?? CARD_FIELD_KEYS.notice).map((f) => ({ ...f, value: String(values[f.key] ?? "") }));
}

/** CSV 한 칸 이스케이프(쉼표·따옴표·줄바꿈) */
export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
