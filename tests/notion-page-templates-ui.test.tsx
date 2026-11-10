// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NotionCardEditor} from '../client/src/NotionCardEditor';
import {activateDraftRecoveryScope} from '../client/src/draftRecovery';
import type {NotionStudioDetail} from '../shared/notionStudio';

const mocks=vi.hoisted(()=>({api:vi.fn(),blob:vi.fn(),guard:{setDirty:vi.fn(),confirmLeave:vi.fn((action:()=>void)=>action())}}));
vi.mock('../client/src/api',async original=>({...await original<object>(),api:mocks.api,apiBlob:mocks.blob}));
vi.mock('../client/src/state',()=>({useDirtyGuard:()=>mocks.guard}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let host:HTMLDivElement,root:Root,client:QueryClient,detail:NotionStudioDetail;
const onDirtyChange=()=>undefined;
const original='본문 첫 문단을 그대로 보존합니다.';
function fixture():NotionStudioDetail{
 return {
  link:{id:18,version:4,pageId:'4135c7c8-45fc-8101-ba1c-000000000001',notionUrl:'https://www.notion.so/fixture',channelId:3,itemId:28,studioCardId:39,title:'템플릿 작업',sourceHash:'a'.repeat(64),lastEditedAt:'2026-11-10T00:00:00.000Z',lastSyncedAt:'2026-11-10T00:00:00.000Z',autoSync:true,lastCheckedAt:null,coverStyle:'A',status:'synced',studioUrl:'/studio/39',canva:{phase:'idle'},photoCount:2},
  itemVersion:7,copy:{version:1,templateKey:'highscoop-a',cover:{title:'표지 제목',subtitle:'표지 설명'},pages:[{id:'one',title:'첫 내지',subtitle:'',body:'기준 안내\n\n'+original},{id:'two',title:'둘째 내지',subtitle:'',body:'두 번째 원고입니다.'}]},
  photos:[{id:101,name:'실험 사진.jpg',mimeType:'image/jpeg',width:1080,height:1350,url:'/api/notion/links/18/photos/101'},{id:102,name:'수료 사진.png',mimeType:'image/png',width:1080,height:1350,url:'/api/notion/links/18/photos/102'}],
  source:{title:'템플릿 작업',coverTitle:'표지 제목',pages:[{index:1,key:'row-cover',title:'표지 제목',body:'표지 설명'},{index:2,key:'row-one',title:'첫 내지',body:'기준 안내\n\n'+original,cardFields:{subtitle:'기준 안내',body:original,footnote:'원문 각주 유지',sourceLabel:'공식 공고'},emphasis:'본문'},{index:3,key:'row-two',title:'둘째 내지',body:'두 번째 원고입니다.'}],sourceReferences:[{title:'GED',url:'https://ged.kedi.re.kr/'}]},warnings:[],
 };
}
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();sessionStorage.clear();detail=fixture();
 mocks.blob.mockResolvedValue(new Blob(['preview'],{type:'image/jpeg'}));
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>`blob:preview-${mocks.blob.mock.calls.length}`)});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 mocks.api.mockImplementation(async(path:string,options:{body?:any;method?:string}={})=>{
  if(path!=='/notion/links/18/copy'||options.method!=='PATCH')throw Error('Unexpected request: '+path);
  detail={...detail,copy:structuredClone(options.body.copy),designEdits:structuredClone(options.body.designEdits),itemVersion:detail.itemVersion+1};
  return structuredClone(detail);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.useRealTimers();});
async function settle(){await act(async()=>{await Promise.resolve();});}
async function render(){await act(async()=>root.render(<QueryClientProvider client={client}><NotionCardEditor data={detail} onDirtyChange={onDirtyChange}/></QueryClientProvider>));await settle();}
function field(name:string){const result=host.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>(`[aria-label="${name}"]`);if(!result)throw Error('Missing field: '+name);return result;}
async function fill(name:string,value:string){const node=field(name);await act(async()=>{Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});await settle();}
function button(name:string){const result=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===name);if(!result)throw Error('Missing button: '+name);return result;}
async function click(name:string){expect(button(name).disabled).toBe(false);await act(async()=>button(name).click());await settle();}
async function page(index:number){await act(async()=>host.querySelectorAll<HTMLButtonElement>('.notion-card-strip button')[index].click());await settle();}
async function preview(){await act(async()=>{await vi.advanceTimersByTimeAsync(500);});await settle();return mocks.blob.mock.calls.at(-1)?.[2]?.body;}
const writes=()=>mocks.api.mock.calls;

