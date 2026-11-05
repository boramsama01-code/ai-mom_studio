// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvaEditorial, CanvaMasterSettings } from "../client/src/CanvaEditorial";
import { ApiError } from "../client/src/api";
import type { CanvaJobDto, CanvaMasterDto } from "../shared/canvaEditorial";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { READING_CARD_PROFILES, READING_PROFILE_LOGO_ID } from "../shared/readingCardProfiles";
import { defaultPageDesigns } from "../shared/familyDialogue";
import { FAMILY_ENDING_ASSET_IDS, FAMILY_PROFILE_ASSET_ID } from "../shared/characterVariantAssets";
import type { CanvaTemplateLibraryState } from "../shared/canvaTemplateLibrary";
import { CANVA_LIBRARY_QUERY_KEY } from "../client/src/CanvaTemplateLibrary";
import { canvaLibraryItemFixture, canvaLibraryStateFixture } from "./fixtures/canvaTemplateLibrary";
const mocks = vi.hoisted(() => ({ api: vi.fn(), local: vi.fn(), sourceApproved:vi.fn() }));
vi.mock("../shared/readingCanvaMasters", () => ({ readingMasterSourceApproved:mocks.sourceApproved }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/ui", () => ({
  GuardedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  ErrorBox: ({ error, retry }: { error: Error; retry?: () => void }) => <div role="alert">{error.message}{retry && <button onClick={retry}>다시 시도</button>}</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const base = "/channels/3/items/28/canva/jobs", storageKey = "canva-request:3:28";
const uuid = (index: number): ReturnType<Crypto["randomUUID"]> => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
type Props = ComponentProps<typeof CanvaEditorial>;
let root: Root, host: HTMLDivElement, client: QueryClient, props: Props;
let jobs: CanvaJobDto[], masters: CanvaMasterDto[], connection: import('../shared/canvaCapabilities').CanvaConnectionStatus;
let library: CanvaTemplateLibraryState;
let enqueue: ((body: any) => Promise<unknown>) | null, action: ((path: string, body: any) => Promise<unknown>) | null, listJobs: (() => Promise<unknown>) | null;
function job(id = 11, status: CanvaJobDto["status"] = "queued", override: Partial<CanvaJobDto> = {}): CanvaJobDto {
  const completed = ["ready", "needs_review", "superseded"].includes(status);
  return { id, requestId: uuid(id), purpose: status === "needs_review" ? "import" : "create", status, phase: completed ? "complete" : "validate", sourceRevisionId: 30, sourceVersion: 3, designId: completed ? `design_${id}` : null, editUrl: completed ? `https://www.canva.com/design/design_${id}/edit` : null, exportJobId: completed ? `export_${id}` : null, outputAssetId: completed ? id * 100 : null, outputRevisionId: completed ? 31 : null, errorCode: null, errorMessage: null, createdAt: "2026-11-04T00:00:00.000Z", result: completed ? { pages: Array.from({ length: 8 }, (_, index) => ({ id: id * 100 + index, title: `${index + 1}장 카드`, sha256: String(index).repeat(64) })), originals: Array.from({ length: 8 }, (_, index) => ({ id: id * 100 + 20 + index, page: index + 1, sha256: String(index).repeat(64) })) } : null, ...override };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); let sequence = 100;
  mocks.sourceApproved.mockImplementation((_profile:unknown,sourceId:string)=>sourceId==="Dmaster_test");
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => uuid(++sequence));
  jobs = []; enqueue = null; action = null; listJobs = null;
  masters = [{ id: 7, conceptMode: "value_definition", hasExternalActivity: false, templateVersion: "v1.1", sourceType: "design", sourceId: "Dmaster_test", status: "ready", editUrl: "https://www.canva.com/design/Dmaster_test/edit", validatedAt: "2026-11-04T00:00:00.000Z" }];
  connection = { configured: true, connected: true, autofill: true, capabilities: ["autofill"] };
  library = canvaLibraryStateFixture();
  props = { channelId: 3, itemId: 28, version: 3, revisionId: 30, copy: familyDialogueCardFixture(), disabled: false, onLocalRender: mocks.local };
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/canva/editorial/status") return structuredClone(connection);
    if (path === "/canva/template-library") return structuredClone(library);
    if (path === "/channels/3/canva/masters") return { items: structuredClone(masters) };
    if (path === base && options?.method === "POST") {
      if (enqueue) return enqueue(options.body);
      const created = job(12, "queued", { requestId: options.body.requestId, sourceVersion: options.body.version, sourceRevisionId: props.revisionId, purpose: options.body.importFromJobId ? "import" : "create" });
      jobs = [created, ...jobs]; return structuredClone(created);
    }
    if (path === base) return listJobs ? listJobs() : { items: structuredClone(jobs) };
    if (path.startsWith(`${base}/`) && options?.method === "POST") {
      if (action) return action(path, options.body);
      const id = Number(path.split("/").at(-2)), current = jobs.find(value => value.id === id)!;
      if (path.endsWith("/accept")) { jobs = jobs.map(value => value.id === id ? { ...value, status: "ready" } : value); return { ok: true }; }
      const updated = { ...current, status: path.endsWith("/cancel") ? "cancelled" : "queued", ...(options.body.action === "reexport" ? { phase: "export_prepare", exportJobId: null, errorCode: null, errorMessage: null } : {}) };
      jobs = jobs.map(value => value.id === id ? updated : value); return structuredClone(updated);
    }
    throw new Error(`Unexpected test request: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function settle() { for (let index = 0; index < 2; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(override: Partial<Props> = {}) { props = { ...props, ...override }; await act(async () => root.render(<QueryClientProvider client={client}><CanvaEditorial key={`${props.channelId}:${props.itemId}`} {...props} /></QueryClientProvider>)); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll("button")].find(value => value.textContent === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
async function loadImages(count = 8) { await act(async () => { [...host.querySelectorAll(".canva-export-grid img")].slice(0, count).forEach(image => image.dispatchEvent(new Event("load"))); }); await settle(); }
function confirmation() { return host.querySelector<HTMLInputElement>('.canva-editorial input[type="checkbox"]')!; }
async function recoveryDesign(value: string) { const node = host.querySelector<HTMLInputElement>('[aria-label="복구할 Canva 디자인 링크 또는 ID"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); await settle(); }
function reconciled(source: CanvaJobDto, body: any, status: string = 'needs_review'): CanvaJobDto {
  const record = { version: 1, recoveryToken: body.expectedRecoveryToken, designId: body.designId, sourceRevisionId: props.revisionId, sourceVersion: body.version, sourceInputHash: 'b'.repeat(64), requestTitleMatched: false, datasetCheck: 'unavailable', original: { sourceRevisionId: source.sourceRevisionId, sourceVersion: source.sourceVersion, purpose: source.purpose, requestId: source.requestId, requestHash: 'c'.repeat(64), inputHash: 'd'.repeat(64) }, reconciledAt: '2026-11-04T01:00:00.000Z' };
  const result = job(source.id, status, { requestId: source.requestId, purpose: 'import', sourceRevisionId: props.revisionId, sourceVersion: body.version, designId: body.designId, recoveryToken: null });
  result.result = { ...result.result, reconciled: true, reconciliation: record, reconciliationHistory: [] }; return result;
}

describe("Canva editorial request and import UI", () => {
  it("creates from a synchronized folder design while preserving the local authoring template and saved copy", async () => {
    masters = []; library.items = [canvaLibraryItemFixture()];
    const savedCopy = structuredClone(props.copy);
    await render(); expect(button("Canva 8장 만들기").disabled).toBe(true);
    await click("이 Canva 템플릿 선택"); expect(button("Canva 8장 만들기").disabled).toBe(false);
    expect(host.textContent).toContain("Canva의 배치·이미지와 기본 사진 출처를 유지");
    await click("Canva 8장 만들기");
    expect(writes()[0][1].body).toEqual({ version: 3, requestId: expect.any(String), libraryDesignId: "Dlibrary_first", expectedLibraryUpdatedAt: 1793836800 });
    expect(writes()[0][1].body).not.toHaveProperty("masterId"); expect(props.copy).toEqual(savedCopy); expect(mocks.local).not.toHaveBeenCalled();
  });
  it("blocks native creation while the selected design's changed preview is pending and uses the refreshed version after it is ready", async () => {
    library.items = [canvaLibraryItemFixture()]; await render(); await click("이 Canva 템플릿 선택");
    library.items = [canvaLibraryItemFixture({ updatedAt: 1793837000, previewStatus: "stale" }), canvaLibraryItemFixture({ designId: "Dother_design" })];
    await act(async () => { await client.invalidateQueries({ queryKey: CANVA_LIBRARY_QUERY_KEY }); }); await settle();
    expect(button("Canva 8장 만들기").disabled).toBe(true); expect(host.textContent).toContain("이전 미리보기");
    expect(host.querySelector('[data-testid="canva-library-selection"]')?.textContent).toContain("Canva 기본 8장");
    library.items[0] = canvaLibraryItemFixture({ updatedAt: 1793837000 });
    await act(async () => { await client.invalidateQueries({ queryKey: CANVA_LIBRARY_QUERY_KEY }); }); await settle();
    await click("Canva 8장 만들기"); expect(writes()[0][1].body).toMatchObject({ libraryDesignId: "Dlibrary_first", expectedLibraryUpdatedAt: 1793837000 });
  });
  it("preserves the chosen native source across remounts and replays a lost response using its original source version", async () => {
    library.items = [canvaLibraryItemFixture()]; enqueue = async () => { throw new ApiError(0, "서버 응답을 받지 못했습니다."); };
    await render(); await click("이 Canva 템플릿 선택"); await click("Canva 8장 만들기");
    const original = structuredClone(writes()[0][1].body);
    await act(async () => root.render(null)); client.clear();
    library.items = [canvaLibraryItemFixture({ updatedAt: 1793837200 })]; enqueue = null;
    await render({ version: 4, revisionId: 31 });
    expect(host.querySelector('[data-testid="canva-library-selection"]')).not.toBeNull();
    await click("요청 결과 확인");
    expect(writes()[1][1].body).toEqual(original); expect(original.version).toBe(3); expect(original.expectedLibraryUpdatedAt).toBe(1793836800);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("restores the native source from a saved job and respects explicitly returning to registered masters", async () => {
    library.items = [canvaLibraryItemFixture()]; const saved = job(61, "ready"); saved.result = { ...saved.result, libraryDesignId: "Dlibrary_first", librarySourceUpdatedAt: 1793836800 }; jobs = [saved];
    await render(); expect(host.querySelector('[data-testid="canva-library-selection"]')).not.toBeNull();
    await click("등록된 마스터로 돌아가기"); expect(host.querySelector('[data-testid="canva-library-selection"]')).toBeNull();
    await act(async () => root.render(null)); client.clear(); await render();
    expect(host.querySelector('[data-testid="canva-library-selection"]')).toBeNull();
    expect(host.querySelector('[aria-label="Canva 템플릿 선택"]')).not.toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("keeps the missing native selection and disables creation instead of silently using a registered master", async () => {
    sessionStorage.setItem("canva-library-choice:3:28", JSON.stringify({ designId: "Dlibrary_missing" }));
    library.items = [canvaLibraryItemFixture()]; await render();
    expect(host.querySelector('[data-testid="canva-library-selection"]')).not.toBeNull(); expect(button("Canva 8장 만들기").disabled).toBe(true);
    expect(host.textContent).toContain("선택했던 디자인이 연결된 폴더에서 확인되지 않습니다"); expect(writes()).toHaveLength(0);
  });
  it("keeps generated folder snapshots out of the registered-master selector", async () => {
    masters = [{ ...masters[0], id: 62, templateVersion: "canva-folder:a1b2c3", sourceId: "Dlibrary_first" }];
    await render();
    expect(button("Canva 8장 만들기").disabled).toBe(true);
    expect(host.querySelector('select[aria-label="Canva 템플릿 선택"] option[value="62"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("shows the native source-change check and allows importing its retained copy after a change is detected", async () => {
    jobs = [job(63, "running", { phase: "folder_source_check", designId: "Dretained_copy", editUrl: "https://www.canva.com/design/Dretained_copy/edit" })];
    await render(); expect(host.textContent).toContain("Canva 원본 변경 확인 중");
    jobs = [{ ...jobs[0], status: "failed", errorCode: "library_source_changed", errorMessage: "제작 중 Canva 원본이 바뀌었습니다. 생성된 사본을 검토해 주세요." }];
    await act(async () => { await client.invalidateQueries({ queryKey: ["canva-jobs", 3, 28] }); }); await settle();
    expect(host.querySelector('a[href="https://www.canva.com/design/Dretained_copy/edit"]')).not.toBeNull();
    await click("최신 디자인 가져오기"); expect(writes()[0][1].body).toMatchObject({ importFromJobId: 63, version: 3 });
    expect(writes()[0][1].body).not.toHaveProperty("libraryDesignId"); expect(writes()[0][1].body).not.toHaveProperty("masterId");
  });
  it("shows all 14 saved source links and sample previews without enabling Autofill bindings", async()=>{
    await act(async()=>root.render(<QueryClientProvider client={client}><CanvaMasterSettings channelId={3}/></QueryClientProvider>));await settle();
    expect(host.querySelectorAll('.canva-style-card')).toHaveLength(14);
    expect(host.querySelectorAll('.canva-style-card img')).toHaveLength(14);
    expect(host.querySelectorAll('a[href^="https://www.canva.com/d/"]')).toHaveLength(14);
    expect(host.textContent).toContain('Canva 자동 출력 검증 대기');expect(writes()).toHaveLength(0);
  });
  it("keeps unknown capability distinct from a confirmed missing entitlement and only performs a read on retry",async()=>{
    connection={...connection,autofill:false,capabilityStatus:'unknown',reason:'provider_unavailable',message:'Canva 응답을 확인하지 못했습니다.'};await render();
    expect(host.querySelector('[data-testid="canva-capability-status"]')?.textContent).toContain('아직 확인하지 못했습니다');
    expect(button('Canva 8장 만들기').disabled).toBe(true);
    connection={...connection,capabilityStatus:'unavailable',reason:'capability_missing',message:'연결한 계정·팀의 기능 이용 권한을 확인해 주세요.'};
    await click('권한 다시 확인');
    expect(host.querySelector('[data-testid="canva-capability-status"]')?.textContent).toContain('사용할 수 없습니다');expect(writes()).toHaveLength(0);
  });
  it("shows the selected style's exact image field count and blocks an unverified 14-style source",async()=>{
    props.copy.templateKey='cardnews14-cinematic-v1';await render();
    expect(host.querySelector('[data-testid="reading-canva-readiness"]')?.textContent).toContain('8개 이미지');
    expect(host.querySelector('[aria-label="스튜디오 8장 디자인"]')).not.toBeNull();
    expect(button('Canva 8장 만들기').disabled).toBe(true);expect(writes()).toHaveLength(0);
    await click('스튜디오에서 8장 만들기');expect(mocks.local).toHaveBeenCalledOnce();expect(writes()).toHaveLength(0);
    await render({disabled:true});expect(button('스튜디오에서 8장 만들기').disabled).toBe(true);
  });

  it("keeps a new reading profile previewable but blocks Canva creation until a matching master is registered", async () => {
    props.copy.templateKey=READING_CARD_PROFILES[0].templateKey;
    const outro=props.copy.pages.find(page=>page.id==='outro')!;outro.fields.logoAssetId=READING_PROFILE_LOGO_ID;
    await render();
    expect(host.querySelector('[data-testid="reading-canva-readiness"]')?.textContent).toContain("실제 출력을 검증한 뒤");
    expect(button("Canva 8장 만들기").disabled).toBe(true);expect(writes()).toHaveLength(0);
    masters=[{...masters[0],id:8,templateVersion:READING_CARD_PROFILES[1].templateVersion}];
    await act(async()=>{await client.invalidateQueries({queryKey:['canva-masters',3]});});await settle();
    expect(button("Canva 8장 만들기").disabled).toBe(true);
    masters=[{...masters[0],id:9,sourceId:"Dwrong_style_source",conceptMode:"scientific_explanation",hasExternalActivity:true,templateVersion:READING_CARD_PROFILES[0].templateVersion}];
    await act(async()=>{await client.invalidateQueries({queryKey:['canva-masters',3]});});await settle();
    expect(button("Canva 8장 만들기").disabled).toBe(true);
    masters=[{...masters[0],sourceId:"Dmaster_test"}];
    await act(async()=>{await client.invalidateQueries({queryKey:['canva-masters',3]});});await settle();
    expect(button("Canva 8장 만들기").disabled).toBe(false);
    await click("Canva 8장 만들기");expect(writes()[0][1].body.masterId).toBe(9);
  });
  it("offers local eight-page output for a complete ending even when a Canva master is ready",async()=>{
    const designs=defaultPageDesigns();designs.outro.outroPresentation={mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]};
    await render({pageDesigns:designs});
    expect(host.querySelector('[data-testid="canva-outro-support"]')?.textContent).toContain('전체 이미지 엔딩');
    expect(button('Canva 8장 만들기').disabled).toBe(true);
    await click('스튜디오에서 8장 만들기');expect(mocks.local).toHaveBeenCalledTimes(1);expect(writes()).toHaveLength(0);
    await render({pageDesigns:defaultPageDesigns()});expect(button('Canva 8장 만들기').disabled).toBe(false);
  });
  it("does not send a selected family profile to a Canva master with a different pinned profile",async()=>{
    const outro=props.copy.pages.find(page=>page.id==='outro')!;outro.fields.logoAssetId=FAMILY_PROFILE_ASSET_ID;
    await render();expect(button('Canva 8장 만들기').disabled).toBe(true);
    expect(host.querySelector('[data-testid="canva-outro-support"]')?.textContent).toContain('선택한 프로필');
    await click('스튜디오에서 8장 만들기');expect(mocks.local).toHaveBeenCalledTimes(1);expect(writes()).toHaveLength(0);
  });
  it("can import an existing design after its original master is no longer ready", async () => {
    masters = []; connection.autofill = false; connection.capabilities = [];
    jobs = [job(25, "ready")];
    await render();
    expect(button("Canva 8장 만들기").disabled).toBe(true);
    await click("최신 디자인 가져오기");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].body).toMatchObject({ version: 3, importFromJobId: 25 });
    expect(writes()[0][1].body).not.toHaveProperty("masterId");
  });
  it("recovers a lost response by the same UUID and original version after remounting", async () => {
    enqueue = async () => { throw new ApiError(0, "서버 응답을 받지 못했습니다."); };
    await render(); await click("Canva 8장 만들기");
    const original = structuredClone(writes()[0][1].body);
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original); expect(button("Canva 8장 만들기").disabled).toBe(true);
    await act(async () => root.render(null)); client.clear();
    enqueue = async body => { const result = job(15, "queued", { requestId: body.requestId, sourceVersion: body.version }); jobs = [result]; return result; };
    await render({ version: 4, revisionId: 31 }); await click("요청 결과 확인");
    expect(writes()[1][1].body).toEqual(original); expect(original.version).toBe(3); expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(host.textContent).toContain("템플릿 확인 중");
  });
  it.each([400, 409])("clears a definitive HTTP %i rejection so a corrected request gets a fresh UUID", async status => {
    enqueue = async () => { throw new ApiError(status, "저장본을 다시 확인해 주세요."); };
    await render(); await click("Canva 8장 만들기"); const first = writes()[0][1].body;
    expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(button("Canva 8장 만들기").disabled).toBe(false);
    enqueue = null; await click("Canva 8장 만들기"); expect(writes()[1][1].body.requestId).not.toBe(first.requestId);
  });
  it.each(["empty", "wrong_version", "wrong_purpose"])("retains a request after a malformed 200 %s response", async response => {
    enqueue = async body => response === "empty" ? {} : job(17, "queued", { requestId: body.requestId, sourceVersion: response === "wrong_version" ? 99 : body.version, purpose: response === "wrong_purpose" ? "import" : "create" });
    await render(); await click("Canva 8장 만들기"); const original = structuredClone(writes()[0][1].body);
    expect(sessionStorage.getItem(storageKey)).not.toBeNull(); expect(button("Canva 8장 만들기").disabled).toBe(true); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    enqueue = null; await click("요청 결과 확인"); expect(writes()[1][1].body).toEqual(original);
  });
  it("allows only one enqueue while the response is pending", async () => {
    let finish!: (value: unknown) => void;
    enqueue = () => new Promise(resolve => { finish = resolve; });
    await render(); await act(async () => { button("Canva 8장 만들기").click(); button("Canva 8장 만들기").click(); }); await settle();
    expect(writes()).toHaveLength(1); const body = writes()[0][1].body, accepted = job(19, "queued", { requestId: body.requestId });
    await act(async () => { jobs = [accepted]; finish(accepted); }); await settle();
    expect(writes()).toHaveLength(1); expect(host.textContent).toContain("템플릿 확인 중");
  });
  it("blocks new create/import/re-export and local rendering while the editor is dirty", async () => {
    jobs = [job(20, "failed", { designId: "design_20", exportJobId: "export_old", phase: "export_polling", errorCode: "export_expired", errorMessage: "출력 파일이 만료되었습니다." })];
    await render({ disabled: true });
    for (const label of ["Canva 8장 만들기", "최신 디자인 가져오기", "같은 디자인의 8장 다시 내보내기", "자체 이미지로 만들기"]) { expect(button(label).disabled).toBe(true); await act(async () => button(label).click()); }
    expect(host.textContent).toContain("미저장 변경"); expect(writes()).toHaveLength(0); expect(mocks.local).not.toHaveBeenCalled();
  });
  it("blocks generation for an older unknown job and exposes recovery of that exact job", async () => {
    jobs = [job(22, "failed"), job(21, "result_unknown", { errorCode: "result_unknown", errorMessage: "응답을 확인해야 합니다." })];
    action = async () => jobs[1];
    await render(); expect(button("Canva 8장 만들기").disabled).toBe(true); expect(host.textContent).toContain("이전 Canva 요청의 결과");
    await click("이전 작업 결과 확인"); expect(writes()[0]).toEqual([`${base}/21/resume`, { method: "POST", body: {} }]);
    expect(writes().some(([path]) => path === base)).toBe(false);
  });
  it("re-exports only through the explicit action and expected external job ID", async () => {
    jobs = [job(23, "failed", { designId: "design_23", exportJobId: "expired_23", phase: "export_polling", errorCode: "export_expired", errorMessage: "출력 파일이 만료되었습니다." })];
    await render(); await click("같은 디자인의 8장 다시 내보내기");
    expect(writes()).toEqual([[`${base}/23/resume`, { method: "POST", body: { action: "reexport", expectedExportJobId: "expired_23" } }]]);
  });
  it("imports the existing design, waits for all eight JPEGs, and requires explicit text confirmation", async () => {
    jobs = [job(24, "ready")];
    await render({ version: 4, revisionId: 31 });
    enqueue = async body => { const imported = job(25, "needs_review", { sourceVersion: body.version, sourceRevisionId: 31, outputRevisionId: 32, requestId: body.requestId }); jobs = [imported, ...jobs]; return imported; };
    await click("최신 디자인 가져오기"); expect(writes()[0][1].body).toMatchObject({ version: 4, importFromJobId: 24 });
    expect(host.querySelectorAll(".canva-export-grid img")).toHaveLength(8); expect(confirmation().disabled).toBe(true); expect(button("확인한 8장을 새 버전으로 저장").disabled).toBe(true);
    await loadImages(7); expect(confirmation().disabled).toBe(true); await loadImages(8);
    expect(confirmation().disabled).toBe(false); expect(button("확인한 8장을 새 버전으로 저장").disabled).toBe(true);
    await act(async () => confirmation().click()); await click("확인한 8장을 새 버전으로 저장");
    expect(writes()[1]).toEqual([`${base}/25/accept`, { method: "POST", body: { version: 4, textConfirmedUnchanged: true } }]);
    expect(host.querySelectorAll('a[href$="?download=1"]')).toHaveLength(8);
  });
  it("keeps the import gate closed after an image failure and reloads only stored media", async () => {
    jobs = [job(26, "needs_review")]; await render(); await loadImages(7);
    await act(async () => host.querySelectorAll(".canva-export-grid img")[7].dispatchEvent(new Event("error"))); await settle();
    expect(confirmation().disabled).toBe(true); expect(host.textContent).toContain("1장의 이미지를 불러오지 못했습니다");
    await click("이미지 다시 불러오기"); expect(host.textContent).toContain("이미지 0 / 8장"); expect(host.querySelector(".canva-export-grid img")?.getAttribute("src")).toContain("previewRetry=1");
    await loadImages(); expect(confirmation().disabled).toBe(false); expect(writes()).toHaveLength(0);
  });
  it("invalidates import confirmation if the saved source revision changes", async () => {
    jobs = [job(27, "needs_review")]; await render(); await loadImages(); await act(async () => confirmation().click());
    expect(button("확인한 8장을 새 버전으로 저장").disabled).toBe(false);
    await render({ version: 4, revisionId: 31 });
    expect(confirmation().checked).toBe(false); expect(confirmation().disabled).toBe(true); expect(button("확인한 8장을 새 버전으로 저장").disabled).toBe(true); expect(host.textContent).toContain("가져온 뒤 원고 버전이 바뀌었습니다");
  });
  it("does not treat an empty 200 accept response as a confirmed import", async () => {
    jobs = [job(28, "needs_review")]; action = async () => ({});
    await render(); await loadImages(); await act(async () => confirmation().click()); await click("확인한 8장을 새 버전으로 저장");
    expect(host.textContent).toContain("Canva 응답을 확인할 수 없습니다"); expect(host.textContent).toContain("Canva에서 바꾼 문구를 대조");
  });
  it("shows connection and missing-master guidance without starting work", async () => {
    connection = { configured: false, connected: false, autofill: false, capabilities: [] }; masters = [];
    await render(); expect(button("Canva 8장 만들기").disabled).toBe(true);
    expect(host.querySelector('a[href="/connections?service=canva"]')).not.toBeNull(); expect(host.querySelector('a[href="/design"]')).not.toBeNull(); expect(host.textContent).toContain("이 원고 구조에 맞는 템플릿 등록 필요"); expect(writes()).toHaveLength(0);
  });
  it("fails closed on malformed job lists and incomplete completed outputs", async () => {
    listJobs = async () => ({}); await render(); expect(button("Canva 8장 만들기").disabled).toBe(true); expect(host.textContent).toContain("Canva 응답을 확인할 수 없습니다");
    const partial = job(29, "needs_review"); (partial.result!.pages as unknown[]).pop(); listJobs = async () => ({ items: [partial] });
    await act(async () => client.invalidateQueries({ queryKey: ["canva-jobs", 3, 28] })); await settle();
    expect(host.querySelector(".canva-export-grid")).toBeNull(); expect(button("Canva 8장 만들기").disabled).toBe(true); expect(writes()).toHaveLength(0);
  });
  it("recovers a persisted UUID from a matching GET result without issuing another POST", async () => {
    const pending = job(30, "queued"), body = { version: 3, requestId: pending.requestId, masterId: 7 };
    jobs = [pending]; sessionStorage.setItem(storageKey, JSON.stringify(body)); await render();
    expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(host.textContent).toContain("템플릿 확인 중"); expect(writes()).toHaveLength(0);
  });
  it("does not clear an unresolved request when its listed version contradicts the saved intent", async () => {
    const pending = job(31, "failed", { sourceVersion: 99 }), body = { version: 3, requestId: pending.requestId, masterId: 7 };
    jobs = [pending]; sessionStorage.setItem(storageKey, JSON.stringify(body)); await render();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull(); expect(button("Canva 8장 만들기").disabled).toBe(true); expect(button("요청 결과 확인").disabled).toBe(false); expect(writes()).toHaveLength(0);
  });
  it('links an explicitly confirmed orphan design and still requires the full eight-image review', async () => {
    const unknown = job(40, 'result_unknown', { phase: 'autofill_submitting', recoveryToken: 'a'.repeat(64) }); jobs = [unknown];
    action = async (path, body) => { expect(path).toBe(`${base}/40/reconcile`); const result = reconciled(unknown, body); jobs = [result]; return result; };
    await render(); expect(button('이 디자인의 8장 가져와 대조하기').disabled).toBe(true);
    await recoveryDesign('https://www.canva.com/design/Drecovered_design/edit?tracking=removed');
    expect(button('이 디자인의 8장 가져와 대조하기').disabled).toBe(true);
    await act(async () => confirmation().click()); await click('이 디자인의 8장 가져와 대조하기');
    expect(writes()).toEqual([[`${base}/40/reconcile`, { method: 'POST', body: { version: 3, designId: 'Drecovered_design', confirmed: true, expectedRecoveryToken: 'a'.repeat(64) } }]]);
    expect(host.textContent).toContain('결과 미확정 작업에 기존 디자인을 연결');
    expect(button('확인한 8장을 새 버전으로 저장').disabled).toBe(true); expect(confirmation().disabled).toBe(true);
    await loadImages(); expect(button('확인한 8장을 새 버전으로 저장').disabled).toBe(true); expect(confirmation().disabled).toBe(false);
  });
  it.each(['lost_response', 'malformed_success'])('replays the same reconciliation intent after %s and remounting', async mode => {
    const unknown = job(41, 'result_unknown', { phase: 'autofill_submitting', recoveryToken: 'a'.repeat(64) }); jobs = [unknown];
    action = async () => { if (mode === 'lost_response') throw new ApiError(0, '연결 응답 유실'); return {}; };
    await render(); await recoveryDesign('Drecovered_design'); await act(async () => confirmation().click()); await click('이 디자인의 8장 가져와 대조하기');
    const first = structuredClone(writes()[0][1].body); expect(sessionStorage.getItem('canva-reconcile:3:28:41')).not.toBeNull();
    await act(async () => root.render(null)); client.clear();
    jobs = [{ ...unknown, recoveryToken: 'e'.repeat(64) }];
    action = async (_path, body) => { const result = reconciled(unknown, body, 'queued'); jobs = [result]; return result; };
    await render({ version: 4, revisionId: 31 }); await click('디자인 연결 결과 확인');
    expect(writes()[1][1].body).toEqual(first); expect(first.version).toBe(3); expect(first.expectedRecoveryToken).toBe('a'.repeat(64));
    expect(sessionStorage.getItem('canva-reconcile:3:28:41')).toBeNull(); expect(writes().some(([path]) => path === base)).toBe(false);
  });
  it('keeps an older recovered job visible for review after the server returns jobs by creation order', async () => {
    const unknown = job(42, 'result_unknown', { sourceVersion: 2, sourceRevisionId: 29, recoveryToken: 'a'.repeat(64) }), newer = job(43, 'failed'); jobs = [newer, unknown];
    action = async (_path, body) => { const result = reconciled(unknown, body); jobs = [newer, result]; return result; };
    await render(); expect(host.textContent).toContain('처음 요청한 뒤 원고가 바뀌었습니다'); await recoveryDesign('Drecovered_design'); await act(async () => confirmation().click()); await click('이 디자인의 8장 가져와 대조하기');
    expect(host.querySelectorAll('.canva-export-grid img')).toHaveLength(8); expect(button('확인한 8장을 새 버전으로 저장').disabled).toBe(true);
    await act(async () => root.render(null)); client.clear(); await render();
    expect(host.querySelectorAll('.canva-export-grid img')).toHaveLength(8); expect(host.textContent).toContain('Canva에서 바꾼 문구를 대조');
  });
  it('uses the known design for an explicit unknown export recovery and blocks dirty edits', async () => {
    const unknown = job(44, 'result_unknown', { phase: 'export_submitting', designId: 'Dexisting_design', recoveryToken: 'a'.repeat(64) }); jobs = [unknown];
    action = async (_path, body) => { const result = reconciled(unknown, body, 'queued'); jobs = [result]; return result; };
    await render({ disabled: true }); expect(button('이 디자인의 8장 가져와 대조하기').disabled).toBe(true); expect(confirmation().disabled).toBe(true);
    await render({ disabled: false }); expect(host.querySelector<HTMLInputElement>('[aria-label="복구할 Canva 디자인 링크 또는 ID"]')!.readOnly).toBe(true);
    await act(async () => confirmation().click()); await click('이 디자인의 8장 가져와 대조하기');
    expect(writes()[0]).toEqual([`${base}/44/reconcile`, { method: 'POST', body: { version: 3, designId: 'Dexisting_design', confirmed: true, expectedRecoveryToken: 'a'.repeat(64) } }]);
  });
  it('clears the original lost enqueue only from a verified reconciliation of that same intent', async () => {
    const unknown = job(45, 'result_unknown', { sourceVersion: 2, sourceRevisionId: 29, recoveryToken: 'a'.repeat(64) });
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, requestId: unknown.requestId, masterId: 7 }));
    jobs = [reconciled(unknown, { version: 3, designId: 'Drecovered_design', expectedRecoveryToken: 'a'.repeat(64) }, 'queued')];
    await render(); expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(writes()).toHaveLength(0);
  });
});
