// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinishedDeckEditor } from "../client/src/pages/FinishedDeckEditor";
import { ExperienceEditor } from "../client/src/pages/ExperienceEditor";
import { DirtyGuardProvider, useDirtyGuard } from "../client/src/state";
import { DirtyModal } from "../client/src/ui";
import { ApiError } from "../client/src/api";
import { activateDraftRecoveryScope, readDraftRecovery } from "../client/src/draftRecovery";
import { studioContentSchema, type StudioCard } from "../shared/studio";

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn(), leave: vi.fn(), toast: vi.fn(), publication: null as any, export: null as any }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiUpload: mocks.upload }));
vi.mock("../client/src/state", async original => ({ ...await original<object>(), useChannel: () => ({ allChannels: [{ slug: "news", name: "후기 채널", active: true }, { slug: "penguin", name: "완성 이미지 채널", active: true }] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/pages/FinishedDeckAi", () => ({ FinishedDeckAi: () => null }));
vi.mock("../client/src/pages/StudioPublish", () => ({ StudioPublish: (props: unknown) => { mocks.publication = props; return null; } }));
vi.mock("../client/src/pages/StudioExport", () => ({ StudioQuickExport: () => null, StudioExport: (props: unknown) => { mocks.export = props; return null; } }));
vi.mock("../client/src/pages/StudioTrash", () => ({ StudioTrashButton: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scope = "direct-editor-recovery-isolated-test";
let host: HTMLDivElement, root: Root, client: QueryClient, server: StudioCard;
type Mode = "finished" | "experience";
function fixture(mode: Mode): StudioCard {
  return { ...studioContentSchema.parse({ title: "서버에 저장한 제목", caption: "서버에 저장한 캡션", channel: mode === "finished" ? "penguin" : "news", format: "카드뉴스",
    ...(mode === "finished" ? { finishedDeck: { pages: [{ imageId: 11, name: "01.png", altText: "첫 이미지 설명" }, { imageId: 22, name: "02.png", altText: "둘째 이미지 설명" }] } } : {
      experience: { notes: "서버 경험 메모", media: [{ id: 11, note: "첫 사진 메모" }, { id: 22, note: "둘째 사진 메모" }], coverId: 11,
        pages: [{ mediaId: 11, title: "첫 장면", body: "현장의 경험", altText: "첫 사진의 대체텍스트" }, { mediaId: 22, title: "둘째 장면", body: "더 적을 경험", altText: "둘째 사진의 대체텍스트" }] },
    }),
  }), id: mode === "finished" ? 10 : 20, version: 1, sourceItemId: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
}
function LeaveControl() { const guard = useDirtyGuard(); return <><button onClick={() => guard.confirmLeave(mocks.leave)}>테스트 목록 이동</button><DirtyModal /></>; }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); activateDraftRecoveryScope(scope);
  mocks.publication = null; mocks.export = null; server = fixture("finished");
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (options?.method === "PATCH") {
      if (options.body.version !== server.version) throw new ApiError(409, "다른 곳에서 먼저 저장했습니다.", { current: structuredClone(server) });
      server = { ...server, ...options.body, version: server.version + 1 }; return structuredClone(server);
    }
    if (path === "/studio/cards") return { cards: [server], ai: { text: { openai: false } } };
    if (path.endsWith("/media")) return [11, 22].map(id => ({ id, cardId: server.id, name: `사진${id}.jpg`, hasPreview: true, kind: "photo" }));
    if (path === `/studio/cards/${server.id}`) return { card: structuredClone(server), jobs: [], revisions: [] };
    throw new Error(`Unexpected mocked API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["me"], { user: "operator", recoveryScope: scope, csrf: "AUTH-MUST-NOT-BE-STORED" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); });
async function settle(ms = 10) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount(mode: Mode, card = server) {
  const component = mode === "finished" ? <FinishedDeckEditor key={card.id} data={{ card, revisions: [], jobs: [] }} /> : <ExperienceEditor key={card.id} data={{ card, revisions: [], jobs: [] }} refresh={() => undefined} />;
  await render(component); await settle();
}
async function render(component: ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider>{component}<LeaveControl /></DirtyGuardProvider></QueryClientProvider>)); }
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const node = [...host.querySelectorAll<HTMLLabelElement>("label")].find(labelNode => labelNode.textContent?.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  expect(node, label).toBeTruthy(); return node!;
}
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}
const caption = () => host.querySelector<HTMLTextAreaElement>('[aria-label="후기 게시용 캡션"]')!;
function button(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text); expect(node, text).toBeTruthy(); return node!; }
async function click(text: string) { const node = button(text); expect(node.disabled, text).toBe(false); await act(async () => node.click()); await settle(); }
const patches = () => mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH");
const recovery = (mode: Mode) => readDraftRecovery(scope, `studio:${mode === "finished" ? 10 : 20}:${mode === "finished" ? "finished-deck" : "experience"}`, value => value && typeof value === "object" ? value as Record<string, any> : null);
function delayedPatch() {
  const original = mocks.api.getMockImplementation()!;
  let resolve!: (card: StudioCard) => void;
  mocks.api.mockImplementation((path: string, options?: any) => options?.method === "PATCH" ? new Promise<StudioCard>(done => { resolve = done; }) : original(path, options));
  return { finish: (card: StudioCard) => resolve(card), original };
}

describe("finished-image editor preservation", () => {
  it("recovers title, caption, image order and alt text only after explicit choice; stores metadata only", async () => {
    await mount("finished");
    await input(field("게시물 제목"), ""); // unfinished titles must also be recoverable
    await input(field("게시할 캡션"), "저장 전 캡션\n마지막 글자🐧");
    await input(host.querySelector('[aria-label="1페이지 대체텍스트"]')!, "첫 이미지에 새로 입력한 설명");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="1장 뒤로"]')!.click()); await settle();
    expect(recovery("finished")).toMatchObject({ ok: true, value: { value: { title: "", caption: "저장 전 캡션\n마지막 글자🐧", finishedDeck: { pages: [{ imageId: 22 }, { imageId: 11, altText: "첫 이미지에 새로 입력한 설명" }] } } } });
    const stored = Object.values(localStorage).join("");
    expect(stored).not.toContain("AUTH-MUST-NOT-BE-STORED"); expect(stored).not.toContain("data:image"); expect(stored).not.toContain('"bytes"');
    await render(null); await mount("finished");
    expect(field("게시물 제목").value).toBe("서버에 저장한 제목"); expect(field("게시물 제목").disabled).toBe(true);
    expect(patches()).toHaveLength(0);
    await click("복구본을 편집기에 불러오기");
    expect(field("게시물 제목").value).toBe(""); expect(field("게시할 캡션").value).toBe("저장 전 캡션\n마지막 글자🐧");
    expect([...host.querySelectorAll<HTMLImageElement>(".finished-page img")].map(image => image.getAttribute("src"))).toEqual(["/api/studio/images/22", "/api/studio/images/11"]);
    expect(patches()).toHaveLength(0);
    await input(field("게시물 제목"), "복구 후 확인한 제목"); await click("변경 내용 저장");
    expect(server.finishedDeck?.pages.map(page => page.imageId)).toEqual([22, 11]);
    expect(recovery("finished")).toEqual({ ok: true, value: null });
  });

  it("retains text entered after a child-triggered save snapshot and writes it with the next version", async () => {
    await mount("finished"); await input(field("게시할 캡션"), "첫 저장 내용");
    const deferred = delayedPatch(); let saving!: Promise<StudioCard>;
    await act(async () => { saving = mocks.publication.save(); }); await settle();
    // An input event already queued when the request started must not be lost,
    // even though the rendered editor now locks new interaction during saving.
    await input(field("게시할 캡션"), "저장 요청 뒤에 더 입력한 문장");
    const saved = { ...server, ...patches()[0][1].body, version: 2 };
    server = saved;
    await act(async () => { deferred.finish(saved); await saving; }); await settle();
    expect(field("게시할 캡션").value).toBe("저장 요청 뒤에 더 입력한 문장");
    expect(mocks.publication.base.version).toBe(2);
    expect(recovery("finished")).toMatchObject({ ok: true, value: { value: { caption: "저장 요청 뒤에 더 입력한 문장" } } });
    mocks.api.mockImplementation(deferred.original);
    await click("변경 내용 저장");
    expect(patches()[1][1].body).toMatchObject({ version: 2, caption: "저장 요청 뒤에 더 입력한 문장" });
  });

  it("does not roll back v3 on a late v2 response, and requires consent before overwriting the latest server value", async () => {
    await mount("finished"); await input(field("게시할 캡션"), "내가 저장하려는 캡션");
    const deferred = delayedPatch(); let saving!: Promise<StudioCard>;
    await act(async () => { saving = mocks.publication.save(); void saving.catch(() => undefined); }); await settle();
    const oldResponse = { ...server, ...patches()[0][1].body, version: 2 };
    server = { ...server, version: 3, caption: "다른 곳에서 먼저 갱신한 v3 캡션" };
    await mount("finished", server);
    await act(async () => { deferred.finish(oldResponse); await saving.catch(() => undefined); }); await settle();
    expect(mocks.publication.base.version).toBe(3);
    expect(field("게시할 캡션").value).toBe("내가 저장하려는 캡션");
    expect(host.textContent).toContain("다른 곳에서 먼저 갱신한 v3 캡션");
    expect(patches()).toHaveLength(1);
    mocks.api.mockImplementation(deferred.original);
    await click("현재 입력으로 다시 저장");
    expect(patches()[1][1].body.version).toBe(3); expect(mocks.publication.base.version).toBe(4);
  });

  it("retains failed saves and discards to the accepted server baseline only on explicit choice", async () => {
    await mount("finished"); await input(field("게시할 캡션"), "실패해도 남길 캡션");
    mocks.api.mockRejectedValueOnce(new ApiError(503, "저장 서비스 일시 오류"));
    await click("변경 내용 저장");
    expect(field("게시할 캡션").value).toBe("실패해도 남길 캡션");
    expect(recovery("finished")).toMatchObject({ ok: true, value: { value: { caption: "실패해도 남길 캡션" } } });
    await click("테스트 목록 이동"); await click("머무르기"); expect(mocks.leave).not.toHaveBeenCalled();
    await click("테스트 목록 이동"); await click("버리고 이동");
    expect(field("게시할 캡션").value).toBe("서버에 저장한 캡션");
    expect(recovery("finished")).toEqual({ ok: true, value: null });
    expect(mocks.leave).toHaveBeenCalledOnce(); expect(patches()).toHaveLength(1);
  });

  it("locks all editable image metadata during child publication without feeding that busy flag back to the child", async () => {
    await mount("finished");
    await act(async () => mocks.publication.onBusyChange(true));
    expect(field("게시물 제목").disabled).toBe(true); expect(field("게시할 캡션").disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="1페이지 대체텍스트"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="1장 뒤로"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="완성 이미지 파일"]')!.disabled).toBe(true);
    expect(mocks.publication.busy).toBe(false);
    await act(async () => mocks.publication.onBusyChange(false));
    expect(field("게시할 캡션").disabled).toBe(false); expect(patches()).toHaveLength(0);
  });
});

describe("experience editor preservation", () => {
  beforeEach(() => { server = fixture("experience"); });
  it("recovers notes, caption and selected media metadata, then waits for an explicit save before resuming auto-save", async () => {
    await mount("experience");
    await input(caption(), "아직 서버에 없는 후기 캡션");
    await input(field("실제로 무엇을 했나요?"), "직접 본 현장 기록\n마지막 글자🐧");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="사진11.jpg 뒤로"]')!.click()); await settle();
    expect(recovery("experience")).toMatchObject({ ok: true, value: { value: { caption: "아직 서버에 없는 후기 캡션", experience: { notes: "직접 본 현장 기록\n마지막 글자🐧", media: [{ id: 22 }, { id: 11 }] } } } });
    await render(null); await mount("experience"); await settle(2000);
    expect(caption().value).toBe("서버에 저장한 캡션"); expect(caption().matches(":disabled")).toBe(true); expect(patches()).toHaveLength(0);
    await click("복구본을 편집기에 불러오기"); await settle(2500);
    expect(caption().value).toBe("아직 서버에 없는 후기 캡션"); expect(field("실제로 무엇을 했나요?").value).toContain("마지막 글자🐧");
    expect(patches()).toHaveLength(0); expect(host.textContent).toContain("확인 전에는 자동 저장하지 않습니다");
    await click("저장");
    expect(server.experience?.media.map(media => media.id)).toEqual([22, 11]); expect(recovery("experience")).toEqual({ ok: true, value: null });
  });

  it("keeps the highest observed version during delayed auto-save and pauses until the operator resolves the conflict", async () => {
    await mount("experience"); const deferred = delayedPatch();
    await input(caption(), "자동 저장 중인 내 원고"); await settle(1400);
    expect(patches()).toHaveLength(1);
    const oldResponse = { ...server, ...patches()[0][1].body, version: 2 };
    server = { ...server, version: 3, caption: "새로운 서버 v3 원고" };
    await mount("experience", server);
    await act(async () => deferred.finish(oldResponse)); await settle(3000);
    expect(mocks.export.base.version).toBe(3); expect(caption().value).toBe("자동 저장 중인 내 원고");
    expect(host.textContent).toContain("새로운 서버 v3 원고"); expect(patches()).toHaveLength(1);
    mocks.api.mockImplementation(deferred.original); await click("현재 입력으로 저장");
    expect(patches()[1][1].body.version).toBe(3); expect(mocks.export.base.version).toBe(4);
  });

  it("discards to the accepted baseline and removes the corresponding recovery record", async () => {
    await mount("experience"); await input(caption(), "명시적으로 버릴 후기 초안");
    await click("테스트 목록 이동"); await click("머무르기");
    expect(caption().value).toBe("명시적으로 버릴 후기 초안"); expect(mocks.leave).not.toHaveBeenCalled();
    await click("테스트 목록 이동"); await click("버리고 이동");
    expect(caption().value).toBe("서버에 저장한 캡션"); expect(mocks.leave).toHaveBeenCalledOnce();
    expect(recovery("experience")).toEqual({ ok: true, value: null }); expect(patches()).toHaveLength(0);
  });

  it("locks experience fields during export publication without a feedback loop", async () => {
    await mount("experience"); await act(async () => mocks.export.onPublicationBusyChange(true));
    expect(caption().matches(":disabled")).toBe(true); expect(field("실제로 무엇을 했나요?").matches(":disabled")).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="후기 사진·영상 업로드"]')!.disabled).toBe(true);
    expect(mocks.export.busy).toBe(false);
    await act(async () => mocks.export.onPublicationBusyChange(false));
    expect(caption().matches(":disabled")).toBe(false); expect(patches()).toHaveLength(0);
  });
});

it.each<Mode>(["finished", "experience"])("%s keeps the original recovery baseline after an unresolved server conflict and rechecks comparison on reopen", async mode => {
  server = fixture(mode); await mount(mode);
  await input(mode === "finished" ? field("게시할 캡션") : caption(), "아직 합의하지 않은 내 초안");
  server = { ...server, version: 3, caption: "다른 운영자의 최신 서버 원고" };
  await click(mode === "finished" ? "변경 내용 저장" : "저장");
  expect(recovery(mode)).toMatchObject({ ok: true, value: { baseVersion: 1 } });
  await input(mode === "finished" ? field("게시할 캡션") : caption(), "충돌 이후에도 계속 입력한 내 초안");
  expect(recovery(mode)).toMatchObject({ ok: true, value: { baseVersion: 1 } });
  await render(null); await mount(mode);
  expect(host.textContent).toContain("충돌 이후에도 계속 입력한 내 초안");
  expect(host.textContent).toContain("다른 운영자의 최신 서버 원고");
  expect(button("복구본을 편집기에 불러오기").disabled).toBe(true);
  expect(patches()).toHaveLength(1);
});
