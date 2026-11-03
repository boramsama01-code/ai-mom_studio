// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPage, EditPanel } from "../client/src/pages/ItemDetail";
import { emptyPayload, payloadSchemaFor } from "../shared/payloads";
import { ApiError } from "../client/src/api";
import { DirtyGuardProvider } from "../client/src/state";
import { DirtyModal } from "../client/src/ui";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), blob: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
  guard: { setDirty: vi.fn(), confirmLeave: vi.fn((action: () => void) => action()) },
}));
const channel = { id: 2, slug: "highscoop", name: "하이스쿱", active: true, accentColor: "#285f6a" };
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", async original => ({ ...await original<object>(), useChannel: () => ({ selected: "all", allChannels: [channel], channels: [channel] }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/items/2/9", mocks.navigate], useSearch: () => "" }));
vi.mock("../client/src/pages/Design", () => ({ useTemplates: () => ({ data: { current: "builtin:classic", items: [] } }), TemplatePicker: () => null }));

vi.mock("../client/src/CategorySelect", () => ({ CategorySelect: () => null }));
vi.mock("../client/src/SourceTextEditor", () => ({ SourceTextEditor: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement, root: Root, client: QueryClient, detail: any;
const altValues = new Map<string, { version: number; values: string[] }>();
let readError: Error | null, sourceLoad: () => Promise<{ changed: boolean }>;
const itemPath = "/channels/2/items/9";
const itemKey = ["ch", 2, "item", 9];
const copy = { version: 1, templateKey: "builtin:classic", cover: { title: "직접 편집할 표지", subtitle: "확인한 부제" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `본문 ${i + 1}`, subtitle: "", body: `카드별 원고 ${i + 1}` })) };
function source(fetchStatus = "not_fetched", fetchedText: string | null = null, isSample = false) {
  return { id: 70, kind: "rss_direct", title: "선택한 원문", originalUrl: "https://example.com/article", meta: {}, fetchStatus, fetchedText, snippet: "목록에서 받은 짧은 요약", attachments: [], isSample, publishedAt: "2026-11-01T00:00:00Z", publishedPrecision: "day", publishedRaw: null, lastFetchedAt: null };
}
beforeEach(() => {
  vi.clearAllMocks(); altValues.clear(); readError = null; sourceLoad = async () => ({ changed: false });
  detail = {
    item: { id: 9, channelId: 2, title: "하나의 제작 공간", kind: "science_dialogue", origin: "manual", version: 1, currentRevisionId: 4, reviewStatus: "reviewed", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: {} },
    primary: null, linked: [], current: { id: 4, revisionNo: 1, author: "operator", payload: { title: "하나의 제작 공간" } }, revisions: [],
    cards: [{ id: 40, revisionId: 4, sha256: "fixture", createdAt: "2026-11-01T00:00:00Z", cloudinaryUrl: null }],
    publicationDraft: { version: 1, captions: { instagram: "확인할 게시 캡션", telegram: "" } },
    approvals: [], deliveries: [], similar: [], defaultCaptions: { instagram: "확인할 게시 캡션", telegram: "" },
    publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 3, expectedUsername: "highscoop.official", destinations: [{ id: 20, label: "@highscoop.official", platform: "instagram", configured: true }] },
  };
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:workspace-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.blob.mockResolvedValue(new Blob(["fixture-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (/^\/channels\/2\/media\/\d+\/alt-text$/.test(path)) {
      const key = path;
      if (options?.method === "PATCH") altValues.set(key, { version: options.body.version + 1, values: [...options.body.values] });
      return altValues.get(key) ?? { version: 1, values: ["원래 저장된 이미지 설명입니다."] };
    }
    if (path === "/status") return { integrations: { aiProvider: "gemini", gemini: true, openai: false, anthropic: false, flags: { dryRun: false, autoPublish: true } }, workerConnected: true, globalStop: false };
    if (path === "/studio/ai-status") return { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false } };
    if (path === "/canva/status") return { connected: false };
    if (path === `${itemPath}/publication-draft` && options?.method === "PATCH") {
      if (options.body.version !== detail.publicationDraft.version) throw new ApiError(409, "다른 곳에서 먼저 저장됨");
      detail.publicationDraft = { version: options.body.version + 1, captions: structuredClone(options.body.captions) };
      return structuredClone(detail.publicationDraft);
    }
    if (path === itemPath) { if (readError) throw readError; return structuredClone(detail); }
    if (path === `${itemPath}/card-copy`) return { version: 1, revisionId: 4, hasSavedCopy: true, copy: structuredClone(copy) };
    if (path === `${itemPath}/fetch` && options?.method === "POST") return sourceLoad();
    if (path === `${itemPath}/review` && options?.method === "POST") { detail.item.reviewStatus = options.body.status; return { ok: true }; }
    if (path === `${itemPath}/approve` && options?.method === "POST") return { ok: true, destinations: 1, timing: options.body.timing };
    throw new Error(`Unexpected API call: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(element: ReactNode = createElement(ItemDetailPage, { cid: 2, id: 9 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(DirtyGuardProvider, null, element, createElement(DirtyModal))))); await settle(); }
function button(text: string) { const node = [...host.querySelectorAll("button")].find(node => node.textContent === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function input(node: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }); await settle();
}
async function open(section: string) {
  const summary = [...host.querySelectorAll("summary")].find(node => node.textContent?.includes(section));
  if (!summary) throw new Error(`Missing section: ${section}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) await act(async () => summary.click());
  await settle();
}
async function refresh() { await act(async () => { await client.invalidateQueries({ queryKey: itemKey }); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
const fetches = () => mocks.api.mock.calls.filter(([path]) => path === `${itemPath}/fetch`);
function generationButton() { return [...host.querySelectorAll<HTMLButtonElement>("#edit-panel button")].find(node => node.textContent?.endsWith("로 초안 생성"))!; }
async function chooseTiming(text: "지금 게시" | "예약 게시") {
  const radio = [...host.querySelectorAll<HTMLLabelElement>(".publish-timing label")].find(node => node.textContent?.includes(text))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => radio.click()); await settle();
}
async function confirm() { const checkbox = host.querySelector<HTMLInputElement>(".publish-confirm input")!; expect(checkbox.disabled).toBe(false); if (!checkbox.checked) await act(async () => checkbox.click()); await settle(); }



describe("asset selection protects alternative text", () => {
 it("asks before changing candidates, stays after cancellation and saves before switching", async () => {
  detail.cards.push({...structuredClone(detail.cards[0]), id: 50});
  await render();
  await open("게시 준비");
  let alt = host.querySelector<HTMLTextAreaElement>('.alt-text-editor textarea')!;
  await input(alt, "아직 저장하지 않은 운영자 설명입니다.");
  expect(alt.value).toBe("아직 저장하지 않은 운영자 설명입니다.");
  const candidates = () => host.querySelectorAll<HTMLButtonElement>('[aria-label="승인할 카드 고르기"] button');
  await act(async () => candidates()[1].click()); await settle();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(candidates()[0].getAttribute("aria-pressed")).toBe("true");
  expect(alt.value).toBe("아직 저장하지 않은 운영자 설명입니다.");
  await click("머무르기");
  expect(host.querySelector('.alt-text-editor textarea')).toBe(alt);
  await act(async () => candidates()[1].click()); await settle();
  await click("저장하고 이동");
  expect(candidates()[1].getAttribute("aria-pressed")).toBe("true");
  await act(async () => candidates()[0].click()); await settle();
  alt = host.querySelector<HTMLTextAreaElement>('.alt-text-editor textarea')!;
  expect(alt.value).toBe("아직 저장하지 않은 운영자 설명입니다.");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][0]).toBe("/channels/2/media/40/alt-text");
 });
});
