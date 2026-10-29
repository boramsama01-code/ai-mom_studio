// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioPage } from "../client/src/pages/Studio";
import { EditPanel } from "../client/src/pages/ItemDetail";
import { studioContentSchema, type StudioCard, type StudioCardDetail } from "../shared/studio";
import { emptyPayload } from "../shared/payloads";
const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (f: () => void) => f() } }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ allChannels: [{ id: 1, slug: "penguin", name: "웹툰", active: true, accentColor: "#285f6a" }], channels: [], selected: "all", select: vi.fn() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => ["/studio/8", vi.fn()] }));
vi.mock("../client/src/pages/StudioExport", () => ({ StudioExport: () => null, StudioQuickExport: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, detail: StudioCardDetail;
let connected: boolean, failGeneration: boolean;
const date = "2026-10-29T00:00:00Z";
function filled(card: StudioCard): StudioCard {
  return { ...card, version: card.version + 1, script: card.script || "API가 작성한 전체 원고", caption: card.caption || "API가 작성한 캡션",
    panels: card.panels.map((p, i) => ({ ...p, scene: p.scene || `${i + 1}컷 장면`, dialogue: p.dialogue || `${i + 1}컷 대사` })) };
}
beforeEach(() => {
  vi.clearAllMocks(); connected = true; failGeneration = false;
  const card: StudioCard = { ...studioContentSchema.parse({ title: "테스트 웹툰", channel: "penguin", format: "웹툰" }), id: 8, version: 1, sourceItemId: null, createdAt: date, updatedAt: date };
  detail = { card, revisions: [], jobs: [] };
  mocks.api.mockImplementation(async (path: string, opts?: { method?: string; body?: any }) => {
    if (path === "/studio/cards") return { cards: [detail.card], notes: "", notesVersion: 1, ai: { defaultProvider: "openai", text: { openai: connected, gemini: false, anthropic: false }, image: false } };
    if (path === "/studio/cards/8") {
      if (opts?.method === "PATCH") { detail = { ...detail, card: { ...detail.card, ...opts.body, version: detail.card.version + 1 } }; return structuredClone(detail.card); }
      return structuredClone(detail);
    }
    if (path === "/studio/cards/8/generate") {
      if (failGeneration) throw new Error("API 테스트 실패: 기존 원고 유지");
      const job = { id: 77, status: "queued", lastError: null, result: null, createdAt: date, finishedAt: null };
      detail = { ...detail, jobs: [job] }; return { job, duplicate: false };
    }
    if (path === "/status") return { integrations: { aiProvider: "openai", openai: true, gemini: false, anthropic: false } };
    if (path === "/channels/1/items/9/generate") return { version: 2 };
    if (path === "/channels/1/items/9" && opts?.method === "PATCH") return { version: 2 };
    throw new Error(`Unexpected API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 25)); }); }
async function render(element: React.ReactNode) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const b = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text) && !b.closest("[hidden]")); if (!b) throw new Error(`Button not found: ${text}`); return b; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function input(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => { const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
function field(label: string) {
  const el = [...host.querySelectorAll("label")].find(el => el.textContent?.startsWith(label))?.querySelector("textarea, input");
  if (!el) throw new Error(`Field not found: ${label}`); return el as HTMLTextAreaElement | HTMLInputElement;
}
async function finishJob() {
  detail = { ...detail, card: filled(detail.card), jobs: [{ ...detail.jobs[0], status: "succeeded", finishedAt: date, result: { applied: true } }] };
  await act(async () => { await client.invalidateQueries({ queryKey: ["studio"] }); }); await settle();
}

describe("webtoon API-first generation", () => {
  it("shows API first and selected by default without making a paid call", async () => {
    await render(createElement(StudioPage, { cardId: 8 }));
    const buttons = host.querySelectorAll('[aria-label="초안 작성 방법"] button');
    expect(buttons[0].textContent).toBe("API 자동 작성"); expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="studio-api-writing"]')?.hasAttribute("hidden")).toBe(false);
    expect(mocks.api.mock.calls.some(([p]) => String(p).includes("generate"))).toBe(false);
    await click("ChatGPT로 초안 만들기"); await click("API 자동 작성");
    expect(mocks.api.mock.calls.some(([p]) => String(p).includes("generate"))).toBe(false);
  });
  it("refreshes script, four scenes, four dialogues and caption after job completion", async () => {
    await render(createElement(StudioPage, { cardId: 8 })); await click("빈칸 초안 채우기"); await finishJob();
    expect(field("전체 원고").value).toBe("API가 작성한 전체 원고");
    expect(field("게시용 캡션").value).toBe("API가 작성한 캡션");
    for (let i = 1; i <= 4; i++) {
      expect(host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${i}컷 장면"]`)!.value).toBe(`${i}컷 장면`);
      expect(host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${i}컷 대사"]`)!.value).toBe(`${i}컷 대사`);
    }
    expect(host.textContent).not.toContain("저장 전 변경사항");
  });
  it("saves typed changes before requesting generation and rejects double clicks", async () => {
    await render(createElement(StudioPage, { cardId: 8 }));
    await input(field("제목"), "직접 쓴 제목");
    await act(async () => { button("빈칸 초안 채우기").click(); button("빈칸 초안 채우기").click(); }); await settle();
    const writes = mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH" || o?.method === "POST");
    expect(writes.map(([p]) => p)).toEqual(["/studio/cards/8", "/studio/cards/8/generate"]);
    expect(writes[1][1].body).toMatchObject({ version: 2, kind: "text", textTarget: "fill", provider: "openai" });
    await finishJob(); expect(field("제목").value).toBe("직접 쓴 제목");
  });
  it("preserves edits made while generation is running", async () => {
    await render(createElement(StudioPage, { cardId: 8 })); await click("빈칸 초안 채우기");
    await input(field("전체 원고"), "생성 중 직접 고친 원고"); await finishJob();
    expect(field("전체 원고").value).toBe("생성 중 직접 고친 원고");
    expect(host.textContent).toContain("서버에 새 버전이 있습니다");
  });
  it("keeps fields and saved version intact on API failure", async () => {
    failGeneration = true; await render(createElement(StudioPage, { cardId: 8 })); await click("빈칸 초안 채우기");
    expect(field("전체 원고").value).toBe(""); expect(detail.card.version).toBe(1);
    expect(host.textContent).toContain("API 테스트 실패");
    expect(mocks.api.mock.calls.filter(([p]) => String(p).endsWith("/generate"))).toHaveLength(1);
  });
  it("shows missing-key guidance rather than silently switching mode or invoking an API", async () => {
    connected = false; await render(createElement(StudioPage, { cardId: 8 }));
    expect(button("빈칸 초안 채우기").disabled).toBe(true);
    expect(host.textContent).toContain("작성 AI의 키가 없습니다");
    expect(mocks.api.mock.calls.some(([p]) => String(p).includes("generate"))).toBe(false);
  });
});

function itemDetail(payload = emptyPayload("science_dialogue", "과학 주제"), version = 1): any {
  return { item: { id: 9, kind: "science_dialogue", title: "과학 주제", version }, primary: null,
    current: { id: version, revisionNo: version, payload, author: "llm", model: "test-model" }, linked: [], revisions: [], cards: [], approvals: [], deliveries: [], similar: [], defaultCaptions: null };
}
const science = { ...emptyPayload("science_dialogue", "과학 주제"), key_question: "근거를 어떻게 비교할까?", background: ["배경 하나", "배경 둘", "배경 셋"], discussion_questions: ["질문 하나?", "질문 둘?", "질문 셋?"], scientific_basis: "원문에 있는 과학적 근거", misconceptions: ["흔한 오해"], parent_hints: ["근거를 물어보세요"], safe_activity: "종이에 관찰을 기록하세요" };
describe("collected-item editor generation regression", () => {
  it("places API before ChatGPT and fills all fields when a new server revision arrives", async () => {
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 }));
    expect(host.querySelector("details summary")?.textContent).toContain("API 자동 작성");
    await click("GPT로 초안 생성");
    await render(createElement(EditPanel, { d: itemDetail(science, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe(science.key_question);
    expect(field("과학적 근거").value).toBe(science.scientific_basis);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="쉬운 배경 (3문장) 1"]')!.value).toBe(science.background[0]);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="대화 질문 (3개) 3"]')!.value).toBe(science.discussion_questions[2]);
    expect(button("새 버전으로 저장").disabled).toBe(true);
  });
  it("does not overwrite genuine user edits when a server revision arrives", async () => {
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 }));
    await input(field("핵심 질문"), "사용자가 직접 쓴 질문");
    await render(createElement(EditPanel, { d: itemDetail(science, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe("사용자가 직접 쓴 질문");
    expect(host.textContent).toContain("직접 입력한 내용은 유지했습니다");
  });
  it("adopts the saved baseline instead of leaving the save button permanently dirty", async () => {
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 }));
    await input(field("핵심 질문"), "저장할 질문"); await click("새 버전으로 저장");
    await render(createElement(EditPanel, { d: itemDetail({ ...emptyPayload("science_dialogue", "과학 주제"), key_question: "저장할 질문" }, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe("저장할 질문"); expect(button("새 버전으로 저장").disabled).toBe(true);
  });
});
