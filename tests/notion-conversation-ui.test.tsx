// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NotionConversation} from '../client/src/NotionConversation';
import {activateDraftRecoveryScope} from '../client/src/draftRecovery';
import type {NotionDesignEdits,NotionStudioDetail} from '../shared/notionStudio';
import {defaultNotionProductionProfile,notionConversationSignature,type NotionConversationResult} from '../shared/notionConversation';

const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../client/src/api',async original=>({...await original<object>(),api:mocks.api}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let host:HTMLDivElement,root:Root,client:QueryClient,data:NotionStudioDetail,selected:number,applied:ReturnType<typeof vi.fn<(result:NotionConversationResult)=>boolean>>,undo:ReturnType<typeof vi.fn<()=>void>>;
let draft:{copy:NotionStudioDetail['copy'];designEdits:NotionDesignEdits};
function fixture():NotionStudioDetail{
 return {
  link:{id:18,version:4,pageId:'fixture',notionUrl:'https://www.notion.so/fixture',channelId:3,itemId:28,studioCardId:39,title:'추천서 부탁하기',sourceHash:'a'.repeat(64),lastEditedAt:'2026-11-11T00:00:00.000Z',lastSyncedAt:'2026-11-11T00:00:00.000Z',autoSync:true,lastCheckedAt:null,coverStyle:'A',status:'synced',studioUrl:'/studio/39',canva:{phase:'idle'},photoCount:0},
  itemVersion:7,copy:{version:1,templateKey:'highscoop-a',cover:{title:'표지 제목',subtitle:'표지 설명'},pages:[{id:'one',title:'봉투를 보냈어요',subtitle:'',body:'기준 안내\n\n원래 쓰던 경험담입니다.'},{id:'two',title:'둘째 내지',subtitle:'',body:'이 장은 그대로입니다.'}]},
  photos:[],source:{title:'추천서 부탁하기',coverTitle:'표지 제목',pages:[{index:1,key:'cover',title:'표지 제목',body:'표지 설명'},{index:2,key:'one',title:'봉투를 보냈어요',body:'기준 안내\n\n원래 쓰던 경험담입니다.',cardFields:{subtitle:'기준 안내',body:'원래 쓰던 경험담입니다.',footnote:'개인 경험',sourceLabel:''}},{index:3,key:'two',title:'둘째 내지',body:'이 장은 그대로입니다.'}],teaser:{title:'연구계획서',body:'다음 편'}},warnings:[],
 };
}
const response=():NotionConversationResult=>({page:selected,sourceSignature:notionConversationSignature(draft.copy,draft.designEdits,selected),patch:{title:'아이 편에 봉투를 보냈어요',body:'자료는 제가 챙기고, 부탁은 아이가 직접 했죠ㅎㅎ.',emphasis:'아이가 직접',template:'text'},summary:'경험담처럼 편하게 다듬었어요.'});
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();sessionStorage.clear();data=fixture();draft={copy:structuredClone(data.copy),designEdits:{emphasisByPage:{}}};selected=1;applied=vi.fn<(result:NotionConversationResult)=>boolean>(()=>true);undo=vi.fn<()=>void>();
 activateDraftRecoveryScope('conversation-test-scope-20261111');
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});client.setQueryDefaults(['me'],{gcTime:Infinity});client.setQueryData(['me'],{user:'fixture',recoveryScope:'conversation-test-scope-20261111'});
 mocks.api.mockImplementation(async(path:string,options:{body?:any;method?:string}={})=>{
  if(path.endsWith('/production-profile'))return {version:options.method==='PUT'?1:0,profile:options.body?.profile??defaultNotionProductionProfile()};
  if(path.endsWith('/conversation'))return response();throw Error('Unexpected request: '+path);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();});
