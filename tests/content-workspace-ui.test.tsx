// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPage } from "../client/src/pages/ItemDetail";
import { SourceStudioCard } from "../client/src/pages/SourceStudioCard";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { ApiError } from "../client/src/api";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), blob: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: vi.fn((action: () => void) => action()) },
}));
const channel = { id: 2, slug: "highscoop", name: "하이스쿱", active: true, accentColor: "#285f6a" };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", allChannels: [channel], channels: [channel] }), useDirtyGuard: () => mocks.guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => [window.location.pathname, mocks.navigate], useSearch: () => window.location.search.slice(1) }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "builtin:classic", items: [] } }), TemplatePicker: () => null }));
vi.mock("../client/src/CardCarousel", () => ({ CardCarousel: () => null }));
vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement, root: Root, client: QueryClient, detail: any;
let readError: Error | null, sourceLoad: () => Promise<{ changed: boolean }>;
const itemPath = "/channels/2/items/9";
const itemKey = ["ch", 2, "item", 9];
const copy = { version: 1, templateKey: "builtin:classic", cover: { title: "직접 편집할 표지", subtitle: "확인한 부제" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 ${i + 1}`, subtitle: "", body: `카드별 원고 ${i + 1}` })) };
function reducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ matches, media, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => true) })));
}
function source(fetchStatus = "not_fetched", fetchedText: string | null = null, isSample = false) {
  return { id: 70, kind: "rss_direct", title: "선택한 원문", originalUrl: "https://example.com/article", meta: {}, fetchStatus, fetchedText, snippet: "목록에서 받은 짧은 요약", attachments: [], isSample, publishedAt: "2026-11-01T00:00:00Z", publishedPrecision: "day", publishedRaw: null, lastFetchedAt: null };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); readError = null; sourceLoad = async () => ({ changed: false });
  history.replaceState(null, "", "/items/2/9");
  detail = {
    item: { id: 9, channelId: 2, title: "하나의 제작 공간", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 4, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {} },
    primary: null, linked: [], current: { id: 4, revisionNo: 1, author: "operator", payload: { title: "하나의 제작 공간" } }, revisions: [],
    cards: [{ id: 40, revisionId: 4, sha256: "fixture", createdAt: "2026-11-01T00:00:00Z", cloudinaryUrl: null }],
    publicationDraft: { version: 1, captions: { instagram: "확인할 게시 캡션", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } },
    approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "확인할 게시 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 3, expectedUsername: "highscoop.official", destinations: [{ id: 20, label: "@highscoop.official", platform: "instagram", configured: true }] },
  };
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:workspace-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  reducedMotion(false);
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/status") return { integrations: { aiProvider: "gemini", gemini: true, openai: false, anthropic: false, flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false } };
    if (path === "/canva/status") return { connected: false };
    if (path === `${itemPath}/publication-draft` && options?.method === "PATCH") {
      detail.publicationDraft = { version: options.body.version + 1, captions: structuredClone(options.body.captions), options: structuredClone(options.body.options) };
      return structuredClone(detail.publicationDraft);
    }
    if (path === itemPath) { if (readError) throw readError; return structuredClone(detail); }
    if (path === `${itemPath}/card-copy`) return { version: 1, revisionId: 4, hasSavedCopy: true, copy: structuredClone(copy) };
    if (path === `${itemPath}/fetch` && options?.method === "POST") return sourceLoad();
    if (path === `${itemPath}/review` && options?.method === "POST") { detail.item.reviewStatus = options.body.status; return { ok: true }; }
    if (path === `${itemPath}/approve` && options?.method === "POST") return { ok: true, destinations: 1, timing: options.body.timing };
    throw new Error(`Unexpected API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode = createElement(ItemDetailPage, { cid: 2, id: 9 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll("button")].find(node => node.textContent === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
function workspaceNav(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>(".content-workspace-nav button")].find(node => node.textContent === text); if (!node) throw new Error(`Missing workspace navigation: ${text}`); return node; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function input(node: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }); await settle();
}
async function open(section: string) {
  const summary = [...host.querySelectorAll("summary")].find(node => node.textContent?.includes(section));
  if (!summary) throw new Error(`Missing section: ${section}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) await act(async () => summary.click());
  await settle();
}
async function refresh() { await act(async () => { await client.invalidateQueries({ queryKey: itemKey }); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
const fetches = () => mocks.api.mock.calls.filter(([path]) => path === `${itemPath}/fetch`);
function generationButton() { return [...host.querySelectorAll<HTMLButtonElement>("#edit-panel button")].find(node => node.textContent?.endsWith("로 초안 생성"))!; }
async function chooseTiming(text: "지금 게시" | "예약 게시") {
  const radio = [...host.querySelectorAll<HTMLLabelElement>(".publish-timing label")].find(node => node.textContent?.includes(text))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => radio.click()); await settle();
}
async function confirm() { const checkbox = host.querySelector<HTMLInputElement>(".publish-confirm input")!; expect(checkbox.disabled).toBe(false); if (!checkbox.checked) await act(async () => checkbox.click()); await settle(); }

describe("단일 콘텐츠 작업 공간", () => {
  const canonicalCard = (channelId = 2, itemId = 9): StudioCard => ({
    ...studioContentSchema.parse({ title: "자료에서 이어 쓰는 카드", channel: "highscoop", format: "카드뉴스" }),
    id: 36, version: 1, sourceItemId: itemId, sourceReference: { channelId, itemId },
    createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z",
  });
  const modeButton = (mode: "auto" | "manual") => host.querySelector<HTMLButtonElement>(`.content-workspace > .work-mode .work-mode-option:nth-child(${mode === "auto" ? 1 : 2})`)!;

  it("canonical 수동 URL로 열고 자동 선택·다른 서랍 이동·재조회 동안 미저장 입력과 선택을 유지한다", async () => {
    history.replaceState(null, "", "/studio/36?mode=manual");
    const element = createElement(SourceStudioCard, { card: canonicalCard() });
    await render(element);
    expect(modeButton("manual").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".card-copy-ai-tools")?.closest("[hidden]")).not.toBeNull();
    const editor = host.querySelector(".card-copy-editor"), title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "수동에서 이어 쓰는 미저장 원고");
    await act(async () => modeButton("auto").click()); await settle();
    expect(modeButton("auto").getAttribute("aria-pressed")).toBe("true");
    history.replaceState(null, "", "/studio/36?mode=manual&tab=source");
    await render(element); await refresh();
    expect(modeButton("auto").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".card-copy-editor")).toBe(editor); expect(title.value).toBe("수동에서 이어 쓰는 미저장 원고");
    expect(mocks.guard.setDirty).toHaveBeenCalledWith("card-copy-2-9", true, expect.any(Function), expect.any(Function));
    expect(writes()).toEqual([]); expect(mocks.guard.confirmLeave).not.toHaveBeenCalled();
  });

  it("동일 콘텐츠 URL 모드의 뒤로·앞으로 복귀는 반영하되 입력과 편집기를 바꾸지 않는다", async () => {
    const element = createElement(SourceStudioCard, { card: canonicalCard() });
    history.replaceState(null, "", "/studio/36?mode=manual"); await render(element);
    const editor = host.querySelector(".card-copy-editor"), title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "주소로 모드를 바꾸어도 남을 원고");
    for (const mode of ["auto", "manual", "auto"] as const) {
      history.replaceState(null, "", `/studio/36?mode=${mode}`); await render(createElement(SourceStudioCard, { card: canonicalCard() }));
      expect(modeButton(mode).getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector(".card-copy-editor")).toBe(editor); expect(title.value).toBe("주소로 모드를 바꾸어도 남을 원고");
    }
    expect(writes()).toEqual([]); expect(mocks.guard.confirmLeave).not.toHaveBeenCalled();
  });

  it("새 채널·콘텐츠로 이동하면 그 주소의 수동 모드를 따르고 모드 없는 새 진입은 자동으로 연다", async () => {
    const originalApi = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
      if (path === "/channels/3/items/10") return { ...structuredClone(detail), item: { ...detail.item, id: 10, channelId: 3 } };
      if (path === "/channels/3/items/10/card-copy") return { version: 1, revisionId: 4, hasSavedCopy: true, copy: structuredClone(copy) };
      return originalApi(path, options);
    });
    await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    await act(async () => modeButton("manual").click()); await settle();
    history.replaceState(null, "", "/items/3/10?mode=manual"); await render(createElement(ItemDetailPage, { cid: 3, id: 10 }));
    expect(modeButton("manual").getAttribute("aria-pressed")).toBe("true");
    await act(async () => modeButton("auto").click()); await settle();
    history.replaceState(null, "", "/items/2/9?mode=manual"); await render(createElement(ItemDetailPage, { cid: 2, id: 9 }));
    expect(modeButton("manual").getAttribute("aria-pressed")).toBe("true");
    history.replaceState(null, "", "/items/3/10"); await render(createElement(ItemDetailPage, { cid: 3, id: 10 }));
    expect(modeButton("auto").getAttribute("aria-pressed")).toBe("true");
    expect(writes()).toEqual([]);
  });

  it("카드 편집기를 상시 유지하고 자료·게시·전송을 접은 상태에서 필요할 때 연다", async () => {
    await render();
    expect(host.querySelectorAll(".card-copy-editor")).toHaveLength(1);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    const editor = host.querySelector(".card-copy-editor");
    for (const selector of ["#source-panel", "#publish-options", "#delivery-panel"]) {
      const node = host.querySelector(selector)!;
      expect((node instanceof HTMLDetailsElement ? node : node.closest("details"))?.open).toBe(false);
    }
    const title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "이동해도 남는 입력");
    for (const label of ["자료·초안", "게시 준비", "전송 상태", "카드 편집"]) {
      const nav = [...host.querySelectorAll<HTMLButtonElement>(".content-workspace-nav button")].find(node => node.textContent === label)!;
      await act(async () => nav.click()); await settle();
      expect(host.querySelector(".card-copy-editor")).toBe(editor);
      expect(title.value).toBe("이동해도 남는 입력");
    }
    expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.guard.confirmLeave).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });

  it("동작 줄이기에서는 커밋된 서랍으로 바로 이동하며 같은 앵커 재선택·재조회 뒤에도 미저장 원고를 유지한다", async () => {
    reducedMotion(true); await render();
    const editor = host.querySelector(".card-copy-editor"), title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "화면을 옮겨도 보존할 미저장 원고");
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView); scroll.mockClear();
    for (let request = 1; request <= 2; request++) {
      await act(async () => workspaceNav("게시 준비").click()); await settle();
      const drawer = host.querySelector<HTMLDetailsElement>("#publish-options")!;
      expect(drawer.open).toBe(true); expect(document.activeElement).toBe(drawer);
      expect(scroll).toHaveBeenCalledTimes(request);
      expect(scroll).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    }
    await refresh();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".card-copy-editor")).toBe(editor); expect(title.value).toBe("화면을 옮겨도 보존할 미저장 원고");
    expect(writes()).toEqual([]); expect(mocks.guard.confirmLeave).not.toHaveBeenCalled();
  });

  it("일반 동작에서는 묶인 이동 요청 중 마지막 서랍에 한 번만 부드럽게 이동한다", async () => {
    await render(createElement(StrictMode, null, createElement(ItemDetailPage, { cid: 2, id: 9 })));
    const targets: HTMLElement[] = [];
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scroll.mockImplementation(function (this: HTMLElement) { targets.push(this); }); scroll.mockClear();
    await act(async () => { workspaceNav("자료·초안").click(); workspaceNav("게시 준비").click(); workspaceNav("전송 상태").click(); }); await settle();
    const delivery = host.querySelector<HTMLElement>("#delivery-panel")!;
    expect(targets).toEqual([delivery]); expect(scroll).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect((delivery.closest("details") as HTMLDetailsElement).open).toBe(true); expect(document.activeElement).toBe(delivery);
    expect(writes()).toEqual([]);
  });

  it("전송 딥링크는 느린 조회 뒤 실제 패널이 커밋되면 한 번 이동하고 재조회는 초점을 빼앗지 않는다", async () => {
    history.replaceState(null, "", "/items/2/9?tab=delivery");
    const original = mocks.api.getMockImplementation()!;
    let release!: () => void, waiting = true;
    mocks.api.mockImplementation((path: string, options?: { method?: string; body?: any }) => path === itemPath && waiting
      ? new Promise(resolve => { release = () => { waiting = false; resolve(structuredClone(detail)); }; }) : original(path, options));
    await render();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
    expect(host.querySelector("#delivery-panel")).toBeNull(); expect(scroll).not.toHaveBeenCalled();
    await act(async () => release()); await settle();
    const delivery = host.querySelector<HTMLElement>("#delivery-panel")!;
    expect((delivery.closest("details") as HTMLDetailsElement).open).toBe(true); expect(document.activeElement).toBe(delivery);
    expect(scroll).toHaveBeenCalledOnce(); expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    const nav = workspaceNav("카드 편집"); nav.focus(); await refresh();
    expect(scroll).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(nav); expect(writes()).toEqual([]);
  });

  it("조회 전에 바뀐 딥링크의 이전 전송 이동은 새 주소의 초점과 서랍을 바꾸지 않는다", async () => {
    history.replaceState(null, "", "/items/2/9?tab=delivery");
    const original = mocks.api.getMockImplementation()!;
    let release!: () => void, waiting = true;
    mocks.api.mockImplementation((path: string, options?: { method?: string; body?: any }) => path === itemPath && waiting
      ? new Promise(resolve => { release = () => { waiting = false; resolve(structuredClone(detail)); }; }) : original(path, options));
    await render(); history.replaceState(null, "", "/items/2/9?tab=source");
    await render(); await act(async () => release()); await settle();
    expect((host.querySelector("#delivery-panel")!.closest("details") as HTMLDetailsElement).open).toBe(false);
    expect((host.querySelector("#source-panel")!.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });

  it("떠난 작업의 이동 요청은 같은 ID를 가진 다음 화면으로 늦게 이동하거나 초점을 빼앗지 않는다", async () => {
    await render();
    await act(async () => {
      workspaceNav("전송 상태").click();
      root.render(createElement("div", null, createElement("button", { id: "next-screen-focus" }, "다음 화면"), createElement("section", { id: "delivery-panel", tabIndex: -1 }, "다른 화면의 전송 패널")));
    });
    const nextFocus = host.querySelector<HTMLButtonElement>("#next-screen-focus")!; nextFocus.focus();
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView); scroll.mockClear(); await settle();
    expect(scroll).not.toHaveBeenCalled(); expect(document.activeElement).toBe(nextFocus); expect(writes()).toEqual([]);
  });

  it("아직 읽지 않은 선택 원문만 한 번 불러오며 재렌더·재조회가 자동 재시도를 만들지 않는다", async () => {
    detail.primary = source(); detail.linked = [{ link: { role: "evidence" }, doc: { ...source(), id: 71, title: "다른 근거 자료" } }];
    let release!: () => void;
    sourceLoad = () => new Promise(resolve => { release = () => resolve({ changed: false }); });
    await render(createElement(StrictMode, null, createElement(ItemDetailPage, { cid: 2, id: 9 })));
    expect(fetches()).toHaveLength(1);
    expect(button("본문 불러오는 중…").disabled).toBe(true);
    expect(generationButton().disabled).toBe(true);
    expect(host.querySelector("#source-panel")?.textContent).toContain("다른 항목의 본문은 요청하지 않습니다");
    await act(async () => release()); await settle(); await refresh(); await refresh();
    expect(fetches()).toHaveLength(1);
    expect(generationButton().disabled).toBe(true);
    sourceLoad = async () => ({ changed: false });
    await open("자료·초안"); await click("본문 불러오기");
    expect(fetches()).toHaveLength(2);
    expect(writes().every(([path]) => path === `${itemPath}/fetch`)).toBe(true);
  });

  it.each([
    ["failed", null, false], ["blocked", null, false], ["unsupported", null, false],
    ["ok", "  ", false], ["not_fetched", null, true],
  ])("상태 %s·샘플 %s의 본문을 무한 재요청하지 않고 내용 확보 전 초안 생성을 막는다", async (status, text, sample) => {
    detail.primary = source(status as string, text as string | null, sample as boolean);
    await render(); await refresh();
    expect(fetches()).toHaveLength(0); expect(generationButton().disabled).toBe(true);
    expect(host.textContent).toContain("먼저 위에서 본문을 불러오거나 직접 붙여넣어 저장해 주세요");
    expect(writes()).toEqual([]);
  });

  it("성공 상태와 실제 본문이 도착한 뒤에만 초안 생성 버튼을 활성화한다", async () => {
    detail.primary = source("blocked"); await render();
    expect(generationButton().disabled).toBe(true);
    detail.primary = source("ok", "직접 확인한 본문이 있습니다."); await refresh();
    expect(generationButton().disabled).toBe(false);
    expect(host.querySelector(".source-text")?.textContent).toBe("직접 확인한 본문이 있습니다.");
    expect(fetches()).toHaveLength(0); expect(writes()).toEqual([]);
  });

  it("백그라운드 원고 조회가 실패해도 기존 카드·입력을 유지하고 복구 후에도 바꾸지 않는다", async () => {
    await render();
    const editor = host.querySelector(".card-copy-editor");
    const title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "조회 오류 사이에도 유지할 문구");
    readError = new ApiError(503, "원고 새로고침이 잠시 실패했습니다."); await refresh();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("원고 새로고침이 잠시 실패했습니다.");
    expect(host.querySelector(".card-copy-editor")).toBe(editor); expect(title.value).toBe("조회 오류 사이에도 유지할 문구");
    readError = null; await refresh();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector(".card-copy-editor")).toBe(editor); expect(title.value).toBe("조회 오류 사이에도 유지할 문구");
    expect(mocks.guard.setDirty).toHaveBeenCalledWith("card-copy-2-9", true, expect.any(Function), expect.any(Function)); expect(writes()).toEqual([]);
  });

  it("내용 검토와 최종 게시 확인을 구분하며 즉시 게시를 기본값으로 둔다", async () => {
    detail.item.reviewStatus = "pending"; await render(); await open("게시 준비");
    expect(host.querySelector<HTMLInputElement>('.publish-timing input[type="radio"]')?.checked).toBe(true);
    expect(host.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(host.querySelector("#review-panel details")?.hasAttribute("open")).toBe(false);
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    await click("내용 확인 · 검토 완료");
    expect(mocks.api).toHaveBeenCalledWith(`${itemPath}/review`, { method: "POST", body: { version: 1, status: "reviewed" } });
    expect(button("내용 검토 완료됨").disabled).toBe(true);
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    expect(writes().some(([path]) => path.endsWith("/approve"))).toBe(false);
    await confirm(); expect(button("승인하고 지금 게시").disabled).toBe(false); await click("승인하고 지금 게시");
    const body = mocks.api.mock.calls.find(([path]) => path === `${itemPath}/approve`)![1].body;
    expect(body).toMatchObject({ timing: "now", revisionId: 4, mediaAssetId: 40, captions: { instagram: "확인할 게시 캡션", telegram: "" } });
    expect(body).not.toHaveProperty("scheduledAt");
  });

  it("예약 선택 때만 일시를 받으며 과거 시각·시점 변경·캡션 변경 후 재확인 없이 승인하지 않는다", async () => {
    await render(); await open("게시 준비"); await confirm();
    await chooseTiming("예약 게시");
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")?.checked).toBe(false);
    expect(button("승인하고 예약 게시").disabled).toBe(true);
    const time = host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await input(time, "2020-01-01T12:30");
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")?.disabled).toBe(true);
    await click("게시 준비 저장"); await confirm();
    expect(button("승인하고 예약 게시").disabled).toBe(true);
    expect(host.textContent).toContain("현재보다 뒤의 시간을 선택해 주세요");
    await input(time, "2099-07-21T16:45");
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")?.checked).toBe(false);
    await click("게시 준비 저장"); await confirm(); expect(button("승인하고 예약 게시").disabled).toBe(false);
    const caption = [...host.querySelectorAll<HTMLLabelElement>("#publish-options label")].find(node => node.textContent?.includes("인스타그램 캡션"))!.querySelector<HTMLTextAreaElement>("textarea")!;
    await input(caption, "최종 확인한 예약 캡션");
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")?.checked).toBe(false);
    expect(button("승인하고 예약 게시").disabled).toBe(true);
    expect(writes().every(([path]) => path.endsWith("/publication-draft"))).toBe(true);
    await click("게시 준비 저장");
    await confirm(); await click("승인하고 예약 게시");
    expect(mocks.api).toHaveBeenCalledWith(`${itemPath}/approve`, { method: "POST", body: expect.objectContaining({ timing: "later", scheduledAt: "2099-07-21T16:45:00+09:00", captions: { instagram: "최종 확인한 예약 캡션", telegram: "" } }) });
    expect(writes()).toHaveLength(4);
  });
});
