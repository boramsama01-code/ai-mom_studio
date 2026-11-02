// @vitest-environment jsdom
import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScreenErrorBoundary } from "../client/src/ScreenErrorBoundary";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("keeps navigation visible after a removed deployment chunk and reloads only on request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  const MissingScreen = lazy(async () => { throw new TypeError("Failed to fetch dynamically imported module"); });
  await act(async () => root.render(<><nav>발행함 · 인스타그램 연결</nav><ScreenErrorBoundary key="publish" onReload={reload}><Suspense fallback="로딩"><MissingScreen /></Suspense></ScreenErrorBoundary></>));
  expect(host.querySelector("nav")?.textContent).toContain("발행함");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("화면을 불러오지 못했어요");
  expect(reload).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(reload).toHaveBeenCalledOnce();
  await act(async () => root.render(<ScreenErrorBoundary key="instagram" onReload={reload}><h1>인스타그램 연결</h1></ScreenErrorBoundary>));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("인스타그램 연결");
});
