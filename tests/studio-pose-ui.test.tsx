// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioCharacterArchive, StudioPosePicker, StudioRegisteredCharacters } from "../client/src/pages/StudioPosePicker";
import { studioContentSchema, type StudioContent } from "../shared/studio";
import { STUDIO_CHARACTERS, STUDIO_FAMILY_REFERENCE_URL, poseImageUrl, poseLabel } from "../shared/studioCharacters";
import { FINAL_POSE_VERSION, PREVIOUS_POSE_VERSION, FINAL_STUDIO_ASSETS, finalAssetUrl } from "../shared/studioFinalAssets";
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
  it("reopens v1.4 unchanged and offers vectors only after choosing the refreshed version", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<StudioPosePicker cast={["pempem"]} value={[{ character: "pempem", pose: 5, assetVersion: PREVIOUS_POSE_VERSION }]} onChange={onChange} disabled={false} panelIndex={0} imageMode="chatgpt" />));
    const version = container.querySelector<HTMLSelectElement>("select")!;
    expect(version.value).toBe(PREVIOUS_POSE_VERSION);
    expect(container.querySelector('a[download$=".svg"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { version.value = FINAL_POSE_VERSION; version.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector('a[download$=".svg"]')?.getAttribute("href")).toBe(`${poseImageUrl("pempem", 5, FINAL_POSE_VERSION)}&format=svg&download=1`);
    expect(onChange).not.toHaveBeenCalled();
    await click(button("이 컷에 적용"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ character: "pempem", pose: 5, assetVersion: FINAL_POSE_VERSION }]);
  });
  it("enlarges a final PNG without applying it and retains legacy references until explicitly replaced", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<StudioPosePicker cast={["pengpeng"]} value={[{ character: "pengpeng", pose: 41 }]} onChange={onChange} disabled={false} panelIndex={0} imageMode="chatgpt" />));
    expect(container.querySelector<HTMLImageElement>(".studio-pose-selection img")?.getAttribute("src")).toBe(poseImageUrl("pengpeng", 41));
    const version = container.querySelector<HTMLSelectElement>("select")!;
    expect(version.value).toBe("legacy");
    await act(async () => { version.value = FINAL_POSE_VERSION; version.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(button("크게 보기"));
    const dialog = container.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(poseImageUrl("pengpeng", 41, FINAL_POSE_VERSION));
    expect(onChange).not.toHaveBeenCalled();
    await click(button("닫기"));
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector<HTMLImageElement>(".studio-pose-selection img")?.getAttribute("src")).toBe(poseImageUrl("pengpeng", 41));
    await click(button("이 컷에 적용"));
    expect(onChange).toHaveBeenCalledWith([{ character: "pengpeng", pose: 41, assetVersion: FINAL_POSE_VERSION }]);
  });

  it("previews before applying, persists the exact cell, and includes it in the copied guide", async () => {
    await act(async () => root.render(<Harness />));
    expect(button("목록 접기")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    await click(ariaButton(`${poseLabel("pengpeng", 41, FINAL_POSE_VERSION)} 미리보기`));
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
    await click(button("이 컷에 적용"));
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(1);
    expect(container.querySelector(".studio-pose-selection a")?.getAttribute("href")).toBe(poseImageUrl("pengpeng", 41, FINAL_POSE_VERSION));
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="복사할 그림 가이드"]')!.value;
    expect(prompt).toContain(poseLabel("pengpeng", 41, FINAL_POSE_VERSION));
    expect(prompt).toContain(poseImageUrl("pengpeng", 41, FINAL_POSE_VERSION));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 41, assetVersion: FINAL_POSE_VERSION }]);
    expect(saved?.panels.slice(1).every(panel => !panel.poseRefs?.length)).toBe(true);
  });

  it("replaces only the current character's reference and allows removing it", async () => {
    await act(async () => root.render(<Harness />));
    await click(button("이 컷에 적용"));
    await click(Array.from(container.querySelectorAll(".studio-pose-character-tabs button")).find(element => element.textContent?.includes("펨펨")));
    await click(ariaButton(`${poseLabel("pempem", 100, FINAL_POSE_VERSION)} 미리보기`));
    await click(button("이 컷에 적용"));
    await click(ariaButton(`${poseLabel("pempem", 8, FINAL_POSE_VERSION)} 미리보기`));
    await click(button("이 컷에 적용"));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 1, assetVersion: FINAL_POSE_VERSION }, { character: "pempem", pose: 8, assetVersion: FINAL_POSE_VERSION }]);
    await click(ariaButton(`${poseLabel("pempem", 8, FINAL_POSE_VERSION)} 선택 해제`));
    await click(button("저장 후 다시 불러오기"));
    expect(saved?.panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 1, assetVersion: FINAL_POSE_VERSION }]);
  });

  it("filters by the actual comic expression and loads final individual PNGs", async () => {
    await act(async () => root.render(<Harness />));
    const select = container.querySelectorAll<HTMLSelectElement>("select")[1];
    await act(async () => { select.value = "wobble_shock"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const matches = FINAL_STUDIO_ASSETS.filter(a => a.id.startsWith("PP") && a.comic_face_type === "wobble_shock");
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(matches.length);
    const last = container.querySelector(".studio-pose-tile")!;
    const thumbnail = last.querySelector<HTMLImageElement>(".studio-pose-thumbnail img")!;
    expect(thumbnail.getAttribute("src")).toBe(poseImageUrl("pengpeng", Number(matches[0].id.slice(2)), FINAL_POSE_VERSION));
    expect(thumbnail.getAttribute("loading")).toBe("lazy");
    expect(thumbnail.style.backgroundImage).toBe("");
  });

  it("does not change references while the editor is busy", async () => {
    await act(async () => root.render(<Harness disabled />));
    expect(button("목록 접기")?.disabled).toBe(true);
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    expect([...container.querySelectorAll<HTMLButtonElement>(".studio-pose-tile")].every(tile => tile.disabled)).toBe(true);
    expect(button("이 컷에 적용")?.disabled).toBe(true);
    await click(button("이 컷에 적용"));
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
  });

  it("shows no-cast guidance without selecting anyone and opens when a cast is supplied", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<StudioPosePicker cast={[]} value={[]} onChange={onChange} disabled={false} panelIndex={0} imageMode="chatgpt" />));
    expect(container.textContent).toContain("위에서 등장인물을 먼저 선택해 주세요.");
    expect(button("포즈 선택")?.getAttribute("aria-expanded")).toBe("false");
    expect(button("포즈 선택")?.disabled).toBe(true);
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(<StudioPosePicker cast={["pengki"]} value={[]} onChange={onChange} disabled={false} panelIndex={0} imageMode="chatgpt" />));
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    expect(container.querySelector<HTMLImageElement>(".studio-pose-tile img")?.getAttribute("src")).toBe(poseImageUrl("pengki", 1, FINAL_POSE_VERSION));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports image failures and retries without choosing or applying a pose", async () => {
    await act(async () => root.render(<Harness />));
    const image = container.querySelector<HTMLImageElement>(".studio-pose-tile img")!;
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("그림을 불러오지 못했어요.");
    expect(image.hidden).toBe(true);
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
    await click(button("그림 다시 불러오기"));
    expect(image.getAttribute("src")).toBe(`${poseImageUrl("pengpeng", 1, FINAL_POSE_VERSION)}&retry=1`);
    expect(image.hidden).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
  });

  it("registers all final PNGs and switches between individual and supplementary assets", async () => {
    await act(async () => root.render(<StudioCharacterArchive />));
    const headings = Array.from(container.querySelectorAll(".studio-pose-archive-title h2")).map(element => element.textContent);
    expect(headings).toEqual(["펭펭40살", "펨펨37살", "펭긴13살", "펭키12살"]);
    expect(container.querySelectorAll(".studio-pose-tile")).toHaveLength(112);
    await click(button("펭키 포즈 보기"));
    expect(container.querySelector<HTMLImageElement>(".studio-pose-tile img")?.getAttribute("src")).toBe(poseImageUrl("pengki", 1, FINAL_POSE_VERSION));
    await click(button("말풍선 · 12개"));
    expect(container.querySelector<HTMLImageElement>(".studio-supplementary-assets .studio-pose-tile img")?.getAttribute("src")).toBe(finalAssetUrl("FX001"));
    expect(container.textContent).not.toContain("식품공학 대학원생");
  });
});

