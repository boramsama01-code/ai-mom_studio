// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCopyEditor, type CardCopyEditorProps, type StoredCardCopyResponse } from "../client/src/CardCopyEditor";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { readingProfileDesigns, readingProfileForTemplateKey } from "../shared/readingCardProfiles";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (action: () => void) => action() } }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const path = "/channels/1/items/9/card-copy", target = "cardnews14-cinematic-v1";
let root: Root, host: HTMLDivElement, client: QueryClient, saved: StoredCardCopyResponse;
let proposal: (body: any) => Promise<any>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  saved = { version: 3, revisionId: 30, copy: cardCopyFixture("set:r01"), hasSavedCopy: true, recommendedStoryFormat: null };
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:conversion-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn(); mocks.blob.mockResolvedValue(new Blob(["preview"], { type: "image/jpeg" }));
  proposal = async body => {
    const metadata = familyDialogueMetadataFixture(saved.revisionId), copy = familyDialogueCardFixture();
    copy.templateKey = body.templateKey; metadata.pageDesigns = readingProfileDesigns(readingProfileForTemplateKey(body.templateKey)!, metadata.pageDesigns);
    metadata.pageDesigns.cover.background = { ...metadata.pageDesigns.cover.background, kind: "image", assetId: 811 };
    return { version: saved.version, revisionId: saved.revisionId, copy, ...metadata, status: "ready", reviewFlags: [], scope: "all", baseRevision: saved.revisionId, lateResult: false, jobId: 88 };
  };
  mocks.api.mockImplementation(async (request: string, options?: { method?: string; body?: any }) => {
    if (request === "/studio/ai-status") return { text: { gemini: true, openai: true, anthropic: false }, image: true };
    if (request === path && options?.method === "PATCH") {
      const metadata = options.body.copy.version === 2 ? familyDialogueMetadataFixture(saved.revisionId + 1) : {};
      saved = { ...saved, ...metadata, ...structuredClone(options.body), version: saved.version + 1, revisionId: saved.revisionId + 1, hasSavedCopy: true };
      return structuredClone(saved);
    }
    if (request === path) return structuredClone(saved);
    if (request === `${path}/generate`) return proposal(options?.body);
    throw new Error(`Unexpected request: ${request}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle(ms = 25) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function render(extra: Partial<CardCopyEditorProps> = {}) { await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(CardCopyEditor, { channelId: 1, itemId: 9, ...extra })))); await settle(); }
function button(label: string) { const node = [...host.querySelectorAll("button")].find(node => node.textContent === label); if (!node) throw new Error(`Missing button: ${label}`); return node; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.click()); await settle(); }
async function editTitle(value: string) {
  const field = host.querySelector<HTMLTextAreaElement>('textarea[id$="-title"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}

describe("general template picker to the actual eight-page editor", () => {
  it("keeps a notice's manual v1 draft on selection, then explicitly saves, compares, applies and reopens v2", async () => {
    const renderImages = vi.fn(), changed = vi.fn();
    await render({ onSaveAndRender: renderImages, onTemplateChange: changed });
    await editTitle("내가 직접 고친 공고 제목");
    await render({ templateKey: target, onSaveAndRender: renderImages, onTemplateChange: changed });
    expect(host.textContent).toContain("8장 전환 준비");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[id$="-title"]')?.value).toBe("내가 직접 고친 공고 제목");
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
    expect(mocks.api.mock.calls.filter(([request]) => request === `${path}/generate`)).toHaveLength(0);
    expect(saved.copy.version).toBe(1); expect(saved.copy.templateKey).toBe("set:r01");
    expect(button("저장하고 카드뉴스 만들기").disabled).toBe(true);
    await settle(500);
    expect(mocks.blob.mock.calls.every(([, , options]) => options.body.copy.version === 1 && options.body.copy.templateKey === "set:r01")).toBe(true);
    await click("새 8장 형식 자동 제안");
    const savedCall = mocks.api.mock.calls.findIndex(([, options]) => options?.method === "PATCH");
    const generatedCall = mocks.api.mock.calls.findIndex(([request]) => request === `${path}/generate`);
    expect(savedCall).toBeLessThan(generatedCall);
    expect(mocks.api.mock.calls[savedCall][1].body.copy).toMatchObject({ version: 1, templateKey: "set:r01", cover: { title: "내가 직접 고친 공고 제목" } });
    expect(mocks.api.mock.calls[generatedCall][1].body).toMatchObject({ version: 4, baseRevision: 31, formatId: "family_dialogue_8", templateKey: target });
    expect(saved.copy.version).toBe(1); expect(host.textContent).toContain("새 8장 형식 제안 · 기존 원고는 유지 중");
    await click("새 8장 원고로 저장·전환");
    expect(saved.copy).toMatchObject({ version: 2, templateKey: target }); expect(saved.copy.pages).toHaveLength(8);
    expect(saved.pageDesigns?.cover.background.assetId).toBe(811);
    expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(8); expect(renderImages).not.toHaveBeenCalled();
    await act(async () => root.unmount()); root = createRoot(host); await render({ templateKey: target });
    expect(host.querySelector<HTMLSelectElement>('[aria-label="전체 목록에서 선택"]')?.value).toBe(target);
    expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(8);
  });

  it.each(["cardnews14-ink-lime-v1", "set:r01", "set:r05-blue"])("rejects a late eight-page proposal after switching the selection to %s", async nextTemplate => {
    let release!: (value: any) => void;
    const originalProposal = proposal;
    proposal = async body => { const result = await originalProposal(body); await new Promise(resolve => { release = resolve; }); return result; };
    await render({ templateKey: target });
    await click("새 8장 형식 자동 제안");
    await render({ templateKey: nextTemplate });
    await act(async () => release(null)); await settle();
    expect(button("새 8장 원고로 저장·전환").disabled).toBe(true);
    expect(host.textContent).toContain("원고나 선택한 디자인이 달라졌습니다");
    expect(saved.copy.version).toBe(1); expect(saved.copy.templateKey).toBe("set:r01");
  });

  it("does not call paid generation in manual mode when an eight-page set is selected", async () => {
    await render({ templateKey: target, showAi: false });
    expect(host.textContent).toContain("자동 작업으로 바꾼 뒤 8장 제안을 요청");
    expect(mocks.api.mock.calls.some(([request, options]) => request === `${path}/generate` || options?.method === "PATCH")).toBe(false);
  });
});
