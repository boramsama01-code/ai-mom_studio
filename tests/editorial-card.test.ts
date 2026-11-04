import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { aiDiscussionCardCopySchema, cardCopySchema, NEWS_EDITORIAL_ROLES, preserveCardCopy } from "../shared/cardCopy";
import { CardOverflowError, type CardStyle } from "../server/services/card";
import { layoutEditorialCard } from "../server/services/editorialCard";
import { cardApprovalHash, planCarousel, renderCarouselPage, renderCarouselPages, type CarouselPageImages } from "../server/services/cardCarousel";
import { discussionCardCopyFixture } from "./fixtures/discussionCardCopy";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { NEWS_EDITORIAL_BODY_LIMITS } from "../shared/newsEditorial";

const style: CardStyle = { layout: "minimal", collection: "n03" };
const input = (copy = discussionCardCopyFixture()) => ({ kind: "current_dialogue", payload: { title: "원문 제목", summary: "원문 사실은 그대로 보존됩니다.", cardCopy: copy }, channelName: "Alligodang", channelSlug: "news", accent: "#31695C", sourceOrg: "테스트 자료", checkedDate: "2026-11-04" });

describe("eight-page editorial structure", () => {
  it("retains existing four-page saved copy and preserves the new roles through source regeneration", () => {
    const legacy = cardCopyFixture();
    expect(cardCopySchema.parse(legacy)).toEqual(legacy);
    const copy = discussionCardCopyFixture();
    expect(aiDiscussionCardCopySchema.parse(copy)).toEqual(copy);
    expect(cardCopySchema.parse(copy)).toEqual(copy);
    expect(preserveCardCopy({ summary: "새 요약", cardCopy: legacy }, { cardCopy: copy }).cardCopy).toEqual(copy);
    const plan = planCarousel(input(copy), style);
    expect(plan.count).toBe(8);
    expect(plan.pages.map(page => page.editorial?.role)).toEqual([...NEWS_EDITORIAL_ROLES]);
    expect(plan.pages.at(-1)?.editorial).toMatchObject({ role: "closing", page: 8 });
  });

  it("rejects reordered/missing roles, duplicate IDs, hidden columns and model-generated image IDs", () => {
    const bad = discussionCardCopyFixture();
    [bad.pages[0], bad.pages[1]] = [bad.pages[1], bad.pages[0]];
    expect(cardCopySchema.safeParse(bad).success).toBe(false);
    expect(aiDiscussionCardCopySchema.safeParse(bad).success).toBe(false);
    const missing = discussionCardCopyFixture(); missing.pages.pop();
    expect(cardCopySchema.safeParse(missing).success).toBe(false);
    const columns = discussionCardCopyFixture(); columns.pages[0].columns = columns.pages[3].columns;
    expect(cardCopySchema.safeParse(columns).success).toBe(false);
    const image = discussionCardCopyFixture(); image.pages[1].background = { assetId: 55, opacity: 72 };
    expect(cardCopySchema.parse(image).pages[1].background).toEqual({ assetId: 55, opacity: 72 });
    expect(aiDiscussionCardCopySchema.safeParse(image).success).toBe(false);
    image.pages[1].background.opacity = 101;
    expect(cardCopySchema.safeParse(image).success).toBe(false);
    const legacyBackground = cardCopyFixture(); legacyBackground.cover.background = { assetId: 55 };
    expect(cardCopySchema.safeParse(legacyBackground).success).toBe(false);
  });

  it("fits central reading areas and keeps both perspective columns and all editable text", () => {
    const copy = discussionCardCopyFixture(), before = JSON.stringify(copy), plan = planCarousel(input(copy), style);
    for (const [index, model] of [plan.base, ...plan.pages].entries()) {
      const { textRuns } = layoutEditorialCard(model, style);
      for (const run of textRuns) {
        expect(run.x).toBeGreaterThanOrEqual(0); expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.x + run.width).toBeLessThanOrEqual(1080); expect(run.y + run.height).toBeLessThanOrEqual(1350);
        expect(run.lines.length * run.lineHeight).toBeLessThanOrEqual(run.height);
        expect(run.align).toBe("center");
        expect(run.lines.join("").replace(/\s/g, "")).toBe(run.text.replace(/\s/g, ""));
      }
      const texts = textRuns.map(run => run.text);
      expect(texts).toContain(index === 0 ? copy.cover.title : copy.pages[index - 1].title);
      if (index > 0) {
        expect(texts).toContain(copy.pages[index - 1].body);
        for (const column of copy.pages[index - 1].columns ?? []) { expect(texts).toContain(column.title); expect(texts).toContain(column.body); }
      }
    }
    expect(JSON.stringify(copy)).toBe(before);
  });

  it("reports the overflowing page field without truncating user text", () => {
    const copy = discussionCardCopyFixture(); copy.pages[3].columns![0].body = "가".repeat(1000);
    expect(cardCopySchema.safeParse(copy).success).toBe(true);
    expect(() => planCarousel(input(copy), style)).toThrow(CardOverflowError);
    try { planCarousel(input(copy), style); } catch (error) { expect(error).toMatchObject({ field: "cardCopy.pages.3.columns.0.body" }); }
    expect(copy.pages[3].columns![0].body).toHaveLength(1000);
  });

  it("fits the full AI character budget in every retained news palette and refuses remote image URLs", () => {
    const copy = discussionCardCopyFixture(); copy.cover = { title: "가".repeat(56), subtitle: "나".repeat(52) };
    for (const page of copy.pages) {
      page.title = "가".repeat(36); page.subtitle = "나".repeat(52); page.body = "다".repeat(NEWS_EDITORIAL_BODY_LIMITS[page.role!] ?? 140);
      if (page.columns) page.columns = page.columns.map(() => ({ title: "라".repeat(24), body: "마".repeat(100) }));
    }
    expect(aiDiscussionCardCopySchema.safeParse(copy).success).toBe(true);
    for (const collection of ["n01", "n03", "n04", "n03-dark", "n04-charcoal"]) expect(planCarousel(input(copy), { ...style, collection }).count).toBe(8);
    const model = planCarousel(input(), style).base;
    expect(() => layoutEditorialCard(model, style, { imageDataUrl: "https://example.com/image.png" })).toThrow("서버에서 읽은 JPEG");
  });

  it("renders eight real 4:5 JPEGs and uses exactly the same pixels for preview and export", async () => {
    const plan = planCarousel(input(), style), pages = await renderCarouselPages(plan, style, null, "");
    expect(pages).toHaveLength(8);
    for (const [index, page] of pages.entries()) {
      expect(await sharp(page.bytes).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg", channels: 3 });
      expect([...page.altText].length).toBeLessThanOrEqual(125);
      const preview = await renderCarouselPage(plan, index, style, null, "");
      // Export binds the cover to body hashes using a JPEG comment. Decoded pixels must still match.
      expect((await sharp(preview).raw().toBuffer()).equals(await sharp(page.bytes).raw().toBuffer())).toBe(true);
    }
  });

  it("changes only the selected background and binds that change to the cover and approval", async () => {
    const copy = discussionCardCopyFixture(), noBackground = await renderCarouselPages(planCarousel(input(copy), style), style, null, "");
    copy.pages[4].background = { assetId: 71, opacity: 85 };
    const plan = planCarousel(input(copy), style);
    await expect(renderCarouselPage(plan, 5, style, null, "")).rejects.toThrow("배경 이미지를 불러올 수 없습니다");
    const bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#A74C29" } }).jpeg().toBuffer();
    const images: CarouselPageImages = Object.assign(new Map([[71, bytes]]), { credits: new Map([[71, "직접 등록 이미지"]]) });
    const withBackground = await renderCarouselPages(plan, style, null, "", images);
    for (let index = 1; index < 8; index++) expect(noBackground[index].bytes.equals(withBackground[index].bytes)).toBe(index !== 5);
    expect(noBackground[0].bytes.equals(withBackground[0].bytes)).toBe(false);
    expect(cardApprovalHash(noBackground)).not.toBe(cardApprovalHash(withBackground));
    expect((await sharp(noBackground[0].bytes).raw().toBuffer()).equals(await sharp(withBackground[0].bytes).raw().toBuffer())).toBe(true);
  });
});
