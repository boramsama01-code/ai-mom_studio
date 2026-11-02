// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPage } from "../client/src/pages/ItemDetail";
import { PublishPage } from "../client/src/pages/Publish";
import { StudioPublish } from "../client/src/pages/StudioPublish";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import type { PublicationRuntime } from "../client/src/publicationStatus";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), blob: vi.fn(), toast: vi.fn(), navigate: vi.fn(), search: "tab=delivery", scroll: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: vi.fn((action: () => void) => action()) },
}));
const channel = { id: 2, slug: "opportunities", name: "하이스쿱", active: true, accentColor: "#285f6a" };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", allChannels: [channel], channels: [channel] }), useDirtyGuard: () => mocks.guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => mocks.search }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "builtin:classic", items: [] } }), TemplatePicker: () => null }));
vi.mock("../client/src/CardCarousel", () => ({ CardCarousel: () => null }));
vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement, root: Root, client: QueryClient;
let detail: any, runtime: PublicationRuntime, orphanRows: any[], studioStatus: any;
const past = "2025-01-01T00:00:00.000Z";
const future = "2099-01-01T00:00:00.000Z";
const expectedUrl = "https://www.instagram.com/p/test-post/";
const card: StudioCard = { ...studioContentSchema.parse({ title: "발행 상태 테스트", channel: "highscoop" }), id: 8, version: 1, sourceItemId: null, createdAt: past, updatedAt: past };

function itemFixture() {
  return {
    item: { id: 9, channelId: 2, title: "승인한 콘텐츠", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 4, reviewStatus: "reviewed", evidenceStatus: "official_confirmed", relevance: "relevant", publishStatus: "scheduled", excluded: false, edited: {}, canvaDesign: null },
    primary: null, linked: [], current: { id: 4, revisionNo: 1, payload: { title: "승인한 콘텐츠" } }, revisions: [{ id: 4, revisionNo: 1 }],
    cards: [{ id: 40, revisionId: 4, sha256: "test", createdAt: past, cloudinaryUrl: null }],
    approvals: [{ id: 10, revisionId: 4, scheduledAt: past, status: "active" }],
    deliveries: [{ d: { id: 100, approvalId: 10, status: "scheduled", lastError: null, externalUrl: null, completedAt: null }, dest: { label: "@highscoop.official", platform: "instagram" } }],
    similar: [], defaultCaptions: { instagram: "확인한 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 3, expectedUsername: "highscoop.official", destinations: [{ id: 20, label: "@highscoop.official", platform: "instagram", configured: true }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.search = "tab=delivery"; detail = itemFixture(); orphanRows = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:publication-card-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  runtime = { integrations: { flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
  studioStatus = { channelId: 2, channelName: "하이스쿱", expectedUsername: "highscoop.official", ready: true, blockers: [], dailyLimit: 3, dryRun: false, autoPublish: true, destinations: [{ id: 20, label: "@highscoop.official", enabled: true, configured: true }], deliveries: [] };
  HTMLElement.prototype.scrollIntoView = function () { mocks.scroll(this.id); };
  mocks.api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === "/status") return structuredClone(runtime);
    if (path === "/channels/2/items/9") return structuredClone(detail);
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: false, openai: false, anthropic: false } };
    if (path === "/channels/2/items/9/card-copy") return {
      version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: true,
      copy: { version: 1, templateKey: "builtin:classic", cover: { title: detail.item.title, subtitle: "확인한 원고" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 제목 ${i + 1}`, subtitle: "", body: `원문에 근거한 본문 ${i + 1}` })) },
    };
    if (path === "/canva/status") return { connected: false };
    if (path === "/channels/2/items/9/approve" && options?.method === "POST") {
      detail = { ...detail, approvals: [{ id: 11, revisionId: 4, scheduledAt: future, status: "active" }], deliveries: [{ d: { id: 101, approvalId: 11, status: "scheduled", lastError: null, externalUrl: null, completedAt: null }, dest: { label: "@highscoop.official", platform: "instagram" } }] };
      return { ok: true, destinations: 1, approval: detail.approvals[0] };
    }
    if (path === "/deliveries?channelId=all") return detail.deliveries.map((row: any) => ({ ...structuredClone(row), ap: detail.approvals.find((a: any) => a.id === row.d.approvalId), item: detail.item }));
    if (path === "/publication-orphans?channelId=all") return structuredClone(orphanRows);
    if (path === "/studio/cards/8/publication") return structuredClone(studioStatus);
    throw new Error(`Unexpected API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); });

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(40); else await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function render(element: ReactNode) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const result = [...host.querySelectorAll("button")].find(b => b.textContent === text); if (!result) throw new Error(`Missing button: ${text}`); return result; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");

