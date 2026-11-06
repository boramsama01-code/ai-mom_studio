// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ManualFamilyInitializer } from "../client/src/ManualFamilyInitializer";
import { DirtyGuardProvider } from "../client/src/state";
import { activateDraftRecoveryScope } from "../client/src/draftRecovery";
import { ApiError } from "../client/src/api";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { familyFieldDescriptors, familyFieldValue } from "../shared/familyDialogue";
import type { FamilyManualCreate } from "../shared/familyManual";

const mocks = vi.hoisted(() => ({ api: vi.fn(), saved: vi.fn(), back: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/ui", () => ({ ErrorBox: ({ error }: { error: Error }) => <p role="alert">{error.message}</p>, GuardedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, props: Parameters<typeof ManualFamilyInitializer>[0];
let enqueue: ((body: any) => Promise<unknown>) | null;
const receipt = (body: FamilyManualCreate) => ({ requestId: body.requestId, itemId: 39, studioCardId: 88, version: 2, revisionId: 99 });
function manuscript(): FamilyManualCreate {
  const copy = familyDialogueCardFixture(), facts = copy.pages[1].id === "news_summary" ? copy.pages[1].fields.facts : [];
  return { requestId: crypto.randomUUID(), title: "직접 작성 QA · 제공 예시", copy, source: { title: "제공된 예시 문서 · 실제 뉴스 검증 아님", text: facts.join("\n\n"), url: "https://www.canva.com/design/Dmanual_example/edit" }, factBindings: facts.map((text, index) => ({ fieldPath: `pages.news_summary.fields.facts.${index}` as any, excerpt: text, claimType: index === 0 ? "forecast" : "attributed_statement", speaker: "게이츠" })), confirmed: true };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); enqueue = null; activateDraftRecoveryScope("manual-scope-a-0001");
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(["me"], { user: "operator-a", recoveryScope: "manual-scope-a-0001" });
  mocks.api.mockImplementation(async (_path: string, options: { body: any }) => enqueue ? enqueue(options.body) : receipt(options.body));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { channelId: 3, channelName: "ALLligodang", onSaved: mocks.saved, onBack: mocks.back };
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.clear(); sessionStorage.clear(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
async function render(change: Partial<typeof props> = {}) { props = { ...props, ...change }; await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider><ManualFamilyInitializer {...props} /></DirtyGuardProvider></QueryClientProvider>)); await settle(); }
function button(text: string) { const value = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text); if (!value) throw new Error("Missing button: " + text); return value; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
async function input(label: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)!; if (!node) throw new Error("Missing field " + label);
  await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); await settle();
}
async function confirm() { await act(async () => host.querySelector<HTMLLabelElement>(".manual-family-confirm")!.click()); await settle(); }
async function importManuscript(body = manuscript()) {
  const file = new File([JSON.stringify(body)], "manual-eight.json", { type: "application/json" }); Object.defineProperty(file, "text", { value: async () => JSON.stringify(body) });
  const node = host.querySelector<HTMLInputElement>('[aria-label="8장 원고 파일"]')!; Object.defineProperty(node, "files", { configurable: true, value: [file] });
  await act(async () => node.dispatchEvent(new Event("change", { bubbles: true }))); await settle();
}
async function delayedImport() {
  let release!: (value: string) => void;
  const file = new File(["{}"], "slow-eight.json", { type: "application/json" }); Object.defineProperty(file, "text", { value: () => new Promise<string>(resolve => { release = resolve; }) });
  const node = host.querySelector<HTMLInputElement>('[aria-label="8장 원고 파일"]')!; Object.defineProperty(node, "files", { configurable: true, value: [file] });
  await act(async () => node.dispatchEvent(new Event("change", { bubbles: true }))); await settle(); return async (body: FamilyManualCreate) => { await act(async () => release(JSON.stringify(body))); await settle(); };
}

