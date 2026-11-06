// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioPage } from "../client/src/pages/Studio";
import { EditPanel } from "../client/src/pages/ItemDetail";
import { studioContentSchema, type StudioCard, type StudioCardDetail } from "../shared/studio";
import { emptyPayload } from "../shared/payloads";
import { ApiError } from "../client/src/api";
import { activateDraftRecoveryScope, readDraftRecovery } from "../client/src/draftRecovery";
const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (f: () => void) => f() } }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard, useChannel: () => ({ allChannels: [{ id: 1, slug: "penguin", name: "웹툰", active: true, accentColor: "#285f6a", effectiveAiSettings: {
  summary: { provider: "openai", model: "gpt-summary-fixture" }, copy: { provider: "openai", model: "gpt-copy-fixture" }, image: { provider: "openai", model: "gpt-image-fixture" },
} }], channels: [], selected: "all", select: vi.fn() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => ["/studio/8", vi.fn()], useSearch: () => window.location.search.slice(1) }));
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
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); connected = true; failGeneration = false;
  history.replaceState(null, "", "/studio/8");
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
    if (path === "/channels/1/templates") return { current: "set:n04", items: [{ key: "set:n04", name: "뉴스 브리핑", description: "뉴스", kind: "builtin", family: "news", pageCount: 5 }] };
    if (path === "/channels/1/items/9/generate") return { version: 2 };
    if (path === "/channels/1/items/9" && opts?.method === "PATCH") return { version: 2 };
    throw new Error(`Unexpected API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
// Detail loading mounts a second component which starts the settings query. Drain both
// query notifications and React effects, rather than assuming one fixed delay is enough.
async function settle() {
  for (let i = 0; i < 30; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    if (!client.isFetching() && !client.isMutating()) {
      await act(async () => { await new Promise(r => setTimeout(r, 10)); });
      if (!client.isFetching() && !client.isMutating()) return;
    }
  }
  throw new Error("Mock queries did not settle");
}
async function render(element: React.ReactNode) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(text: string) { const b = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text) && !b.closest("[hidden]")); if (!b) throw new Error(`Button not found: ${text}`); return b; }
async function click(text: string) { const b = button(text); expect(b.disabled, `${text} should be enabled`).toBe(false); await act(async () => b.click()); await settle(); }
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
  it("restores an interrupted Studio manuscript explicitly and removes the device copy after saving", async () => {
    const scope = "studio-recovery-test-session"; activateDraftRecoveryScope(scope); client.setQueryData(["me"], { user: "operator", recoveryScope: scope });
    await render(createElement(StudioPage, { cardId: 8 }));
    await input(field("전체 원고"), "브라우저 종료 전에 쓴 긴 원고\n마지막 문장🐧");
    await input(field("제목"), "");
    await render(null); await render(createElement(StudioPage, { cardId: 8 }));
    expect(field("전체 원고").value).toBe(""); expect(field("제목").disabled).toBe(true);
    expect(button("원고·컷 구성 자동 작성").disabled).toBe(true);
    await click("복구본을 편집기에 불러오기");
    expect(field("제목").value).toBe(""); expect(field("전체 원고").value).toBe("브라우저 종료 전에 쓴 긴 원고\n마지막 문장🐧");
    expect(mocks.api.mock.calls.filter(([, opts]) => opts?.method === "PATCH" || opts?.method === "POST")).toHaveLength(0);
    await input(field("제목"), "복구 후 확인한 제목"); await click("저장");
    expect(detail.card.script).toBe("브라우저 종료 전에 쓴 긴 원고\n마지막 문장🐧");
    expect(readDraftRecovery(scope, "studio:8:content", value => value as any)).toEqual({ ok: true, value: null });
  });
  it("shows API first and selected by default without making a paid call", async () => {
    await render(createElement(StudioPage, { cardId: 8 }));
    const buttons = host.querySelectorAll('#studio-story [aria-label="작업 방식"] .work-mode-options button');
    expect(buttons[0].textContent).toContain("자동"); expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="studio-api-writing"]')?.hasAttribute("hidden")).toBe(false);
    expect(mocks.api.mock.calls.some(([p]) => String(p).includes("generate"))).toBe(false);
    await click("수동"); await click("자동");
    expect(mocks.api.mock.calls.some(([p]) => String(p).includes("generate"))).toBe(false);
  });
  it("refreshes script, four scenes, four dialogues and caption after job completion", async () => {
    await render(createElement(StudioPage, { cardId: 8 })); await click("원고·컷 구성 자동 작성"); await finishJob();
    expect(field("전체 원고").value).toBe("API가 작성한 전체 원고");
    expect(field("게시용 캡션").value).toBe("API가 작성한 캡션");
    for (let i = 1; i <= 4; i++) {
      expect(host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${i}컷 장면"]`)!.value).toBe(`${i}컷 장면`);
      expect(host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${i}컷 대사"]`)!.value).toBe(`${i}컷 대사`);
    }
    expect(host.textContent).not.toContain("저장 전 변경사항");
  });
  it("saves typed changes before requesting generation and rejects double clicks", async () => {
    await render(createElement(StudioPage, { cardId: 8 })); await input(field("제목"), "직접 쓴 제목");
    await act(async () => { button("원고·컷 구성 자동 작성").click(); button("원고·컷 구성 자동 작성").click(); }); await settle();
    const writes = mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH" || o?.method === "POST");
    expect(writes.map(([p]) => p)).toEqual(["/studio/cards/8", "/studio/cards/8/generate"]);
    expect(writes[1][1].body).toMatchObject({ version: 2, kind: "text", textTarget: "fill" });
    expect(writes[1][1].body).not.toHaveProperty("provider"); // The server applies the channel's copy role.
    await finishJob(); expect(field("제목").value).toBe("직접 쓴 제목");
  });
  it("preserves edits made while generation is running", async () => {
    await render(createElement(StudioPage, { cardId: 8 })); await click("원고·컷 구성 자동 작성");
    await input(field("전체 원고"), "생성 중 직접 고친 원고"); await finishJob();
    expect(field("전체 원고").value).toBe("생성 중 직접 고친 원고"); expect(host.textContent).toContain("서버에 새 버전이 있습니다");
  });
  it("keeps fields and saved version intact on API failure", async () => {
    failGeneration = true; await render(createElement(StudioPage, { cardId: 8 })); await click("원고·컷 구성 자동 작성");
    expect(field("전체 원고").value).toBe(""); expect(detail.card.version).toBe(1);
    expect(host.textContent, host.innerHTML).toContain("API 테스트 실패");
    expect(host.querySelector<HTMLDetailsElement>("details.studio-work-status")?.open).toBe(true);
    expect(mocks.api.mock.calls.filter(([p]) => String(p).endsWith("/generate"))).toHaveLength(1);
  });
  it("shows missing-key guidance rather than silently switching mode or invoking an API", async () => {
    connected = false; await render(createElement(StudioPage, { cardId: 8 }));
    expect(button("원고·컷 구성 자동 작성").disabled).toBe(true);
    expect(host.textContent, host.innerHTML).toContain("GPT 연결이 필요합니다");
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
    expect(host.querySelector("details summary")?.textContent).toContain("자동 제작 · 원고와 카드 이미지"); await click("GPT로 초안 생성");
    expect(mocks.api).toHaveBeenCalledWith("/channels/1/items/9/generate", { method: "POST", body: { version: 1, templateKey: "set:n04", requestId: expect.any(String) } });
    await render(createElement(EditPanel, { d: itemDetail(science, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe(science.key_question); expect(field("과학적 근거").value).toBe(science.scientific_basis);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="쉬운 배경 (3문장) 1"]')!.value).toBe(science.background[0]);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="대화 질문 (3개) 3"]')!.value).toBe(science.discussion_questions[2]);
    expect(button("새 버전으로 저장").disabled).toBe(true);
  });
  it("does not overwrite genuine user edits when a server revision arrives", async () => {
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 })); await input(field("핵심 질문"), "사용자가 직접 쓴 질문");
    await render(createElement(EditPanel, { d: itemDetail(science, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe("사용자가 직접 쓴 질문"); expect(host.textContent).toContain("직접 입력한 내용은 유지했습니다");
  });
  it("adopts the saved baseline instead of leaving the save button permanently dirty", async () => {
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 }));
    await input(field("핵심 질문"), "저장할 질문"); await click("새 버전으로 저장");
    await render(createElement(EditPanel, { d: itemDetail({ ...emptyPayload("science_dialogue", "과학 주제"), key_question: "저장할 질문" }, 2), cid: 1 }));
    expect(field("핵심 질문").value).toBe("저장할 질문"); expect(button("새 버전으로 저장").disabled).toBe(true);
  });
  it("restores an unresolved request after reopening and looks up the original intent while preserving manual changes", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    const bodies: any[] = [];
    mocks.api.mockImplementation(async (path, opts) => {
      if (path === "/channels/1/items/9/generate") {
        bodies.push(structuredClone(opts.body));
        if (bodies.length === 1) throw new ApiError(0, "응답을 받지 못했습니다.");
        throw new ApiError(409, "기존 AI 작업이 실행 중입니다.", { jobId: 11, jobStatus: "running" });
      }
      return fallback(path, opts);
    });
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 })); await click("GPT로 초안 생성");
    expect(bodies).toHaveLength(1); expect(sessionStorage.length).toBe(1);
    await render(null); await render(createElement(EditPanel, { d: itemDetail(science, 2), cid: 1 }));
    await input(field("핵심 질문"), "기다리는 동안 직접 작성한 질문");
    await click("기존 AI 작업 결과 확인");
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect(bodies[1].version).toBe(1);
    expect(field("핵심 질문").value).toBe("기다리는 동안 직접 작성한 질문");
    expect(host.textContent).toContain("기존 AI 작업이 실행 중입니다.");
    expect(mocks.api.mock.calls.filter(([, opts]) => opts?.method === "PATCH")).toHaveLength(0);
  });
  it("uses a new request ID for an explicit retry after the server reports terminal AI failure", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    const ids: string[] = [];
    mocks.api.mockImplementation(async (path, opts) => {
      if (path === "/channels/1/items/9/generate") {
        ids.push(opts.body.requestId);
        if (ids.length === 1) throw new ApiError(503, "일시적으로 AI를 사용할 수 없습니다.", { jobId: 12, jobStatus: "failed" });
      }
      return fallback(path, opts);
    });
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 })); await click("GPT로 초안 생성");
    expect(ids).toHaveLength(1); expect(sessionStorage.length).toBe(0);
    await click("GPT로 초안 생성"); expect(ids).toHaveLength(2); expect(ids[1]).not.toBe(ids[0]);
  });
  it("cancels a running source AI job by request ID and preserves edits when its response arrives late", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    let requestId = "";
    mocks.api.mockImplementation(async (path, opts) => {
      if (path === "/channels/1/items/9/generate") {
        requestId = opts.body.requestId;
        return new Promise(resolve => { finish = resolve; });
      }
      if (path === "/channels/1/items/9/generation-cancel") {
        expect(opts.body).toEqual({ requestId }); return { cancelled: true, jobId: 13 };
      }
      return fallback(path, opts);
    });
    await render(createElement(EditPanel, { d: itemDetail(), cid: 1 }));
    await act(async () => button("GPT로 초안 생성").click());
    await input(field("핵심 질문"), "작업 중 직접 작성한 질문");
    await act(async () => button("AI 요청 중단").click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(host.textContent).toContain("AI 요청을 중단했습니다.");
    expect(button("새 버전으로 저장").disabled).toBe(false);
    await act(async () => finish({ version: 2, jobId: 13 })); await settle();
    expect(field("핵심 질문").value).toBe("작업 중 직접 작성한 질문");
    expect(host.textContent).not.toContain("새 버전을 만들었습니다.");
    await click("새 버전으로 저장");
    const writes = mocks.api.mock.calls.filter(([path, opts]) => path === "/channels/1/items/9" && opts?.method === "PATCH");
    expect(writes).toHaveLength(1); expect(writes[0][1].body.payload.key_question).toBe("작업 중 직접 작성한 질문");
  });
});