describe("registered characters in the authoring page", () => {
  it("shows all four real portraits in age order and preserves the explicit cast selection", async () => {
    const onChange = vi.fn(), onChoosePoses = vi.fn();
    await act(async () => root.render(<StudioRegisteredCharacters cast={["pengki"]} onChange={onChange} disabled={false} onChoosePoses={onChoosePoses} />));
    const panel = container.querySelector('[data-testid="studio-registered-characters"]')!;
    expect(panel.closest("[hidden]")).toBeNull();
    expect([...panel.querySelectorAll(".studio-registered-name")].map(name => name.textContent)).toEqual(["펭펭40살100포즈", "펨펨37살100포즈", "펭긴13살100포즈", "펭키12살100포즈"]);
    const portraits = [...panel.querySelectorAll<HTMLImageElement>(".studio-character-portrait img")];
    expect(portraits).toHaveLength(4);
    expect(portraits.every((image, index) => image.getAttribute("src") === poseImageUrl(STUDIO_CHARACTERS[index].id, 1, FINAL_POSE_VERSION) && !image.hidden)).toBe(true);
    const choices = [...panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(choices.map(choice => choice.checked)).toEqual([false, false, false, true]);
    expect(choices.map(choice => choice.getAttribute("aria-label"))).toEqual(STUDIO_CHARACTERS.map(character => `${character.name} 등장인물 선택`));
    expect(onChange).not.toHaveBeenCalled();
    await click(button("포즈 고르기"));
    expect(onChoosePoses).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    await click(choices[0]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("pengpeng", true);
  });

  it("keeps portraits visible with no cast or while editing is disabled", async () => {
    const onChange = vi.fn(), onChoosePoses = vi.fn();
    await act(async () => root.render(<StudioRegisteredCharacters cast={[]} onChange={onChange} disabled={false} onChoosePoses={onChoosePoses} />));
    expect(container.textContent).toContain("등장인물을 먼저 선택하면 포즈를 고를 수 있어요.");
    expect(button("포즈 고르기")?.disabled).toBe(true);
    expect(container.querySelectorAll(".studio-character-portrait img")).toHaveLength(4);
    await act(async () => root.render(<StudioRegisteredCharacters cast={["pengpeng"]} onChange={onChange} disabled onChoosePoses={onChoosePoses} />));
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(button("포즈 고르기")?.disabled).toBe(true);
    await click(container.querySelector('input[aria-label="펨펨 등장인물 선택"]'));
    await click(button("포즈 고르기"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onChoosePoses).not.toHaveBeenCalled();
  });

  it("retries a failed portrait without activating its checkbox or the pose chooser", async () => {
    const onChange = vi.fn(), onChoosePoses = vi.fn();
    await act(async () => root.render(<StudioRegisteredCharacters cast={["pempem"]} onChange={onChange} disabled={false} onChoosePoses={onChoosePoses} />));
    const image = container.querySelector<HTMLImageElement>('.studio-character-portrait img')!;
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(image.hidden).toBe(true);
    expect(container.textContent).toContain("그림 로딩 실패");
    const retry = button("그림 다시 불러오기")!;
    expect(retry.closest("label")).toBeNull();
    await click(retry);
    expect(image.getAttribute("src")).toBe(`${poseImageUrl("pengpeng", 1, FINAL_POSE_VERSION)}&retry=1`);
    expect(image.hidden).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input => input.checked)).toEqual([false, true, false, false]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onChoosePoses).not.toHaveBeenCalled();
  });
});
