// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionPanel } from "../client/src/collection";
import { DiscoveryPanel } from "../client/src/discovery";
import { StudioPublish } from "../client/src/pages/StudioPublish";
import { InstagramAccounts, InstagramConnect } from "../client/src/pages/InstagramAccounts";
import { isPrivateWorkroom } from "../client/src/workroom";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { kstDay } from "../shared/collection";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), toast: vi.fn(), navigate: vi.fn(), select: vi.fn(), save: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: (action: () => void) => action() },
}));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", select: mocks.select }), useDirtyGuard: () => mocks.guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement, root: Root, client: QueryClient, card: StudioCard;
const settings = { enabled: true, queries: ["청소년 과학", "우주 탐사"], picksPerRun: 4, autoDraft: false };
const accounts = [
  { channelId: 1, channelName: "우주펭귄상회", expectedUsername: "spacepenguin.co", destinations: [{ id: 10, label: "@spacepenguin.co", enabled: true, configured: true }] },
  { channelId: 2, channelName: "하이스쿱", expectedUsername: "highscoop.official", destinations: [{ id: 20, label: "@highscoop.official", enabled: true, configured: true }] },
];
const overview = { date: kstDay(), timezone: "Asia/Seoul", autoCollect: true, globalStop: false, searchReady: true, naverReady: false, sourceMode: "public_rss", inlineWorker: true, nextAt: "2026-11-02T10:13:00Z", lastScheduledAt: null,
  channels: [{ id: 2, version: 1, name: "하이스쿱", slug: "opportunities", active: true, queries: 4, discoveryQueries: 0, boards: 0, budget: 12, profile: null, newItems: 2, pending: 2, fetched: 0, lastRun: null, jobs: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
  card = { ...studioContentSchema.parse({ title: "입시 안내 초안", channel: "highscoop" }), id: 8, version: 1, sourceItemId: null, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" };
  mocks.save.mockResolvedValue(card);
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith("/collection/overview?")) return overview;
    if (path === "/collection/collect") return { requested: [{}], inline: true };
    if (path === "/settings/auto-collect") return { autoCollect: false };
    if (path === "/channels/2/discovery") return { discovery: settings };
    if (path === "/status") return { integrations: { aiConfigured: false } };
    if (path === "/studio/instagram/accounts") return { accounts };
    if (path === "/studio/instagram/oauth/config") return { configured: true, missing: [], appId: "123456", redirectUri: "https://studio.example/api/studio/instagram/oauth/callback" };
    if (path === "/studio/instagram/2/check") return { username: "highscoop.official", checkedAt: "2026-11-02T00:00:00Z" };
    if (path === "/studio/cards/8/publication") return { channelId: 2, channelName: "하이스쿱", expectedUsername: "highscoop.official", ready: true, blockers: [], dailyLimit: 3, dryRun: false, autoPublish: false, destinations: accounts[1].destinations, deliveries: [] };
    throw new Error(`Unexpected API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); document.getElementById("workroom-mode")?.remove(); });
function privateMode() { const marker = document.createElement("div"); marker.id = "workroom-mode"; document.body.prepend(marker); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === text)!; }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");

describe("비공개 작업실의 사용 가능한 동작", () => {
  it("uses only the gateway marker to identify the private workroom", () => {
    expect(isPrivateWorkroom()).toBe(false);
    privateMode(); expect(isPrivateWorkroom()).toBe(true);
    document.getElementById("workroom-mode")!.remove(); expect(isPrivateWorkroom()).toBe(false);
  });

  it("shows the schedule without an active schedule control and keeps manual collection usable", async () => {
    privateMode(); await render(createElement(CollectionPanel, { detailed: true }));
    const auto = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(auto.checked).toBe(true); expect(auto.disabled).toBe(true);
    expect(host.textContent).toContain("예약 수집 설정을 바꿀 수 없어요");
    expect(host.textContent).toContain("다음 예약");
    await act(async () => auto.click()); expect(writes()).toEqual([]);
    await act(async () => button("전체 채널 지금 수집").click());
    expect(mocks.api).toHaveBeenCalledWith("/collection/collect", { method: "POST", body: { channelId: "all" } });
    expect(writes().every(([path]) => path === "/collection/collect")).toBe(true);
  });

  it("shows saved discovery topics without mounting editing or save controls", async () => {
    privateMode(); await render(createElement(DiscoveryPanel, { cid: 2, kind: "science_dialogue", settings }));
    expect(host.textContent).toContain("청소년 과학"); expect(host.textContent).toContain("우주 탐사");
    expect(host.textContent).toContain("자동 발굴 설정을 바꿀 수 없어요");
    expect(host.querySelectorAll("input,textarea,button")).toHaveLength(0);
    expect(writes()).toEqual([]); expect(mocks.guard.setDirty).not.toHaveBeenCalled();
  });

  it("replaces publication with the correct channel account and only allows a read-only account check", async () => {
    privateMode(); await render(createElement(StudioPublish, { base: card, dirty: false, busy: false, save: mocks.save }));
    expect(host.textContent).toContain("초안 작업실"); expect(host.textContent).toContain("@highscoop.official");
    expect(host.textContent).not.toContain("@spacepenguin.co");
    expect(host.querySelector(".studio-publication")).toBeNull();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect([...host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["실제 계정 확인"]);
    await act(async () => button("실제 계정 확인").click()); await settle();
    expect(mocks.api).toHaveBeenCalledWith("/studio/instagram/2/check", { method: "POST", body: { destinationId: 20 } });
    expect(host.textContent).toContain("계정·게시 권한 확인 완료");
    expect(writes().every(([path]) => path === "/studio/instagram/2/check")).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not expose a credential form even if the connect component is mounted directly", async () => {
    privateMode(); await render(createElement(InstagramConnect, { channelId: 2, defaultUsername: "highscoop.official", onConnected: vi.fn() }));
    expect(host.textContent).toContain("계정 연결 정보를 변경할 수 없어요");
    expect(host.querySelectorAll("input,button")).toHaveLength(0); expect(writes()).toEqual([]);
  });

  it("keeps normal-mode schedule and discovery editing available", async () => {
    await render(createElement(CollectionPanel, { detailed: true }));
    const auto = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(auto.disabled).toBe(false); await act(async () => auto.click());
    expect(mocks.api).toHaveBeenCalledWith("/settings/auto-collect", { method: "PUT", body: { enabled: false } });
    await render(createElement(DiscoveryPanel, { cid: 2, kind: "science_dialogue", settings }));
    const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(input).not.toBeNull();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "새 탐색 주제"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(button("저장").disabled).toBe(false); await act(async () => button("저장").click());
    expect(mocks.api).toHaveBeenCalledWith("/channels/2/discovery", { method: "PUT", body: { ...settings, queries: ["새 탐색 주제"] } });
  });

  it("keeps normal-mode publication and account connection controls", async () => {
    await render(createElement(StudioPublish, { base: card, dirty: false, busy: false, save: mocks.save }));
    expect(host.querySelector(".studio-publication")).not.toBeNull();
    expect(button("저장하고 발행 미리보기")).toBeDefined();
    await render(createElement(InstagramAccounts, { channelId: 2 }));
    await act(async () => button("연결 정보 확인·갱신").click()); await settle();
    expect(button("Instagram으로 연결")).toBeDefined();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await act(async () => button("이미 발급한 토큰으로 연결").click());
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(button("계정 확인하고 연결")).toBeDefined(); expect(writes()).toEqual([]);
  });
});
