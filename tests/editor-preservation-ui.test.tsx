// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPage, EditPanel } from "../client/src/pages/ItemDetail";
import { emptyPayload, payloadSchemaFor } from "../shared/payloads";
import { ApiError } from "../client/src/api";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), blob: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: vi.fn((action: () => void) => action()) },
}));
const channel = { id: 2, slug: "highscoop", name: "하이스쿱", active: true, accentColor: "#285f6a" };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", allChannels: [channel], channels: [channel] }), useDirtyGuard: () => mocks.guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => "" }));
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
function source(fetchStatus = "not_fetched", fetchedText: string | null = null, isSample = false) {
  return { id: 70, kind: "rss_direct", title: "선택한 원문", originalUrl: "https://example.com/article", meta: {}, fetchStatus, fetchedText, snippet: "목록에서 받은 짧은 요약", attachments: [], isSample, publishedAt: "2026-11-01T00:00:00Z", publishedPrecision: "day", publishedRaw: null, lastFetchedAt: null };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); readError = null; sourceLoad = async () => ({ changed: false });
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
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/status") return { integrations: { aiProvider: "gemini", gemini: true, openai: false, anthropic: false, flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false } };
    if (path === "/canva/status") return { connected: false };
    if (path === `${itemPath}/publication-draft` && options?.method === "PATCH") {
      if (options.body.version !== detail.publicationDraft.version) throw new ApiError(409, "다른 곳에서 먼저 저장됨");
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
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode = createElement(ItemDetailPage, { cid: 2, id: 9 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll("button")].find(node => node.textContent === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
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


describe("draft preservation regressions from the PR60 audit", () => {
  it("defaults to automatic creation and keeps a completed draft when the following image request fails", async () => {
    detail.current = null; detail.cards = []; detail.imageAiAvailable = true;
    detail.primary = source("ok", "자동 제작에 사용할 실제 본문 대신 격리된 테스트 본문입니다.");
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path, options) => {
      if (path === `${itemPath}/generate`) {
        detail.item = { ...detail.item, version: 2, currentRevisionId: 6 };
        detail.current = { id: 6, revisionNo: 2, author: "llm", payload: { ...emptyPayload("science_dialogue", "저장된 자동 초안"), cardCopy: structuredClone(copy) } };
        return structuredClone(detail.item);
      }
      if (path === `${itemPath}/card`) throw new ApiError(503, "이미지 생성 일시 과부하", { jobStatus: "failed" });
      if (path === `${itemPath}/card-copy`) return { version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: true, copy: structuredClone(copy) };
      return fallback(path, options);
    });
    await render();
    expect(host.querySelector('.work-mode-options button[aria-pressed="true"] strong')?.textContent).toBe("자동");
    expect(writes()).toEqual([]);
    await click("원고·이미지 자동 만들기");
    expect(host.textContent).toContain("원고는 저장했습니다. 이미지 생성은 완료를 확인하지 못했습니다.");
    expect(host.querySelector("#edit-panel form")).not.toBeNull(); expect(host.querySelector(".card-copy-editor")).not.toBeNull();
    const attempts = writes(); expect(attempts.map(([path]) => path)).toEqual([`${itemPath}/generate`, `${itemPath}/card`]);
    expect(attempts[1][1].body).toMatchObject({ version: 2, coverMode: "ai", requestId: expect.any(String) });
    expect(detail.current.payload.topic).toBe("저장된 자동 초안");
    await input(host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!, "AI 오류 후에도 계속 쓰는 문구");
    expect(host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!.value).toBe("AI 오류 후에도 계속 쓰는 문구");
    expect(writes()).toHaveLength(2);
  });
  it("does not roll a newer observed publication draft back when an older PATCH response arrives late", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    let release!: () => void;
    mocks.api.mockImplementation(async (path, options) => {
      if (path === `${itemPath}/publication-draft`) {
        const saved = await fallback(path, options);
        return new Promise(resolve => { release = () => resolve(saved); });
      }
      return fallback(path, options);
    });
    await render(); await open("게시 준비");
    const caption = host.querySelector<HTMLTextAreaElement>('[aria-label="인스타그램 캡션"]')!;
    await input(caption, "응답을 기다리는 내 캡션"); await click("게시 준비 저장");
    detail.publicationDraft = { version: 3, captions: { instagram: "그 뒤 다른 탭에서 저장한 캡션", telegram: "" }, options: { destinationIds: [], timing: "later", scheduledAtKst: "2099-07-21T16:45" } };
    await refresh();
    expect(host.textContent).toContain("그 뒤 다른 탭에서 저장한 캡션");
    await act(async () => release()); await settle();
    expect(caption.value).toBe("응답을 기다리는 내 캡션");
    expect(host.textContent).toContain("그 뒤 다른 탭에서 저장한 캡션");
    expect(host.textContent).toContain("게시 준비 저장 충돌");
    expect(client.getQueryData<any>(itemKey).publicationDraft.version).toBe(3);
    expect(button("게시 준비 저장").disabled).toBe(true);
    expect(writes()).toHaveLength(1);
  });

  it("saves an unfinished destination and schedule intention and restores it after reopening", async () => {
    await render(); await open("게시 준비"); await chooseTiming("예약 게시");
    const destination = host.querySelector<HTMLInputElement>(".publication-destinations input")!;
    await act(async () => destination.click()); await settle();
    expect(host.querySelector<HTMLInputElement>('.publish-confirm input')?.disabled).toBe(true);
    await click("게시 준비 저장");
    expect(detail.publicationDraft.options).toEqual({ destinationIds: [], timing: "later", scheduledAtKst: "" });
    expect(writes().map(([path]) => path)).toEqual([`${itemPath}/publication-draft`]);
    await act(async () => root.unmount()); client.clear(); root = createRoot(host);
    await render(); await open("게시 준비");
    expect(host.querySelector<HTMLInputElement>(".publication-destinations input")?.checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>('.publish-timing input[type="radio"]:checked')?.parentElement?.textContent).toContain("예약 게시");
    expect(button("승인하고 예약 게시").disabled).toBe(true);
    expect(detail.item.version).toBe(1);
  });

  it("keeps an unavailable saved destination instead of silently selecting a different account", async () => {
    detail.publicationDraft.options = { destinationIds: [999], timing: "later", scheduledAtKst: "2099-07-21T16:45" };
    await render(); await open("게시 준비");
    expect(host.querySelector<HTMLInputElement>(".publication-destinations input")?.checked).toBe(false);
    expect(host.textContent).toContain("저장한 게시 계정 중 사용할 수 없는 계정이 있습니다");
    expect(button("승인하고 예약 게시").disabled).toBe(true);
    expect(writes()).toEqual([]);
    await click("사용할 수 없는 계정 선택 해제"); await click("게시 준비 저장");
    expect(detail.publicationDraft.options).toEqual({ destinationIds: [], timing: "later", scheduledAtKst: "2099-07-21T16:45" });
    expect(writes().some(([path]) => path.endsWith("/approve"))).toBe(false);
  });

  it("compares a conflicting schedule with the local selection without silently accepting it", async () => {
    await render(); await open("게시 준비"); await chooseTiming("예약 게시");
    await input(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, "2099-07-21T16:45");
    detail.publicationDraft = { ...detail.publicationDraft, version: 2, options: { destinationIds: [], timing: "now", scheduledAtKst: "" } };
    await click("게시 준비 저장");
    expect(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe("2099-07-21T16:45");
    expect(host.textContent).toContain("아직 선택하지 않음");
    expect(button("게시 준비 저장").disabled).toBe(true);
    expect(writes()).toHaveLength(1);
    await click("내 게시 준비로 다시 저장");
    expect(detail.publicationDraft).toMatchObject({ version: 3, options: { destinationIds: [20], timing: "later", scheduledAtKst: "2099-07-21T16:45" } });
  });

  it("keeps a caption after save failure and preserves typing that happens during a successful save", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    let release: (() => Promise<void>) | undefined;
    let fail = true;
    mocks.api.mockImplementation(async (path, options) => {
      if (path === `${itemPath}/publication-draft`) {
        if (fail) throw new ApiError(503, "저장을 잠시 완료하지 못했습니다.");
        return new Promise(resolve => { release = async () => resolve(await fallback(path, options)); });
      }
      return fallback(path, options);
    });
    await render(); await open("게시 준비");
    const caption = host.querySelector<HTMLTextAreaElement>('[aria-label="인스타그램 캡션"]')!;
    await input(caption, "저장 실패에도 남길 캡션"); await click("게시 준비 저장");
    expect(caption.value).toBe("저장 실패에도 남길 캡션");
    expect(host.textContent).toContain("게시 준비 저장 실패 · 입력 유지됨");
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    fail = false; await click("게시 준비 저장");
    await input(caption, "저장 요청 뒤에 추가로 입력한 캡션");
    await act(async () => release!()); await settle();
    expect(detail.publicationDraft.captions.instagram).toBe("저장 실패에도 남길 캡션");
    expect(caption.value).toBe("저장 요청 뒤에 추가로 입력한 캡션");
    expect(button("게시 준비 저장").disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")!.disabled).toBe(true);
  });

  it("shows conflicting server captions and never silently retries with a new version", async () => {
    await render(); await open("게시 준비");
    const caption = host.querySelector<HTMLTextAreaElement>('[aria-label="인스타그램 캡션"]')!;
    await input(caption, "내가 입력한 캡션");
    detail.publicationDraft = { version: 2, captions: { instagram: "다른 운영자의 최신 캡션", telegram: "" } };
    await click("게시 준비 저장");
    expect(caption.value).toBe("내가 입력한 캡션");
    expect(host.textContent).toContain("다른 운영자의 최신 캡션");
    expect(button("게시 준비 저장").disabled).toBe(true);
    expect(writes().filter(([path]) => path.endsWith("/publication-draft"))).toHaveLength(1);
    await click("내 게시 준비로 다시 저장");
    expect(detail.publicationDraft).toEqual({ version: 3, captions: { instagram: "내가 입력한 캡션", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } });
  });

  it("can start a manual draft after the first AI attempt failed without repasting the acquired article", async () => {
    detail.current = null; detail.cards = [];
    detail.primary = source("ok", "이미 확보한 충분한 원문 본문이며 다시 붙여넣을 필요가 없습니다.");
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path, options) => {
      if (path === `${itemPath}/generate`) throw new ApiError(503, "AI 일시 과부하");
      if (path === `${itemPath}/draft`) {
        detail.current = { id: 4, revisionNo: 1, author: "operator", payload: emptyPayload("science_dialogue", "직접 초안") };
        return { item: detail.item, current: detail.current };
      }
      return fallback(path, options);
    });
    await render(); await click("원고·이미지 자동 만들기");
    expect(host.textContent).toContain("AI 일시 과부하");
    await act(async () => host.querySelector<HTMLButtonElement>(".work-mode-options button:nth-child(2)")!.click()); await settle();
    await click("직접 초안 작성");
    expect(host.querySelector("#edit-panel form")).not.toBeNull();
    expect(writes().map(([path]) => path)).toEqual([`${itemPath}/generate`, `${itemPath}/draft`]);
    expect(detail.primary.fetchedText).toContain("이미 확보한");
  });

  it("caption-only edits are guarded, independently saved and restored when reopened", async () => {
    await render();
    await open("게시 준비");
    const getCaption = () => [...host.querySelectorAll<HTMLLabelElement>("#publish-options label")].find(node => node.textContent?.includes("인스타그램 캡션"))!.querySelector<HTMLTextAreaElement>("textarea")!;
    mocks.guard.setDirty.mockClear();
    await input(getCaption(), "운영자가 20분 동안 직접 다듬은 캡션");
    expect(getCaption().value).toBe("운영자가 20분 동안 직접 다듬은 캡션");
    expect(mocks.guard.setDirty.mock.calls.some(([key, dirty]) => key === "publication-draft-2-9" && dirty)).toBe(true);
    expect(writes()).toEqual([]);
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    await click("게시 준비 저장");
    expect(detail.publicationDraft.captions.instagram).toBe("운영자가 20분 동안 직접 다듬은 캡션");
    expect(detail.item.version).toBe(1);
    await render(null);
    await render();
    await open("게시 준비");
    expect(getCaption().value).toBe("운영자가 20분 동안 직접 다듬은 캡션");
  });

  it("source conflict rebases only owned fields and preserves a separately saved card copy", async () => {
    const oldPayload = { ...emptyPayload("science_dialogue", "과학 주제"), key_question: "초기 질문", cardCopy: structuredClone(copy) };
    let live = { ...structuredClone(detail), current: { ...detail.current, payload: oldPayload } };
    const requests: any[] = [];
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
      if (path === itemPath && options?.method === "PATCH") {
        requests.push(structuredClone(options.body));
        const parsed = payloadSchemaFor("science_dialogue").parse(options.body.payload);
        if (options.body.version !== live.item.version) throw new ApiError(409, "다른 곳에서 수정됨");
        live = { ...live, item: { ...live.item, version: live.item.version + 1 }, current: { ...live.current, payload: { ...structuredClone(parsed), cardCopy: live.current.payload.cardCopy } } };
        return live.item;
      }
      if (path === itemPath) return structuredClone(live);
      return fallback(path, options);
    });
    await render(createElement(EditPanel, { d: structuredClone(live), cid: 2 }));
    const question = [...host.querySelectorAll<HTMLLabelElement>("label")].find(node => node.textContent?.includes("핵심 질문"))!.querySelector<HTMLTextAreaElement>("textarea")!;
    await input(question, "직접 수정중인 질문");
    live = { ...live, item: { ...live.item, version: 2 }, current: { ...live.current, payload: { ...oldPayload, cardCopy: { ...structuredClone(copy), cover: { ...copy.cover, title: "다른 카드 편집기에서 방금 저장한 제목" } } } } };
    await render(createElement(EditPanel, { d: structuredClone(live), cid: 2 }));
    await click("새 버전으로 저장");
    expect(requests[0].version).toBe(1);
    await click("최신 불러오기");
    await click("새 버전으로 저장");
    expect(requests[1].version).toBe(2);
    expect(requests[1].payload.key_question).toBe("직접 수정중인 질문");
    expect(requests[1].payload).not.toHaveProperty("cardCopy");
    expect(live.current.payload.cardCopy.cover.title).toBe("다른 카드 편집기에서 방금 저장한 제목");
  });

  it("uncommitted source edits prevent final confirmation and approval of the previous revision", async () => {
    detail.current.payload = { title: "과학 주제", key_question: "현재 저장된 질문", cardCopy: structuredClone(copy) };
    await render();
    await open("자료·초안");
    const question = [...host.querySelectorAll<HTMLLabelElement>("#edit-panel label")].find(node => node.textContent?.includes("핵심 질문"))!.querySelector<HTMLTextAreaElement>("textarea")!;
    await input(question, "게시 전에 반드시 반영해야 할 수정");
    await open("게시 준비");
    expect(host.querySelector<HTMLInputElement>(".publish-confirm input")!.disabled).toBe(true);
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    await click("승인하고 지금 게시");
    expect(writes().some(([path]) => path.endsWith("/approve"))).toBe(false);
    expect(writes().some(([path,opts]) => path === itemPath && opts.method === "PATCH")).toBe(false);
    expect(question.value).toBe("게시 전에 반드시 반영해야 할 수정");
  });
});
