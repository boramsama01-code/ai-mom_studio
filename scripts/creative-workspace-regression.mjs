// Real built React screens, synthetic API responses, existing approved artwork.
// No production credentials, external requests, paid generation or SNS writes.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { preview } from "vite";
import sharp from "sharp";
const require=createRequire(import.meta.url);
let pw; try{pw=require("playwright");}catch{pw=require(require.resolve("playwright",{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??"/nonexistent"]}));}
const output="test-results/creative-workspace";await mkdir(output,{recursive:true});
const image=await readFile("client/public/cardnews14/cinematic-cover.webp");
const stamp="2026-11-06T00:00:00Z", clone=value=>structuredClone(value);
const ai={defaultProvider:"openai",text:{openai:false,anthropic:false,gemini:false},image:false};
const channels=[
 {id:1,slug:"penguin",name:"우주펭귄상회",contentType:"manual",accentColor:"#426b61"},
 {id:2,slug:"opportunities",name:"HighScoop",contentType:"notice",accentColor:"#355d82"},
 {id:3,slug:"current-dialogue",name:"ALLligodang",contentType:"current_dialogue",accentColor:"#9c6d35"},
 {id:4,slug:"fryday",name:"fryday",contentType:"manual",accentColor:"#9e542d"},
].map(channel=>({...channel,active:true,version:1,categories:[],description:"검증용 채널",audience:"중학생과 부모",editorialGuide:"",budget:{},creativeProfile:null,aiSettings:null}));
const panels=()=>Array.from({length:4},(_,index)=>({scene:"장면 "+(index+1),dialogue:"기존에 저장한 대사 "+(index+1),imageId:index+1,poseRefs:[]}));
const card=(id,title,channel,stage,format="카드뉴스")=>({id,title,channel,stage,format,version:1,subcategory:"",dueDate:"",memo:"검증용 기획과 참고 자료",script:"모바일에서 저장하고 PC에서 이어 쓰는 원고",caption:"저장한 캡션",exportDesign:"editorial",sourceLabel:"브라우저 검증용 합성 자료",panels:panels(),characters:[],imagePath:"",finishedDeck:null,experience:null,altTexts:[],sourceItemId:null,createdAt:stamp,updatedAt:stamp});
const initial=[
 card(10,"우주펭귄 가족, 퇴근 후의 작은 소동과 아주 긴 한국어 제목을 다듬는 시간","penguin","writing","웹툰"),
 card(9,"이번 주 놓치면 아쉬운 과학 캠프 세 가지","highscoop","review"),
 card(8,"과학 뉴스 한 편으로 아이와 시작하는 대화","news","review"),
 card(7,"가장 바삭한 감자튀김을 찾아서","fryday","making"),
 card(6,"아이와 떠난 주말 과학관 기록","penguin","idea"),
 card(5,"완성해서 보관한 카드뉴스","highscoop","done"),
];
const video={...card(20,"과학관에서 발견한 장면들","penguin","writing","릴스"),panels:panels().map(p=>({...p,imageId:null})),experience:{event:"",place:"",date:"",notes:"",takeaway:"",tips:"",tone:"담백한 기록",pageCount:5,layout:"photo",media:[],coverId:null,coverAltText:"",pages:[],questions:[]},videoProject:{version:1,ratio:"9:16",audioGuide:"현장의 소리를 살린다",coverMediaId:null,outputMediaId:null,scenes:[{id:"00000000-0000-4000-8000-000000000001",title:"과학관 입구",duration:3,subtitle:"오늘의 발견을 시작해요",narration:"첫 장면의 대본",audio:"현장음",mediaId:null}]}};
video.updatedAt="2026-11-05T00:00:00Z";
initial.push(video);
const browsers=await pw.webkit.launch();const results=[];
let mode="normal"; const cards=new Map(initial.map(value=>[value.id,clone(value)]));
async function intercept(route,origin,errors,writes){
 const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method();
 if(url.origin!==origin)throw new Error("External request blocked: "+url.origin);
 if(!p.startsWith("/api/"))return route.continue();
 const body=method==="GET"?undefined:req.postDataJSON();
 if(method!=="GET")writes.push({p,body});
 let data;
 if(p==="/api/auth/me")data={user:"visual-fixture",demo:false,csrf:"fixture",recoveryScope:"creative-ui-fixture",authConfigured:true,demoAllowed:false};
 else if(p==="/api/channels")data=channels;
 else if(p==="/api/status")data={globalStop:false,workerConnected:true,integrations:{flags:{dryRun:true,autoPublish:false}}};
 else if(/\/channels\/\d+\/today$/.test(p))data={counts:{pendingReview:2}};
 else if(p==="/api/studio/cards"){
  if(mode==="error")return route.fulfill({status:503,json:{error:"통신이 끊겼습니다. 저장된 콘텐츠를 다시 불러와 주세요."}});
  data={cards:mode==="empty"?[]:[...cards.values()],ai,notes:"",notesVersion:1,trashCount:0};
 }else if(/^\/api\/studio\/cards\/\d+$/.test(p)){
  const id=Number(p.split("/").at(-1)),current=cards.get(id);assert(current,"known fixture card");
  if(method==="PATCH"){
   if(body.version!==current.version)return route.fulfill({status:409,json:{error:"다른 기기에서 새 버전을 저장했습니다. 현재 입력은 유지했습니다.",current}});
   const saved={...current,...clone(body),version:current.version+1};cards.set(id,saved);data=saved;
  }else data={card:current,revisions:[],jobs:[],images:[]};
 }else if(p==="/api/studio/ai-status")data=ai;
 else if(p==="/api/studio/export-check")data={errors:[],warnings:[],pageCount:1};
 else if(/\/studio\/cards\/\d+\/media$/.test(p))data=[];
 else if(p==="/api/canva/status")data={connected:false};
 else if(/\/studio\/cards\/\d+\/publication$/.test(p))data={channelId:1,channelName:"우주펭귄상회",expectedUsername:"spacepenguin.co",ready:false,blockers:["검증용 환경 · 외부 게시 차단"],dailyLimit:0,dryRun:true,autoPublish:false,destinations:[],deliveries:[],publicationDraft:{version:0,options:{destinationIds:[],timing:"now",scheduledAtKst:""}}};
 else if(/^\/api\/studio\/(images\/|characters\/)/.test(p)||/export\.png$/.test(p))return route.fulfill({contentType:"image/webp",body:image});
 else if(/\/channels\/\d+\/capture$/.test(p)&&method==="POST"){
  const saved=card(31,body.title||"이동 중 저장한 링크","highscoop","writing");cards.set(31,saved);data={studioCardId:31,itemId:100,duplicate:false,bodyStatus:"not_fetched"};
 }else{errors.push(method+" "+p);return route.fulfill({status:404,json:{error:"Unmocked fixture API: "+p}});}
 return route.fulfill({json:data});
}
async function noOverflow(page,label){
 const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("main *")].filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.left>=0&&r.right>innerWidth+1;}).slice(0,5).map(n=>({tag:n.tagName,cls:n.className,rect:n.getBoundingClientRect().toJSON()}))}));
 assert(value.scroll<=value.width+1,label+": "+JSON.stringify(value));
}
async function shot(page,label){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:output+"/"+label+".png"});}
async function run(root,label,port){
 const server=await preview({configFile:path.resolve(root,"vite.config.ts"),root:path.resolve(root,"client"),build:{outDir:path.resolve(root,"dist/public")},preview:{host:"127.0.0.1",port,strictPort:true}});
 const origin="http://127.0.0.1:"+port;
 try{
 for(const width of [360,393,430,768,1440]){
  const context=await browsers.newContext({viewport:{width,height:1000},locale:"ko-KR",timezoneId:"Asia/Seoul",isMobile:width<768,hasTouch:width<768,reducedMotion:"reduce",serviceWorkers:"block"});
  const page=await context.newPage(),errors=[],writes=[];
  page.on("pageerror",e=>errors.push(e.message));
  await context.route("**/*",route=>intercept(route,origin,errors,writes));
  await page.goto(origin+"/");await page.locator(".studio-content-card").first().waitFor();
  await noOverflow(page,label+" board "+width);await shot(page,label+"-home-"+width);
  const navigation=await page.evaluate(()=>({domReady:performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd,scriptTransferBytes:performance.getEntriesByType("resource").filter(r=>r.name.includes(".js")).reduce((n,r)=>n+r.transferSize,0)}));
  if(label==="after"){
   // Direction B uses the same rendered components and content, with a dense graphite navigator.
   const graphite=await page.addStyleTag({content:".shell .sidebar{background:#222b2c;color:#e5eae6}.shell .brand,.shell .brand small{color:#e5eae6}.shell .nav a{color:#b9c6bf}.shell .nav a[aria-current=page]{background:#374844;color:#fff}.shell .main{background:#f0f3f4}.shell .studio-content-grid{gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}.shell .studio-content-art{aspect-ratio:1.7}.shell .studio-content-copy{padding:12px}.shell .studio-home-heading h1{font-size:22px;letter-spacing:-.02em}@media(max-width:640px){.shell .studio-content-grid{grid-template-columns:minmax(0,1fr)}.shell .studio-content-art{aspect-ratio:auto}}"});
   await shot(page,"direction-b-graphite-"+width);await graphite.evaluate(node=>node.remove());
   await page.getByLabel("작업 검색",{exact:true}).fill("우주펭귄");
   await page.locator(".studio-content-card").filter({hasText:"우주펭귄 가족"}).getByRole("link").first().click();
   await page.getByLabel("전체 원고",{exact:true}).waitFor();
   await noOverflow(page,"editor "+width);await shot(page,"after-editor-"+width);
   const manuscript=page.getByLabel("전체 원고",{exact:true});
   const original=await manuscript.inputValue();
   await manuscript.fill(original+"\n이 기기의 미저장 문구");
   const current=cards.get(10);cards.set(10,{...current,version:current.version+1,script:"다른 기기의 최신 원고"});
   await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
   await page.waitForTimeout(200);
   assert.equal(await manuscript.inputValue(),original+"\n이 기기의 미저장 문구","background query must preserve edits");
   await page.locator(".studio-detail > .page-head").getByRole("button",{name:"저장",exact:true}).click();
   await page.getByRole("alert").filter({hasText:"다른 기기"}).waitFor();
   assert.equal(await manuscript.inputValue(),original+"\n이 기기의 미저장 문구");
   // Discard intentionally through the existing guard, then verify list search survives.
   await page.getByRole("link",{name:"← 내 콘텐츠",exact:true}).click();
   await page.getByRole("button",{name:"버리고 이동",exact:true}).click();
   await page.locator(".studio-content-grid").waitFor();
   assert.equal(await page.getByLabel("작업 검색",{exact:true}).inputValue(),"우주펭귄");
   await page.getByLabel("작업 검색",{exact:true}).fill("");
   await page.getByRole("button",{name:"링크 저장",exact:true}).click();
   await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{readText:async()=>{throw new DOMException("Denied","NotAllowedError");}}}));
   await page.getByRole("button",{name:"붙여넣기",exact:true}).click();
   await page.getByText("주소 입력칸을 길게 눌러 직접 붙여넣어 주세요.",{exact:true}).waitFor();
   await page.getByLabel("저장할 채널",{exact:true}).selectOption("2");
   await page.getByLabel("원문 URL",{exact:true}).fill("https://example.org/youth-program");
   await shot(page,"after-capture-"+width);await noOverflow(page,"capture "+width);
   await page.getByRole("button",{name:"자료 저장",exact:true}).click();
   await page.getByText("자료를 서버에 저장했습니다",{exact:true}).waitFor();
   await page.getByRole("button",{name:"닫기",exact:true}).click();
   await page.goto(origin+"/studio/20");await page.locator(".video-workspace").waitFor();
   await page.getByLabel("화면 자막",{exact:true}).fill("기기에 임시 보관할 자막");
   await noOverflow(page,"video "+width);await shot(page,"after-video-"+width);
   await page.locator(".video-savebar").getByRole("button",{name:"저장",exact:true}).click();
   await page.getByText("서버 저장 완료",{exact:true}).waitFor();
   await page.reload();await page.locator(".video-workspace").waitFor();assert.equal(await page.getByLabel("화면 자막",{exact:true}).inputValue(),"기기에 임시 보관할 자막");
   const navVisible=await page.locator(".mobile-nav").isVisible();assert.equal(navVisible,false,"editing must have one bottom action region");
   // Leave by full navigation; local recovery remains available on return.
   await page.goto(origin+"/assets?tab=brands");await page.locator(".asset-brand").first().waitFor();
   await noOverflow(page,"assets "+width);await shot(page,"after-assets-"+width);
   await page.goto(origin+"/");await page.locator(".creative-overview").waitFor();
   const scopedReads=await page.evaluate(()=>({key:localStorage.getItem("spacepenguin.channel")}));
   await shot(page,"after-return-"+width);
   assert(writes.every(write=>!/(publish|generate|approval|deliveries)/.test(write.p)),"visual QA must never publish or generate");
   if(width===393){
    mode="empty";await page.reload();await page.locator(".studio-home-empty").waitFor();await shot(page,"after-empty-393");mode="error";await page.reload();await page.getByRole("alert").waitFor();await shot(page,"after-error-393");mode="normal";
   }
  }
  assert.deepEqual(errors,[],label+" browser errors");
  results.push({label,width,passed:true,navigation,syntheticApi:true,existingTemplateArtwork:true});
  await writeFile(output+"/results.json",JSON.stringify(results,null,2));
  console.log(label+" "+width+"px: render, layout, saved context and safe actions passed");
  await context.close();
 }
 }finally{await new Promise(resolve=>server.httpServer.close(resolve));}
}
try{
 if(process.env.CREATIVE_BASELINE_DIR)await run(process.env.CREATIVE_BASELINE_DIR,"before",4188);
 await run(process.cwd(),"after",4189);
 await writeFile(output+"/README.txt","Screens are real built React UI with synthetic API data and existing template artwork. before = verified main 42c643d; after = PR build; direction-b = same components with graphite/density alternative. External requests, generation and social publishing were blocked. No claim about production cold-start improvements is made.\n");
}finally{
 await browsers.close();
 for(const name of ["before-home-1440","after-home-1440","direction-b-graphite-1440","after-editor-1440","after-home-393","after-capture-393","after-video-393","after-assets-1440"]){
  try{const bytes=await sharp(await readFile(output+"/"+name+".png")).resize({width:name.endsWith("393")?393:1080,withoutEnlargement:true}).webp({quality:72}).toBuffer();console.log("VISUAL_REVIEW_IMAGE "+name+" "+bytes.toString("base64"));}catch{ /* Earlier layout failures can prevent a later screenshot. Artifacts retain the original failure. */ }
 }
}
