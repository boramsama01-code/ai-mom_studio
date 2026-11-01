/**
 * 콘텐츠 payload → 카드 모델 / 캡션
 */
import { cardBrandName } from "../../shared/branding";
import type { CardModel } from "./card";
import { formatScheduleLines } from "../../shared/format";

type Any = Record<string, any>;

export function buildCardModel(args: {
  kind: string;
  payload: Any;
  channelName: string;
  accent: string;
  sourceOrg: string | null;
  checkedDate: string; // YYYY-MM-DD (KST)
}): CardModel {
  const { kind, payload: p } = args;
  const brandLine = cardBrandName(args.channelName);
  const footer = `출처: ${args.sourceOrg || "원문 확인 필요"} · 확인 ${args.checkedDate} · 자세한 내용은 캡션 참고`;
  if (kind === "science_dialogue") {
    return {
      accent: args.accent,
      brandLine,
      badge: "오늘의 과학 질문",
      title: String(p.key_question || p.topic || ""),
      blocks: [
        { field: "background", label: "알아두면 좋은 배경", text: (p.background || []).filter(Boolean).join(" "), maxLines: 6 },
        { field: "discussion_questions", label: "함께 생각해 볼 질문", text: p.discussion_questions?.[0] ?? "", maxLines: 3, emphasis: true },
      ],
      footer,
    };
  }
  if (kind === "current_dialogue") {
    return {
      accent: args.accent,
      brandLine,
      badge: "오늘의 시사 대화",
      title: String(p.title || ""),
      blocks: [
        { field: "summary", label: "무슨 일이 있었나", text: String(p.summary || ""), maxLines: 5 },
        { field: "discussion_questions", label: "함께 생각해 볼 질문", text: p.discussion_questions?.[0] ?? "", maxLines: 3, emphasis: true },
      ],
      footer,
    };
  }
  const scheduleText = formatScheduleLines(p.schedules || []).slice(0, 4).join("\n");
  return {
    accent: args.accent,
    brandLine,
    badge: p.category || "공고",
    title: String(p.title || ""),
    blocks: [
      { field: "audience", label: "대상", text: [p.audience, p.eligibility].filter(Boolean).join(" · "), maxLines: 2 },
      { field: "schedules", label: "일정", text: scheduleText || "일정은 원문에서 확인하세요", maxLines: 4, emphasis: true },
      { field: "one_line_summary", label: "핵심", text: String(p.one_line_summary || p.key_details || ""), maxLines: 4 },
    ],
    footer,
  };
}

/** 기본 캡션 초안(운영자가 목적지별로 편집) */
export function buildCaptions(args: { kind: string; payload: Any; sourceUrl: string | null; sourceOrg: string | null }): {
  instagram: string;
  telegram: string;
} {
  const p = args.payload;
  let body: string;
  if (args.kind === "science_dialogue") {
    body = [
      `오늘의 과학 질문: ${p.key_question}`,
      "",
      ...(p.background || []),
      "",
      "함께 이야기해 볼 질문",
      ...(p.discussion_questions || []).map((q: string, i: number) => `${i + 1}. ${q}`),
      p.parent_hints?.length ? `\n부모님 진행 팁: ${p.parent_hints[0]}` : "",
    ].join("\n");
  } else if (args.kind === "current_dialogue") {
    body = [
      p.title,
      "",
      p.summary,
      "",
      `왜 중요할까: ${p.why_it_matters}`,
      "",
      "함께 이야기해 볼 질문",
      ...(p.discussion_questions || []).map((q: string, i: number) => `${i + 1}. ${q}`),
    ].join("\n");
  } else {
    body = [
      p.title,
      "",
      p.audience ? `대상: ${p.audience}` : "",
      ...formatScheduleLines(p.schedules || []).map((l) => `• ${l}`),
      p.key_details ? `\n${p.key_details}` : "",
      "",
      "정확한 일정과 자격은 반드시 공식 공고에서 확인하세요.",
    ].join("\n");
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  const src = args.sourceOrg ? `출처: ${args.sourceOrg}` : "";
  return {
    // 인스타그램 캡션의 URL은 클릭 링크가 아니므로 출처 기관명만 표기
    instagram: [body, "", src].join("\n").trim(),
    telegram: [body, "", src, args.sourceUrl ? `원문: ${args.sourceUrl}` : ""].join("\n").trim(),
  };
}

export const CAPTION_LIMITS = { instagram: 2200, telegramPhotoCaption: 1024, instagramHashtags: 30 };

export function validateCaptions(c: { instagram: string; telegram: string }): string[] {
  const errs: string[] = [];
  if ([...c.instagram].length > CAPTION_LIMITS.instagram) errs.push(`인스타그램 캡션이 ${CAPTION_LIMITS.instagram}자를 넘습니다.`);
  if ((c.instagram.match(/#[^\s#]+/g) || []).length > CAPTION_LIMITS.instagramHashtags) errs.push("해시태그는 30개 이하여야 합니다.");
  if ([...c.telegram].length > CAPTION_LIMITS.telegramPhotoCaption) errs.push(`텔레그램 사진 캡션이 ${CAPTION_LIMITS.telegramPhotoCaption}자를 넘습니다.`);
  if (!c.instagram.trim() && !c.telegram.trim()) errs.push("캡션이 비어 있습니다.");
  return errs;
}


