// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPage } from "../client/src/pages/Inbox";
import { PublishPage } from "../client/src/pages/Publish";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), navigate: vi.fn(), move: vi.fn(),
  selected: 1 as number | "all", search: "", path: "/inbox", today: "2026-11-06", echoUrl: false,
  searchListeners: new Set<() => void>(),
}));
const channels = [
  { id: 1, slug: "opportunities", name: "활동 채널", contentType: "notice", active: true, categories: ["과학"], accentColor: "#285f6a" },
  { id: 2, slug: "current-dialogue", name: "대화 채널", contentType: "current_dialogue", active: true, categories: ["대화"], accentColor: "#285f6a" },
];
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", async original => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...await original<object>(), useLocation: () => [mocks.path, mocks.navigate],
    useSearch: () => useSyncExternalStore(listener => { mocks.searchListeners.add(listener); return () => mocks.searchListeners.delete(listener); }, () => mocks.search),
  };
});
vi.mock("../client/src/state", () => ({
  useChannel: () => ({ selected: mocks.selected, current: channels.find(channel => channel.id === mocks.selected) ?? null, channels, allChannels: channels, select: vi.fn() }),
  useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }),
}));
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("../client/src/collection", () => ({ CollectionPanel: () => null, useKstToday: () => mocks.today }));
vi.mock("../client/src/pages/InboxKeywords", () => ({ InboxKeywords: () => null }));
vi.mock("../client/src/publicationStatus", async original => ({
  ...await original<object>(),
  PublicationRuntimeNotice: () => null,
  usePublicationRuntime: () => ({ data: { globalStop: false, workerConnected: true, integrations: { flags: { dryRun: true, autoPublish: false } } }, isFetching: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../client/src/DeliveryActions", () => ({ DeliveryActions: () => null }));
vi.mock("../client/src/PublicationListActions", () => ({ PublicationListActions: () => null, usePublicationOrganization: () => ({ pending: false, error: null, move: mocks.move }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
let user = "editor-a";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.selected = 1; mocks.search = ""; mocks.path = "/inbox"; mocks.today = "2026-11-06"; mocks.echoUrl = false; mocks.searchListeners.clear(); user = "editor-a";
  mocks.navigate.mockImplementation((href: string) => {
    if (mocks.echoUrl && href.startsWith("/inbox")) {
      const url = new URL(href, "https://fixture.test"); mocks.path = url.pathname; mocks.search = url.search.slice(1);
      mocks.searchListeners.forEach(listener => listener());
    }
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("scrollTo", vi.fn((options: ScrollToOptions | number, y?: number) => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: typeof options === "number" ? y ?? 0 : options.top ?? 0 });
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  client.setQueryDefaults(["me"], { gcTime: Infinity });
  client.setQueryData(["me"], { user, recoveryScope: "scope-" + user });
  mocks.api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method && options.method !== "GET") throw new Error("List return must never make a mutation");
    const url = new URL(path, "https://fixture.test"), page = Number(url.searchParams.get("page") || 1), channelId = Number(url.searchParams.get("channelId") || 1);
    if (url.pathname === "/items") return {
      total: 80, page, pageSize: 20,
      items: [{ item: { id: channelId * 100 + page, channelId, title: `자료 ${channelId}-${page}`, origin: "scrap", kind: "notice", edited: null, discovery: null, createdAt: "2026-11-06T00:00:00Z", reviewStatus: "pending", evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false }, source: null, channelSlug: channels.find(channel => channel.id === channelId)?.slug, channelName: `채널 ${channelId}` }],
    };
    if (url.pathname === "/deliveries") return {
      total: 90, page, pageSize: 30,
      items: [{
        d: { id: channelId * 100 + page, approvalId: 11, status: "failed", listState: url.searchParams.get("view") || "active", listVersion: 1, needsReconciliation: false, lastError: null, completedAt: null, externalUrl: null },
        dest: { label: "검증 계정", platform: "instagram" },
        ap: { id: 11, revisionId: 7, status: "active", scheduledAt: `${url.searchParams.get("from") || "2026-11-06"}T03:00:00+09:00` },
        item: { id: channelId * 100 + page, channelId, title: `발행 ${channelId}-${page}` },
      }],
    };
    if (url.pathname === "/publication-orphans") return { total: 0, page: 1, pageSize: 30, items: [] };
    throw new Error("Unexpected list API: " + path);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove();
  vi.unstubAllGlobals(); sessionStorage.clear();
});

async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
async function render(screen: "inbox" | "publish") {
  mocks.path = screen === "inbox" ? "/inbox" : "/publish";
  await act(async () => root.render(<QueryClientProvider client={client}>{screen === "inbox" ? <InboxPage key={user} /> : <PublishPage key={user} />}</QueryClientProvider>));
  await settle();
}
async function leaveViaContent() {
  const link = host.querySelector<HTMLAnchorElement>("a.title, a.cal-ev")!;
  expect(link).not.toBeNull();
  await act(async () => link.click());
  expect(mocks.navigate).toHaveBeenLastCalledWith(link.getAttribute("href"));
  await act(async () => root.render(<QueryClientProvider client={client}><div>콘텐츠 상세</div></QueryClientProvider>));
  await settle();
}
function button(text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text);
  if (!result) throw new Error("Missing button: " + text);
  return result;
}
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    if (control instanceof HTMLInputElement && control.type === "date") control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
function field(label: string) {
  const group = [...host.querySelectorAll<HTMLLabelElement>("label")].find(node => node.textContent?.trim().startsWith(label));
  if (!group) throw new Error("Missing field: " + label);
  return group.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
}
const inboxInput = () => host.querySelector<HTMLInputElement>(".inbox-search-panel input")!;
async function search(text: string) {
  await change(inboxInput(), text);
  await act(async () => host.querySelector<HTMLFormElement>("form[role=search]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}
function latestQuery(pathname: string) {
  const requests = mocks.api.mock.calls.filter(([path]) => new URL(String(path), "https://fixture.test").pathname === pathname);
  return new URL(requests.at(-1)![0], "https://fixture.test").searchParams;
}
async function scrollTo(top: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: top });
  await act(async () => window.dispatchEvent(new Event("scroll"))); await settle();
}
async function manualMode() {
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".work-mode-options button")].find(node => node.querySelector("strong")?.textContent === "수동")!.click());
  await settle();
}
async function extraFilters() {
  const details = host.querySelector<HTMLDetailsElement>("details.filters")!;
  if (!details.open) await act(async () => details.querySelector("summary")!.click());
}
const checked = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(input => input.checked);

describe("목록에서 콘텐츠를 열고 돌아오기", () => {
  it("수집함·발행함의 선택 레이블은 정확히 한 번 선택하고 콘텐츠 이동이나 변경 요청을 실행하지 않는다", async () => {
    await render("inbox");
    const inboxRow = host.querySelector<HTMLInputElement>('[aria-label="자료 1-1 선택"]')!;
    const inboxLabel = inboxRow.closest("label")!;
    expect(inboxLabel.classList.contains("inbox-row-select")).toBe(true);
    mocks.navigate.mockClear();
    await act(async () => inboxLabel.click()); await settle();
    expect(inboxRow.checked).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();
    await click("선택 해제");
    await act(async () => host.querySelector<HTMLLabelElement>(".inbox-select-all")!.click()); await settle();
    expect(inboxRow.checked).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();

    await render("publish");
    const publicationRow = host.querySelector<HTMLInputElement>('[aria-label="발행 1-1 발행 기록 선택"]')!;
    mocks.navigate.mockClear();
    await act(async () => publicationRow.closest("label")!.click()); await settle();
    expect(publicationRow.checked).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLLabelElement>(".publication-select-all")!.click()); await settle();
    expect(publicationRow.checked).toBe(false);
    await act(async () => host.querySelector<HTMLLabelElement>(".publication-select-all")!.click()); await settle();
    expect(publicationRow.checked).toBe(true); expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });

  it("수집함의 제출한 검색·아직 제출하지 않은 입력·필터·페이지와 스크롤을 복원하되 일괄 작업 선택은 복원하지 않는다", async () => {
    await render("inbox");
    await search("과학 캠프");
    await change(host.querySelector<HTMLSelectElement>('[aria-label="본문 상태"]')!, "not_fetched");
    await change(host.querySelector<HTMLInputElement>('[aria-label="수집일 선택"]')!, "2026-10-30");
    await extraFilters();
    await change(field("검토 상태"), "held");
    await manualMode(); await click("다음");
    await change(inboxInput(), "아직 검색하지 않은 문구");
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="자료 1-2 선택"]')!.click());
    expect(checked()).toBe(true);
    await scrollTo(640); await leaveViaContent();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await render("inbox");
    const query = latestQuery("/items");
    expect(query.get("q")).toBe("과학 캠프"); expect(query.get("fetchStatus")).toBe("not_fetched");
    expect(query.get("review")).toBe("held"); expect(query.get("collectedOn")).toBe("2026-10-30"); expect(query.get("page")).toBe("2");
    expect(inboxInput().value).toBe("아직 검색하지 않은 문구");
    expect(host.querySelector('.work-mode-options button[aria-pressed="true"] strong')?.textContent).toBe("수동");
    expect(window.scrollY).toBe(640); expect(checked()).toBe(false);
  });

  it("수집함 조회는 채널과 로그인 사용자별로 독립적이며 다른 채널의 페이지와 검색을 덮어쓰지 않는다", async () => {
    await render("inbox"); await search("첫 채널"); await click("다음"); await scrollTo(360);
    mocks.selected = 2; await render("inbox");
    expect(inboxInput().value).toBe(""); expect(latestQuery("/items").get("page")).toBe("1");
    expect(window.scrollY).toBe(0);
    await search("둘째 채널"); await scrollTo(180);
    mocks.selected = 1; await render("inbox");
    expect(inboxInput().value).toBe("첫 채널"); expect(latestQuery("/items").get("page")).toBe("2");
    expect(window.scrollY).toBe(360);
    user = "editor-b"; client.setQueryData(["me"], { user, recoveryScope: "scope-" + user }); await render("inbox");
    expect(inboxInput().value).toBe(""); expect(window.scrollY).toBe(0);
    await search("다른 사용자");
    user = "editor-a"; client.setQueryData(["me"], { user, recoveryScope: "scope-" + user }); await render("inbox");
    expect(inboxInput().value).toBe("첫 채널"); expect(latestQuery("/items").get("page")).toBe("2");
    expect(window.scrollY).toBe(360);
  });

  it("브라우저 주소에 반영된 검색 조건으로 돌아와도 미제출 입력과 채널별 조회가 URL 반향에 덮이지 않는다", async () => {
    mocks.echoUrl = true;
    await render("inbox"); await search("첫 채널 적용 검색"); await click("다음");
    await change(inboxInput(), "첫 채널 아직 제출하지 않은 입력");
    expect(new URLSearchParams(mocks.search).get("q")).toBe("첫 채널 적용 검색");
    await leaveViaContent(); await render("inbox");
    expect(inboxInput().value).toBe("첫 채널 아직 제출하지 않은 입력");
    expect(latestQuery("/items").get("q")).toBe("첫 채널 적용 검색"); expect(latestQuery("/items").get("page")).toBe("2");
    mocks.selected = 2; await render("inbox");
    expect(new URLSearchParams(mocks.search).has("q")).toBe(false); expect(latestQuery("/items").get("channelId")).toBe("2");
    expect(inboxInput().value).toBe("");
    await search("둘째 채널 적용 검색"); await change(inboxInput(), "둘째 채널 임시 입력");
    mocks.selected = 1; await render("inbox");
    expect(new URLSearchParams(mocks.search).get("q")).toBe("첫 채널 적용 검색");
    expect(latestQuery("/items").get("channelId")).toBe("1"); expect(latestQuery("/items").get("q")).toBe("첫 채널 적용 검색");
    expect(latestQuery("/items").get("page")).toBe("2"); expect(inboxInput().value).toBe("첫 채널 아직 제출하지 않은 입력");
    mocks.selected = 2; await render("inbox");
    expect(new URLSearchParams(mocks.search).get("q")).toBe("둘째 채널 적용 검색"); expect(inboxInput().value).toBe("둘째 채널 임시 입력");
    const earlierOwnWrittenUrl = mocks.search;
    const externalUrl = new URLSearchParams({ q: "외부 링크의 검색", collectedOn: "all", mode: "scraps" }).toString();
    await act(async () => { mocks.search = externalUrl; mocks.searchListeners.forEach(listener => listener()); }); await settle();
    expect(latestQuery("/items").get("q")).toBe("외부 링크의 검색");
    await act(async () => { mocks.search = earlierOwnWrittenUrl; mocks.searchListeners.forEach(listener => listener()); }); await settle();
    expect(latestQuery("/items").get("q")).toBe("둘째 채널 적용 검색"); expect(inboxInput().value).toBe("둘째 채널 적용 검색");
  });

  it("소분류를 고른 모집 후보 검색의 주소를 새 사용자 화면에서 열어도 전체 자료로 넓히지 않는다", async () => {
    mocks.echoUrl = true;
    await render("inbox"); await change(host.querySelector<HTMLSelectElement>('[aria-label="소분류 필터"]')!, "과학");
    expect(latestQuery("/items").get("noticeIntent")).toBe("candidate");
    const sharedUrl = mocks.search;
    await leaveViaContent();
    user = "new-reader"; client.setQueryData(["me"], { user, recoveryScope: "scope-" + user }); mocks.search = sharedUrl;
    await render("inbox");
    expect(latestQuery("/items").get("subcategory")).toBe("과학"); expect(latestQuery("/items").get("noticeIntent")).toBe("candidate");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="공고 성격"]')?.value).toBe("candidate");
  });

  it("날짜·소분류가 지정된 수집 링크와 같은 화면의 새 링크는 저장된 다른 검색 조건 대신 지정된 자료를 연다", async () => {
    await render("inbox"); await search("이전 검색");
    await change(host.querySelector<HTMLSelectElement>('[aria-label="본문 상태"]')!, "ok"); await extraFilters(); await change(field("검토 상태"), "held");
    await leaveViaContent();
    mocks.search = "collectedOn=2026-11-01&subcategory=" + encodeURIComponent("과학"); await render("inbox");
    let query = latestQuery("/items");
    expect(query.get("origin")).toBe("scrap"); expect(query.get("collectedOn")).toBe("2026-11-01"); expect(query.get("subcategory")).toBe("과학");
    expect(query.get("noticeIntent")).toBe("all"); expect(query.has("q")).toBe(false); expect(query.has("review")).toBe(false); expect(query.has("fetchStatus")).toBe(false);
    mocks.search = "collectedOn=all&fetchStatus=not_fetched"; await render("inbox");
    query = latestQuery("/items"); expect(query.has("collectedOn")).toBe(false); expect(query.has("subcategory")).toBe(false); expect(query.get("fetchStatus")).toBe("not_fetched");
  });

  it("오늘 조회는 같은 날의 페이지를 유지하고 날짜가 바뀔 때만 새 오늘로 이동하며 직접 고른 날짜는 고정한다", async () => {
    await render("inbox"); await click("다음"); await leaveViaContent(); await render("inbox");
    expect(latestQuery("/items").get("page")).toBe("2");
    await leaveViaContent(); mocks.today = "2026-11-07"; await render("inbox");
    expect(latestQuery("/items").get("collectedOn")).toBe("2026-11-07"); expect(latestQuery("/items").get("page")).toBe("1");
    await change(host.querySelector<HTMLInputElement>('[aria-label="수집일 선택"]')!, "2026-11-01"); await click("다음");
    await leaveViaContent(); mocks.today = "2026-11-08"; await render("inbox");
    expect(latestQuery("/items").get("collectedOn")).toBe("2026-11-01"); expect(latestQuery("/items").get("page")).toBe("2");
  });

  it("발행함의 보관 위치·상태·기간·페이지와 스크롤을 복원하고 위험한 기록 선택은 새로 확인하게 한다", async () => {
    await render("publish"); await click("보관함");
    await change(host.querySelector<HTMLSelectElement>('[aria-label="전송 상태 필터"]')!, "failed");
    await change(field("시작일"), "2026-10-01"); await change(field("종료일"), "2026-11-01");
    await manualMode(); await click("다음");
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="발행 1-2 발행 기록 선택"]')!.click()); expect(checked()).toBe(true);
    await scrollTo(845); await leaveViaContent(); Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await render("publish");
    const query = latestQuery("/deliveries");
    expect(query.get("view")).toBe("archived"); expect(query.get("status")).toBe("failed"); expect(query.get("from")).toBe("2026-10-01"); expect(query.get("to")).toBe("2026-11-01"); expect(query.get("page")).toBe("2");
    expect(host.querySelector('.publication-folders [aria-selected="true"]')?.textContent).toBe("보관함");
    expect(host.querySelector('.work-mode-options button[aria-pressed="true"] strong')?.textContent).toBe("수동");
    expect(window.scrollY).toBe(845); expect(checked()).toBe(false); expect(mocks.move).not.toHaveBeenCalled();
  });

  it("주간 달력의 주와 보기 방식은 상세 방문 후 유지되고 다른 채널·사용자의 발행 조회와 섞이지 않는다", async () => {
    await render("publish"); await click("주간 달력"); await click("다음 주 →");
    const range = { from: latestQuery("/deliveries").get("from"), to: latestQuery("/deliveries").get("to") };
    await leaveViaContent(); await render("publish");
    expect(host.querySelector('.page-head [role="tab"][aria-selected="true"]')?.textContent).toBe("주간 달력");
    expect(latestQuery("/deliveries").get("from")).toBe(range.from); expect(latestQuery("/deliveries").get("to")).toBe(range.to);
    mocks.selected = 2; await render("publish");
    expect(host.querySelector('.page-head [role="tab"][aria-selected="true"]')?.textContent).toBe("목록");
    expect(latestQuery("/deliveries").has("from")).toBe(false);
    await change(host.querySelector<HTMLSelectElement>('[aria-label="전송 상태 필터"]')!, "succeeded");
    mocks.selected = 1; await render("publish");
    expect(host.querySelector('.page-head [role="tab"][aria-selected="true"]')?.textContent).toBe("주간 달력");
    expect(latestQuery("/deliveries").get("from")).toBe(range.from); expect(latestQuery("/deliveries").has("status")).toBe(false);
    user = "editor-b"; client.setQueryData(["me"], { user, recoveryScope: "scope-" + user }); await render("publish");
    expect(host.querySelector('.page-head [role="tab"][aria-selected="true"]')?.textContent).toBe("목록"); expect(latestQuery("/deliveries").has("from")).toBe(false);
    expect(mocks.api.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
});
