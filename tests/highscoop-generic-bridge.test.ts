import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { HIGH_SCOOP_TEMPLATE_KITS } from "../shared/highscoopTemplates";
import { planCarousel, renderCarouselPage, renderCarouselPages } from "../server/services/cardCarousel";
import { highScoopCardPageSvg } from "../server/services/highscoopCardBridge";
import { HttpError } from "../server/routes/util";
import { CardOverflowError } from "../server/services/card";

const copy = (templateKey = "highscoop:conversation") => ({
  version: 1,
  templateKey,
  cover: { title: "게임 이야기가 대화의 시작", subtitle: "오늘 재미있었던 장면, 하나 보여줄래?" },
  pages: [
    { id: "body-1", title: "아이에게 물어봤어요", subtitle: "아이의 관점", body: "남의 세계도 보고 내 세계도 만들어 보여줄 수 있어서 좋아요." },
    { id: "body-2", title: "함께 듣는 시간", subtitle: "대화를 이어가요", body: "무슨 생각을 했는지 듣고, 즐거운 대화로 끝나도 괜찮아요." },
  ],
});
const input = (cardCopy: Record<string, unknown> = copy()) => ({
  kind: "notice", channelName: "HighScoop", channelSlug: "opportunities", accent: "#FF493B",
  sourceOrg: "직접 나눈 대화", checkedDate: "2026-11-13", payload: { title: "게임 이야기", cardCopy },
});

describe("current HighScoop kits in the generic card editor", () => {
  it("renders all six categories with the native rounded cover badge and original copy", async () => {
    for (const kit of HIGH_SCOOP_TEMPLATE_KITS) {
      const original = copy(kit.key), plan = planCarousel(input(original), { layout: "magazine", highscoopTemplateKey: kit.key });
      expect(plan.count).toBe(3);
      expect(plan.highscoopOutro).toBeUndefined();
      expect(plan.copy).toEqual(original);
      const svg = await highScoopCardPageSvg(plan.highscoop!, 0, null, "");
      expect(svg).toContain('data-name="cover-category-badge"');
      expect(svg).toContain(`fill="${kit.color}"`);
      expect(svg).toContain(`aria-label="${kit.category}"`);
      expect(svg).toContain(`aria-label="${original.cover.title}"`);
      expect(svg).toContain(`aria-label="${original.cover.subtitle}"`);
    }
  });

  it("preserves the last manuscript page and uses the native interior rather than an implicit outro", async () => {
    const original = copy(), plan = planCarousel(input(original), { layout: "magazine" });
    const svg = await highScoopCardPageSvg(plan.highscoop!, 2, null, "");
    for (const text of [original.pages[1].title, original.pages[1].subtitle, original.pages[1].body]) expect(svg).toContain(text);
    expect(svg).not.toContain('data-name="follow-handle"');
    expect(plan.highscoop!.document.pages).toHaveLength(3);
    const pages = await renderCarouselPages(plan, { layout: "magazine" }, null, "");
    expect(pages.map(page => page.title)).toEqual([original.cover.title, ...original.pages.map(page => page.title)]);
    for (const page of pages) expect(await sharp(page.bytes).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1350 });
    expect(pages[2].altText).toContain(original.pages[1].body);
  });

  it("reuses selected cover artwork and the same native rendering for preview and final deck", async () => {
    const plan = planCarousel(input(), { layout: "magazine" });
    const art = await sharp({ create: { width: 108, height: 135, channels: 3, background: "#6A4CB8" } }).png().toBuffer();
    const originalBytes = Buffer.from(art);
    const svg = await highScoopCardPageSvg(plan.highscoop!, 0, art, "원본 게임 화면");
    expect(svg).toContain('data-name="photo-1"');
    expect(svg).toContain('data-name="bottom-black-fade"');
    expect(svg).toContain("원본 게임 화면");
    const expected = await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    expect((await renderCarouselPage(plan, 0, { layout: "magazine" }, art, "원본 게임 화면")).equals(expected)).toBe(true);
    expect(art.equals(originalBytes)).toBe(true);
    expect(plan.highscoop!.document.pages[0].imageId).toBeUndefined();
  });

  it("uses a channel-default kit even before an editable card copy is saved, retaining every source section", () => {
    const payload = { title: "모집 안내", audience: "초등 4~6학년", eligibility: "지역 거주 학생", one_line_summary: "새로운 도전", key_details: "교사추천 마감도 별도로 확인", uncertainties: ["원문을 확인하세요"], schedules: [] };
    const plan = planCarousel({ ...input(), payload }, { layout: "magazine", highscoopTemplateKey: "highscoop:gifted" });
    const source = plan.highscoop!.document.pages.map(page => [page.title, page.interiorSubtitle, page.body].join("\n")).join("\n");
    for (const fact of [payload.audience, payload.eligibility, payload.key_details, ...payload.uncertainties]) expect(source).toContain(fact);
    expect(plan.highscoop!.document.pages).toHaveLength(plan.count);
    expect(plan.highscoopOutro).toBeUndefined();
  });

  it("leaves legacy brand rendering intact and rejects rich manuscript conversion instead of discarding its structure", () => {
    const legacy = planCarousel({ ...input(copy("legacy:classic")), channelName: "Fryday", channelSlug: "science" }, { layout: "classic" });
    expect(legacy.highscoop).toBeUndefined();
    expect(legacy.copy).toEqual(copy("legacy:classic"));
    for (const manuscript of [{ version: 2, templateKey: "highscoop:news" }, { ...copy(), storyFormat: "discussion8" }]) {
      try { planCarousel(input(manuscript), { layout: "magazine" }); throw new Error("Conversion unexpectedly succeeded"); }
      catch (error) { expect(error).toBeInstanceOf(HttpError); expect((error as HttpError).status).toBe(422); }
    }
  });

  it("preserves the generic overflow error for both length and native typography limits without changing saved copy", async () => {
    const original = copy(), plan = planCarousel(input(original), { layout: "magazine" });
    plan.highscoop!.document.pages[1].title = "아주 긴 제목".repeat(60);
    await expect(highScoopCardPageSvg(plan.highscoop!, 1, null, "")).rejects.toBeInstanceOf(CardOverflowError);
    expect(plan.copy).toEqual(original);
    const fitted = planCarousel(input(original), { layout: "magazine" });
    fitted.highscoop!.document.pages[0].title = "아주 긴 제목 ".repeat(25);
    await expect(highScoopCardPageSvg(fitted.highscoop!, 0, null, "")).rejects.toMatchObject({ field: "title" });
    await expect(highScoopCardPageSvg(fitted.highscoop!, 0, null, "")).rejects.toBeInstanceOf(CardOverflowError);
    expect(fitted.copy).toEqual(original);
  });
});
