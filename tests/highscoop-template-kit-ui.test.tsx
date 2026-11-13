// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DesignPage} from '../client/src/pages/Design';
import {HighScoopTemplateKit} from '../client/src/HighScoopTemplateKit';
import {HIGH_SCOOP_TEMPLATE_KITS} from '../shared/highscoopTemplates';
import {editorialTemplateCatalogOptions} from '../shared/templateCatalog';
import {CreativeProfileFields} from '../client/src/CreativeProfileFields';
import {creativeProfileFor} from '../shared/creativeProfile';

const mocks=vi.hoisted(()=>({api:vi.fn(),toast:vi.fn(),selected:3 as number|'all'}));
const channels=[
 {id:3,name:'HighScoop',slug:'highscoop',accentColor:'#FF493B',contentType:'opportunities'},
 {id:5,name:'알리고당',slug:'news',accentColor:'#663399',contentType:'news'},
];
vi.mock('../client/src/api',async original=>({...await original<object>(),api:mocks.api}));
vi.mock('../client/src/state',()=>({useChannel:()=>({selected:mocks.selected,current:channels.find(c=>c.id===mocks.selected)??null}),useDirtyGuard:()=>({confirmLeave:(action:()=>void)=>action()})}));
vi.mock('../client/src/toast',()=>({useToast:()=>mocks.toast}));
vi.mock('../client/src/RegisteredCardDesigns',()=>({RegisteredCardDesigns:()=> <div>기존 등록 디자인 목록</div>}));
vi.mock('../client/src/CanvaTemplateLibrary',()=>({CanvaTemplateLibrary:()=> <div>기존 8장 Canva 라이브러리</div>}));
vi.mock('../client/src/CanvaEditorial',()=>({CanvaMasterSettings:()=> <div>기존 Canva 마스터 설정</div>}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLDivElement,client:QueryClient,current:string;
beforeEach(()=>{
 vi.clearAllMocks();mocks.selected=3;current='highscoop-a';
 mocks.api.mockImplementation(async(path:string,options?:{method?:string;body?:any})=>{
  if(path==='/channels/3/design'&&options?.method==='PUT'){current=options.body.cardTemplate;return {ok:true};}
  if(/^\/channels\/(3|5)\/templates$/.test(path))return {current,items:editorialTemplateCatalogOptions(channels.find(channel=>path===`/channels/${channel.id}/templates`)!) };
  if(path==='/canva/status')return {configured:false,connected:false,scopes:[],redirectUri:'https://example.test/api/canva/callback'};
  throw new Error(`Unexpected template UI request: ${path}`);
 });
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();});
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});}
async function render(content=<DesignPage/>){await act(async()=>root.render(<QueryClientProvider client={client}>{content}</QueryClientProvider>));await settle();}
async function click(node:HTMLButtonElement){expect(node).toBeTruthy();expect(node.disabled).toBe(false);await act(async()=>node.click());await settle();}
const writes=()=>mocks.api.mock.calls.filter(([,options])=>options?.method&&options.method!=='GET');

describe('HighScoop current category masters',()=>{
 it('replaces the old library with six masters and explicitly saves the selected channel default',async()=>{
  await render();
  expect(host.querySelectorAll('[aria-label="하이스쿱 마스터 6종"] button')).toHaveLength(6);
  expect(host.textContent).not.toContain('기존 등록 디자인 목록');expect(host.textContent).not.toContain('기존 8장 Canva 라이브러리');
  expect(host.textContent).not.toContain('내 배경 템플릿');expect(host.querySelector('input[type="file"]')).toBeNull();
  expect(host.textContent).toContain('현재 기본값은 이전 디자인');
  await click(host.querySelector<HTMLButtonElement>('[aria-label="뉴스 마스터 선택"]')!);
  expect(host.querySelector('[aria-label="뉴스 마스터 선택"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).toContain('뉴스 · 내지 종류');expect(writes()).toHaveLength(0);
  const apply=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='이 마스터를 기본으로 사용')!;
  await click(apply);
  expect(writes()).toEqual([['/channels/3/design',{method:'PUT',body:{cardTemplate:'highscoop:news'}}]]);
  expect(host.textContent).not.toContain('현재 기본값은 이전 디자인');
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='현재 기본 마스터')?.disabled).toBe(true);
  expect(mocks.toast).toHaveBeenCalledWith('ok',expect.stringContaining('기본 마스터를 저장'));
 });

 it('uses the same single current news master for Alligodang without old galleries or upload choices',async()=>{
  mocks.selected=5;await render();
  expect(host.querySelectorAll('[aria-label="알리고당 마스터 1종"] button')).toHaveLength(1);
  expect(host.textContent).not.toContain('기존 등록 디자인 목록');expect(host.textContent).not.toContain('기존 8장 Canva 라이브러리');
  expect(host.textContent).not.toContain('내 배경 템플릿');expect(host.querySelector('input[type="file"]')).toBeNull();
  expect([...host.querySelectorAll('.highscoop-kit-category')].map(node=>node.textContent)).toEqual(['뉴스']);
  expect(host.querySelector('img')?.getAttribute('src')).toContain('/api/channels/5/templates/preview?');expect(host.querySelector('img')?.getAttribute('src')).toContain('&kit=2026-11-13-news');expect(writes()).toHaveLength(0);
 });

 it('shows the cyan News choice for an old current Alligodang color without writing',async()=>{
  await render(<HighScoopTemplateKit brandName="알리고당" items={editorialTemplateCatalogOptions({slug:'news'})} value="editorial:red" onSelect={mocks.toast}/>);
  const button=host.querySelector<HTMLButtonElement>('[aria-label="뉴스 마스터 선택"]')!;
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.closest('article')?.style.getPropertyValue('--kit-color')).toBe('#57C7E3');
  expect(host.querySelector('[aria-label="알리고당 마스터 1종"]')).not.toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();expect(writes()).toHaveLength(0);
 });

 it('offers only News in Alligodang creative defaults while retaining six HighScoop categories',async()=>{
  const changed=vi.fn(),profile={...creativeProfileFor({slug:'news'}),defaultTemplate:'editorial:red' as const};
  await render(<CreativeProfileFields channel={{slug:'news'}} value={profile} onChange={changed}/>);
  const select=()=>[...host.querySelectorAll<HTMLSelectElement>('select')].find(node=>node.closest('label')?.textContent?.startsWith('기본 디자인'))!;
  expect([...select().options].map(option=>option.value)).toEqual(['editorial:cyan']);expect(select().value).toBe('editorial:cyan');expect(changed).not.toHaveBeenCalled();
  await render(<CreativeProfileFields channel={{slug:'highscoop'}} value={creativeProfileFor({slug:'highscoop'})} onChange={changed}/>);
  expect(select().options).toHaveLength(6);
 });

 it('keeps read-only master previews selected and links directly to available Canva originals',async()=>{
  await render(<HighScoopTemplateKit compact/>);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="말풍선 마스터 미리보기"]')!);
  expect(host.querySelector('[aria-label="말풍선 마스터 미리보기"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).toContain('말풍선 · 내지 종류');expect(writes()).toHaveLength(0);
  for(const kit of HIGH_SCOOP_TEMPLATE_KITS){
   const card=host.querySelector<HTMLButtonElement>(`[aria-label="${kit.category} 마스터 미리보기"]`)!.closest('article')!;
   if(kit.canvaEditUrl)expect(card.querySelector('a')?.href).toBe(kit.canvaEditUrl);
   else{expect(card.querySelector('a')).toBeNull();expect(card.textContent).toContain('Canva 원본 준비 중');}
  }
 });
});
