import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { checkStudioExport, createStudioRenderer } from "../server/services/studioExport";
import { zipFiles } from "../server/services/zip";
import { studioContentSchema } from "../shared/studio";
import { moveVisibleChannel, reconcileChannelOrder } from "../shared/channelDirectory";

const content = () => studioContentSchema.parse({ title: "과학을 즐기는 네 가지 방법", format: "카드뉴스", sourceLabel: "자료: 직접 작성 · 2026.10.23", panels: Array.from({ length: 4 }, (_, i) => ({ scene: "", dialogue: `${i + 1}. 매일 작은 질문을 하나 적어 보세요. 관찰에서 이야기가 시작됩니다.` })) });

describe("Studio output", () => {
  it("preflights empty bodies, overflow and unsupported formats before rendering", () => {
    expect(checkStudioExport(content()).errors).toEqual([]);
    const long = content(); long.panels[1].dialogue = "아주 긴 본문입니다. ".repeat(180);
    expect(checkStudioExport(long).errors.some(e => e.field === "panels.1.dialogue")).toBe(true);
    const empty = studioContentSchema.parse({ title: "빈 카드" });
    expect(checkStudioExport(empty).errors.filter(e => e.field.startsWith("panels"))).toHaveLength(4);
    expect(checkStudioExport({ ...content(), format: "릴스" }).errors[0].field).toBe("format");
    expect(checkStudioExport({ ...content(), title: "제목 🪐" }).errors.some(e => e.field === "text")).toBe(true);
  });
  it("renders three distinct templates and text-only comics at 1080×1350", async () => {
    const rendered: Buffer[] = [];
    for (const exportDesign of ["editorial", "spotlight", "minimal"] as const) {
      const output = createStudioRenderer({ ...content(), exportDesign }, 1, "과학대화", "#285f6a");
      const bytes = await output.page(0);
      const info = await sharp(bytes).metadata();
      expect([info.width, info.height, info.format]).toEqual([1080, 1350, "png"]);
      rendered.push(bytes);
    }
    expect(new Set(rendered.map(b => b.toString("base64"))).size).toBe(3);
    const comic = createStudioRenderer({ ...content(), format: "웹툰" }, 1, "과학대화", "#285f6a");
    expect(comic.pageCount).toBe(1);
    expect((await sharp(await comic.page(0)).metadata()).width).toBe(1080);
    await expect(comic.page(1)).rejects.toThrow("페이지");
  });
  it("produces six ordered PNG pages and a lossless UTF-8 caption in an independently readable ZIP", async () => {
    const output = createStudioRenderer(content(), 2, "과학대화", "#285f6a");
    const files = [];
    for (let i = 0; i < output.pageCount; i++) files.push({ name: `page-0${i + 1}.png`, bytes: await output.page(i) });
    files.push({ name: "caption.txt", bytes: Buffer.from("직접 쓴 한글 캡션\n#과학", "utf8") });
    const archive = zipFiles(files);
    // Python's independent ZIP reader checks directory offsets, lengths and CRCs.
    const report = JSON.parse(execFileSync("python3", ["-c", "import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'names':z.namelist(),'bad':z.testzip(),'caption':z.read('caption.txt').decode('utf8'),'pngs':[z.read(n)[:8].hex() for n in z.namelist() if n.endswith('.png')]}))"], { input: archive }).toString());
    expect(report.names).toEqual([...Array.from({ length: 6 }, (_, i) => `page-0${i + 1}.png`), "caption.txt"]);
    expect(report.bad).toBeNull(); expect(report.caption).toBe("직접 쓴 한글 캡션\n#과학");
    expect(report.pngs).toEqual(Array(6).fill("89504e470d0a1a0a"));
  });
});

describe("recoverable channel order", () => {
  it("preserves the draft order, removes missing IDs, and appends newly added channels", () => {
    expect(reconcileChannelOrder([3, 1, 2, 3], [1, 3, 4])).toEqual([3, 1, 4]);
  });
  it("moves visible channels without discarding or moving archived entries", () => {
    expect(moveVisibleChannel([1, 9, 2, 3], [1, 2, 3], 3, 0)).toEqual([3, 9, 1, 2]);
  });
});
