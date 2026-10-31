import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CARD_COLOR_VARIANTS, PERSISTED_CARD_DESIGNS, collectionUsesArt } from "../shared/cardDesigns";
import { studioContentSchema } from "../shared/studio";
import { CardOverflowError } from "../server/services/card";
import { collectionSample, renderCollectionPreview } from "../server/services/cardDesignSamples";
import { checkCollectionTitle, renderCollectionCover } from "../server/services/cardCollection";
import { checkStudioExport, createStudioRenderer } from "../server/services/studioExport";
import { planCarousel } from "../server/services/cardCarousel";
import { sha256 } from "../server/services/text";

describe("5 editorial layouts with 30 complete color sets", () => {
  const hashes = new Set<string>();
  it.each(CARD_COLOR_VARIANTS)("$id renders all five pages and a production cover without sample art", async d => {
    const { plan } = collectionSample(d.id);
    expect(plan.count).toBe(5);
    for (let page = 0; page < 5; page++) {
      const image = await renderCollectionPreview(d.id, page);
      expect(await sharp(image).metadata()).toMatchObject({ width: 1080, height: 1350, channels: 3, format: "jpeg" });
      const hash = sha256(image); expect(hashes.has(hash)).toBe(false); hashes.add(hash);
    }
    expect(await sharp(await renderCollectionCover(plan.base, 5, null, "", d.id)).metadata()).toMatchObject({ width: 1080, height: 1350 });
    expect(() => checkCollectionTitle("매우 긴 제목을 임의로 자르지 않습니다. ".repeat(25), d.id)).toThrow(CardOverflowError);
  });
  it("keeps persisted designs readable and rejects unknown palette names", () => {
    for (const design of [...PERSISTED_CARD_DESIGNS, ...CARD_COLOR_VARIANTS]) expect(studioContentSchema.safeParse({ title: "기존 작업", exportDesign: `set:${design.id}` }).success).toBe(true);
    expect(studioContentSchema.safeParse({ title: "작업", exportDesign: "set:n04-madeup" }).success).toBe(false);
    expect(collectionUsesArt("n04-cobalt")).toBe(false);
    expect(collectionUsesArt("n01-yellow")).toBe(true);
  });
  it("maintains readable text on every palette surface", () => {
    const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    for (const d of CARD_COLOR_VARIANTS) {
      expect(contrast(d.ink, d.bg), `${d.id}: body`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.ink, d.soft), `${d.id}: panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.onAccent, d.accent), `${d.id}: accent`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("continues long content without losing facts in a new layout", () => {
    const long = "원문의 모든 사실과 확인 중인 사항을 빠짐없이 남깁니다. ".repeat(20).trim();
    const plan = planCarousel({ kind: "current_dialogue", payload: { title: "긴 기사", summary: long, verified_facts: ["확인된 사실"], under_verification: ["확인 중인 내용"] }, channelName: "뉴스", accent: "#123456", sourceOrg: "원문", checkedDate: "2026-10-31" }, { layout: "minimal", collection: "n02" });
    expect(plan.count).toBeGreaterThan(5); expect(plan.count).toBeLessThanOrEqual(10);
    expect(plan.pages.flatMap(p => p.blocks).filter(b => b.field === "summary").map(b => b.text).join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
    expect(JSON.stringify(plan.pages)).toContain("확인 중인 내용");
  });
  it("exports five native Studio pages, retaining body images and rejecting image/text overflow", async () => {
    const content = studioContentSchema.parse({ title: "새로운 배움을 시작해요", format: "카드뉴스", exportDesign: "set:r01-blue", sourceLabel: "직접 작성", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "호기심에서 탐구가 시작됩니다.", imageId: 1 })) });
    const art = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#ff0022" } }).png().toBuffer();
    expect(checkStudioExport(content)).toMatchObject({ errors: [], pageCount: 5 });
    const output = createStudioRenderer(content, 1, "우주펭귄상회", "#265F6A", new Map([[1, art]]));
    for (let i = 0; i < 5; i++) expect(await sharp(await output.page(i)).metadata()).toMatchObject({ width: 1080, height: 1350, format: "png" });
    const pixel = await sharp(await output.page(1)).extract({ left: 539, top: 570, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeGreaterThan(230); expect(pixel[1]).toBeLessThan(25);
    await expect(output.page(5)).rejects.toThrow("페이지");
    content.panels[0].dialogue = "긴 본문을 너무 작게 줄이지 않고 먼저 확인합니다. ".repeat(35);
    expect(checkStudioExport(content).errors).toContainEqual(expect.objectContaining({ field: "panels.0.dialogue" }));
  });
});