async function settle(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
async function render(){await act(async()=>root.render(<QueryClientProvider client={client}><NotionConversation data={data} draft={draft} selectedPage={selected} onApply={applied} onUndo={undo} canUndo={true}/></QueryClientProvider>));await settle();}
function field(name:string){const node=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${name}"]`);if(!node)throw Error('Missing field: '+name);return node;}
function button(name:string){const node=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!node)throw Error('Missing button: '+name);return node;}
async function fill(name:string,value:string){const node=field(name);await act(async()=>{Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});await settle();}
async function click(name:string){expect(button(name).disabled).toBe(false);await act(async()=>button(name).click());await settle();}
async function openProfile(){const node=host.querySelector<HTMLDetailsElement>('.notion-production-profile')!;await act(async()=>{node.open=true;node.dispatchEvent(new Event('toggle'));});await settle();}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

describe('selected-card conversation',()=>{
 it('loads channel standards only when opened and leaves the card draft untouched when saving them',async()=>{
  await render();expect(mocks.api).not.toHaveBeenCalled();const original=structuredClone(draft);await openProfile();
  expect(mocks.api).toHaveBeenCalledTimes(1);expect(field('우리 채널 말투').value).toContain('워킹맘');
  await fill('우리 채널 말투','친한 엄마에게 이야기하듯 편하게');expect(button('2장 수정 부탁하기').disabled).toBe(true);await click('제작 기준 저장');
  expect(mocks.api.mock.calls[1][1]).toMatchObject({method:'PUT',body:{version:0,profile:{voice:'친한 엄마에게 이야기하듯 편하게'}}});expect(draft).toEqual(original);expect(applied).not.toHaveBeenCalled();
  expect(host.textContent).toContain('다음 수정 요청부터 참고합니다.');
 });
 it('sends the selected unsaved card and shows a proposal before applying it',async()=>{
  await render();const original=structuredClone(draft);await fill('카드 수정 요청','조금 덜 딱딱하게 써줘');await click('2장 수정 부탁하기');
  expect(mocks.api).toHaveBeenCalledTimes(1);const [path,options]=mocks.api.mock.calls[0];expect(path).toBe('/notion/links/18/conversation');expect(options.body).toMatchObject({version:4,itemVersion:7,page:1,instruction:'조금 덜 딱딱하게 써줘',copy:draft.copy,designEdits:draft.designEdits,history:[]});
  expect(applied).not.toHaveBeenCalled();expect(draft).toEqual(original);expect(host.textContent).toContain('현재');expect(host.textContent).toContain('자료는 제가 챙기고');expect(host.textContent).toContain('형광펜 강조:');
  await click('이 장에 적용');expect(applied).toHaveBeenCalledTimes(1);expect(applied.mock.calls[0][0].page).toBe(1);expect(host.textContent).toContain('미리보기를 확인하고 스튜디오에 저장해 주세요.');await click('직전 수정 되돌리기');expect(undo).toHaveBeenCalledTimes(1);
 });
 it('discards an in-flight result if another card is selected',async()=>{
  const waiting=deferred<NotionConversationResult>();mocks.api.mockReturnValue(waiting.promise);await render();await fill('카드 수정 요청','편한 말투로');const old=response();await click('2장 수정 부탁하기');
  const signal=mocks.api.mock.calls[0][1].signal as AbortSignal;selected=2;await render();expect(signal.aborted).toBe(true);await act(async()=>waiting.resolve(old));await settle();
  expect(applied).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeNull();expect(host.textContent).toContain('카드나 원고가 바뀌어');expect(field('카드 수정 요청').disabled).toBe(false);
 });
 it('drops a proposal when the draft changes before apply',async()=>{
  await render();await fill('카드 수정 요청','편하게');await click('2장 수정 부탁하기');expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeTruthy();
  draft={...draft,copy:{...draft.copy,pages:draft.copy.pages.map((p,i)=>i===0?{...p,body:'직접 수정한 새 원고'}:p)}};await render();
  expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeNull();expect(applied).not.toHaveBeenCalled();expect(host.textContent).toContain('원고가 바뀌어 이전 제안은 적용하지 않았어요.');
 });
 it('cancels a request and restores the instruction without applying a late answer',async()=>{
  const waiting=deferred<NotionConversationResult>();mocks.api.mockReturnValue(waiting.promise);await render();await fill('카드 수정 요청','짧게 써줘');const old=response();await click('2장 수정 부탁하기');await click('요청 멈추기');
  expect((mocks.api.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);expect(field('카드 수정 요청').value).toBe('짧게 써줘');await act(async()=>waiting.resolve(old));await settle();expect(applied).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeNull();
 });
 it('retains bounded history and an unsent instruction when the editor is reopened',async()=>{
  await render();await fill('카드 수정 요청','편하게 써줘');await click('2장 수정 부탁하기');await fill('카드 수정 요청','다음에는 첫 문장만 바꿔줘');
  await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.textContent).toContain('편하게 써줘');expect(host.textContent).toContain('경험담처럼 편하게 다듬었어요.');expect(field('카드 수정 요청').value).toBe('다음에는 첫 문장만 바꿔줘');expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeNull();
  await click('2장 수정 부탁하기');expect(mocks.api.mock.calls.at(-1)?.[1].body.history).toHaveLength(2);expect(mocks.api.mock.calls.at(-1)?.[1].body.history[1].text).toContain('제안 본문:');
 });
 it('keeps history isolated from another authenticated recovery scope',async()=>{
  await render();await fill('카드 수정 요청','개인 자료를 참고해줘');await click('2장 수정 부탁하기');
  await act(async()=>{activateDraftRecoveryScope('another-user-conversation-scope');client.setQueryData(['me'],{user:'another',recoveryScope:'another-user-conversation-scope'});});await settle();
  expect(host.textContent).not.toContain('개인 자료를 참고해줘');expect(field('카드 수정 요청').value).toBe('');expect(host.querySelector('[aria-label="선택한 카드 수정안"]')).toBeNull();
 });
 it('preserves the request after provider failure and never requests a Canva save',async()=>{
  mocks.api.mockRejectedValue(new Error('AI 연결을 확인해 주세요.'));await render();await fill('카드 수정 요청','다시 다듬어줘');await click('2장 수정 부탁하기');expect(host.textContent).toContain('AI 연결을 확인해 주세요.');expect(field('카드 수정 요청').value).toBe('다시 다듬어줘');expect(applied).not.toHaveBeenCalled();expect(mocks.api.mock.calls.every(([path])=>path.endsWith('/conversation'))).toBe(true);
 });
 it('disables conversation generation for automatic closing pages',async()=>{
  selected=3;await render();expect(field('카드 수정 요청').disabled).toBe(true);expect(host.textContent).toContain('본문 카드를 선택하면');expect(mocks.api).not.toHaveBeenCalled();
 });
});
