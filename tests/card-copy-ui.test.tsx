// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCopyEditor, type CardCopyResponse } from "../client/src/CardCopyEditor";
import { SourceStudioCard } from "../client/src/pages/SourceStudioCard";
import { ApiError } from "../client/src/api";
import { studioContentSchema, type StudioCard } from "../shared/studio";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (fn: () => void) => fn() }, navigate: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ select: vi.fn(), channels: [], allChannels: [] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/studio/1", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient, saved: CardCopyResponse;
let patch: ((body: { version: number; copy: CardCopyResponse["copy"] }) => Promise<CardCopyResponse>) | null;
const path = "/channels/1/items/9/card-copy";
function fresh(): CardCopyResponse {
  return { version: 3, revisionId: 30, hasSavedCopy: true, copy: { version: 1, templateKey: "set:n04", cover: { title: "원고에서 가져온 제목", subtitle: "사실을 확인하는 부제" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 제목 ${i + 1}`, subtitle: `본문 부제 ${i + 1}`, body: `원문에 근거한 카드 본문 ${i + 1}` })) } };
}
beforeEach(() => {
  vi.clearAllMocks(); saved = fresh(); patch = null;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:actual-renderer-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  mocks.blob.mockResolvedValue(new Blob(["renderer-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (request: string, options?: { method?: string; body?: any }) => {
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
    if (request === "/channels/1/items/9/card") return { id: 71, studioCardId: 1, carousel: { version: 1, cover: { kind: "typography", credit: "글자 중심" }, pages: Array.from({ length: 5 }, (_, i) => ({ id: 71 + i, sha256: `sha-${i}`, title: i === 0 ? saved.copy.cover.title : saved.copy.pages[i - 1].title })) } };
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
function field(suffix: string) { const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id$="-${suffix}"]`); if (!node) throw new Error(`Field missing: ${suffix}`); return node; }
async function input(suffix: string, value: string) {
  const node = field(suffix);
  await act(async () => { const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("card copy editor", () => {
  it("edits actual image title, subtitle and body through the exact-renderer preview without generating AI", async () => {
    saved.copy.cover.title = "기존에 저장된\n표지 제목";
    const dirty = vi.fn(); await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, onDirtyChange: dirty }));
    expect(field("title").value).toBe(saved.copy.cover.title); expect(host.textContent).toContain("게시물 캡션은 아래에서 따로");
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
    let resolve!: (value: CardCopyResponse) => void;
    patch = async body => { const snapshot = structuredClone(body.copy); return new Promise<CardCopyResponse>(done => { resolve = value => { saved = { ...value, copy: snapshot }; done(structuredClone(saved)); }; }); };
    await render(); await input("title", "먼저 저장할 문구");
    await act(async () => button("문구 저장").click());
    await input("title", "저장 중에 더 쓴 문구");
    await act(async () => resolve({ ...saved, version: 4, revisionId: 31 })); await settle();
    expect(field("title").value).toBe("저장 중에 더 쓴 문구"); expect(host.textContent).toContain("저장하지 않은 수정");
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
    patch = null; await click("현재 입력으로 최신 버전에 저장");
    expect(saved.version).toBe(9); expect(saved.copy.cover.title).toBe("내가 쓰던 문구");
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH").at(-1)?.[1].body.version).toBe(8);
  });
  it("uses explicit AI generation and review before replacing the current image copy", async () => {
    await render(); expect(mocks.api.mock.calls.some(([p]) => p.endsWith("/generate"))).toBe(false);
    await click("AI로 템플릿 문구 제안받기");
    expect(field("title").value).toBe("원고에서 가져온 제목"); expect(host.textContent).toContain("아직 카드에 반영하지 않았어요");
    expect(mocks.api).toHaveBeenCalledWith(`${path}/generate`, { method: "POST", body: { version: 3, templateKey: "set:n04", provider: "gemini" } });
    await click("제안 문구로 바꾸기"); expect(field("title").value).toBe("AI가 제안한 제목"); expect(field("subtitle").value).toBe("AI가 제안한 부제");
    expect(saved.copy.cover.title).toBe("원고에서 가져온 제목"); await click("문구 저장"); expect(saved.copy.cover.title).toBe("AI가 제안한 제목");
  });
  it("accepts only one AI or render request when a button is clicked twice before React rerenders", async () => {
    const renderImages = vi.fn().mockResolvedValue(undefined);
    await render(createElement(CardCopyEditor, { channelId: 1, itemId: 9, onSaveAndRender: renderImages }));
    await act(async () => { const node = button("AI로 템플릿 문구 제안받기"); node.click(); node.click(); }); await settle();
    expect(mocks.api.mock.calls.filter(([p]) => p === `${path}/generate`)).toHaveLength(1);
    await act(async () => { const node = button("카드뉴스 만들기"); node.click(); node.click(); }); await settle();
    expect(renderImages).toHaveBeenCalledTimes(1);
  });
  it("keeps long Korean input intact, distinguishes recommendations from hard limits, and allows manual editing without AI", async () => {
    await render(); await act(async () => { client.setQueryData(["studio-ai-status"], { defaultProvider: "gemini", text: { gemini: false, openai: false, anthropic: false } }); }); await settle();
    expect(button("AI로 템플릿 문구 제안받기").disabled).toBe(true);
    await click("다음 →"); const recommendation = "가".repeat(141); await input("body", recommendation);
    expect(field("body").value).toBe(recommendation); expect(host.textContent).toContain("자동으로 자르지 않습니다"); expect(button("문구 저장").disabled).toBe(false);
    const overflow = "한".repeat(1001); await input("body", overflow);
    expect(field("body").value).toBe(overflow); expect(field("body").getAttribute("aria-invalid")).toBe("true"); expect(button("문구 저장").disabled).toBe(true);
    await input("body", "입력 안내에 맞춰 직접 고친 본문"); await click("문구 저장"); expect(saved.copy.pages[0].body).toBe("입력 안내에 맞춰 직접 고친 본문");
  });
  it("edits board-generated cards directly, blocks stale downloads and regenerates with stored art only", async () => {
    const card: StudioCard = { ...studioContentSchema.parse({ title: "제작 보드 카드", format: "카드뉴스", channel: "penguin" }), id: 1, version: 2, sourceItemId: 9, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", sourceOutput: { assetId: 51, channelId: 1, itemId: 9, revisionId: 30, stale: false, pages: Array.from({ length: 5 }, (_, i) => ({ id: 51 + i, title: `완성 ${i}` })), coverCredit: "저장된 표지" } };
    await render(createElement(SourceStudioCard, { card })); await settle();
    await input("title", "보드에서 바로 고친 제목");
    expect(button("ZIP 다운로드").disabled).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();
    await click("저장하고 카드뉴스 다시 만들기");
    expect(saved.copy.cover.title).toBe("보드에서 바로 고친 제목");
    expect(mocks.api).toHaveBeenCalledWith("/channels/1/items/9/card", { method: "POST", body: { version: 4, templateKey: "set:n04", coverMode: "reuse" } });
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/1/media/71");
    expect(mocks.api.mock.calls.some(([p]) => /approve|publish|deliver/.test(p))).toBe(false);
    const refreshed = { ...card, sourceOutput: { ...card.sourceOutput!, assetId: 71, revisionId: 31, pages: Array.from({ length: 5 }, (_, i) => ({ id: 71 + i, title: `수정 ${i}` })) } };
    await render(createElement(SourceStudioCard, { card: refreshed }));
    await render(createElement(SourceStudioCard, { card: { ...refreshed, sourceOutput: { ...refreshed.sourceOutput, stale: true, assetId: 81, pages: [{ id: 81, title: "다른 창의 이미지" }] } } }));
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/1/media/81");
    expect(button("ZIP 다운로드").disabled).toBe(true);
  });
});
