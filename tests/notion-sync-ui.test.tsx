// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotionSyncPage } from "../client/src/pages/NotionSync";
import {SourceStudioCard} from '../client/src/pages/SourceStudioCard';
import {studioContentSchema} from '../shared/studio';
import {activateDraftRecoveryScope} from '../client/src/draftRecovery';
import { ApiError } from "../client/src/api";
import type { NotionDocument } from "../shared/notionSync";
import type { NotionStudioDetail, NotionStudioLink } from "../shared/notionStudio";

const mocks = vi.hoisted(() => ({ api: vi.fn(),blob:vi.fn(),guard:{setDirty:vi.fn(),confirmLeave:vi.fn((action:()=>void)=>action())}, navigate: vi.fn(), selected: 3 as number | "all" }));
const channels = [
  { id: 3, name: "HighScoop", slug: "highscoop", active: true },
  { id: 5, name: "다른 채널", slug: "other-channel", active: true },
  { id: 9, name: "중지한 채널", slug: "inactive-channel", active: false },
];
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api,apiBlob:mocks.blob }));
vi.mock("../client/src/state", () => ({
  useChannel: () => ({ selected: mocks.selected, current: channels.find(channel => channel.id === mocks.selected) ?? null, channels: channels.filter(channel => channel.active), allChannels: channels, select: vi.fn(), isLoading: false, error: null, refresh: vi.fn() }),
  useDirtyGuard: () => mocks.guard,
}));
vi.mock("wouter", async original => ({ ...await original<object>(), useLocation: () => ["/notion", mocks.navigate], useSearch: () => window.location.search }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pageId = "4135c7c8-45fc-8101-ba1c-000000000001";
const sourceHash = "a".repeat(64), nextSourceHash = "b".repeat(64);
const sourcePages = [
  { index: 1, title: "영재원 지원, 무엇부터?", body: "학생 지원과 교사 추천 일정을 확인하세요.", headingBlockId: "heading-1", titleBlockId: "title-1", bodyBlockIds: ["body-1"] },
  { index: 2, title: "지원 마감 전에 확인할 것", body: "원문에서 전형료와 제출 서류를 확인하세요.", headingBlockId: "heading-2", titleBlockId: "title-2", bodyBlockIds: ["body-2"] },
];
function documentFixture(): NotionDocument {
  return {
    pageId, url: `https://www.notion.so/${pageId.replaceAll("-", "")}`, lastEditedAt: "2026-11-09T02:00:00.000Z",
    contentKey: "GED2027-서울-중등", title: "서울 중등 영재교육원", coverTitle: "영재원 지원, 무엇부터?",
    channel: "HighScoop", category: "영재원", template: "highscoop-a", stage: "원고 검토", verified: true,
    caption: "지원 전 원문을 확인하세요.", sourceHash, pages: structuredClone(sourcePages),
    photos: [
      { key: "photo-1", name: "실험 사진.jpg", url: "https://file.notion.so/fixture/lab.jpg" },
      { key: "photo-2", name: "수료식.png", url: "https://file.notion.so/fixture/ceremony.png" },
    ],
  };
}
function linkFixture(overrides: Partial<NotionStudioLink> = {}): NotionStudioLink {
  return {
    id: 18, version: 4, pageId, notionUrl: documentFixture().url, channelId: 3, itemId: 28, studioCardId: null,
    title: "서울 중등 영재교육원", sourceHash, lastEditedAt: "2026-11-09T02:00:00.000Z", lastSyncedAt: "2026-11-09T02:10:00.000Z",
    autoSync: true, lastCheckedAt: "2026-11-09T02:10:00.000Z", coverStyle: "A", status: "synced", studioUrl: "/items/3/28", canva: { phase: "idle" }, photoCount: 2, ...overrides,
  };
}
function detailFixture(overrides: Partial<NotionStudioDetail> = {}): NotionStudioDetail {
  return {
    link: linkFixture(), itemVersion: 7,
    copy: { version: 1, templateKey: "highscoop-a", cover: { title: sourcePages[0].title, subtitle: "" }, pages: [{ id: "body-1", title: sourcePages[1].title, subtitle: "", body: sourcePages[1].body }] },
    photos: [
      { id: 101, name: "실험 사진.jpg", mimeType: "image/jpeg", width: 1080, height: 1350, url: "/api/channels/3/media/101" },
      { id: 102, name: "수료식.png", mimeType: "image/png", width: 1080, height: 1350, url: "/api/channels/3/media/102" },
    ],
    source: { title: "서울 중등 영재교육원", coverTitle: sourcePages[0].title, pages: sourcePages.map(({ index, title, body }) => ({ index, title, body })) },
    notion: { sourceHash, lastEditedAt: "2026-11-09T02:00:00.000Z", changed: false, pages: sourcePages.map(({ index, title, body }) => ({ index, title, body })) },
    warnings: [], ...overrides,
  };
}

type RequestOptions = { method?: string; body?: any; signal?: AbortSignal };
let root: Root, host: HTMLDivElement, client: QueryClient;
let manuscript: NotionDocument, detail: NotionStudioDetail, links: NotionStudioLink[];
let request: (path: string, options: RequestOptions) => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.selected = 3; sessionStorage.clear(); window.history.replaceState({}, "", "/notion");
  mocks.blob.mockResolvedValue(new Blob(['preview'],{type:'image/jpeg'}));
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>`blob:preview-${mocks.blob.mock.calls.length}`)});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  manuscript = documentFixture(); detail = detailFixture(); links = [];
  request = async (path, options) => {
    if (path === "/notion/status") return { configured: true, dataSourceId: "fixture-data-source", missing: [] };
    if (path.startsWith("/notion/documents?")) return { documents: [structuredClone(manuscript)], hasMore: false };
    if (path === `/notion/documents/${pageId}`) return structuredClone(manuscript);
    if (path === "/notion/links") return { links: structuredClone(links) };
    if (path === "/notion/links/18?refresh=1"||path === "/notion/links/18"&&options.method!=='PATCH') return structuredClone(detail);
    if(path==='/notion/links/18/copy'&&options.method==='PATCH'){
      detail={...detail,copy:structuredClone(options.body.copy),designEdits:structuredClone(options.body.designEdits),itemVersion:detail.itemVersion+1,link:{...detail.link,status:'studio_changed'}};return structuredClone(detail);
    }
    if (path === "/notion/links/18" && options.method === "PATCH") {
      detail = { ...detail, link: { ...detail.link, ...options.body, version: detail.link.version + 1 } };
      return structuredClone(detail);
    }
    if (path === "/notion/import" && options.method === "POST") return structuredClone(detail);
    if (/^\/notion\/links\/18\/(pull|push|canva|canva\/export)$/.test(path) && options.method === "POST") return structuredClone(detail);
    throw new Error("Unexpected Notion UI request: " + path);
  };
  mocks.api.mockImplementation((path: string, options: RequestOptions = {}) => request(path, options));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, "", "/"); vi.useRealTimers(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10); else await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><NotionSyncPage /></QueryClientProvider>)); await settle(); }
