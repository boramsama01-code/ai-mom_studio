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
   const verified=live.designs.find(d=>d.sourceId===source.sourceId)!;
   expect(p.id).toBe(`cardnews14-${styleId}-v1`);expect(p.templateVersion).toBe(`${p.id}-20261104`);
   expect(verified.pageCount).toBe(8);expect(verified.fields).toEqual(expectedCanvaDataset({conceptMode:'value_definition',hasExternalActivity:false},p));
   expect(source.productionEnabled).toBe(false);expect(readingMasterSourceApproved(p,source.sourceId)).toBe(false);
   expect(p.pages.map(p=>p.page)).toEqual([1,2,3,4,5,6,7,8]);
   expect(p.pages[7].imageBoxes.map(slot=>[slot.field,slot.kind])).toEqual([['P08_PROFILE_IMAGE','profile']]);
   expect(p.images.filter(slot=>slot.kind==='profile')).toHaveLength(1);
  }
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
