// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatGptLaunch } from "../client/src/ChatGptLaunch";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const writeText = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("팝업 스크립트나 API 없이 새 탭 링크를 만들고 최신 편집 요청을 반영한다", async () => {
  await act(async () => root.render(createElement(ChatGptLaunch, { prompt: "첫 요청" })));
  let link = host.querySelector("a")!;
  expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener");
  expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(new URL(link.href).searchParams.get("q")).toBe("첫 요청");
  await act(async () => root.render(createElement(ChatGptLaunch, { prompt: "수정된 요청" })));
  expect(new URL(host.querySelector("a")!.href).searchParams.get("q")).toBe("수정된 요청");
  expect(writeText).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(ChatGptLaunch, { prompt: "수정된 요청", disabled: true })));
  expect(host.querySelector("a")).toBeNull();
});
it("긴 자료 전체를 복사하고 복사 실패 시에도 원문 전체를 직접 선택할 수 있다", async () => {
  const prompt = "긴 참고 본문을 모두 보존합니다.\n".repeat(1000);
  await act(async () => root.render(createElement(ChatGptLaunch, { prompt })));
  const link = host.querySelector("a")!;
  expect(link.href).toBe("https://chatgpt.com/"); expect(host.textContent).toContain("내용은 생략하지 않습니다");
  link.addEventListener("click", e => e.preventDefault());
  await act(async () => link.click());
  expect(writeText).toHaveBeenCalledWith(prompt);
  writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
  await act(async () => link.click());
  expect(host.querySelector("textarea")!.value).toBe(prompt);
  expect(host.textContent).toContain("자동 복사가 되지 않았습니다");
});
