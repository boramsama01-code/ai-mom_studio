// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourceTextEditor } from "../client/src/SourceTextEditor";
import { ApiError } from "../client/src/api";
import type { SourceDocument } from "../shared/schema";
const mocks = vi.hoisted(() => ({ api: vi.fn(), guard: { setDirty: vi.fn() } }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
const text = "연구진은 새로운 계산 방법으로 복잡한 문제를 해결했다고 설명했습니다.\n결과에 대한 추가 검증이 필요하다는 의견도 함께 밝혔습니다.";
beforeEach(async () => {
  vi.clearAllMocks(); mocks.api.mockResolvedValue({ version: 2, quoteCount: 2 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const source = { id: 5, originalUrl: "https://press.example/article", kind: "google_news_rss", fetchStatus: "failed", meta: {} } as SourceDocument;
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(SourceTextEditor, { cid: 1, itemId: 3, version: 1, source }))));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function paste() {
  const el = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 25)); }); }
it("확보 실패 화면에 입력을 열어 두고 선택한 구절만 AI 호출 없이 저장한다", async () => {
  expect(host.querySelector("textarea")).not.toBeNull(); await paste();
  const checks = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'); expect(checks).toHaveLength(2);
  await act(async () => checks[1].click()); await submit();
  expect(mocks.api).toHaveBeenCalledWith("/channels/1/items/3/source-text", { method: "POST", body: { version: 1, url: "https://press.example/article", text, quotes: [text.split("\n")[0]] } });
  expect(host.textContent).toContain("저장했습니다"); expect(host.querySelector("textarea")!.value).toBe(text);
});
it("저장 충돌 뒤 입력을 보존하고 명시적인 최신 상태 확인 후 재시도한다", async () => {
  mocks.api.mockRejectedValueOnce(new ApiError(409, "다른 곳에서 수정됨"));
  await paste(); await submit(); expect(host.querySelector("textarea")!.value).toBe(text);
  mocks.api.mockResolvedValueOnce({ item: { version: 7 } });
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "최신 상태 확인")!.click());
  await submit(); expect(mocks.api.mock.lastCall?.[1].body.version).toBe(7); expect(host.querySelector("textarea")!.value).toBe(text);
});
