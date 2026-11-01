import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readCardNewsZip } from "../shared/zipImport";
const bytes = new Uint8Array([1, 2, 3]);
describe("finished cardnews archive recognition", () => {
  it("groups five Korean folders into 27 ordered pages and attaches the matching caption", () => {
    const files: Record<string, Uint8Array> = {};
    const names = ["김펭귄", "김펭키", "김펭펭", "펨펨", "우주펭귄상회_탄생기"];
    const captions: string[] = [];
    names.forEach((n, i) => {
      for (let p = i === 4 ? 7 : 5; p > 0; p--) files[`우주/0${i + 1}_${n}/${String(p).padStart(2, "0")}.png`] = bytes;
      captions.push(`[0${i + 1} ${n.replaceAll("_", " ")}]\n${n}의 게시글\n\n#우주펭귄상회`);
    });
    files["우주/게시글_초안.txt"] = strToU8(captions.join("\n\n"));
    files["우주/README.md"] = strToU8("최종 캐릭터 설정");
    files["우주/제작자료/plan.json"] = bytes;
    const result = readCardNewsZip(zipSync(files));
    expect(result.pageCount).toBe(27); expect(result.posts.map(p => p.pages.length)).toEqual([5, 5, 5, 5, 7]);
    expect(result.posts[4].title).toBe("우주펭귄상회 탄생기");
    result.posts.forEach((p, i) => { expect(p.caption).toContain(`${names[i]}의 게시글`); expect(p.pages[0].name).toMatch(/01.png$/); });
    expect(result.notes).toBe("최종 캐릭터 설정"); expect(result.ignored).toBe(1);
  });
  it("sorts 2 before 10 and reads a flat caption.txt", () => {
    const parsed = readCardNewsZip(zipSync({ "10.png": bytes, "2.png": bytes, "caption.txt": strToU8("원본 캡션") }));
    expect(parsed.posts[0].pages.map(p => p.name)).toEqual(["2.png", "10.png"]); expect(parsed.posts[0].caption).toBe("원본 캡션");
  });
  it("keeps numeric-only folder names and years that are part of the title", () => {
    const parsed = readCardNewsZip(zipSync({ "01/1.png": bytes, "2026년_이야기/1.png": bytes }));
    expect(parsed.posts.map(p => p.title)).toEqual(["01", "2026년 이야기"]);
  });
  it("ignores macOS metadata and rejects traversal, unsupported archive and an 11-page folder", () => {
    expect(readCardNewsZip(zipSync({ "1.png": bytes, "__MACOSX/._1.png": bytes })).pageCount).toBe(1);
    for (const name of ["../1.png", "/1.png", "C:/1.png", "a/../1.png", "a\\1.png"]) expect(() => readCardNewsZip(zipSync({ [name]: bytes }))).toThrow(/경로/);
    expect(() => readCardNewsZip(bytes)).toThrow(/ZIP/);
    expect(() => readCardNewsZip(zipSync(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${i}.png`, bytes]))))).toThrow(/11장/);
  });
  it("rejects overlarge decompressed entries before allocation", () => {
    const zip = zipSync({ "1.png": bytes });
    const central = zip.findIndex((_, i) => zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 1 && zip[i + 3] === 2);
    new DataView(zip.buffer).setUint32(central + 24, 1000_000_000, true);
    expect(() => readCardNewsZip(zip)).toThrow(/12MB/);
  });
});
