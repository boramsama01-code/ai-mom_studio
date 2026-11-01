import { describe, expect, it } from "vitest";
import { studioTextOutputSchema } from "../server/services/studioAi";
import { studioContentSchema } from "../shared/studio";
import { applyStudioText, studioChangedTextFields } from "../shared/studioWorkflow";
const output = { title: "제목", script: "전체 원고", caption: "게시용 캡션", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `${i + 1}컷 장면`, dialogue: `${i + 1}컷 대사` })) };
describe("complete webtoon AI fields", () => {
  it("maps all ten blank writing fields independently and preserves planning, channel, title and images", () => {
    const before = studioContentSchema.parse({ title: "사용자 제목", memo: "비공개 기획", channel: "penguin", dueDate: "2026-11-02", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: 21 })) });
    const parsed = studioTextOutputSchema("웹툰").parse(output);
    const after = applyStudioText(before, parsed, "fill");
    expect(after).toMatchObject({ title: before.title, memo: before.memo, channel: before.channel, dueDate: before.dueDate, script: output.script, caption: output.caption });
    expect(after.panels).toEqual(output.panels.map(p => ({ ...p, imageId: 21 })));
    expect(studioChangedTextFields(before, after)).toEqual(["전체 원고", "게시용 캡션", "1컷 장면", "1컷 대사", "2컷 장면", "2컷 대사", "3컷 장면", "3컷 대사", "4컷 장면", "4컷 대사"]);
  });
  it("rejects caption-only success and any missing scene or dialogue", () => {
    expect(studioTextOutputSchema("웹툰").safeParse({ ...output, script: " ", panels: output.panels.map(() => ({ scene: "", dialogue: "" })) }).success).toBe(false);
    for (let i = 0; i < 4; i++) for (const key of ["scene", "dialogue"]) {
      expect(studioTextOutputSchema("웹툰").safeParse({ ...output, panels: output.panels.map((p, n) => n === i ? { ...p, [key]: " " } : p) }).success).toBe(false);
    }
    expect(studioTextOutputSchema("웹툰").safeParse({ ...output, panels: output.panels.slice(0, 3) }).success).toBe(false);
  });
  it("keeps optional panels for other writing formats", () => {
    expect(studioTextOutputSchema("릴스").safeParse({ ...output, panels: output.panels.map(() => ({ scene: "", dialogue: "" })) }).success).toBe(true);
  });
});
