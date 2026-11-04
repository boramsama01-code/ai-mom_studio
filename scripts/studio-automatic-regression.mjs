// Automatic image editing regression against the built app. Run after npm run build.
// CI requires WebKit; local systems may fall back using WORKSPACE_BROWSER_EXECUTABLE.
// All API responses, generated artwork and rendered output are synthetic; external URLs are blocked.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'/nonexistent']}));}
const output='test-results/studio-automatic-browser';await mkdir(output,{recursive:true});await writeFile(`${output}/results.json`,'[]');
const server=await preview({preview:{host:'127.0.0.1',port:4177,strictPort:true}}), origin='http://127.0.0.1:4177';
let browser;
let browserEngine = "webkit";
async function launchBrowser() {
  try { return await playwright.webkit.launch(); }
  catch (webkitError) {
    // CI installs WebKit and its OS dependencies. Never silently weaken that gate.
    if (process.env.CI) throw webkitError;
    browserEngine = "chromium";
    console.log(`WebKit unavailable; using Chromium (${String(webkitError.message).split("\n")[0]})`);
    return playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE, args: ["--no-zygote", "--disable-dev-shm-usage"] } : {}) });
  }
}
const widths = process.env.WORKSPACE_BROWSER_WIDTHS ? process.env.WORKSPACE_BROWSER_WIDTHS.split(",").map(Number) : [393, 1280];
assert(widths.length && widths.every(width => Number.isInteger(width) && width >= 280), "WORKSPACE_BROWSER_WIDTHS must be comma-separated viewport widths");
const clone=value=>structuredClone(value),stamp='2026-11-04T00:00:00Z';
const imageCache=new Map();
async function image(n){if(!imageCache.has(n))imageCache.set(n,await sharp({create:{width:540,height:675,channels:3,background:['#75b7bc','#b9cba3','#e2b6a4','#c2b2d2','#eddfb7','#c8d8de'][n%6]}}).png().toBuffer());return imageCache.get(n);}
async function noOverflow(page,label){const data=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('main *')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right>innerWidth+1;}).slice(0,5).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width}))}));assert(data.scroll<=data.width+1,`${label}: ${JSON.stringify(data)}`);}
const results=[];
try{
 browser=await launchBrowser();
for(const width of widths){
 const context=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.addInitScript(()=>localStorage.setItem('spacepenguin.channel','1'));
 const page=await context.newPage(),errors=[],blocked=[],writes=[],exports=[];
 const ch={id:1,slug:'penguin',name:'우주펭귄상회',active:true,version:1,accentColor:'#285f6a',contentType:'manual',budget:{},categories:null};
 let detail={card:{id:8,version:1,title:'자동 이미지 작업',channel:'penguin',format:'카드뉴스',stage:'making',finishedDeck:null,experience:null,altTexts:[],subcategory:'',dueDate:'',memo:'',script:'전체 원고 유지',caption:'내 캡션',exportDesign:'editorial',sourceLabel:'브라우저 테스트용 합성 자료',panels:Array.from({length:4},(_,i)=>({scene:`장면 ${i+1}`,dialogue:`본문 ${i+1}`,imageId:i===0?91:null,poseRefs:[]})),characters:[],imagePath:'',sourceItemId:null,createdAt:stamp,updatedAt:stamp},revisions:[],jobs:[],images:[]};
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method(),body=request.postData()?request.postDataJSON():undefined;
   if(url.origin!==origin){blocked.push(url.href);return route.abort();}
   if(!p.startsWith('/api/'))return route.continue();
   if(method!=='GET')writes.push({path:p,method,body:clone(body)});
   let json;
   if(p==='/api/auth/me')json={user:'fixture',demo:false,csrf:'fixture-csrf',recoveryScope:'studio-image-browser-fixture',authConfigured:true,demoAllowed:false};
   else if(p==='/api/channels')json=[ch];
   else if(p==='/api/channels/1/today')json={counts:{pendingReview:0}};
   else if(p==='/api/status')json={globalStop:false,workerConnected:true,integrations:{flags:{dryRun:true,autoPublish:false}}};
   else if(p==='/api/studio/cards')json={cards:[detail.card],notes:'',notesVersion:1,ai:{defaultProvider:'openai',text:{openai:true,gemini:false,anthropic:false},image:true}};
   else if(p==='/api/studio/cards/8'){
     if(method==='PATCH'){assert.equal(body.version,detail.card.version);detail.card={...detail.card,...clone(body),version:detail.card.version+1};json=detail.card;}
     else json=detail;
   }else if(p==='/api/studio/cards/8/generate'){
     assert.equal(body.version,detail.card.version);assert.equal(body.kind,'image');assert.deepEqual(body.panelIndexes,[1,2,3]);assert.match(body.requestId,/^[0-9a-f-]{36}$/i);
     const queued={id:77,status:'queued',result:null,lastError:null,createdAt:stamp,finishedAt:null};
     detail.card={...detail.card,version:detail.card.version+1,panels:detail.card.panels.map((panel,index)=>index?{...panel,imageId:91+index}:panel)};
     detail.jobs=[{...queued,status:'succeeded',finishedAt:stamp,result:{kind:'image',panelIndexes:[1,2,3],panelIndex:null,completedPanels:[1,2,3].map(index=>({panelIndex:index,imageId:91+index,revisionId:4,version:detail.card.version,applied:true})),remainingPanelIndexes:[],activePanelIndex:null,applied:true,partial:false,message:'3/3컷을 저장했습니다.'}}];json={job:queued,duplicate:false};
   }else if(p==='/api/studio/export-check')json={errors:[],warnings:[],pageCount:6};
   else if(p==='/api/studio/cards/8/publication')json={channelId:1,channelName:ch.name,expectedUsername:'spacepenguin.co',ready:false,blockers:[],dailyLimit:0,dryRun:true,autoPublish:false,destinations:[{id:20,label:'@spacepenguin.co',enabled:true,configured:true}],deliveries:[],publicationDraft:{version:1,options:{destinationIds:[20],timing:'now',scheduledAtKst:''}}};
   else if(p==='/api/studio/characters/reference')return route.fulfill({contentType:'image/png',body:await image(0)});
   else if(/^\/api\/studio\/images\/\d+$/.test(p))return route.fulfill({contentType:'image/png',body:await image(Number(p.split('/').at(-1)))});
   else if(p==='/api/studio/cards/8/export.png'){exports.push({version:url.searchParams.get('version'),page:url.searchParams.get('page')});return route.fulfill({contentType:'image/png',body:await image(Number(url.searchParams.get('page')))});}
   else{errors.push(`Unmocked ${method} ${p}`);return route.fulfill({status:404,json:{error:'fixture missing'}});}
   return route.fulfill({json:clone(json)});
 });
 try{
   await page.goto(origin+'/studio/8');
   const composition=page.locator('#studio-composition');await composition.waitFor();
   const auto=composition.locator('.work-mode-options button').nth(0),manual=composition.locator('.work-mode-options button').nth(1);
   assert.equal(await auto.getAttribute('aria-pressed'),'true');
   const art=page.getByAltText('1컷 저장된 그림',{exact:true});await art.evaluate(img=>img.decode());
   assert.equal(writes.filter(x=>x.path.endsWith('/generate')).length,0);
   const scene=page.getByLabel('1컷 장면',{exact:true});await scene.fill('다음 단계로 이동해도 남아야 하는 장면');
   await manual.click();assert.equal(await manual.getAttribute('aria-pressed'),'true');assert.equal(await scene.inputValue(),'다음 단계로 이동해도 남아야 하는 장면');
   await auto.click();assert.equal(await scene.inputValue(),'다음 단계로 이동해도 남아야 하는 장면');
   await page.getByRole('button',{name:'캡션과 최종 이미지 →',exact:true}).click();
   const caption=page.locator('#studio-caption textarea').first();await caption.fill('이미지를 고쳐도 유지할 게시 캡션');
   await page.getByRole('button',{name:'← 그림 편집',exact:true}).click();assert.equal(await scene.inputValue(),'다음 단계로 이동해도 남아야 하는 장면');
   await noOverflow(page,'images-before-generation');
   await composition.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/images-before-${width}.png`});
   await page.getByRole('button',{name:'빈 그림 3컷 자동 생성',exact:true}).click();
   await page.getByAltText('4컷 저장된 그림',{exact:true}).waitFor();await page.getByAltText('4컷 저장된 그림',{exact:true}).evaluate(img=>img.decode());
   assert.equal(writes.filter(x=>x.path.endsWith('/generate')).length,1);assert.equal(detail.card.panels[0].imageId,91);assert.equal(detail.card.panels[0].scene,'다음 단계로 이동해도 남아야 하는 장면');assert.equal(detail.card.caption,'이미지를 고쳐도 유지할 게시 캡션');
   await noOverflow(page,'images-after-generation');await composition.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/images-generated-${width}.png`});
   await page.getByRole('button',{name:'캡션과 최종 이미지 →',exact:true}).click();assert.equal(await caption.inputValue(),'이미지를 고쳐도 유지할 게시 캡션');
   const pages=page.getByRole('group',{name:'미리보기 페이지',exact:true});await pages.waitFor();assert.equal(await pages.getByRole('button').count(),6);
   for(const [index,label] of ['표지','본문 1','본문 2','본문 3','본문 4','마무리'].entries()){
     await pages.getByRole('button',{name:`${index+1}페이지 · ${label}`,exact:true}).click();
     const outputImage=page.getByAltText(`자동 이미지 작업 ${index+1}페이지 출력 미리보기`,{exact:true});await outputImage.waitFor();await outputImage.evaluate(img=>img.decode());
     assert.equal(await pages.getByRole('button',{name:`${index+1}페이지 · ${label}`,exact:true}).getAttribute('aria-pressed'),'true');
   }
   await noOverflow(page,'final-preview');await pages.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/six-page-preview-${width}.png`});
   assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.equal(writes.filter(x=>x.path.includes('/publication/')).length,0);
   const result={width,browserEngine,automaticDefault:true,manualRoundTripPreserved:true,stepNavigationPreserved:true,onlyEmptyPanelsGenerated:true,oldArtworkPreserved:true,captionPreserved:true,finalPages:6,paidMockRequests:writes.filter(x=>x.path.endsWith('/generate')),errors,blocked};results.push(result);await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:`${output}/failure-${width}.png`});await writeFile(`${output}/failure-${width}.html`,await page.content());await writeFile(`${output}/failure-${width}.json`,JSON.stringify({errors,blocked,writes,exports,url:page.url()},null,2));throw error;}
 finally{await context.close();}
}
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
