// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceRevisionHistory } from "../client/src/SourceRevisionHistory";
import { ItemDetailPage } from "../client/src/pages/ItemDetail";
import { DirtyGuardProvider, useDirtyGuard } from "../client/src/state";
import { DirtyModal } from "../client/src/ui";
import { api, ApiError } from "../client/src/api";
import { emptyPayload } from "../shared/payloads";
import { cardCopyFixture } from "./fixtures/cardCopy";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), restored: vi.fn(), save: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", async original => ({ ...await original<object>(), useChannel: () => ({ selected: 2, channels: [{ id: 2, name: "테스트 채널", active: true }], allChannels: [{ id: 2, name: "테스트 채널", active: true }] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", async original => ({ ...await original<object>(), useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => "" }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "set:n03", items: [] } }), TemplatePicker: () => null }));
vi.mock("../client/src/CardCarousel", () => ({ CardCarousel: () => null }));
vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const path = "/channels/2/items/9", key = ["ch", 2, "item", 9];
let host: HTMLDivElement, root: Root, client: QueryClient, detail: any, old: any;
let restoreBarrier: (() => Promise<void>) | null;

function Editable({ payload }: { payload: Record<string, unknown> }) {
  const guard = useDirtyGuard();
  const saved = String(payload.key_question ?? "");
  const [base, setBase] = useState(saved), [value, setValue] = useState(saved);
  const dirty = value !== base;
  useEffect(() => { if (!dirty) { setBase(saved); setValue(saved); } }, [saved, dirty]);
  useEffect(() => {
    guard.setDirty("other-editor", dirty, async () => {
      if (!(await mocks.save())) return false;
      detail.item.version++;
      detail.current = { ...detail.current, id: detail.current.id + 100, revisionNo: detail.current.revisionNo + 1, payload: { ...detail.current.payload, key_question: value } };
      detail.item.currentRevisionId = detail.current.id;
      detail.revisions = [structuredClone(detail.current), ...detail.revisions];
      setBase(value);
      return true;
    }, () => { setValue(base); });
    return () => guard.setDirty("other-editor", false);
  }, [guard, dirty, value, base]);
  return <textarea aria-label="임시 원고" value={value} onChange={event => setValue(event.target.value)} />;
}
function Harness() {
  const loaded = useQuery({ queryKey: key, queryFn: () => api<any>(path) });
  if (!loaded.data) return null;
  const d = loaded.data;
  return <><Editable payload={d.current.payload} /><SourceRevisionHistory channelId={2} itemId={9} itemVersion={d.item.version} current={d.current} revisions={d.revisions} onRestored={mocks.restored} /><DirtyModal /></>;
}
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function render(element: ReactNode = <Harness />) {
  await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider>{element}</DirtyGuardProvider></QueryClientProvider>));
  await settle();
}
function button(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text); expect(node, text).toBeTruthy(); return node!; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function selectRevision(id = 3) {
  const select = host.querySelector<HTMLSelectElement>(".source-revision-history select")!;
  await act(async () => { select.value = String(id); select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
}
async function type(node: HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}
const writes = () => mocks.api.mock.calls.filter(([, opts]) => opts?.method === "POST");

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); restoreBarrier = null;
  mocks.save.mockResolvedValue(true);
  old = { id: 3, contentItemId: 9, revisionNo: 1, author: "operator", createdAt: "2026-11-01T00:00:00Z", note: "수정 전 원고", payload: { ...emptyPayload("science_dialogue", "이전 주제"), key_question: "과거에 저장한 질문", cardCopy: cardCopyFixture("set:n01-blue") } };
  old.payload.cardCopy.cover.title = "과거 카드 표지";
  const current = { ...structuredClone(old), id: 4, revisionNo: 2, note: "최근 수정", payload: { ...emptyPayload("science_dialogue", "현재 주제"), key_question: "오늘 저장한 질문", cardCopy: cardCopyFixture("set:n03") } };
  current.payload.cardCopy.cover.title = "현재 카드 표지";
  detail = {
    item: { id: 9, channelId: 2, version: 2, kind: "science_dialogue", origin: "manual", title: "오늘 저장한 질문", currentRevisionId: 4, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: current.payload },
    current, revisions: [structuredClone(current), structuredClone(old)], primary: null, linked: [],
    cards: [{ id: 40, revisionId: 4, sha256: "fixture", createdAt: "2026-11-01T00:00:00Z", cloudinaryUrl: null, templateKey: "set:n03" }],
    publicationDraft: { version: 0, captions: { instagram: "저장한 캡션", telegram: "" } },
    approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "저장한 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: true, autoPublish: false, dailyLimit: 3, destinations: [] },
  };
  mocks.api.mockImplementation(async (url: string, opts?: { method?: string; body?: any }) => {
    if (url === path) return structuredClone(detail);
    if (url === `${path}/revisions/3`) return structuredClone(old);
    if (url === `${path}/revisions/4`) return structuredClone(detail.revisions.find((r: any) => r.id === 4));
    if (url === `${path}/revisions/3/restore`) {
      if (restoreBarrier) await restoreBarrier();
      if (opts?.body.version !== detail.item.version) throw new ApiError(409, "다른 곳에서 먼저 저장했습니다.");
      const previousRevisionId = detail.current.id;
      detail.item.version++;
      detail.current = { ...structuredClone(old), id: 200, revisionNo: Math.max(...detail.revisions.map((r: any) => r.revisionNo)) + 1, note: "r1 복원" };
      detail.item.currentRevisionId = detail.current.id; detail.item.reviewStatus = "review_required";
      detail.revisions = [detail.current, ...detail.revisions];
      return { item: structuredClone(detail.item), revision: structuredClone(detail.current), restoredFrom: { id: old.id, revisionNo: old.revisionNo }, previousRevisionId };
    }
    if (url === `${path}/card-copy`) return { version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: true, copy: structuredClone(detail.current.payload.cardCopy) };
    if (url === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: false, anthropic: false, openai: false } };
    if (url === "/status") return { integrations: { flags: { dryRun: true, autoPublish: false } }, workerConnected: false, globalStop: false };
    if (url === "/canva/status") return { connected: false };
    throw new Error(`Unexpected mocked API: ${url}`);
  });
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:history-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

