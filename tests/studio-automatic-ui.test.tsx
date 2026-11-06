// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioPage } from "../client/src/pages/Studio";
import { studioContentSchema, type StudioCardDetail, type StudioJob } from "../shared/studio";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), navigate: vi.fn(), writer: "openai", guard: { setDirty: vi.fn(), confirmLeave: (next: () => void) => next() } }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ allChannels: [{ id: 1, slug: "penguin", name: "우주펭귄상회", active: true, accentColor: "#285f6a", categories: null, aiSettings: { summary: { provider: "gemini", model: "" }, copy: { provider: mocks.writer, model: "" }, image: { provider: "openai", model: "" } } }], channels: [], selected: "all", select: vi.fn() }) }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/studio/8", mocks.navigate], useSearch: () => window.location.search.slice(1) }));
vi.mock("../client/src/pages/StudioExport", () => ({ StudioExport: () => null, StudioQuickExport: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, detail: StudioCardDetail, connected: boolean;
const time = "2026-11-04T00:00:00Z";
const job = (status: string, result: Record<string, unknown> | null = null): StudioJob => ({ id: 77, status, result, lastError: status === "failed" ? "OpenAI HTTP 429: API 선불 크레딧이 소진되었습니다." : null, createdAt: time, finishedAt: null });
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); history.replaceState(null, "", "/studio/8"); connected = true; mocks.writer = "openai";
  detail = { card: { ...studioContentSchema.parse({ title: "자동 이미지 작업", characters: [], format: "카드뉴스", stage: "making", script: "전체 원고 유지", caption: "내 캡션", panels: Array.from({ length: 4 }, (_, index) => ({ scene: `장면 ${index + 1}`, dialogue: `본문 ${index + 1}`, imageId: index === 0 ? 91 : null })) }), id: 8, version: 1, sourceItemId: null, createdAt: time, updatedAt: time }, revisions: [], jobs: [] };
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/studio/cards") return { cards: [detail.card], notes: "", notesVersion: 1, ai: { defaultProvider: "openai", text: { openai: connected, gemini: connected, anthropic: connected }, image: connected } };
    if (path === "/studio/cards/8") {
      if (options?.method === "PATCH") { detail = { ...detail, card: { ...detail.card, ...options.body, version: detail.card.version + 1 } }; return structuredClone(detail.card); }
      return structuredClone(detail);
    }
    if (path === "/studio/cards/8/generate") { const next = job("queued"); detail = { ...detail, jobs: [next] }; return { job: next, duplicate: false }; }
    if (path === "/jobs/77/cancel") { detail = { ...detail, jobs: detail.jobs.map(current => ({ ...current, status: "cancelled" })) }; return { cancelled: true }; }
    throw new Error(`Unexpected isolated request: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let index = 0; index < 35; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (!client.isFetching() && !client.isMutating()) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (!client.isFetching() && !client.isMutating()) return; } } throw new Error("Mock UI did not settle"); }
async function render() { await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(StudioPage, { cardId: 8 })))); await settle(); }
function visibleButton(text: string) { const found = [...host.querySelectorAll("button")].find(button => button.textContent?.includes(text) && !button.closest("[hidden]")); if (!found) throw new Error(`Missing button ${text}`); return found; }
async function click(text: string) { const button = visibleButton(text); expect(button.disabled).toBe(false); await act(async () => button.click()); await settle(); }
async function input(label: string, value: string) { const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
const paidRequests = () => mocks.api.mock.calls.filter(([path]) => String(path).endsWith("/generate"));
const imageModeButtons = () => host.querySelectorAll<HTMLButtonElement>('#studio-composition .work-mode-options button');

describe("automatic Studio image workflow", () => {
  it("defaults to in-app automatic images, displays saved art and never calls AI on mount", async () => {
    await render();
    expect(imageModeButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(visibleButton("빈 그림 3컷 자동 생성").disabled).toBe(false);
    expect(host.querySelector('img[alt="1컷 저장된 그림"]')?.getAttribute("src")).toBe("/api/studio/images/91");
    expect(paidRequests()).toHaveLength(0);
    expect(host.querySelector('#studio-composition textarea[aria-label="1컷 장면"]')).not.toBeNull();
  });
  it("keeps automatic selected with a missing key and lets the operator deliberately choose manual without losing edits", async () => {
    connected = false; await render();
    expect(imageModeButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(visibleButton("빈 그림 3컷 자동 생성").disabled).toBe(true);
    expect(host.textContent).toContain("OpenAI 연결이 필요합니다");
    await input("1컷 장면", "직접 고친 장면"); await click("수동으로 계속하기");
    expect(imageModeButtons()[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => imageModeButtons()[0].click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="1컷 장면"]')!.value).toBe("직접 고친 장면");
    expect(paidRequests()).toHaveLength(0);
  });
  it("saves first, batches only empty drawings and ignores a double click", async () => {
    await render(); await input("1컷 장면", "보존할 새 장면");
    await act(async () => { visibleButton("빈 그림 3컷 자동 생성").click(); visibleButton("빈 그림 3컷 자동 생성").click(); }); await settle();
    expect(paidRequests()).toHaveLength(1);
    expect(paidRequests()[0][1].body).toMatchObject({ version: 2, kind: "image", panelIndexes: [1, 2, 3], requestId: expect.any(String) });
    expect(detail.card.panels[0]).toMatchObject({ scene: "보존할 새 장면", imageId: 91 });
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH" || options?.method === "POST").map(([path]) => path)).toEqual(["/studio/cards/8", "/studio/cards/8/generate"]);
  });
  it("shows partial successes, cancel action and the retained picture after cancellation", async () => {
    detail.card = { ...detail.card, version: 2, panels: detail.card.panels.map((panel, index) => index === 1 ? { ...panel, imageId: 92 } : panel) };
    detail.jobs = [job("running", { kind: "image", panelIndexes: [1, 2, 3], panelIndex: null, completedPanels: [{ panelIndex: 1, imageId: 92, revisionId: 4, version: 2, applied: true }], remainingPanelIndexes: [2, 3], activePanelIndex: 2, applied: true, partial: true, message: "1/3컷을 저장했습니다." })];
    await render(); expect(host.textContent).toContain("저장 완료 1/3컷");
    await click("생성 중단 · 완료한 그림 유지");
    expect(mocks.api).toHaveBeenCalledWith("/jobs/77/cancel", { method: "POST", body: {} });
    expect(host.querySelector('img[alt="2컷 저장된 그림"]')?.getAttribute("src")).toBe("/api/studio/images/92");
    expect(host.textContent).toContain("저장한 그림과 원고는 유지됩니다");
    expect(paidRequests()).toHaveLength(0);
  });
  it("makes partial scene and copy changes explicit while retaining the previous drawing", async () => {
    await render(); await input("1컷 그림 추가 요청", "표정은 차분하게, 문구는 짧게");
    await click("이 컷 장면·문구만 자동 수정");
    expect(paidRequests()[0][1].body).toMatchObject({ kind: "text", textTarget: "panel", panelIndex: 0, instruction: "표정은 차분하게, 문구는 짧게" });
    expect(detail.card.panels[0].imageId).toBe(91);
    expect(detail.card.caption).toBe("내 캡션");
  });
  it("honors an explicit manual entry but can return to automatic without starting paid work", async () => {
    history.replaceState(null, "", "/studio/8?mode=manual"); await render();
    expect(imageModeButtons()[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => imageModeButtons()[0].click()); await settle();
    expect(imageModeButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(paidRequests()).toHaveLength(0);
  });
  it("takes the channel copy provider instead of the global preference and lets admission resolve its model", async () => {
    mocks.writer = "gemini"; await render();
    const select = host.querySelector<HTMLSelectElement>('[data-testid="studio-api-writing"] select')!;
    expect(select.value).toBe("gemini");
    expect(host.textContent).toContain("채널의 카드 문구 AI를 사용합니다");
    await click("이 컷 장면·문구만 자동 수정");
    expect(paidRequests()).toHaveLength(1);
    expect(paidRequests()[0][1].body).not.toHaveProperty("provider");
  });
  it("keeps an explicit provider override local and restores the channel preference without generating", async () => {
    mocks.writer = "gemini"; await render(); await click("이야기");
    const select = host.querySelector<HTMLSelectElement>('[data-testid="studio-api-writing"] select')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "anthropic"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(select.value).toBe("anthropic"); expect(host.textContent).toContain("이 작업에서 선택한 AI입니다");
    await click("채널 AI 설정 사용"); expect(select.value).toBe("gemini");
    expect(paidRequests()).toHaveLength(0);
  });
});
