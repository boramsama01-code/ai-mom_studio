/** Rendered pixels and ZIP contents from local PNG fixtures; no AI or network. */
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createStudioRenderer } from "../server/services/studioExport";
import { studioContentSchema } from "../shared/studio";
import { zipFiles } from "../server/services/zip";

const colors = [[223, 28, 75], [31, 178, 94], [51, 88, 226], [243, 181, 33]];
const images = new Map<number, Buffer>();
const content = studioContentSchema.parse({ title: "저장 그림이 들어간 카드뉴스", format: "카드뉴스", characters: [], panels: colors.map((_, index) => ({ scene: `그림 ${index + 1}`, dialogue: `${index + 1}번째 본문입니다.`, imageId: 41 + index })) });
beforeAll(async () => {
  for (const [index, [r, g, b]] of colors.entries()) images.set(41 + index, await sharp({ create: { width: 128, height: 128, channels: 3, background: { r, g, b } } }).png().toBuffer());
});
async function coloredPixels(bytes: Buffer, target: number[]) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) if (target.every((value, channel) => Math.abs(data[index + channel] - value) < 18)) count++;
  return count;
}
describe("saved Studio art reaches every final output", () => {
  it.each(["editorial", "minimal", "spotlight", "set:n03", "set:r01", "set:f01"] as const)("retains all four distinct body images in %s", async exportDesign => {
    const output = createStudioRenderer({ ...content, exportDesign }, 7, "운영자가 정한 브랜드", "#285f6a", images);
    for (let index = 0; index < 4; index++) {
      const bytes = await output.page(index + 1);
      expect(await coloredPixels(bytes, colors[index]), `${exportDesign} body ${index + 1} must contain its own image pixels`).toBeGreaterThan(30_000);
      expect(await coloredPixels(bytes, colors[(index + 1) % 4])).toBeLessThan(1_000);
    }
  }, 20_000);
  it("retains four drawings in a comic and the same body image in a readable carousel ZIP", async () => {
    const comic = createStudioRenderer({ ...content, format: "웹툰" }, 7, "내 채널", "#285f6a", images);
    const comicBytes = await comic.page(0);
    for (const color of colors) expect(await coloredPixels(comicBytes, color)).toBeGreaterThan(30_000);
    const carousel = createStudioRenderer(content, 7, "내 채널", "#285f6a", images);
    const files = await Promise.all(Array.from({ length: carousel.pageCount }, async (_, index) => ({ name: `page-${String(index + 1).padStart(2, "0")}.png`, bytes: await carousel.page(index) })));
    const archive = zipFiles(files);
    const body = execFileSync("python3", ["-c", "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; sys.stdout.buffer.write(z.read('page-03.png'))"], { input: archive, maxBuffer: 8 * 1024 * 1024 });
    expect(await coloredPixels(body, colors[1])).toBeGreaterThan(30_000);
  }, 20_000);
  it("fails a missing stored drawing explicitly rather than silently producing a text-only body", async () => {
    const output = createStudioRenderer(content, 7, "내 채널", "#285f6a", new Map());
    await expect(output.page(1)).rejects.toThrow("그림을 찾을 수 없습니다");
  });
});
