import { conciseAlt } from "../../shared/altText";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { mediaAssets } from "../../shared/schema";
import { buildCardModel } from "./cardModel";
import { formatScheduleLines } from "../../shared/format";
import { CardOverflowError, layoutCard, loadFonts, renderCardJpeg, wrapText, type CardModel, type CardStyle } from "./card";
import { sha256 } from "./text";
import { HttpError } from "../routes/util";
import { layoutCollectionBody, renderCollectionBody, renderCollectionCover } from "./cardCollection";
import { cardCopyFromStored, cardCopySchema, type CardCopy } from "../../shared/cardCopy";
import { checkEditorialCard, renderEditorialCard } from "./editorialCard";
import { defaultPageDesigns, familyCardCopySchema, pageDesignsSchema, type CardCopyV2, type PageDesigns } from "../../shared/familyDialogue";
import { checkFamilyDialogueCard, familyBrandName, familyPageText, familyPageTitle, renderFamilyDialogueCard, type FamilyCardContext } from "./familyDialogueCard";

type Block = CardModel["blocks"][number];
type Section = { title: string; blocks: Block[] };
export type ModelInput = Parameters<typeof buildCardModel>[0];
export type CarouselPlan = { base: CardModel; pages: CardModel[]; count: number; copy?: CardCopy; family?: { copy: CardCopyV2; designs: PageDesigns; context: FamilyCardContext } };
export type CarouselPageImages = ReadonlyMap<number, Buffer> & { credits?: ReadonlyMap<number, string> };
const block = (field: string, label: string, text: unknown): Block => ({ field, label, text: Array.isArray(text) ? text.filter(Boolean).join("\n\n") : String(text ?? ""), maxLines: 30 });

/** Four editorial sections, without an extra summarization call or loss of source facts. */
export function carouselSections(kind: string, p: Record<string, any>): Section[] {
  if (kind === "science_dialogue") return [
    { title: "이야기의 배경", blocks: [block("background", "먼저 알아두기", p.background)] },
    { title: "근거를 살펴볼까요", blocks: [block("scientific_basis", "과학적 근거", p.scientific_basis), block("misconceptions", "오해하기 쉬운 점", p.misconceptions)] },
    { title: "함께 생각하는 질문", blocks: [block("discussion_questions", "정답보다 생각의 과정", p.discussion_questions)] },
    { title: "대화를 이어가요", blocks: [block("parent_hints", "부모님을 위한 힌트", p.parent_hints), block("safe_activity", "함께 해볼 활동", p.safe_activity)] },
  ];
  if (kind === "current_dialogue") return [
    { title: "무슨 일이 있었나요", blocks: [block("summary", "핵심 이야기", p.summary), block("why_it_matters", "왜 중요한가요", p.why_it_matters)] },
    { title: "사실과 확인할 내용", blocks: [block("verified_facts", "확인된 사실", p.verified_facts), block("under_verification", "아직 확인 중", p.under_verification)] },
    { title: "여러 관점에서 보기", blocks: [block("perspectives", "다양한 관점", (p.perspectives ?? []).map((v: any) => `${v.stakeholder}: ${v.view}`)), block("glossary", "알아두면 좋은 말", (p.glossary ?? []).map((v: any) => `${v.term}: ${v.meaning}`))] },
    { title: "우리의 생각은 어떤가요", blocks: [block("discussion_questions", "함께 생각할 질문", p.discussion_questions), block("parent_hints", "대화를 위한 힌트", p.parent_hints)] },
  ];
  return [
    { title: "한눈에 보는 안내", blocks: [block("one_line_summary", "핵심 안내", p.one_line_summary), block("organization", "주관 기관", p.organization), block("academic_year", "대상 학년도", p.academic_year)] },
    { title: "누가 참여할 수 있나요", blocks: [block("audience", "대상", p.audience), block("eligibility", "지원 자격", p.eligibility)] },
    { title: "놓치지 말아야 할 일정", blocks: [block("schedules", "일정", formatScheduleLines(p.schedules ?? [])), block("deadline_type", "마감 방식", ({ fixed: "정해진 날짜에 마감", first_come: "선착순 마감", tbd: "일정 추후 공지", unknown: "원문에서 마감 방식 확인 필요" } as Record<string, string>)[p.deadline_type])] },
    { title: "신청 전 확인해 주세요", blocks: [block("key_details", "주요 내용", p.key_details), block("uncertainties", "추가 확인할 내용", p.uncertainties)] },
  ];
}