describe("AI 없는 8장 직접 작성", () => {
  it("파일 없이 모든 장을 직접 작성하고 제공 자료·구절과 대조한 뒤에만 새 원고를 저장한다", async () => {
    await render(); const body = manuscript(); await input("8장 작업 제목", body.title); await input("제공 자료 제목", body.source.title); await input("제공 자료 본문", body.source.text); await input("제공 자료 주소", body.source.url!);
    await input("직접 작성 8장 디자인", body.copy.templateKey === "set:n03" ? "cardnews14-cobalt-paper-v1" : body.copy.templateKey);
    for (const [index, page] of body.copy.pages.entries()) {
      await click(`${index + 1} ${({cover:"표지",news_summary:"뉴스 요약",implication:"뉴스의 의미",discussion:"중심 질문",perspectives:"두 가지 시선",concept:"개념 다듬기",activity:"작은 활동",outro:"닫는 표지"})[page.id]}`);
      for (const field of familyFieldDescriptors(page)) {
        const value = familyFieldValue(body.copy, field.fieldPath);
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) await input(`${field.label} ${i + 1}`, value[i]);
        else await input(field.label, typeof value === "string" ? value : "");
      }
      if (index === 1) for (const [i, value] of body.factBindings.entries()) { await input(`근거 ${i + 1} 문구의 성격`, value.claimType); await input(`근거 ${i + 1} 원문 구절`, value.excerpt); await input(`근거 ${i + 1} 발언자`, value.speaker!); }
    }
    expect(mocks.api).not.toHaveBeenCalled(); expect(button("직접 쓴 8장 원고 저장").disabled).toBe(true);
    await confirm(); await click("직접 쓴 8장 원고 저장"); expect(mocks.api).toHaveBeenCalledOnce();
    const [path, options] = mocks.api.mock.calls[0]; expect(path).toBe("/channels/3/items/manual-family"); expect(options.body.copy.pages).toHaveLength(8); expect(options.body.source).toEqual(body.source); expect(options.body.factBindings).toEqual(body.factBindings);
    expect(options.body).not.toHaveProperty("proposalJobId"); expect(options.body).not.toHaveProperty("generationRuns"); expect(mocks.saved).toHaveBeenCalledWith(receipt(options.body));
  });

  it("불완전한 문구는 입력을 유지하고 AI나 저장 요청을 보내지 않는다", async () => {
    await render(); await input("8장 작업 제목", "아직 작성 중"); await confirm(); await click("직접 쓴 8장 원고 저장");
    expect(mocks.api).not.toHaveBeenCalled(); expect(host.textContent).toContain("필수 문구"); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("아직 작성 중");
  });

  it("원고 파일 불러오기는 입력에만 반영하고 확인 후 저장한다", async () => {
    await render(); const body = manuscript(); await importManuscript(body); expect(mocks.api).not.toHaveBeenCalled(); expect(button("직접 쓴 8장 원고 저장").disabled).toBe(true);
    await confirm(); await click("직접 쓴 8장 원고 저장"); const sent = mocks.api.mock.calls[0][1].body; expect(sent.copy).toEqual(body.copy); expect(sent.requestId).not.toBe(body.requestId);
  });

  it("늦게 읽힌 파일이 이후 입력이나 더 최근에 고른 파일을 덮어쓰지 않는다", async () => {
    await render(); const release = await delayedImport(); await input("8장 작업 제목", "파일을 읽는 동안 직접 고친 제목"); await release(manuscript());
    expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("파일을 읽는 동안 직접 고친 제목");
    const older = await delayedImport(), newer = manuscript(); newer.title = "나중에 선택한 원고 파일"; await importManuscript(newer); await older(manuscript());
    expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe(newer.title); expect(mocks.api).not.toHaveBeenCalled();
  });

  it("진행 중인 파일 읽기가 이미 저장 요청한 원고와 미확정 요청을 바꾸지 않는다", async () => {
    enqueue = async () => { throw new ApiError(0, "응답 유실"); }; await render(); const original = manuscript(); await importManuscript(original); const release = await delayedImport();
    await confirm(); await click("직접 쓴 8장 원고 저장"); const pending = structuredClone(mocks.api.mock.calls[0][1].body), oldFile = manuscript(); oldFile.title = "뒤늦게 읽은 다른 원고"; await release(oldFile);
    expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe(original.title); expect(host.textContent).toContain("같은 요청 번호"); enqueue = null; await click("8장 원고 저장 결과 확인"); expect(mocks.api.mock.calls[1][1].body).toEqual(pending);
  });

  it("응답을 잃고 다시 열어도 원고와 같은 요청 번호로 중복 생성 없이 확인한다", async () => {
    enqueue = async () => { throw new ApiError(0, "응답 유실", { resultUnknown: true }); };
    await render(); await importManuscript(); await confirm(); await click("직접 쓴 8장 원고 저장"); const original = structuredClone(mocks.api.mock.calls[0][1].body);
    await act(async () => root.render(null)); enqueue = null; await render({ initialTitle: "다른 초기 제목" });
    expect(host.textContent).toContain("같은 요청 번호"); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe(original.title);
    await click("8장 원고 저장 결과 확인"); expect(mocks.api.mock.calls[1][1].body).toEqual(original); expect(mocks.saved).toHaveBeenCalledOnce();
  });

  it("다른 요청의 저장 응답은 적용하지 않고 같은 요청을 유지한다", async () => {
    enqueue = async body => ({ ...receipt(body), requestId: crypto.randomUUID() }); await render(); await importManuscript(); await confirm(); await click("직접 쓴 8장 원고 저장");
    expect(mocks.saved).not.toHaveBeenCalled(); expect(host.textContent).toContain("다른 원고의 저장 응답"); expect(button("8장 원고 저장 결과 확인").disabled).toBe(false);
  });

  it("기존 원고는 현재 버전과 항목에 명시적 새 버전 전환 요청을 보낸다", async () => {
    enqueue = async body => ({ ...receipt(body), itemId: 39, version: 8 }); await render({ existing: { itemId: 39, version: 7 } }); await importManuscript(); await confirm(); await click("직접 쓴 8장을 새 버전으로 저장·전환");
    expect(mocks.api.mock.calls[0][0]).toBe("/channels/3/items/39/card-copy/manual-initialize"); expect(mocks.api.mock.calls[0][1].body.version).toBe(7); expect(mocks.saved).toHaveBeenCalledOnce();
  });

  it("개념 방식을 바꾸고 되돌려도 직접 쓴 정의와 근거는 유지한다", async () => {
    await render(); await click("6 개념 다듬기"); await input("첫 번째 정의 예시", "직접 쓴 정의 A"); await input("직접 작성 개념 설명 방식", "scientific_explanation"); await input("통용 정의", "자료에서 확인한 설명"); await input("근거 1 원문 구절", "실제로 옮긴 설명");
    await input("직접 작성 개념 설명 방식", "value_definition"); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="첫 번째 정의 예시"]')!.value).toBe("직접 쓴 정의 A");
    await input("직접 작성 개념 설명 방식", "scientific_explanation"); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="통용 정의"]')!.value).toBe("자료에서 확인한 설명"); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="근거 1 원문 구절"]')!.value).toBe("실제로 옮긴 설명"); expect(mocks.api).not.toHaveBeenCalled();
  });

  it("채널과 사용자가 바뀌면 이전 입력을 섞지 않고 원래 채널 복구본만 직접 복원한다", async () => {
    await render(); await input("8장 작업 제목", "채널3의 미저장 원고"); await render({ channelId: 4, channelName: "다른 채널" }); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("");
    await render({ channelId: 3, channelName: "ALLligodang" }); expect(host.textContent).toContain("기기 복구본"); await click("복구본을 편집기에 불러오기"); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("채널3의 미저장 원고");
    await act(async () => { client.setQueryData(["me"], { user: "operator-b", recoveryScope: "manual-scope-b" }); }); await settle(); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("");
  });

  it("이전 사용자의 늦은 응답으로 새 사용자를 이동시키지 않는다", async () => {
    let release!: (value: unknown) => void; enqueue = () => new Promise(resolve => { release = resolve; }); await render(); await importManuscript(); await confirm();
    await act(async () => button("직접 쓴 8장 원고 저장").click()); await settle(); const body = mocks.api.mock.calls[0][1].body;
    await act(async () => { client.setQueryData(["me"], { user: "operator-b", recoveryScope: "manual-scope-b" }); }); await settle(); await act(async () => release(receipt(body))); await settle();
    expect(mocks.saved).not.toHaveBeenCalled(); expect(host.querySelector<HTMLInputElement>('[aria-label="8장 작업 제목"]')!.value).toBe("");
  });
});