describe("승인 저장과 실제 전송의 구분", () => {
  it("opens the actual delivery records from the next action, preserving the dirty guard", async () => {
    mocks.search = "";
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    await click("3 카드·승인");
    const next = host.querySelector<HTMLButtonElement>(".next-action-bottom button")!;
    expect(next.textContent).toBe("전송 상태");
    mocks.guard.confirmLeave.mockClear();
    await act(async () => next.click()); await settle();
    expect(mocks.guard.confirmLeave).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#delivery-panel")).not.toBeNull();
    expect(host.querySelector("#card-panel")).toBeNull();
    expect(document.activeElement?.id).toBe("delivery-panel");
    expect(mocks.scroll).toHaveBeenLastCalledWith("delivery-panel");
    expect(host.textContent).toContain("예약 시각 지남 · 전송 대기");
    expect(writes()).toEqual([]);
  });

  it("opens a linked delivery tab directly and shows why an approval with zero deliveries will not publish", async () => {
    detail.deliveries = [];
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe("tab-delivery");
    expect(host.textContent).toContain("승인 저장됨");
    expect(host.textContent).toContain("전송 예약이 없습니다");
    expect(host.querySelector('a[href="/instagram"]')).not.toBeNull();
    expect(host.textContent).not.toContain("예약 시각 이후 워커가 게시합니다");
    expect(host.textContent).not.toContain("이 목적지만 재시도");
    expect(writes()).toEqual([]);
  });

  it("blocks another approval when the server reports missing publication permissions", async () => {
    detail.publicationReadiness = { ...detail.publicationReadiness, ready: false, blockers: ["@highscoop.official의 Instagram 게시 권한을 연결하세요."] };
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 })); await click("3 카드·승인");
    expect(button("이 버전·카드·캡션으로 최종 승인").disabled).toBe(true);
    expect(host.textContent).toContain("Instagram 게시 권한을 연결하세요");
    await act(async () => button("이 버전·카드·캡션으로 최종 승인").click());
    expect(writes()).toEqual([]);
  });

  it("blocks duplicate requests for the same revision while allowing an approval with no delivery to be approved again", async () => {
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    for (const status of ["scheduled", "processing", "succeeded", "unknown"]) {
      detail.deliveries[0].d.status = status;
      await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); });
      await click("3 카드·승인");
      expect(button("이 버전·카드·캡션으로 최종 승인").disabled, status).toBe(true);
      if (status === "scheduled") expect(host.textContent).toContain("기존 예약을 취소한 뒤 다시 승인");
      await click("전송 상태 확인");
      expect(host.querySelector("#delivery-panel")).not.toBeNull();
    }
    for (const status of ["failed", "dry_run"]) {
      detail.deliveries[0].d.status = status;
      await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); });
      await click("3 카드·승인");
      expect(button("이 버전·카드·캡션으로 최종 승인").disabled, status).toBe(false);
    }
    detail.deliveries = [];
    await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); }); await settle();
    expect(button("이 버전·카드·캡션으로 최종 승인").disabled).toBe(false);
    expect(host.textContent).not.toContain("이미 전송 예약이 있습니다");
    expect(writes()).toEqual([]);
  });

  it("moves to the persisted delivery record after approval without calling it a successful post", async () => {
    detail.approvals = []; detail.deliveries = []; detail.item.publishStatus = "waiting";
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 })); await click("3 카드·승인");
    await click("이 버전·카드·캡션으로 최종 승인");
    expect(host.querySelector("#delivery-panel")).not.toBeNull();
    expect(host.textContent).toContain("승인 #11");
    expect(host.textContent).toContain("예약 대기 · 아직 게시 안 됨");
    expect(host.querySelector('a[href="' + expectedUrl + '"]')).toBeNull();
    expect(writes().map(([path]) => path)).toEqual(["/channels/2/items/9/approve"]);
    expect(mocks.toast).toHaveBeenLastCalledWith("ok", expect.stringContaining("전송 예약을 저장했습니다"));
  });

  it("refreshes waiting records automatically and replaces the stale scheduled state with the actual failure", async () => {
    vi.useFakeTimers();
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    detail.deliveries[0].d = { ...detail.deliveries[0].d, status: "failed", lastError: "Instagram access token에 게시 권한이 없습니다." };
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); }); await settle();
    expect(host.textContent).toContain("전송 실패");
    expect(host.textContent).toContain("Instagram access token에 게시 권한이 없습니다.");
    expect(host.textContent).not.toContain("예약 시각 지남 · 전송 대기");
    expect(mocks.api.mock.calls.filter(([path]) => path === "/channels/2/items/9").length).toBeGreaterThan(1);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["dry_run", "모의 실행 완료 · 실제 게시 안 함"],
    ["unknown", "게시 여부 확인 필요"],
    ["succeeded", "게시 성공"],
  ])("shows the %s result independently from saved approval", async (status, label) => {
    detail.deliveries[0].d.status = status;
    if (status === "succeeded") detail.deliveries[0].d.externalUrl = expectedUrl;
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    expect([...host.querySelectorAll("#delivery-panel .badge")].map(el => el.textContent)).toContain(label);
    expect(!!host.querySelector(`a[href="${expectedUrl}"]`)).toBe(status === "succeeded");
    expect(writes()).toEqual([]);
  });
});

