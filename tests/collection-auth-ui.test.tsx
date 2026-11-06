// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionPanel } from "../client/src/collection";
import { kstDay, type CollectionOverview } from "../shared/collection";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: 3, select: vi.fn() }), useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", vi.fn()] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, overview: CollectionOverview;
beforeEach(() => {
  vi.clearAllMocks();
  overview = { date: kstDay(), timezone: "Asia/Seoul", autoCollect: true, globalStop: false, searchReady: true, naverReady: true, sourceMode: "official_naver", inlineWorker: true, nextAt: null, lastScheduledAt: null,
    channels: [{ id: 3, version: 1, name: "과학 이야기", slug: "science-dialogue", active: true, queries: 1, discoveryQueries: 0, boards: 0, budget: 1, profile: null, newItems: 2, pending: 2, fetched: 0, jobs: [],
      lastRun: { id: 88, status: "partial", startedAt: "2026-11-06T01:02:00Z", finishedAt: "2026-11-06T01:08:00Z", counts: { naverFailed: 1 }, errors: [{ scope: "naver", message: "인증/권한 오류 (HTTP 401) — 이전 실행 기록" }] } }] };
  mocks.api.mockImplementation(async () => overview);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(detailed: boolean) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(CollectionPanel, { detailed }))));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
describe.each([false, true])("수집 인증 안내 detailed=%s", detailed => {
  it("실패 이후 성공한 연결 검사와 미검증인 다음 수집을 구별하고 기록을 보존한다", async () => {
    overview.naverConnectionTest = { ok: true, at: "2026-11-06T01:40:00Z" };
    await render(detailed);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("이후 연결 검사는 성공했습니다");
    expect(host.textContent).toContain("다음 수집 결과는 아직 확인하지 않았습니다");
    expect(host.textContent).not.toContain("네이버 키 확인·수정");
    if (detailed) expect(host.textContent).toContain("HTTP 401) — 이전 실행 기록");
    expect(mocks.api.mock.calls.every(([path]) => path.startsWith("/collection/overview?"))).toBe(true);
  });
  it.each([null, { ok: false, at: "2026-11-06T01:40:00Z" }, { ok: true, at: "2026-11-06T01:07:00Z" }, { ok: true, at: "invalid" }])("후속 성공 증거가 없으면 실제 인증 경고를 유지한다: %j", async test => {
    overview.naverConnectionTest = test;
    await render(detailed);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("네이버 검색 인증에 실패했습니다");
    expect(host.textContent).toContain("네이버 키 확인·수정");
    expect(host.textContent).not.toContain("이후 연결 검사는 성공했습니다");
  });
  it("전체 채널 중 검사 이후 실패가 하나라도 있으면 복구로 표시하지 않는다", async () => {
    overview.naverConnectionTest = { ok: true, at: "2026-11-06T01:40:00Z" };
    overview.channels.push({ ...overview.channels[0], id: 107, name: "다른 채널", lastRun: { ...overview.channels[0].lastRun!, id: 89, startedAt: "2026-11-06T01:41:00Z", finishedAt: "2026-11-06T01:42:00Z" } });
    await render(detailed);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("이후 연결 검사는 성공했습니다");
  });
  it("아직 끝나지 않은 실행의 인증 실패는 성공 검사만으로 해제하지 않는다", async () => {
    overview.naverConnectionTest = { ok: true, at: "2026-11-06T01:40:00Z" };
    overview.channels[0].lastRun!.finishedAt = null;
    await render(detailed);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("이후 연결 검사는 성공했습니다");
  });
});
