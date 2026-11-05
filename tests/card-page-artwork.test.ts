import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { setTestEnv } from "./helpers";

setTestEnv();
const { CARD_PAGE_UPLOAD_MAX_BYTES, decodeCardPageUpload, normalizeCardPageArtwork } = await import("../server/services/cardPageArtwork");
const outbound = vi.fn(() => { throw new Error("Page artwork validation must not contact external services"); });
beforeAll(() => vi.stubGlobal("fetch", outbound));
afterAll(() => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("page background upload decoding", () => {
  it("decodes PNG, JPEG and WebP pixels into metadata-free JPEGs", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const bytes = await sharp({ create: { width: 80, height: 100, channels: 4, background: "#426f88aa" } })
        .withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
      const mime = `image/${format}`;
      const result = await decodeCardPageUpload(`data:${mime};base64,${bytes.toString("base64")}`);
      const info = await sharp(result.bytes).metadata();
      expect(result.mime).toBe("image/jpeg");
      expect(info.format).toBe("jpeg");
      expect(info.width).toBe(result.width);
      expect(info.height).toBe(result.height);
      expect(info.exif).toBeUndefined();
      expect(info.xmp).toBeUndefined();
      expect(info.orientation).toBeUndefined();
      expect(info.hasAlpha).toBe(false);
    }
  });

  it("does not fetch arbitrary URLs or accept SVG, mislabeled data or invalid base64", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#50715c" } }).png().toBuffer();
    for (const value of [
      "https://127.0.0.1/private.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
      `data:image/jpeg;base64,${png.toString("base64")}`,
      "data:image/png;base64,abcd-_-_",
      "data:image/png;base64,abc",
      "data:image/png;base64,SGVsbG8=",
    ]) await expect(decodeCardPageUpload(value)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects oversized raw uploads and implausible dimensions before saving", async () => {
    await expect(normalizeCardPageArtwork(Buffer.alloc(CARD_PAGE_UPLOAD_MAX_BYTES + 1))).rejects.toMatchObject({ status: 413 });
    const tooWide = await sharp({ create: { width: 17000, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    await expect(normalizeCardPageArtwork(tooWide)).rejects.toMatchObject({ status: 400 });
    await expect(decodeCardPageUpload(`data:image/png;base64,${Buffer.alloc(CARD_PAGE_UPLOAD_MAX_BYTES + 1).toString("base64")}`)).rejects.toMatchObject({ status: 413 });
  });

  it("limits stored resolution without changing the aspect ratio", async () => {
    const bytes = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#3a5e71" } }).png().toBuffer();
    const normalized = await normalizeCardPageArtwork(bytes, "image/png");
    expect([normalized.width, normalized.height]).toEqual([1600, 800]);
  });
});