describe('page-level interior template authoring',()=>{
 it('preserves dirty template input through Canva job version updates and saves against the latest request version',async()=>{
  detail.link.canvaAutoSave={enabled:true,phase:'queued'};await render();await page(1);await fill('내지 템플릿','text');await fill('카드 본문','작성 중인 내지 원고');await preview();
  const previews=mocks.blob.mock.calls.length;
  for(const [version,phase] of [[5,'queued'],[6,'processing'],[7,'idle']] as const){
   detail={...detail,link:{...detail.link,version,canvaAutoSave:{enabled:true,phase},canva:{phase:phase==='idle'?'ready':'importing',designId:'Dlatest',editUrl:'https://www.canva.com/design/Dlatest/edit',currentSource:phase==='idle'}}};await render();
   expect(field('카드 본문').value).toBe('작성 중인 내지 원고');expect(field('내지 템플릿').value).toBe('text');expect(host.textContent).not.toContain('다른 곳에서 새 버전을 저장했습니다.');expect(button('스튜디오에 저장').disabled).toBe(false);
  }
  await preview();expect(mocks.blob.mock.calls).toHaveLength(previews);
  await click('스튜디오에 저장');expect(writes()).toHaveLength(1);expect(writes()[0][1].body).toMatchObject({version:7,itemVersion:7,designEdits:{templateByPage:{'row-one':'text'}}});expect(writes()[0][1].body.copy.pages[0].body).toBe('기준 안내\n\n작성 중인 내지 원고');expect(writes()[0][1].body.copy.pages).toHaveLength(2);
  expect(host.textContent).toContain('잠시 뒤 캔바에 편집 가능한 디자인으로 자동 저장됩니다.');
 });
 it('still protects dirty text when the cover or protected source changes without an item revision',async()=>{
  detail.link.canvaAutoSave={enabled:true,phase:'queued'};await render();await page(1);await fill('카드 본문','아직 저장하지 않은 원고');
  detail={...detail,link:{...detail.link,version:5,coverStyle:'B'}};await render();
  expect(field('카드 본문').value).toBe('아직 저장하지 않은 원고');expect(host.textContent).toContain('다른 곳에서 새 버전을 저장했습니다.');expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(0);
 });
 it('ignores an older job poll that arrives after a newer manuscript save',async()=>{
  detail.link.canvaAutoSave={enabled:true,phase:'queued'};const stale=structuredClone(detail);await render();await fill('카드 제목','새로 저장한 원고');await click('스튜디오에 저장');
  detail=stale;await render();expect(field('카드 제목').value).toBe('새로 저장한 원고');expect(host.textContent).not.toContain('다른 곳에서 새 버전을 저장했습니다.');expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(1);
 });
 it('reports a saved manuscript separately from a failed automatic Canva save',async()=>{
  detail.link.canvaAutoSave={enabled:true,phase:'failed',error:'캔바 연결을 확인해 주세요.'};await render();await fill('카드 제목','스튜디오에 남는 제목');await click('스튜디오에 저장');
  expect(host.textContent).toContain('스튜디오에 저장했습니다. 캔바 자동 저장은 아래 상태를 확인해 주세요.');expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(1);expect(detail.copy.cover.title).toBe('스튜디오에 남는 제목');
 });
 it('shows the editable continuation link only after the latest saved deck is ready',async()=>{
  detail.link.canvaAutoSave={enabled:true,phase:'queued'};detail.link.canva={phase:'ready',designId:'Dprevious',editUrl:'https://www.canva.com/design/Dprevious/edit',currentSource:false};await render();
  expect([...host.querySelectorAll('a')].some(node=>node.textContent==='캔바에서 이어서 편집 ↗')).toBe(false);
  detail={...detail,link:{...detail.link,version:5,canvaAutoSave:{enabled:true,phase:'idle'},canva:{phase:'ready',designId:'Dlatest',editUrl:'https://www.canva.com/design/Dlatest/edit',currentSource:true}}};await render();
  const link=[...host.querySelectorAll('a')].find(node=>node.textContent==='캔바에서 이어서 편집 ↗');expect(link?.getAttribute('href')).toBe('https://www.canva.com/design/Dlatest/edit');expect(writes()).toHaveLength(0);
 });
 it('keeps incompatible source copy until an explicitly entered table is applied, then saves the protected subtitle and source notes',async()=>{
  await render();expect(host.querySelector('[aria-label="내지 템플릿"]')).toBeNull();await page(1);
  await fill('내지 템플릿','table');expect(field('카드 본문').value).toBe(original);expect(writes()).toHaveLength(0);
  await fill('1열 머리글','지역');await fill('2열 머리글','마감일');await fill('1행 1열','서울');await fill('1행 2열','11/11');
  expect(field('카드 본문').value).toBe(original);await click('표 내용 적용');
  expect(field('카드 본문').value).toBe('지역 | 마감일\n서울 | 11/11');
  const request=await preview();expect(request.designEdits.templateByPage).toEqual({'row-one':'table'});expect(request.copy.pages[0].body).toBe('기준 안내\n\n지역 | 마감일\n서울 | 11/11');
  await click('스튜디오에 저장');expect(writes()).toHaveLength(1);expect(detail.source.pages[1].cardFields).toEqual({subtitle:'기준 안내',body:original,footnote:'원문 각주 유지',sourceLabel:'공식 공고'});expect(detail.source.sourceReferences).toEqual([{title:'GED',url:'https://ged.kedi.re.kr/'}]);
 });
 it('retains independent page templates and chosen photos through navigation, emphasis editing, preview and save',async()=>{
  await render();await page(1);await fill('내지 템플릿','image_text');await fill('페이지 사진','102');await fill('강조문구','첫 문단');
  await page(2);await fill('내지 템플릿','text');await page(1);
  expect(field('내지 템플릿').value).toBe('image_text');expect(field('페이지 사진').value).toBe('102');expect(field('강조문구').value).toBe('첫 문단');expect(field('카드 본문').value).toBe(original);
  const request=await preview();expect(request.designEdits).toMatchObject({templateByPage:{'row-one':'image_text','row-two':'text'},photoByPage:{'row-one':102},emphasisByPage:{'row-one':'첫 문단'}});
  await click('스튜디오에 저장');expect(detail.designEdits).toEqual(request.designEdits);expect(writes()).toHaveLength(1);
  await page(0);expect(host.querySelector('[aria-label="내지 템플릿"]')).toBeNull();await page(3);expect(host.querySelector('[aria-label="내지 템플릿"]')).toBeNull();await page(4);expect(host.querySelector('[aria-label="내지 템플릿"]')).toBeNull();
 });
 it('preserves an un-applied two-column draft across page navigation and only replaces the body on apply',async()=>{
  await render();await page(1);await fill('내지 템플릿','two_columns');await fill('왼쪽 본문','왼쪽 비교 내용');await fill('오른쪽 본문','오른쪽 비교 내용');expect(field('카드 본문').value).toBe(original);expect(button('스튜디오에 저장').disabled).toBe(true);
  expect(await preview()).toBeUndefined();expect(mocks.blob).not.toHaveBeenCalled();expect(host.textContent).toContain('구성 내용을 입력하고 ‘내용 적용’을 눌러 미리보기를 확인하세요.');expect(writes()).toHaveLength(0);
  await page(2);await page(1);expect(field('왼쪽 본문').value).toBe('왼쪽 비교 내용');expect(field('오른쪽 본문').value).toBe('오른쪽 비교 내용');await click('2단 내용 적용');
  expect(field('카드 본문').value).toBe('왼쪽 비교 내용\n---\n오른쪽 비교 내용');const appliedPreview=await preview();expect(appliedPreview).not.toHaveProperty('interiorInputs');expect(appliedPreview.copy.pages[0].body).toBe('기준 안내\n\n왼쪽 비교 내용\n---\n오른쪽 비교 내용');await click('스튜디오에 저장');expect(detail.copy.pages[0].body).toBe('기준 안내\n\n왼쪽 비교 내용\n---\n오른쪽 비교 내용');
 });
 it.each(['table','process','timeline','two_columns','bar_chart'] as const)('waits for compatible %s content instead of previewing or saving the old prose in the new template',async template=>{
  await render();await page(1);await fill('내지 템플릿',template);expect(field('카드 본문').value).toBe(original);await preview();expect(mocks.blob).not.toHaveBeenCalled();expect(writes()).toHaveLength(0);expect(button('스튜디오에 저장').disabled).toBe(true);expect(host.textContent).toContain('구성 내용을 입력하고 ‘내용 적용’을 눌러 미리보기를 확인하세요.');
 });
 it('waits for an actual page photo before previewing or saving a photo-and-text template',async()=>{
  detail.photos=detail.photos.slice(0,1);detail.link.photoCount=1;await render();await page(1);await fill('내지 템플릿','image_text');await preview();expect(mocks.blob).not.toHaveBeenCalled();expect(button('스튜디오에 저장').disabled).toBe(true);expect(host.textContent).toContain('페이지 사진을 선택해 주세요.');expect(field('카드 본문').value).toBe(original);expect(writes()).toHaveLength(0);
  await fill('페이지 사진','101');const request=await preview();expect(request.designEdits).toMatchObject({templateByPage:{'row-one':'image_text'},photoByPage:{'row-one':101}});expect(button('스튜디오에 저장').disabled).toBe(false);await click('스튜디오에 저장');expect(writes()).toHaveLength(1);expect(detail.copy.pages[0].body).toBe('기준 안내\n\n'+original);
 });
 it('recovers the selected template and un-applied structured input after closing and reopening the editor',async()=>{
  const scope='notion-page-template-recovery';activateDraftRecoveryScope(scope);client.setQueryDefaults(['me'],{gcTime:Infinity});client.setQueryData(['me'],{user:'fixture',recoveryScope:scope});
  await render();await page(1);await fill('내지 템플릿','two_columns');await fill('왼쪽 본문','닫기 전 왼쪽 초안');await fill('오른쪽 본문','닫기 전 오른쪽 초안');expect(host.textContent).toContain('이 기기에 임시 보관됨');expect(writes()).toHaveLength(0);
  await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.querySelector('[aria-label="카드 편집 기기 복구본"]')).toBeTruthy();expect(detail.designEdits).toBeUndefined();
  await click('복구본을 편집기에 불러오기');await page(1);expect(field('내지 템플릿').value).toBe('two_columns');expect(field('왼쪽 본문').value).toBe('닫기 전 왼쪽 초안');expect(field('오른쪽 본문').value).toBe('닫기 전 오른쪽 초안');expect(field('카드 본문').value).toBe(original);expect(button('스튜디오에 저장').disabled).toBe(true);expect(writes()).toHaveLength(0);
  await click('2단 내용 적용');await click('스튜디오에 저장');expect(detail.copy.pages[0].body).toBe('기준 안내\n\n닫기 전 왼쪽 초안\n---\n닫기 전 오른쪽 초안');expect(detail.designEdits?.templateByPage).toEqual({'row-one':'two_columns'});expect(writes()).toHaveLength(1);
 });
 it('returns one page to its source layout without changing its copy or another page override',async()=>{
  await render();await page(1);await fill('내지 템플릿','text');await page(2);await fill('내지 템플릿','text');await page(1);await fill('내지 템플릿','auto');expect(field('카드 본문').value).toBe(original);
  const request=await preview();expect(request.designEdits.templateByPage).not.toHaveProperty('row-one');expect(request.designEdits.templateByPage).toMatchObject({'row-two':'text'});await click('스튜디오에 저장');expect(detail.copy.pages[0].body).toBe('기준 안내\n\n'+original);
 });
 it('opens an existing table as individual cells and preserves untouched cells during a round trip',async()=>{
  detail.copy.pages[0].body='기준 안내\n\n지역 | 마감일\n서울 | 11/11\n충남 | 11/12';
  await render();await page(1);await fill('내지 템플릿','table');expect(field('1열 머리글').value).toBe('지역');expect(field('2행 1열').value).toBe('충남');await fill('2행 2열','11/13');await click('표 내용 적용');
  expect(field('카드 본문').value).toBe('지역 | 마감일\n서울 | 11/11\n충남 | 11/13');await click('스튜디오에 저장');expect(detail.copy.pages[0].body).toBe('기준 안내\n\n지역 | 마감일\n서울 | 11/11\n충남 | 11/13');
 });
});
