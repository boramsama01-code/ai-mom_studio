// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunsPage } from "../client/src/pages/Runs";
import { ApiError } from "../client/src/api";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", channels: [] }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
let jobs: Array<{ id: number; type: string; status: string; attempts: number; channelId: number; lastError: string | null; createdAt: string }>;
beforeEach(() => {
  vi.clearAllMocks();
  jobs = ["source_generate", "card_copy_generate", "studio_generate", "publish", "collect"].map((type, i) => ({ id: i + 1, type, status: type === "collect" ? "queued" : "running", attempts: 1, channelId: 1, lastError: null, createdAt: "2026-11-03T00:00:00Z" }));
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith("/runs?")) return { runs: [], workers: [] };
    if (path.startsWith("/jobs?")) return structuredClone(jobs);
    if (/^\/jobs\/\d+\/cancel$/.test(path)) {
      const id = Number(path.split("/")[2]); jobs = jobs.map(job => job.id === id ? { ...job, status: "cancelled" } : job); return { cancelled: true };
    }
    throw new Error(`Unexpected fixture API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render() { await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RunsPage)))); await settle(); }
function row(label: string) { const node = [...host.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes(label)); if (!node) throw new Error(`Missing row: ${label}`); return node; }

it("offers cancellation for queued jobs and running AI jobs, but not an already transmitting publication", async () => {
  await render();
  expect(row("원문 초안 AI 작성").querySelector("button")?.textContent).toBe("AI 작업 중단");
  expect(row("카드 문구 AI 제안").querySelector("button")?.textContent).toBe("AI 작업 중단");
  expect(row("콘텐츠 AI 작성").querySelector("button")?.textContent).toBe("AI 작업 중단");
  expect(row("게시").querySelector("button")).toBeNull();
  expect(row("자료 수집").querySelector("button")?.textContent).toBe("취소");
  await act(async () => row("원문 초안 AI 작성").querySelector<HTMLButtonElement>("button")!.click()); await settle();
  expect(mocks.api).toHaveBeenCalledWith("/jobs/1/cancel", { method: "POST", body: {} });
  expect(row("원문 초안 AI 작성").querySelector("button")).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => /generate|publish/.test(path))).toBe(false);
});

it("keeps the running job visible and explains a failed cancellation", async () => {
  const fallback = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path, options) => {
    if (path === "/jobs/1/cancel") throw new ApiError(409, "작업이 이미 완료되어 중단할 수 없습니다.");
    return fallback(path, options);
  });
  await render();
  await act(async () => row("원문 초안 AI 작성").querySelector<HTMLButtonElement>("button")!.click()); await settle();
  expect(host.textContent).toContain("작업이 이미 완료되어 중단할 수 없습니다.");
  expect(row("원문 초안 AI 작성").querySelector("button")?.textContent).toBe("AI 작업 중단");
});
