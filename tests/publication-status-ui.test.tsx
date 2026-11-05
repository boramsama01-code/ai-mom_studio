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
    publicationDraft: { version: 1, captions: { instagram: "확인한 캡션", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } },
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
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/status") return structuredClone(runtime);
    if (path === "/channels/2/items/9") return structuredClone(detail);
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: false, openai: false, anthropic: false } };
    if (path === "/channels/2/items/9/card-copy") return {
      version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: true,
      copy: { version: 1, templateKey: "builtin:classic", cover: { title: detail.item.title, subtitle: "확인한 원고" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 제목 ${i + 1}`, subtitle: "", body: `원문에 근거한 본문 ${i + 1}` })) },
    };
    if (path === "/canva/status") return { connected: false };
    if (path === "/channels/2/items/9/approve" && options?.method === "POST") {
      detail = { ...detail, approvals: [{ id: 11, revisionId: 4, scheduledAt: options.body?.timing === "later" ? options.body.scheduledAt : new Date().toISOString(), status: "active" }], deliveries: [{ d: { id: 101, approvalId: 11, status: "scheduled", lastError: null, externalUrl: null, completedAt: null }, dest: { label: "@highscoop.official", platform: "instagram" } }] };
      return { ok: true, destinations: 1, approval: detail.approvals[0], timing: options.body?.timing, workerStarted: options.body?.timing === "now" };
    }
    if (path.startsWith("/deliveries?")) return detail.deliveries.map((row: any) => ({ ...structuredClone(row), ap: detail.approvals.find((a: any) => a.id === row.d.approvalId), item: detail.item }));
    if (path.startsWith("/publication-orphans?")) return structuredClone(orphanRows);
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
async function goTo(text: string) {
  const control = [...host.querySelectorAll<HTMLButtonElement>(".content-workspace-nav button")].find(node => node.textContent === text);
  if (!control) throw new Error(`Missing workspace navigation: ${text}`);
  await act(async () => control.click()); await settle();
}
async function confirmPublication() {
  const control = host.querySelector<HTMLInputElement>(".publish-confirm input")!;
  expect(control.disabled).toBe(false);
  if (!control.checked) await act(async () => control.click());
  await settle();
}
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");

describe("승인 저장과 실제 전송의 구분", () => {
  it("opens delivery records in place while preserving the mounted editor and its dirty guard", async () => {
    mocks.search = "";
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    const editor = host.querySelector("#card-panel");
    const title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(title, "저장하기 전 입력"); title.dispatchEvent(new Event("input", { bubbles: true })); });
    mocks.guard.confirmLeave.mockClear();
    await goTo("전송 상태");
    expect(mocks.guard.confirmLeave).not.toHaveBeenCalled();
    expect(mocks.guard.setDirty).toHaveBeenCalledWith("card-copy-2-9", true, expect.any(Function), expect.any(Function));
    expect(host.querySelector("#delivery-panel")).not.toBeNull();
    expect(host.querySelector("#card-panel")).toBe(editor);
    expect(host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')?.value).toBe("저장하기 전 입력");
    expect(host.querySelector("#delivery-panel")?.closest("details")?.open).toBe(true);
    expect(document.activeElement?.id).toBe("delivery-panel");
    expect(mocks.scroll).toHaveBeenLastCalledWith("delivery-panel");
    expect(host.textContent).toContain("예약 시각 지남 · 전송 대기");
    expect(writes()).toEqual([]);
  });

  it("opens a linked delivery drawer directly and explains an approval with zero deliveries", async () => {
    detail.deliveries = [];
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector("#delivery-panel")?.closest("details")?.open).toBe(true);
    expect(host.querySelector("#card-panel")).not.toBeNull();
    expect(host.textContent).toContain("승인 저장됨");
    expect(host.textContent).toContain("전송 예약이 없습니다");
    expect(host.querySelector('a[href="/instagram"]')).not.toBeNull();
    expect(host.textContent).not.toContain("예약 시각 이후 워커가 게시합니다");
    expect(host.textContent).not.toContain("이 목적지만 재시도");
    expect(writes()).toEqual([]);
  });

  it("blocks another approval when the server reports missing publication permissions", async () => {
    detail.publicationReadiness = { ...detail.publicationReadiness, ready: false, blockers: ["@highscoop.official의 Instagram 게시 권한을 연결하세요."] };
    detail.deliveries = []; detail.approvals = [];
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 })); await goTo("게시 준비"); await confirmPublication();
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    expect(host.textContent).toContain("Instagram 게시 권한을 연결하세요");
    await act(async () => button("승인하고 지금 게시").click());
    expect(writes()).toEqual([]);
  });

  it("blocks duplicate requests for the same revision while allowing an approval with no delivery to be approved again", async () => {
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    await goTo("게시 준비"); await confirmPublication();
    for (const status of ["scheduled", "processing", "succeeded", "unknown"]) {
      detail.deliveries[0].d.status = status;
      await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); });
      await goTo("게시 준비"); await confirmPublication();
      expect(button("승인하고 지금 게시").disabled, status).toBe(true);
      if (status === "scheduled") expect(host.textContent).toContain("기존 예약을 취소한 뒤 다시 승인");
      await click("전송 상태 확인");
      expect(host.querySelector("#delivery-panel")).not.toBeNull();
    }
    for (const status of ["failed", "dry_run"]) {
      detail.deliveries[0].d.status = status;
      await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); });
      await goTo("게시 준비"); await confirmPublication();
      expect(button("승인하고 지금 게시").disabled, status).toBe(false);
    }
    detail.deliveries = [];
    await act(async () => { client.setQueryData(["ch", 2, "item", 9], structuredClone(detail)); }); await settle();
    expect(button("승인하고 지금 게시").disabled).toBe(false);
    expect(host.textContent).not.toContain("이미 전송 예약이 있습니다");
    expect(writes()).toEqual([]);
  });

  it("moves to the persisted delivery record after approval without calling it a successful post", async () => {
    detail.approvals = []; detail.deliveries = []; detail.item.publishStatus = "waiting";
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 })); await goTo("게시 준비");
    expect(host.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    await confirmPublication(); await click("승인하고 지금 게시");
    expect(host.querySelector("#delivery-panel")).not.toBeNull();
    expect(host.textContent).toContain("승인 #11");
    expect(host.querySelector("#delivery-panel")?.textContent).toContain("전송 대기");
    expect(host.querySelector("#delivery-panel")?.closest("details")?.open).toBe(true);
    expect(host.querySelector("#card-panel")).not.toBeNull();
    expect(host.querySelector('a[href="' + expectedUrl + '"]')).toBeNull();
    expect(writes().map(([path]) => path)).toEqual(["/channels/2/items/9/approve"]);
    expect(writes()[0][1]?.body).toMatchObject({ timing: "now", revisionId: 4, mediaAssetId: 40 });
    expect(writes()[0][1]?.body).not.toHaveProperty("scheduledAt");
    expect(mocks.toast).toHaveBeenLastCalledWith("ok", expect.stringContaining("바로 게시하도록 요청"));
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
  it("keeps week navigation usable on an empty or failed week and resets the visible filters", async () => {
    detail.deliveries = [];
    const fallback = mocks.api.getMockImplementation()!;
    let failRange = false;
    mocks.api.mockImplementation(async (path, options) => {
      if (failRange && path.startsWith("/deliveries?") && new URL(path, "https://fixture.invalid").searchParams.has("from")) throw new Error("해당 주 전송 목록을 불러오지 못했습니다.");
      return fallback(path, options);
    });
    await render(createElement(PublishPage)); await click("주간 달력");
    expect(host.textContent).toContain("선택한 조건에 맞는 전송이 없습니다.");
    const week = () => host.querySelector('[aria-label="발행 주간 이동"] strong')!.textContent;
    const initialWeek = week();
    await click("다음 주 →"); expect(week()).not.toBe(initialWeek);
    await click("← 이전 주"); expect(week()).toBe(initialWeek);
    failRange = true; await click("← 이전 주");
    expect(host.textContent).toContain("해당 주 전송 목록을 불러오지 못했습니다.");
    expect(button("다음 주 →").disabled).toBe(false);
    failRange = false; await click("다음 주 →");
    expect(week()).toBe(initialWeek); await click("필터 초기화");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("목록");
    expect(host.querySelector('[aria-label="발행 주간 이동"]')).toBeNull();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="전송 상태 필터"]')!.value).toBe("");
    expect(writes()).toEqual([]);
  });
  it.each(["publish", "item", "studio"])("shows a flagged late result and disables reconciliation during processing in %s", async screen => {
    detail.deliveries[0].d = { ...detail.deliveries[0].d, status: "processing", needsReconciliation: true };
    studioStatus.deliveries = [{ ...detail.deliveries[0].d, scheduledAt: past, approvalStatus: "active" }];
    await render(screen === "publish" ? createElement(PublishPage) : screen === "item" ? createElement(ItemDetailPage, { cid: 2, id: 9 }) : createElement(StudioPublish, { base: card, dirty: false, busy: false, save: vi.fn().mockResolvedValue(card) }));
    expect([...host.querySelectorAll(".badge")].map(node => node.textContent)).toContain("전송 중 · 이전 결과 확인 필요");
    expect(host.textContent).toContain("현재 전송 종료 후 확인이 필요합니다.");
    expect(button("게시 결과 다시 확인").disabled).toBe(true);
    if (screen === "publish") expect(host.textContent).toContain("확인하거나 복구할 전송이 1건 있습니다.");
    expect(writes()).toEqual([]);
  });
  it("uses server totals and status pagination to find an old unresolved delivery beyond the first hundred", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...structuredClone(detail.deliveries[0]),
      d: { ...structuredClone(detail.deliveries[0].d), id: 1000 + index, status: index === 124 ? "unknown" : "scheduled" },
      ap: detail.approvals[0], item: { ...detail.item, title: index === 124 ? "오래된 결과 미확정 콘텐츠" : `예약 ${index + 1}` },
      canonicalStudioCardId: index === 124 ? 88 : null,
    }));
    mocks.api.mockImplementation(async (path, options) => {
      if (path.startsWith("/deliveries?")) {
        const query = new URL(path, "https://fixture.invalid").searchParams;
        const page = Number(query.get("page")); const size = Number(query.get("pageSize"));
        const states = query.get("status")?.split(",");
        const filtered = rows.filter(row => !states || states.includes(row.d.status));
        return { items: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, pageSize: size, counts: { unknown: 1, scheduled: 124, needsAttention: 1, overdue: 124 } };
      }
      return fallback(path, options);
    });
    await render(createElement(PublishPage));
    expect(host.textContent).toContain("조회 결과 총 125건 · 이 페이지 30건");
    expect(host.textContent).not.toContain("오래된 결과 미확정 콘텐츠");
    await click("다음");
    expect(mocks.api.mock.calls.some(([path]) => path.startsWith("/deliveries?") && path.includes("page=2"))).toBe(true);
    await click("실패·확인 필요부터 보기");
    expect(host.textContent).toContain("조회 결과 총 1건 · 이 페이지 1건");
    expect(host.textContent).toContain("오래된 결과 미확정 콘텐츠");
    expect(host.querySelector('a.title')?.getAttribute("href")).toBe("/studio/88?tab=delivery");
    expect(writes()).toEqual([]);
  });
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
    expect(host.textContent).toContain("전송 예약 없음 1건");
    await click("승인만 저장된 기록 보기");
    expect(host.textContent).toContain("승인 저장됨 · 전송 예약 없음");
    expect(host.textContent).toContain("활성 게시 목적지가 없어 전송 예약이 만들어지지 않았습니다.");
    expect(host.textContent).not.toContain("선택한 채널에 전송 예약이 없습니다.");
    expect(host.querySelector('a.title')?.getAttribute("href")).toBe("/items/2/9?tab=delivery");
    expect(mocks.api.mock.calls.some(([path]) => path.startsWith("/publication-orphans?channelId=all") && path.includes("page=1") && path.includes("pageSize=30"))).toBe(true);
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
    studioStatus.deliveries = [{ id: 1, approvalId: 10, approvalStatus: "active", status: "dry_run", lastError: null, externalUrl: null, scheduledAt: past }, { id: 2, approvalId: 10, approvalStatus: "active", status: "failed", lastError: "연결된 계정에 게시 권한이 없습니다.", externalUrl: null, scheduledAt: past }];
    await render(createElement(StudioPublish, { base: card, dirty: false, busy: false, save: vi.fn().mockResolvedValue(card) }));
    expect(host.textContent).toContain("모의 실행 완료 · 실제 게시 안 함");
    expect(host.textContent).toContain("전송 실패");
    expect(host.textContent).toContain("연결된 계정에 게시 권한이 없습니다.");
    expect(host.textContent).toContain("2025-01-01 09:00");
    expect(host.querySelector('a[href="/instagram"]')).not.toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe("발행함 보관·삭제·복원", () => {
  function enableOrganization() {
    detail.deliveries = [
      { d: { id: 100, approvalId: 10, status: "succeeded", listState: "active", listVersion: 1, lastError: null, externalId: "proof-100", externalUrl: expectedUrl, completedAt: past }, dest: { label: "@highscoop.official", platform: "instagram" } },
      { d: { id: 101, approvalId: 10, status: "processing", listState: "active", listVersion: 1, lastError: null, externalUrl: null, completedAt: null }, dest: { label: "전송 중 계정", platform: "instagram" } },
    ];
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
      if (path.startsWith("/deliveries?")) {
        const view = new URL(path, "https://fixture.invalid").searchParams.get("view") || "active";
        return detail.deliveries.filter((row: any) => row.d.listState === view).map((row: any) => ({ ...structuredClone(row), ap: detail.approvals[0], item: detail.item }));
      }
      if (path === "/channels/2/deliveries/organize") {
        const items = options!.body.records.map((record: any) => {
          const row = detail.deliveries.find((value: any) => value.d.id === record.id)!;
          const previousState = row.d.listState;
          expect(record.version).toBe(row.d.listVersion);
          row.d.listState = options!.body.state; row.d.listVersion++;
          return { id: row.d.id, channelId: 2, listState: row.d.listState, listVersion: row.d.listVersion, previousState };
        });
        return { updated: items.length, items };
      }
      return original(path, options);
    });
  }

  it("moves a posted test record to trash, preserves its SNS link, and restores it without resending", async () => {
    enableOrganization(); await render(createElement(PublishPage));
    expect(host.querySelectorAll('input[aria-label$="발행 기록 선택"]')).toHaveLength(1);
    await click("삭제");
    expect(detail.deliveries[0].d).toMatchObject({ status: "succeeded", externalId: "proof-100", externalUrl: expectedUrl, listState: "trashed" });
    expect(host.querySelector(`a[href="${expectedUrl}"]`)).toBeNull();
    await click("휴지통");
    expect(host.querySelector(`a[href="${expectedUrl}"]`)).not.toBeNull();
    expect(host.textContent).toContain("SNS의 게시물은 ‘게시물 보기’를 열어 직접 삭제하거나 보관");
    await click("복원"); await click("발행 목록");
    expect(detail.deliveries[0].d.listState).toBe("active");
    expect(writes().map(([path, options]) => [path, options.body.state])).toEqual([["/channels/2/deliveries/organize", "trashed"], ["/channels/2/deliveries/organize", "active"]]);
  });

  it("selects only completed records and supports undo from the archive toast", async () => {
    enableOrganization(); await render(createElement(PublishPage));
    const select = host.querySelector<HTMLInputElement>('input[aria-label="이 페이지에서 정리 가능한 기록 모두 선택"]')!;
    await act(async () => select.click()); await settle();
    await click("선택 보관");
    expect(writes()[0][1].body).toEqual({ state: "archived", records: [{ id: 100, version: 1 }] });
    expect(detail.deliveries[1].d.listState).toBe("active");
    const undo = mocks.toast.mock.calls.find(([, , action]) => action?.label === "실행 취소")![2].onClick;
    await act(async () => { await undo(); }); await settle();
    expect(detail.deliveries[0].d.listState).toBe("active");
    expect(writes()).toHaveLength(2);
    expect(writes().every(([path]) => path.endsWith("/deliveries/organize"))).toBe(true);
  });

  it("keeps a stale record visible and reports an organization conflict", async () => {
    enableOrganization(); const previous = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path: string, options?: any) => { if (path.endsWith("/deliveries/organize")) throw new Error("다른 화면에서 발행 목록을 변경했습니다."); return previous(path, options); });
    await render(createElement(PublishPage)); await click("삭제");
    expect(host.textContent).toContain("다른 화면에서 발행 목록을 변경했습니다.");
    expect(detail.deliveries[0].d.listState).toBe("active");
    expect(host.querySelector(`a[href="${expectedUrl}"]`)).not.toBeNull();
  });
});
