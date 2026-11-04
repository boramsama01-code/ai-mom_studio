/**
 * 카드 템플릿 — 선택한 레이아웃 5종 × 컬러 6가지 + 내가 올린 배경
 * 이전 키는 기존 작업을 다시 출력할 수 있도록 유지한다.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { DB } from "../db";
import { cardTemplates, type Channel } from "../../shared/schema";
import { BUILTIN_LAYOUTS, renderCardJpeg, type CardLayout, type CardStyle } from "./card";
import { buildCardModel } from "./cardModel";
import { cardDesignOptions, cardDesign } from "../../shared/cardDesigns";
import { renderCollectionPreview } from "./cardDesignSamples";
import { readingProfileForTemplateKey } from "../../shared/readingCardProfiles";

export class TemplateNotFound extends Error {}

export async function resolveStyle(db: DB, key: string, channelId: number): Promise<CardStyle> {
  // Reading profiles render from their versioned 8-page contract. Their keys
  // are valid for saved V2 copies without pretending to be Canva registrations.
  if (readingProfileForTemplateKey(key)) return { layout: "minimal" };
  if (key.startsWith("set:")) {
    const id = key.slice(4);
    if (!cardDesign(id)) throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
    return { layout: "minimal", collection: id };
  }
  if (key.startsWith("builtin:")) {
    const layout = key.slice(8) as CardLayout;
    if (!BUILTIN_LAYOUTS.some((b) => b.key === layout)) throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
    return { layout };
  }
  if (key.startsWith("custom:")) {
    const id = Number(key.slice(7));
    const [t] = await db
      .select()
      .from(cardTemplates)
      .where(and(eq(cardTemplates.id, id), isNull(cardTemplates.deletedAt), or(isNull(cardTemplates.channelId), eq(cardTemplates.channelId, channelId))));
    if (!t) throw new TemplateNotFound("템플릿을 찾을 수 없습니다(삭제되었거나 다른 채널 전용).");
    return { layout: (t.layout as CardLayout) === "header" ? "classic" : (t.layout as CardLayout), tone: t.textTone as "dark" | "light", overlay: t.overlay, background: t.background };
  }
  throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
}

export async function listTemplates(db: DB, channelId: number) {
  const customs = await db
    .select({ id: cardTemplates.id, name: cardTemplates.name, layout: cardTemplates.layout, textTone: cardTemplates.textTone, overlay: cardTemplates.overlay, channelId: cardTemplates.channelId, createdAt: cardTemplates.createdAt })
    .from(cardTemplates)
    .where(and(isNull(cardTemplates.deletedAt), or(isNull(cardTemplates.channelId), eq(cardTemplates.channelId, channelId))));
  return [
    ...cardDesignOptions(),
    ...customs.map((c) => ({ key: `custom:${c.id}`, name: c.name, description: `내 배경 · ${c.textTone === "light" ? "밝은 글자" : "어두운 글자"}${c.overlay ? ` · 막 ${c.overlay}%` : ""}`, kind: "custom" as const, id: c.id, layout: c.layout, textTone: c.textTone, overlay: c.overlay, allChannels: c.channelId === null })),
  ];
}

const SAMPLE: Record<string, Record<string, unknown>> = {
  notice: {
    title: "OO과학고 2027학년도 신입생 입학설명회",
    category: "영재학교·과학고 입시",
    audience: "중학교 3학년 학생과 학부모",
    schedules: [
      { kind: "event", label: "입학설명회", start: { date: "2026-10-10", time: "14:00" } },
      { kind: "apply", label: "원서접수", start: { date: "2026-10-20" }, end: { date: "2026-10-24" } },
    ],
    one_line_summary: "설명회는 사전 예약제이며 원서는 10월 20일부터 받습니다.",
  },
  science_dialogue: {
    key_question: "도시의 나무는 어디에 먼저 심어야 할까?",
    background: ["나무 그늘은 한여름 땅의 온도를 낮춥니다.", "도시에는 유난히 뜨거운 곳이 있습니다.", "나무마다 필요한 공간이 다릅니다."],
    discussion_questions: ["우리 동네에서 가장 더운 곳은 어디일까?"],
  },
  current_dialogue: {
    title: "학교의 스마트폰 사용 규칙, 어떻게 정할까?",
    summary: "여러 학교가 수업 중 스마트폰 사용 규칙을 새로 정하고 있습니다. 규칙을 정하는 방식과 이유가 학교마다 다릅니다.",
    discussion_questions: ["규칙을 정할 때 누구의 의견을 들어야 할까?"],
  },
};

/** 미리보기(예시 문구) — 메모리 캐시 */
const cache = new Map<string, Buffer>();
export async function renderPreview(db: DB, key: string, channel: Channel, page = 0): Promise<Buffer> {
  const ck = `${key}|${page}|${channel.id}|${channel.accentColor}|${channel.name}|${channel.contentType}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const style = await resolveStyle(db, key, channel.id);
  if (style.collection) {
    const jpeg = await renderCollectionPreview(style.collection, page, channel.name, channel.slug);
    if (cache.size >= 120) cache.clear();
    cache.set(ck, jpeg);
    return jpeg;
  }
  const model = buildCardModel({ kind: channel.contentType, payload: SAMPLE[channel.contentType] ?? SAMPLE.notice, channelName: channel.name, channelSlug: channel.slug, accent: channel.accentColor, sourceOrg: "예시 기관", checkedDate: "2026-09-29" });
  const { jpeg } = await renderCardJpeg(model, style);
  if (cache.size > 60) cache.clear();
  cache.set(ck, jpeg);
  return jpeg;
}

export function clearPreviewCache() {
  cache.clear();
}