describe("source history with real dirty guard and mocked HTTP", () => {
  it("loads history only on selection and compares actual source/card text without writing", async () => {
    await render();
    expect(mocks.api.mock.calls.some(([url]) => url.includes("/revisions/"))).toBe(false);
    await selectRevision();
    for (const text of ["오늘 저장한 질문", "과거에 저장한 질문", "현재 카드 표지", "과거 카드 표지", "set:n01-blue", "set:n03"]) expect(host.textContent).toContain(text);
    expect(writes()).toHaveLength(0);
    await selectRevision(4);
    expect(button("현재 저장본입니다").disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it("cancel and failed saving retain an unsaved editor and never submit restore", async () => {
    await render(); await selectRevision();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="임시 원고"]')!;
    await type(input, "아직 저장하지 않은 중요한 문장");
    await click("이 버전 복원하기"); await click("머무르기");
    expect(input.value).toBe("아직 저장하지 않은 중요한 문장");
    mocks.save.mockResolvedValueOnce(false);
    await click("이 버전 복원하기"); await click("저장하고 이동");
    expect(input.value).toBe("아직 저장하지 않은 중요한 문장");
    expect(host.querySelector('[aria-label="원고 복원 확인"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("compares the version produced by guard-save and restores only after explicit confirmation", async () => {
    await render(); await selectRevision();
    await type(host.querySelector('[aria-label="임시 원고"]')!, "복원 직전에 따로 저장한 원고");
    await click("이 버전 복원하기"); await click("저장하고 이동");
    expect(detail.item.version).toBe(3);
    expect(host.querySelector('[aria-label="원고 복원 확인"]')).not.toBeNull();
    expect(host.textContent).toContain("복원 직전에 따로 저장한 원고");
    expect(writes()).toHaveLength(0);
    await click("취소"); expect(writes()).toHaveLength(0);
    await click("이 버전 복원하기"); await click("확인 후 새 버전으로 복원");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].body).toEqual({ version: 3 });
    expect(mocks.restored).toHaveBeenCalledOnce();
    expect(detail.revisions.some((r: any) => r.payload.key_question === "복원 직전에 따로 저장한 원고")).toBe(true);
    expect(host.textContent).toContain("새 버전 r4으로 복원했습니다");
  });

  it("asks again when the user edits after the comparison confirmation", async () => {
    await render(); await selectRevision(); await click("이 버전 복원하기");
    await type(host.querySelector('[aria-label="임시 원고"]')!, "확인 창을 연 뒤에 쓴 문장");
    await click("확인 후 새 버전으로 복원");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click("머무르기");
    expect(writes()).toHaveLength(0);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="임시 원고"]')!.value).toBe("확인 창을 연 뒤에 쓴 문장");
  });

  it("keeps a concurrent-save conflict for review, with no automatic restore retry", async () => {
    await render(); await selectRevision(); await click("이 버전 복원하기");
    detail.item.version = 8;
    detail.current = { ...detail.current, id: 88, revisionNo: 8, payload: { ...detail.current.payload, key_question: "다른 운영자가 저장한 질문" } };
    await click("확인 후 새 버전으로 복원");
    expect(writes()).toHaveLength(1);
    expect(host.textContent).toContain("최신 저장본을 다시 비교");
    expect(detail.current.payload.key_question).toBe("다른 운영자가 저장한 질문");
    await click("이 버전 복원하기");
    expect(host.textContent).toContain("다른 운영자가 저장한 질문");
    expect(writes()).toHaveLength(1);
    await click("확인 후 새 버전으로 복원");
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1].body).toEqual({ version: 8 });
  });

  it("submits at most once during an in-flight request and keeps typing made while awaiting it", async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    restoreBarrier = () => barrier;
    await render(); await selectRevision(); await click("이 버전 복원하기");
    const confirm = button("확인 후 새 버전으로 복원");
    await act(async () => { confirm.click(); confirm.click(); }); await settle();
    expect(writes()).toHaveLength(1);
    await type(host.querySelector('[aria-label="임시 원고"]')!, "복원 요청 중 입력한 문장은 남겨야 합니다");
    await act(async () => release()); await settle();
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="임시 원고"]')!.value).toBe("복원 요청 중 입력한 문장은 남겨야 합니다");
  });

  it("updates the actual ItemDetail card editor and its internal template after restore without remounting", async () => {
    await render(<><ItemDetailPage cid={2} id={9} /><DirtyModal /></>);
    const editor = host.querySelector(".card-copy-editor")!;
    expect(editor.textContent).toContain("문구·미리보기");
    expect([...editor.querySelectorAll<HTMLTextAreaElement>("textarea")].some(input => input.value === "현재 카드 표지")).toBe(true);
    await selectRevision(); await click("이 버전 복원하기"); await click("확인 후 새 버전으로 복원");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 520)); }); await settle();
    expect(host.querySelector(".card-copy-editor")).toBe(editor);
    expect([...editor.querySelectorAll<HTMLTextAreaElement>("textarea")].some(input => input.value === "과거 카드 표지")).toBe(true);
    expect(editor.textContent).not.toContain("저장하지 않은 수정");
    const previews = mocks.blob.mock.calls.filter(([url]) => url === `${path}/card-copy/preview`);
    expect(previews.at(-1)?.[2]?.body?.copy?.templateKey).toBe("set:n01-blue");
    expect(previews.at(-1)?.[2]?.body?.version).toBe(3);
  });

  it("preserves dirty card text on cancel and replaces it only after explicit discard plus restore confirmation", async () => {
    await render(<><ItemDetailPage cid={2} id={9} /><DirtyModal /></>);
    const editor = host.querySelector(".card-copy-editor")!;
    const title = [...editor.querySelectorAll<HTMLTextAreaElement>("textarea")].find(input => input.value === "현재 카드 표지")!;
    await type(title, "저장 전 카드 표지");
    await selectRevision(); await click("이 버전 복원하기"); await click("머무르기");
    expect(title.value).toBe("저장 전 카드 표지");
    expect(writes()).toHaveLength(0);
    await click("이 버전 복원하기"); await click("버리고 이동");
    expect(title.value).toBe("현재 카드 표지");
    expect(writes()).toHaveLength(0);
    await click("확인 후 새 버전으로 복원");
    expect(title.value).toBe("과거 카드 표지");
    expect(writes()).toHaveLength(1);
    expect(editor.textContent).not.toContain("다른 곳에서 수정");
  });
});
