// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocation } from "wouter";
import { DirtyGuardProvider, useDirtyGuard } from "../client/src/state";
import { GuardedRouter } from "../client/src/GuardedRouter";
import { DirtyModal } from "../client/src/ui";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
let stored = "저장된 원고";
const save = vi.fn<() => Promise<boolean>>();
function Editor() {
  const [value, setValue] = useState(stored);
  const guard = useDirtyGuard();
  useEffect(() => {
    guard.setDirty("history-editor", value !== stored, async () => {
      if (!(await save())) return false;
      stored = value;
      return true;
    });
    return () => guard.setDirty("history-editor", false);
  }, [guard, value]);
  return <textarea aria-label="원고" value={value} onChange={event => setValue(event.target.value)} />;
}
function App() {
  const [path, navigate] = useLocation();
  return <><output>{path}</output>{path === "/history-editor" ? <Editor /> : <p>목록</p>}<button onClick={() => navigate("/history-editor")}>편집 열기</button><button onClick={() => navigate("/history-list")}>프로그램으로 목록 이동</button><DirtyModal /></>;
}
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click()); await settle();
}
async function edit() {
  const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "새로 작성한 소중한 원고");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
beforeEach(async () => {
  stored = "저장된 원고"; save.mockReset(); save.mockResolvedValue(true);
  history.replaceState(null, "", "/history-list");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<DirtyGuardProvider><GuardedRouter><App /></GuardedRouter></DirtyGuardProvider>));
  await settle();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("native Back preserves the editor on cancel/save failure and Forward reopens the saved draft", async () => {
  await click("편집 열기");
  const input = await edit();
  history.back(); await settle();
  expect(location.pathname).toBe("/history-editor");
  expect(host.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("새로 작성한 소중한 원고");
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await click("머무르기");
  expect(location.pathname).toBe("/history-editor");

  save.mockResolvedValueOnce(false);
  history.back(); await settle(); await click("저장하고 이동");
  expect(location.pathname).toBe("/history-editor");
  expect(host.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("새로 작성한 소중한 원고");

  history.back(); await settle(); await click("저장하고 이동");
  expect(location.pathname).toBe("/history-list");
  expect(host.querySelector("textarea")).toBeNull();
  history.forward(); await settle();
  expect(location.pathname).toBe("/history-editor");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("새로 작성한 소중한 원고");
});

it("programmatic route changes use the same guard even without GuardedLink", async () => {
  await click("편집 열기"); const input = await edit();
  await click("프로그램으로 목록 이동");
  expect(location.pathname).toBe("/history-editor");
  expect(host.querySelector("textarea")).toBe(input);
  await click("머무르기");
  await click("프로그램으로 목록 이동"); await click("버리고 이동");
  expect(location.pathname).toBe("/history-list");
  expect(save).not.toHaveBeenCalled();
});
