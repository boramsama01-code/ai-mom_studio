import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { zipSync } from "fflate";
import { decodeCanvaExport, downloadCanvaExport, publicationJpegs } from "../server/services/canvaEditorialAssets";
import { sha256 } from "../server/services/text";

let pngs: Buffer[];
beforeAll(async () => {
  pngs = await Promise.all(Array.from({ length: 8 }, (_, index) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: index * 25, g: 80, b: 150 } } }).png().toBuffer()));
});
describe("Canva page order and immutable publication derivatives", () => {
  it("uses the eight URLs' documented page order even when their paths are opaque or misleading", async () => {
    const urls = Array.from({ length: 8 }, (_, index) => `https://export-download.canva.com/opaque-${8 - index}-signed-token.bin`);
    const fetcher = vi.fn(async (url: string) => ({ body: pngs[urls.indexOf(url)] })) as any;
    const decoded = await downloadCanvaExport(urls, fetcher);
    expect(decoded.map(sha256)).toEqual(pngs.map(sha256));
    expect(fetcher.mock.calls.map(([url]: [string]) => url)).toEqual(urls);
  });
  it("sorts a numbered ZIP independently of archive entry order", async () => {
    const zip = zipSync(Object.fromEntries([...pngs.entries()].reverse().map(([index, png]) => [`export/page-${index + 1}.png`, png])));
    const decoded = await decodeCanvaExport([{ name: "opaque-export.zip", bytes: Buffer.from(zip) }]);
    expect(decoded.map(sha256)).toEqual(pngs.map(sha256));
  });
  it("rejects ambiguous ZIP names and duplicate page numbers instead of guessing", async () => {
    const ambiguous = zipSync(Object.fromEntries(pngs.map((png, index) => [`opaque-${String.fromCharCode(97 + index)}.png`, png])));
    await expect(decodeCanvaExport([{ name: "export.zip", bytes: Buffer.from(ambiguous) }])).rejects.toThrow("페이지 순서");
    const duplicate = pngs.map((bytes, index) => ({ name: index === 7 ? "other/page-1.png" : `page-${index + 1}.png`, bytes }));
    await expect(decodeCanvaExport(duplicate)).rejects.toThrow("페이지 순서");
  });
  it("rejects wrong page count, dimensions and unsafe hosts before creating final images", async () => {
    await expect(decodeCanvaExport(pngs.slice(0, 7).map((bytes, index) => ({ name: `${index + 1}.png`, bytes })))).rejects.toThrow("8장 대신 7개");
    const wrong = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#ffffff" } }).png().toBuffer();
    await expect(decodeCanvaExport(pngs.map((bytes, index) => ({ name: `${index + 1}.png`, bytes: index === 3 ? wrong : bytes })))).rejects.toThrow("4장의 실제 PNG 크기");
    const fetcher = vi.fn();
    await expect(downloadCanvaExport(["https://canva.com.attacker.invalid/output.zip"], fetcher as any)).rejects.toThrow("출력 주소");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("produces stable JPEG bytes once from each preserved PNG without text or AI rerendering", async () => {
    const before = pngs.map(sha256), first = await publicationJpegs(pngs), second = await publicationJpegs(pngs);
    expect(first.map(sha256)).toEqual(second.map(sha256)); expect(pngs.map(sha256)).toEqual(before);
    expect(new Set(first.map(sha256)).size).toBe(8);
    for (const jpeg of first) expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1350, space: "srgb" });
  });
});
