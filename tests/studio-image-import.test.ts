import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { studioContentSchema } from "../shared/studio";
import { studioChatGptImagePrompt, studioImageFileError, STUDIO_IMAGE_MAX_BYTES } from "../shared/studioImageImport";
import { normalizeStudioImage } from "../server/services/studioImageImport";

describe("ChatGPT 이미지 가져오기", () => {
  it("실제 채널·컷·캐릭터·추가 요청을 복사하며 비공개 메모는 제외한다", () => {
    const content = studioContentSchema.parse({ title: "감자 연구", memo: "비공개 메모", characters: ["penguin"], panels: Array.from({ length: 4 }, (_, i) => ({ scene: `내 장면 ${i + 1}`, dialogue: `대사 ${i + 1}` })) });
    const prompt = studioChatGptImagePrompt(content, 2, "내가 바꾼 채널명", "배경은 연구실");
    for (const phrase of ["내가 바꾼 채널명", "3번째 한 컷만", "내 장면 3", "대사 3", "펭긴", "배경은 연구실", "4:3", "말풍선·대사·자막", "원본 첨부를 요청"]) expect(prompt).toContain(phrase);
    expect(prompt).not.toContain("비공개 메모");
    expect(studioChatGptImagePrompt({ ...content, characters: [] }, 0, "채널")).not.toContain("펭긴");
    expect(() => studioChatGptImagePrompt(content, 4, "채널")).toThrow();
  });
  it("빈 파일·비이미지·용량 초과를 업로드 전에 안내한다", () => {
    expect(studioImageFileError({ type: "image/png", size: STUDIO_IMAGE_MAX_BYTES })).toBeNull();
    expect(studioImageFileError({ type: "image/png", size: STUDIO_IMAGE_MAX_BYTES + 1 })).toContain("12MB");
    expect(studioImageFileError({ type: "image/svg+xml", size: 100 })).toContain("PNG");
    expect(studioImageFileError({ type: "image/png", size: 0 })).toContain("비어");
  });
  it("JPEG·WebP를 안전한 PNG로 바꾸고 크기·회전·메타데이터를 정규화한다", async () => {
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#285f6a" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const normalized = await normalizeStudioImage(jpeg);
    const meta = await sharp(normalized).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 1024, 2048]);
    expect(meta.exif).toBeUndefined(); expect(meta.orientation).toBeUndefined();
    const webp = await sharp({ create: { width: 40, height: 30, channels: 4, background: "#ffffff00" } }).webp().toBuffer();
    expect((await sharp(await normalizeStudioImage(webp)).metadata()).format).toBe("png");
  });
  it("확장자를 위장한 파일·SVG·과도한 픽셀 수는 저장하지 않는다", async () => {
    for (const bytes of [Buffer.from("not an image"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'), Buffer.alloc(0)]) {
      await expect(normalizeStudioImage(bytes)).rejects.toMatchObject({ status: 400 });
    }
    const huge = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "white" } }).png().toBuffer();
    await expect(normalizeStudioImage(huge)).rejects.toMatchObject({ status: 400 });
    await expect(normalizeStudioImage(Buffer.alloc(STUDIO_IMAGE_MAX_BYTES + 1))).rejects.toMatchObject({ status: 413 });
  });
});

