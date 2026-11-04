/** Synthetic contracts and local approved assets only. No live Canva master,
 * capability, field registration, Autofill or export is asserted by these tests. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { DB } from "../server/db";
import {
  CANVA_APPROVED_PARENT_LOGO, CANVA_MAPPING_VERSION, canvaDisplaySupportErrors,
  canvaTextFields, canvaVariant, expectedCanvaDataset, validateCanvaDataset,
  snapshotCanvaProfile, storedCanvaProfileSnapshot, resolveCanvaProfile,
} from "../shared/canvaEditorial";
import { defaultPageDesigns } from "../shared/familyDialogue";
import { READING_PROFILE_LOGO_ID, readingProfileDesigns, readingProfileForTemplateKey } from "../shared/readingCardProfiles";
import { familyDialogueCardFixture, scientificFamilyCardFixture } from "./fixtures/familyDialogueCard";
import { assertCanvaDesignSettings, prepareCanvaImages } from "../server/services/canvaEditorialAssets";
import { prepareReadingArtwork } from "../server/services/readingCardImages";
import { sha256 } from "../server/services/text";

const assets = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../server/services/cardPageArtwork", () => ({ loadCardPageArtworkAsset: assets.load }));
const profileIds = ["reading-ink-lime-v1", "reading-cobalt-paper-v1"] as const;
function fixture(id: typeof profileIds[number] = profileIds[0], scientific = false) {
  const profile = readingProfileForTemplateKey(id);
  if (!profile) throw new Error("Reading profile fixture missing");
  const copy = scientific ? scientificFamilyCardFixture() : familyDialogueCardFixture();
  copy.templateKey = profile.templateKey;
  const outro = copy.pages.find(page => page.id === "outro");
  if (!outro) throw new Error("Outro fixture missing");
  outro.fields.logoAssetId = READING_PROFILE_LOGO_ID;
  return { profile, copy, designs: readingProfileDesigns(profile, defaultPageDesigns()) };
}
beforeEach(() => { assets.load.mockReset(); });

describe("reading Canva contract without live readiness claims", () => {
  it.each(profileIds)("keeps the %s contract at 46 native texts and four independent images", id => {
    const { copy, profile } = fixture(id), dataset = expectedCanvaDataset(canvaVariant(copy), profile);
    expect(Object.entries(dataset).filter(([, value]) => value.type === "text")).toHaveLength(46);
    expect(Object.entries(dataset).filter(([, value]) => value.type === "image").map(([name]) => name)).toEqual([
      "P01_COVER_IMAGE", "P04_CONTEXT_IMAGE", "P07_ACTIVITY_IMAGE", "P08_PROFILE_IMAGE",
    ]);
    expect(validateCanvaDataset(dataset, canvaVariant(copy), profile)).toEqual([]);
    expect(canvaDisplaySupportErrors(copy, dataset, true, profile)).toEqual([]);
    const text = canvaTextFields(copy, { profile, dataset, requireDisplayFields: true });
    expect(Object.keys(text)).toHaveLength(46);
    expect(text).not.toHaveProperty("P01_HEADER_BRAND");
    expect(text).not.toHaveProperty("P02_FACTS");
    expect(dataset).not.toHaveProperty("P02_BACKGROUND");
    expect(text.P02_KICKER.text).toBe("뉴스 읽기");
    expect(text.P04_KICKER.text).toBe("STEP 1");
  });
  it("requires every actual native field and rejects another profile's labels", () => {
    const { copy, profile } = fixture(), variant = canvaVariant(copy);
    const missing = expectedCanvaDataset(variant, profile);
    delete missing.P08_PROFILE_IMAGE;
    expect(validateCanvaDataset(missing, variant, profile)).toContain("P08_PROFILE_IMAGE: 필드 없음");
    const wrong = expectedCanvaDataset(variant, profile); wrong.P02_READING_BODY = { type: "image" };
    expect(validateCanvaDataset(wrong, variant, profile)).toContain("P02_READING_BODY: text 형식 필요");
    const extra = expectedCanvaDataset(variant, profile); extra.P01_IMAGE = { type: "image" };
    expect(validateCanvaDataset(extra, variant, profile)).toContain("P01_IMAGE: 선택한 읽기 디자인에 없는 필드");
  });
  it("uses current semantic text, preserves an explicit empty source, and rejects a hidden nonempty header", () => {
    const { copy, profile } = fixture(), dataset = expectedCanvaDataset(canvaVariant(copy), profile);
    const cover = copy.pages.find(page => page.id === "cover")!;
    cover.fields.headline = "직접 고친 현재 제목";
    copy.pages[1].displayOverrides = { sourceCredit: "" };
    const options = { profile, dataset, requireDisplayFields: true, context: { sourceCredit: "출처: 기존 기본값" } };
    expect(canvaTextFields(copy, options).P01_HEADLINE.text).toBe("직접 고친 현재 제목");
    expect(canvaTextFields(copy, options).P02_SOURCE.text).toBe("");
    cover.displayOverrides = { brandName: "이 디자인에는 없는 상단 표기" };
    expect(() => canvaTextFields(copy, options)).toThrow("표시 칸이 없습니다");
    cover.displayOverrides = { brandName: "" };
    expect(() => canvaTextFields(copy, options)).not.toThrow();
  });
  it("keeps scientific definitions and the selected external activity in the V2 reading adapter", () => {
    const { copy, profile } = fixture(profileIds[1], true), before = structuredClone(copy);
    const concept = copy.pages.find(page => page.id === "concept")!;
    const activity = copy.pages.find(page => page.id === "activity")!;
    if (concept.fields.mode !== "scientific_explanation") throw new Error("Scientific fixture missing");
    activity.fields.optionalActivity = { label: "검증한 선택 자료", action: "근거 한 가지를 비교해요.", resourceId: "R1" };
    const output = canvaTextFields(copy, { profile, dataset: expectedCanvaDataset(canvaVariant(copy), profile) });
    expect(output.P06_DEFINITION_A.text).toBe(concept.fields.acceptedDefinition);
    expect(output.P06_DEFINITION_B.text).toBe(concept.fields.exampleOrNonExample);
    expect(output.P07_ACTIVITY_ACTIONS.text).toContain(activity.fields.homeActivity.action);
    expect(output.P07_ACTIVITY_ACTIONS.text).toContain(activity.fields.optionalActivity.label);
    expect(output.P07_ACTIVITY_ACTIONS.text).toContain(activity.fields.optionalActivity.action);
    expect(copy.pages[5]).toEqual(before.pages[5]);
  });
  it("leaves the legacy adapter and dataset contract available", () => {
    const copy = familyDialogueCardFixture(), variant = canvaVariant(copy), legacy = expectedCanvaDataset(variant);
    expect(validateCanvaDataset(legacy, variant)).toEqual([]);
    expect(legacy).toHaveProperty("P01_IMAGE");
    expect(legacy).toHaveProperty("P08_LOGO");
    expect(canvaTextFields(copy)).toHaveProperty("P02_FACTS");
    expect(canvaTextFields(copy)).not.toHaveProperty("P02_READING_BODY");
    expect(resolveCanvaProfile({ mappingVersion: CANVA_MAPPING_VERSION })).toBeUndefined();
    expect(resolveCanvaProfile({ mappingVersion: "historical-legacy-mapping" })).toBeUndefined();
  });
  it("pins the profile, mapping, template and approved image across import/recovery snapshots", () => {
    const { profile } = fixture(), snapshot = snapshotCanvaProfile(profile);
    expect(storedCanvaProfileSnapshot(snapshot)).toEqual(snapshot);
    expect(resolveCanvaProfile(snapshot)?.id).toBe(profile.id);
    for (const changed of [
      { profileId: "reading-unavailable" },
      { profileTemplateVersion: "newer-template" },
      { mappingVersion: "newer-mapping" },
      { profileImageSha256: "0".repeat(64) },
    ]) expect(() => resolveCanvaProfile({ ...snapshot, ...changed })).toThrow("버전");
  });
});

describe("reading Canva image preparation", () => {
  it.each(profileIds)("uses the %s palette and layout without weakening the legacy layout guard", id => {
    const { profile, designs } = fixture(id);
    expect(() => assertCanvaDesignSettings(designs, profile)).not.toThrow();
    expect(() => assertCanvaDesignSettings(designs)).toThrow("중앙 정렬");
    expect(() => assertCanvaDesignSettings(defaultPageDesigns())).not.toThrow();
    designs.cover.alignment = "center";
    expect(() => assertCanvaDesignSettings(designs, profile)).toThrow();
  });
  it("maps three owned Studio photos to the real slot dimensions and uploads the approved original logo", async () => {
    const { copy, profile, designs } = fixture();
    const photos = new Map<number, Buffer>();
    for (const [id, pageId] of [[101, "cover"], [102, "discussion"], [103, "activity"]] as const) {
      const raw = Buffer.from(Array.from({ length: 64 * 48 * 3 }, (_, index) => {
        const pixel = Math.floor(index / 3), channel = index % 3;
        return channel === 0 ? pixel % 64 * 4 : channel === 1 ? Math.floor(pixel / 64) * 5 : id;
      }));
      photos.set(id, await sharp(raw, { raw: { width: 64, height: 48, channels: 3 } }).png().toBuffer());
      designs[pageId].background = { ...designs[pageId].background, kind: "image", assetId: id, fit: "cover", focalX: 100, focalY: 0, brightness: 130, overlay: 20 };
    }
    assets.load.mockImplementation(async (_db: DB, itemId: number, channelId: number, assetId: number) => {
      expect([itemId, channelId]).toEqual([10, 20]);
      return { bytes: photos.get(assetId)! };
    });
    const images = await prepareCanvaImages({} as DB, { itemId: 10, channelId: 20, copy, pageDesigns: designs, profile });
    expect(images.map(image => image.field)).toEqual(["P01_COVER_IMAGE", "P04_CONTEXT_IMAGE", "P07_ACTIVITY_IMAGE", "P08_PROFILE_IMAGE"]);
    expect(assets.load).toHaveBeenCalledTimes(3);
    for (const slot of profile.images.filter(slot => slot.kind === "artwork")) {
      const design = designs[slot.pageId], image = images.find(image => image.field === slot.field)!;
      const meta = await sharp(image.bytes).metadata();
      expect([meta.width, meta.height]).toEqual([slot.width, slot.height]);
      const pageIndex = copy.pages.findIndex(page => page.id === slot.pageId);
      const samePreviewBytes = await prepareReadingArtwork(photos.get(design.background.assetId!)!, design, slot, profile.pages[pageIndex].background);
      expect(image.bytes.equals(samePreviewBytes)).toBe(true);
      expect(image.hash).toBe(sha256(image.bytes));
    }
    const logo = images.find(image => image.field === "P08_PROFILE_IMAGE")!;
    expect(logo.hash).toBe(profile.profileImageSha256);
    expect(sha256(logo.bytes)).toBe(profile.profileImageSha256);
  });
  it("rejects a substituted profile file or legacy logo before preparing any article photograph", async () => {
    const { copy, profile, designs } = fixture();
    await expect(prepareCanvaImages({} as DB, { itemId: 10, channelId: 20, copy, pageDesigns: designs,
      profile: { ...profile, profileImageSha256: "0".repeat(64) },
    })).rejects.toMatchObject({ status: 422, extra: { code: "canva_profile_asset_changed" } });
    const outro = copy.pages.find(page => page.id === "outro")!;
    outro.fields.logoAssetId = CANVA_APPROVED_PARENT_LOGO;
    await expect(prepareCanvaImages({} as DB, { itemId: 10, channelId: 20, copy, pageDesigns: designs, profile }))
      .rejects.toMatchObject({ status: 422, extra: { code: "canva_profile_asset_mismatch" } });
    expect(assets.load).not.toHaveBeenCalled();
  });
});

