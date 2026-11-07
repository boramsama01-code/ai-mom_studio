// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvaManualImport } from "../client/src/CanvaManualImport";
import { CanvaEditorial } from "../client/src/CanvaEditorial";
import { ApiError } from "../client/src/api";
import type { CanvaJobDto } from "../shared/canvaEditorial";
import type { CanvaManualImportRequest } from "../shared/canvaManualImport";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { canvaLibraryItemFixture, canvaLibraryStateFixture } from "./fixtures/canvaTemplateLibrary";

const mocks = vi.hoisted(() => ({ api: vi.fn(), received: vi.fn(), blocking: vi.fn(), local: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/ui", () => ({ GuardedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>, ErrorBox: ({ error }: { error: Error }) => <div role="alert">{error.message}</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Props = ComponentProps<typeof CanvaManualImport>;
let root: Root, host: HTMLDivElement, client: QueryClient, props: Props, jobs: CanvaJobDto[];
let enqueue: ((body: CanvaManualImportRequest) => Promise<unknown>) | null;
let connectionMessage: string | undefined, libraryState: ReturnType<typeof canvaLibraryStateFixture>;
const endpoint = "/channels/3/items/28/canva/manual-imports", jobEndpoint = "/channels/3/items/28/canva/jobs";
function imported(body: CanvaManualImportRequest, status = "queued", override: Partial<CanvaJobDto> = {}): CanvaJobDto {
  const complete = status === "needs_review" || status === "ready";
  return {
    id: 11, requestId: body.requestId, purpose: "import", status, phase: complete ? "complete" : "export_prepare", sourceVersion: body.version, sourceRevisionId: 30,
    designId: body.designId, editUrl: `https://www.canva.com/design/${body.designId}/edit`, exportJobId: complete ? "export_11" : null,
    outputAssetId: complete ? 1100 : null, outputRevisionId: complete ? 31 : null, errorCode: null, errorMessage: null, createdAt: "2026-11-06T00:00:00Z",
    result: { manualImport: { version: 1, kind: "manual_copy", designId: body.designId, principal: "team:qa", designUpdatedAt: 1793920000, pagesHash: "a".repeat(64), capturedAt: "2026-11-06T00:00:00Z" }, ...(complete ? {
      pages: Array.from({ length: 8 }, (_, index) => ({ id: 1100 + index, title: `${index + 1}장`, sha256: "b".repeat(64) })), originals: Array.from({ length: 8 }, (_, index) => ({ id: 1200 + index, page: index + 1, sha256: "c".repeat(64) })),
    } : {}) }, ...override,
  };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); jobs = []; enqueue = null;
  connectionMessage = undefined; libraryState = canvaLibraryStateFixture({ autofill: false });
  props = { channelId: 3, itemId: 28, version: 3, revisionId: 30, disabled: false, busy: false, connected: true, recommended: true, jobs, originalDesignIds: ["Dmaster_test"], onJob: mocks.received, onBlockingChange: mocks.blocking };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["me"], { user: "editor-a", recoveryScope: "scope-a" });
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === endpoint) {
      if (enqueue) return enqueue(options!.body);
      const job = imported(options!.body); jobs = [job]; return structuredClone(job);
    }
    if (path === "/canva/editorial/status") return { configured: true, connected: true, autofill: false, capabilities: [], capabilityStatus: "unavailable", reason: "capability_missing", message: connectionMessage };
    if (path === "/canva/template-library") return libraryState;
    if (path === "/channels/3/canva/masters") return { items: [] };
    if (path === jobEndpoint) return { items: structuredClone(jobs) };
    if (path === `${jobEndpoint}/11/accept`) return { ok: true };
    throw new Error("Unexpected manual import request: " + path);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); sessionStorage.clear(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
async function render(override: Partial<Props> = {}) {
  props = { ...props, ...override };
  await act(async () => root.render(<QueryClientProvider client={client}><CanvaManualImport {...props} /></QueryClientProvider>)); await settle();
}
function button(name: string) { const value = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === name); if (!value) throw new Error("Missing button: " + name); return value; }
async function click(name: string) { expect(button(name).disabled).toBe(false); await act(async () => button(name).click()); await settle(); }
async function input(value: string) {
  const node = host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}
