// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionPanel } from "../client/src/collection";
import { kstDay } from "../shared/collection";
const mocks = vi.hoisted(() => ({ api: vi.fn(), select: vi.fn(), toast: vi.fn(), navigate: vi.fn() }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", select: mocks.select }), useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
const overview = { date: kstDay(), timezone: "Asia/Seoul", autoCollect: true, globalStop: false, naverReady: true, inlineWorker: true, nextAt: null, lastScheduledAt: null,
  channels: [{ id: 1, version: 1, name: "입시 채널", slug: "opportunities", active: true, queries: 4, discoveryQueries: 0, boards: 0, budget: 12, profile: null, newItems: 0, pending: 0, fetched: 0, lastRun: null, jobs: [{ id: 1, status: "queued", stale: true, createdAt: "2026-10-01T00:00:00Z" }] }] };
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => path === "/collection/collect" ? { requested: [{}], inline: true } : overview);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(CollectionPanel, { detailed: true }))));
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("몇 주 지난 대기 작업 때문에 버튼을 막지 않고 재개한다", async () => {
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === "대기 수집 재개")!;
  expect(b.disabled).toBe(false);
  await act(async () => b.click());
  expect(mocks.api).toHaveBeenCalledWith("/collection/collect", { method: "POST", body: { channelId: "all" } });
  expect(host.textContent).toContain("실제 예약 수집 기록이 아직 없습니다");
});
it("날짜별 결과 링크는 선택한 채널과 수집일을 전달한다", async () => {
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === "이 날짜 자료 보기")!;
  await act(async () => b.click());
  expect(mocks.select).toHaveBeenCalledWith(1);
  expect(mocks.navigate).toHaveBeenCalledWith(`/inbox?collectedOn=${kstDay()}`);
});
it("인증 실패로 0건인 경우 원인과 키 수정 링크를 숨기지 않는다", async () => {
  const failed = { ...overview, channels: [{ ...overview.channels[0], jobs: [], lastRun: { id: 1, status: "failed", startedAt: "2026-10-26T07:03:00Z", finishedAt: "2026-10-26T07:03:01Z", counts: { newItems: 0 }, errors: [{ scope: "rule:1", message: "과학고(news): 인증/권한 오류 (HTTP 401)" }] } }] };
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], failed); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("최근 수집이 네이버 인증 단계에서 멈췄습니다");
  expect(alert.querySelector("a")?.getAttribute("href")).toBe("/connections?service=naver");
  await act(async () => alert.querySelector("a")!.click());
  expect(mocks.navigate).toHaveBeenCalledWith("/connections?service=naver");
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...failed, channels: [{ ...failed.channels[0], lastRun: { ...failed.channels[0].lastRun, status: "ok", errors: [] } }] }); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
