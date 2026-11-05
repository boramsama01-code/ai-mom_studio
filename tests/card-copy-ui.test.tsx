// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCopyEditor, type CardCopyResponse } from "../client/src/CardCopyEditor";
import { SourceStudioCard } from "../client/src/pages/SourceStudioCard";
import { ApiError } from "../client/src/api";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { discussionCardCopyFixture } from "./fixtures/discussionCardCopy";
import { activateDraftRecoveryScope, readDraftRecovery } from "../client/src/draftRecovery";
import { studioImagePrompt, type CardImagePromptView } from "../shared/studioImagePrompt";

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
  return { version: 3, revisionId: 30, hasSavedCopy: true, ai: { summary: { provider: "gemini", model: "gemini-test" }, copy: { provider: "openai", model: "gpt-test" }, image: { provider: "openai", model: "gpt-image-test" } }, copy: { version: 1, templateKey: "set:n04", cover: { title: "원고에서 가져온 제목", subtitle: "사실을 확인하는 부제" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 제목 ${i + 1}`, subtitle: `본문 부제 ${i + 1}`, body: `원문에 근거한 카드 본문 ${i + 1}` })) } };
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
    if (request === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: true, anthropic: false }, image: true };
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
async function imagePromptInput(value: string) {
  const node = host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]');
  if (!node) throw new Error("Image prompt field missing");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
function promptFixture(): CardImagePromptView {
  const prompt = `현재 제목: ${saved.copy.cover.title} · 위쪽에는 글자를 넣을 여백`;
  return { itemVersion: saved.version, revisionId: saved.revisionId, pageId: "cover", promptVersion: 0,
    defaultPrompt: prompt, prompt, instruction: "", custom: false, basedOnRevisionId: null, stale: false,
    model: "gpt-image-test", referenceAssetId: null, lastGeneration: null };
}

describe("card copy editor", () => {
  it("opens and saves editable image prompts before approval, reopens them, and sends the edited prompt only on generate", async () => {
    saved.copy.templateKey = "builtin:classic";
    let prompt: CardImagePromptView = { itemVersion: 3, revisionId: 30, pageId: "cover", promptVersion: 0,
      defaultPrompt: "원문에 맞는 로봇과 교실, 위쪽은 글자 여백", prompt: "원문에 맞는 로봇과 교실, 위쪽은 글자 여백", instruction: "", custom: false,
      basedOnRevisionId: null, stale: false, model: "gpt-image-test", referenceAssetId: null, lastGeneration: null };
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/image-prompt?pageId=cover`) return structuredClone(prompt);
      if (request === `${path}/image-prompt` && options?.method === "PUT") {
        expect(options.body.promptVersion).toBe(prompt.promptVersion);
        prompt = { ...prompt, prompt: options.body.prompt ?? prompt.defaultPrompt, custom: options.body.prompt !== null, instruction: options.body.instruction, promptVersion: prompt.promptVersion + 1, basedOnRevisionId: saved.revisionId };
        return structuredClone(prompt);
      }
      if (request === `${path}/background`) {
        prompt.lastGeneration = { assetId: 401, prompt: studioImagePrompt({ purpose: "cover", prompt: options.body.prompt, instruction: options.body.instruction }), model: "gpt-image-test", generatedAt: "2026-11-05T09:00:00.000Z" };
        return { assetId: 401, version: saved.version, pageId: "cover", source: "ai", credit: "AI 일러스트 · OpenAI", jobId: 141 };
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!;
    const edited = "파란 배경의 과학 실험실과 망원경. 오른쪽은 비워 주세요.";
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, edited); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="실제 AI 요청 전체"]')!.value).toBe(studioImagePrompt({ purpose: "cover", prompt: edited, instruction: "" }));
    await click("프롬프트만 저장");
    expect(prompt.prompt).toBe(edited);
    expect(mocks.api.mock.calls.some(([url]) => url === `${path}/background` || url.endsWith("/approve"))).toBe(false);
    await render(null); await render(); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toBe(edited);
    await click("이 페이지 배경 자동 만들기");
    expect(mocks.api).toHaveBeenCalledWith(`${path}/background`, expect.objectContaining({ body: expect.objectContaining({ prompt: edited, pageId: "cover", mode: "ai" }) }));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="최근 생성 프롬프트"]')!.value).toBe(prompt.lastGeneration!.prompt);
    expect(host.textContent).toContain("이미지 #401 · gpt-image-test");
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/approve"))).toBe(false);
  });
  it("protects unsaved image prompt edits across a page without artwork and saves them through the leave guard without generating", async () => {
    saved.copy.templateKey = "builtin:classic";
    const scope = "image-prompt-recovery"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    let prompt = promptFixture();
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/image-prompt?pageId=cover`) return structuredClone(prompt);
      if (request === `${path}/image-prompt` && options?.method === "PUT") {
        prompt = { ...prompt, prompt: options.body.prompt ?? prompt.defaultPrompt, custom: options.body.prompt !== null, instruction: options.body.instruction, promptVersion: prompt.promptVersion + 1 };
        return structuredClone(prompt);
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    const edited = "화면을 옮겨도 보존할 프롬프트\n부드러운 붉은빛의 망원경, 위쪽은 여백.";
    await imagePromptInput(edited);
    expect(mocks.guard.setDirty.mock.calls.filter(([key]) => key === "card-image-prompts-1-9").at(-1)?.[1]).toBe(true);
    const checkpoint = readDraftRecovery<Record<string, { prompt: string; custom: boolean }>>(scope, "item:1:9:page-image-prompts", value => value as Record<string, { prompt: string; custom: boolean }>);
    expect(checkpoint.ok && checkpoint.value?.value.cover).toEqual({ prompt: edited, custom: true });
    await click("다음 →"); expect(host.querySelector(".page-background-editor")).toBeNull();
    await click("← 이전"); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    expect(host.querySelector('[aria-label="페이지별 이미지 프롬프트 기기 복구본"]')).not.toBeNull();
    await click("복구본을 편집기에 불러오기");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toBe(edited);
    const guardedSave = mocks.guard.setDirty.mock.calls.filter(([key, dirty]) => key === "card-image-prompts-1-9" && dirty).at(-1)![2];
    await act(async () => { expect(await guardedSave()).toBe(true); }); await settle();
    expect(prompt.prompt).toBe(edited);
    expect(mocks.guard.setDirty.mock.calls.filter(([key]) => key === "card-image-prompts-1-9").at(-1)?.[1]).toBe(false);
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/background") || url.endsWith("/approve"))).toBe(false);
    const afterSave = readDraftRecovery(scope, "item:1:9:page-image-prompts", value => value);
    expect(afterSave.ok && afterSave.value).toBeNull();
  });
  it("refreshes the default image prompt after a manuscript save while retaining directly edited prompts", async () => {
    saved.copy.templateKey = "builtin:classic";
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => request === `${path}/image-prompt?pageId=cover` ? promptFixture() : fallback(request, options));
    await render(); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    await input("title", "새로 저장한 과학 캠프 제목"); await click("문구 저장");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toContain("새로 저장한 과학 캠프 제목");
    const custom = "내가 직접 고친 구도는 원고 갱신 뒤에도 유지";
    await imagePromptInput(custom); await input("title", "다음 버전의 관찰 기록"); await click("문구 저장");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toBe(custom);
    await click("기본 구성으로 되돌리기");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toContain("다음 버전의 관찰 기록");
    expect(mocks.api.mock.calls.some(([url, options]) => url.endsWith("/background") || url.endsWith("/approve") || options?.method === "PUT")).toBe(false);
  });
  it("does not silently rebase a local prompt edit when refreshing another screen's saved instructions", async () => {
    saved.copy.templateKey = "builtin:classic";
    let prompt = promptFixture();
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/image-prompt?pageId=cover`) return structuredClone(prompt);
      if (request === `${path}/image-prompt` && options?.method === "PUT") {
        expect(options.body.promptVersion).toBe(0);
        throw new ApiError(409, "다른 화면에서 이미지 프롬프트를 먼저 수정했습니다.");
      }
      return fallback(request, options);
    });
    await render(); await openDetails("AI 이미지·프롬프트"); await click("프롬프트 확인·수정");
    await imagePromptInput("현재 화면에서 아직 저장하지 않은 우주 배경");
    prompt = { ...prompt, promptVersion: 1, prompt: "다른 화면에서 저장한 바다 배경", custom: true };
    await click("최신 원고·생성 기록 불러오기");
    expect(host.textContent).toContain("새 저장본을 덮어쓰지 않습니다");
    await click("프롬프트만 저장");
    expect(prompt.prompt).toBe("다른 화면에서 저장한 바다 배경");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="이미지 프롬프트"]')!.value).toBe("현재 화면에서 아직 저장하지 않은 우주 배경");
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/background") || url.endsWith("/approve"))).toBe(false);
  });
  it("rebuilds into eight roles with the channel copy AI, reviews before apply, and persists independent comparison columns", async () => {
    saved.recommendedStoryFormat = "discussion8";
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/generate`) return { version: saved.version, revisionId: saved.revisionId, copy: discussionCardCopyFixture("set:n04"), scope: "all", jobId: 105 };
      return fallback(request, options);
    });
    await render();
    expect(host.querySelector<HTMLSelectElement>(".card-copy-ai select")?.value).toBe("openai"); // Global default is Gemini.
    await click("8장 뉴스 대화로 다시 구성");
    expect(mocks.api).toHaveBeenCalledWith(`${path}/generate`, expect.objectContaining({ body: { version: 3, templateKey: "set:n04", storyFormat: "discussion8", refreshAnalysis: true, requestId: expect.any(String) } }));
    expect(saved.copy.pages).toHaveLength(4); expect(host.querySelectorAll(".card-copy-dots button")).toHaveLength(5);
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "표지에만 제안 적용")).toBe(false);
    await click("8장 제안을 편집기에 적용"); expect(host.querySelectorAll(".card-copy-dots button")).toHaveLength(8);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="5페이지 두 가지 시선 문구 편집"]')!.click());
    await input("column-0-body", "내가 중요하게 여기는 첫 번째 기준입니다.");
    await input("column-1-title", "내가 보탠 다른 시선");
    await click("문구 저장");
    expect(saved.copy.storyFormat).toBe("discussion8");
    expect(saved.copy.pages[3].columns).toMatchObject([{ body: "내가 중요하게 여기는 첫 번째 기준입니다." }, { title: "내가 보탠 다른 시선" }]);
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH").at(-1)?.[1].body.proposalJobId).toBe(105);
    await render(null); client.clear(); await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="5페이지 두 가지 시선 문구 편집"]')!.click());
    expect(field("column-0-body").value).toBe("내가 중요하게 여기는 첫 번째 기준입니다.");
    expect(field("column-1-title").value).toBe("내가 보탠 다른 시선");
    expect(saved.ai?.copy.provider).toBe("openai");
  });
  it("recovers incomplete eight-page copy with columns, roles, sources and background IDs intact", async () => {
    saved.copy = discussionCardCopyFixture(); saved.copy.pages[3].background = { assetId: 301, opacity: 65 };
    const scope = "eight-page-recovery"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="5페이지 두 가지 시선 문구 편집"]')!.click());
    await input("column-0-body", ""); await input("column-1-title", "창을 닫아도 남을 시선");
    await render(null); await render(); await click("복구본을 편집기에 불러오기");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="5페이지 두 가지 시선 문구 편집"]')!.click());
    expect(field("column-0-body").value).toBe(""); expect(field("column-1-title").value).toBe("창을 닫아도 남을 시선");
    expect(button("문구 저장").disabled).toBe(true);
    await input("column-0-body", "복구 뒤 완성한 비교 문장"); await click("문구 저장");
    expect(saved.copy.pages[3].background).toEqual({ assetId: 301, opacity: 65 });
    expect(saved.copy.pages[0].sourceIds).toEqual([1]); expect(saved.copy.pages[3].role).toBe("perspectives");
  });
  it("generates only the requested page background once and preserves text typed while it runs", async () => {
    saved.copy = discussionCardCopyFixture();
    let finish!: (value: any) => void; let submitted: any;
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/background`) { submitted = options.body; return new Promise(resolve => { finish = resolve; }); }
      return fallback(request, options);
    });
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="5페이지 두 가지 시선 문구 편집"]')!.click());
    await openDetails("이 페이지 배경");
    await act(async () => { const node = button("이 페이지 배경 자동 만들기"); node.click(); node.click(); }); await settle();
    expect(submitted).toMatchObject({ version: 3, pageId: "body-4", mode: "ai", requestId: expect.any(String) });
    expect(mocks.api.mock.calls.filter(([p]) => p === `${path}/background`)).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="2페이지 뉴스 요약 문구 편집"]')!.click());
    await input("body", "이미지를 기다리는 동안 직접 고친 뉴스 요약");
    await act(async () => finish({ assetId: 302, version: 3, pageId: "body-4", source: "ai", credit: "AI 일러스트 · OpenAI", jobId: 106 })); await settle();
    expect(field("body").value).toBe("이미지를 기다리는 동안 직접 고친 뉴스 요약");
    expect(saved.copy.pages[3].background).toBeUndefined();
    await click("문구 저장");
    expect(saved.copy.pages[3].background).toEqual({ assetId: 302, opacity: 100 });
    expect(saved.copy.pages[0].background).toBeUndefined(); expect(saved.copy.pages[0].body).toBe("이미지를 기다리는 동안 직접 고친 뉴스 요약");
    expect(saved.copy.cover.background).toBeUndefined();
  });
  it("recovers an uploaded image through GET without retaining or resending its bytes, then asks before using a stale result", async () => {
    saved.copy = discussionCardCopyFixture();
    let submitted: any; const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => {
      if (request === `${path}/background`) { submitted = options.body; throw new ApiError(0, "응답 유실"); }
      if (request.startsWith(`${path}/background-requests/`)) return { status: "succeeded", response: { assetId: 303, version: 3, pageId: "cover", source: "upload", credit: "직접 등록 이미지", jobId: 107 } };
      return fallback(request, options);
    });
    await render(); await openDetails("이 페이지 배경");
    const file = new File(["isolated-image-bytes"], "background.png", { type: "image/png" });
    const upload = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => { Object.defineProperty(upload, "files", { configurable: true, value: [file] }); upload.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(60);
    expect(submitted.imageData).toMatch(/^data:image\/png;base64,/);
    const record = JSON.parse(sessionStorage.getItem("spacepenguin.generation:1:9:page-background")!);
    expect(record.requestId).toBe(submitted.requestId); expect(JSON.stringify(record)).not.toContain("data:image"); expect(record).not.toHaveProperty("imageData");
    await input("title", "응답을 잃은 뒤 먼저 저장한 최신 표지"); await click("문구 저장");
    await click("기존 배경 작업 결과 확인");
    expect(mocks.api).toHaveBeenCalledWith(`${path}/background-requests/${submitted.requestId}`);
    expect(mocks.api.mock.calls.filter(([p]) => p === `${path}/background`)).toHaveLength(1);
    expect(saved.copy.cover.background).toBeUndefined(); expect(host.textContent).toContain("확인 후 사용할 수 있는 배경");
    await click("현재 표지에 이 배경 사용"); await click("문구 저장");
    expect(saved.copy.cover).toMatchObject({ title: "응답을 잃은 뒤 먼저 저장한 최신 표지", background: { assetId: 303, opacity: 100 } });
    expect(sessionStorage.getItem("spacepenguin.generation:1:9:page-background")).toBeNull();
  });
  it("keeps the selected background and manual saving available after a confirmed image failure", async () => {
    saved.copy = discussionCardCopyFixture(); saved.copy.cover.background = { assetId: 304, opacity: 70 };
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => request === `${path}/background` ? Promise.reject(new ApiError(503, "이미지 한도에 도달했습니다.", { jobStatus: "failed" })) : fallback(request, options));
    await render(); await openDetails("이 페이지 배경"); await click("이 페이지 배경 다시 만들기");
    await input("title", "그림 오류 후에도 저장한 문구"); await click("문구 저장");
    expect(saved.copy.cover).toMatchObject({ title: "그림 오류 후에도 저장한 문구", background: { assetId: 304, opacity: 70 } });
    expect(sessionStorage.getItem("spacepenguin.generation:1:9:page-background")).toBeNull();
  });
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
    expect(mocks.api).toHaveBeenCalledWith(`${path}/generate`, { method: "POST", body: { version: 3, templateKey: "set:n04", selectedPage: 0, requestId: expect.any(String) } });
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
