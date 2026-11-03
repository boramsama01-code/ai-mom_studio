// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioPublish } from "../client/src/pages/StudioPublish";
import { studioContentSchema, type StudioCard } from "../shared/studio";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), save: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => ({ confirmLeave: (fn: () => void) => fn() }) }));
vi.mock("../client/src/workroom", () => ({ isPrivateWorkroom: () => false }));
vi.mock("../client/src/pages/InstagramAccounts", () => ({ InstagramAccounts: () => null, InstagramConnect: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
const card: StudioCard = { ...studioContentSchema.parse({ title: "QA 최종 이미지", caption: "확인한 캡션", channel: "highscoop" }), id: 8, version: 3, sourceItemId: null, createdAt: "2026-11-03", updatedAt: "2026-11-03" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.save.mockResolvedValue(card);
  mocks.api.mockImplementation(async (path: string, options?: { body?: any }) => {
    if (path === "/status") return { integrations: { flags: { dryRun: false, autoPublish: true } }, workerConnected: true };
    if (path === "/studio/cards/8/publication") return { channelId: 2, channelName: "하이스쿱", expectedUsername: "highscoop.official", ready: true, blockers: [], dailyLimit: 3, dryRun: false, autoPublish: true, destinations: [{ id: 20, label: "하이스쿱 계정", enabled: true, configured: true }], deliveries: [] };
    if (path === "/studio/cards/8/publication/prepare") return { cardId: 8, version: 3, channelId: 2, itemId: 9, revisionId: 4, assetId: 40, caption: card.caption, pages: [{ id: 40, title: "카드 1", altText: "카드 설명" }] };
    if (path === "/studio/instagram/2/check") return { username: "highscoop.official", checkedAt: new Date().toISOString() };
    if (path === "/studio/cards/8/publication/approve") return { timing: options?.body.timing, workerStarted: options?.body.timing === "now" };
    throw new Error(`Unexpected API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
function button(text: string) { const result = [...host.querySelectorAll("button")].find(b => b.textContent === text); if (!result) throw new Error(`Missing button: ${text}`); return result; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
async function preview() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(StudioPublish, { base: card, dirty: false, busy: false, save: mocks.save }))));
  await settle(); await click("저장하고 발행 미리보기");
}
async function confirm() { await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await settle(); }

it("shows an immediate post choice with no date requirement, and waits for final review", async () => {
  await preview();
  expect(button("바로 게시").getAttribute("aria-pressed")).toBe("true");
  expect(button("예약 게시")).toBeDefined();
  expect(host.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(button("확인한 내용 바로 게시").disabled).toBe(true);
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/approve"))).toBe(false);
  await confirm(); await click("확인한 내용 바로 게시");
  expect(mocks.api).toHaveBeenCalledWith("/studio/cards/8/publication/approve", { method: "POST", body: { version: 3, assetId: 40, destinationId: 20, timing: "now", scheduledAt: undefined, requestId: expect.any(String) } });
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("바로 게시를 요청"));
});
it("requests an explicit future schedule only after the user chooses scheduled posting", async () => {
  await preview(); await click("예약 게시");
  const input = host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  expect(input).not.toBeNull(); expect(button("확인한 내용 예약 게시").disabled).toBe(true);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2099-01-01T20:00"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle(); await confirm(); await click("확인한 내용 예약 게시");
  expect(mocks.api).toHaveBeenCalledWith("/studio/cards/8/publication/approve", { method: "POST", body: { version: 3, assetId: 40, destinationId: 20, timing: "later", scheduledAt: "2099-01-01T11:00:00.000Z", requestId: expect.any(String) } });
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("예약을 저장"));
});

it("reuses the approval request ID after a lost response and changes it for a new timing intent", async () => {
  const fallback = mocks.api.getMockImplementation()!;
  const ids: string[] = [];
  mocks.api.mockImplementation(async (path, options) => {
    if (path.endsWith("/publication/approve")) {
      ids.push(options.body.requestId);
      throw new Error("응답을 받지 못했습니다.");
    }
    return fallback(path, options);
  });
  await preview(); await confirm();
  await click("확인한 내용 바로 게시");
  await click("확인한 내용 바로 게시");
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await click("예약 게시");
  const input = host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2099-01-01T20:00"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle(); await confirm(); await click("확인한 내용 예약 게시");
  expect(ids).toHaveLength(3); expect(ids[2]).not.toBe(ids[0]);
});

it("starts a new approval request group after an acknowledged success", async () => {
  await preview(); await confirm(); await click("확인한 내용 바로 게시");
  // The synthetic status has no active delivery, representing a completed or
  // cancelled prior request. The operator explicitly confirms a new approval.
  await confirm(); await click("확인한 내용 바로 게시");
  const requests = mocks.api.mock.calls.filter(([path]) => path.endsWith("/publication/approve"));
  expect(requests).toHaveLength(2);
  expect(requests[1][1].body.requestId).not.toBe(requests[0][1].body.requestId);
});
