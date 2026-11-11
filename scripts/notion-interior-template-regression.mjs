// Run after npm run build: node --import tsx scripts/notion-interior-template-regression.mjs
// Synthetic, isolated browser fixture. No database, Notion, Canva, AI or publishing calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {preview} from 'vite';
import sharp from 'sharp';
import {buildNotionCanvaPptx} from '../server/services/notionCanva.ts';

const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'/nonexistent']}));}
const output=path.resolve('test-results/notion-interior-templates');await mkdir(output,{recursive:true});
const widths=process.env.WORKSPACE_BROWSER_WIDTHS?process.env.WORKSPACE_BROWSER_WIDTHS.split(',').map(Number):[1280,393];
assert(widths.length&&widths.every(n=>Number.isInteger(n)&&n>=280),'WORKSPACE_BROWSER_WIDTHS must contain widths >=280');
const server=await preview({preview:{host:'127.0.0.1',port:4179,strictPort:true}}),origin='http://127.0.0.1:4179';
const results=[],stamp='2026-11-10T00:00:00.000Z',original='본문 첫 문단을 그대로 보존합니다.',clone=value=>structuredClone(value);
let browser,engine='webkit',nodeNetworkAttempts=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{nodeNetworkAttempts++;throw Error('This local renderer fixture must not make external calls');};
async function launchBrowser(){
 try{return await playwright.webkit.launch();}catch(error){
  if(process.env.CI)throw error;
  engine='chromium';let executablePath=process.env.WORKSPACE_BROWSER_EXECUTABLE;
  if(!executablePath&&process.platform==='win32')for(const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  console.log('WebKit unavailable locally; using Chromium'+(executablePath?' with the installed browser':''));
  return playwright.chromium.launch(executablePath?{executablePath}:{});
 }
}
const photoBytes=new Map(await Promise.all([101,102].map(async(id,index)=>[id,await sharp({create:{width:900,height:1100,channels:3,background:index?'#A4CAD1':'#E9C8AC'}}).png().toBuffer()])));
function fixture(){return {
 link:{id:18,version:4,pageId:'4135c7c8-45fc-8101-ba1c-000000000001',notionUrl:'https://www.notion.so/fixture',channelId:3,itemId:28,studioCardId:39,title:'내지 템플릿 직접 제작 · 검증용 합성 원고',sourceHash:'a'.repeat(64),lastEditedAt:stamp,lastSyncedAt:stamp,autoSync:false,lastCheckedAt:null,coverStyle:'A',status:'synced',studioUrl:'/studio/39',canva:{phase:'idle'},photoCount:2},
 itemVersion:7,copy:{version:1,templateKey:'highscoop-a',cover:{title:'직접 만드는 카드뉴스',subtitle:'템플릿을 고르고 내용을 채워 보세요.'},pages:[{id:'one',title:'우리 지역 지원 일정',subtitle:'',body:'기준 안내\n\n'+original},{id:'two',title:'사진과 함께 보는 준비 과정',subtitle:'',body:'두 번째 원고입니다. 준비할 자료를 사진과 함께 설명합니다.'}]},
 photos:[{id:101,name:'검증용 실험 사진.png',mimeType:'image/png',width:900,height:1100,url:'/api/notion/links/18/photos/101'},{id:102,name:'검증용 수료 사진.png',mimeType:'image/png',width:900,height:1100,url:'/api/notion/links/18/photos/102'}],
  source:{title:'내지 템플릿 직접 제작',coverTitle:'직접 만드는 카드뉴스',pages:[{index:1,key:'row-cover',title:'직접 만드는 카드뉴스',body:'표지 설명'},{index:2,key:'row-one',title:'우리 지역 지원 일정',body:'기준 안내\n\n'+original,cardFields:{subtitle:'기준 안내',body:original,footnote:'원문 각주 유지\n* 학교 밖 청소년은 별도 서류 기한을 확인하세요.\n** 추가 접수는 정원이 미달된 과정에 한합니다.\n기관별 마감 시각은 원문 모집요강을 확인하세요.',sourceLabel:'공식 공고'},emphasis:'본문'},{index:3,key:'row-two',title:'사진과 함께 보는 준비 과정',body:'두 번째 원고입니다. 준비할 자료를 사진과 함께 설명합니다.'}],sourceReferences:[{title:'GED',url:'https://ged.kedi.re.kr/'}]},warnings:[],
};}
async function realPreview(detail,input){
 const sourcePages=detail.source.pages,edits=input.designEdits,ordered=detail.photos;
 const pages=[{title:input.copy.cover.title,body:input.copy.cover.subtitle},...input.copy.pages.map(p=>({title:p.title,body:[p.subtitle,p.body].filter(Boolean).join('\n\n')}))].map((page,index)=>{
  const source=sourcePages[index],key=source.key,template=index>0?edits.templateByPage?.[key]:undefined;
  const photo=template==='image_text'?(edits.photoByPage?.[key]!==undefined?ordered.find(p=>p.id===edits.photoByPage[key]):ordered[index]):!template?ordered[index]:undefined;
  const subtitle=template?source.cardFields?.subtitle??'':'',prefix=subtitle.trim()?subtitle+'\n\n':'';
  return {...page,body:prefix&&page.body.startsWith(prefix)?page.body.slice(prefix.length):page.body,...(template?{interiorTemplate:template,...(subtitle?{interiorSubtitle:subtitle}:{})}:{}),...(photo?{imageId:String(photo.id)}:{}),...(source.cardFields?{footnote:source.cardFields.footnote,sourceLabel:source.cardFields.sourceLabel}:{}),...(edits.emphasisByPage[key]!==undefined?{emphasis:edits.emphasisByPage[key]}:source.emphasis?{emphasis:source.emphasis}:{})};
 });
 const used=new Set(pages.flatMap(p=>p.imageId?[p.imageId]:[])),photos=ordered.filter(p=>used.has(String(p.id))).map(p=>({id:String(p.id),bytes:photoBytes.get(p.id),mimeType:'image/png'}));
 const deck=await buildNotionCanvaPptx({title:detail.link.title,coverStyle:'A',category:'영재교육',pages,sourceReferences:detail.source.sourceReferences},photos,{previewPage:input.page,previewOnly:true,allowMissingPhotos:true});
 assert(deck.previewSvg,'Real renderer must return SVG');
 return {svg:deck.previewSvg,bytes:await sharp(Buffer.from(deck.previewSvg)).resize(540,675).jpeg({quality:90}).toBuffer()};
}
async function waitPreview(page,index){
 const image=page.getByAltText(`${index+1}장 디자인 미리보기`,{exact:true});
 await image.waitFor();
 await page.waitForFunction(i=>{const image=document.querySelector(`img[alt="${i+1}장 디자인 미리보기"]`);return image&&!image.classList.contains('is-stale')&&image.complete&&image.naturalWidth>0&&image.closest('[aria-busy]')?.getAttribute('aria-busy')==='false';},index,{timeout:30000});
 return image;
}
async function noOverflow(page,label){const box=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert(box.scroll<=box.viewport+1,`${label}: horizontal overflow ${JSON.stringify(box)}`);}
async function screenshot(page,name){
 // Capture real viewports instead of a stitched tall element: fixed app bars
 // otherwise appear midway through an element screenshot and obscure fields.
 await page.locator('.notion-card-editor').evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+window.scrollY-100));
 await page.screenshot({path:path.join(output,name),animations:'disabled'});
 await page.locator('.notion-interior-picker').evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+window.scrollY-100));
 await page.screenshot({path:path.join(output,name.replace('.png','-controls.png')),animations:'disabled'});
}
try{
 browser=await launchBrowser();
 for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('spacepenguin.channel','3'));
  const page=await context.newPage(),errors=[],blocked=[],writes=[],previewRequests=[],previews=[],invalidPreviews=[];let detail=fixture();
  const sourceBefore=clone(detail.source);
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method(),body=request.postData()?request.postDataJSON():undefined;
   if(url.origin!==origin){blocked.push(url.href);return route.abort();}
   if(!p.startsWith('/api/'))return route.continue();
   let json;
   if(p==='/api/auth/me')json={user:'fixture',demo:false,csrf:'fixture-csrf',recoveryScope:'notion-interior-browser-'+width,authConfigured:true,demoAllowed:false};
   else if(p==='/api/channels')json=[{id:3,slug:'highscoop',name:'HighScoop',active:true,version:1,accentColor:'#ff493b',contentType:'manual',budget:{},categories:null}];
   else if(p==='/api/channels/3/today')json={counts:{pendingReview:0,draftsReady:0}};
   else if(p==='/api/status')json={globalStop:false,workerConnected:true,integrations:{flags:{dryRun:true,autoPublish:false}}};
   else if(p==='/api/notion/status')json={configured:true,dataSourceId:'synthetic-fixture',missing:[]};
   else if(p==='/api/notion/documents')json={documents:[],hasMore:false};
   else if(p==='/api/notion/links')json={links:[detail.link]};
   else if(p==='/api/notion/links/18'&&method==='GET')json=detail;
   else if(/^\/api\/notion\/links\/18\/photos\/(101|102)$/.test(p))return route.fulfill({contentType:'image/png',body:photoBytes.get(Number(p.split('/').at(-1)))});
   else if(p==='/api/notion/links/18/preview'&&method==='POST'){
    // Track submission before rendering. An earlier, valid preview can finish
    // after a template switch; its completion is not a new invalid POST.
    previewRequests.push({page:body.page,templates:clone(body.designEdits.templateByPage??{}),photoByPage:clone(body.designEdits.photoByPage??{}),body:clone(body.copy)});
    assert(!('interiorInputs' in body),'Client-only structured buffers must never enter preview requests');
    try{const rendered=await realPreview(detail,body);previews.push({page:body.page,templates:clone(body.designEdits.templateByPage??{}),photoByPage:clone(body.designEdits.photoByPage??{}),body:clone(body.copy)});const template=body.designEdits.templateByPage?.[detail.source.pages[body.page]?.key];if(template==='table'||template==='image_text'){await writeFile(path.join(output,`real-${template}-${width}.jpg`),rendered.bytes);await writeFile(path.join(output,`real-${template}-${width}.svg`),rendered.svg);}return route.fulfill({contentType:'image/jpeg',body:rendered.bytes});}
    catch(error){invalidPreviews.push({page:body.page,error:error.message});return route.fulfill({status:422,json:{error:error.message}});}
   }else if(p==='/api/notion/links/18/copy'&&method==='PATCH'){
    assert.equal(body.version,detail.link.version);assert.equal(body.itemVersion,detail.itemVersion);assert(!('interiorInputs' in body),'Client-only structured buffers must never enter save requests');
    writes.push({path:p,method,body:clone(body)});detail={...detail,copy:clone(body.copy),designEdits:clone(body.designEdits),itemVersion:detail.itemVersion+1,link:{...detail.link,status:'studio_changed'}};json=detail;
   }else{errors.push(`Unmocked ${method} ${p}`);return route.fulfill({status:404,json:{error:'fixture missing'}});}
   return route.fulfill({json:clone(json)});
  });
  try{
   await page.goto(origin+'/notion?link=18');
   await page.locator('.notion-card-editor').waitFor();
   assert.equal(await page.getByLabel('내지 템플릿',{exact:true}).count(),0,'Cover must keep its own settings');
   const cards=page.locator('.notion-card-strip button');await cards.nth(1).click();
   const picker=page.getByLabel('내지 템플릿',{exact:true});await picker.waitFor();
   assert.deepEqual(await picker.locator('option').evaluateAll(options=>options.map(o=>o.value)),['auto','text','two_columns','image_text','table','process','timeline','bar_chart']);
   await picker.selectOption('table');assert.equal(await page.getByLabel('카드 본문',{exact:true}).inputValue(),original);assert.equal(writes.length,0);
   await page.waitForTimeout(700); // Deliberately cross the450ms debounce: incompatible copy must never POST.
   await page.getByText('구성 내용을 입력하고 ‘내용 적용’을 눌러 미리보기를 확인하세요.',{exact:true}).waitFor();
   assert.equal(previewRequests.filter(request=>request.templates['row-one']==='table').length,0,'An incompatible table must never be submitted before Apply');assert.equal(invalidPreviews.length,0);assert.equal(await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).isDisabled(),true);
   await page.getByLabel('1열 머리글',{exact:true}).fill('지역');await page.getByLabel('2열 머리글',{exact:true}).fill('마감일');await page.getByLabel('1행 1열',{exact:true}).fill('서울');await page.getByLabel('1행 2열',{exact:true}).fill('11/11');await page.getByRole('button',{name:'행 추가',exact:true}).click();await page.getByLabel('2행 1열',{exact:true}).fill('서울');await page.getByLabel('2행 2열',{exact:true}).fill('11/12');
   assert.equal(await page.getByLabel('카드 본문',{exact:true}).inputValue(),original,'Structured input must preserve source until Apply');
   assert.equal(await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'표 내용 적용',exact:true}).click();await waitPreview(page,1);
   assert.equal(await page.getByLabel('카드 본문',{exact:true}).inputValue(),'지역 | 마감일\n서울 | 11/11\n서울 | 11/12');
   await noOverflow(page,'table-'+width);await screenshot(page,`table-${width}.png`);
   await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).click();await page.getByText('스튜디오에 저장했습니다. 캔바에는 아래 새 디자인 만들기로 적용하세요.',{exact:true}).waitFor();
   assert.equal(writes.length,1);assert.equal(detail.copy.pages[0].body,'기준 안내\n\n지역 | 마감일\n서울 | 11/11\n서울 | 11/12');assert.deepEqual(detail.source,sourceBefore);
   await page.reload();await page.locator('.notion-card-editor').waitFor();await page.locator('.notion-card-strip button').nth(1).click();
   assert.equal(await page.getByLabel('내지 템플릿',{exact:true}).inputValue(),'table');assert.equal(await page.getByLabel('2행 2열',{exact:true}).inputValue(),'11/12');await waitPreview(page,1);
   await page.locator('.notion-card-strip button').nth(2).click();await page.getByLabel('내지 템플릿',{exact:true}).selectOption('image_text');
   await page.waitForTimeout(700);
   await page.getByText('사진 추가 대기 · 원고와 배치는 계속 수정하고 저장할 수 있어요.',{exact:true}).waitFor();assert(previewRequests.some(request=>request.templates['row-two']==='image_text'),'A pending photo template must remain previewable');assert.equal(invalidPreviews.length,0);assert.equal(await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).isDisabled(),false);
   await page.getByLabel('페이지 사진',{exact:true}).selectOption('102');await page.getByLabel('강조문구',{exact:true}).fill('두 번째');await waitPreview(page,2);
   await noOverflow(page,'photo-'+width);await screenshot(page,`photo-${width}.png`);
   await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).click();await page.getByText('스튜디오에 저장했습니다. 캔바에는 아래 새 디자인 만들기로 적용하세요.',{exact:true}).waitFor();
   assert.equal(writes.length,2);assert.deepEqual(detail.designEdits,{emphasisByPage:{'row-two':'두 번째'},templateByPage:{'row-one':'table','row-two':'image_text'},photoByPage:{'row-two':102}});assert.deepEqual(detail.source,sourceBefore);
   await page.reload();await page.locator('.notion-card-editor').waitFor();await page.locator('.notion-card-strip button').nth(2).click();assert.equal(await page.getByLabel('페이지 사진',{exact:true}).inputValue(),'102');assert.equal(await page.getByLabel('내지 템플릿',{exact:true}).inputValue(),'image_text');await waitPreview(page,2);
   for(const index of [0,3,4]){await page.locator('.notion-card-strip button').nth(index).click();assert.equal(await page.getByLabel('내지 템플릿',{exact:true}).count(),0);}
   assert.equal(blocked.length,0,'No external request is needed');assert.equal(errors.length,0,errors.join('\n'));assert.equal(nodeNetworkAttempts,0,'Renderer must not call providers');
   assert(writes.every(w=>w.path==='/api/notion/links/18/copy'),'Only explicit manuscript saves may mutate fixture state');assert(previews.some(p=>p.templates['row-one']==='table'));assert(previews.some(p=>p.photoByPage['row-two']===102));
   results.push({width,engine,status:'PASS',savedWrites:writes.length,previewRequestCount:previewRequests.length,realPreviewCount:previews.length,externalRequests:blocked.length,aiCalls:0,canvaCalls:0,sourcePreserved:true,saveReopenVerified:true,expectedInvalidPreviews:invalidPreviews});
  }catch(error){await page.screenshot({path:path.join(output,`failure-${width}.png`),fullPage:true});results.push({width,engine,status:'FAIL',error:error.stack,errors,blocked,writes,previewRequests,invalidPreviews});throw error;}
  finally{await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');await context.close();}
 }
 console.log(JSON.stringify({status:'PASS',results,output}));
}finally{globalThis.fetch=originalFetch;await browser?.close();await server.httpServer.close();}
