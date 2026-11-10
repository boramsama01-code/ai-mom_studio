// Built-app browser regression with isolated API fixtures; never contacts providers.
import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {preview} from 'vite';
import sharp from 'sharp';

const require=createRequire(import.meta.url);
let playwright;
try{playwright=require('playwright');}catch{playwright=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'/nonexistent']}));}
const output=path.resolve('test-results/notion-canva-autosave');
await mkdir(output,{recursive:true});
const widths=process.env.WORKSPACE_BROWSER_WIDTHS?process.env.WORKSPACE_BROWSER_WIDTHS.split(',').map(Number):[1280,393];
assert(widths.length&&widths.every(value=>Number.isInteger(value)&&value>=280));
const server=await preview({preview:{host:'127.0.0.1',port:4181,strictPort:true}});
const origin='http://127.0.0.1:4181',clone=value=>structuredClone(value),stamp='2026-11-10T03:30:00.000Z';
const previewBytes=await sharp({create:{width:540,height:675,channels:3,background:'#f9f8f4'}}).jpeg().toBuffer();
const results=[];
let browser,engine='webkit';
async function launchBrowser(){
 try{return await playwright.webkit.launch();}catch(error){
  if(process.env.CI)throw error;
  engine='chromium';let executablePath=process.env.WORKSPACE_BROWSER_EXECUTABLE;
  if(!executablePath&&process.platform==='win32')for(const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){try{await access(candidate);executablePath=candidate;break;}catch{}}
  return playwright.chromium.launch(executablePath?{executablePath}:{});
 }
}
function fixture(){return {
 link:{id:18,version:4,pageId:'4135c7c8-45fc-8101-ba1c-000000000001',notionUrl:'https://www.notion.so/fixture',channelId:3,itemId:28,studioCardId:39,title:'자동 저장 동작 확인 · 검증용 합성 원고',sourceHash:'a'.repeat(64),lastEditedAt:stamp,lastSyncedAt:stamp,autoSync:false,lastCheckedAt:null,coverStyle:'B',status:'synced',studioUrl:'/studio/39',photoCount:0,canvaAutoSave:{enabled:true,phase:'idle'},canva:{phase:'ready',designId:'previous-design',editUrl:'https://www.canva.com/design/previous-design/edit',sourceVersion:7,sourceRevisionId:17,pageCount:4,currentSource:true}},
 itemVersion:7,copy:{version:1,templateKey:'highscoop-a',cover:{title:'직접 만드는 카드뉴스',subtitle:'저장한 원고를 캔바에서 이어서 편집해요.'},pages:[{id:'one',title:'우리 지역 지원 일정',subtitle:'',body:'기준 안내\n\n원문 본문을 그대로 보존합니다.'}]},
 designEdits:{emphasisByPage:{}},photos:[],source:{title:'검증 원고',coverTitle:'직접 만드는 카드뉴스',pages:[{index:1,key:'row-cover',title:'직접 만드는 카드뉴스',body:'표지 설명'},{index:2,key:'row-one',title:'우리 지역 지원 일정',body:'기준 안내\n\n원문 본문을 그대로 보존합니다.',cardFields:{subtitle:'기준 안내',body:'원문 본문을 그대로 보존합니다.',footnote:'학교 밖 청소년의 별도 서류 기한을 확인하세요.',sourceLabel:'공식 공고'}}],sourceReferences:[{title:'GED',url:'https://ged.kedi.re.kr/'}]},warnings:[],
};}
async function status(page,text){await page.getByText(text,{exact:false}).first().waitFor({timeout:30000});}
async function screenshot(page,name){
 await page.locator('.notion-card-editor').evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-90));
 await page.screenshot({path:path.join(output,name),animations:'disabled'});
}
try{
 browser=await launchBrowser();
 for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('spacepenguin.channel','3'));
  const page=await context.newPage(),errors=[],external=[],writes=[],gets=[];
  let detail=fixture(),advance='',applied='';
  const protectedSource=clone(detail.source);
  const applyProgress=()=>{
   if(!advance||advance===applied)return;
   applied=advance;detail.link.version++;
   if(advance==='processing'){
    detail.link.canvaAutoSave={...detail.link.canvaAutoSave,phase:'processing'};
    detail.link.canva={...detail.link.canva,phase:'importing',jobId:'fixture-job',currentSource:false};
   }else if(advance==='ready'){
    detail.link.canvaAutoSave={enabled:true,phase:'idle'};
    detail.link.canva={phase:'ready',designId:'latest-design',editUrl:'https://www.canva.com/design/latest-design/edit',sourceVersion:detail.itemVersion,sourceRevisionId:18,pageCount:4,currentSource:true};
   }else if(advance==='failed'){
    detail.link.canvaAutoSave={...detail.link.canvaAutoSave,phase:'failed',error:'Canva 연결을 확인해 주세요.'};
    detail.link.canva={...detail.link.canva,phase:'failed',error:'Canva 연결을 확인해 주세요.',currentSource:false};
   }
  };
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method(),body=request.postData()?request.postDataJSON():undefined;
   if(url.origin!==origin){external.push(url.href);return route.abort();}
   if(!p.startsWith('/api/'))return route.continue();
   let json;
   if(p==='/api/auth/me')json={user:'fixture',demo:false,csrf:'fixture-csrf',recoveryScope:'canva-autosave-browser-'+width,authConfigured:true,demoAllowed:false};
   else if(p==='/api/channels')json=[{id:3,slug:'highscoop',name:'HighScoop',active:true,version:1,accentColor:'#ff493b',contentType:'manual',budget:{},categories:null}];
   else if(p==='/api/channels/3/today')json={counts:{pendingReview:0,draftsReady:0}};
   else if(p==='/api/status')json={globalStop:false,workerConnected:true,integrations:{flags:{dryRun:true,autoPublish:false}}};
   else if(p==='/api/notion/status')json={configured:true,dataSourceId:'synthetic-fixture',missing:[]};
   else if(p==='/api/notion/documents')json={documents:[],hasMore:false};
   else if(p==='/api/notion/links')json={links:[detail.link]};
   else if(p==='/api/notion/links/18'&&method==='GET'){applyProgress();gets.push(url.search);json=detail;}
   else if(p==='/api/notion/links/18/preview'&&method==='POST')return route.fulfill({contentType:'image/jpeg',body:previewBytes});
   else if(p==='/api/notion/links/18/copy'&&method==='PATCH'){
    assert.equal(body.version,detail.link.version,'Save must use latest operational link version');
    assert.equal(body.itemVersion,detail.itemVersion);
    writes.push({path:p,body:clone(body)});
    detail={...detail,copy:clone(body.copy),designEdits:clone(body.designEdits),itemVersion:detail.itemVersion+1,link:{...detail.link,version:detail.link.version+1,status:'studio_changed',canva:{...detail.link.canva,currentSource:false},canvaAutoSave:{enabled:true,phase:'queued',requestedAt:stamp,notBefore:stamp,sourceRevisionId:18+writes.length,sourceVersion:detail.itemVersion+1}}};json=detail;
   }else if(p==='/api/notion/links/18'&&method==='PATCH'){
    assert.equal(body.version,detail.link.version);assert.equal(typeof body.canvaAutoSave,'boolean');writes.push({path:p,body:clone(body)});
    detail.link={...detail.link,version:detail.link.version+1,canvaAutoSave:{...detail.link.canvaAutoSave,enabled:body.canvaAutoSave,phase:body.canvaAutoSave?'queued':'idle',error:null}};json=detail;
   }else{errors.push(`Unmocked ${method} ${p}`);return route.fulfill({status:404,json:{error:'fixture missing'}});}
   return route.fulfill({json:clone(json)});
  });
  try{
   await page.goto(origin+'/notion?link=18');await page.locator('.notion-card-editor').waitFor();
   assert(await page.getByRole('checkbox',{name:'캔바 자동 저장',exact:true}).isChecked());
   await page.locator('.notion-card-strip button').nth(1).click();
   await page.getByLabel('내지 템플릿',{exact:true}).selectOption('text');
   await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).click();
   await status(page,'캔바 자동 저장 대기 중');
   assert.equal(writes.length,1);assert.equal(detail.designEdits.templateByPage['row-one'],'text');
   assert.equal(await page.getByLabel('카드 제목',{exact:true}).isDisabled(),false,'Queued save must not lock editing');
   assert(await page.getByRole('link',{name:'이전 캔바 디자인 열기 ↗',exact:true}).count());
   await page.getByLabel('카드 제목',{exact:true}).fill('대기 중에도 다음 편집');
   advance='processing';await status(page,'캔바에 편집 가능한 디자인을 저장하는 중');
   assert.equal(await page.getByLabel('카드 제목',{exact:true}).inputValue(),'대기 중에도 다음 편집');
   advance='ready';await status(page,'최신 저장본이 캔바에 저장됐습니다.');
   assert.equal(await page.getByLabel('카드 제목',{exact:true}).inputValue(),'대기 중에도 다음 편집','Operational polling must preserve dirty input');
   assert.equal(await page.getByText('다른 곳에서 새 버전을 저장했습니다.',{exact:false}).count(),0);
   assert.equal(await page.getByRole('link',{name:'캔바에서 이어서 편집 ↗',exact:true}).first().getAttribute('href'),'https://www.canva.com/design/latest-design/edit');
   await screenshot(page,`ready-dirty-${width}.png`);
   await page.locator('.notion-canva-autosave').evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-180));
   await page.screenshot({path:path.join(output,`ready-canva-panel-${width}.png`),animations:'disabled'});
   await page.getByRole('button',{name:'스튜디오에 저장',exact:true}).click();
   await status(page,'캔바 자동 저장 대기 중');assert.equal(writes.length,2);assert.equal(detail.copy.pages[0].title,'대기 중에도 다음 편집');
   advance='failed';await status(page,'스튜디오에는 저장됐지만 캔바 자동 저장을 완료하지 못했습니다.');
   await screenshot(page,`failed-${width}.png`);
   await page.getByRole('button',{name:'캔바 자동 저장 다시 시도',exact:true}).click();
   await status(page,'캔바 자동 저장 대기 중');assert.equal(writes.length,3);assert.equal(writes[2].body.canvaAutoSave,true);
   const disableResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/notion/links/18'&&response.request().method()==='PATCH');
   await page.getByRole('checkbox',{name:'캔바 자동 저장',exact:true}).click();await disableResponse;
   await page.waitForFunction(()=>document.querySelector('input[aria-label="캔바 자동 저장"]')?.checked===false);
   assert.equal(detail.link.canvaAutoSave.enabled,false);assert.equal(writes.length,4);assert.deepEqual(detail.source,protectedSource);
   await page.reload();await page.locator('.notion-card-editor').waitFor();await page.locator('.notion-card-strip button').nth(1).click();
   assert.equal(await page.getByLabel('카드 제목',{exact:true}).inputValue(),'대기 중에도 다음 편집');
   assert.equal(await page.getByLabel('내지 템플릿',{exact:true}).inputValue(),'text');
   assert.equal(await page.getByRole('checkbox',{name:'캔바 자동 저장',exact:true}).isChecked(),false);
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(layout.scroll<=layout.width+1,JSON.stringify(layout));
   assert.equal(external.length,0);assert.equal(errors.length,0,errors.join('\n'));assert(gets.some(search=>search===''),'Queued/processing polls should use cached detail');
   results.push({width,engine,status:'PASS',sourcePreserved:true,dirtyInputPreserved:true,latestVersionSave:true,saveReopen:true,writes:writes.length,aiCalls:0,externalCalls:0,clientCanvaSubmissions:0});
  }catch(error){await page.screenshot({path:path.join(output,`failure-${width}.png`),fullPage:true});results.push({width,engine,status:'FAIL',error:error.stack,errors,external,writes});throw error;}
  finally{await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');await context.close();}
 }
 console.log(JSON.stringify({status:'PASS',results,output}));
}finally{await browser?.close();await server.httpServer.close();}
