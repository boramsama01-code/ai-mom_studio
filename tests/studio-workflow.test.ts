import { describe, expect, it } from "vitest";
import { studioContentSchema, studioGenerationSchema } from "../shared/studio";
import { applyStudioText, studioCaptionDraft, studioImageContext, studioInstruction } from "../shared/studioWorkflow";

const requestId = "7e6cfc80-83cc-4ff3-9ddf-4bde812122cd";
const content = () => studioContentSchema.parse({ title: "왜 나만", memo: "비공개 참고 자료", script: "직접 쓴 원고", caption: "내 캡션", panels: [
  { scene: "창가에 앉은 펨펨", dialogue: "왜 나만?", imageId: 42 },
  { scene: "", dialogue: "내가 쓴 두 번째 대사", imageId: 43 },
  { scene: "세 번째 장면", dialogue: "", imageId: null },
  { scene: "", dialogue: "", imageId: null },
] });
const draft = { title: "바뀐 제목", script: "새 원고", caption: "새 캡션", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `새 장면 ${i}`, dialogue: `새 대사 ${i}` })) };

describe("작성에서 제작으로 이어지는 작업 흐름", () => {
  it("직접 컷 제작·빈칸 작성·캡션 작성에는 별도 지시가 필요 없다", () => {
    for (const action of [{ kind: "image", panelIndex: 0 }, { kind: "text", textTarget: "fill" }, { kind: "text", textTarget: "caption" }]) {
      const parsed = studioGenerationSchema.parse({ version: 1, requestId, ...action });
      expect(parsed.instruction).toBe("");
      expect(studioInstruction(parsed).length).toBeGreaterThan(10);
    }
    expect(studioGenerationSchema.safeParse({ version: 1, requestId, kind: "text" }).success).toBe(false);
  });
  it("빈칸 채우기는 사용자가 쓴 내용·그림을 필드별로 보존한다", () => {
    const original = content();
    const result = applyStudioText(original, draft, "fill");
    expect(result.title).toBe(original.title);
    expect(result.script).toBe(original.script);
    expect(result.caption).toBe(original.caption);
    expect(result.panels[0]).toEqual(original.panels[0]);
    expect(result.panels[1]).toEqual({ scene: "새 장면 1", dialogue: "내가 쓴 두 번째 대사", imageId: 43, poseRefs: [] });
    expect(result.panels[2]).toEqual({ scene: "세 번째 장면", dialogue: "새 대사 2", imageId: null, poseRefs: [] });
    expect(result.panels[3]).toEqual({ ...draft.panels[3], imageId: null, poseRefs: [] });
    expect(result.memo).toBe(original.memo);
    expect(original.panels[1].scene).toBe("");
  });
  it("전체 수정은 기존 동작을 유지하고 변경된 장면의 그림만 분리한다", () => {
    const original = content();
    const result = applyStudioText(original, { ...draft, panels: draft.panels.map((p, i) => i === 0 ? { ...p, scene: original.panels[0].scene } : p) }, "rewrite");
    expect(result.title).toBe(draft.title);
    expect(result.panels[0].imageId).toBe(42);
    expect(result.panels[1].imageId).toBe(null);
  });
  it("기본 캡션은 대사·원고에서만 제안하며 기획 메모를 게시 글에 넣지 않는다", () => {
    const original = content();
    expect(studioCaptionDraft(original)).toBe("왜 나만\n\n왜 나만?\n\n내가 쓴 두 번째 대사");
    expect(studioCaptionDraft(original)).not.toContain(original.memo);
    const empty = studioContentSchema.parse({ title: "주제", memo: "비공개" });
    expect(studioCaptionDraft(empty)).toBe("");
    expect(studioCaptionDraft({ ...empty, script: "내 원고" })).toBe("주제\n\n내 원고");
    expect(studioCaptionDraft({ ...empty, script: "긴 원고".repeat(5000) }).length).toBeLessThanOrEqual(8000);
  });
  it("그림 지시에 작성한 대사를 반영하고 최대 길이의 네 컷도 요청 한도를 넘지 않는다", () => {
    const original = content();
    expect(studioImageContext(original, 0)).toContain("왜 나만?");
    expect(studioImageContext(original, 0)).toContain("그림에 글자로 넣지 않음");
    const long = { ...original, panels: original.panels.map(p => ({ ...p, scene: "장".repeat(4000), dialogue: "대".repeat(3000) })) };
    expect(studioImageContext(long, 3).length + 8000 + 1500).toBeLessThan(25000);
  });
});

