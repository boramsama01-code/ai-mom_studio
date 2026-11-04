// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPage } from "../client/src/pages/ItemDetail";
import { ApiError } from "../client/src/api";
import { DirtyGuardProvider } from "../client/src/state";
import { DirtyModal, GuardedLink } from "../client/src/ui";
import { activateDraftRecoveryScope, readDraftRecovery } from "../client/src/draftRecovery";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
const channel = { id: 2, slug: "highscoop", name: "하이스쿱", active: true, accentColor: "#285f6a" };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", async original => ({ ...await original<object>(), useChannel: () => ({ selected: 2, allChannels: [channel], channels: [channel] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => "" }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "builtin:classic", items: [] } }), TemplatePicker: () => null }));
vi.mock("../client/src/CardCarousel", () => ({ CardCarousel: () => null }));
vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const path = "/channels/2/items/9";
const scope = "source-cover-redraw-fixture-session";
const recoveryKey = "item:2:9:cover-redraw";
const time = "2026-11-04T00:00:00Z";
const initialCopy = () => ({ version: 1, templateKey: "builtin:classic", cover: { title: "저장된 표지", subtitle: "확인한 부제" }, pages: Array.from({ length: 4 }, (_, index) => ({ id: `body-${index + 1}`, title: `본문 ${index + 1}`, subtitle: "", body: "확인한 카드 문구입니다." })) });
let host: HTMLDivElement, root: Root, client: QueryClient, detail: any, saved: any;
let renderImage: (body: Record<string, unknown>) => Promise<any>, nextAsset: number;
function completeImage(body: Record<string, unknown>) {
  const id = nextAsset; nextAsset += 10;
  const card = { id, revisionId: detail.current.id, templateKey: body.templateKey, sha256: `fixture-${id}`, createdAt: time, cloudinaryUrl: null,
    carousel: { version: 1, altVersion: 1, cover: { kind: "ai", credit: "합성 표지" }, pages: [saved.copy.cover, ...saved.copy.pages].map((page: { title: string }, index: number) => ({ id: id + index, sha256: `fixture-${id + index}`, title: page.title })) } };
  detail.cards.unshift(card);
  if (body.regenerateCover === true) { detail.item.version++; saved.version = detail.item.version; detail.item.reviewStatus = "pending"; }
  return { ...structuredClone(card), itemVersion: detail.item.version, studioCardId: 25 };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); nextAsset = 50;
  activateDraftRecoveryScope(scope);
  saved = { version: 1, revisionId: 4, hasSavedCopy: true, copy: initialCopy() };
  detail = {
    imageAiAvailable: true,
    item: { id: 9, channelId: 2, title: "표지 수정 작업", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 4, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {} },
    primary: null, linked: [], current: { id: 4, revisionNo: 1, author: "operator", payload: { topic: "표지 수정 작업", cardCopy: initialCopy() } }, revisions: [],
    cards: [{ id: 40, revisionId: 4, templateKey: "builtin:classic", sha256: "fixture", createdAt: time, cloudinaryUrl: null, carousel: { version: 1, cover: { kind: "ai", credit: "기존 그림" }, pages: [{ id: 40, title: "저장된 표지", sha256: "fixture" }] } }],
    publicationDraft: { version: 1, captions: { instagram: "저장된 캡션", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } },
    approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "저장된 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 3, expectedUsername: "highscoop.official", destinations: [{ id: 20, label: "@highscoop.official", platform: "instagram", configured: true }] },
  };
  renderImage = async body => completeImage(body);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:cover-redraw-fixture") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.blob.mockResolvedValue(new Blob(["fixture-image"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (url: string, options?: { method?: string; body?: any }) => {
    if (url === "/status") return { integrations: { aiProvider: "gemini", gemini: true, openai: true, anthropic: false, flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
    if (url === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: true, anthropic: false }, image: true };
    if (url === "/canva/status") return { connected: false };
    if (url === path) return structuredClone(detail);
    if (url === `${path}/card-copy`) {
      if (options?.method === "PATCH") {
        expect(options.body.version).toBe(saved.version);
        detail.item.version++; detail.current.id++; detail.current.revisionNo++;
        saved = { version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: true, copy: structuredClone(options.body.copy) };
        detail.item.currentRevisionId = detail.current.id; detail.current.payload.cardCopy = structuredClone(saved.copy);
      }
      return structuredClone(saved);
    }
    if (url === `${path}/card` && options?.method === "POST") return renderImage(options.body);
    throw new Error(`Unexpected isolated API request: ${url}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode = createElement(ItemDetailPage, { cid: 2, id: 9 })) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(DirtyGuardProvider, null, element, createElement(GuardedLink, { href: "/", children: "다른 작업으로" }), createElement(DirtyModal)))));
  await settle();
}
function button(text: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text); if (!found) throw new Error(`Missing button: ${text}`); return found; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
const checkbox = () => host.querySelector<HTMLInputElement>('[aria-label="표지 그림 새로 그리기"]')!;
const direction = () => host.querySelector<HTMLTextAreaElement>('[aria-label="표지 그림 상세 요청"]')!;
async function type(node: HTMLTextAreaElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, text); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(); }
async function setDirection(text: string) { if (!checkbox().checked) { await act(async () => checkbox().click()); await settle(); } await type(direction(), text); }
async function mode(name: "자동" | "수동") { const option = [...host.querySelectorAll<HTMLButtonElement>(".content-workspace > .work-mode .work-mode-options button")].find(node => node.querySelector("strong")?.textContent === name)!; await act(async () => option.click()); await settle(); }
const imageRequests = () => mocks.api.mock.calls.filter(([url]) => url === `${path}/card`);
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
const recovery = () => readDraftRecovery(scope, recoveryKey, value => value as { regenerateCover: boolean; coverInstruction: string });

describe("explicit source cover redraw", () => {
  it("reuses saved artwork by default and never sends redraw fields when only text is saved", async () => {
    await render(); expect(checkbox().checked).toBe(false); expect(writes()).toHaveLength(0);
    await type(host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!, "문구만 고친 제목");
    await click("문구 저장"); expect(imageRequests()).toHaveLength(0);
    expect(writes().map(([url]) => url)).toEqual([`${path}/card-copy`]);
    await click("이미지 생성·갱신");
    expect(imageRequests()).toHaveLength(1);
    expect(imageRequests()[0][1].body).toMatchObject({ coverMode: "ai", version: 2, requestId: expect.any(String) });
    expect(imageRequests()[0][1].body).not.toHaveProperty("regenerateCover");
    expect(imageRequests()[0][1].body).not.toHaveProperty("coverInstruction");
  });

  it("keeps a detailed request through manual rendering and a known failure, and clears it only after explicit redraw succeeds", async () => {
    await render(); await setDirection("배경은 밝은 실험실, 위쪽은 글자가 들어갈 여백");
    expect(direction().maxLength).toBe(2000);
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")!.disabled).toBe(true);
    await mode("수동"); await click("카드 이미지 저장");
    expect(imageRequests()[0][1].body).toMatchObject({ coverMode: "reuse" });
    expect(imageRequests()[0][1].body).not.toHaveProperty("regenerateCover");
    expect(imageRequests()[0][1].body).not.toHaveProperty("coverInstruction");
    expect(imageRequests()[0][1].body).not.toHaveProperty("requestId");
    expect(checkbox().checked).toBe(true); expect(direction().value).toContain("밝은 실험실");
    await mode("자동");
    renderImage = async () => { throw new ApiError(503, "그림 생성 일시 실패", { jobStatus: "failed" }); };
    await click("표지 1장 다시 그리기 · 이미지 갱신");
    expect(imageRequests()[1][1].body).toMatchObject({ coverMode: "ai", regenerateCover: true, coverInstruction: "배경은 밝은 실험실, 위쪽은 글자가 들어갈 여백" });
    expect(checkbox().checked).toBe(true); expect(direction().value).toContain("밝은 실험실");
    await mode("수동"); await mode("자동"); expect(direction().value).toContain("밝은 실험실");
    let release!: () => void;
    renderImage = body => new Promise(resolve => { release = () => resolve(completeImage(body)); });
    await click("표지 1장 다시 그리기 · 이미지 갱신");
    expect(host.textContent).toContain("새 표지 그림 1장을 요청하고 있습니다"); expect(direction().disabled).toBe(true);
    expect(imageRequests()[2][1].body.requestId).not.toBe(imageRequests()[1][1].body.requestId);
    await act(async () => release()); await settle();
    expect(checkbox().checked).toBe(false); expect(direction()).toBeNull(); expect(recovery()).toEqual({ ok: true, value: null });
    expect(detail.item.reviewStatus).toBe("pending");
  });

  it("replays the original uncertain request and retains a newer direction after that replay succeeds", async () => {
    await render(); await setDirection("처음 요청한 밝은 표지");
    renderImage = async () => { throw new ApiError(0, "응답 연결이 끊겼습니다"); };
    await click("표지 1장 다시 그리기 · 이미지 갱신");
    const original = structuredClone(imageRequests()[0][1].body);
    await type(direction(), "다음에 적용할 더 차분한 표지"); await mode("수동");
    renderImage = async body => completeImage(body);
    await click("이전 이미지 결과 확인");
    expect(imageRequests()[1][1].body).toEqual(original);
    expect(checkbox().checked).toBe(true); expect(direction().value).toBe("다음에 적용할 더 차분한 표지");
    expect(recovery()).toMatchObject({ ok: true, value: { value: { regenerateCover: true, coverInstruction: "다음에 적용할 더 차분한 표지" } } });
  });

  it("recovers an uncertain redraw after remount using its exact body and removes only the fulfilled recovery draft", async () => {
    await render(); await setDirection("다시 연 뒤에도 동일하게 요청할 표지");
    renderImage = async () => { throw new ApiError(0, "응답 유실"); };
    await click("표지 1장 다시 그리기 · 이미지 갱신"); const original = structuredClone(imageRequests()[0][1].body);
    await render(null); await render();
    expect(host.textContent).toContain("표지 다시 그리기 요청의 기기 복구본");
    renderImage = async body => completeImage(body); await click("이전 이미지 결과 확인");
    expect(imageRequests()[1][1].body).toEqual(original);
    expect(checkbox().checked).toBe(false); expect(recovery()).toEqual({ ok: true, value: null });
    expect(host.querySelector('[aria-label="표지 다시 그리기 요청 기기 복구본"]')).toBeNull();
  });

  it.each(["item version", "legacy asset ID"])("does not select an older replay or clear a newer direction when detected by %s", async signal => {
    await render(); await setDirection("처음 제출한 표지 요청");
    let oldResult: any;
    renderImage = async body => { oldResult = completeImage(body); throw new ApiError(0, "완료 응답 유실"); };
    await click("표지 1장 다시 그리기 · 이미지 갱신");
    const submitted = structuredClone(imageRequests()[0][1].body);
    const newer = completeImage({ ...submitted, coverInstruction: "다른 창에서 완성한 새 표지" });
    await act(async () => { await client.invalidateQueries({ queryKey: ["ch", 2, "item", 9] }); }); await settle();
    await type(direction(), "다음에 반영할 나의 새 요청");
    // Exercise both versioned responses and already stored legacy responses independently.
    const response = signal === "item version" ? { ...oldResult, id: newer.id + 10 } : { ...oldResult, itemVersion: undefined };
    renderImage = async () => response;
    await click("이전 이미지 결과 확인");
    expect(imageRequests()[1][1].body).toEqual(submitted);
    expect(host.textContent).toContain(`이미지 #${newer.id}`);
    expect(host.textContent).not.toContain(`이미지 #${oldResult.id}`);
    expect(host.querySelector('[aria-label="승인할 카드 고르기"] button[aria-pressed="true"] img')?.getAttribute("src")).toBe(`/api/channels/2/media/${newer.id}`);
    expect(direction().value).toBe("다음에 반영할 나의 새 요청"); expect(checkbox().checked).toBe(true);
    expect(mocks.toast).toHaveBeenLastCalledWith("info", expect.stringContaining("더 최신 원고·이미지"));
    expect(host.textContent).toContain("현재의 더 최신 이미지와 표지 요청은 유지했습니다");
  });

  it("requires explicit recovery and comparison after the saved source version changes", async () => {
    await render(); await setDirection("닫기 전에 적은 표지 방향"); await render(null);
    detail.current.id = 5; detail.item.currentRevisionId = 5; detail.item.version = 2; saved.version = 2; saved.revisionId = 5;
    await client.invalidateQueries({ queryKey: ["ch", 2, "item", 9] }); await render();
    expect(button("복구본을 편집기에 불러오기").disabled).toBe(true);
    expect(checkbox().checked).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>('[aria-label="표지 다시 그리기 요청 기기 복구본"]')?.closest("details")?.open).toBe(true);
    const compare = [...host.querySelectorAll<HTMLLabelElement>(".draft-recovery label")].find(label => label.textContent?.includes("두 내용의 차이"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => compare.click()); await settle(); await click("복구본을 편집기에 불러오기");
    expect(checkbox().checked).toBe(true); expect(direction().value).toBe("닫기 전에 적은 표지 방향"); expect(imageRequests()).toHaveLength(0);
  });

  it("guards leaving, never turns save-and-leave into paid work, and clears an explicitly discarded request", async () => {
    await render(); await setDirection("채널을 바꾸기 전에 남긴 상세 요청");
    const leave = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "다른 작업으로")!;
    await act(async () => leave.click()); await settle(); await click("머무르기");
    expect(direction().value).toContain("상세 요청"); expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => leave.click()); await settle(); await click("저장하고 이동");
    expect(writes()).toHaveLength(0); expect(mocks.navigate).not.toHaveBeenCalled(); expect(direction().value).toContain("상세 요청");
    await act(async () => leave.click()); await settle(); await click("버리고 이동");
    expect(mocks.navigate).toHaveBeenCalledWith("/"); expect(writes()).toHaveLength(0); expect(checkbox().checked).toBe(false); expect(recovery()).toEqual({ ok: true, value: null });
  });
});