/** Measure real typography. Overflow continues on another page; text is never sliced away. */
export function planCarousel(input: ModelInput, style: CardStyle): CarouselPlan {
  const base = buildCardModel(input);
  if (input.payload.cardCopy?.version === 2) {
    const parsed = familyCardCopySchema.safeParse(input.payload.cardCopy);
    if (!parsed.success) throw new HttpError(422, "8장 원고의 필드와 순서를 확인해 주세요. 기존 문구는 유지했습니다.");
    const designResult = pageDesignsSchema.safeParse(input.payload.pageDesigns ?? defaultPageDesigns());
    if (!designResult.success) throw new HttpError(422, "페이지 디자인 저장값을 확인해 주세요. 기존 문구와 배경은 유지했습니다.");
    const copy = parsed.data, designs = designResult.data;
    const context: FamilyCardContext = { brandName: familyBrandName(copy, input.channelName), accent: input.accent, sourceCredit: base.footer };
    const models = copy.pages.map(page => {
      checkFamilyDialogueCard(page, designs[page.id], context, style);
      return { ...base, title: familyPageTitle(page), subtitle: undefined,
        blocks: familyPageText(page).map((text, i) => ({ field: `cardCopy.pages.${page.page - 1}.fields.${i}`, text, maxLines: 30 })),
        badge: `${String(page.page).padStart(2, "0")} / 08`,
      };
    });
    return { base: models[0], pages: models.slice(1), count: 8, family: { copy, designs, context } };
  }
  const copy = cardCopyFromStored(input.payload);
  if (copy) {
    const count = copy.pages.length + 1;
    const cover: CardModel = { ...base, title: copy.cover.title, subtitle: copy.cover.subtitle,
      ...(copy.storyFormat === "discussion8" ? { editorial: { role: "cover", page: 1, count, background: copy.cover.background } } : {}),
    };
    const pages = copy.pages.map((page, i): CardModel => ({
      ...base, title: page.title, subtitle: page.subtitle,
      badge: `${String(i + 2).padStart(2, "0")} / ${String(count).padStart(2, "0")}`,
      blocks: [{ field: `cardCopy.pages.${i}.body`, label: page.subtitle, text: page.body, maxLines: 30 }],
      ...(copy.storyFormat === "discussion8" ? { editorial: { role: page.role!, page: i + 2, count, columns: page.columns, sourceIds: page.sourceIds, background: page.background, resource: page.resource } } : {}),
    }));
    // A saved card has a stable identity. Overflow is actionable; it never silently splits or clips edited copy.
    if (cover.editorial) checkEditorialCard(cover, style);
    for (const page of pages) {
      if (page.editorial) checkEditorialCard(page, style);
      else if (style.collection) layoutCollectionBody(page, style.collection); else layoutCard(page, style);
    }
    return { base: cover, pages, count, copy };
  }
  const pages: CardModel[] = [];
  const append = (title: string, blocks: Block[], depth = 0) => {
    const model = { ...base, title, blocks, badge: "02 / 10", footer: base.footer };
    try {
      // Bound the expensive font layout before drawing paths for an obviously overfull page.
      if (blocks.reduce((sum, b) => sum + b.text.length, 0) > 700) throw new CardOverflowError("본문", "다음 페이지에 이어서 배치");
      if (style.collection) layoutCollectionBody(model, style.collection); else layoutCard(model, style);
      pages.push(model);
    }
    catch (e) {
      if (!(e instanceof CardOverflowError) || depth > 12 || e.field === "title" || e.field === "footer" || e.field === "brandLine") throw e;
      if (blocks.length > 1) {
        const mid = Math.ceil(blocks.length / 2);
        append(title, blocks.slice(0, mid), depth + 1); append(`${title.replace(/ · 계속$/, "")} · 계속`, blocks.slice(mid), depth + 1);
      } else {
        const text = blocks[0]?.text ?? "";
        if (text.length < 40) throw e;
        let cut = Math.floor(text.length / 2);
        const boundary = text.lastIndexOf(" ", cut);
        if (boundary > cut / 2) cut = boundary;
        append(title, [{ ...blocks[0], text: text.slice(0, cut).trim() }], depth + 1);
        append(`${title.replace(/ · 계속$/, "")} · 계속`, [{ ...blocks[0], text: text.slice(cut).trim() }], depth + 1);
      }
    }
    if (pages.length > 9) throw new CardOverflowError("본문", "전체 원고가 10장을 넘습니다. 핵심 내용 위주로 편집해 주세요. 내용은 자르지 않았습니다.");
  };
  for (const section of carouselSections(input.kind, input.payload)) {
    const blocks = section.blocks.filter(b => b.text.trim());
    append(section.title, blocks.length ? blocks : [block("closing", "함께 확인해요", "원문과 출처를 다시 살펴보고, 궁금한 점을 이야기해 보세요.")]);
  }
  const count = pages.length + 1;
  return { base, pages: pages.map((p, i) => ({ ...p, badge: `${String(i + 2).padStart(2, "0")} / ${String(count).padStart(2, "0")}`, footer: base.footer })), count };
}

