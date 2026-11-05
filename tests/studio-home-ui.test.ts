// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { StudioPage } from "../client/src/pages/Studio";
import { StudioTextImport } from "../client/src/pages/StudioTextImport";
import { GlobalChannelSelect } from "../client/src/GlobalChannelSelect";

const mocks = vi.hoisted(() => ({ guard: { setDirty: vi.fn(), confirmLeave: vi.fn((f: () => void) => f()) }, selected: "all" as "all" | number, select: vi.fn(), toast: vi.fn(), navigate: vi.fn(), api: vi.fn(), blob: vi.fn(), clipboard: vi.fn() }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => {
  const allChannels = [{ id: 1, slug: "penguin", name: "내 채널", active: true, accentColor: "#285f6a" }, { id: 2, slug: "fryday", name: "감자 채널", active: true, accentColor: "#996633" }, { id: 3, slug: "archived", name: "보관 채널", active: false }];
  return { allChannels, channels: allChannels.filter(c => c.active), current: allChannels.find(c => c.id === mocks.selected) ?? null, selected: mocks.selected, isLoading: false, select: mocks.select };
} }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/api", async importOriginal => ({ ...await importOriginal<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate], useSearch: () => "" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement; let root: Root; let client: QueryClient; let cards: StudioCard[];
const draft = { script: "전체 원고 초안", caption: "캡션 초안", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `장면 ${i}`, dialogue: `대사 ${i}` })) };

beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, "", "/");
  mocks.selected = "all"; mocks.select.mockImplementation(value => { mocks.selected = value; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.clipboard.mockResolvedValue(undefined) } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:studio-card-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  cards = [
    { title: "진행 작업", channel: "penguin", stage: "writing" }, { title: "완료 작업", channel: "penguin", stage: "done" },
    { title: "감자 작업", channel: "fryday", stage: "making" }, { title: "보관 작업", channel: "archived", stage: "idea" },
  ].map((c, i) => ({ ...studioContentSchema.parse(c), id: i + 1, version: 1, sourceItemId: null, createdAt: "2026-10-26T00:00:00Z", updatedAt: `2026-10-26T0${i}:00:00Z` }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: object }) => {
    if (path === "/studio/cards" && options?.method === "POST") {
      const card = { ...studioContentSchema.parse(options.body), id: cards.length + 1, version: 1, sourceItemId: null, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" };
      cards.push(card); return card;
    }
    if (path === "/studio/cards" || path === "/studio/cards?trash=1") return { cards: cards.filter(c => !!c.trashedAt === path.includes("trash=1")), trashCount: cards.filter(c => c.trashedAt).length, notes: "", notesVersion: 1, ai: { defaultProvider: "openai", text: { openai: false, anthropic: false }, image: false } };
    const trashMatch = path.match(/^\/studio\/cards\/(\d+)\/(trash|untrash)$/);
    if (trashMatch) {
      const i = cards.findIndex(c => c.id === Number(trashMatch[1]));
      cards[i] = { ...cards[i], version: cards[i].version + 1, trashedAt: trashMatch[2] === "trash" ? "2026-11-01T00:00:00Z" : null };
      return { card: cards[i], cancelledJobs: 0, cancelledDeliveries: 0, alreadyProcessing: 0 };
    }
    if (path === "/studio/cards/1") {
      if (options?.method === "PATCH") { cards[0] = { ...cards[0], ...options.body, version: cards[0].version + 1 }; return cards[0]; }
      return { card: cards[0], revisions: [], jobs: [] };
    }
    if (path === "/studio/export-check") return { errors: [{ field: "panels.2.dialogue", message: "3번째 본문에 글이나 그림을 추가하세요." }], warnings: [], pageCount: 6 };
    if (path === "/status") return { integrations: { aiProvider: "gemini", gemini: false, flags: { dryRun: false, autoPublish: true } }, workerConnected: true };
    if (path === "/canva/status") return { connected: false };
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: false, openai: false, anthropic: false } };
    if (path === "/channels/2/templates") return { current: "set:n04", items: [{ key: "set:n04", name: "뉴스 브리핑", kind: "builtin" }] };
    if (path === "/channels/2/items/20/card-copy") return { version: 1, revisionId: 5, hasSavedCopy: true, copy: { version: 1, templateKey: "set:n04", cover: { title: "카드에서 고칠 제목", subtitle: "확인한 원문" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 ${i + 1}`, subtitle: "", body: `본문 문구 ${i + 1}` })) } };
    if (path === "/channels/2/media/51/alt-text") return { version: 1, values: Array.from({ length: 5 }, (_, i) => `설명 ${i + 1}`) };
    if (path === "/channels/2/items/20") return {
      item: { id: 20, channelId: 2, title: "수집 원문 제목", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 5, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {} },
      current: { id: 5, revisionNo: 1, payload: { title: "수집 원문 제목" } }, primary: null, linked: [], revisions: [], approvals: [], deliveries: [], similar: [],
      cards: [{ id: 51, revisionId: 5, templateKey: "set:n04", carousel: { version: 1, cover: { kind: "typography", credit: "저장한 표지" }, pages: cards[0].sourceOutput?.pages } }],
      defaultCaptions: { instagram: "원고 캡션", telegram: "" }, publicationReadiness: { ready: true, blockers: [], destinations: [], dryRun: false, autoPublish: true },
    };
    throw new Error(`Unexpected API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: React.ReactNode) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text) && !b.closest("[hidden]"))!; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function openDetails(text: string) {
  const summary = [...host.querySelectorAll("summary")].find(node => node.textContent?.includes(text));
  if (!summary) throw new Error(`Missing details: ${text}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) await act(async () => summary.click());
  await settle();
}
async function input(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("홈과 단계별 제작 화면", () => {
  it("갤러리에서 버리고 휴지통에서 원래 단계로 복원한다", async () => {
    await render(createElement(StudioPage));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="진행 작업 휴지통으로 이동"]')!.click()); await settle();
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("진행 작업");
    expect(mocks.toast).toHaveBeenCalledWith("ok", expect.stringContaining("휴지통"), expect.objectContaining({ label: "실행 취소" }));
    await openDetails("가져오기·관리"); await click("휴지통");
    expect(host.querySelector(".studio-trash-list")?.textContent).toContain("진행 작업");
    await click("복원");
    expect(host.querySelector(".studio-trash-view")?.textContent).toContain("휴지통이 비어 있어요");
    await click("내 콘텐츠");
    expect(host.querySelector(".studio-content-grid")?.textContent).toContain("진행 작업");
    expect(cards[0].stage).toBe("writing");
  });
  it("휴지통 이동 알림에서 실행 취소하면 보드에 즉시 돌아온다", async () => {
    await render(createElement(StudioPage));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="진행 작업 휴지통으로 이동"]')!.click()); await settle();
    const undo = mocks.toast.mock.calls.find(c => c[2]?.label === "실행 취소")![2];
    await act(async () => undo.onClick()); await settle();
    expect(host.querySelector(".studio-content-grid")?.textContent).toContain("진행 작업");
    expect(cards[0].trashedAt).toBeNull();
  });
  it("편집 중 입력을 저장해 버리고 휴지통 콘텐츠의 직접 주소는 읽기 전용으로 연다", async () => {
    await render(createElement(StudioPage, { cardId: 1 }));
    await input(host.querySelector("#studio-title") as HTMLInputElement, "마지막으로 입력한 제목");
    await click("휴지통");
    expect(cards[0].title).toBe("마지막으로 입력한 제목"); expect(cards[0].trashedAt).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(host.querySelector(".studio-trashed-detail")?.textContent).toContain("휴지통에 있는 콘텐츠예요");
    expect(host.querySelector("#studio-title")).toBeNull();
    await click("복원");
    expect((host.querySelector("#studio-title") as HTMLInputElement).value).toBe("마지막으로 입력한 제목");
  });
  it("진행 작업만 먼저 보여주고 전역 채널 선택에 맞춰 완료·보관·보드 보기를 제공한다", async () => {
    const boardWithScope = () => createElement(Fragment, null, createElement(GlobalChannelSelect), createElement(StudioPage));
    await render(boardWithScope());
    expect(host.querySelectorAll(".studio-content-card")).toHaveLength(2);
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("완료 작업");
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("보관 작업");
    await click("완료"); expect(host.querySelectorAll(".studio-content-card")).toHaveLength(1);
    expect(host.querySelector(".studio-content-grid")?.textContent).toContain("완료 작업");
    await click("단계 보드"); expect(host.querySelectorAll(".studio-column")).toHaveLength(5); expect(host.querySelectorAll(".studio-task")).toHaveLength(3);
    await click("갤러리"); await click("전체");
    expect(host.querySelector('select[aria-label="채널 필터"]')).toBeNull();
    const filter = host.querySelector('select[aria-label="보기 채널"]') as HTMLSelectElement;
    await act(async () => { filter.value = "2"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    await render(boardWithScope());
    expect(host.querySelectorAll(".studio-content-card")).toHaveLength(1); expect(host.querySelector(".studio-content-grid")?.textContent).toContain("감자 작업");
    await click("보관 채널"); expect(host.querySelector(".studio-content-grid")?.textContent).toContain("보관 작업");
    expect(button("새 콘텐츠 자동 제작").disabled).toBe(true);
  });
  it("전체 조회의 새 콘텐츠는 작성폼에서 채널을 고른 뒤 그 채널에만 저장한다", async () => {
    await render(createElement(StudioPage));
    expect(host.querySelector<HTMLDetailsElement>(".studio-tools-menu")?.open).toBe(false);
    expect([...host.querySelectorAll<HTMLButtonElement>(".studio-home-actions > button")].map(node => node.textContent)).toEqual(["새 콘텐츠 자동 제작"]);
    await click("새 콘텐츠 자동 제작");
    const channel = host.querySelector('select[aria-label="제작 채널"]') as HTMLSelectElement;
    expect(channel.value).toBe("");
    expect(channel.required).toBe(true);
    expect(host.querySelectorAll("dialog")).toHaveLength(1);
    expect(host.querySelector('dialog .work-mode-options button')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('dialog .studio-start-options')).toBeNull();
    expect(host.querySelector('select[aria-label="제작 형식"]')).not.toBeNull();
    expect(host.querySelector<HTMLDetailsElement>('dialog .studio-more')?.open).toBe(false);
    await input(host.querySelector(".studio-create-form input") as HTMLInputElement, "새 감자 이야기");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    expect(button("자동 제작 편집기 열기").disabled).toBe(true);
    await act(async () => { channel.value = "fryday"; channel.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("자동 제작 편집기 열기");
    expect(mocks.api).toHaveBeenCalledWith("/studio/cards", expect.objectContaining({ method: "POST", body: expect.objectContaining({ channel: "fryday", title: "새 감자 이야기" }) }));
    expect(mocks.selected).toBe("all");
    expect(mocks.navigate).toHaveBeenCalledWith("/studio/5");
  });
  it("자동 기본에서 수동 선택을 펼쳤다가 돌아와도 제목·채널·형식을 유지한다", async () => {
    mocks.selected = 2;
    await render(createElement(StudioPage)); await click("새 콘텐츠 자동 제작");
    const title = host.querySelector<HTMLInputElement>(".studio-create-form input")!;
    await input(title, "자동과 수동을 오가며 다듬은 제목");
    const format = host.querySelector<HTMLSelectElement>('select[aria-label="제작 형식"]')!;
    await act(async () => { format.value = "웹툰"; format.dispatchEvent(new Event("change", { bubbles: true })); });
    const modeButtons = () => host.querySelectorAll<HTMLButtonElement>('dialog .work-mode-options button');
    await act(async () => modeButtons()[1].click());
    expect(host.querySelector('dialog [aria-label="수동 제작 방식"]')?.textContent).toContain("직접 원고 작성");
    const importChoice = [...host.querySelectorAll<HTMLButtonElement>('dialog .studio-start-options button')].find(node => node.textContent?.includes("완성 이미지 가져오기"))!;
    await act(async () => importChoice.click());
    expect(host.querySelector<HTMLInputElement>(".studio-create-form input")!.value).toBe(title.value);
    await act(async () => modeButtons()[0].click());
    expect(host.querySelector('dialog [aria-label="수동 제작 방식"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>(".studio-create-form input")!.value).toBe("자동과 수동을 오가며 다듬은 제목");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="제작 형식"]')!.value).toBe("웹툰");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="제작 채널"]')!.value).toBe("fryday");
    await click("자동 제작 편집기 열기");
    expect(cards.at(-1)).toMatchObject({ title: "자동과 수동을 오가며 다듬은 제목", format: "웹툰", finishedDeck: null });
    expect(mocks.navigate).toHaveBeenCalledWith("/studio/5");
    expect(mocks.api.mock.calls.some(([path]) => String(path).includes("generate"))).toBe(false);
  });
  it.each([false, true])("명시적 수동 URL을 따르되 자동으로 돌아온 선택도 다음 편집기에 전달한다 (자동 복귀=%s)", async returnToAuto => {
    history.replaceState(null, "", "/?start=free&channel=fryday&mode=manual");
    await render(createElement(StudioPage));
    const choices = () => host.querySelectorAll<HTMLButtonElement>('dialog .work-mode-options button');
    expect(choices()[1].getAttribute("aria-pressed")).toBe("true");
    await input(host.querySelector<HTMLInputElement>(".studio-create-form input")!, "입력한 제목을 유지");
    if (returnToAuto) await act(async () => choices()[0].click());
    await click(returnToAuto ? "자동 제작 편집기 열기" : "직접 작성 편집기 열기");
    expect(mocks.navigate).toHaveBeenCalledWith(`/studio/5${returnToAuto ? "" : "?mode=manual"}`);
    expect(cards.at(-1)).toMatchObject({ title: "입력한 제목을 유지", channel: "fryday", finishedDeck: null });
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST").map(([path]) => path)).toEqual(["/studio/cards"]);
  });
  it("자동 제작 링크는 폼을 바로 열고 완성 이미지 가져오기는 명시적인 수동 편집기로 이어진다", async () => {
    history.replaceState(null, "", "/?start=free&channel=penguin");
    await render(createElement(StudioPage));
    expect(host.querySelector('dialog .work-mode-options button')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="제작 채널"]')!.value).toBe("penguin");
    expect(host.querySelector<HTMLInputElement>('dialog input')!.value).toBe("");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('dialog button[aria-label="닫기"]')!.click());
    mocks.selected = 2; await render(createElement(StudioPage));
    await openDetails("가져오기·관리"); await click("완성 이미지 가져오기");
    expect(host.querySelectorAll('dialog .work-mode-options button')[1].getAttribute("aria-pressed")).toBe("true");
    await input(host.querySelector<HTMLInputElement>(".studio-create-form input")!, "외부에서 만든 카드 묶음");
    await click("이미지 가져오기 편집기 열기");
    expect(cards.at(-1)).toMatchObject({ title: "외부에서 만든 카드 묶음", finishedDeck: { pages: [] } });
    expect(mocks.navigate).toHaveBeenCalledWith("/studio/5?mode=manual");
    expect(mocks.api.mock.calls.some(([path]) => String(path).includes("generate"))).toBe(false);
  });
  it("선택한 채널은 새 작업의 기본값이며 기존 카드를 다른 채널로 바꾸지 않는다", async () => {
    mocks.selected = 2;
    await render(createElement(StudioPage)); await click("새 콘텐츠 자동 제작");
    expect((host.querySelector('select[aria-label="제작 채널"]') as HTMLSelectElement).value).toBe("fryday");
    await act(async () => host.querySelector<HTMLButtonElement>('dialog button[aria-label="닫기"]')!.click());
    await render(createElement(StudioPage, { cardId: 1 }));
    expect(host.querySelector(".studio-detail .studio-channel-tag")?.textContent).toBe("내 채널");
    expect(cards[0].channel).toBe("penguin");
    expect(mocks.api.mock.calls.some(([, opts]) => opts?.method === "PATCH")).toBe(false);
  });
  it("직접 작성 링크의 채널은 그 작업에만 적용하고 이후 새 작업에는 현재 선택을 쓴다", async () => {
    history.replaceState(null, "", "/?start=experience&channel=penguin");
    await render(createElement(StudioPage));
    expect((host.querySelector('select[aria-label="제작 채널"]') as HTMLSelectElement).value).toBe("penguin");
    await act(async () => host.querySelector<HTMLButtonElement>('dialog button[aria-label="닫기"]')!.click());
    mocks.selected = 2;
    await render(createElement(StudioPage)); await click("새 콘텐츠 자동 제작");
    expect((host.querySelector('select[aria-label="제작 채널"]') as HTMLSelectElement).value).toBe("fryday");
  });
  it("단계를 옮겨도 원고 입력을 유지하고 오류 필드를 올바른 컷에서 연다", async () => {
    await render(createElement(StudioPage, { cardId: 1 }));
    expect(host.querySelector("#studio-composition")?.hasAttribute("hidden")).toBe(true);
    const title = host.querySelector("#studio-title") as HTMLInputElement;
    await input(title, "직접 수정한 제목");
    await act(async () => host.querySelector<HTMLButtonElement>('.studio-editor-steps button:nth-child(2)')!.click());
    expect(host.querySelector("#studio-story")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelectorAll(".studio-comic-panel:not([hidden])")).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('.studio-editor-steps button:nth-child(3)')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); }); await settle(); await click("3번째 본문에 글이나 그림을 추가");
    expect(host.querySelectorAll(".studio-comic-panel:not([hidden])")[0]?.textContent).toContain("3컷");
    expect(title.value).toBe("직접 수정한 제목");
    expect(mocks.api.mock.calls.some(([path]) => String(path).includes("generate"))).toBe(false);
  });
  it("캐릭터 설정을 접어 두고 명시적으로 연 포즈를 해당 컷에만 저장한다", async () => {
    cards[0] = { ...cards[0], characters: ["pengpeng"] };
    await render(createElement(StudioPage, { cardId: 1 }));
    const registered = host.querySelector('[data-testid="studio-registered-characters"]')!;
    expect(registered).not.toBeNull();
    expect(registered.closest("[hidden]")).toBeNull();
    expect(registered.closest("details")?.open).toBe(false);
    await openDetails("캐릭터·포즈 설정");
    for (const name of ["펭펭", "펨펨", "김펭긴", "김펭키"]) expect(registered.textContent).toContain(name);
    expect(registered.querySelectorAll("img").length).toBeGreaterThanOrEqual(4);
    expect(host.querySelectorAll(".studio-pose-tile")).toHaveLength(0);
    await input(host.querySelector("#studio-title") as HTMLInputElement, "포즈를 고른 웹툰");
    await click("포즈 고르기");
    expect(host.querySelector("#studio-composition")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelectorAll(".studio-pose-picker")).toHaveLength(1);
    expect(host.querySelector(".studio-pose-picker")?.closest("details")?.open).toBe(true);
    expect(host.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    await act(async () => host.querySelector<HTMLButtonElement>('.studio-pose-tile:nth-child(41)')!.click());
    await click("이 컷에 적용");
    await click("목록 접기");
    await click("포즈 고르기");
    expect(host.querySelectorAll(".studio-pose-tile")).toHaveLength(100);
    expect(host.querySelector(".studio-pose-selection a")?.getAttribute("href")).toBe("/api/studio/characters/pengpeng/poses/41?version=final-v1.4");
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.studio-panel-selector button')[1]!.click());
    expect(host.querySelectorAll(".studio-pose-picker")).toHaveLength(1);
    expect(host.querySelectorAll(".studio-pose-selection")).toHaveLength(0);
    await act(async () => host.querySelector<HTMLButtonElement>('.page-head button.btn.primary')!.click()); await settle();
    expect(cards[0].title).toBe("포즈를 고른 웹툰");
    expect(cards[0].panels[0].poseRefs).toEqual([{ character: "pengpeng", pose: 41, assetVersion: "final-v1.4" }]);
    expect(cards[0].panels.slice(1).every(panel => !panel.poseRefs?.length)).toBe(true);
    expect(mocks.api.mock.calls.some(([path]) => /publish|generate|deliver/.test(String(path)))).toBe(false);
  });
  it("완성 단계에서도 등록 그림과 선택한 캐릭터를 유지한다", async () => {
    cards[0] = { ...cards[0], stage: "done", characters: ["pempem"] };
    await render(createElement(StudioPage, { cardId: 1 }));
    const registered = host.querySelector('[data-testid="studio-registered-characters"]')!;
    expect(registered.closest("[hidden]")).toBeNull();
    expect(registered.closest("details")?.open).toBe(false);
    await openDetails("캐릭터·포즈 설정");
    expect(registered.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    expect(host.querySelectorAll(".studio-pose-tile")).toHaveLength(0);
    await click("포즈 고르기");
    expect(host.querySelector(".studio-pose-character-tabs")?.textContent).toContain("펨펨");
    expect(host.querySelector(".studio-pose-tile img")?.getAttribute("src")).toBe("/api/studio/characters/pempem/poses/1?version=final-v1.4");
    expect(cards[0].stage).toBe("done");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  });
  it("붙여넣기만으로는 반영하지 않으며 검토 후 빈칸에만 적용한다", async () => {
    const apply = vi.fn(); const original = { ...cards[0], script: "이미 쓴 원고" };
    await render(createElement(StudioTextImport, { content: original, channelName: "내 채널", disabled: false, apply }));
    await click("초안 프롬프트 복사"); expect(mocks.clipboard).toHaveBeenCalledWith(expect.stringContaining("이미 쓴 원고"));
    const reply = host.querySelector(".studio-text-answer textarea") as HTMLTextAreaElement;
    await input(reply, "잘못된 답변"); await click("답변 확인");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("답변 형식"); expect(apply).not.toHaveBeenCalled();
    await input(reply, JSON.stringify(draft)); await click("답변 확인");
    expect(host.querySelector(".studio-text-review")?.textContent).not.toContain("전체 원고 초안"); expect(apply).not.toHaveBeenCalled();
    const guard = mocks.guard.setDirty.mock.calls.filter(c => c[1] === true).at(-1); expect(await guard?.[2]()).toBe(false);
    await click("검토한 초안을 빈칸에 반영");
    expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0][0].script).toBe("이미 쓴 원고"); expect(apply.mock.calls[0][0].caption).toBe("캡션 초안");
    expect(reply.value).toBe(""); expect(mocks.api).not.toHaveBeenCalled();
  });
  it("제작 완료는 현재 원고와 버전을 저장하며 게시 요청을 보내지 않는다", async () => {
    await render(createElement(StudioPage, { cardId: 1 }));
    await input(host.querySelector("#studio-title") as HTMLInputElement, "완성한 제목");
    await act(async () => host.querySelector<HTMLButtonElement>('.studio-editor-steps button:nth-child(3)')!.click());
    await click("저장하고 제작 완료");
    expect(mocks.api).toHaveBeenCalledWith("/studio/cards/1", expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ title: "완성한 제목", stage: "done", version: 1 }) }));
    expect(cards[0].version).toBe(2); expect(cards[0].stage).toBe("done");
    expect(mocks.api.mock.calls.some(([path]) => /publish|generate|deliver/.test(String(path)))).toBe(false);
  });
});


describe("수집 카드뉴스 보드 연결", () => {
  function generated() {
    cards[0] = { ...cards[0], format: "카드뉴스", sourceItemId: 20, sourceOutput: { assetId: 51, channelId: 2, itemId: 20, revisionId: 5, stale: false, pages: Array.from({ length: 5 }, (_, i) => ({ id: 51 + i, title: `페이지 ${i + 1}` })), coverCredit: "표지: AI 생성 · OpenAI" } };
  }
  it("갤러리에 실제 표지와 전체 페이지 수를 표시한다", async () => {
    generated(); await render(createElement(StudioPage));
    expect(host.querySelector('img[src="/api/channels/2/media/51"]')).not.toBeNull();
    expect(host.textContent).toContain("카드뉴스 · 5장"); expect(host.textContent).toContain("5장 ZIP 저장");
  });
  it("같은 제작 화면에서 카드 전체와 작업 메모를 편집하며 다른 편집기로 왕복하지 않는다", async () => {
    generated(); await render(createElement(StudioPage, { cardId: 1 }));
    await settle(); await settle();
    expect(host.querySelectorAll(".content-workspace")).toHaveLength(1);
    expect(host.querySelectorAll(".card-copy-editor")).toHaveLength(1);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(mocks.api).toHaveBeenCalledWith("/channels/2/items/20");
    const editor = host.querySelector(".card-copy-editor");
    const title = host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!;
    await input(title, "아직 저장하지 않은 카드 제목");
    await openDetails("게시 준비");
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/51");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".card-carousel button")].find(node => node.textContent === "다음 →")!.click());
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/52");
    await act(async () => host.querySelector<HTMLButtonElement>('.card-carousel-thumbs button:last-child')!.click());
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/55");
    expect([...host.querySelectorAll<HTMLButtonElement>(".card-carousel button")].find(node => node.textContent === "다음 →")?.disabled).toBe(true);
    expect(host.querySelector<HTMLDetailsElement>(".source-board-notes")?.open).toBe(false);
    await openDetails("작업 메모");
    await input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="작업 메모"]')!, "다음 검토에 참고할 메모");
    await click("메모 저장");
    expect(mocks.api).toHaveBeenCalledWith("/studio/cards/1", { method: "PATCH", body: { version: 1, memo: "다음 검토에 참고할 메모" } });
    expect(cards[0].memo).toBe("다음 검토에 참고할 메모");
    expect(host.querySelector(".card-copy-editor")).toBe(editor);
    expect(title.value).toBe("아직 저장하지 않은 카드 제목");
    expect(host.querySelector("#studio-title")).toBeNull();
    expect(host.textContent).not.toContain("보드 제목·메모 편집");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.some(([path]) => /generate|approve|publication|deliver/.test(String(path)))).toBe(false);
  });
});
