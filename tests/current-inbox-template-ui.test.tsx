// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EditPanel} from '../client/src/pages/ItemDetail';
import {editorialTemplateCatalogOptions,templateCatalogOptions} from '../shared/templateCatalog';
import {emptyPayload} from '../shared/payloads';
const mocks=vi.hoisted(()=>({api:vi.fn(),guard:{setDirty:vi.fn(),confirmLeave:(action:()=>void)=>action()}}));
const channel={id:2,slug:'news',name:'알리고당',accentColor:'#FF493B',active:true};
vi.mock('../client/src/api',async original=>({...await original<object>(),api:mocks.api}));
vi.mock('../client/src/state',()=>({useChannel:()=>({selected:2,current:channel,channels:[channel],allChannels:[channel]}),useDirtyGuard:()=>mocks.guard}));
vi.mock('../client/src/toast',()=>({useToast:()=>vi.fn()}));
vi.mock('wouter',async original=>({...await original<object>(),useLocation:()=>['/items/2/21527',vi.fn()],useSearch:()=>''}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLDivElement,client:QueryClient;
beforeEach(()=>{
 vi.clearAllMocks();sessionStorage.clear();localStorage.clear();
 mocks.api.mockImplementation(async(path:string,options?:{method?:string})=>{
  if(options?.method&&options.method!=='GET')throw new Error('Template selection must not write or generate');
  if(path==='/channels/2/templates')return {current:'editorial:red',items:[...editorialTemplateCatalogOptions(channel),...templateCatalogOptions()]};
  if(path==='/status')return {integrations:{gemini:true,openai:true,anthropic:false}};
  throw new Error(`Unexpected Inbox template request: ${path}`);
 });
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();});
describe('Alligodang Inbox content template selection',()=>{
 it('opens the real Inbox editor picker with one news master and keeps the saved draft untouched',async()=>{
  const onChange=vi.fn(),payload=emptyPayload('science_dialogue','저장된 기사 원고');
  const detail:any={item:{id:21527,channelId:2,title:'수집한 기사',kind:'science_dialogue',version:3,edited:payload},current:{id:30,revisionNo:3,payload},primary:null,linked:[],imageAiAvailable:true};
  const original=structuredClone(detail);
  await act(async()=>root.render(<QueryClientProvider client={client}><EditPanel d={detail} cid={2} onTemplateChange={onChange}/></QueryClientProvider>));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  const toggle=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.startsWith('문구를 작성할 템플릿:'))!;
  await act(async()=>toggle.click());
  const picker=host.querySelector('[data-testid="current-template-picker"]')!;
  expect(picker.querySelectorAll('.highscoop-kit-card')).toHaveLength(1);
  expect([...picker.querySelectorAll('.highscoop-kit-category')].map(node=>node.textContent)).toEqual(['뉴스']);
  for(const old of ['포토 디스패치','캠퍼스 에디토리얼','BANG BANG','기존 버전'])expect(picker.textContent).not.toContain(old);
  await act(async()=>picker.querySelector<HTMLButtonElement>('[aria-label="뉴스 마스터 선택"]')!.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith('editorial:cyan');
  expect(detail).toEqual(original);
  expect(mocks.api.mock.calls.some(([,options])=>options?.method&&options.method!=='GET')).toBe(false);
 });
});