/** Lossless editable seed for old decks. Preserve their actual pagination and every block label. */
export function cardCopyFromPayload(input: ModelInput, style: CardStyle, templateKey: string): CardCopy {
  const saved = cardCopyFromStored(input.payload);
  if (saved) return { ...saved, templateKey };
  const plan = planCarousel(input, style);
  return cardCopySchema.parse({
    version: 1, templateKey,
    cover: { title: plan.base.title || "카드뉴스", subtitle: plan.base.subtitle ?? "" },
    pages: plan.pages.map((page, i) => ({
      id: `body-${i + 1}`, title: page.title, subtitle: page.blocks.length === 1 ? page.blocks[0].label ?? "" : "",
      body: page.blocks.map(block => page.blocks.length > 1 && block.label ? `${block.label}\n${block.text}` : block.text).join("\n\n"),
    })),
  });
}

export async function renderCarouselCover(model: CardModel, count: number, art: Buffer | null, credit: string, style: CardStyle): Promise<Buffer> {
  if (model.editorial) return renderEditorialCard(model, style, art ?? style.background ?? null, credit);
  if (style.collection) return renderCollectionCover(model, count, art ?? style.background ?? null, credit, style.collection);
  const f = loadFonts();
  const color = /^#[a-f0-9]{6}$/i.test(model.accent) ? model.accent : "#2563eb";
  const svg: string[] = [];
  const text = (value: string, y: number, max: number, min: number, height: number, bold = false, ink = "#172532", width = 920, x = 80, field = "title") => {
    const font = bold ? f.bold : f.regular;
    let size = max;
    while (size > min && wrapText(font, value, size, width).length * size * 1.3 > height) size -= 2;
    const lines = wrapText(font, value, size, width);
    if (lines.length * size * 1.3 > height) throw new CardOverflowError(field, "표지 문구가 너무 깁니다. 문구를 줄여 주세요.");
    lines.forEach((line, i) => svg.push(`<path d="${font.getPath(line, x, y + i * size * 1.3, size).toPathData(2)}" fill="${ink}"/>`));
  };
  svg.push(`<rect width="1080" height="1350" fill="#f5f7fb"/><rect x="80" y="136" width="60" height="8" rx="4" fill="${color}"/>`);
  text(model.brandLine, 80, 25, 18, 40, true, "#536273", 790);
  text(`01 / ${String(count).padStart(2, "0")}`, 80, 24, 24, 40, false, "#536273", 130, 890);
  text(model.title, 244, 78, 32, 350, true);
  if (art || style.background) {
    const picture = await sharp(art ?? style.background!, { limitInputPixels: 40_000_000 }).rotate().resize(920, 560, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
    svg.push(`<defs><clipPath id="cover"><rect x="80" y="610" width="920" height="560" rx="32"/></clipPath></defs><image x="80" y="610" width="920" height="560" clip-path="url(#cover)" href="data:image/jpeg;base64,${picture.toString("base64")}"/>`);
  } else {
    svg.push(`<rect x="80" y="610" width="920" height="560" rx="32" fill="${color}"/><circle cx="910" cy="660" r="230" fill="#ffffff" opacity=".09"/><circle cx="830" cy="1110" r="290" fill="#ffffff" opacity=".08"/>`);
    if (model.subtitle === undefined) text("하나씩 읽고,\n함께 생각해요.", 850, 64, 48, 230, true, "#ffffff", 760, 130);
  }
  if (model.subtitle) {
    if (art || style.background) {
      svg.push('<rect x="100" y="973" width="880" height="177" rx="18" fill="#172532" fill-opacity=".88"/>');
    }
    text(model.subtitle, 1018, 34, 26, 142, true, "#ffffff", 800, 140, "cardCopy.cover.subtitle");
  }
  text(credit, 1210, 20, 16, 30, false, "#536273");
  text(model.footer, 1270, 23, 18, 65, false, "#536273");
  return sharp(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${svg.join("")}</svg>`, { font: { loadSystemFonts: false } }).render().asPng()).flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** One exact final page, shared by the editor preview, saved deck and publication export. */
export async function renderCarouselPage(plan: CarouselPlan, pageIndex: number, style: CardStyle, art: Buffer | null, credit: string, pageImages: CarouselPageImages = new Map()): Promise<Buffer> {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= plan.count) throw new HttpError(400, "카드 페이지를 확인해 주세요.");
  if (plan.family) {
    const { copy, designs, context } = plan.family, page = copy.pages[pageIndex], design = designs[page.id];
    const assetId = design.background.kind === "image" ? design.background.assetId : undefined;
    const image = assetId ? pageImages.get(assetId) : undefined;
    if (design.background.kind === "image" && (!assetId || !image)) throw new HttpError(422, "이 페이지에 선택한 배경을 불러올 수 없습니다. 저장한 원고는 유지했습니다. 배경을 다시 선택해 주세요.");
    return renderFamilyDialogueCard(page, design, context, style, image ?? null, assetId ? pageImages.credits?.get(assetId) ?? "배경 이미지" : "");
  }
  const model = pageIndex === 0 ? plan.base : plan.pages[pageIndex - 1];
  const background = pageIndex === 0 ? plan.copy?.cover.background : plan.copy?.pages[pageIndex - 1].background;
  const bytes = background ? pageImages.get(background.assetId) : undefined;
  if (background && !bytes) throw new HttpError(422, "이 카드의 배경 이미지를 불러올 수 없습니다. 배경을 다시 선택해 주세요. 기존 저장본은 유지했습니다.");
  const pageCredit = background ? pageImages.credits?.get(background.assetId) ?? "배경 이미지" : pageIndex === 0 ? credit : "";
  if (model.editorial) return renderEditorialCard(model, style, bytes ?? (pageIndex === 0 ? art ?? style.background ?? null : null), pageCredit);
  if (pageIndex === 0) return renderCarouselCover(model, plan.count, bytes ?? art, credit, style);
  return style.collection ? renderCollectionBody(model, style.collection) : (await renderCardJpeg(model, style)).jpeg;
}

export async function renderCarouselPages(plan: CarouselPlan, style: CardStyle, art: Buffer | null, credit: string, pageImages: CarouselPageImages = new Map()) {
  const output = [{ title: plan.base.title, altText:conciseAlt([`카드뉴스 표지. ${plan.base.title}`,plan.base.subtitle ?? "",plan.base.brandLine,plan.base.footer]), bytes: await renderCarouselPage(plan, 0, style, art, credit, pageImages) }];
  // Sequential rendering keeps the free instance's peak memory bounded.
  for (const [index, model] of plan.pages.entries()) output.push({ title: model.title, altText:conciseAlt([model.title,...model.blocks.map(b=>[b.label,b.text].filter(Boolean).join(": ")),...(model.editorial?.columns ?? []).map(column => `${column.title}: ${column.body}`),model.footer]), bytes: await renderCarouselPage(plan, index + 1, style, art, credit, pageImages) });
  // Bind the cover's identity to every body page, even when only a body template changes.
  // A standard JPEG comment preserves pixels while preventing a saved manifest being overwritten.
  const comment = Buffer.from(`cardnews-v1:${sha256(output.slice(1).map(p => sha256(p.bytes)).join(":"))}`);
  const marker = Buffer.alloc(4); marker.writeUInt16BE(0xfffe); marker.writeUInt16BE(comment.length + 2, 2);
  output[0].bytes = Buffer.concat([output[0].bytes.subarray(0, 2), marker, comment, output[0].bytes.subarray(2)]);
  return output;
}

/** Also used immediately before publishing: validates every ordered file against its saved hash. */
export async function loadCardPages(db: DB, cover: typeof mediaAssets.$inferSelect) {
  const manifest = cover.carousel;
  if (!manifest) {
    if (sha256(cover.bytes) !== cover.sha256) throw new HttpError(409, "카드 파일이 저장본과 다릅니다.");
    return [cover];
  }
  if (manifest.version !== 1 || manifest.pages.length < 1 || manifest.pages.length > 10 || manifest.pages[0].id !== cover.id || new Set(manifest.pages.map(p => p.id)).size !== manifest.pages.length) throw new HttpError(409, "카드뉴스 구성 정보를 확인할 수 없습니다.");
  const rows = await db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, cover.revisionId), eq(mediaAssets.contentItemId, cover.contentItemId), inArray(mediaAssets.id, manifest.pages.map(p => p.id))));
  return manifest.pages.map(p => {
    const row = rows.find(r => r.id === p.id);
    if (!row || sha256(row.bytes) !== p.sha256 || row.sha256 !== p.sha256) throw new HttpError(409, "카드뉴스 일부가 저장본과 다릅니다. 다시 생성해 주세요.");
    return row;
  });
}
export const cardApprovalHash = (pages: Array<{ bytes: Buffer }>) => pages.length === 1 ? sha256(pages[0].bytes) : sha256(pages.map(p => sha256(p.bytes)).join(":"));
