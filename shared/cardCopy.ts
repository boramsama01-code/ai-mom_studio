import { z } from "zod";
import { cardDesign } from "./cardDesigns";
import { discussionCardCopyInstruction, NEWS_EDITORIAL_AI_LIMITS, NEWS_EDITORIAL_BODY_LIMITS, NEWS_EDITORIAL_ROLES } from "./newsEditorial";
import { newsEditorialResourceSchema } from "./newsEditorialResource";
export { discussionCardCopyInstruction, NEWS_EDITORIAL_AI_LIMITS, NEWS_EDITORIAL_LABELS, NEWS_EDITORIAL_ROLES } from "./newsEditorial";
export type { NewsEditorialRole } from "./newsEditorial";

/** Editorial copy is separate from the source facts and destination captions. */
export const CARD_COPY_BODY_RECOMMENDED = 140;
const codepoints = (value: string) => [...value].length;
const copyText = (max: number, required = false) => z.string()
  .refine(value => !required || value.trim().length > 0, "문구를 입력해 주세요.")
  .refine(value => codepoints(value) <= max, `${max}자 이내로 입력해 주세요.`);

export const CARD_COPY_MANUAL_LIMITS = { coverTitle: 200, title: 120, subtitle: 120, body: 1000 } as const;
export const CARD_COPY_AI_LIMITS = { coverTitle: 80, title: 60, subtitle: 60, body: CARD_COPY_BODY_RECOMMENDED } as const;
const templateKeySchema = z.string().min(1).max(80);
const pageIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "카드 ID 형식이 올바르지 않습니다.");
export const cardPageBackgroundSchema = z.object({
  assetId: z.number().int().positive(),
  // Image visibility only. The renderer independently protects text contrast.
  opacity: z.number().min(0).max(100).optional(),
}).strict();
export type CardPageBackground = z.infer<typeof cardPageBackgroundSchema>;
const manualColumnSchema = z.object({ title: copyText(120, true), body: copyText(1000, true) });
export type CardCopyColumn = z.infer<typeof manualColumnSchema>;
export type CardCopyResource = z.infer<typeof newsEditorialResourceSchema>;
const editorialPageFields = {
  role: z.enum(NEWS_EDITORIAL_ROLES).optional(),
  columns: z.array(manualColumnSchema).length(2).optional(),
  sourceIds: z.array(z.number().int().positive()).max(12).optional(),
  background: cardPageBackgroundSchema.optional(),
  resource: newsEditorialResourceSchema.optional(),
};
const copyShape = (limits: typeof CARD_COPY_MANUAL_LIMITS | typeof CARD_COPY_AI_LIMITS) => ({
  version: z.literal(1),
  templateKey: templateKeySchema,
  cover: z.object({ title: copyText(limits.coverTitle, true), subtitle: copyText(limits.subtitle) }),
  pages: z.array(z.object({ id: pageIdSchema, title: copyText(limits.title, true), subtitle: copyText(limits.subtitle), body: copyText(limits.body, true) })).min(1).max(9),
});
const uniquePages = (copy: { pages: Array<{ id: string }> }) => new Set(copy.pages.map(page => page.id)).size === copy.pages.length;

