// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCopyEditor, type CardCopyResponse } from "../client/src/CardCopyEditor";
import { SourceStudioCard } from "../client/src/pages/SourceStudioCard";
import { ApiError } from "../client/src/api";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { activateDraftRecoveryScope, readDraftRecovery } from "../client/src/draftRecovery";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (fn: () => void) => fn() }, navigate: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ select: vi.fn(), channels: [], allChannels: [] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/studio/1", mocks.navigate], useSearch: () => "" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient, saved: CardCopyResponse;
let patch: ((body: { version: number; copy: CardCopyResponse["copy"] }) => Promise<CardCopyResponse>) | null;
let renderedCards: Array<Record<string, any>>;
const path = "/channels/1/items/9/card-copy";
function fresh(): CardCopyResponse {
  return { version: 3, revisionId: 30, hasSavedCopy: true, copy: { version: 1, templateKey: "set:n04", cover: { title: "원고에서 가져온 제목", subtitle: "사실을 확인하는 부제" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 제목 ${i + 1}`, subtitle: `본문 부제 ${i + 1}`, body: `원문에 근거한 카드 본문 ${i + 1}` })) } };
}
function itemFixture() {
  return {
    item: { id: 9, channelId: 1, title: saved.copy.cover.title, kind: "science_dialogue", origin: "manual", version: saved.version, currentRevisionId: saved.revisionId, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {}, canvaDesign: null },
    current: { id: saved.revisionId, revisionNo: saved.version, author: "operator", payload: { title: saved.copy.cover.title, cardCopy: saved.copy } },
    primary: null, linked: [], revisions: [], cards: renderedCards, approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "확인한 게시 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], destinations: [], dryRun: false, autoPublish: true, expectedUsername: "spacepenguin.co" },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); saved = fresh(); patch = null;
  renderedCards = [{ id: 51, revisionId: 30, templateKey: "set:n01", carousel: { version: 1, cover: { kind: "typography", credit: "저장된 표지" }, pages: Array.from({ length: 5 }, (_, i) => ({ id: 51 + i, title: `완성 ${i}`, sha256: `old-${i}` })) } }];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:actual-renderer-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  mocks.blob.mockResolvedValue(new Blob(["renderer-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (request: string, options?: { method?: string; body?: any }) => {
    if (request === "/status") return { integrations: { aiProvider: "gemini", gemini: true, flags: { dryRun: false, autoPublish: true } }, workerConnected: true };
    if (request === "/canva/status") return { connected: false };
    if (request === "/channels/1/items/9") return structuredClone(itemFixture());
    if (request === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false } };
    if (request === path && options?.method === "PATCH") {
      if (patch) return patch(options.body);
      saved = { ...saved, copy: structuredClone(options.body.copy), version: saved.version + 1, revisionId: saved.revisionId + 1, hasSavedCopy: true };
      return structuredClone(saved);
    }
    if (request === path) return structuredClone(saved);
    if (request === `${path}/generate`) return { version: saved.version, revisionId: saved.revisionId, copy: { ...structuredClone(saved.copy), cover: { title: "AI가 제안한 제목", subtitle: "AI가 제안한 부제" } }, model: "fixture-model" };
    if (request === "/channels/1/templates") return { current: "set:n04", items: [{ key: "set:n04", name: "뉴스 브리핑", description: "뉴스", kind: "builtin", family: "news", pageCount: 5 }] };
    if (/\/media\/\d+\/alt-text$/.test(request)) return { version: 1, values: Array.from({ length: 5 }, (_, i) => `카드 이미지 설명 ${i + 1}`) };
    if (request === "/channels/1/items/9/card") {
      const generated = { id: 71, studioCardId: 1, revisionId: saved.revisionId, templateKey: saved.copy.templateKey, carousel: { version: 1, cover: { kind: "typography", credit: "저장된 표지" }, pages: Array.from({ length: 5 }, (_, i) => ({ id: 71 + i, sha256: `sha-${i}`, title: i === 0 ? saved.copy.cover.title : saved.copy.pages[i - 1].title })) } };
      renderedCards = [generated]; return structuredClone(generated);
    }
    throw new Error(`Unexpected request: ${request}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle(ms = 25) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function render(element: ReactNode = createElement(CardCopyEditor, { channelId: 1, itemId: 9 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const buttons = [...host.querySelectorAll("button")]; const node = buttons.find(b => b.textContent === text) ?? buttons.find(b => b.textContent?.includes(text)); if (!node) throw new Error(`Button missing: ${text}`); return node; }
async function click(text: string) { const node = button(text); expect(node.disabled, text).toBe(false); await act(async () => node.click()); await settle(); }
async function openDetails(text: string) {
  const summary = [...host.querySelectorAll("summary")].find(node => node.textContent?.includes(text));
  if (!summary) throw new Error(`Summary missing: ${text}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) await act(async () => summary.click());
  await settle();
}
function field(suffix: string) { const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id$="-${suffix}"]`); if (!node) throw new Error(`Field missing: ${suffix}`); return node; }
async function input(suffix: string, value: string) {
  const node = field(suffix);
  await act(async () => { const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("card copy editor", () => {
  it("recovers unsaved incomplete copy after a tab closes without auto-saving or invoking AI", async () => {
    const scope = "card-copy-recovery-session"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    await render(); await input("title", ""); await input("subtitle", "미저장 부제\n마지막 입력🐧");
    await render(null); await render();
    expect(field("title").value).toBe(fresh().copy.cover.title); expect(field("title").disabled).toBe(true);
    expect(button("문구 저장").disabled).toBe(true);
    await click("복구본을 편집기에 불러오기");
    expect(field("title").value).toBe(""); expect(field("subtitle").value).toBe("미저장 부제\n마지막 입력🐧");
    expect(button("문구 저장").disabled).toBe(true); // incomplete input survives, normal save validation remains
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH" || options?.method === "POST")).toHaveLength(0);
    await input("title", "검토 후 저장한 제목"); await click("문구 저장");
    expect(saved.copy.cover.title).toBe("검토 후 저장한 제목");
    expect(readDraftRecovery(scope, "item:1:9:card-copy", value => value as any)).toEqual({ ok: true, value: null });
    await render(null); await render(); expect(host.textContent).not.toContain("기기 복구본 버리기");
  });
  it("compares a device draft with a newer server version before explicitly restoring and saving", async () => {
    const scope = "card-copy-recovery-session"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    await render(); await input("title", "기기에만 남은 제목"); await render(null);
    saved = { ...fresh(), version: 8, revisionId: 80, copy: { ...fresh().copy, cover: { title: "새 서버 제목", subtitle: "다른 창에서 쓴 부제" } } };
    client.setQueryData(["card-copy", 1, 9], structuredClone(saved)); await render();
    expect(field("title").value).toBe("새 서버 제목"); expect(button("복구본을 편집기에 불러오기").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('.draft-recovery input[type="checkbox"]')!.click());
    await click("복구본을 편집기에 불러오기"); expect(field("title").value).toBe("기기에만 남은 제목");
    expect(saved.copy.cover.title).toBe("새 서버 제목");
    await click("문구 저장");
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH").at(-1)?.[1].body.version).toBe(8);
  });
  it("clears recovery and resets fields when the dirty guard explicitly discards copy", async () => {
    const scope = "card-copy-recovery-session"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    await render(); await input("title", "버릴 카드 문구");
    const registration = mocks.guard.setDirty.mock.calls.filter(([key, dirty]) => key === "card-copy-1-9" && dirty).at(-1)!;
    expect(registration[3]).toBeTypeOf("function"); await act(async () => registration[3]());
    expect(field("title").value).toBe(fresh().copy.cover.title);
    await render(null); await render(); expect(host.textContent).not.toContain("기기 복구본 버리기");
    expect(readDraftRecovery(scope, "item:1:9:card-copy", value => value as any)).toEqual({ ok: true, value: null });
  });
  it("edits actual image title, subtitle and body through the exact-renderer preview without generating AI", async () => {
    saved.copy.cover.title = "기존에 저장된\n표지 제목";
    const dirty = vi.fn(); await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, onDirtyChange: dirty }));
    expect(field("title").value).toBe(saved.copy.cover.title); expect(host.textContent).toContain("게시물 캡션과 별도로 저장합니다.");
    expect(field("title").tagName).toBe("TEXTAREA");
    await input("title", "직접 쓴 표지\n제목"); await input("subtitle", "한글 부제\n줄바꿈"); await settle(480);
    expect(mocks.blob).toHaveBeenLastCalledWith(`${path}/preview`, "image/jpeg", expect.objectContaining({ method: "POST", body: expect.objectContaining({ version: 3, page: 0, coverMode: "reuse", copy: expect.objectContaining({ cover: { title: "직접 쓴 표지\n제목", subtitle: "한글 부제\n줄바꿈" } }) }) }));
    expect(host.querySelector(".card-copy-preview img")?.getAttribute("src")).toBe("blob:actual-renderer-preview");
    expect(field("title").value).toBe("직접 쓴 표지\n제목");
    await click("다음 →"); await input("title", "페이지에서 고친 제목"); await input("subtitle", "본문의 부제"); await input("body", "이미지 안에 들어갈 실제 본문입니다."); await settle(480);
    expect(mocks.blob.mock.lastCall?.[2].body.page).toBe(1);
    expect(mocks.blob.mock.lastCall?.[2].body.copy.pages[0]).toMatchObject({ title: "페이지에서 고친 제목", subtitle: "본문의 부제", body: "이미지 안에 들어갈 실제 본문입니다." });
    expect(dirty).toHaveBeenLastCalledWith(true); expect(mocks.api.mock.calls.some(([p]) => p.endsWith("/generate"))).toBe(false);
    expect(mocks.api.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(false);
  });
  it("preserves written fields when switching templates and supplies the saved version to image generation", async () => {
    const renderImages = vi.fn().mockResolvedValue(undefined);
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, templateKey: "set:n04", onSaveAndRender: renderImages }));
    await input("title", "템플릿을 바꿔도\n남을 제목");
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, templateKey: "set:r03", onSaveAndRender: renderImages }));
    expect(field("title").value).toBe("템플릿을 바꿔도\n남을 제목");
    await click("저장하고 카드뉴스 만들기");
    expect(saved.copy.templateKey).toBe("set:r03"); expect(saved.copy.pages).toEqual(fresh().copy.pages);
    expect(renderImages).toHaveBeenCalledWith(expect.objectContaining({ version: 4, copy: expect.objectContaining({ templateKey: "set:r03", cover: expect.objectContaining({ title: "템플릿을 바꿔도\n남을 제목" }) }) }));
  });
  it("keeps input made during a save and uses the returned version for the next save", async () => {
    const scope = "card-copy-recovery-session"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    let resolve!: (value: CardCopyResponse) => void;
    patch = async body => { const snapshot = structuredClone(body.copy); return new Promise<CardCopyResponse>(done => { resolve = value => { saved = { ...value, copy: snapshot }; done(structuredClone(saved)); }; }); };
    await render(); await input("title", "먼저 저장할 문구");
    await act(async () => button("문구 저장").click());
    await input("title", "저장 중에 더 쓴 문구");
    await act(async () => resolve({ ...saved, version: 4, revisionId: 31 })); await settle();
    expect(field("title").value).toBe("저장 중에 더 쓴 문구"); expect(host.textContent).toContain("저장하지 않은 수정");
    expect(readDraftRecovery(scope, "item:1:9:card-copy", value => value as any)).toMatchObject({ ok: true, value: { baseVersion: 4, value: { cover: { title: "저장 중에 더 쓴 문구" } } } });
    patch = null; await click("문구 저장");
    expect(saved.copy.cover.title).toBe("저장 중에 더 쓴 문구");
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH").at(-1)?.[1].body.version).toBe(4);
  });
  it("preserves local input on conflict and requires comparison before saving against the latest revision", async () => {
    await render(); await input("title", "내가 쓰던 문구");
    saved = { ...fresh(), version: 8, revisionId: 80, copy: { ...fresh().copy, cover: { title: "다른 창의 저장본", subtitle: "최신 부제" } } };
    patch = async () => { throw new ApiError(409, "다른 곳에서 수정되었습니다."); };
    await click("문구 저장");
    expect(field("title").value).toBe("내가 쓰던 문구"); expect(host.textContent).toContain("최신 저장본과 현재 입력 비교하기");
    expect(button("문구 저장").disabled).toBe(true);
    patch = null; await openDetails("최신 저장본과 현재 입력 비교하기"); await click("현재 입력으로 최신 버전에 저장");
    expect(saved.version).toBe(9); expect(saved.copy.cover.title).toBe("내가 쓰던 문구");
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH").at(-1)?.[1].body.version).toBe(8);
  });
  it("uses explicit AI generation and review before replacing the current image copy", async () => {
    await render(); expect(mocks.api.mock.calls.some(([p]) => p.endsWith("/generate"))).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>(".card-copy-ai-tools")?.open).toBe(false); await openDetails("AI로 문구 다듬기");
    await click("AI로 템플릿 문구 제안받기");
    expect(field("title").value).toBe("원고에서 가져온 제목"); expect(host.textContent).toContain("아직 카드에 반영하지 않았어요");
    expect(mocks.api).toHaveBeenCalledWith(`${path}/generate`, { method: "POST", body: { version: 3, templateKey: "set:n04", provider: "gemini", selectedPage: 0, requestId: expect.any(String) } });
    await click("제안 문구로 바꾸기"); expect(field("title").value).toBe("AI가 제안한 제목"); expect(field("subtitle").value).toBe("AI가 제안한 부제");
    expect(saved.copy.cover.title).toBe("원고에서 가져온 제목"); await click("문구 저장"); expect(saved.copy.cover.title).toBe("AI가 제안한 제목");
  });
  it("sends detailed instructions and applies a proposal to only the chosen card", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/generate`) return { version: saved.version, revisionId: saved.revisionId, selectedPage: options.body.selectedPage, copy: { ...structuredClone(saved.copy), cover: { title: "전체 적용하면 바뀔 표지", subtitle: "다른 제안" }, pages: saved.copy.pages.map((page, i) => ({ ...page, id: `new-${i}`, title: `제안 제목 ${i}`, body: `제안 본문 ${i}` })) } };
      return fallback(request, options);
    });
    await render(); await click("다음 →"); await input("body", "내가 직접 편집한 첫 카드"); await click("문구 저장");
    const before = structuredClone(saved.copy);
    await openDetails("AI로 문구 다듬기");
    const note = [...host.querySelectorAll<HTMLLabelElement>("label")].find(node => node.textContent?.includes("어떻게 수정할까요?"))!.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "숫자는 유지하고 쉬운 말로 줄여 주세요"); note.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("AI로 템플릿 문구 제안받기");
    const sent = mocks.api.mock.calls.find(([request]) => request === `${path}/generate`)![1].body;
    expect(sent).toMatchObject({ selectedPage: 1, instructions: "숫자는 유지하고 쉬운 말로 줄여 주세요", version: saved.version });
    expect(saved.copy).toEqual(before);
    await click("1번째 카드에만 제안 적용"); await click("문구 저장");
    expect(saved.copy.cover).toEqual(before.cover); expect(saved.copy.pages.slice(1)).toEqual(before.pages.slice(1));
    expect(saved.copy.pages[0]).toMatchObject({ id: before.pages[0].id, title: "제안 제목 0", body: "제안 본문 0" });
  });
  it("refreshes the live preview when a generated image changes without changing the text version", async () => {
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, coverMode: "ai", previewRevision: 51 })); await settle(500);
    const initial = mocks.blob.mock.calls.length;
    await input("subtitle", "이미지 생성 사이에 유지할 미저장 부제"); await settle(500);
    const afterEdit = mocks.blob.mock.calls.length;
    expect(afterEdit).toBeGreaterThan(initial);
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, coverMode: "ai", previewRevision: 71 })); await settle(500);
    expect(mocks.blob.mock.calls.length).toBeGreaterThan(afterEdit);
    expect(field("subtitle").value).toBe("이미지 생성 사이에 유지할 미저장 부제");
    expect(mocks.api.mock.calls.some(([, options]) => ["POST", "PATCH"].includes(options?.method))).toBe(false);
  });
  it("accepts only one AI or render request when a button is clicked twice before React rerenders", async () => {
    const renderImages = vi.fn().mockResolvedValue(undefined);
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, onSaveAndRender: renderImages }));
    await openDetails("AI로 문구 다듬기");
    await act(async () => { const node = button("AI로 템플릿 문구 제안받기"); node.click(); node.click(); }); await settle();
    expect(mocks.api.mock.calls.filter(([p]) => p === `${path}/generate`)).toHaveLength(1);
    await act(async () => { const node = button("카드뉴스 만들기"); node.click(); node.click(); }); await settle();
    expect(renderImages).toHaveBeenCalledTimes(1);
  });
  it("rechecks a lost AI response with the same request ID without saving or replacing later manual input", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    const bodies: any[] = [];
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/generate`) {
        bodies.push(structuredClone(options.body));
        if (bodies.length === 1) throw new ApiError(0, "응답을 받지 못했습니다.");
        return fallback(request, options);
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI로 문구 다듬기"); await click("AI로 템플릿 문구 제안받기");
    await input("title", "응답을 기다리며 직접 작성한 문구");
    await click("기존 AI 작업 결과 확인");
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
    expect(field("title").value).toBe("응답을 기다리며 직접 작성한 문구");
    expect(button("제안 문구로 바꾸기").disabled).toBe(true);
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });
  it("starts a new explicitly requested AI attempt only after a confirmed terminal failure", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    const ids: string[] = [];
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/generate`) {
        ids.push(options.body.requestId);
        if (ids.length === 1) throw new ApiError(503, "일시적으로 AI를 사용할 수 없습니다.", { jobId: 12, jobStatus: "failed" });
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI로 문구 다듬기"); await click("AI로 템플릿 문구 제안받기");
    expect(ids).toHaveLength(1); expect(field("title").value).toBe(fresh().copy.cover.title);
    await click("AI로 템플릿 문구 제안받기");
    expect(ids).toHaveLength(2); expect(ids[1]).not.toBe(ids[0]);
  });
  it("cancels a running AI request, keeps manual saving available, and ignores a late response", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    let finish!: (value: any) => void;
    let requestId = "";
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/generate`) {
        requestId = options.body.requestId;
        return new Promise(resolve => { finish = resolve; });
      }
      if (request === "/channels/1/items/9/generation-cancel") {
        expect(options.body).toEqual({ requestId }); return { cancelled: true, jobId: 13 };
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI로 문구 다듬기"); await click("AI로 템플릿 문구 제안받기");
    expect(field("title").disabled).toBe(true);
    await click("AI 요청 중단"); expect(field("title").disabled).toBe(false);
    await input("title", "취소 후 직접 저장한 문구"); await click("문구 저장");
    await act(async () => finish({ version: 3, revisionId: 30, copy: { ...fresh().copy, cover: { title: "늦게 온 AI 문구", subtitle: "" } } })); await settle();
    expect(saved.copy.cover.title).toBe("취소 후 직접 저장한 문구");
    expect(field("title").value).toBe("취소 후 직접 저장한 문구");
    expect(host.textContent).not.toContain("아직 카드에 반영하지 않았어요");
    expect(host.textContent).toContain("취소한 AI 결과는 현재 입력에 적용하지 않았습니다.");
  });
  it("keeps long Korean input intact, distinguishes recommendations from hard limits, and allows manual editing without AI", async () => {
    await render(); await act(async () => { client.setQueryData(["studio-ai-status"], { defaultProvider: "gemini", text: { gemini: false, openai: false, anthropic: false } }); }); await settle();
    await openDetails("AI로 문구 다듬기");
    expect(button("AI로 템플릿 문구 제안받기").disabled).toBe(true);
    await click("다음 →"); const recommendation = "가".repeat(141); await input("body", recommendation);
    expect(field("body").value).toBe(recommendation); expect(host.textContent).toContain("자동으로 자르지 않습니다"); expect(button("문구 저장").disabled).toBe(false);
    const overflow = "한".repeat(1001); await input("body", overflow);
    expect(field("body").value).toBe(overflow); expect(field("body").getAttribute("aria-invalid")).toBe("true"); expect(button("문구 저장").disabled).toBe(true);
    await input("body", "입력 안내에 맞춰 직접 고친 본문"); await click("문구 저장"); expect(saved.copy.pages[0].body).toBe("입력 안내에 맞춰 직접 고친 본문");
  });
  it("edits board-generated cards directly and shows the saved automatic image before publication", async () => {
    saved.copy.templateKey = "set:n01";
    const card: StudioCard = { ...studioContentSchema.parse({ title: "제작 보드 카드", format: "카드뉴스", channel: "penguin" }), id: 1, version: 2, sourceItemId: 9, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", sourceOutput: { assetId: 51, channelId: 1, itemId: 9, revisionId: 30, stale: false, pages: Array.from({ length: 5 }, (_, i) => ({ id: 51 + i, title: `완성 ${i}` })), coverCredit: "저장된 표지" } };
    await render(createElement(SourceStudioCard, { card })); await settle();
    expect(host.querySelectorAll(".card-copy-editor")).toHaveLength(1);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(mocks.api).toHaveBeenCalledWith("/channels/1/items/9");
    await input("title", "보드에서 바로 고친 제목");
    expect(button("ZIP 다운로드").disabled).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();
    await click("저장하고 이미지 생성·갱신");
    expect(saved.copy.cover.title).toBe("보드에서 바로 고친 제목");
    expect(mocks.api).toHaveBeenCalledWith("/channels/1/items/9/card", { method: "POST", body: { version: 4, templateKey: "set:n01", coverMode: "ai", requestId: expect.any(String) } });
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/1/media/71");
    expect(host.querySelector<HTMLDetailsElement>("#publish-options")?.open).toBe(false);
    await click("이미지 확인 · 게시 준비 열기");
    expect(host.querySelector<HTMLDetailsElement>("#publish-options")?.open).toBe(true);
    expect(button("ZIP 다운로드").disabled).toBe(false);
    expect(mocks.api.mock.calls.some(([p]) => /approve|publish|deliver/.test(p))).toBe(false);
    renderedCards = [{ ...renderedCards[0], id: 81, carousel: { ...renderedCards[0].carousel, pages: [{ id: 81, title: "다른 창의 이미지" }] } }];
    await act(async () => { await client.invalidateQueries({ queryKey: ["ch", 1, "item", 9] }); }); await settle();
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/1/media/81");
    saved = { ...saved, version: 5, revisionId: 32 };
    await act(async () => { await client.invalidateQueries({ queryKey: ["ch", 1, "item", 9] }); }); await settle();
    expect(host.querySelector(".card-carousel-stage img")).toBeNull();
    expect([...host.querySelectorAll("button")].some(node => node.textContent?.includes("ZIP 다운로드"))).toBe(false);
    expect(host.textContent).toContain("현재 버전(r5)으로 만든 카드가 없습니다.");
  });
  it("saves two independently edited cards and restores their exact text when reopened", async () => {
    await render(); await click("다음 →"); await input("title", "첫 카드에만 저장한 제목"); await input("body", "첫 카드의 본문과 줄바꿈\n저장 후에도 유지합니다.");
    await click("다음 →"); await input("title", "두 번째 카드 제목"); await input("body", "둘째 카드의 별도 본문입니다."); await click("문구 저장");
    expect(saved.copy.pages[0]).toMatchObject({ title: "첫 카드에만 저장한 제목", body: "첫 카드의 본문과 줄바꿈\n저장 후에도 유지합니다." });
    expect(saved.copy.pages[1]).toMatchObject({ title: "두 번째 카드 제목", body: "둘째 카드의 별도 본문입니다." });
    await render(null); client.clear(); await render(); await click("다음 →");
    expect(field("title").value).toBe("첫 카드에만 저장한 제목"); expect(field("body").value).toBe("첫 카드의 본문과 줄바꿈\n저장 후에도 유지합니다.");
    await click("다음 →"); expect(field("title").value).toBe("두 번째 카드 제목"); expect(field("body").value).toBe("둘째 카드의 별도 본문입니다.");
    expect(button("문구 저장").disabled).toBe(true);
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
    expect(mocks.api.mock.calls.some(([request]) => /generate|approve|publish/.test(request))).toBe(false);
  });
});
