// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardCopyEditor, type StoredCardCopyResponse } from "../client/src/CardCopyEditor";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { activateDraftRecoveryScope } from "../client/src/draftRecovery";
import { notionInteriorTemplates } from "../shared/notionPageTemplates";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: vi.fn((fn: () => void) => fn()) } }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, saved: StoredCardCopyResponse;
const path = "/channels/3/items/9/card-copy";
const original = "본문 첫 문장을 보존합니다.\n둘째 문장과 11월 13일 18:00도 그대로 둡니다.";
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  saved = { version: 3, revisionId: 30, hasSavedCopy: true, copy: { version: 1, templateKey: "editorial:red", cover: { title: "원래 표지", subtitle: "표지 설명" }, pages: [{ id: "body-1", title: "첫 내지", subtitle: "기관 안내", body: original, sourceIds: [31] }, { id: "body-2", title: "둘째 내지", subtitle: "", body: "다른 페이지 원고" }] } };
  mocks.api.mockImplementation(async (request: string, options?: { method?: string; body?: any }) => {
    if (request === "/studio/ai-status") return { text: {}, image: false };
    if (request === path && options?.method === "PATCH") {
      saved = { ...saved, ...structuredClone(options.body), version: saved.version + 1, revisionId: saved.revisionId + 1 };
      return structuredClone(saved);
    }
    if (request === path) return structuredClone(saved);
    throw new Error(`Unexpected request ${request}`);
  });
  mocks.blob.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); });
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }
async function render(templateKey?: string) { await act(async () => root.render(<QueryClientProvider client={client}><CardCopyEditor channelId={3} itemId={9} templateKey={templateKey} showAi={false} /></QueryClientProvider>)); await settle(); }
function field(name: string) { const value = host.querySelector<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`); if (!value) throw Error(`Missing ${name}`); return value; }
async function fill(name: string, text: string) { const node = field(name); await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, text); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === text); if (!node) throw Error(`Missing button ${text}`); return node; }
async function click(text: string) { const node = button(text); expect(node.disabled).toBe(false); await act(async () => node.click()); await settle(); }
async function page(index: number, family = false) { const strip = host.querySelectorAll<HTMLButtonElement>(family ? ".family-page-strip button" : ".card-copy-dots button"); if (!strip[index]) throw Error(`Missing page ${index}`); await act(async () => strip[index].click()); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH");

describe("Inbox current kit per-page interiors", () => {
  it("offers only the current nine interiors and saves one page's choice without changing text/order/source IDs", async () => {
    const before = structuredClone(saved.copy); await render(); expect(host.querySelector('[aria-label="내지 템플릿"]')).toBeNull();
    await page(1); expect([...field("내지 템플릿").querySelectorAll("option")].map(option => (option as HTMLOptionElement).value)).toEqual(["auto", ...notionInteriorTemplates]);
    await fill("내지 템플릿", "document_excerpt"); await fill("형광펜 강조 문구", "11월 13일"); await fill("내지 각주", "원문 기준 안내");
    expect(field("카드 본문").value).toBe(original); expect(host.textContent).toContain("이미지"); expect(writes()).toHaveLength(0);
    await page(2); await fill("내지 템플릿", "text"); await page(1); expect(field("내지 템플릿").value).toBe("document_excerpt");
    await click("문구 저장"); expect(writes()).toHaveLength(1);
    expect(saved.copy).toMatchObject({ ...before, pages: [{ ...before.pages[0], interiorTemplate: "document_excerpt", emphasis: "11월 13일", footnote: "원문 기준 안내" }, { ...before.pages[1], interiorTemplate: "text" }] });
  });
  it("buffers incompatible table cells across navigation and changes the body only on explicit apply", async () => {
    const before = structuredClone(saved.copy); await render(); await page(1); await fill("내지 템플릿", "table");
    expect(field("카드 본문").value).toBe(original); expect(button("문구 저장").disabled).toBe(true);
    await fill("1열 머리글", "지역"); await fill("2열 머리글", "마감일"); await fill("1행 1열", "서울"); await fill("1행 2열", "11/13 18:00");
    await page(2); await page(1); expect(field("1행 2열").value).toBe("11/13 18:00"); expect(writes()).toHaveLength(0); expect(field("카드 본문").value).toBe(original);
    await click("표 내용 적용"); expect(field("카드 본문").value).toBe("지역 | 마감일\n서울 | 11/13 18:00"); await click("문구 저장");
    expect(saved.copy.pages[0]).toMatchObject({ id: "body-1", interiorTemplate: "table", sourceIds: [31] }); expect(saved.copy.version === 1 && saved.copy.cover).toEqual(before.version === 1 && before.cover); expect(saved.copy.pages[1]).toEqual(before.pages[1]);
  });
  it("recovers unapplied inputs after closing and can cancel them without rewriting the saved manuscript", async () => {
    const scope = "common-interior-recovery"; activateDraftRecoveryScope(scope); client.setQueryDefaults(["me"], { gcTime: Infinity }); client.setQueryData(["me"], { user: "fixture", recoveryScope: scope });
    await render(); await page(1); await fill("내지 템플릿", "two_columns"); await fill("왼쪽 본문", "왼쪽 미완성 초안"); await fill("오른쪽 본문", "오른쪽 미완성 초안");
    await act(async () => root.unmount()); root = createRoot(host); await render(); expect(host.querySelector('[aria-label="내지 구성 입력 기기 복구본"]')).toBeTruthy();
    await click("복구본을 편집기에 불러오기"); await page(1); expect(field("왼쪽 본문").value).toBe("왼쪽 미완성 초안"); expect(field("카드 본문").value).toBe(original);
    await click("구성 입력 취소"); expect(field("내지 템플릿").value).toBe("auto"); expect(field("카드 본문").value).toBe(original); expect(writes()).toHaveLength(0);
  });
  it("switches an existing V2 draft to a current color and preserves eight fields/evidence/images when selecting an interior", async () => {
    const copy = familyDialogueCardFixture(), metadata = familyDialogueMetadataFixture(); metadata.pageDesigns.news_summary.background = { ...metadata.pageDesigns.news_summary.background, kind: "image", assetId: 501 };
    saved = { version: 3, revisionId: 30, hasSavedCopy: true, copy, ...metadata }; const before = structuredClone(saved);
    await render("editorial:cyan"); await page(1, true); await fill("내지 템플릿", "image_text"); await fill("형광펜 강조 문구", "전망"); await click("문구·디자인 저장");
    expect(saved.copy).toEqual({ ...before.copy, templateKey: "editorial:cyan" }); expect(saved.copy.pages).toHaveLength(8);
    expect(saved.pageDesigns?.news_summary).toMatchObject({ interiorTemplate: "image_text", emphasis: "전망", background: { kind: "image", assetId: 501 } });
    expect(saved.evidenceBinding).toEqual(before.evidenceBinding); expect(saved.pageDesigns?.discussion).toEqual(before.pageDesigns?.discussion);
  });
  it("stores an explicitly applied V2 table separately from original fields and restores their automatic layout", async () => {
    saved = { version: 3, revisionId: 30, hasSavedCopy: true, copy: { ...familyDialogueCardFixture(), templateKey: "editorial:cyan" }, ...familyDialogueMetadataFixture() }; const before = structuredClone(saved.copy);
    await render(); await page(1, true); await fill("내지 템플릿", "table"); expect(button("문구·디자인 저장").disabled).toBe(true);
    await fill("1열 머리글", "구분"); await fill("2열 머리글", "내용"); await fill("1행 1열", "전망"); await fill("1행 2열", "원문에서 확인한 전망");
    await click("표 내용 적용"); await click("문구·디자인 저장"); expect(saved.copy).toEqual(before); expect(saved.pageDesigns?.news_summary.interiorBody).toBe("구분 | 내용\n전망 | 원문에서 확인한 전망");
    await click("구성 본문을 원래 원고로 되돌리기"); await click("문구·디자인 저장"); expect(saved.copy).toEqual(before); expect(saved.pageDesigns?.news_summary.interiorBody).toBeUndefined(); expect(saved.pageDesigns?.news_summary.interiorTemplate).toBeUndefined();
  });
});