function button(name: string) { const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === name); if (!result) throw new Error("Missing button: " + name); return result; }
async function click(name: string) { expect(button(name).disabled).toBe(false); await act(async () => button(name).click()); await settle(); }
function field(name: string) { const result = host.querySelector<HTMLInputElement | HTMLSelectElement|HTMLTextAreaElement>(`[aria-label="${name}"]`) ?? [...host.querySelectorAll("label")].find(label => label.textContent?.trim().startsWith(name))?.querySelector<HTMLInputElement | HTMLSelectElement|HTMLTextAreaElement>("input,select,textarea"); if (!result) throw new Error("Missing field: " + name); return result; }
async function fill(name: string, value: string) { const node = field(name); await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
async function chooseSource() { const source = host.querySelector<HTMLButtonElement>(".notion-document-list button")!; expect(source).toBeTruthy(); await act(async () => source.click()); await settle(); }
async function chooseRadio(selector: string) { const node = host.querySelector<HTMLInputElement>(selector)!; expect(node).toBeTruthy(); await act(async () => node.click()); await settle(); }
async function renderLinked() { links = [detail.link]; window.history.replaceState({}, "", "/notion?link=18"); await render(); }
const detailReads = () => mocks.api.mock.calls.filter(([path]) => path === "/notion/links/18?refresh=1");

describe("Notion manuscript and Canva workspace", () => {
  it('opens the same A/photo/fade editor directly in the linked main Studio workspace without the generic renderer',async()=>{
    const card={...studioContentSchema.parse({title:'원문 연결 카드',channel:'highscoop',format:'카드뉴스'}),id:39,version:1,sourceItemId:28,sourceReference:{channelId:3,itemId:28},notionLinkId:18,createdAt:'2026-11-09',updatedAt:'2026-11-09'};
    await act(async()=>root.render(<QueryClientProvider client={client}><SourceStudioCard card={card}/></QueryClientProvider>));await settle();
    expect(host.textContent).toContain('하이스쿱 카드 편집');expect(host.querySelector('[aria-label="카드 보며 수정"]')).toBeTruthy();expect(host.querySelector('.card-copy-editor')).toBeNull();
    expect(mocks.api.mock.calls.some(([path])=>String(path).includes('/card-copy'))).toBe(false);expect(writes()).toHaveLength(0);
  });
  it('previews unsaved title/body/emphasis edits and saves only core copy plus Studio design overrides',async()=>{
    vi.useFakeTimers();detail.source.pages[1].key='row-body';detail.source.pages[1].cardFields={subtitle:'노션 소제목',body:'원문 본문',footnote:'확인 각주',sourceLabel:'공식 공고'};detail.source.pages[1].emphasis='원문';
    detail.copy.pages[0].body='노션 소제목\n\n원문 본문';detail.source.sourceReferences=Array.from({length:23},(_,i)=>({title:`기관 ${i+1}`,url:`https://ged.kedi.re.kr/notice/${i}`}));detail.source.teaser={title:'연구계획서 예고',body:'댓글로 남겨주세요.'};
    await renderLinked();expect(host.querySelectorAll('.notion-card-strip button')).toHaveLength(10);
    await act(async()=>host.querySelectorAll<HTMLButtonElement>('.notion-card-strip button')[1].click());await settle();
    expect(field('카드 본문').value).toBe('원문 본문');expect(host.textContent).toContain('노션 소제목');
    await fill('카드 제목','고친 카드 제목');await fill('카드 본문','새로 정리한 원문 본문');await fill('강조문구','정리한');
    expect(writes()).toHaveLength(0);expect(button('캔바로 제작').disabled).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);});await settle();
    const [path,type,options]=mocks.blob.mock.calls.at(-1)!;expect(path).toBe('/notion/links/18/preview');expect(type).toBe('image/jpeg');expect(options.body).toMatchObject({version:4,itemVersion:7,page:1,copy:{pages:[{title:'고친 카드 제목',body:'노션 소제목\n\n새로 정리한 원문 본문'}]},designEdits:{emphasisByPage:{'row-body':'정리한'}}});
    await click('스튜디오에 저장');expect(writes()).toHaveLength(1);expect(writes()[0][0]).toBe('/notion/links/18/copy');expect(writes()[0][1].body.copy.pages).toHaveLength(1);
    expect(detail.source.pages[1].cardFields).toMatchObject({subtitle:'노션 소제목',footnote:'확인 각주',sourceLabel:'공식 공고'});expect(detail.source.sourceReferences).toHaveLength(23);expect(detail.source.teaser.title).toBe('연구계획서 예고');expect(host.textContent).toContain('스튜디오에 저장했습니다.');
    expect(mocks.api.mock.calls.some(([endpoint])=>String(endpoint).endsWith('/canva'))).toBe(false);
  });
  it('keeps dirty input when an automatic query refresh receives a newer server revision',async()=>{
    await renderLinked();await fill('카드 제목','아직 저장하지 않은 표지');
    const next=detailFixture({itemVersion:8,copy:{...detail.copy,cover:{title:'다른 곳에서 저장한 제목',subtitle:''}}});
    await act(async()=>client.setQueryData(['notion-link',18],next));await settle();
    expect(field('카드 제목').value).toBe('아직 저장하지 않은 표지');expect(host.textContent).toContain('다른 곳에서 새 버전을 저장했습니다.');expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(0);
  });
  it('checkpoints an incomplete title and keeps the new saved baseline when a leave dialog saves first',async()=>{
    localStorage.clear();activateDraftRecoveryScope('notion-visual-test');client.setQueryDefaults(['me'],{gcTime:Infinity});client.setQueryData(['me'],{user:'fixture',recoveryScope:'notion-visual-test'});await renderLinked();await fill('카드 제목','');
    expect(host.textContent).toContain('이 기기에 임시 보관됨');expect(button('스튜디오에 저장').disabled).toBe(true);
    await fill('카드 제목','확인 후 저장한 표지');
    mocks.guard.confirmLeave.mockImplementationOnce(async action=>{const registration=mocks.guard.setDirty.mock.calls.filter(([key,dirty])=>key==='notion-visual-18'&&dirty).at(-1)!;expect(await registration[2]()).toBe(true);action();});
    await click('수정 취소');expect(field('카드 제목').value).toBe('확인 후 저장한 표지');expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(1);localStorage.clear();
  });
  it('uses cached source for repeated pending-job polls then refreshes Notion once after settling',async()=>{
    vi.useFakeTimers();detail.link.canva={phase:'importing',jobId:'known-job'};await renderLinked();
    await act(async()=>{await vi.advanceTimersByTimeAsync(7500);});await settle();
    expect(detailReads()).toHaveLength(1);expect(mocks.api.mock.calls.filter(([path])=>path==='/notion/links/18')).toHaveLength(3);
    detail.link.canva={phase:'ready',designId:'Dknown'};await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});await settle();expect(detailReads()).toHaveLength(2);expect(writes()).toHaveLength(0);
  });
  it("shows that source QR and the next-article teaser will appear before the channel introduction", async () => {
    detail.source.sourceReferences=[{title:'공식 모집 공고',url:'https://ged.kedi.re.kr/notice/2027'}];
    detail.source.teaser={title:'3일만에 쓰는 영재교육원 연구계획서',body:'궁금한 점을 댓글로 남겨주세요.'};
    await renderLinked();expect(host.textContent).toContain('원문 확인 QR(1개 · 1장) · 다음 편 예고 · 하이스쿱 소개');expect(writes()).toHaveLength(0);
  });
  it("shows six source pages for 23 institutional QRs without making a request to change the manuscript", async () => {
    detail.source.sourceReferences=Array.from({length:23},(_,i)=>({title:`기관 ${i+1}`,url:`https://ged.kedi.re.kr/notice/${i}`}));
    await renderLinked();expect(host.textContent).toContain('원문 확인 QR(23개 · 6장) · 하이스쿱 소개');expect(writes()).toHaveLength(0);
  });
  it("previews the selected manuscript and both photo names before importing the chosen channel and cover style with its source hash", async () => {
    await render(); expect(writes()).toHaveLength(0); await chooseSource();
    const preview = host.querySelector('[aria-label="가져올 원고 미리보기"]')!;
    expect(preview.textContent).toContain(sourcePages[0].body);
    expect(preview.querySelector('[aria-label="첨부 사진"]')?.textContent).toContain("2개");
    expect(preview.textContent).toContain("실험 사진.jpg"); expect(preview.textContent).toContain("수료식.png");
    expect(field("저장할 채널").value).toBe("3");
    expect([...(field("저장할 채널") as HTMLSelectElement).options].map(option => option.value)).toEqual(["", "3", "5"]);
    await fill("저장할 채널", "5"); await chooseRadio('input[name="import-cover-style"][value="C"]');
    expect(writes()).toHaveLength(0); await click("스튜디오로 가져오기");
    expect(writes()).toEqual([["/notion/import", expect.objectContaining({ method: "POST", body: { pageId, channelId: 5, expectedSourceHash: sourceHash, coverStyle: "C" } })]]);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/notion?link=18");
  });

  it("requires an explicit destination when viewing all channels and never imports into an inactive channel", async () => {
    mocks.selected = "all"; await render(); await chooseSource();
    expect(field("저장할 채널").value).toBe(""); expect(button("스튜디오로 가져오기").disabled).toBe(true);
    await act(async () => button("스튜디오로 가져오기").click()); expect(writes()).toHaveLength(0);
    await fill("저장할 채널", "3"); expect(button("스튜디오로 가져오기").disabled).toBe(false);
  });

  it.each(["pull", "push"] as const)("shows a %s conflict and submits resolveConflict only after the user chooses which manuscript to keep", async initial => {
    const current = detailFixture({
      link: linkFixture({ version: 5, status: "studio_changed", sourceHash: nextSourceHash }), itemVersion: 8,
      notion: { sourceHash: nextSourceHash, lastEditedAt: "2026-11-09T03:00:00.000Z", changed: true, pages: [{ index: 1, title: "다른 창에서 수정한 노션 제목", body: "바뀐 노션 본문" }] },
    });
    const base = request; let attempts = 0;
    request = async (path, options) => {
      if (path === `/notion/links/18/${initial}` && options.method === "POST" && attempts++ === 0) {
        detail = current; throw new ApiError(409, "양쪽 원고가 변경되었습니다.", { detail: structuredClone(current) });
      }
      return base(path, options);
    };
    await renderLinked();
    expect(host.querySelector('[aria-label="연결 원고 관리"]')).not.toBeNull();
    await click(initial === "pull" ? "노션 → 스튜디오 적용" : "스튜디오 → 노션 반영");
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toEqual([`/notion/links/18/${initial}`, expect.objectContaining({ method: "POST", body: { version: 4, itemVersion: 7, expectedSourceHash: sourceHash, resolveConflict: false } })]);
    const conflict = host.querySelector('[aria-label="원고 충돌 해결"]')!;
    expect(conflict).not.toBeNull(); expect(host.textContent).toContain("다른 창에서 수정한 노션 제목");
    expect([...conflict.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(node => !node.checked)).toBe(true);
    expect(button("선택한 원고로 동기화").disabled).toBe(true);
    await act(async () => button("선택한 원고로 동기화").click()); await settle(); expect(writes()).toHaveLength(1);
    const chosen = initial === "pull" ? "push" : "pull";
    const radio = conflict.querySelectorAll<HTMLInputElement>('input[type="radio"]')[chosen === "pull" ? 0 : 1];
    await act(async () => radio.click()); await settle();
    await click("선택한 원고로 동기화");
    expect(writes()).toHaveLength(2);
    expect(writes()[1]).toEqual([`/notion/links/18/${chosen}`, expect.objectContaining({ method: "POST", body: { version: 5, itemVersion: 8, expectedSourceHash: nextSourceHash, resolveConflict: true } })]);
    expect(host.querySelector('[aria-label="원고 충돌 해결"]')).toBeNull();
  });

  it("requires a fresh copy comparison confirmation before fetching completed Canva artwork", async () => {
    detail.link.canva = { phase: "ready", designId: "Dfixture", editUrl: "https://www.canva.com/design/Dfixture/edit", pageCount: 2 };
    await renderLinked(); expect(button("완성본 가져오기").disabled).toBe(true);
    await act(async () => button("완성본 가져오기").click()); expect(writes()).toHaveLength(0);
    const checkbox = () => host.querySelector<HTMLInputElement>(".notion-canva-output .notion-export-confirm input")!;
    expect(checkbox().disabled).toBe(false);
    await act(async () => checkbox().click()); await settle(); expect(checkbox().checked).toBe(true); expect(button("완성본 가져오기").disabled).toBe(false);
    detail = detailFixture({ link: { ...detail.link, version: 5 }, itemVersion: 8 });
    await click("노션 변경 확인");
    expect(checkbox().checked).toBe(false); expect(button("완성본 가져오기").disabled).toBe(true); expect(writes()).toHaveLength(0);
    await act(async () => checkbox().click()); await settle(); await click("완성본 가져오기");
    expect(writes()).toEqual([["/notion/links/18/canva/export", expect.objectContaining({ method: "POST", body: { version: 5, itemVersion: 8, confirmed: true } })]]);
    expect(checkbox().checked).toBe(false);
  });

  it.each(["importing", "exporting"] as const)("polls an existing %s job until ready without posting another Canva request", async phase => {
    vi.useFakeTimers(); detail.link.canva = { phase, jobId: "import-fixture", ...(phase === "exporting" ? { designId: "Dfixture", exportJobId: "export-fixture" } : {}) };
    await renderLinked(); expect(button(phase === "exporting" ? "현재 원고로 새 디자인 만들기" : "캔바로 제작").disabled).toBe(true);
    const reads = detailReads().length;
    detail = detailFixture({ link: linkFixture({ canva: { phase: "ready", designId: "Dfixture" } }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); await settle();
    expect(detailReads().length).toBeGreaterThan(reads); expect(host.textContent).toContain("캔바 편집 가능");
    expect(button("현재 원고로 새 디자인 만들기").disabled).toBe(false); expect(writes()).toHaveLength(0);
  });

  it.each(["failed", "result_unknown"] as const)("rechecks a %s Canva result with a read instead of retrying design creation", async phase => {
    detail.link.canva = { phase, jobId: "import-fixture", error: "저장한 작업으로 상태를 확인하세요." };
    await renderLinked(); expect(host.textContent).toContain("저장한 작업으로 상태를 확인하세요."); expect(writes()).toHaveLength(0);
    const reads = detailReads().length; detail = detailFixture({ link: linkFixture({ canva: { phase: "ready", designId: "Dfixture" } }) });
    await click("처리 상태 다시 확인");
    expect(detailReads().length).toBeGreaterThan(reads); expect(host.textContent).toContain("캔바 편집 가능"); expect(writes()).toHaveLength(0);
  });

  it("lets the user turn automatic synchronization off and blocks toggling it while a Canva job is running", async () => {
    await renderLinked();
    const checkbox = () => host.querySelector<HTMLInputElement>(".notion-auto-sync input")!;
    expect(checkbox().checked).toBe(true); expect(checkbox().disabled).toBe(false); expect(writes()).toHaveLength(0);
    await act(async () => checkbox().click()); await settle();
    expect(writes()).toEqual([["/notion/links/18", expect.objectContaining({ method: "PATCH", body: { version: 4, autoSync: false } })]]);
    expect(checkbox().checked).toBe(false);
    detail.link.canva = { phase: "importing", jobId: "import-fixture" };
    await click("노션 변경 확인"); expect(checkbox().disabled).toBe(true);
    await act(async () => checkbox().click()); await settle(); expect(writes()).toHaveLength(1);
  });
});
