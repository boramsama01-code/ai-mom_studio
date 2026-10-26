// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { studioContentSchema } from "../shared/studio";
import { StudioPanelImport } from "../client/src/pages/StudioPanelImport";

const { guard, toast, writeText } = vi.hoisted(() => ({ guard: { setDirty: vi.fn() }, toast: vi.fn(), writeText: vi.fn() }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => toast }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const content = studioContentSchema.parse({ title: "내 제목", panels: [{ scene: "창가의 펨펨", dialogue: "내 대사", imageId: 99 }, ...Array.from({ length: 3 }, () => ({ scene: "", dialogue: "" }))] });
async function render(upload = vi.fn().mockResolvedValue(undefined), disabled = false) {
  await act(async () => root.render(createElement(StudioPanelImport, { content, index: 0, channelName: "내 채널", instruction: "", disabled, upload })));
  return upload;
}
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!; }
function paste(file?: File) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { items: file ? [{ kind: "file", getAsFile: () => file }] : [] } });
  host.querySelector('[role="group"]')!.dispatchEvent(event);
  return event;
}

describe("이미지 붙여넣기 UI", () => {
  it("프롬프트를 복사하고 이미지 붙여넣기 즉시 미리보기와 저장 상태를 표시한다", async () => {
    let finish!: () => void;
    const upload = await render(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    await act(async () => button("프롬프트 복사").click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("창가의 펨펨"));
    expect(host.textContent).toContain("프롬프트 복사됨");
    const file = new File(["png fixture"], "panel.png", { type: "image/png" });
    await act(async () => { expect(paste(file).defaultPrevented).toBe(true); });
    expect(upload).toHaveBeenCalledWith(file, 0);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:test-preview");
    expect(host.textContent).toContain("이미지 저장 중");
    await act(async () => { paste(file); });
    expect(upload).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(host.textContent).toContain("저장 완료");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-preview");
  });
  it("저장 실패 후 미리보기를 유지하며 명시적인 다시 저장을 지원한다", async () => {
    const upload = await render(vi.fn().mockRejectedValueOnce(new Error("네트워크 연결 실패")).mockResolvedValueOnce(undefined));
    await act(async () => { paste(new File(["png"], "panel.png", { type: "image/png" })); });
    expect(host.textContent).toContain("미리보기는 아직 저장되지 않았습니다");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:test-preview");
    const protection = guard.setDirty.mock.calls.filter(c => c[1] === true).at(-1);
    expect(await protection?.[2]()).toBe(false);
    await act(async () => { button("다시 저장").click(); });
    expect(upload).toHaveBeenCalledTimes(2); expect(host.textContent).toContain("저장 완료");
  });
  it("주소·다중 파일·금지 형식은 업로드하지 않고 파일 선택도 같은 경로로 저장한다", async () => {
    const upload = await render();
    await act(async () => { paste(); });
    expect(host.textContent).toContain("텍스트·주소는 저장하지 않습니다");
    await act(async () => { paste(new File(["svg"], "panel.svg", { type: "image/svg+xml" })); });
    expect(upload).not.toHaveBeenCalled();
    const file = new File(["png"], "panel.png", { type: "image/png" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file, file] } });
    await act(async () => { host.querySelector('[role="group"]')!.dispatchEvent(event); });
    expect(host.textContent).toContain("한 장씩"); expect(upload).not.toHaveBeenCalled();
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(upload).toHaveBeenCalledWith(file, 0);
  });
  it("저장 잠금 중 붙여넣기는 실행하지 않는다", async () => {
    const upload = await render(vi.fn(), true);
    await act(async () => { paste(new File(["png"], "panel.png", { type: "image/png" })); });
    expect(upload).not.toHaveBeenCalled();
  });
});
