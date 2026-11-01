// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {FinishedDeckEditor} from "../client/src/pages/FinishedDeckEditor";
import {studioContentSchema,type StudioCard} from "../shared/studio";
const mocks=vi.hoisted(()=>({api:vi.fn(),setDirty:vi.fn()}));
vi.mock("../client/src/api",async original=>({...await original<object>(),api:mocks.api}));
vi.mock("../client/src/state",()=>({useDirtyGuard:()=>({setDirty:mocks.setDirty,confirmLeave:(f:()=>void)=>f()})}));
vi.mock("../client/src/pages/StudioExport",()=>({StudioQuickExport:()=>null}));
vi.mock("../client/src/pages/StudioPublish",()=>({StudioPublish:()=>null}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLDivElement,client:QueryClient,saved:StudioCard;
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,25));});
beforeEach(async()=>{
 vi.clearAllMocks();saved={...studioContentSchema.parse({title:"가족",channel:"penguin",format:"카드뉴스",caption:"직접 쓴 캡션",finishedDeck:{pages:[{imageId:1,name:"01.png",altText:"옛 설명"},{imageId:2,name:"02.png",altText:"둘째 설명"}]}}),id:1,version:1,sourceItemId:null,createdAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z",trashedAt:null};
 mocks.api.mockImplementation(async(path:string,opts:any)=>{
  if(path==="/studio/ai-status")return{defaultProvider:"gemini",text:{gemini:true,openai:false,anthropic:false}};
  if(opts?.method==="PATCH"){saved={...saved,...opts.body,version:saved.version+1};return saved;}
  if(path.endsWith("/imported-ai"))return{mode:opts.body.mode,version:opts.body.version,caption:"바꾸면 안 되는 AI 캡션",altTexts:["생성된 첫 그림 설명","생성된 둘째 그림 설명"]};
  throw Error(path);
 });
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(createElement(QueryClientProvider,{client},createElement(FinishedDeckEditor,{data:{card:saved,revisions:[],jobs:[]}}))));await settle();
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();});
async function type(text:string){const el=host.querySelector<HTMLTextAreaElement>('textarea[aria-label="1페이지 대체텍스트"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(el,text);el.dispatchEvent(new Event("input",{bubbles:true}));});return el;}
async function click(text:string){const b=[...host.querySelectorAll("button")].find(b=>b.textContent===text)!;expect(b,text).toBeTruthy();expect(b.disabled,text).toBe(false);await act(async()=>b.click());await settle();}
it("allows clearing and replacing alt text, then saves the value without changing the caption",async()=>{
 expect((await type("")).value).toBe("");await type("직접 쓴 새 설명");await click("변경 내용 저장");expect(saved.finishedDeck!.pages[0].altText).toBe("직접 쓴 새 설명");expect(saved.caption).toBe("직접 쓴 캡션");
});
it("saves pending edits before generating, applies only descriptions, and persists them",async()=>{
 await type("생성 전 수정");await click("대체텍스트 자동 생성");
 const call=mocks.api.mock.calls.find(([path])=>path.endsWith("/imported-ai"))!;expect(call[1].body).toMatchObject({provider:"gemini",mode:"alt",version:2});
 await click("대체텍스트에 적용");await click("변경 내용 저장");expect(saved.finishedDeck!.pages[0].altText).toBe("생성된 첫 그림 설명");expect(saved.caption).toBe("직접 쓴 캡션");
});
it("keeps manual entry and saving available without any configured AI",async()=>{
 await act(async()=>{client.setQueryData(["studio-ai-status"],{defaultProvider:"openai",text:{gemini:false,openai:false,anthropic:false}});});await settle();
 expect(host.textContent).toContain("직접 입력·저장은 바로 사용할 수 있어요");expect([...host.querySelectorAll("button")].find(b=>b.textContent==="대체텍스트 자동 생성")?.disabled).toBe(true);
 const el=await type("AI 없이 입력");expect(el.disabled).toBe(false);await click("변경 내용 저장");expect(saved.finishedDeck!.pages[0].altText).toBe("AI 없이 입력");
});

it("accepts exactly 125 Unicode characters and caps pasted input without splitting emoji", async () => {
 const boundary = "가".repeat(124) + "😀";
 expect((await type(boundary)).value).toBe(boundary);
 expect(host.textContent).toContain("125 / 125자");
 expect((await type(boundary + "더")).value).toBe(boundary);
 await click("변경 내용 저장");
 expect(saved.finishedDeck!.pages[0].altText).toBe(boundary);
});

it("keeps Korean IME composition intact and enforces the limit when composition ends", async () => {
 const prefix = "가".repeat(124);
 const field = await type(prefix);
 await act(async()=>field.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"ㅎ"})));
 await type(prefix + "ㅎㅏ");
 expect(field.value).toBe(prefix + "ㅎㅏ");
 await type(prefix + "하");
 await act(async()=>field.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"하"})));
 expect(field.value).toBe(prefix + "하");
 expect(host.textContent).toContain("125 / 125자");
 await click("변경 내용 저장");
 expect(saved.finishedDeck!.pages[0].altText).toBe(prefix + "하");
});

it("preserves legacy overflow until the operator explicitly shortens it", async () => {
 const legacy = "가".repeat(126);
 saved = {...saved, version: 2, finishedDeck: {pages: saved.finishedDeck!.pages.map((page, i) => i === 0 ? {...page, altText: legacy} : page)}};
 await act(async()=>root.render(createElement(QueryClientProvider,{client},createElement(FinishedDeckEditor,{data:{card:saved,revisions:[],jobs:[]}}))));
 await settle();
 expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="1페이지 대체텍스트"]')!.value).toBe(legacy);
 expect(host.textContent).toContain("1~2문장");
 expect(host.textContent).toContain("126 / 125자");
 expect(host.textContent).toContain("기존 문구는 자동 삭제하지 않습니다.");
 expect(mocks.api.mock.calls.some(([_, opts]) => opts?.method === "PATCH")).toBe(false);
 await type(legacy.slice(0, -1));
 await click("변경 내용 저장");
 expect(saved.finishedDeck!.pages[0].altText).toBe("가".repeat(125));
});

it("blocks saving three adjacent or quoted sentences", async () => {
 for (const text of ["첫 문장.둘째 문장.셋째 문장.", "“첫 문장.” “둘째 문장.” “셋째 문장.”"]) {
  await type(text);
  const saveButton = [...host.querySelectorAll("button")].find(b => b.textContent === "변경 내용 저장")!;
  expect(saveButton.disabled).toBe(true);
  expect(host.textContent).toContain("1~2문장으로 작성해 주세요.");
 }
 expect(mocks.api.mock.calls.some(([_, opts]) => opts?.method === "PATCH")).toBe(false);
});
