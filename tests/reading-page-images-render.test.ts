/** Local preparation and rendering boundaries only; no live Canva or image-generation requests. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { DB } from "../server/db";
import type { CardModel } from "../server/services/card";
import { defaultPageDesigns } from "../shared/familyDialogue";
import { readingProfileDesigns, readingProfileForTemplateKey, READING_PROFILE_LOGO_ID } from "../shared/readingCardProfiles";
import { resolvedReadingPageDesigns } from "../shared/readingPageImages";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { prepareReadingArtwork } from "../server/services/readingCardImages";
import { prepareCanvaImages } from "../server/services/canvaEditorialAssets";
import { renderCarouselPage, renderCarouselPages, type CarouselPlan } from "../server/services/cardCarousel";
import * as readingRenderer from "../server/services/readingCard";

const assets = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../server/services/cardPageArtwork", () => ({ loadCardPageArtworkAsset: assets.load }));
const photos = new Map<number, Buffer>();
const base: CardModel = { accent: "#102D44", brandLine: "테스트", badge: "", title: "사진 상속", blocks: [], footer: "" };
function fixture() {
  const copy = familyDialogueCardFixture(), profile = readingProfileForTemplateKey("cardnews14-swiss-modernism-v1")!;
  copy.templateKey = profile.templateKey;
  const outro = copy.pages[7]; if (outro.id === "outro") outro.fields.logoAssetId = READING_PROFILE_LOGO_ID;
  const designs = readingProfileDesigns(profile, defaultPageDesigns());
  designs.cover.background = { ...designs.cover.background, kind: "image", assetId: 101 };
  designs.implication.background = { ...designs.implication.background, inheritCover: true, focalX: 80, focalY: 0, brightness: 70, overlay: 15 };
  designs.discussion.background = { ...designs.discussion.background, kind: "image", assetId: 202, inheritCover: true };
  designs.activity.background.inheritCover = true;
  const plan: CarouselPlan = { base, pages: Array.from({ length: 7 }, () => base), count: 8, family: { copy, designs, context: { brandName: "ALLligodang", accent: "#102D44" } } };
  return { copy, profile, designs, plan };
}
beforeEach(async () => {
  assets.load.mockReset(); photos.clear();
  photos.set(101, await sharp({ create: { width: 80, height: 120, channels: 3, background: "#ca7629" } }).png().toBuffer());
  photos.set(202, await sharp({ create: { width: 120, height: 80, channels: 3, background: "#244e73" } }).png().toBuffer());
  assets.load.mockImplementation(async (_db: DB, itemId: number, channelId: number, assetId: number) => {
    expect([itemId, channelId]).toEqual([10, 20]); expect(photos.has(assetId)).toBe(true); return { bytes: photos.get(assetId)! };
  });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external calls in photo inheritance tests"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("inherited image selection across local and Canva output", () => {
  it("prepares Canva's inherited slot from the same source and target design used for local preparation", async () => {
    const { copy, profile, designs } = fixture(), before = structuredClone(designs);
    const images = await prepareCanvaImages({} as DB, { itemId: 10, channelId: 20, copy, pageDesigns: designs, profile });
    expect(assets.load.mock.calls.map(call => call[3])).toEqual([101, 101, 202, 101]);
    const target = profile.images.find(slot => slot.pageId === "implication")!;
    const expected = await prepareReadingArtwork(photos.get(101)!, resolvedReadingPageDesigns(copy, designs).implication, target, profile.pages[2].background);
    expect(images.find(image => image.field === "P03_BACKGROUND_IMAGE")!.bytes.equals(expected)).toBe(true);
    expect(images.find(image => image.field === "P08_PROFILE_IMAGE")!.hash).toBe(profile.profileImageSha256);
    expect(designs).toEqual(before);
  });
  it("passes the actual inherited/overridden bytes and their credits to the local renderer and accessibility text input", async () => {
    const { plan } = fixture();
    const render = vi.spyOn(readingRenderer, "renderReadingCard").mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const text = vi.spyOn(readingRenderer, "readingPageText");
    const pageImages = Object.assign(new Map(photos), { credits: new Map([[101, "AI 일러스트 · OpenAI"], [202, "직접 등록 이미지"]]) });
    await renderCarouselPage(plan, 2, { layout: "minimal" }, null, "", pageImages);
    expect(render.mock.calls[0][2].background).toMatchObject({ assetId: 101, focalX: 80, focalY: 0, brightness: 70, overlay: 15 });
    expect(render.mock.calls[0][4]).toBe(photos.get(101)); expect(render.mock.calls[0][5]).toBe("AI 일러스트 · OpenAI");
    render.mockClear();
    const output = await renderCarouselPages(plan, { layout: "minimal" }, null, "", pageImages);
    expect(render.mock.calls[3][4]).toBe(photos.get(202)); expect(render.mock.calls[3][5]).toBe("직접 등록 이미지");
    expect(render.mock.calls[6][4]).toBe(photos.get(101)); expect(render.mock.calls[6][5]).toBe("AI 일러스트 · OpenAI");
    expect(render.mock.calls[7][4]).toBeNull(); expect(render.mock.calls[7][5]).toBe("");
    // conciseAlt intentionally keeps a short summary. Its source must still be
    // the same visible copy/credit as the page, before that length reduction.
    expect(text.mock.calls.find(call => call[1].id === "discussion")?.[2]).toMatchObject({ imageCredit: "직접 등록 이미지" });
    expect(text.mock.calls.find(call => call[1].id === "activity")?.[2]).toMatchObject({ imageCredit: "AI 일러스트 · OpenAI" });
    expect(output).toHaveLength(8);
  });
});