async function confirm() { await act(async () => host.querySelectorAll<HTMLLabelElement>(".canva-manual-confirm").forEach(label => label.click())); await settle(); }
const posts = () => mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");

describe("Canva에서 직접 편집한 8장 가져오기", () => {
  it.each([false, true])('keeps the free manual form before automatic warnings and explicitly opens it without losing input or consent; restored library=%s', async selectedLibrary => {
    connectionMessage = '현재 연결한 Canva 계정·팀에서 자동 채우기를 사용할 수 없습니다. 원본 미리보기와 Canva 직접 편집은 사용할 수 있습니다.';
    const template = canvaLibraryItemFixture({ status: 'needs_fields', canCreate: false, reason: connectionMessage });
    const second = canvaLibraryItemFixture({ designId: 'Dlibrary_second', title: '다른 직접 편집 원본', status: 'needs_fields', canCreate: false });
    libraryState = canvaLibraryStateFixture({ autofill: false, items: [template, second] });
    if (selectedLibrary) sessionStorage.setItem('canva-library-choice:3:28', JSON.stringify({ designId: template.designId }));
    const copy = familyDialogueCardFixture(); copy.templateKey = 'reading-ink-lime-v1';
    const original = structuredClone(copy), otherEditor = document.createElement('input'); document.body.append(otherEditor); otherEditor.focus();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><CanvaEditorial channelId={3} itemId={28} version={3} revisionId={30} copy={copy} disabled={false} onLocalRender={mocks.local} /></QueryClientProvider>)); await settle();
      const manual = host.querySelector<HTMLDetailsElement>('.canva-manual-import')!, automatic = host.querySelector<HTMLDetailsElement>('.canva-automatic-tools')!;
      expect(host.querySelectorAll('.canva-manual-import')).toHaveLength(1);
      expect(manual.open).toBe(true); expect(automatic.open).toBe(false);
      expect(host.querySelector('.canva-library-entry')!.closest('.canva-automatic-tools')).toBeNull();
      expect(manual.compareDocumentPosition(host.querySelector('.canva-library-entry')!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(document.activeElement).toBe(otherEditor);
      expect(host.querySelector('[data-testid="canva-capability-status"]')?.textContent).toContain(connectionMessage);
      if (!selectedLibrary) expect(host.querySelector('[data-testid="reading-canva-readiness"]')?.textContent).toContain('8장·46개 문구·4개 이미지의 연결과 실제 출력을 검증한 뒤 사용할 수 있습니다.');
      expect(button('Canva 8장 만들기').disabled).toBe(true);
      await act(async () => automatic.querySelector('summary')!.click()); await settle();
      await input('Dmanual_copy'); await confirm();
      expect(button('이 사본의 8장 가져오기').disabled).toBe(false);
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="다른 직접 편집 원본 미리보기"]')!.click()); await settle();
      await click('직접 편집용으로 선택');
      expect(host.querySelector('[data-testid="canva-manual-template-selection"]')?.textContent).toContain(second.title);
      expect(host.querySelector('[data-testid="canva-manual-template-selection"] a')?.getAttribute('href')).toBe(second.editUrl);
      expect(sessionStorage.getItem('canva-library-choice:3:28')).toBe(selectedLibrary ? JSON.stringify({ designId: template.designId }) : null);
      expect(host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')!.value).toBe('Dmanual_copy');
      expect([...host.querySelectorAll<HTMLInputElement>('.canva-manual-confirm input')].every(checkbox => checkbox.checked)).toBe(true);
      expect(document.activeElement).toBe(host.querySelector('[aria-label="가져올 Canva 사본 링크 또는 ID"]'));
      expect(posts()).toHaveLength(0); expect(copy).toEqual(original);
      await act(async () => manual.querySelector('summary')!.click()); await settle();
      expect(manual.open).toBe(false);
      await click('직접 편집한 사본 가져오기');
      const field = host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')!;
      expect(manual.open).toBe(true); expect(field.value).toBe('Dmanual_copy'); expect(document.activeElement).toBe(field);
      expect([...host.querySelectorAll<HTMLInputElement>('.canva-manual-confirm input')].every(checkbox => checkbox.checked)).toBe(true);
      expect(posts()).toHaveLength(0); expect(mocks.local).not.toHaveBeenCalled(); expect(copy).toEqual(original);
      await click('이 사본의 8장 가져오기');
      expect(posts()).toHaveLength(1); expect(posts()[0][0]).toBe(endpoint);
    } finally { otherEditor.remove(); }
  });

  it('selects only a reference and never inserts the original design ID into an empty copy field', async () => {
    libraryState = canvaLibraryStateFixture({ autofill: false, items: [canvaLibraryItemFixture({ status: 'needs_fields', canCreate: false })] });
    await act(async () => root.render(<QueryClientProvider client={client}><CanvaEditorial channelId={3} itemId={28} version={3} revisionId={30} copy={familyDialogueCardFixture()} disabled={false} /></QueryClientProvider>)); await settle();
    expect(host.querySelector<HTMLDetailsElement>('.canva-library-entry')!.open).toBe(true);
    await click('직접 편집용으로 선택');
    const field = host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')!;
    expect(field.value).toBe(''); expect(document.activeElement).toBe(field);
    expect(button('이 사본의 8장 가져오기').disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it.each(['unsaved', 'queued', 'unknown'])('does not select a manual template while the editor is blocked: %s', async state => {
    libraryState = canvaLibraryStateFixture({ autofill: false, items: [canvaLibraryItemFixture({ status: 'needs_fields', canCreate: false })] });
    if (state !== 'unsaved') jobs = [imported({ version: 3, requestId: crypto.randomUUID(), designId: 'Dmanual_copy', confirmed: true }, state === 'queued' ? 'queued' : 'result_unknown')];
    await act(async () => root.render(<QueryClientProvider client={client}><CanvaEditorial channelId={3} itemId={28} version={3} revisionId={30} copy={familyDialogueCardFixture()} disabled={state === 'unsaved'} /></QueryClientProvider>)); await settle();
    expect(button('직접 편집용으로 선택').disabled).toBe(true);
    await act(async () => button('직접 편집용으로 선택').click());
    expect(host.querySelector('[data-testid="canva-manual-template-selection"]')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('opens on a capability response without taking focus and only focuses on a new explicit request', async () => {
    const otherEditor = document.createElement('input'); document.body.append(otherEditor); otherEditor.focus();
    try {
      await render({ recommended: false });
      await render({ recommended: true });
      expect(host.querySelector<HTMLDetailsElement>('.canva-manual-import')!.open).toBe(true);
      expect(document.activeElement).toBe(otherEditor);
      await render({ openRequest: 1 });
      expect(document.activeElement).toBe(host.querySelector('[aria-label="가져올 Canva 사본 링크 또는 ID"]'));
      otherEditor.focus(); await render({ disabled: true });
      expect(document.activeElement).toBe(otherEditor);
      expect(posts()).toHaveLength(0);
    } finally { otherEditor.remove(); }
  });

  it.each([{ disabled: true }, { busy: true }, { connected: false }])('an explicit open request never bypasses the original import blockers: %j', async blocked => {
    await render(); await input('Dmanual_copy'); await confirm();
    expect(button('이 사본의 8장 가져오기').disabled).toBe(false);
    await render({ ...blocked, openRequest: 1 });
    expect(button('이 사본의 8장 가져오기').disabled).toBe(true);
    await act(async () => button('이 사본의 8장 가져오기').click());
    expect(posts()).toHaveLength(0); expect(mocks.received).not.toHaveBeenCalled();
  });

  it("안전한 사본 링크와 두 확인을 요구하고 자동 채우기 없이 디자인 ID만 전송한다", async () => {
    await render(); await input("https://www.canva.com.evil.test/design/Dwrong_copy/edit");
    expect(button("이 사본의 8장 가져오기").disabled).toBe(true); expect(posts()).toHaveLength(0);
    await input("Dmaster_test"); expect(host.textContent).toContain("등록된 원본 템플릿"); expect(button("이 사본의 8장 가져오기").disabled).toBe(true);
    await input("https://www.canva.com/design/Dmanual_copy/edit?share=discarded#page-2");
    expect(button("이 사본의 8장 가져오기").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLLabelElement>(".canva-manual-confirm")!.click()); await settle();
    expect(button("이 사본의 8장 가져오기").disabled).toBe(true);
    await act(async () => host.querySelectorAll<HTMLLabelElement>(".canva-manual-confirm")[1].click()); await settle();
    await click("이 사본의 8장 가져오기");
    expect(posts()).toHaveLength(1); expect(posts()[0]).toEqual([endpoint, { method: "POST", body: { version: 3, requestId: expect.any(String), designId: "Dmanual_copy", confirmed: true } }]);
    expect(mocks.received).toHaveBeenCalledWith(expect.objectContaining({ purpose: "import", phase: "export_prepare", designId: "Dmanual_copy" }));
  });

  it("응답 유실 후 원고 버전·연결 상태가 바뀌어도 같은 이전 요청을 다시 확인한다", async () => {
    enqueue = async () => { throw new ApiError(0, "응답 유실", { resultUnknown: true }); };
    await render(); await input("Dmanual_copy"); await confirm(); await click("이 사본의 8장 가져오기");
    const original = structuredClone(posts()[0][1].body);
    await act(async () => root.render(null)); enqueue = null;
    await render({ version: 4, revisionId: 31, disabled: true, connected: false, busy: true });
    expect(host.textContent).toContain("저장본 v3"); expect(button("수동 가져오기 요청 결과 확인").disabled).toBe(false);
    await click("수동 가져오기 요청 결과 확인");
    expect(posts()[1][1].body).toEqual(original); expect(mocks.received).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("응답을 아직 확인하지 못했습니다");
  });

  it.each([
    ["다른 사본", { designId: "Dother_copy" }],
    ["다른 요청 번호", { requestId: "91bd8c83-b816-48ba-9c2f-b63c078f9256" }],
    ["다른 원고 버전", { sourceVersion: 4 }],
    ["다른 원고 기록", { sourceRevisionId: 31 }],
    ["자동 생성 작업", { purpose: "create" }],
  ] as const)("%s의 응답을 성공으로 적용하지 않고 같은 요청을 유지한다", async (_label, response) => {
    enqueue = async body => imported(body, "queued", response);
    await render(); await input("Dmanual_copy"); await confirm(); await click("이 사본의 8장 가져오기");
    expect(mocks.received).not.toHaveBeenCalled(); expect(host.textContent).toContain("응답이 다릅니다");
    expect(button("수동 가져오기 요청 결과 확인").disabled).toBe(false);
  });

  it("서버 목록에서 기존 요청 기록을 찾으면 다시 전송하지 않고 저장된 작업으로 이어간다", async () => {
    enqueue = async () => { throw new ApiError(0, "응답 유실"); };
    await render(); await input("Dmanual_copy"); await confirm(); await click("이 사본의 8장 가져오기");
    const receipt = imported(posts()[0][1].body);
    await render({ jobs: [receipt] });
    expect(posts()).toHaveLength(1); expect(mocks.received).toHaveBeenCalledWith(receipt);
    expect(host.textContent).not.toContain("응답을 아직 확인하지 못했습니다");
  });

  it("확정된 거절은 자동 재시도하지 않고 입력을 보존하며 다음 명시적 요청은 새 UUID를 쓴다", async () => {
    enqueue = async () => { throw new ApiError(404, "사본 접근 권한을 확인해 주세요."); };
    await render(); await input("Dmanual_copy"); await confirm(); await click("이 사본의 8장 가져오기");
    expect(posts()).toHaveLength(1); expect(host.textContent).toContain("사본 접근 권한"); expect(button("이 사본의 8장 가져오기").disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')?.value).toBe("Dmanual_copy");
    enqueue = null; await confirm(); await click("이 사본의 8장 가져오기");
    expect(posts()[1][1].body.requestId).not.toBe(posts()[0][1].body.requestId);
  });

  it("원고 버전이 바뀌면 확인을 다시 요구하고 사본 입력은 보존한다", async () => {
    await render(); await input("Dmanual_copy"); await confirm();
    await render({ version: 4, revisionId: 31 });
    expect(button("이 사본의 8장 가져오기").disabled).toBe(true); expect(host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')?.value).toBe("Dmanual_copy"); expect(posts()).toHaveLength(0);
    await confirm(); await render({ disabled: true }); expect(button("이 사본의 8장 가져오기").disabled).toBe(true);
  });

  it("이중 클릭으로 새 요청을 늘리지 않는다", async () => {
    let release!: (value: unknown) => void;
    enqueue = () => new Promise(resolve => { release = resolve; });
    await render(); await input("Dmanual_copy"); await confirm();
    await act(async () => { button("이 사본의 8장 가져오기").click(); button("이 사본의 8장 가져오기").click(); }); await settle();
    expect(posts()).toHaveLength(1);
    await act(async () => release(imported(posts()[0][1].body))); await settle(); expect(mocks.received).toHaveBeenCalledOnce();
  });

  it("이전 사용자의 늦은 응답을 새 사용자의 작업으로 표시하지 않는다", async () => {
    let release!: (value: unknown) => void;
    enqueue = () => new Promise(resolve => { release = resolve; });
    await render(); await input("Dmanual_copy"); await confirm(); await act(async () => button("이 사본의 8장 가져오기").click()); await settle();
    const original = structuredClone(posts()[0][1].body);
    client.setQueryData(["me"], { user: "editor-b", recoveryScope: "scope-b" }); await render();
    await act(async () => release(imported(original))); await settle();
    expect(mocks.received).not.toHaveBeenCalled(); expect(host.querySelector<HTMLInputElement>('[aria-label="가져올 Canva 사본 링크 또는 ID"]')?.value).toBe("");
    client.setQueryData(["me"], { user: "editor-a", recoveryScope: "scope-a" }); await render();
    expect(host.textContent).toContain("저장본 v3"); expect(button("수동 가져오기 요청 결과 확인").disabled).toBe(false);
  });

  it("자동 채우기 없는 편집기에서 진행 상태와 8장 확인·새 버전 저장으로 이어지며 기존 원고는 직접 바꾸지 않는다", async () => {
    const copy = familyDialogueCardFixture(), original = structuredClone(copy);
    await act(async () => root.render(<QueryClientProvider client={client}><CanvaEditorial channelId={3} itemId={28} version={3} revisionId={30} copy={copy} disabled={false} onLocalRender={mocks.local} /></QueryClientProvider>)); await settle();
    expect(button("Canva 8장 만들기").disabled).toBe(true);
    await input("Dmanual_copy"); await confirm(); await click("이 사본의 8장 가져오기");
    expect(host.textContent).toContain("완성된 디자인 확인 중"); expect(copy).toEqual(original); expect(mocks.local).not.toHaveBeenCalled();
    jobs = [imported(posts()[0][1].body, "needs_review")];
    await act(async () => { await client.invalidateQueries({ queryKey: ["canva-jobs", 3, 28] }); }); await settle();
    expect(host.textContent).toContain("직접 편집한 Canva 사본"); expect(button("확인한 8장을 새 버전으로 저장").disabled).toBe(true);
    await act(async () => host.querySelectorAll(".canva-export-grid img").forEach(image => image.dispatchEvent(new Event("load")))); await settle();
    const review = [...host.querySelectorAll<HTMLLabelElement>("label")].find(label => label.textContent?.includes("8장의 모든 문구가 현재 스튜디오 원고와 같은지 확인했습니다"))!;
    await act(async () => review.click()); await settle();
    await click("확인한 8장을 새 버전으로 저장");
    expect(posts().at(-1)).toEqual([`${jobEndpoint}/11/accept`, { method: "POST", body: { version: 3, textConfirmedUnchanged: true } }]);
    expect(copy).toEqual(original); expect(posts().every(([path]) => path === endpoint || path === `${jobEndpoint}/11/accept`)).toBe(true);
  });
});
