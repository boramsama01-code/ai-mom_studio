/** Offline production-bundle memory probe. Imports the real app, never calls
 * createApp/listen/jobs/database/providers, then performs actual eight-page
 * preflight + preview/deck renders from supplied source fixtures. Concurrent
 * mode also validates the real Canva preview ZIP decoder behind the shared
 * foreground/background image gate. No forced GC,
 * heap cap, paid AI, Canva request or publication. Run:
 * node scripts/cardnews14-memory-qa.mjs --concurrent=2
 * Node/esbuild produces the same external-package ESM shape as deployment. */
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const option=(name,fallback)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=path.resolve(option('output','test-results/cardnews14-memory/production-bundle.json'));
if(!args.includes('--compiled')){
  const {build}=await import('esbuild');
  const dir=path.resolve('test-results/cardnews14-memory/bundle');await fs.mkdir(dir,{recursive:true});
  const entry=path.join(dir,'memory-qa.mjs');
  await build({entryPoints:[fileURLToPath(import.meta.url)],outfile:entry,bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',logLevel:'error'});
  await fs.copyFile('server/services/readingCardRasterWorker.mjs',path.join(dir,'readingCardRasterWorker.mjs'));
  const run=spawnSync(process.execPath,[entry,'--compiled',...args],{stdio:'inherit',env:{...process.env,NODE_ENV:'production',MALLOC_ARENA_MAX:'2',APP_DATABASE_URL:'',DATABASE_URL:''}});
  if(run.error)throw run.error;
  if(run.status!==0)process.exit(run.status??1);
  const report=JSON.parse(await fs.readFile(output,'utf8'));
  if(!report.complete)throw new Error('Memory probe did not complete every expected case');
  console.log(JSON.stringify({node:report.node,peakRssMiB:report.peakRssMiB,parentPeakRssMiB:report.parentPeakRssMiB,processTreePeakRssMiB:report.processTreePeakRssMiB,requests:report.requests,output}));
  const budget=Number(option('budget-mib','512'));
  if(!Number.isFinite(budget)||budget<=0)throw new Error('Invalid memory budget');
  if(report.peakRssMiB>budget)throw new Error(`Measured process-tree peak ${report.peakRssMiB} MiB exceeds ${budget} MiB budget`);
}else{
  const started=performance.now(),samples=[];let requests=0;
  const sample=stage=>{const m=process.memoryUsage();samples.push({stage,elapsedSeconds:+((performance.now()-started)/1000).toFixed(3),rssMiB:+(m.rss/2**20).toFixed(2),heapUsedMiB:+(m.heapUsed/2**20).toFixed(2),externalMiB:+(m.external/2**20).toFixed(2),peakRssMiB:+(process.resourceUsage().maxRSS/1024).toFixed(2)});console.log('MEMORY_SAMPLE '+JSON.stringify(samples.at(-1)));};
  globalThis.fetch=async()=>{throw new Error('External calls are forbidden in the offline memory probe');};
  sample('runtime');
  const app=await import('../server/app');
  if(typeof app.createApp!=='function')throw new Error('Real server module was not included');
  sample('app modules loaded; no app/server created');
  const {loadFonts}=await import('../server/services/card');
  const {layoutReadingCard}=await import('../server/services/readingCard');
  const {readingFontCacheState}=await import('../server/services/readingCardFonts');
  const {readingRasterState,tryBackgroundImageWork}=await import('../server/services/readingCardRaster');
  const {downloadCanvaLibraryExport}=await import('../server/services/canvaLibraryAssets');
  let sampledTreePeakMiB=0;
  const sampleProcessTree=()=>{sampledTreePeakMiB=Math.max(sampledTreePeakMiB,process.memoryUsage().rss/2**20);};
  const memoryTimer=setInterval(sampleProcessTree,20);memoryTimer.unref();

  const {planCarousel,renderCarouselPage}=await import('../server/services/cardCarousel');
  const {READING_CARD_PROFILES,READING_PROFILE_LOGO_ID,readingProfileDesigns}=await import('../shared/readingCardProfiles');
  const {defaultPageDesigns,familyCardCopySchema}=await import('../shared/familyDialogue');
  const {familyDialogueCardFixture}=await import('../tests/fixtures/familyDialogueCard');
  loadFonts();
  for(const legacy of READING_CARD_PROFILES.filter(p=>!p.sourceStyleId)){
    const item=familyDialogueCardFixture();item.templateKey=legacy.id;item.pages[0].fields.headline='똑똑함의 기준';
    layoutReadingCard(item,item.pages[0],{brandName:'ALLligodang'});
  }
  sample('three Pretendard faces and both legacy layouts loaded');
const profile=READING_CARD_PROFILES.find(p=>p.sourceStyleId==='sharp-serif');
const source=JSON.parse(await fs.readFile('assets/cardnews14/layouts/09-sharp-serif/layout.json','utf8'));
const values=Object.fromEntries(source.pages.flatMap(p=>p.elements.filter(e=>e.kind==='text').map(e=>[e.field,e.copy])));
const copy=familyDialogueCardFixture();copy.templateKey=profile.id;
for(const page of copy.pages){
 const prefix='P'+String(page.page).padStart(2,'0');
 page.displayOverrides={kicker:values[prefix+(page.page===1?'_TOPIC_TAG':'_KICKER')]??'',pageNumber:values[prefix+'_PAGE_NUMBER']??'',sourceCredit:values[prefix+'_SOURCE']??'',imageCredit:values[prefix+'_IMAGE_CREDIT']??''};
 const f=page.fields;
 if(page.id==='cover'){f.headline=values.P01_HEADLINE;f.subtitle=values.P01_SUBTITLE;}
 if(page.id==='news_summary'){const paragraphs=values.P02_READING_BODY.split('\n\n');f.title=values.P02_TITLE;f.facts=paragraphs.slice(0,2);f.caveat=paragraphs.slice(2).join('\n\n');}
 if(page.id==='implication')f.takeaway=values.P03_READING_BODY;
 if(page.id==='discussion'){f.scenario=values.P04_SCENARIO;f.question=values.P04_QUESTION;}
 if(page.id==='perspectives'){f.viewA={label:values.P05_VIEW_A_LABEL,body:values.P05_VIEW_A_BODY};f.viewB={label:values.P05_VIEW_B_LABEL,body:values.P05_VIEW_B_BODY};}
 if(page.id==='concept'){Object.assign(f,{concept:values.P06_CONCEPT,definitionA:values.P06_DEFINITION_A,definitionB:values.P06_DEFINITION_B,boundaryCase:values.P06_BOUNDARY_CASE,fillIn:values.P06_FILL_IN});Object.assign(page.displayOverrides,{definitionIndexA:values.P06_DEFINITION_INDEX_A,definitionIndexB:values.P06_DEFINITION_INDEX_B});}
 if(page.id==='activity'){f.homeActivity={label:values.P07_ACTIVITY_LABEL,action:values.P07_ACTIVITY_ACTIONS,resourceId:null};f.optionalActivity=null;Object.assign(page.displayOverrides,{duration:values.P07_DURATION,activityHelp:values.P07_ACTIVITY_HELP});}
 if(page.id==='outro')Object.assign(f,{parentBrand:values.P08_PARENT_BRAND,brandLine:values.P08_BRAND_LINE,cta:values.P08_CTA,handle:values.P08_HANDLE,logoAssetId:READING_PROFILE_LOGO_ID});
}
const assets={A:await fs.readFile('assets/cardnews14/cinematic-ink-teal-background.jpg'),B:await fs.readFile('assets/cardnews14/monochrome-editorial-background.jpg'),C:await fs.readFile('assets/cardnews14/amber-cream-editorial-background.jpg')};
const designs=readingProfileDesigns(profile,defaultPageDesigns());

  const pageImages=Object.assign(new Map(),{credits:new Map()});
  for(const page of copy.pages){
    page.claimRefs=[];
    const element=source.pages[page.page-1].elements.find(e=>e.kind==='image'&&e.asset!=='logo');
    if(element&&assets[element.asset]){
      const assetId=100+page.page;pageImages.set(assetId,assets[element.asset]);pageImages.credits.set(assetId,'AI 생성 이미지');
      designs[page.id].background={...designs[page.id].background,kind:'image',assetId};
    }
  }
  const checked=familyCardCopySchema.safeParse(copy);
  if(!checked.success)throw new Error(JSON.stringify(checked.error.issues));
  const style={layout:'minimal'};
  const plan=()=>planCarousel({kind:'current_dialogue',payload:{cardCopy:copy,pageDesigns:designs},channelName:'ALLligodang',channelSlug:'news',accent:'#D5FF45',sourceOrg:'원문',checkedDate:'2026-11-04'},style);
  const concurrent=Number(option('concurrent','0'));
  if(concurrent!==0&&concurrent!==2)throw new Error('Use --concurrent=2 or omit it');
  // Prepare a deliberately hard-to-compress provider-sized PNG before any
  // foreground rendering. Fixture generation itself must not overlap the gate.
  let previewFixture=null,libraryPreview={included:false};
  if(concurrent===2){
    const [{default:sharp},{zipSync}]=await Promise.all([import('sharp'),import('fflate')]);
    const width=540,height=675,pixels=Buffer.allocUnsafe(width*height*3);let noise=0x6d2b79f5;
    for(let index=0;index<pixels.length;index++){noise^=noise<<13;noise^=noise>>>17;noise^=noise<<5;pixels[index]=noise&255;}
    const png=await sharp(pixels,{raw:{width,height,channels:3}}).png({compressionLevel:0}).toBuffer();
    const archive=zipSync(Object.fromEntries(Array.from({length:8},(_,index)=>[`${index+1}.png`,png])),{level:0});
    const bytes=Buffer.from(archive.buffer,archive.byteOffset,archive.byteLength);
    const pages=Array.from({length:8},(_,index)=>({id:`offline-page-${index+1}`,pageNumber:index+1,width:1080,height:1350}));
    previewFixture={bytes,pages,url:'https://export-download.canva.com/offline-library.zip',pngBytes:png.length};
    sample('Canva preview: eight reduced PNG pages prepared as ZIP before rendering');
  }
  let expected=null;
  const renderDeck=async label=>{
    const planned=plan();sample(`${label}: eight-page preflight`);
    const pages=[];
    for(let index=0;index<8;index++)pages.push(await renderCarouselPage(planned,index,style,null,'',pageImages));
    const hashes=pages.map(bytes=>createHash('sha256').update(bytes).digest('hex'));
    if(expected&&JSON.stringify(hashes)!==JSON.stringify(expected))throw new Error('Repeated render changed an output page');
    expected??=hashes;requests++;sample(`${label}: completed eight-page deck`);
    await new Promise(resolve=>setTimeout(resolve,300));sample(`${label}: natural idle`);
    return pages.reduce((total,bytes)=>total+bytes.length,0);
  };
  const previewPlan=plan();sample('selected-page preview: eight-page preflight');
  await renderCarouselPage(previewPlan,0,style,null,'',pageImages);requests++;sample('selected-page preview: completed');
  const repeats=3;
  for(let index=1;index<=repeats;index++)await renderDeck(`sequential ${index}`);
  if(concurrent===2){
    let fixtureReads=0,startForegroundDuringDownload=false,foregroundDuringDownload=null,foregroundWaitedForBackground=false;
    const fetcher=async(url,options)=>{
      if(url!==previewFixture.url||options.maxBytes<previewFixture.bytes.length)throw new Error('Offline Canva ZIP does not match the bounded download request');
      fixtureReads++;
      if(startForegroundDuringDownload){
        foregroundDuringDownload=(async()=>{
          const planned=plan();sample('foreground preview: requested during Canva background download');
          const bytes=await renderCarouselPage(planned,0,style,null,'',pageImages);
          if(createHash('sha256').update(bytes).digest('hex')!==expected[0])throw new Error('Foreground preview changed after waiting for Canva background work');
          requests++;sample('foreground preview: completed after Canva background gate released');
        })();
        const deadline=Date.now()+10_000;
        while(readingRasterState().pendingPages===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
        const gate=readingRasterState();
        if(gate.pendingPages===0||gate.activeWorkers!==0||gate.activeBackgroundWork!==1)throw new Error('A new foreground preview did not wait for the active Canva background task');
        foregroundWaitedForBackground=true;
      }
      return {finalUrl:url,status:200,contentType:'application/zip',body:previewFixture.bytes};
    };
    const previewWork=()=>downloadCanvaLibraryExport([previewFixture.url],previewFixture.pages,fetcher);
    const deferDuringForeground=async()=>{
      const deadline=Date.now()+10_000;
      while(readingRasterState().pendingPages===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
      if(readingRasterState().pendingPages===0)throw new Error('Foreground raster never reached the shared image gate');
      const attempted=await tryBackgroundImageWork(previewWork);
      if(attempted.accepted||fixtureReads!==0)throw new Error('Canva preview started while foreground raster work was pending');
      sample('Canva preview: deferred without downloading while two foreground decks render');
      return true;
    };
    const [,,deferredDuringForeground]=await Promise.all([renderDeck('concurrent A'),renderDeck('concurrent B'),deferDuringForeground()]);
    sample('Canva preview: admitted after both foreground decks completed');
    startForegroundDuringDownload=true;
    const cached=await tryBackgroundImageWork(previewWork);
    if(!cached.accepted||cached.value.length!==8||fixtureReads!==1)throw new Error('The deferred Canva preview did not complete exactly one offline ZIP download');
    await foregroundDuringDownload;
    const images=cached.value;
    if(images.some((image,index)=>image.page!==index||image.width!==540||image.height!==675||image.width*1350!==image.height*1080||image.mime!=='image/webp'))throw new Error('Canva preview changed page order, native aspect ratio, or cache dimensions');
    const gate=readingRasterState();
    if(gate.maxObservedHeavyWork!==1||gate.activeBackgroundWork!==0||gate.activeWorkers!==0||gate.pendingPages!==0||gate.deferredBackgroundWork<1)throw new Error('Foreground raster and Canva background work did not remain mutually exclusive');
    libraryPreview={included:true,fixture:'offline-eight-page-png-zip',fixtureZipBytes:previewFixture.bytes.length,fixturePngBytes:previewFixture.pngBytes,sourcePages:8,originalPixels:{width:1080,height:1350},cachedPixels:{width:540,height:675},cachedPages:images.length,cachedBytes:images.reduce((total,image)=>total+image.bytes.length,0),nativeAspectRatioPreserved:true,deferredDuringForeground,foregroundWaitedForBackground,offlineFetches:fixtureReads,maxObservedHeavyWork:gate.maxObservedHeavyWork,deferredBackgroundWork:gate.deferredBackgroundWork};
    sample('Canva preview: all eight WebP pages cached; shared gate idle');
  }
  sampleProcessTree();clearInterval(memoryTimer);
  const parentPeakRssMiB=process.resourceUsage().maxRSS/1024;
  const processTreePeakRssMiB=Math.max(parentPeakRssMiB,sampledTreePeakMiB);
  const result={complete:true,kind:'offline-production-bundle',node:process.version,platform:process.platform,architecture:process.arch,backend:option('backend','isolated-worker-raster'),allocatorArenaMax:process.env.MALLOC_ARENA_MAX??null,profile:profile.id,requests,repeats,concurrent,preflightPagesPerRequest:8,selectedPagePreviews:1+(libraryPreview.foregroundWaitedForBackground?1:0),deckPagesRendered:8*(repeats+concurrent),peakRssKiB:process.resourceUsage().maxRSS,peakRssMiB:+processTreePeakRssMiB.toFixed(2),parentPeakRssMiB:+parentPeakRssMiB.toFixed(2),processTreePeakRssMiB:+processTreePeakRssMiB.toFixed(2),memoryMeasurement:'single-process RSS including all worker threads; historical maxRSS and 20ms samples; no child process',elapsedSeconds:+((performance.now()-started)/1000).toFixed(3),forcedGC:false,heapCap:false,externalCalls:0,databaseCalls:0,paidAiCalls:0,canvaCalls:0,canvaLibraryPreview:libraryPreview,fonts:readingFontCacheState(),raster:readingRasterState(),outputSha256:expected,samples};
  await fs.mkdir(path.dirname(output),{recursive:true});fsSync.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}
