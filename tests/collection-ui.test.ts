// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionPanel } from "../client/src/collection";
import { kstDay } from "../shared/collection";
const mocks = vi.hoisted(() => ({ api: vi.fn(), select: vi.fn(), toast: vi.fn(), navigate: vi.fn() }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: "all", select: mocks.select }), useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
const overview = { date: kstDay(), timezone: "Asia/Seoul", autoCollect: true, globalStop: false, naverReady: true, inlineWorker: true, nextAt: null, lastScheduledAt: null,
  channels: [{ id: 1, version: 1, name: "입시 채널", slug: "opportunities", active: true, queries: 4, discoveryQueries: 0, boards: 0, budget: 12, profile: null, newItems: 0, pending: 0, fetched: 0, lastRun: null, jobs: [{ id: 1, status: "queued", stale: true, createdAt: "2026-10-01T00:00:00Z" }] }] };
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => path === "/collection/collect" ? { requested: [{}], inline: true } : overview);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(CollectionPanel, { detailed: true }))));
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("구형 자동 수집 허용 값만으로 존재하지 않는 실행 시각을 표시하지 않는다", () => {
  expect(host.querySelector(".collection-next")?.textContent).toBe("예약 실행 설정 필요");
  expect(host.textContent).not.toContain("05:13");
  expect(host.textContent).not.toContain("07:13");
  expect(host.textContent).not.toContain("19:13");
  expect(host.textContent).toContain("별도 예약 실행 설정이 필요");
  expect(mocks.api.mock.calls.every(([path]) => String(path).startsWith("/collection/overview?"))).toBe(true);
});
it("몇 주 지난 대기 작업 때문에 버튼을 막지 않고 재개한다", async () => {
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === "대기 수집 재개")!;
  expect(b.disabled).toBe(false);
  await act(async () => b.click());
  expect(mocks.api).toHaveBeenCalledWith("/collection/collect", { method: "POST", body: { channelId: "all" } });
  expect(host.textContent).toContain("실제 예약 수집 기록이 아직 없습니다");
});
it("날짜별 결과 링크는 선택한 채널과 수집일을 전달한다", async () => {
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === "이 날짜 자료 보기")!;
  await act(async () => b.click());
  expect(mocks.select).toHaveBeenCalledWith(1);
  expect(mocks.navigate).toHaveBeenCalledWith(`/inbox?collectedOn=${kstDay()}`);
});
it("인증 실패로 0건인 경우 원인과 키 수정 링크를 숨기지 않는다", async () => {
  const failed = { ...overview, channels: [{ ...overview.channels[0], jobs: [], lastRun: { id: 1, status: "failed", startedAt: "2026-10-26T07:03:00Z", finishedAt: "2026-10-26T07:03:01Z", counts: { newItems: 0 }, errors: [{ scope: "rule:1", message: "과학고(news): 인증/권한 오류 (HTTP 401)" }] } }] };
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], failed); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("최근 수집에서 네이버 검색 인증에 실패했습니다");
  expect(alert.querySelector("a")?.getAttribute("href")).toBe("/connections?service=naver");
  await act(async () => alert.querySelector("a")!.click());
  expect(mocks.navigate).toHaveBeenCalledWith("/connections?service=naver");
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...failed, channels: [{ ...failed.channels[0], lastRun: { ...failed.channels[0].lastRun, status: "partial", errors: [{ scope: "naver", message: "네이버 검색: 인증/권한 오류 (HTTP 401). 뉴스는 공개 RSS로 보완합니다." }] } }] }); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("네이버 검색 인증에 실패");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("학교·기관 공지는 계속 확인");
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...failed, channels: [{ ...failed.channels[0], lastRun: { ...failed.channels[0].lastRun, status: "ok", errors: [] } }] }); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("공개 뉴스 수집은 네이버 키가 없어도 실행할 수 있다", async () => {
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...overview, naverReady: false, searchReady: true, sourceMode: "official_naver", publicFeeds: ["과학신문"] }); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "대기 수집 재개")!;
  expect(button.disabled).toBe(false);
  expect(host.textContent).toContain("네이버 뉴스·웹문서로 보완");
  await act(async () => button.click());
  expect(mocks.api).toHaveBeenCalledWith("/collection/collect", { method: "POST", body: { channelId: "all" } });
});

it("shows already registered recommendations and collects the specific channel instead of adding zero keywords", async()=>{
 const ready={...overview,channels:[{...overview.channels[0],profile:{label:"추천",count:2,missing:0,active:1,paused:1,removed:0,rules:[{query:"과학고",endpoint:"news",state:"active"},{query:"영재고",endpoint:"news",state:"paused"}]}}]};
 await act(async()=>{client.setQueryData(["collection","all",kstDay()],ready);});
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(host.textContent).toContain("추천 검색어가 모두 등록되어 있어요");
 expect(host.textContent).toContain("일시정지 1개");
 expect([...host.querySelectorAll("button")].some(b=>b.textContent?.includes("개 추가"))).toBe(false);
 const b=[...host.querySelectorAll("button")].find(b=>b.textContent==="이 채널 지금 수집")!;
 await act(async()=>b.click());expect(mocks.api).toHaveBeenCalledWith("/collection/collect",{method:"POST",body:{channelId:1}});
});
it("explains a duplicate-only profile result without claiming zero keywords were added",async()=>{
 const ready={...overview,channels:[{...overview.channels[0],profile:{label:"추천",count:2,missing:1,active:1,paused:0,removed:0,rules:[]}}]};
 await act(async()=>{client.setQueryData(["collection","all",kstDay()],ready);});await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 mocks.api.mockImplementation(async(path:string)=>path.endsWith("/collection-profile")?{added:0}:ready);
 await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="새 검색어 1개 추가")!.click());
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(mocks.toast).toHaveBeenCalledWith("info",expect.stringContaining("이미 모두 등록"));
});


it("소분류 브리핑에서 해당 날짜·채널·분류 자료로 이동한다", async () => {
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...overview, channels: [{ ...overview.channels[0], categories: [{ label: "전국대회", newItems: 3 }] }] }); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === "전국대회 · 3건")!;
  await act(async () => b.click());
  expect(mocks.select).toHaveBeenCalledWith(1);
  expect(mocks.navigate).toHaveBeenCalledWith(`/inbox?collectedOn=${kstDay()}&subcategory=${encodeURIComponent("전국대회")}`);
});