/** The wider manual bounds preserve existing full articles; layout reports overflow without cutting text. */
export const cardCopySchema = z.object(copyShape(CARD_COPY_MANUAL_LIMITS))
  .extend({
    storyFormat: z.literal("discussion8").optional(),
    cover: copyShape(CARD_COPY_MANUAL_LIMITS).cover.extend({ background: cardPageBackgroundSchema.optional() }),
    pages: z.array(copyShape(CARD_COPY_MANUAL_LIMITS).pages.element.extend(editorialPageFields)).min(1).max(9),
  })
  .refine(uniquePages, { message: "카드 ID가 중복되었습니다.", path: ["pages"] })
  .superRefine((copy, ctx) => {
    if (copy.storyFormat !== "discussion8") {
      if (copy.cover.background) ctx.addIssue({ code: "custom", path: ["cover", "background"], message: "페이지별 배경은 8장 대화형 카드로 전환한 뒤 선택해 주세요." });
      copy.pages.forEach((page, index) => {
        if (page.role || page.columns) ctx.addIssue({ code: "custom", path: ["pages", index], message: "역할과 두 칸 구성은 8장 대화형 카드에서 사용하세요." });
        if (page.background) ctx.addIssue({ code: "custom", path: ["pages", index, "background"], message: "페이지별 배경은 8장 대화형 카드로 전환한 뒤 선택해 주세요." });
        if (page.resource) ctx.addIssue({ code: "custom", path: ["pages", index, "resource"], message: "활동 참고자료는 8장 대화형 카드에서 사용하세요." });
      });
      return;
    }
    if (copy.pages.length !== 7) ctx.addIssue({ code: "custom", path: ["pages"], message: "8장 대화형 카드는 표지와 본문·닫는 표지 7장으로 구성됩니다." });
    copy.pages.forEach((page, index) => {
      if (page.id !== `body-${index + 1}` || page.role !== NEWS_EDITORIAL_ROLES[index]) ctx.addIssue({ code: "custom", path: ["pages", index, "role"], message: "뉴스 요약부터 닫는 표지까지 순서를 유지해 주세요." });
      if (page.role === "perspectives" && !page.columns) ctx.addIssue({ code: "custom", path: ["pages", index, "columns"], message: "두 가지 시선의 문구를 각각 입력해 주세요." });
      if (page.columns && page.role !== "perspectives" && page.role !== "concept") ctx.addIssue({ code: "custom", path: ["pages", index, "columns"], message: "두 칸 문구는 시선 비교와 개념 정의에서 사용하세요." });
      if (page.resource && page.role !== "activity") ctx.addIssue({ code: "custom", path: ["pages", index, "resource"], message: "추가 참고자료는 활동 카드에서 사용하세요." });
    });
  });
export type CardCopy = z.infer<typeof cardCopySchema>;
export const aiCardCopySchema = z.object({ ...copyShape(CARD_COPY_AI_LIMITS), pages: copyShape(CARD_COPY_AI_LIMITS).pages.length(4) })
  .refine(copy => copy.pages.every((page, index) => page.id === `body-${index + 1}`), { message: "본문 카드 ID는 body-1부터 body-4까지 순서대로 작성해야 합니다.", path: ["pages"] });

/** Separate schema prevents a model from selecting another item's image or silently adding a ninth page. */
export const aiDiscussionCardCopySchema = z.object({
  version: z.literal(1), storyFormat: z.literal("discussion8"), templateKey: templateKeySchema,
  cover: z.object({ title: copyText(NEWS_EDITORIAL_AI_LIMITS.coverTitle, true), subtitle: copyText(NEWS_EDITORIAL_AI_LIMITS.subtitle) }).strict(),
  pages: z.array(z.object({
    id: pageIdSchema, role: z.enum(NEWS_EDITORIAL_ROLES),
    title: copyText(NEWS_EDITORIAL_AI_LIMITS.title, true), subtitle: copyText(NEWS_EDITORIAL_AI_LIMITS.subtitle), body: copyText(NEWS_EDITORIAL_AI_LIMITS.body, true),
    columns: z.array(z.object({ title: copyText(NEWS_EDITORIAL_AI_LIMITS.columnTitle, true), body: copyText(NEWS_EDITORIAL_AI_LIMITS.columnBody, true) }).strict()).length(2).optional(),
    sourceIds: z.array(z.number().int().positive()).max(12).optional(),
    resourceSourceId: z.number().int().positive().optional(),
  }).strict()).length(7),
}).strict().superRefine((copy, ctx) => {
  copy.pages.forEach((page, index) => {
    if (page.id !== `body-${index + 1}` || page.role !== NEWS_EDITORIAL_ROLES[index]) ctx.addIssue({ code: "custom", path: ["pages", index, "role"], message: "8장 카드의 역할과 페이지 순서를 확인해 주세요." });
    if ((page.role === "perspectives" || page.role === "concept") !== !!page.columns) ctx.addIssue({ code: "custom", path: ["pages", index, "columns"], message: "시선 비교와 개념 정의에만 두 칸 문구가 필요합니다." });
    if (page.resourceSourceId && page.role !== "activity") ctx.addIssue({ code: "custom", path: ["pages", index, "resourceSourceId"], message: "참고자료 ID는 활동 카드에서만 선택해 주세요." });
    const max = NEWS_EDITORIAL_BODY_LIMITS[page.role];
    if (max && codepoints(page.body) > max) ctx.addIssue({ code: "custom", path: ["pages", index, "body"], message: `이 카드의 본문은 ${max}자 이내로 작성해 주세요.` });
  });
});