describe("발행함과 제작 보드의 전송 상태", () => {
  it("shows overdue records immediately and links to the record tab instead of the source editor", async () => {
    await render(createElement(PublishPage));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("목록");
    expect(host.textContent).toContain("승인한 콘텐츠");
    expect(host.textContent).toContain("예약 시각 지남 · 전송 대기");
    expect(host.querySelector('a.title')?.getAttribute("href")).toBe("/items/2/9?tab=delivery");
    await click("주간 달력");
    expect(host.textContent).toContain("예약 시각이 지났지만 아직 전송하지 않은 건이 1건");
    expect(button("지난 예약을 포함한 목록 보기")).toBeDefined();
    expect(writes()).toEqual([]);
  });

  it("keeps zero-delivery approvals visible using the separate backward-compatible endpoint", async () => {
    detail.deliveries = [];
    orphanRows = [{ ap: detail.approvals[0], item: detail.item, reason: "활성 게시 목적지가 없어 전송 예약이 만들어지지 않았습니다." }];
    await render(createElement(PublishPage));
    expect(host.textContent).toContain("승인 저장됨 · 전송 예약 없음");
    expect(host.textContent).toContain("활성 게시 목적지가 없어 전송 예약이 만들어지지 않았습니다.");
    expect(host.textContent).not.toContain("선택한 채널에 전송 예약이 없습니다.");
    expect(host.querySelector('a.title')?.getAttribute("href")).toBe("/items/2/9?tab=delivery");
    expect(mocks.api).toHaveBeenCalledWith("/publication-orphans?channelId=all");
    expect(writes()).toEqual([]);
  });

  it.each([
    [{ integrations: { flags: { dryRun: true, autoPublish: false } } }, "모의 실행 · 실제 게시 안 함"],
    [{ integrations: { flags: { dryRun: false, autoPublish: false } } }, "실제 게시 꺼짐"],
    [{ integrations: { flags: { dryRun: false, autoPublish: true } }, globalStop: true }, "전체 발행 일시 정지"],
    [{ integrations: { flags: { dryRun: false, autoPublish: true } }, workerConnected: false }, "게시 실행기 확인 필요"],
  ])("explains the current runtime condition: %s", async (status, message) => {
    runtime = status;
    await render(createElement(PublishPage));
    expect(host.textContent).toContain(message);
    expect(writes()).toEqual([]);
  });

  it("shows simulated and failed Studio attempts with timestamps and failure details", async () => {
    studioStatus.deliveries = [{ id: 1, status: "dry_run", lastError: null, externalUrl: null, scheduledAt: past }, { id: 2, status: "failed", lastError: "연결된 계정에 게시 권한이 없습니다.", externalUrl: null, scheduledAt: past }];
    await render(createElement(StudioPublish, { base: card, dirty: false, busy: false, save: vi.fn().mockResolvedValue(card) }));
    expect(host.textContent).toContain("모의 실행 완료 · 실제 게시 안 함");
    expect(host.textContent).toContain("전송 실패");
    expect(host.textContent).toContain("연결된 계정에 게시 권한이 없습니다.");
    expect(host.textContent).toContain("2025-01-01 09:00");
    expect(host.querySelector('a[href="/instagram"]')).not.toBeNull();
    expect(writes()).toEqual([]);
  });
});
