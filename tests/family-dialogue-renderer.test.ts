import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { familyCardCopyAiSchema, familyCardCopySchema, familyFieldDescriptors, defaultPageDesigns, type CardCopyV2 } from "../shared/familyDialogue";
import { familyDialogueCardFixture, scientificFamilyCardFixture } from "./fixtures/familyDialogueCard";
import { CardOverflowError, type CardStyle } from "../server/services/card";
import { familyPageText, layoutFamilyDialogueCard, prepareFamilyPageImage, renderFamilyDialogueCard } from "../server/services/familyDialogueCard";
import { planCarousel, renderCarouselPage, renderCarouselPages } from "../server/services/cardCarousel";
import { cardPageArtworkIds } from "../server/services/cardPageArtwork";

const style: CardStyle = { layout: "minimal", collection: "n03" };
const context = { brandName: "ALLligodang", accent: "#285E54", sourceCredit: "제공된 인터뷰 기사 · 수동 편집 제안" };
const input = (copy: CardCopyV2, pageDesigns = defaultPageDesigns()) => ({ kind: "current_dialogue", payload: { cardCopy: copy, pageDesigns }, channelName: "ALLligodang", channelSlug: "news", accent: "#285E54", sourceOrg: "제공된 인터뷰 기사", checkedDate: "2026-11-04" });

