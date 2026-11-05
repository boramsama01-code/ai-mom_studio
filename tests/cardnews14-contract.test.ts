import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import runtime from '../shared/cardnews14Layout.json';
import live from '../docs/artifacts/cardnews14-live-datasets-20261104.json';
import {READING_CARD_PROFILES,CARDNEWS14_STYLE_IDS,readingProfileDesigns} from '../shared/readingCardProfiles';
import {cardnews14Source} from '../shared/cardnews14Catalog';
import {readingMasterSourceApproved} from '../shared/readingCanvaMasters';
import {defaultPageDesigns} from '../shared/familyDialogue';
import {expectedCanvaDataset} from '../shared/canvaEditorial';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
describe('14-style handoff identity and actual read-only Canva contracts',()=>{
 it('maps stable style keys to all exact source IDs, 112 pages, 644 text and 89 image fields without enabling unverified jobs',()=>{
  const profiles=READING_CARD_PROFILES.filter(p=>p.sourceStyleId);
  expect(profiles).toHaveLength(14);expect(new Set(profiles.map(p=>p.id)).size).toBe(14);
  expect(profiles.reduce((n,p)=>n+p.pages.length,0)).toBe(112);
  expect(profiles.reduce((n,p)=>n+p.pages.reduce((m,p)=>m+p.textBoxes.length,0),0)).toBe(644);
  expect(profiles.reduce((n,p)=>n+p.images.length,0)).toBe(89);
  for(const styleId of CARDNEWS14_STYLE_IDS){
   const p=profiles.find(p=>p.sourceStyleId===styleId)!,source=cardnews14Source(styleId);
   // Keep the original handoff evidence when the editor link points to its saved derivative.
   const verified=live.designs.find(d=>d.sourceId===source.originalSourceId)!;
   expect(p.id).toBe(`cardnews14-${styleId}-v1`);expect(p.templateVersion).toBe(`${p.id}-20261104${styleId==='amber-cream'?'-r2':''}-crop-safe-20261105`);
   expect(verified.pageCount).toBe(8);expect(verified.fields).toEqual(expectedCanvaDataset({conceptMode:'value_definition',hasExternalActivity:false},p));
   expect(source.productionEnabled).toBe(false);expect(readingMasterSourceApproved(p,source.sourceId)).toBe(false);
   expect(p.pages.map(p=>p.page)).toEqual([1,2,3,4,5,6,7,8]);
   expect(p.pages[7].imageBoxes.map(slot=>[slot.field,slot.kind])).toEqual([['P08_PROFILE_IMAGE','profile']]);
   expect(p.images.filter(slot=>slot.kind==='profile')).toHaveLength(1);
  }
 });
 it('keeps the versioned inner-page geometry and source hashes when the first page adopts crop-safe placement',()=>{
  const changed:Array<{styleId:string;page:number;from:number;to:number}>=[];
  const pageIds=['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'];
  for(const profile of READING_CARD_PROFILES){
   if(!profile.sourceStyleId){expect(profile.templateVersion).toBe(`${profile.id}-20261104-crop-safe-20261105`);continue;}
   const source=runtime.styles.find(style=>style.id===profile.sourceStyleId)!;
   expect(profile.sourceLayoutSha256).toBe(source.sourceLayoutSha256);
   expect(profile.sourceAssetsSha256).toBe(source.sourceAssetsSha256);
   for(const [index,page] of profile.pages.entries()){
    const originals=source.pages[index].elements.map(element=>element.kind==='image'?{...element,pageId:pageIds[index]}:element);
    expect(page.elements).toHaveLength(originals.length);
    if(page.page===1)continue; // Cover margins have their own complete geometry/readability regression.
    for(const [elementIndex,element] of page.elements!.entries()){
     const original=originals[elementIndex];
     if(profile.sourceStyleId==='amber-cream'&&[1,4,7].includes(page.page)&&original.kind==='rect'&&original.x===72&&original.y===1258&&original.width===720&&original.height===2){
      expect(original).toMatchObject({fill:'#FFD579',radius:0,strokeWidth:1});
      expect(element).toEqual({...original,y:1290});
      const credit=page.textBoxes.find(box=>box.field===`P0${page.page}_IMAGE_CREDIT`)!;
      expect(credit).toMatchObject({x:72,y:1248,width:620,height:30});
      expect(credit.y+credit.height+12).toBe(element.y);
      changed.push({styleId:profile.sourceStyleId,page:page.page,from:original.y,to:element.y});
     }else expect(element).toEqual(original);
    }
   }
  }
  expect(changed).toEqual([4,7].map(page=>({styleId:'amber-cream',page,from:1258,to:1290})));
 });
 it('pins the exact source layout and selected source assets and does not ship example article text as runtime defaults',()=>{
  for(const style of runtime.styles){
   const source=readFileSync(style.sourceLayoutPath);expect(sha(source)).toBe(style.sourceLayoutSha256);
   const raw=JSON.parse(source.toString());
   for(const [i,page] of style.pages.entries()){
    expect(page.elements.map(e=>e.kind)).toEqual(raw.pages[i].elements.map((e:any)=>e.kind));
    for(const element of page.elements){expect(element).not.toHaveProperty('copy');expect(element).not.toHaveProperty('unwrappedCopy');expect(element).not.toHaveProperty('asset');}
   }
   for(const asset of style.sourceAssets){const file=asset.key==='logo'?'assets/branding/allligodang-bw.png':`assets/cardnews14/${asset.path}`;expect(sha(readFileSync(file))).toBe(asset.sha256);}
   const canonical=JSON.stringify(style.sourceAssets.map(asset=>({key:asset.key,path:asset.path,sha256:asset.sha256})));
   expect(sha(canonical)).toBe(style.sourceAssetsSha256);
  }
 });
 it('uses the source focal point once, then preserves a deliberate saved centre and an owned photo',()=>{
  const p=READING_CARD_PROFILES.find(p=>p.id==='cardnews14-cobalt-paper-v1')!,empty=defaultPageDesigns();
  const initialized=readingProfileDesigns(p,empty);expect(initialized.cover.background.focalY).toBe(64);
  initialized.cover.background.focalY=50;expect(readingProfileDesigns(p,initialized).cover.background.focalY).toBe(50);
  empty.cover.background={...empty.cover.background,kind:'image',assetId:101,focalX:50,focalY:50};
  expect(readingProfileDesigns(p,empty).cover.background).toMatchObject({assetId:101,focalX:50,focalY:50});
 });
 it('defaults new empty artwork pages to a shared cover without overwriting a manual picture or an explicit opt-out',()=>{
  const p=READING_CARD_PROFILES.find(p=>p.id==='cardnews14-cinematic-v1')!,d=defaultPageDesigns();
  d.news_summary.background={...d.news_summary.background,kind:'image',assetId:17,focalX:73};
  d.implication.background.inheritCover=false;
  const next=readingProfileDesigns(p,d);
  expect(next.cover.background.inheritCover).toBe(false);expect(next.outro.background.inheritCover).toBe(false);
  expect(next.news_summary.background).toMatchObject({kind:'image',assetId:17,focalX:73,inheritCover:false});
  expect(next.implication.background.inheritCover).toBe(false);expect(next.discussion.background.inheritCover).toBe(true);
  expect(d.discussion.background.inheritCover).toBeUndefined();
 });
});
