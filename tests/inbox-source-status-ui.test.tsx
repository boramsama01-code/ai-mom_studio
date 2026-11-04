// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxPage, ItemList, type ListRow } from "../client/src/pages/Inbox";

const mocks = vi.hoisted(() => ({ api: vi.fn(), search: "", ideaChannel: false }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("wouter", async orig => ({ ...await orig<object>(), useLocation: () => ["/inbox", vi.fn()], useSearch: () => mocks.search }));
vi.mock("../client/src/state", () => ({
  useChannel: () => {
    const ch = mocks.ideaChannel
      ? { id: 5, slug: "fryday", name: "fryday", contentType: "manual", active: true }
      : { id: 1, slug: "ai-mom", name: "AI 맘", contentType: "news", active: true };
    return { current: ch, selected: ch.id, channels: [ch], allChannels: [ch], select: vi.fn() };
  },
  useDirtyGuard: () => ({ confirmLeave: (fn: () => void) => fn() }),
}));
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("../client/src/pages/InboxKeywords", () => ({ InboxKeywords: () => <div data-testid="keyword-settings">키워드 관리</div> }));
vi.mock("../client/src/collection", () => ({ CollectionPanel: () => <div data-testid="collection-status">수집 현황</div>, useKstToday: () => "2026-11-04" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let client: QueryClient;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.search = "";
  mocks.ideaChannel = false;
  mocks.api.mockReset().mockResolvedValue({ total: 0, items: [], page: 1, pageSize: 20 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});

async function renderInbox() {
  await act(async () => { root.render(<QueryClientProvider client={client}><InboxPage /></QueryClientProvider>); });
  await settle();
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}

function latestQuery() {
  const calls = mocks.api.mock.calls.filter(([url]) => String(url).includes("/items?"));
  return new URL(calls[calls.length - 1][0], "https://example.test").searchParams;
}

async function chooseBodyStatus(value: string) {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="본문 상태"]')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

it("자동 수집과 검색은 바로 보이고 키워드 관리는 기본 접힘 영역에 모인다", async () => {
  await renderInbox();
  const details = host.querySelector<HTMLDetailsElement>("details.inbox-collection-options")!;
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain("수집 현황·설정");
  expect(host.querySelector('[data-testid="collection-status"]')?.closest("details")).toBeNull();
  expect(host.querySelector('.work-mode-options button[aria-pressed="true"] strong')?.textContent).toBe("자동");
  expect(details.querySelector('[data-testid="keyword-settings"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="본문 상태"]')?.closest("details")).toBeNull();
  expect(host.textContent).toContain("본문 미조회는 오류가 아닌 조회 전 상태입니다.");
});

it("본문 확보·미조회·확인 필요를 정확한 서버 필터로 전달하고 전체 선택은 필터를 해제한다", async () => {
  await renderInbox();
  expect(latestQuery().has("fetchStatus")).toBe(false);
  for (const value of ["ok", "not_fetched", "failed,blocked,unsupported"]) {
    await chooseBodyStatus(value);
    expect(latestQuery().get("fetchStatus")).toBe(value);
    expect(latestQuery().get("page")).toBe("1");
  }
  expect(host.textContent).toContain("본문 확인 필요");
  expect(host.textContent).toContain("본문 상태");
  await chooseBodyStatus("");
  expect(latestQuery().has("fetchStatus")).toBe(false);
  expect(mocks.api.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it("본문 상태가 지정된 링크는 아이디어 채널에서도 수집 자료를 열고 아이디어 전환 시 본문 필터를 보내지 않는다", async () => {
  mocks.ideaChannel = true;
  mocks.search = "fetchStatus=not_fetched";
  await renderInbox();
  expect(latestQuery().get("origin")).toBe("scrap");
  expect(latestQuery().get("fetchStatus")).toBe("not_fetched");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="본문 상태"]')?.value).toBe("not_fetched");
  const ideasButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim().startsWith("아이디어"))!;
  expect(ideasButton).toBeDefined();
  await act(async () => ideasButton.click());
  await settle();
  expect(latestQuery().get("origin")).toBe("idea");
  expect(latestQuery().has("fetchStatus")).toBe(false);
  expect(host.querySelector('[aria-label="본문 상태"]')).toBeNull();
});

it("자료 목록은 미조회·실패·제한을 서로 구별하고 RSS 요약을 수집 요약으로 표시한다", async () => {
  const statuses = ["ok", "not_fetched", "failed", "blocked", "unsupported"];
  const rows: ListRow[] = statuses.map((fetchStatus, index) => ({
    item: { id: index + 1, channelId: 1, title: `본문 상태 ${index + 1}`, origin: "scrap", kind: "news", edited: null, discovery: null, createdAt: new Date("2026-11-04T00:00:00Z"), reviewStatus: "pending", evidenceStatus: "needs_review", relevance: "uncertain", publishStatus: "waiting", isSample: false, excluded: false } as ListRow["item"],
    source: { id: index + 1, kind: "rss_direct", url: `https://example.test/${index}`, publisher: "출처", publishedAt: null, publishedPrecision: null, fetchStatus, snippet: "피드에서 수집한 짧은 설명" },
    channelSlug: "ai-mom", channelName: "AI 맘",
  }));
  await act(async () => root.render(<ItemList rows={rows} showChannel={false} />));
  const badges = [...host.querySelectorAll(".list-item")].map(item => item.querySelector(".badge")!);
  expect(badges.map(badge => badge.textContent)).toEqual(["본문 확보", "본문 미조회", "본문 조회 실패", "자동 조회 제한", "본문 직접 확인"]);
  expect(badges[1].classList.contains("err")).toBe(false);
  expect(badges[1].getAttribute("title")).toContain("아직 본문 조회를 시도하지 않았습니다");
  expect(badges[2].classList.contains("err")).toBe(true);
  expect(host.querySelector(".snippet")?.textContent).toBe("수집 요약: 피드에서 수집한 짧은 설명");
});