describe("family dialogue v2 local renderer", () => {
  it("keeps every structured field and uses stacked views by default with readable, bounded typography", () => {
    const copy = familyDialogueCardFixture(), designs = defaultPageDesigns();
    expect(familyCardCopyAiSchema.safeParse(copy).success).toBe(true);
    for (const page of copy.pages) {
      const runs = layoutFamilyDialogueCard(page, designs[page.id], context, style).textRuns;
      for (const value of familyPageText(page)) if (value) expect(runs.map(run => run.text)).toContain(value);
      for (const run of runs) {
        expect(run.x).toBeGreaterThanOrEqual(0); expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.x + run.width).toBeLessThanOrEqual(1080); expect(run.y + run.height).toBeLessThanOrEqual(1350);
        expect(run.lines.length * run.lineHeight).toBeLessThanOrEqual(run.height);
        expect(run.lines.join("").replace(/\s/g, "")).toBe(run.text.replace(/\s/g, ""));
      }
    }
    const page = copy.pages[4], runs = layoutFamilyDialogueCard(page, designs.perspectives, context, style).textRuns;
    const viewA = runs.find(run => run.field.endsWith("viewA.body"))!, viewB = runs.find(run => run.field.endsWith("viewB.body"))!;
    expect(viewA.x).toBe(viewB.x); expect(viewA.y + viewA.height).toBeLessThan(viewB.y);
    const columns = layoutFamilyDialogueCard({ ...page, layout: "columns" }, designs.perspectives, context, style).textRuns;
    expect(columns.find(run => run.field.endsWith("viewA.body"))!.x).toBeLessThan(columns.find(run => run.field.endsWith("viewB.body"))!.x);
  });

  it("renders scientific definitions separately and removes the entire absent optional activity block", () => {
    const copy = scientificFamilyCardFixture(), designs = defaultPageDesigns(), concept = copy.pages[5];
    const runs = layoutFamilyDialogueCard(concept, designs.concept, context, style).textRuns;
    expect(runs.some(run => run.field.endsWith("acceptedDefinition"))).toBe(true);
    expect(runs.some(run => run.field.endsWith("definitionA") || run.field.endsWith("definitionB"))).toBe(false);
    const activity = copy.pages[6]; if (activity.id !== "activity") throw new Error("activity required");
    const single = layoutFamilyDialogueCard(activity, designs.activity, context, style).textRuns;
    expect(single.some(run => run.field.includes("optionalActivity"))).toBe(false);
    const withResource = { ...activity, fields: { ...activity.fields, optionalActivity: { label: "확인된 자료 읽기", action: "자료에서 전망과 확인된 사실을 하나씩 찾아 비교해 보세요.", resourceId: "R1" } } };
    const dual = layoutFamilyDialogueCard(withResource, designs.activity, context, style).textRuns;
    expect(dual.filter(run => run.field.includes("optionalActivity"))).toHaveLength(2);
    expect(dual.map(run => run.text)).not.toContain("R1");
    expect(single.find(run => run.field.endsWith("homeActivity.action"))!.height).toBeGreaterThan(dual.find(run => run.field.endsWith("homeActivity.action"))!.height);
  });

  it("preserves long manual text and reports the exact field that overflows", () => {
    const copy = familyDialogueCardFixture(), page = copy.pages[4]; if (page.id !== "perspectives") throw new Error("perspectives required");
    page.fields.viewB.body = "가".repeat(1000);
    expect(familyCardCopySchema.safeParse(copy).success).toBe(true);
    expect(() => planCarousel(input(copy), style)).toThrow(CardOverflowError);
    try { planCarousel(input(copy), style); } catch (error) { expect(error).toMatchObject({ field: "cardCopy.pages.4.fields.viewB.body" }); }
    expect(page.fields.viewB.body).toHaveLength(1000);
  });

  it("fits every initial writing budget in both concept modes, including two sixty-character activities", () => {
    for (const copy of [familyDialogueCardFixture(), scientificFamilyCardFixture()]) {
      const activity = copy.pages[6]; if (activity.id !== "activity") throw new Error("activity required");
      activity.fields.optionalActivity = { label: "확인한 자료", action: "확인한 자료로 더 생각하기", resourceId: "R1" };
      for (const page of copy.pages) for (const descriptor of familyFieldDescriptors(page)) {
        if (descriptor.systemOwned) continue;
        const parts = descriptor.path.split("."); let cursor: any = page;
        for (const part of parts.slice(0, -1)) cursor = cursor[part];
        cursor[parts.at(-1)!] = descriptor.kind === "array" ? Array.from({ length: 3 }, () => "가".repeat(descriptor.initialBudget)) : "가".repeat(descriptor.initialBudget);
      }
      expect(familyCardCopyAiSchema.safeParse(copy).success).toBe(true);
      expect(planCarousel(input(copy), style).count).toBe(8);
    }
  });

  it("uses saved fit, focal point and brightness without stretching, and scopes current/history asset IDs separately", async () => {
    const left = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#FF0000" } }).png().toBuffer();
    const right = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#0000FF" } }).png().toBuffer();
    const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#FFFFFF" } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: 100, top: 0 }]).png().toBuffer();
    const designs = defaultPageDesigns(); designs.concept.background = { ...designs.concept.background, kind: "image", assetId: 77, focalX: 0 };
    designs.concept.previousAssetIds = [55, 77];
    expect(cardPageArtworkIds(familyDialogueCardFixture(), designs)).toEqual([77]); expect(cardPageArtworkIds(familyDialogueCardFixture(), designs, true)).toEqual([77, 55]);
    const red = await prepareFamilyPageImage(source, designs.concept), blue = await prepareFamilyPageImage(source, { ...designs.concept, background: { ...designs.concept.background, focalX: 100 } });
    const sample = async (bytes: Buffer) => [...await sharp(bytes).extract({ left: 540, top: 675, width: 1, height: 1 }).raw().toBuffer()];
    expect((await sample(red))[0]).toBeGreaterThan(230); expect((await sample(blue))[2]).toBeGreaterThan(230);
    const contained = await prepareFamilyPageImage(source, { ...designs.concept, background: { ...designs.concept.background, fit: "contain", color: "#FFFFFF" } });
    const corner = [...await sharp(contained).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()];
    expect(corner.every(value => value > 240)).toBe(true);
    const dark = await prepareFamilyPageImage(source, { ...designs.concept, background: { ...designs.concept.background, brightness: 50 } });
    expect((await sample(dark))[0]).toBeLessThan((await sample(red))[0]);
  });

  it("renders eight real 4:5 JPEGs with the same local preview pixels, and refuses unknown brand or remote image assets", async () => {
    const copy = familyDialogueCardFixture(), plan = planCarousel(input(copy), style);
    expect(plan.family?.copy).toEqual(copy); expect(plan.count).toBe(8);
    const pages = await renderCarouselPages(plan, style, null, ""); expect(pages).toHaveLength(8);
    for (const page of pages) { expect(await sharp(page.bytes).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg", channels: 3 }); expect([...page.altText].length).toBeLessThanOrEqual(125); }
    const preview = await renderCarouselPage(plan, 4, style, null, ""); expect((await sharp(preview).raw().toBuffer()).equals(await sharp(pages[4].bytes).raw().toBuffer())).toBe(true);
    const outro = copy.pages[7]; if (outro.id !== "outro") throw new Error("outro required");
    await expect(renderFamilyDialogueCard({ ...outro, fields: { ...outro.fields, logoAssetId: "../../secrets" } }, defaultPageDesigns().outro, context, style)).rejects.toThrow("승인 목록");
    expect(() => layoutFamilyDialogueCard(copy.pages[0], defaultPageDesigns().cover, context, style, { imageDataUrl: "https://external.example/image.jpg" })).toThrow("서버에서 읽은 JPEG");
  });
});