export function cardCopyLimits(templateKey: string, storyFormat?: "discussion8") {
  const design = templateKey.startsWith("set:") ? cardDesign(templateKey.slice(4)) : undefined;
  return {
    recommended: storyFormat === "discussion8" ? NEWS_EDITORIAL_AI_LIMITS : CARD_COPY_AI_LIMITS,
    max: CARD_COPY_MANUAL_LIMITS,
    defaultBodyPages: storyFormat === "discussion8" ? 7 : 4,
    maxBodyPages: 9,
    layoutId: design?.layoutId ?? design?.id ?? templateKey,
    templateName: design?.name ?? "카드뉴스",
    description: design?.description ?? "제목·부제·본문을 구분한 카드뉴스",
  };
}

/** Color variants share the same editorial slots; selecting one never rewrites any text. */
export function cardCopyTemplateInstruction(templateKey: string, storyFormat?: "discussion8"): string {
  if (storyFormat === "discussion8") return discussionCardCopyInstruction(templateKey);
  const limits = cardCopyLimits(templateKey);
  return `선택한 템플릿: ${limits.templateName} (${templateKey}, 레이아웃 ${limits.layoutId}). ${limits.description}.
cardCopy에는 표지 cover 1장과 본문 pages 4장을 작성한다. version=1, templateKey=${JSON.stringify(templateKey)}.
표지 title은 핵심 주제를 80자 이내, subtitle은 독자가 알아야 할 맥락을 60자 이내로 쓴다.
본문 카드마다 id는 body-1, body-2, body-3, body-4 순서로 고정한다. title 60자 이내, subtitle 60자 이내, body 140자 이내(공백 포함)로 쓴다. title과 body는 비우지 않는다. subtitle은 필요 없으면 빈 문자열이다.
제목·부제·본문은 실제 이미지의 별도 글자 영역에 표시된다. 같은 말을 반복하지 말고 한 장에 한 가지 내용을 담는다.
자료의 사실, 날짜·수치·대상·신청 조건, 확인 중인 내용과 출처의 불확실성을 정확히 유지한다. 원문에 없는 주장을 만들지 않는다. 길면 사실을 바꾸지 않고 짧게 요약한다.
모든 원문 사실은 기존 요약 필드에 그대로 보존하고 cardCopy는 카드에 넣을 별도의 편집 문구로 만든다. 게시물 캡션이나 이미지 설명(alt text)을 대신 쓰지 않는다.`;
}

export function cardCopyFromStored(payload: Record<string, unknown>): CardCopy | undefined {
  return payload.cardCopy === undefined ? undefined : cardCopySchema.parse(payload.cardCopy);
}

/** AI/source refreshes may update facts, but only an explicit copy edit can replace saved editorial text. */
export function preserveCardCopy<T extends Record<string, unknown>>(next: T, previous: Record<string, unknown> | null | undefined): T {
  return previous?.cardCopy === undefined ? next : { ...next, cardCopy: cardCopySchema.parse(previous.cardCopy) };
}
