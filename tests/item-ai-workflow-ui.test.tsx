// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditPanel, ItemDetailPage } from "../client/src/pages/ItemDetail";
import { emptyPayload } from "../shared/payloads";
import { aiProviderLabels } from "../shared/aiProviders";
import { activateDraftRecoveryScope } from "../client/src/draftRecovery";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), blob: vi.fn(), toast: vi.fn(), navigate: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: vi.fn((action: () => void) => action()) },
}));
const channel = {
  id: 2, slug: "highscoop", name: "하이스쿱", active: true, accentColor: "#285f6a",
  effectiveAiSettings: {
    summary: { provider: "gemini", model: "gemini-summary-fixture" },
    copy: { provider: "openai", model: "gpt-copy-fixture" },
    image: { provider: "openai", model: "gpt-image-fixture" },
  },
  aiDefaultModels: { gemini: "gemini-default-fixture", openai: "gpt-default-fixture", anthropic: "claude-default-fixture", image: "gpt-image-default-fixture" },
};
const anotherChannel = { ...channel, id: 3, slug: "custom-news", name: "다른 채널", effectiveAiSettings: { ...channel.effectiveAiSettings, summary: { provider: "anthropic", model: "claude-summary-fixture" } } };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: 3, allChannels: [channel, anotherChannel], channels: [channel, anotherChannel] }), useDirtyGuard: () => mocks.guard }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => "" }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "builtin:classic", items: [] } }), TemplatePicker: () => null }));
vi.mock("../client/src/CardCarousel", () => ({ CardCarousel: () => null }));
vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const itemPath = "/channels/2/items/9";
const itemKey = ["ch", 2, "item", 9];
const copy = () => ({ version: 1, templateKey: "builtin:classic", cover: { title: "확인할 카드 제목", subtitle: "원문에 있는 설명" }, pages: Array.from({ length: 4 }, (_, index) => ({ id: `body-${index + 1}`, title: `페이지 ${index + 1}`, subtitle: "", body: "격리된 테스트 카드 문구입니다." })) });
const source = (id = 70) => ({ id, kind: "rss_direct", title: `원문 자료 ${id}`, originalUrl: `https://example.com/source-${id}`, meta: {}, fetchStatus: "ok", fetchedText: "연구자는 기술의 영향을 전망했다. 실제 결과는 아직 확인되지 않았다.", snippet: "목록 요약", attachments: [], isSample: true, publishedAt: null, publishedPrecision: "unknown", publishedRaw: null, lastFetchedAt: null });
const warning = "기사 요약은 저장했습니다. 카드 문구는 완성하지 못했습니다: GPT 일시 과부하. 카드 편집에서 문구만 다시 제안받을 수 있습니다.";
const workflow = (warnings: string[] = []) => ({ version: 1, summary: { provider: "gemini", model: "gemini-summary-fixture" }, copy: warnings.length ? null : { provider: "openai", model: "gpt-copy-fixture" }, warnings });
let host: HTMLDivElement, root: Root, client: QueryClient, detail: any;
let generate: (body: any) => Promise<any>;

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear();
  activateDraftRecoveryScope("isolated-item-ai-workflow-session");
  detail = {
    imageAiAvailable: true,
    item: { id: 9, channelId: 2, title: "기사에서 시작한 콘텐츠", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 4, reviewStatus: "pending", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {} },
    primary: source(), linked: [], current: { id: 4, revisionNo: 1, author: "operator", payload: { ...emptyPayload("science_dialogue", "기존 요약"), cardCopy: copy() } }, revisions: [], cards: [],
    publicationDraft: { version: 1, captions: { instagram: "저장된 캡션", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } },
    approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "저장된 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 3, destinations: [{ id: 20, label: "@isolated.fixture", platform: "instagram", configured: true }] },
  };
  generate = async () => {
    detail.item = { ...detail.item, version: detail.item.version + 1, currentRevisionId: 5 };
    detail.current = { id: 5, revisionNo: 2, author: "llm", model: "gemini-summary-fixture", payload: { ...emptyPayload("science_dialogue", "저장된 새 요약"), cardCopy: copy(), aiWorkflow: workflow() } };
    return structuredClone(detail.item);
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:item-ai-fixture") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  mocks.blob.mockResolvedValue(new Blob(["fixture-image"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/status") return { integrations: { aiProvider: "anthropic", gemini: true, openai: true, anthropic: true, flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
    if (path === "/studio/ai-status") return { defaultProvider: "anthropic", text: { gemini: true, openai: true, anthropic: true }, image: true };
    if (path === "/canva/status") return { connected: false };
    if (path === itemPath) return structuredClone(detail);
    if (path === `${itemPath}/generate`) return generate(options?.body);
    if (path === `${itemPath}/card-copy`) {
      if (options?.method === "PATCH") {
        detail.item.version++; detail.current.id++; detail.current.revisionNo++;
        detail.item.currentRevisionId = detail.current.id;
        detail.current.payload.cardCopy = structuredClone(options.body.copy);
        if (detail.current.payload.aiWorkflow) detail.current.payload.aiWorkflow.warnings = [];
      }
      return { version: detail.item.version, revisionId: detail.current?.id ?? 0, hasSavedCopy: !!detail.current?.payload.cardCopy, copy: structuredClone(detail.current?.payload.cardCopy ?? copy()) };
    }
    throw new Error(`Unexpected isolated API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["me"], { user: "operator", recoveryScope: "isolated-item-ai-workflow-session" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode = createElement(ItemDetailPage, { cid: 2, id: 9 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); await settle(); }
function button(label: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label); if (!node) throw new Error(`Missing button: ${label}`); return node; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).click()); await settle(); }
function summaryProvider() { return host.querySelector<HTMLSelectElement>('[aria-label="기사 요약 AI"]')!; }
async function selectProvider(provider: string) { await act(async () => { summaryProvider().value = provider; summaryProvider().dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
async function input(node: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
const generateRequests = () => writes().filter(([path]) => path === `${itemPath}/generate`);

describe("source workspace role models and partial generation recovery", () => {
  it("uses the content channel's summary role and shows independent models, ignoring the globally selected writer and channel", async () => {
    await render();
    expect(summaryProvider().value).toBe("gemini");
    const roleModels = host.querySelector('[data-testid="source-role-models"]')!;
    expect(roleModels.textContent).toContain("gemini-summary-fixture");
    expect(roleModels.textContent).toContain("gpt-copy-fixture");
    expect(roleModels.textContent).toContain("gpt-image-fixture");
    expect(roleModels.querySelector<HTMLAnchorElement>('a[href="/settings"]')).not.toBeNull();
    expect(writes()).toHaveLength(0);
    await click(`${aiProviderLabels.gemini}로 초안 생성`);
    expect(generateRequests()).toHaveLength(1);
    expect(generateRequests()[0][1].body).not.toHaveProperty("provider");
    expect(generateRequests()[0][1].body).toMatchObject({ version: 1, templateKey: "builtin:classic", requestId: expect.any(String) });
  });

  it("keeps an explicit summary override temporary and does not borrow another provider's saved model", async () => {
    await render(); await selectProvider("openai");
    const modelText = host.querySelector('[data-testid="source-role-models"]')!.textContent;
    expect(modelText).toContain("gpt-default-fixture");
    expect(modelText).not.toContain("gemini-summary-fixture");
    expect(modelText).toContain("gpt-copy-fixture");
    await click(`${aiProviderLabels.openai}로 초안 생성`);
    expect(generateRequests()[0][1].body.provider).toBe("openai");
    await click("채널 기본 AI로 되돌리기");
    expect(summaryProvider().value).toBe("gemini");
    await click(`${aiProviderLabels.gemini}로 초안 생성`);
    expect(generateRequests()[1][1].body).not.toHaveProperty("provider");
    expect(writes().every(([path]) => path === `${itemPath}/generate`)).toBe(true);
  });

  it("does not carry a temporary override into another channel when an editor is reused", async () => {
    await render(createElement(EditPanel, { d: detail, cid: 2 }));
    await selectProvider("openai");
    await render(createElement(EditPanel, { d: { ...detail, item: { ...detail.item, channelId: 3 } }, cid: 3 }));
    expect(summaryProvider().value).toBe("anthropic");
    expect(host.querySelector('[data-testid="source-role-models"]')!.textContent).toContain("claude-summary-fixture");
    expect(writes()).toHaveLength(0);
  });

  it("preserves a completed summary and stops before image or approval calls when copy generation fails", async () => {
    detail.current = null; detail.item.currentRevisionId = null;
    generate = async () => {
      detail.item = { ...detail.item, version: 2, currentRevisionId: 5 };
      detail.current = { id: 5, revisionNo: 1, author: "llm", payload: { ...emptyPayload("science_dialogue", "실패해도 보존할 요약"), aiWorkflow: workflow([warning]) } };
      return { ...structuredClone(detail.item), generationWarnings: [warning] };
    };
    await render(); await click("원고·이미지 자동 만들기");
    expect(writes().map(([path]) => path)).toEqual([`${itemPath}/generate`]);
    expect(host.querySelector('[data-testid="source-generation-warnings"]')?.textContent).toContain(warning);
    expect(host.textContent).toContain("요약을 다시 생성할 필요는 없습니다");
    expect(host.textContent).not.toContain("새 버전을 만들었습니다. 생성 성공");
    expect(detail.current.payload.topic).toBe("실패해도 보존할 요약");
    expect(button("내용 확인 · 검토 완료").disabled).toBe(true);
    expect(button("승인하고 지금 게시").disabled).toBe(true);
    await input(host.querySelector<HTMLTextAreaElement>('.card-copy-editor textarea[id$="-title"]')!, "실패 후 직접 완성한 카드 제목");
    await click("문구 저장");
    expect(detail.current.payload.cardCopy.cover.title).toBe("실패 후 직접 완성한 카드 제목");
    expect(detail.current.payload.topic).toBe("실패해도 보존할 요약");
    expect(host.querySelector('[data-testid="source-generation-warnings"]')).toBeNull();
    expect(button("내용 확인 · 검토 완료").disabled).toBe(false);
    expect(writes().map(([path]) => path)).toEqual([`${itemPath}/generate`, `${itemPath}/card-copy`]);
  });

  it("shows saved workflow warnings on reopening without silently retrying paid work", async () => {
    delete detail.current.payload.cardCopy;
    detail.current.payload.aiWorkflow = workflow([warning]);
    await render();
    expect(host.querySelector('[data-testid="source-generation-warnings"]')?.textContent).toContain(warning);
    expect(host.querySelector("#edit-panel form")).not.toBeNull();
    expect(button("내용 확인 · 검토 완료").disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it("checks saved workflow warnings before automatic rendering even if an older API response omits warnings", async () => {
    detail.current = null; detail.item.currentRevisionId = null;
    generate = async () => {
      detail.item = { ...detail.item, version: 2, currentRevisionId: 5 };
      detail.current = { id: 5, revisionNo: 1, author: "llm", payload: { ...emptyPayload("science_dialogue", "저장된 부분 결과"), aiWorkflow: workflow([warning]) } };
      return structuredClone(detail.item);
    };
    await render(); await click("원고·이미지 자동 만들기");
    expect(writes().map(([path]) => path)).toEqual([`${itemPath}/generate`]);
    expect(host.querySelector('[data-testid="source-generation-warnings"]')?.textContent).toContain(warning);
  });
});

describe("source claim and evidence inspection", () => {
  it("shows claim type, attribution, quotes, source links and limitations inside existing source details", async () => {
    detail.linked = [{ link: { role: "supporting" }, doc: { ...source(71), meta: { finalUrl: "javascript:alert('fixture')" } } }];
    detail.current.payload.articleAnalysis = {
      version: 1, articleType: "interview", centralEvent: "연구자가 인터뷰에서 기술의 영향을 전망했다.",
      claims: [
        { id: "claim-1", kind: "reported_fact", statement: "연구자가 인터뷰했다.", speaker: null, source_id: 70, quote: "연구자는 기술의 영향을 전망했다." },
        { id: "claim-2", kind: "attributed_claim", statement: "연구자는 기술이 도울 수 있다고 말했다.", speaker: "인터뷰 연구자", source_id: 70, quote: "기술의 영향을 전망했다." },
        { id: "claim-3", kind: "forecast", statement: "향후 도움이 될 수 있다는 전망이다.", speaker: "인터뷰 연구자", source_id: 71, quote: "실제 결과는 아직 확인되지 않았다." },
        { id: "claim-4", kind: "interpretation", statement: "효과에 대한 해석은 아직 열려 있다.", speaker: "기사 작성자", source_id: 99, quote: "아직 확인되지 않았다." },
      ],
      limitations: ["인터뷰의 전망이며 실험으로 확인된 결과가 아니다."],
      keyConcepts: [{ term: "전망", meaning: "현재 근거로 추측한 미래의 가능성" }],
    };
    await render();
    const analysis = host.querySelector<HTMLDetailsElement>('[data-testid="article-analysis"]')!;
    expect(analysis.open).toBe(false);
    expect(analysis.textContent).toContain("기사 유형: 인터뷰");
    for (const label of ["기사에서 확인한 사실", "발언·주장", "전망·예측", "해석"]) expect(analysis.textContent).toContain(label);
    expect(analysis.textContent).toContain("발언자: 인터뷰 연구자");
    expect(analysis.textContent).toContain("인터뷰의 전망이며 실험으로 확인된 결과가 아니다.");
    expect(analysis.textContent).toContain("현재 근거로 추측한 미래의 가능성");
    expect(analysis.querySelector('a[href="https://example.com/source-70"]')).not.toBeNull();
    expect(analysis.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(analysis.textContent).toContain("자료 #99 · 연결된 원문 확인 필요");
    expect(analysis.querySelectorAll("blockquote")).toHaveLength(4);
    expect(writes()).toHaveLength(0);
  });

  it("keeps legacy or malformed analysis payloads from crashing normal editing", async () => {
    detail.current.payload.articleAnalysis = { version: 1, claims: "legacy field" };
    detail.current.payload.aiWorkflow = { version: 1, warnings: { bad: true } };
    await render();
    expect(host.querySelector('[data-testid="article-analysis"]')).toBeNull();
    expect(host.querySelector(".card-copy-editor")).not.toBeNull();
    expect(host.querySelector("#edit-panel form")).not.toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
