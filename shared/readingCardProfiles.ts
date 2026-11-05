import layout from './readingCardLayout.json';
import cardnews14 from './cardnews14Layout.json';
import type { CardCopyV2, FamilyPageId, PageDesigns } from './familyDialogue';
import { familyDisplayDescriptors, type FamilyDisplayDescriptor } from './familyDisplay';
import { readingCoverSafety, READING_COVER_LAYOUT_REVISION } from './readingCoverSafety';

/** Preview/layout contracts only. A profile does not imply a registered, live Canva master. */
export const CARDNEWS14_STYLE_IDS = ['cinematic','monochrome-coral','amber-cream','cobalt-paper','ink-lime','swiss-modernism','studio-2am','ichestyime','sharp-serif','bang-bang','hello','ekiden-pack','you-and-me','ott-recommendation'] as const;
export type Cardnews14StyleId = typeof CARDNEWS14_STYLE_IDS[number];
export const LEGACY_READING_PROFILE_IDS = ['reading-ink-lime-v1', 'reading-cobalt-paper-v1'] as const;
export const READING_PROFILE_IDS = [...LEGACY_READING_PROFILE_IDS,...CARDNEWS14_STYLE_IDS.map(id=>`cardnews14-${id}-v1` as const)] as const;
export type ReadingProfileId = typeof READING_PROFILE_IDS[number];
export const READING_MAPPING_VERSION = 'family-reading-8/v1.0';
export const READING_PROFILE_LOGO_ID = 'brand:allligodang:bw:20261104';
export const READING_PROFILE_LOGO_PATH = 'assets/branding/allligodang-bw.png';
export const READING_PROFILE_LOGO_SHA256 = '743e3a9bddc5465a08970900eb078148c19aadedd80b55a328a2b4c0bfe25908';
export type ReadingTextBox = { field:string; x:number; y:number; width:number; height:number; fontSize:number; fontWeight:number; lineHeight:number; maxLines:number; align:'left'|'center'|'right'; color:string; fontFamily?:'Noto Sans KR'|'Noto Serif KR'; effectiveFontWeight?:number; letterSpacing?:number; fontStyle?:'normal'|'italic'; shadow?:string; opacity?:number };
export type ReadingImageBox = { field:string; pageId:FamilyPageId; x:number; y:number; width:number; height:number; kind:'artwork'|'profile'; fit?:'cover'|'contain'; position?:string; radius?:number; opacity?:number; rotation?:number; treatment?:{tone:'color'|'monochrome'} };
export type ReadingShape = { type:'rect'; x:number; y:number; width:number; height:number; fill:string; stroke?:string; strokeWidth?:number } | { type:'line'; x1:number; y1:number; x2:number; y2:number; stroke:string; strokeWidth:number };
export type ReadingElement = ({kind:'text'} & ReadingTextBox) | ({kind:'image'} & Omit<ReadingImageBox,'kind'>) | {kind:'rect'; x:number; y:number; width:number; height:number; fill:string; radius?:number; stroke?:string; strokeWidth?:number; rotation?:number; opacity?:number};
export type ReadingPageLayout = { page:number; background:string; shapes:ReadingShape[]; textBoxes:ReadingTextBox[]; imageBoxes:ReadingImageBox[]; elements?:ReadingElement[] };
export type ReadingCardProfile = { id:ReadingProfileId; templateKey:ReadingProfileId; templateVersion:string; mappingVersion:string; label:string; pages:ReadingPageLayout[]; images:ReadingImageBox[]; profileImagePath:string; profileImageSha256:string; profileImageAssetId:string; sourceLayoutSha256?:string; sourceAssetsSha256?:string; sourceStyleId?:Cardnews14StyleId; previewUrl?:string };
const pageIds:FamilyPageId[] = ['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'];
const legacyIds:Record<string,typeof LEGACY_READING_PROFILE_IDS[number]> = {'ink_lime':'reading-ink-lime-v1','cobalt_paper':'reading-cobalt-paper-v1'};
const legacyProfiles:ReadingCardProfile[] = layout.styles.map(style => {
  const id=legacyIds[style.id];
  if(!id)throw new Error(`Unknown legacy reading style: ${style.id}`);
  const pages=style.pages.map(page => readingCoverSafety(style.id.replace('_','-'),{ ...page, shapes:page.shapes as ReadingShape[], textBoxes:page.textBoxes as ReadingTextBox[], imageBoxes:page.imageBoxes.map(box => ({...box,fit:box.fit as 'cover'|'contain',pageId:pageIds[page.page-1],kind:page.page===8?'profile' as const:'artwork' as const})) }));
  return { id,templateKey:id,templateVersion:id+'-20261104-'+READING_COVER_LAYOUT_REVISION,mappingVersion:READING_MAPPING_VERSION,label:style.name,pages,images:pages.flatMap(page=>page.imageBoxes),profileImagePath:READING_PROFILE_LOGO_PATH,profileImageSha256:READING_PROFILE_LOGO_SHA256,profileImageAssetId:'MAHZ7ZCRRbs' };
});
const newProfiles:ReadingCardProfile[] = CARDNEWS14_STYLE_IDS.map(styleId=>{
  const style=cardnews14.styles.find(value=>value.id===styleId);
  if(!style)throw new Error(`Missing cardnews14 layout: ${styleId}`);
  const id=`cardnews14-${styleId}-v1` as const;
  const pages:ReadingPageLayout[]=style.pages.map(page=>{
    let elements=page.elements.map(element=>element.kind==='image'?{...element,pageId:pageIds[page.page-1]}:element) as ReadingElement[];
    // Studio r2 corrects three rules crossing the image credit. Keep the handoff
    // layout/hash and native Canva original intact; this is a versioned adapter.
    if(styleId==='amber-cream'&&[1,4,7].includes(page.page)) {
      const rules=elements.flatMap((element,index)=>element.kind==='rect'&&element.x===72&&element.y===1258&&element.width===720&&element.height===2&&element.fill==='#FFD579'&&element.radius===0&&element.strokeWidth===1?[index]:[]);
      if(rules.length!==1)throw new Error(`Amber Cream source rule changed on page ${page.page}; verify the derived layout before rendering.`);
      elements=elements.map((element,index)=>index===rules[0]?{...element,y:1290}:element);
    }
    return readingCoverSafety(styleId,{page:page.page,background:page.background,elements,
      shapes:elements.filter((e):e is Extract<ReadingElement,{kind:'rect'}>=>e.kind==='rect').map(({kind,...shape})=>({type:'rect' as const,...shape})),
      textBoxes:elements.filter((e):e is Extract<ReadingElement,{kind:'text'}>=>e.kind==='text'),
      imageBoxes:elements.filter((e):e is Extract<ReadingElement,{kind:'image'}>=>e.kind==='image').map(({kind,...box})=>({...box,kind:page.page===8?'profile' as const:'artwork' as const})),
    });
  });
  return {id,templateKey:id,templateVersion:id+'-20261104'+(styleId==='amber-cream'?'-r2':'')+'-'+READING_COVER_LAYOUT_REVISION,mappingVersion:READING_MAPPING_VERSION,label:style.name,pages,images:pages.flatMap(page=>page.imageBoxes),profileImagePath:READING_PROFILE_LOGO_PATH,profileImageSha256:READING_PROFILE_LOGO_SHA256,profileImageAssetId:'MAHZ7ZCRRbs',sourceStyleId:styleId,sourceLayoutSha256:style.sourceLayoutSha256,sourceAssetsSha256:style.sourceAssetsSha256,previewUrl:`/cardnews14/${styleId}.webp`};
});
/** Existing IDs/versioned snapshots remain stable; new styles have their own identity. */
export const READING_CARD_PROFILES:ReadingCardProfile[]=[...legacyProfiles,...newProfiles];
export function readingArtworkPages(profile:ReadingCardProfile):string { return profile.images.filter(slot=>slot.kind==='artwork').map(slot=>profile.pages.find(page=>page.imageBoxes.some(image=>image.field===slot.field))!.page).join('·'); }
export function readingProfileForTemplateKey(key:unknown):ReadingCardProfile|undefined { return READING_CARD_PROFILES.find(profile=>profile.templateKey===key); }
export function readingProfileForTemplateVersion(version:unknown):ReadingCardProfile|undefined { return READING_CARD_PROFILES.find(profile=>profile.templateVersion===version); }
export function readingImageSlot(profile:ReadingCardProfile,pageId:FamilyPageId) { return profile.images.find(image=>image.pageId===pageId); }
/** Source crop defaults apply only to a newly selected empty slot. Stored image
 * focal points, including a deliberate 50%, are never inferred as missing. */
