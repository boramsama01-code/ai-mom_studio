// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { studioContentSchema, type StudioCard } from "../shared/studio";
import { ExperienceEditor } from "../client/src/pages/ExperienceEditor";
import { ApiError } from "../client/src/api";
const mocks=vi.hoisted(()=>({api:vi.fn(),guard:{setDirty:vi.fn(),confirmLeave:(f:()=>void)=>f()},toast:vi.fn()}));
vi.mock("../client/src/api",async original=>({...await original<object>(),api:mocks.api}));
vi.mock("../client/src/state",()=>({useDirtyGuard:()=>mocks.guard,useChannel:()=>({allChannels:[{slug:"alligodang",name:"알리고당",active:true}]})}));
vi.mock("../client/src/toast",()=>({useToast:()=>mocks.toast}));
vi.mock("../client/src/pages/StudioExport",()=>({StudioExport:()=>null}));
vi.mock("../client/src/pages/StudioTrash",()=>({StudioTrashButton:()=>null}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let host:HTMLDivElement,root:Root,client:QueryClient,card:StudioCard;
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers();
 card={...studioContentSchema.parse({title:"내 방문 기록",channel:"news",format:"카드뉴스",experience:{media:[{id:1,note:""},{id:2,note:""}],coverId:1,pages:[{mediaId:1,title:"첫 장면",body:"직접 본 장면"},{mediaId:2,title:"둘째 장면",body:"기억할 내용"}]}}),id:20,version:1,sourceItemId:null,createdAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z"};
 mocks.api.mockImplementation(async(path:string,opts?:{method?:string;body?:object})=>{
  if(path==="/studio/cards")return {cards:[card],ai:{text:{openai:true}}};
  if(path.endsWith("/media"))return [1,2].map(id=>({id,name:`사진${id}.jpg`,hasPreview:true,kind:"photo"}));
  if(opts?.method==="PATCH"){card={...card,...opts.body,version:card.version+1};return card;}
  throw new Error(path);
 });
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.useRealTimers();});
async function render(){await act(async()=>root.render(createElement(QueryClientProvider,{client},createElement(ExperienceEditor,{data:{card,revisions:[],jobs:[]},refresh:vi.fn()}))));await act(async()=>{await vi.advanceTimersByTimeAsync(10);});}
async function input(element:HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});}
const caption=()=>host.querySelector<HTMLTextAreaElement>('[aria-label="후기 게시용 캡션"]')!;
const patches=()=>mocks.api.mock.calls.filter(([,opts])=>opts?.method==="PATCH");
describe("사진 후기 편집의 입력 보존",()=>{
 it("저장 요청 중 추가한 글은 보존하고 다음 버전으로 저장한다",async()=>{
  await render();let finish!:(value:StudioCard)=>void;
  mocks.api.mockImplementationOnce((_path:string,opts:{body:StudioCard})=>new Promise<StudioCard>(resolve=>{finish=value=>{card={...value,...opts.body,version:2};resolve(card);};}));
  await input(caption(),"첫 문장");await act(async()=>{await vi.advanceTimersByTimeAsync(1400);});expect(patches()).toHaveLength(1);
  await input(caption(),"첫 문장 다음에 계속 입력");await act(async()=>finish(card));expect(caption().value).toBe("첫 문장 다음에 계속 입력");
  await act(async()=>{await vi.advanceTimersByTimeAsync(1400);});expect(patches()).toHaveLength(2);expect(patches()[1][1].body).toMatchObject({version:2,caption:"첫 문장 다음에 계속 입력"});
  expect(mocks.api.mock.calls.some(([path])=>String(path).includes("generate"))).toBe(false);
 });
 it("자료를 제외하면 표지와 페이지 참조도 정리하고 AI를 자동 호출하지 않는다",async()=>{
  await render();const checkbox=host.querySelector<HTMLInputElement>('.experience-media-controls input[type="checkbox"]')!;
  await act(async()=>checkbox.click());await act(async()=>{await vi.advanceTimersByTimeAsync(1400);});
  expect(card.experience?.coverId).toBe(2);expect(card.experience?.media.map(m=>m.id)).toEqual([2]);expect(card.experience?.pages[0].mediaId).toBeNull();
  expect(mocks.api.mock.calls.some(([path])=>String(path).includes("generate"))).toBe(false);
 });
 it("동시 수정 충돌에서 입력을 보존하고 비교 후에만 최신 버전 위에 저장한다",async()=>{
  await render();const current={...card,version:4,caption:"다른 창에서 작성한 글"};mocks.api.mockRejectedValueOnce(new ApiError(409,"다른 곳에서 먼저 수정되었습니다.",{current}));
  await input(caption(),"내가 지금 쓴 글");await act(async()=>{await vi.advanceTimersByTimeAsync(1400);});
  expect(caption().value).toBe("내가 지금 쓴 글");expect(host.textContent).toContain("다른 창에서 작성한 글");
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(patches()).toHaveLength(1);
  const button=[...host.querySelectorAll("button")].find(b=>b.textContent==="현재 입력으로 저장")!;await act(async()=>button.click());expect(patches()[1][1].body).toMatchObject({version:4,caption:"내가 지금 쓴 글"});
 });
});
