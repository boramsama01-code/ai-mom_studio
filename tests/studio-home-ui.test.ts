// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { StudioPage } from "../client/src/pages/Studio";
import { StudioTextImport } from "../client/src/pages/StudioTextImport";

const mocks = vi.hoisted(() => ({ guard: { setDirty: vi.fn(), confirmLeave: (f: () => void) => f() }, toast: vi.fn(), navigate: vi.fn(), api: vi.fn(), clipboard: vi.fn() }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ allChannels: [{ id: 1, slug: "penguin", name: "내 채널", active: true, accentColor: "#285f6a" }, { id: 2, slug: "fryday", name: "감자 채널", active: true, accentColor: "#996633" }, { id: 3, slug: "archived", name: "보관 채널", active: false }], channels: [], select: vi.fn() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/api", async importOriginal => ({ ...await importOriginal<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement; let root: Root; let client: QueryClient; let cards: StudioCard[];
const draft = { script: "전체 원고 초안", caption: "캡션 초안", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `장면 ${i}`, dialogue: `대사 ${i}` })) };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.clipboard.mockResolvedValue(undefined) } });
  cards = [
    { title: "진행 작업", channel: "penguin", stage: "writing" }, { title: "완료 작업", channel: "penguin", stage: "done" },
    { title: "감자 작업", channel: "fryday", stage: "making" }, { title: "보관 작업", channel: "archived", stage: "idea" },
  ].map((c, i) => ({ ...studioContentSchema.parse(c), id: i + 1, version: 1, sourceItemId: null, createdAt: "2026-10-26T00:00:00Z", updatedAt: `2026-10-26T0${i}:00:00Z` }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: object }) => {
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
async function input(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("홈과 단계별 제작 화면", () => {
  it("갤러리에서 버리고 휴지통에서 원래 단계로 복원한다", async () => {
    await render(createElement(StudioPage));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="진행 작업 휴지통으로 이동"]')!.click()); await settle();
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("진행 작업");
    expect(mocks.toast).toHaveBeenCalledWith("ok", expect.stringContaining("휴지통"), expect.objectContaining({ label: "실행 취소" }));
    await click("휴지통");
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
  it("진행 작업만 먼저 보여주고 완료·보관·채널 필터와 보드 전환을 제공한다", async () => {
    await render(createElement(StudioPage));
    expect(host.querySelectorAll(".studio-content-card")).toHaveLength(2);
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("완료 작업");
    expect(host.querySelector(".studio-content-grid")?.textContent).not.toContain("보관 작업");
    await click("완료"); expect(host.querySelectorAll(".studio-content-card")).toHaveLength(1);
    expect(host.querySelector(".studio-content-grid")?.textContent).toContain("완료 작업");
    await click("단계 보드"); expect(host.querySelectorAll(".studio-column")).toHaveLength(5); expect(host.querySelectorAll(".studio-task")).toHaveLength(3);
    await click("갤러리"); await click("전체");
    const filter = host.querySelector('select[aria-label="채널 필터"]') as HTMLSelectElement;
    await act(async () => { filter.value = "fryday"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".studio-content-card")).toHaveLength(1); expect(host.querySelector(".studio-content-grid")?.textContent).toContain("감자 작업");
    await click("보관 채널"); expect(host.querySelector(".studio-content-grid")?.textContent).toContain("보관 작업");
    expect(button("새 콘텐츠 만들기").disabled).toBe(true);
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
  it("전체 페이지를 순서대로 보여 주고 원고 채널로 바로 이동한다", async () => {
    generated(); await render(createElement(StudioPage, { cardId: 1 }));
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/51");
    await click("다음 →"); expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/52");
    await act(async () => host.querySelector<HTMLButtonElement>('.card-carousel-thumbs button:last-child')!.click());
    expect(host.querySelector(".card-carousel-stage img")?.getAttribute("src")).toBe("/api/channels/2/media/55");
    expect(button("다음 →").disabled).toBe(true);
    await act(async () => [...host.querySelectorAll<HTMLAnchorElement>("a")].find(a => a.textContent === "원고·카드 수정 →")!.click());
    expect(mocks.navigate).toHaveBeenCalledWith("/items/2/20");
    await click("보드 제목·메모 편집"); expect(host.querySelector("#studio-title")).not.toBeNull();
  });
});
