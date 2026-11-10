import {describe,it,expect,vi} from 'vitest';
import {createNotionClient} from '../server/services/notionClient';
import {DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID,NOTION_CARD_DATA_SOURCE_ID,notionDocumentSchema} from '../shared/notionSync';
import {notionDocumentToCopy,notionCopyToPages} from '../shared/notionStudioCopy';

const id=(n:number)=>`4135c7c8-45fc-8101-ba1c-${String(n).padStart(12,'0')}`;
const rich=(text:string)=>[{type:'text',text:{content:text},plain_text:text}];
const text=(value:string)=>({type:'rich_text',rich_text:rich(value)});
function setup(){
 const parent:any={id:id(1),parent:{data_source_id:DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID},properties:{
  '제목':{type:'title',title:rich('실제 기관 · 초등')},'표지제목':text('현재 표지'),
  '채널':{type:'select',select:{name:'HighScoop'}},'검증상태':{type:'select',select:{name:'원문 대조'}},
  '카드 원고':{type:'relation',relation:[2,3,4,5].map(n=>({id:id(n)}))},
 }};
 const row=(n:number,index:number,role:string,title:string,body:string):any=>({id:id(n),parent:{data_source_id:NOTION_CARD_DATA_SOURCE_ID},properties:{
  '콘텐츠':{type:'relation',relation:[{id:id(1)}]},'페이지':{type:'number',number:index},'역할':{type:'select',select:{name:role}},
  '제목':text(title),'본문':text(body),'소제목':text(''),'각주':text(''),'출처표시':text(''),
 }});
 const rows=[row(2,1,'표지','현재 표지','현재 기관의 실제 원고'),row(3,2,'일반','현재 내지','현재 본문'),row(4,3,'원문 확인','원문 공고 확인','첨부 요강을 확인하세요.'),row(5,4,'다음 편 예고','3일만에 쓰는 영재교육원 연구계획서','궁금한 점을 댓글로 남겨주세요.')];
 rows[1].properties['소제목']=text('내지 소제목');rows[1].properties['각주']=text('각주 그대로');rows[1].properties['출처표시']=text('기관 공식 공고');
 rows[2].properties['QR대상URL']=text('https://ged.kedi.re.kr/inno/slctNotiInnoPop.do?stndYear=2027&seq=25796\nhttps://school.go.kr/notice/2027');rows[2].properties['출처표시']=text('GED 공식 공고\n기관 별도 안내');
 const calls:any[]=[];let rejectId='',loseResponseId='';
 const transport=vi.fn(async(input:any,init:any={})=>{const url=new URL(String(input)),pageId=url.pathname.split('/').at(-1),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;calls.push({path:url.pathname,method,body});
  if(url.pathname.includes('/blocks/'))throw new Error('Archived prose must never be read');
  const record=pageId===id(1)?parent:rows.find(row=>row.id===pageId);
  if(!record)throw new Error('Unknown fixture page');
  if(method==='PATCH'){
   if(pageId===rejectId)return Response.json({message:'fixture rejection'},{status:403});
   if(pageId===loseResponseId)throw new Error('fixture lost receipt');
   for(const [key,value]of Object.entries(body.properties))record.properties[key]={...(record.properties[key]??{}),...(value as any)};
  }
  return Response.json(structuredClone(record));
 });
 const client=createNotionClient({fetch:transport as typeof fetch,pause:async()=>{},env:()=>({NOTION_API_TOKEN:'fixture'})});
 return {client,parent,rows,calls,reject:(value:string)=>{rejectId=value;},lose:(value:string)=>{loseResponseId=value;}};
}
describe('current Notion card table',()=>{
 it('supports the existing general-role next-article row without changing select options',async()=>{
  const f=setup();f.rows[3].properties['역할'].select.name='일반';f.rows[3].properties['제목']=text('다음 편｜3일만에 쓰는 영재교육원 연구계획서');f.rows[3].properties['각주']=text('연구계획서를 요구하는 기관의 지원자를 위한 콘텐츠입니다.');
  const d=await f.client.fetchNotionDocument(id(1));expect(d.pages).toHaveLength(2);expect(d.teaser).toEqual({title:'3일만에 쓰는 영재교육원 연구계획서',body:'궁금한 점을 댓글로 남겨주세요.\n\n연구계획서를 요구하는 기관의 지원자를 위한 콘텐츠입니다.'});
 });
 it('reads the related current rows instead of the archived prose and separates QR and teaser from editable source chapters',async()=>{
  const f=setup(),d=await f.client.fetchNotionDocument(id(1));expect(notionDocumentSchema.parse(d)).toEqual(d);
  expect(d.editorialSource).toBe('card_table');expect(d.pages).toHaveLength(2);expect(d.pages[1]).toMatchObject({title:'현재 내지',cardRowId:id(3),body:'내지 소제목\n\n현재 본문',cardFields:{footnote:'각주 그대로',sourceLabel:'기관 공식 공고'}});
  expect(d.sourceReferences).toEqual([{title:'GED 공식 공고',url:'https://ged.kedi.re.kr/inno/slctNotiInnoPop.do?stndYear=2027&seq=25796'},{title:'기관 별도 안내',url:'https://school.go.kr/notice/2027'}]);
  expect(d.teaser?.title).toBe('3일만에 쓰는 영재교육원 연구계획서');expect(f.calls.filter(x=>x.path.includes('/blocks/'))).toHaveLength(0);
 });
 it('detects edits to the input table and QR targets but ignores ephemeral QR image URLs',async()=>{
  const f=setup(),base=await f.client.fetchNotionDocument(id(1));f.rows[2].properties['원문QR']={type:'files',files:[{file:{url:'https://file.notion.so/a?expires=first'}}]};
  expect((await f.client.fetchNotionDocument(id(1))).sourceHash).toBe(base.sourceHash);
  f.rows[2].properties['QR대상URL']=text('https://ged.kedi.re.kr/notice/new');expect((await f.client.fetchNotionDocument(id(1))).sourceHash).not.toBe(base.sourceHash);
 });
 it('preserves all 23 institutional URL and label pairs in one source row and fingerprints the last URL',async()=>{
  const f=setup(),urls=Array.from({length:23},(_,i)=>`https://ged.kedi.re.kr/inno/slctNotiInnoPop.do?stndYear=2027&seq=${26000+i}`),labels=urls.map((_,i)=>`기관 ${i+1} 공식 공고`);
  f.rows[2].properties['QR대상URL']=text(urls.join('\n'));f.rows[2].properties['출처표시']=text(labels.join('\n'));
  const d=await f.client.fetchNotionDocument(id(1));expect(notionDocumentSchema.parse(d)).toEqual(d);expect(d.sourceReferences).toEqual(urls.map((url,i)=>({title:labels[i],url})));
  urls[22]+='&revision=2';f.rows[2].properties['QR대상URL']=text(urls.join('\n'));expect((await f.client.fetchNotionDocument(id(1))).sourceHash).not.toBe(d.sourceHash);
 });
 it.each(['duplicate','over-limit'])('rejects invalid multi-page QR source rows: %s',async problem=>{
  const f=setup(),urls=problem==='duplicate'?['https://ged.kedi.re.kr/one','https://ged.kedi.re.kr/one']:Array.from({length:25},(_,i)=>`https://ged.kedi.re.kr/notice/${i}`);
  f.rows[2].properties['QR대상URL']=text(urls.join('\n'));await expect(f.client.fetchNotionDocument(id(1))).rejects.toMatchObject({code:'NOTION_QR_SOURCE_INVALID'});
 });
 it('uses an explicit per-card infographic marker while preserving the exact article text',async()=>{
  const f=setup(),before=await f.client.fetchNotionDocument(id(1));f.rows[1].properties['확인메모']=text('기존 검토 기록\n도식: 접수 단계');
  const after=await f.client.fetchNotionDocument(id(1));expect(after.pages[1].infographic).toBe('application_steps');expect(after.pages[1].body).toBe(before.pages[1].body);expect(after.sourceHash).not.toBe(before.sourceHash);
 });
 it.each([['모집 달력','admissions_calendar'],['기관별 일정표','institution_schedule'],['로고 모집 달력','admissions_logo_calendar'],['모집 안내','admissions_guide'],['모집 기간표','admissions_timeline']])('preserves the %s layout intent through the source snapshot',async(label,kind)=>{
  const f=setup(),before=await f.client.fetchNotionDocument(id(1));f.rows[1].properties['확인메모']=text(`원문 대조\n도식: ${label}`);
  const after=await f.client.fetchNotionDocument(id(1));expect(after.pages[1].infographic).toBe(kind);expect(after.pages[1].body).toBe(before.pages[1].body);expect(after.sourceHash).not.toBe(before.sourceHash);
 });
 it('imports and edits all twenty regional chapters while keeping source and teaser rows separate',async()=>{
  const f=setup(),template=structuredClone(f.rows[1]);
  const extra=Array.from({length:18},(_,i)=>{const row=structuredClone(template);row.id=id(100+i);row.properties['페이지'].number=i+3;row.properties['제목']=text(`교육청 ${i+3}`);row.properties['본문']=text(`보존할 기관별 일정 ${i+3}`);return row;});
  f.rows.splice(2,0,...extra);f.rows[20].properties['페이지'].number=21;f.rows[21].properties['페이지'].number=22;f.parent.properties['카드 원고'].relation=f.rows.map(row=>({id:row.id}));
  const before=await f.client.fetchNotionDocument(id(1));expect(before.pages).toHaveLength(20);expect(before.pages[19].cardFields?.body).toBe('보존할 기관별 일정 20');expect(before.sourceReferences).toHaveLength(2);expect(before.teaser?.title).toContain('연구계획서');
  const copy=notionDocumentToCopy(before);copy.pages[18].body=copy.pages[18].body.replace('보존할 기관별 일정 20','수정한 마지막 시도');
  const after=await f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:before.sourceHash,pages:notionCopyToPages(copy,{baseline:before,current:before})});
  expect(after.pages).toHaveLength(20);expect(after.pages[19].cardFields?.body).toBe('수정한 마지막 시도');expect(after.sourceReferences).toEqual(before.sourceReferences);expect(after.teaser).toEqual(before.teaser);
 });
 it('writes the changed title/body to the matching table columns while preserving subtitle, notes, QR and teaser',async()=>{
  const f=setup(),before=await f.client.fetchNotionDocument(id(1)),copy=notionDocumentToCopy(before);copy.pages[0].title='수정한 내지';copy.pages[0].body=copy.pages[0].body.replace('현재 본문','수정한 본문');
  const pages=notionCopyToPages(copy,{baseline:before,current:before});const lease=vi.fn(async()=>{});
  const result=await f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:before.sourceHash,pages},{beforeWrite:lease});
  expect(result.pages[1].body).toContain('수정한 본문');expect(result.pages[1].cardFields).toEqual({subtitle:'내지 소제목',body:'수정한 본문',footnote:'각주 그대로',sourceLabel:'기관 공식 공고'});
  expect(f.calls.filter(x=>x.method==='PATCH')).toEqual([{path:`/v1/pages/${id(3)}`,method:'PATCH',body:{properties:{'제목':expect.any(Object),'본문':expect.any(Object)}}}]);expect(lease).toHaveBeenCalledTimes(1);
  expect(result.sourceReferences).toEqual(before.sourceReferences);expect(result.teaser).toEqual(before.teaser);
 });
 it('leaves unchanged table fields untouched and preserves an independently named first headline',async()=>{
  const f=setup();f.rows[0].properties['제목']=text('기관별 원고 첫 제목');const d=await f.client.fetchNotionDocument(id(1));
  const pages=notionCopyToPages(notionDocumentToCopy(d),{baseline:d,current:d});expect(pages[0].title).toBe('기관별 원고 첫 제목');
  await f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:d.sourceHash,pages});expect(f.calls.some(x=>x.method==='PATCH')).toBe(false);
 });
 it('rejects a stale table hash before any write',async()=>{
  const f=setup(),d=await f.client.fetchNotionDocument(id(1));f.rows[1].properties['본문']=text('노션에서 방금 바뀜');
  await expect(f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:d.sourceHash,pages:notionCopyToPages(notionDocumentToCopy(d),{baseline:d,current:d})})).rejects.toMatchObject({code:'NOTION_SOURCE_CONFLICT'});expect(f.calls.some(x=>x.method==='PATCH')).toBe(false);
 });
 it.each(['outside','trashed','wrong-parent','number-gap','duplicate-extra','http-qr','private-qr','empty-relation','shared-row'])('rejects malformed or inaccessible table rows: %s',async problem=>{
  const f=setup();
  if(problem==='outside')f.rows[1].properties['콘텐츠'].relation=[{id:id(9)}];
  if(problem==='trashed')f.rows[1].in_trash=true;
  if(problem==='wrong-parent')f.rows[1].parent.data_source_id=DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID;
  if(problem==='number-gap')f.rows[1].properties['페이지'].number=7;
  if(problem==='duplicate-extra')f.rows[3].properties['역할'].select.name='원문 확인';
  if(problem==='http-qr')f.rows[2].properties['QR대상URL']=text('http://example.com');
  if(problem==='private-qr')f.rows[2].properties['QR대상URL']=text('https://172.16.0.10/private');
  if(problem==='empty-relation')f.parent.properties['카드 원고'].relation=[];
  if(problem==='shared-row')f.rows[1].properties['콘텐츠'].relation.push({id:id(9)});
  await expect(f.client.fetchNotionDocument(id(1))).rejects.toMatchObject({status:expect.any(Number)});expect(f.calls.some(x=>x.path.includes('/blocks/'))).toBe(false);
 });
 it('reports a lost table-write receipt instead of silently retrying it',async()=>{
  const f=setup(),d=await f.client.fetchNotionDocument(id(1)),copy=notionDocumentToCopy(d);copy.pages[0].title='새 제목';f.lose(id(3));
  await expect(f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:d.sourceHash,pages:notionCopyToPages(copy,{baseline:d,current:d})})).rejects.toMatchObject({code:'NOTION_PARTIAL_WRITE',details:{attemptedPageId:id(3)}});
  expect(f.calls.filter(x=>x.method==='PATCH')).toHaveLength(1);
 });
 it('requires source-column edits in Notion rather than merging away structured footnotes',async()=>{
  const f=setup(),d=await f.client.fetchNotionDocument(id(1)),copy=notionDocumentToCopy(d);expect(copy.pages[0].body).not.toContain('각주 그대로');copy.pages[0].body=copy.pages[0].body.replace('내지 소제목','소제목 변경');
  expect(()=>notionCopyToPages(copy,{baseline:d,current:d})).toThrow('각주');
 });
 it('enforces immutable notes even when bypassing the higher-level copy helper',async()=>{
  const f=setup(),d=await f.client.fetchNotionDocument(id(1));const pages=notionCopyToPages(notionDocumentToCopy(d),{baseline:d,current:d});
  pages[1].body=pages[1].body.replace('현재 본문','새 본문');pages[1].cardFields!.body='새 본문';pages[1].cardFields!.footnote='잘못된 각주';
  await expect(f.client.updateNotionDocument({pageId:id(1),expectedSourceHash:d.sourceHash,pages})).rejects.toMatchObject({code:'NOTION_STRUCTURE_CONFLICT'});expect(f.calls.some(x=>x.method==='PATCH')).toBe(false);
 });
 it('normalizes linked URL lines and labels without spaces around the institution separator',async()=>{
  const f=setup();f.rows[2].properties['QR대상URL']=text('[https://ged.kedi.re.kr/one](https://ged.kedi.re.kr/one)<br />https://school.go.kr/two');f.rows[2].properties['출처표시']=text('기관A/기관B');
  const d=await f.client.fetchNotionDocument(id(1));expect(d.sourceReferences).toEqual([{title:'기관A',url:'https://ged.kedi.re.kr/one'},{title:'기관B',url:'https://school.go.kr/two'}]);
 });
});