function sourceFocalPoint(position='center') {
  const [x='center',y='center']=position.trim().split(/\s+/);
  const value=(part:string)=>part==='center'?50:/^\d+(?:\.\d+)?%$/.test(part)?Math.max(0,Math.min(100,Number(part.slice(0,-1)))):50;
  return {focalX:value(x),focalY:value(y)};
}
export function readingDisplayDescriptors(profile:ReadingCardProfile,page:CardCopyV2['pages'][number]):FamilyDisplayDescriptor[] {
  const visible=new Set(profile.pages[page.page-1].textBoxes.map(box=>box.field));
  const descriptors=familyDisplayDescriptors(page).filter(field=>visible.has(field.canvaField));
  if(page.id==='concept'&&page.fields.mode==='scientific_explanation') descriptors.push(
    {key:'definitionIndexA',label:'확인된 정의 앞 안내',max:40,canvaField:'P06_DEFINITION_INDEX_A'},
    {key:'definitionIndexB',label:'예시·반례 앞 안내',max:40,canvaField:'P06_DEFINITION_INDEX_B'},
  );
  return descriptors;
}
/** Selecting a layout changes design settings, never article copy or stored images.
 * Images outside the selected style's photo windows remain in content history. */
export function readingProfileDesigns(profile:ReadingCardProfile,current:PageDesigns):PageDesigns {
  return Object.fromEntries(pageIds.map((id,index)=>{
    const previous=current[id], background=previous.background;
    const slot=readingImageSlot(profile,id), useImage=slot?.kind==='artwork'&&background.kind==='image'&&!!background.assetId;
    const previousAssetIds=[...new Set([...(previous.previousAssetIds??[]),...(background.assetId?[background.assetId]:[])])].slice(-20);
    // A style without this photo window only hides inheritance; it is not a
    // user opt-out. Keep the preference through sparse and legacy styles.
    const inheritCover=(profile.sourceStyleId&&(id==='cover'||id==='outro')||id==='cover'&&slot?.fit==='contain')?false
      :profile.sourceStyleId&&slot?.kind==='artwork'?!useImage&&background.inheritCover!==false
      :background.inheritCover;
    const overlay=background.color?.toUpperCase()===profile.pages[index].background.toUpperCase()?background.overlay:0;
    const newEmptySlot=slot?.kind==='artwork'&&!background.assetId&&background.inheritCover===undefined&&background.focalX===50&&background.focalY===50;
    const defaults=newEmptySlot&&(profile.sourceStyleId||id==='cover'&&slot.fit==='contain')?{...sourceFocalPoint(slot.position),fit:slot.fit??background.fit}:{};
    return [id,{ ...previous,alignment:'left',background:{...background,...defaults,kind:useImage?'image':'brand',color:profile.pages[index].background,...(!useImage?{assetId:undefined}:{}),overlay,...(inheritCover!==undefined?{inheritCover}: {})},previousAssetIds }];
  })) as PageDesigns;
}
export function readingProfileDesignErrors(profile:ReadingCardProfile,designs:PageDesigns):string[] {
  const errors:string[]=[];
  for(const [index,id] of pageIds.entries()) {
    const design=designs[id],slot=readingImageSlot(profile,id),expected=profile.pages[index].background;
    if(design.alignment!=='left') errors.push(`${index+1}장: ${profile.label}의 고정 문구 배치를 선택해 주세요.`);
    if(design.background.color?.toUpperCase()!==expected.toUpperCase()) errors.push(`${index+1}장: 선택한 스타일의 고정 바탕색을 사용해 주세요.`);
    if(slot?.kind==='artwork' ? !['brand','image'].includes(design.background.kind) : design.background.kind!=='brand') errors.push(`${index+1}장: 이 스타일에 지정된 사진창과 바탕을 사용해 주세요.`);
  }
  return errors;
}
