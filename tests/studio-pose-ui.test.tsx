// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudioCharacterArchive, StudioPosePicker } from "../client/src/pages/StudioPosePicker";
import { studioContentSchema, type StudioContent } from "../shared/studio";
import { STUDIO_CHARACTERS, poseImageUrl, poseLabel, poseSheetUrl } from "../shared/studioCharacters";
import { studioChatGptImagePrompt } from "../shared/studioImageImport";

let container: HTMLDivElement;
let root: Root;
let saved: StudioContent | null;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); saved = null;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click());
};
const button = (label: string) => Array.from(container.querySelectorAll("button")).find(element => element.textContent === label);
const ariaButton = (label: string) => Array.from(container.querySelectorAll("button")).find(element => element.getAttribute("aria-label") === label);

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [content, setContent] = useState(() => studioContentSchema.parse({ title: "펭귄의 하루", characters: ["pengpeng", "pempem"], panels: Array.from({ length: 4 }, () => ({ scene: "가족이 이야기를 나눈다.", dialogue: "안녕!" })) }));
  return <><StudioPosePicker cast={content.characters} value={content.panels[0].poseRefs ?? []} onChange={poseRefs => setContent(current => ({ ...current, panels: current.panels.map((panel, index) => index === 0 ? { ...panel, poseRefs } : panel) }))} disabled={disabled} panelIndex={0} imageMode="chatgpt" />
    <button onClick={() => { saved = studioContentSchema.parse(JSON.parse(JSON.stringify(content))); setContent(saved); }}>저장 후 다시 불러오기</button>
    <textarea aria-label="복사할 그림 가이드" readOnly value={studioChatGptImagePrompt(content, 0, "우주펭귄상회", "")} />
  </>;
}

describe("studio pose picker", () => {
  it("previews before applying, persists the exact cell, and includes it in the copied guide", async () => {
    await act(async () => root.render(<Harness />));
    await click(button("포즈 선택"));
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    await click(ariaButton(`${poseLabel("pengpeng", 41)} 미리보기`));
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
    await click(button("이 컷에 적용"));
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(1);
    expect(container.querySelector(".studio-pose-selection a")?.getAttribute("href")).toBe(poseImageUrl("pengpeng", 41));
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="복사할 그림 가이드"]')!.value;
    expect(prompt).toContain(poseLabel("pengpeng", 41));
    expect(prompt).toContain(poseImageUrl("pengpeng", 41));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 41 }]);
    expect(saved?.panels.slice(1).every(panel => !panel.poseRefs?.length)).toBe(true);
  });

  it("replaces only the current character's reference and allows removing it", async () => {
    await act(async () => root.render(<Harness />));
    await click(button("포즈 선택"));
    await click(button("이 컷에 적용"));
    await click(Array.from(container.querySelectorAll(".studio-pose-character-tabs button")).find(element => element.textContent?.includes("펨펨")));
    await click(ariaButton(`${poseLabel("pempem", 100)} 미리보기`));
    await click(button("이 컷에 적용"));
    await click(ariaButton(`${poseLabel("pempem", 8)} 미리보기`));
    await click(button("이 컷에 적용"));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 1 }, { character: "pempem", pose: 8 }]);
    await click(ariaButton(`${poseLabel("pempem", 8)} 선택 해제`));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 1 }]);
  });

  it("renders category filters with ten lazy thumbnails from the measured-crop endpoint", async () => {
    await act(async () => root.render(<Harness />));
    await click(button("포즈 선택"));
    const select = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "9"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(10);
    const last = ariaButton(`${poseLabel("pengpeng", 100)} 미리보기`)!;
    const thumbnail = last.querySelector<HTMLImageElement>("img.studio-pose-thumbnail")!;
    expect(thumbnail.getAttribute("src")).toBe(poseImageUrl("pengpeng", 100));
    expect(thumbnail.getAttribute("loading")).toBe("lazy");
    expect(thumbnail.style.backgroundImage).toBe("");
  });

  it("does not change references while the editor is busy", async () => {
    await act(async () => root.render(<Harness disabled />));
    expect(button("포즈 선택")?.disabled).toBe(true);
    await click(button("포즈 선택"));
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(0);
  });

  it("registers all four sheets in age order with the current names", async () => {
    await act(async () => root.render(<StudioCharacterArchive />));
    const headings = Array.from(container.querySelectorAll(".studio-pose-archive-title h2")).map(element => element.textContent);
    expect(headings).toEqual(["펭펭40살", "펨펨37살", "김펭긴13살", "김펭키12살"]);
    expect(container.querySelectorAll(".studio-pose-sheet-link")).toHaveLength(4);
    for (const character of STUDIO_CHARACTERS) expect(container.querySelector(`a[download="${character.name}-100포즈.png"]`)?.getAttribute("href")).toBe(poseSheetUrl(character.id));
    expect(container.textContent).not.toContain("식품공학 대학원생");
  });
});
