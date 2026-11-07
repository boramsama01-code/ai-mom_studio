// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvaLibraryPanel, CANVA_LIBRARY_QUERY_KEY, safeCanvaLink, safeCanvaPreview, useCanvaTemplateLibrary } from "../client/src/CanvaTemplateLibrary";
import type { CanvaTemplateLibraryState } from "../shared/canvaTemplateLibrary";
import { CANVA_READING_TEXT_FIELDS } from "../shared/canvaEditorial";
import { canvaLibraryItemFixture, canvaLibraryStateFixture } from "./fixtures/canvaTemplateLibrary";

const mocks = vi.hoisted(() => ({ api: vi.fn(), select: vi.fn(), manualSelect: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/ui", () => ({
  GuardedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  ErrorBox: ({ error, retry }: { error: Error; retry?: () => void }) => <div role="alert">{error.message}{retry && <button onClick={retry}>다시 시도</button>}</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
type PanelProps = Omit<ComponentProps<typeof CanvaLibraryPanel>, "query">;
let root: Root, host: HTMLDivElement, client: QueryClient, library: CanvaTemplateLibraryState;
let syncResult: CanvaTemplateLibraryState | null;
function Harness(props: PanelProps) { return <CanvaLibraryPanel query={useCanvaTemplateLibrary()} {...props} />; }
beforeEach(() => {
  vi.clearAllMocks();
  library = canvaLibraryStateFixture({ items: [canvaLibraryItemFixture()] }); syncResult = null;
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/canva/template-library/sync" && options?.method === "POST") { library = syncResult ?? library; return structuredClone(library); }
    if (path === "/canva/template-library" && options?.method === "PUT") {
      library = { ...library, folderId: options.body.folderId, folderUrl: `https://www.canva.com/folder/${options.body.folderId}`, enabled: options.body.enabled };
      return structuredClone(library);
    }
    if (path === "/canva/template-library" && !options?.method) return structuredClone(library);
    throw new Error(`Unexpected test request: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor); else Reflect.deleteProperty(navigator, "clipboard"); });
async function settle() { for (let index = 0; index < 2; index++) await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20); else await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(props: PanelProps = {}) { await act(async () => root.render(<QueryClientProvider client={client}><Harness onSelect={mocks.select} {...props} /></QueryClientProvider>)); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll("button")].find(value => value.textContent === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
async function setInput(node: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(); }
async function refresh() { await act(async () => { await client.invalidateQueries({ queryKey: CANVA_LIBRARY_QUERY_KEY }); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => ["POST", "PUT"].includes(options?.method));

describe("Canva folder library UI", () => {
  it.each(['ready', 'needs_fields'] as const)('allows explicit manual reference selection without autofill for a valid %s design, without invoking automatic selection or writes', async status => {
    library.autofill = false;
    library.items = [canvaLibraryItemFixture({ status, canCreate: false })];
    await render({ onManualSelect: mocks.manualSelect, manualAvailable: true });
    expect(button('직접 편집용으로 선택').disabled).toBe(false);
    expect([...host.querySelectorAll('button')].some(node => node.textContent === '자동 채우기로 선택' || node.textContent === '이 Canva 템플릿 선택')).toBe(false);
    expect(host.textContent).not.toContain('저장된 원고를 채웁니다.');
    await click('직접 편집용으로 선택');
    expect(mocks.manualSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ designId: 'Dlibrary_first', pageCount: 8 }));
    expect(mocks.select).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
    expect(host.textContent).toContain('이 콘텐츠용 사본을 만들어 편집');
  });

  it.each([
    { status: 'missing' as const }, { status: 'unavailable' as const }, { status: 'unsupported_pages' as const },
    { pageCount: 7 }, { pageCount: null }, { previewStatus: 'unavailable' as const }, { previewStatus: 'failed' as const },
    { pages: canvaLibraryItemFixture().pages.slice(0, 7) },
    { pages: canvaLibraryItemFixture().pages.map((page, index) => index === 0 ? { ...page, width: 1079 } : page) },
    { pages: canvaLibraryItemFixture().pages.map((page, index) => index === 7 ? { ...page, pageNumber: 7 } : page) },
    { editUrl: 'https://canva.com.evil.test/design/Dlibrary_first/edit' },
  ])('blocks manual reference selection for unsupported or unavailable metadata: %j', async invalid => {
    library.autofill = false; library.items = [canvaLibraryItemFixture(invalid)];
    await render({ onManualSelect: mocks.manualSelect, manualAvailable: true, manualSelectedDesignId: 'Dlibrary_first' });
    expect(button('직접 편집용으로 선택').disabled).toBe(true);
    await act(async () => button('직접 편집용으로 선택').click());
    expect(mocks.manualSelect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it.each([{ connected: false }, { configured: false }, { enabled: false }, { syncStatus: 'needs_reconnect' as const }])('requires the current library connection for manual reference selection: %j', async unavailable => {
    library = { ...library, ...unavailable, autofill: false };
    await render({ onManualSelect: mocks.manualSelect, manualAvailable: true });
    expect(button('직접 편집용으로 선택').disabled).toBe(true);
    expect(mocks.manualSelect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it('requires explicit manual availability and keeps a disabled editor blocked', async () => {
    await render({ onManualSelect: mocks.manualSelect });
    expect(button('직접 편집용으로 선택').disabled).toBe(true);
    await render({ onManualSelect: mocks.manualSelect, manualAvailable: true, disabled: true });
    expect(button('직접 편집용으로 선택').disabled).toBe(true);
    expect(mocks.manualSelect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it("adds new designs and refreshes an inner page without replacing the selection or page", async () => {
    await render({ selectedDesignId: "Dlibrary_first" }); await click("4");
    const before = host.querySelector(".canva-library-large img")?.getAttribute("src");
    expect(before).toContain("page=3");
    library.items = [canvaLibraryItemFixture({ title: "수정한 표지·내지", updatedAt: 1793837000 }), canvaLibraryItemFixture({ designId: "Dlibrary_new", title: "새로 만든 디자인" })];
    await refresh();
    expect(host.querySelectorAll(".canva-library-card")).toHaveLength(2);
    expect(host.querySelector(".canva-library-large img")?.getAttribute("src")).toContain("page=3&v=1793837000");
    expect(host.querySelector(".canva-library-detail h3")?.textContent).toBe("수정한 표지·내지");
    expect(host.querySelector(".canva-library-selected")?.closest("button")?.getAttribute("aria-label")).toBe("수정한 표지·내지 미리보기");
    expect(mocks.select).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
  it("shows unsupported designs and editable originals without pretending they are ready for copy filling", async () => {
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false, reason: "원고를 넣을 텍스트 필드 연결이 필요합니다." })];
    await render();
    expect(host.querySelectorAll(".canva-library-card")).toHaveLength(1);
    expect(host.querySelector('a[href="https://www.canva.com/design/Dlibrary_first/edit"]')).not.toBeNull();
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true);
    expect(host.textContent).toContain("기존 8장 템플릿을 복제");
    expect(mocks.select).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
  it("distinguishes unavailable account autofill from missing design fields and updates after a capability change", async () => {
    library.autofill = false;
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false, reason: "현재 계정에서 자동 채우기를 사용할 수 없습니다." })];
    await render();
    expect(host.querySelector(".canva-library-item-status")?.textContent).toBe("자동 채우기 제한");
    expect(host.textContent).toContain("현재 연결한 Canva 계정·팀에서 자동 채우기를 사용할 수 없습니다");
    expect(host.querySelector(".canva-library-field-help")).toBeNull();
    expect(host.querySelector(".canva-library-large img")).not.toBeNull();
    expect(host.querySelector('a[href="https://www.canva.com/design/Dlibrary_first/edit"]')).not.toBeNull();
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true);
    library.autofill = true;
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false, reason: "P01_HEADLINE: 텍스트 필드 필요" })];
    await refresh();
    expect(host.querySelector(".canva-library-item-status")?.textContent).toBe("원고 연결 필요");
    expect(host.textContent).toContain("P01_HEADLINE: 텍스트 필드 필요");
    expect(host.querySelector(".canva-library-field-help")).not.toBeNull();
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true);
    expect(mocks.select).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
  it("does not promise template selection while previews load without autofill capability", async () => {
    library.autofill = false;
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false, previewStatus: "pending" })];
    await render();
    expect(host.textContent).toContain("준비가 끝나면 원본의 표지와 내지를 확인할 수 있습니다");
    expect(host.textContent).not.toContain("준비가 끝나면 원고를 채울 템플릿으로 선택");
    expect(host.querySelector(".canva-library-field-help")).toBeNull();
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true); expect(writes()).toHaveLength(0);
  });
  it("offers the exact 46 shared labels by page and copies them without changing a template", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false })]; await render();
    const help = host.querySelector<HTMLDetailsElement>(".canva-library-field-help")!;
    expect(help.open).toBe(false); expect(help.querySelector("summary")?.textContent).toBe("새 디자인에 원고 연결하기");
    await act(async () => help.querySelector("summary")!.click());
    expect(help.open).toBe(true); expect(help.textContent).toContain("대량 만들기(Bulk Create)");
    const pages = [...help.querySelectorAll<HTMLTextAreaElement>("textarea")];
    expect(pages).toHaveLength(8); expect(pages.flatMap(page => page.value.split("\n"))).toEqual([...CANVA_READING_TEXT_FIELDS]);
    expect(pages.every(page => page.readOnly)).toBe(true);
    await click("6페이지 필드 이름 복사");
    expect(writeText).toHaveBeenLastCalledWith(CANVA_READING_TEXT_FIELDS.filter(field => field.startsWith("P06_")).join("\n"));
    await click("전체 46개 필드 이름 복사"); expect(writeText).toHaveBeenLastCalledWith(CANVA_READING_TEXT_FIELDS.join("\n"));
    expect(help.textContent).toContain("전체 46개 필드 이름을 복사했습니다");
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true); expect(writes()).toHaveLength(0); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("keeps field names available for manual copying when clipboard access is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")) } });
    library.items = [canvaLibraryItemFixture({ status: "needs_fields", canCreate: false })]; await render();
    await click("1페이지 필드 이름 복사");
    expect(host.textContent).toContain("필드 이름을 직접 선택해 복사");
    const first = host.querySelector<HTMLTextAreaElement>('[aria-label="1페이지 원고 필드 이름"]')!;
    expect(first.value).toBe(CANVA_READING_TEXT_FIELDS.filter(field => field.startsWith("P01_")).join("\n"));
    expect(writes()).toHaveLength(0);
  });
  it.each(["pending", "stale"] as const)("labels %s previews and waits for the current image before selection", async previewStatus => {
    library.items = [canvaLibraryItemFixture({ previewStatus })]; await render();
    expect(button("이 Canva 템플릿 선택").disabled).toBe(true);
    expect(host.textContent).toContain(previewStatus === "stale" ? "이전 미리보기" : "미리보기 준비 중");
    library.items = [canvaLibraryItemFixture({ updatedAt: 1793837100 })]; await refresh();
    await click("이 Canva 템플릿 선택"); expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ designId: "Dlibrary_first", updatedAt: 1793837100 }));
  });
  it("keeps typed folder settings through background refresh and saves the parsed folder only on submission", async () => {
    await render({ manageFolder: true });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Canva 템플릿 폴더 링크 또는 ID"]')!;
    await setInput(input, "https://www.canva.com/folder/FAnew_folder?tracking=ignored");
    library = { ...library, folderName: "새로 확인한 기존 폴더", lastSyncedAt: "2026-11-05T00:02:00.000Z" }; await refresh();
    expect(input.value).toContain("FAnew_folder?tracking=ignored"); expect(writes()).toHaveLength(0);
    await click("폴더 설정 저장");
    expect(writes()).toEqual([["/canva/template-library", { method: "PUT", body: { folderId: "FAnew_folder", enabled: true } }]]);
    expect(host.querySelector('a[href="https://www.canva.com/folder/FAnew_folder"]')).not.toBeNull();
    expect(host.textContent).toContain("템플릿 폴더를 연결했습니다");
  });
  it("rejects an invalid folder and retains the user's draft without a server write", async () => {
    await render({ manageFolder: true });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Canva 템플릿 폴더 링크 또는 ID"]')!;
    await setInput(input, "https://elsewhere.example/folder/FAnew_folder"); await click("폴더 설정 저장");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Canva 폴더 링크"); expect(input.value).toContain("elsewhere.example"); expect(writes()).toHaveLength(0);
  });
  it.each(["not_configured", "not_connected", "needs_reconnect"] as const)("provides an actionable %s connection state and keeps cached previews read-only", async syncStatus => {
    library = { ...library, configured: syncStatus !== "not_configured", connected: syncStatus === "needs_reconnect", syncStatus };
    await render({ manageFolder: true });
    expect(host.querySelector(`a[href="${syncStatus === "not_configured" ? "/connections?service=canva" : "/api/canva/connect"}"]`)).not.toBeNull();
    if (syncStatus !== "not_configured") expect(host.querySelector('a[href="/api/canva/connect"]')?.getAttribute("target")).toBe("_blank");
    expect(host.querySelector(".canva-library-sync-bar")?.textContent).not.toContain("자동 확인 중");
    expect(button("지금 동기화").disabled).toBe(true); expect(button("이 Canva 템플릿 선택").disabled).toBe(true);
    expect(host.querySelector(".canva-library-large img")).not.toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("shows a configuration problem without offering the same failing OAuth redirect", async () => {
    library = { ...library, configured: false, connected: false, syncStatus: "not_configured", message: "실제 Client ID를 연결 설정에 등록해 주세요." };
    await render();
    expect(host.textContent).toContain("실제 Client ID를 연결 설정에 등록해 주세요.");
    expect(host.querySelector('a[href="/connections?service=canva"]')).not.toBeNull();
    expect(host.querySelector('a[href="/api/canva/connect"]')).toBeNull();
    expect(button("지금 동기화").disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("refreshes the library on demand without starting design creation", async () => {
    await render();
    syncResult = canvaLibraryStateFixture({ items: [canvaLibraryItemFixture(), canvaLibraryItemFixture({ designId: "Dsecond_design", title: "새 내지" })] });
    await click("지금 동기화");
    expect(writes()).toEqual([["/canva/template-library/sync", { method: "POST", body: {} }]]);
    expect(host.querySelectorAll(".canva-library-card")).toHaveLength(2); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("automatically discovers a new design on the two-minute check without selecting it", async () => {
    vi.useFakeTimers(); await render({ selectedDesignId: "Dlibrary_first" });
    library.items.push(canvaLibraryItemFixture({ designId: "Dautomatic_new", title: "자동 추가 디자인" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); }); await settle();
    expect(host.querySelectorAll(".canva-library-card")).toHaveLength(2);
    expect(host.querySelector(".canva-library-selected")?.closest("button")?.getAttribute("aria-label")).toBe("Canva 기본 8장 미리보기");
    expect(writes()).toHaveLength(0); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("keeps polling during the first sync before the connected flag is ready", async () => {
    vi.useFakeTimers(); library = canvaLibraryStateFixture({ connected: false, syncStatus: "syncing" });
    await render(); expect(host.querySelectorAll(".canva-library-card")).toHaveLength(0);
    expect(host.textContent).toContain("Canva 연결과 폴더를 확인하고 있습니다"); expect(host.querySelector('a[href="/api/canva/connect"]')).toBeNull();
    library = canvaLibraryStateFixture({ items: [canvaLibraryItemFixture()] });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); await settle();
    expect(host.querySelectorAll(".canva-library-card")).toHaveLength(1);
    expect(button("이 Canva 템플릿 선택").disabled).toBe(false); expect(writes()).toHaveLength(0);
  });
  it("keeps a removed selected design explicit instead of replacing it with the first new design", async () => {
    library.items = [canvaLibraryItemFixture({ status: "missing", canCreate: false, reason: "연결한 폴더에서 제외되었습니다." }), canvaLibraryItemFixture({ designId: "Dother_design" })];
    await render({ selectedDesignId: "Dlibrary_first" });
    expect(host.textContent).toContain("선택했던 디자인이 연결된 폴더에서 확인되지 않습니다");
    expect(button("선택한 Canva 템플릿").disabled).toBe(true); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("does not load or navigate to arbitrary URLs from a template response", async () => {
    library.items = [canvaLibraryItemFixture({ editUrl: "javascript:alert(1)", thumbnailUrl: "https://external.example/image.png", pages: [{ pageNumber: 1, width: 1080, height: 1350, previewUrl: "https://external.example/image.png" }] })];
    await render();
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull(); expect(host.querySelector('img[src^="https://external.example"]')).toBeNull();
    expect(safeCanvaLink("https://www.canva.com.evil.example/design/Dabc/edit")).toBeNull();
    expect(safeCanvaPreview("/api/canva/template-library/designs/Dabc/../../other")).toBeNull();
  });
});
