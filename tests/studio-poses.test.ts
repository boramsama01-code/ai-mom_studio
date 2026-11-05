import { describe, expect, it } from "vitest";
import { studioContentSchema, studioCreateSchema, studioPatchSchema, studioPanelSchema } from "../shared/studio";
import { STUDIO_CHARACTERS, STUDIO_CHARACTER_GUIDE, STUDIO_POSE_COUNT, poseImageUrl, studioPoseGuide } from "../shared/studioCharacters";
import { applyStudioText, studioImageContext } from "../shared/studioWorkflow";
import { studioPoseBounds } from "../server/services/studioCharacters";
import { studioChatGptImagePrompt } from "../shared/studioImageImport";

const panels = () => Array.from({ length: 4 }, () => ({ scene: "책상 앞에서 이야기한다.", dialogue: "함께 해 보자.", imageId: null }));
const draft = () => studioContentSchema.parse({ title: "가족 회의", characters: ["pengpeng", "pempem", "penguin", "pengki"], panels: panels() });

describe("approved family pose catalog", () => {
  it("retains stable IDs while showing the approved names in age order and 400 addressable poses", () => {
    expect(STUDIO_CHARACTERS.map(c => [c.id, c.name, c.age])).toEqual([
      ["pengpeng", "펭펭", 40], ["pempem", "펨펨", 37], ["penguin", "펭긴", 13], ["pengki", "펭키", 12],
    ]);
    const paths = STUDIO_CHARACTERS.flatMap(c => Array.from({ length: STUDIO_POSE_COUNT }, (_, i) => poseImageUrl(c.id, i + 1)));
    expect(new Set(paths).size).toBe(400);
    expect(STUDIO_CHARACTER_GUIDE).toContain("노란 부리");
    expect(STUDIO_CHARACTER_GUIDE).toContain("볼터치나 머리카락을 추가하지 않는다");
    expect(STUDIO_CHARACTER_GUIDE).not.toContain("검은 부리");
  });
});

describe("saved pose selections", () => {
  it("reads legacy panels, stores a selected pose and keeps a stage-only PATCH narrow", () => {
    const legacy = draft();
    expect(legacy.panels[0].poseRefs).toEqual([]);
    legacy.panels[1].poseRefs = [{ character: "pempem", pose: 100 }];
    const created = studioCreateSchema.parse(legacy);
    expect(studioContentSchema.parse(JSON.parse(JSON.stringify(created))).panels[1].poseRefs).toEqual([{ character: "pempem", pose: 100 }]);
    expect(studioPatchSchema.parse({ version: 2, stage: "making" })).toEqual({ version: 2, stage: "making" });
  });

  it("rejects out-of-range, fractional, duplicate, unknown and out-of-cast references", () => {
    for (const pose of [0, 101, 1.5]) expect(studioPanelSchema.safeParse({ ...panels()[0], poseRefs: [{ character: "pengki", pose }] }).success).toBe(false);
    expect(studioPanelSchema.safeParse({ ...panels()[0], poseRefs: [{ character: "../../secret", pose: 1 }] }).success).toBe(false);
    expect(studioPanelSchema.safeParse({ ...panels()[0], poseRefs: [{ character: "pengki", pose: 1, url: "https://example.com/file" }] }).success).toBe(false);
    expect(studioPanelSchema.safeParse({ ...panels()[0], poseRefs: [{ character: "pengki", pose: 1 }, { character: "pengki", pose: 2 }] }).success).toBe(false);
    const content = draft();
    content.characters = ["penguin"];
    content.panels[0].poseRefs = [{ character: "pengki", pose: 1 }];
    expect(studioContentSchema.safeParse(content).success).toBe(false);
  });

  it("preserves selections through both text rewrite and fill while keeping each panel separate", () => {
    const content = draft();
    content.panels[0].poseRefs = [{ character: "pengpeng", pose: 1 }];
    content.panels[3].poseRefs = [{ character: "pengki", pose: 100 }];
    const text = { title: "수정", script: "새 원고", caption: "새 캡션", panels: panels().map(p => ({ ...p, scene: "새 장면" })) };
    for (const mode of ["rewrite", "fill"] as const) {
      const updated = applyStudioText(content, text, mode);
      expect(updated.panels.map(p => p.poseRefs)).toEqual(content.panels.map(p => p.poseRefs));
    }
    const guide = studioImageContext(content, 3);
    expect(guide).toContain("펭키");
    expect(guide).toContain("10행 10열");
    expect(guide).toContain("/api/studio/characters/pengki/poses/100");
    expect(guide).not.toContain("/api/studio/characters/pengpeng/poses/1");
    expect(studioPoseGuide(content.panels[2])).toBe("");
    const copied = studioChatGptImagePrompt(content, 3, "우주펭귄상회");
    expect(copied).toContain("펭키 · 코믹 액션 100");
    expect(copied).toContain("길고 뾰족한 노란 부리");
    expect(copied).toContain("원본 첨부를 요청");
    expect(copied).not.toContain("뾰족한 검은 부리");
  });
});

describe("pixel-accurate pose boundaries", () => {
  it("uses the 400 measured cell regions and rejects a mismatched replacement sheet", () => {
    for (const character of STUDIO_CHARACTERS) {
      const boxes = Array.from({ length: 100 }, (_, i) => studioPoseBounds(character.id, 1254, 1254, i + 1));
      expect(new Set(boxes.map(b => JSON.stringify(b))).size).toBe(100);
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.left + box.width).toBeLessThanOrEqual(1254);
        expect(box.top + box.height).toBeLessThanOrEqual(1254);
      }
    }
    // These art-specific regions differ from a blind 125.4px uniform grid.
    expect(studioPoseBounds("pengpeng", 1254, 1254, 1)).toEqual({ left: 0, top: 0, width: 125, height: 132 });
    expect(studioPoseBounds("pengpeng", 1254, 1254, 100)).toEqual({ left: 1119, top: 1148, width: 135, height: 106 });
    expect(studioPoseBounds("pengki", 1254, 1254, 1)).toEqual({ left: 0, top: 0, width: 132, height: 126 });
    expect(() => studioPoseBounds("pengpeng", 1254, 1254, 101)).toThrow();
    expect(() => studioPoseBounds("pengpeng", 1024, 1024, 1)).toThrow();
  });
});
