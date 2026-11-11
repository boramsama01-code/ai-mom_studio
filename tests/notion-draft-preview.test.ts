import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {buildNotionCanvaPptx,type NotionCanvaDocument} from '../server/services/notionCanva';
import {validateNotionStudioDraft} from '../server/services/notionStudio';
import {notionDocumentToCopy} from '../shared/notionStudioCopy';
import type {NotionDocument} from '../shared/notionSync';
import type {NotionDesignEdits} from '../shared/notionStudio';

function manuscript():NotionDocument{
 return {pageId:'4135c7c8-45fc-8101-ba1c-c4839d9445d8',url:'https://www.notion.so/test',lastEditedAt:'2026-11-11T00:00:00.000Z',contentKey:'draft-photo-test',title:'추천서 요청 경험',coverTitle:'봉투를 보냈어요',channel:'HighScoop',category:'영재교육',template:'',stage:'원고 검토',verified:true,caption:'',sourceHash:'a'.repeat(64),photos:[],pages:[
  {index:1,title:'봉투를 보냈어요',body:'추천 요청 경험',headingBlockId:'cover',bodyBlockIds:['cover-body']},
  {index:2,title:'메모 실물',body:'보호한 소제목\n\n제가 보낸 메모입니다.',headingBlockId:'memo',bodyBlockIds:['memo-body'],cardFields:{subtitle:'보호한 소제목',body:'제가 보낸 메모입니다.',footnote:'',sourceLabel:''}},
  {index:3,title:'다음 이야기',body:'평소 모습을 돌아봤어요.',headingBlockId:'story',bodyBlockIds:['story-body']},
 ]};
}
function draftState(){const source=manuscript(),copy=notionDocumentToCopy(source);return {source,copy,state:{link:{sourceSnapshot:source,photoOrder:[]},copy} as unknown as Parameters<typeof validateNotionStudioDraft>[0]};}
const imageDocument=():NotionCanvaDocument=>({title:'추천서 자료 초안',coverStyle:'A',pages:[{title:'봉투를 보냈어요',body:'경험담'},{title:'메모 실물',body:'제가 보낸 메모입니다.',interiorTemplate:'image_text'}]});

beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Draft rendering must not contact a provider');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe('incomplete photo drafts and selected-card previews',()=>{
 it('saves valid draft choices without requiring a photograph, while strict validation still rejects finalization',()=>{
  const {state,copy}=draftState(),edits:NotionDesignEdits={emphasisByPage:{},templateByPage:{memo:'image_text'}};
  expect(()=>validateNotionStudioDraft(state,copy,edits)).toThrow(/사진/);
  expect(validateNotionStudioDraft(state,copy,edits,{allowMissingPhotos:true})).toEqual(copy);
 });
 it('does not let an unrelated unfinished table block another card, but still protects source structure and owned photos',()=>{
  const {state,copy}=draftState(),edits:NotionDesignEdits={emphasisByPage:{},templateByPage:{memo:'table',story:'text'}};
  expect(()=>validateNotionStudioDraft(state,copy,edits,{allowMissingPhotos:true})).toThrow(/표/);
  expect(validateNotionStudioDraft(state,copy,edits,{templatePage:2,allowMissingPhotos:true})).toEqual(copy);
  const altered=structuredClone(copy);altered.pages[0].id='wrong-page';
  expect(()=>validateNotionStudioDraft(state,altered,edits,{templatePage:2,allowMissingPhotos:true})).toThrow(/장 수·순서/);
  expect(()=>validateNotionStudioDraft(state,copy,{...edits,photoByPage:{memo:999}},{templatePage:2,allowMissingPhotos:true})).toThrow(/현재 원고에 없습니다/);
  const lostSubtitle=structuredClone(copy);lostSubtitle.pages[0].body='보호한 소제목을 지운 수정';
  expect(()=>validateNotionStudioDraft(state,lostSubtitle,edits,{templatePage:2,allowMissingPhotos:true})).toThrow();
 });
 it('renders an honest pending-photo slot without producing a final PPTX',async()=>{
  const d=imageDocument(),before=structuredClone(d),preview=await buildNotionCanvaPptx(d,[],{previewPage:1,previewOnly:true,allowMissingPhotos:true});
  expect(preview.bytes).toHaveLength(0);expect(preview.previewSvg).toContain('data-name="interior-photo-pending"');
  expect(preview.previewSvg).toContain('data-name="interior-photo-pending-label"');expect(preview.warnings).toContain('2장 사진 추가 대기: 실제 사진을 선택한 뒤 Canva에 저장하세요.');expect(d).toEqual(before);
  await expect(buildNotionCanvaPptx(d,[],{previewPage:1,allowMissingPhotos:true})).rejects.toMatchObject({status:422});
  await expect(buildNotionCanvaPptx(d,[],{previewPage:1,previewOnly:true})).rejects.toMatchObject({status:422});
 });
 it('previews a finished text card while a photo and a structured card elsewhere are incomplete',async()=>{
  const d=imageDocument();d.coverStyle='C';d.pages.push({title:'아직 표 정리 중',body:'아직 표로 바꾸지 않은 문장',interiorTemplate:'table'},{title:'읽을 수 있는 본문',body:'사진을 기다리는 동안 계속 편집합니다.',interiorTemplate:'text'});
  const preview=await buildNotionCanvaPptx(d,[],{previewPage:3,previewOnly:true,allowMissingPhotos:true});
  expect(preview.previewSvg).toContain('data-name="interior-body"');expect(preview.previewSvg).not.toContain('interior-photo-pending');expect(preview.pageCount).toBe(5);
  await expect(buildNotionCanvaPptx(d)).rejects.toMatchObject({status:422});
 });
 it('uses the selected actual photograph and does not require or decode unselected media',async()=>{
  const bytes=await sharp({create:{width:30,height:40,channels:3,background:'#72A7FF'}}).png().toBuffer(),d=imageDocument();
  d.pages[1].imageId='unselected';d.pages.push({title:'선택한 실제 연구보고서',body:'실물 설명',interiorTemplate:'image_text',imageId:'selected'});
  const result=await buildNotionCanvaPptx(d,[{id:'selected',bytes,mimeType:'image/png'}],{previewPage:2,previewOnly:true,allowMissingPhotos:true});
  expect(result.previewSvg).toContain('data-name="photo-1"');expect(result.previewSvg).not.toContain('interior-photo-pending');
  await expect(buildNotionCanvaPptx(d,[{id:'selected',bytes,mimeType:'image/png'}])).rejects.toMatchObject({status:422});
 });
});
