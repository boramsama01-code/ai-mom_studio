// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionPanel } from "../client/src/collection";
import { kstDay, type CollectionOverview } from "../shared/collection";
const mocks = vi.hoisted(() => ({ api: vi.fn(), select: vi.fn(), toast: vi.fn(), navigate: vi.fn(), selected: 'all' as 'all' | number }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: mocks.selected, select: mocks.select }), useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }) }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
const overview = { date: kstDay(), timezone: "Asia/Seoul", autoCollect: true, globalStop: false, naverReady: true, inlineWorker: true, nextAt: "2026-11-07T23:00:00.000Z", lastScheduledAt: null,
  channels: [{ id: 1, version: 1, name: "입시 채널", slug: "opportunities", active: true, queries: 4, discoveryQueries: 0, boards: 0, budget: 12, profile: null, newItems: 0, pending: 0, fetched: 0, lastRun: null, jobs: [{ id: 1, status: "queued", stale: true, createdAt: "2026-10-01T00:00:00Z" }] }] };
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.selected = 'all';
  mocks.api.mockImplementation(async (path: string) => path === "/collection/collect" ? { requested: [{}], inline: true } : overview);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(CollectionPanel, { detailed: true }))));
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("허용 상태에서는 다음 한국 시간 08:00 예약과 실제 실행 지연 가능성을 안내한다", () => {
  expect(host.querySelector(".collection-next")?.textContent).toBe("2026-11-08 08:00");
  expect(host.textContent).not.toContain("05:13");
  expect(host.textContent).not.toContain("07:13");
  expect(host.textContent).not.toContain("19:13");
  expect(host.textContent).toContain("매일 한국 시간 08:00 예약");
  expect(host.textContent).toContain("실제 실행은 지연될 수 있습니다");
  expect(mocks.api.mock.calls.every(([path]) => String(path).startsWith("/collection/overview?"))).toBe(true);
});
it("허용을 끄면 남아 있는 예약 시각보다 꺼짐 상태를 우선하고 수동 수집은 유지한다", async () => {
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...overview, autoCollect: false }); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.querySelector(".collection-next")?.textContent).toBe("자동 수집 꺼짐");
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(host.textContent).toContain("허용을 꺼도 ‘지금 수집’은 사용할 수 있습니다");
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "대기 수집 재개")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(mocks.api).toHaveBeenCalledWith("/collection/collect", { method: "POST", body: { channelId: "all" } });
});
it("전역 정지일 때는 허용 값과 예약 시각이 남아 있어도 정지를 안내하고 수집을 막는다", async () => {
  await act(async () => { client.setQueryData(["collection", "all", kstDay()], { ...overview, globalStop: true }); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.querySelector(".collection-next")?.textContent).toBe("전체 정지");
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "대기 수집 재개")!;
  expect(button.disabled).toBe(true);
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

async function showSelection(selected: 'all' | number, data: CollectionOverview = overview, detailed = true) {
  mocks.selected = selected;
  mocks.api.mockImplementation(async (path: string) => path === '/collection/collect' ? { requested: [{}], inline: true } : data);
  await act(async () => {
    client.setQueryData(['collection', selected, kstDay()], data);
    root.render(createElement(QueryClientProvider, { client }, createElement(CollectionPanel, { detailed })));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

it('places the real global schedule switch next to the next-run state and saves from there', async () => {
  const schedule = host.querySelector('.collection-metrics .collection-schedule')!;
  expect(schedule.querySelector('.collection-next')).not.toBeNull();
  const checkbox = schedule.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(true);
  expect(schedule.textContent).toContain('모든 채널 공통');
  expect(schedule.textContent).toContain('08:00 예약');
  await act(async () => checkbox.click());
  expect(mocks.api).toHaveBeenCalledWith('/settings/auto-collect', { method: 'PUT', body: { enabled: false } });
});

it('uses one channel flow and one collect action while retaining categories, history, profile and rule management', async () => {
  const ready = { ...overview, channels: [{ ...overview.channels[0], jobs: [], categories: [{ label: '전국대회', newItems: 3 }], profile: { label: '추천', count: 2, missing: 1, active: 1, paused: 0, removed: 0, rules: [] } }] };
  await showSelection(1, ready);
  const channel = host.querySelector('.collection-channel-single .collection-channel[data-collection-scope="channel"]')!;
  expect(channel).not.toBeNull();
  expect(host.querySelector('.collection-channels')).toBeNull();
  expect(channel.querySelector('h3')).toBeNull();
  expect([...host.querySelectorAll('button')].filter(button => button.textContent === '이 채널 지금 수집')).toHaveLength(1);
  expect(channel.textContent).toContain('전국대회 · 3건');
  expect(channel.textContent).toContain('아직 수집을 실행하지 않았습니다');
  expect(channel.textContent).toContain('새 검색어 1개 추가');
  expect(channel.textContent).toContain('등록한 검색어 수정·재개');
  const collect = host.querySelector<HTMLButtonElement>('.collection-run')!;
  expect(collect.disabled).toBe(false);
  await act(async () => collect.click());
  expect(mocks.api).toHaveBeenCalledWith('/collection/collect', { method: 'POST', body: { channelId: 1 } });
});

it('retains the separate channel cards and per-channel collect controls in the all-channel view', async () => {
  const profile = { label: '추천', count: 1, missing: 0, active: 1, paused: 0, removed: 0, rules: [] };
  const data = { ...overview, channels: [{ ...overview.channels[0], profile, jobs: [] }, { ...overview.channels[0], id: 2, name: '두 번째 채널', profile, jobs: [] }] };
  await showSelection('all', data);
  expect(host.querySelectorAll('.collection-channels .collection-channel')).toHaveLength(2);
  expect(host.querySelector('.collection-channel-single')).toBeNull();
  expect([...host.querySelectorAll('button')].filter(button => button.textContent === '이 채널 지금 수집')).toHaveLength(2);
  expect(host.querySelector('.collection-run')?.textContent).toBe('전체 채널 지금 수집');
});

it('disables meaningless collection for a channel with no sources and links its recovery action to real rule management', async () => {
  const data = { ...overview, channels: [{ ...overview.channels[0], queries: 0, discoveryQueries: 0, boards: 0, jobs: [] }] };
  await showSelection(1, data);
  expect(host.querySelector<HTMLButtonElement>('.collection-run')!.disabled).toBe(true);
  expect(host.textContent).toContain('직접 창작하는 채널입니다.');
  const setup = [...host.querySelectorAll('button')].find(button => button.textContent === '검색어 추가·재개')!;
  await act(async () => setup.click());
  expect(mocks.select).toHaveBeenCalledWith(1);
  expect(mocks.navigate).toHaveBeenCalledWith('/rules');
  expect(mocks.api.mock.calls.every(([path]) => String(path).startsWith('/collection/overview?'))).toBe(true);
});

it('keeps the compact schedule switch functional and offers the same empty-source recovery', async () => {
  const data = { ...overview, channels: [{ ...overview.channels[0], queries: 0, discoveryQueries: 0, boards: 0, jobs: [] }] };
  await showSelection(1, data, false);
  const schedule = host.querySelector('.collection-compact-next')!;
  expect(schedule.textContent).toContain('모든 채널 공통');
  const checkbox = schedule.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.disabled).toBe(false);
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '지금 수집')!.disabled).toBe(true);
  await act(async () => checkbox.click());
  expect(mocks.api).toHaveBeenCalledWith('/settings/auto-collect', { method: 'PUT', body: { enabled: false } });
  expect(host.textContent).toContain('검색어 추가·재개');
});
