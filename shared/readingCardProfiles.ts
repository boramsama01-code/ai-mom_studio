import layout from './readingCardLayout.json';
import type { CardCopyV2, FamilyPageId, PageDesigns } from './familyDialogue';
import { familyDisplayDescriptors, type FamilyDisplayDescriptor } from './familyDisplay';

/** Preview/layout contracts only. A profile does not imply a registered, live Canva master. */
export const READING_PROFILE_IDS = ['reading-ink-lime-v1', 'reading-cobalt-paper-v1'] as const;
export type ReadingProfileId = typeof READING_PROFILE_IDS[number];
export const READING_MAPPING_VERSION = 'family-reading-8/v1.0';
export const READING_PROFILE_LOGO_ID = 'brand:allligodang:bw:20261104';
export const READING_PROFILE_LOGO_PATH = 'assets/branding/allligodang-bw.png';
export const READING_PROFILE_LOGO_SHA256 = '743e3a9bddc5465a08970900eb078148c19aadedd80b55a328a2b4c0bfe25908';
export type ReadingTextBox = { field:string; x:number; y:number; width:number; height:number; fontSize:number; fontWeight:number; lineHeight:number; maxLines:number; align:'left'|'center'|'right'; color:string };
export type ReadingImageBox = { field:string; pageId:FamilyPageId; x:number; y:number; width:number; height:number; kind:'artwork'|'profile' };
export type ReadingShape = { type:'rect'; x:number; y:number; width:number; height:number; fill:string; stroke?:string; strokeWidth?:number } | { type:'line'; x1:number; y1:number; x2:number; y2:number; stroke:string; strokeWidth:number };
export type ReadingPageLayout = { page:number; background:string; shapes:ReadingShape[]; textBoxes:ReadingTextBox[]; imageBoxes:ReadingImageBox[] };
export type ReadingCardProfile = { id:ReadingProfileId; templateKey:ReadingProfileId; templateVersion:string; mappingVersion:string; label:string; pages:ReadingPageLayout[]; images:ReadingImageBox[]; profileImagePath:string; profileImageSha256:string; profileImageAssetId:string };
const pageIds:FamilyPageId[] = ['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'];
export const READING_CARD_PROFILES:ReadingCardProfile[] = layout.styles.map((style,index) => {
  const id=READING_PROFILE_IDS[index];
  const pages=style.pages.map(page => ({ ...page, shapes:page.shapes as ReadingShape[], textBoxes:page.textBoxes as ReadingTextBox[], imageBoxes:page.imageBoxes.map(box => ({...box,pageId:pageIds[page.page-1],kind:page.page===8?'profile' as const:'artwork' as const})) }));
  return { id,templateKey:id,templateVersion:id+'-20261104',mappingVersion:READING_MAPPING_VERSION,label:style.name,pages,images:pages.flatMap(page=>page.imageBoxes),profileImagePath:READING_PROFILE_LOGO_PATH,profileImageSha256:READING_PROFILE_LOGO_SHA256,profileImageAssetId:'MAHZ7ZCRRbs' };
});
export function readingProfileForTemplateKey(key:unknown):ReadingCardProfile|undefined { return READING_CARD_PROFILES.find(profile=>profile.templateKey===key); }
export function readingProfileForTemplateVersion(version:unknown):ReadingCardProfile|undefined { return READING_CARD_PROFILES.find(profile=>profile.templateVersion===version); }
export function readingImageSlot(profile:ReadingCardProfile,pageId:FamilyPageId) { return profile.images.find(image=>image.pageId===pageId); }
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
 * Images outside its three photo windows remain selectable from content history. */
export function readingProfileDesigns(profile:ReadingCardProfile,current:PageDesigns):PageDesigns {
  return Object.fromEntries(pageIds.map((id,index)=>{
    const previous=current[id], background=previous.background;
    const slot=readingImageSlot(profile,id), useImage=slot?.kind==='artwork'&&background.kind==='image'&&!!background.assetId;
    const previousAssetIds=[...new Set([...(previous.previousAssetIds??[]),...(background.assetId?[background.assetId]:[])])].slice(-20);
    return [id,{ ...previous,alignment:'left',background:{...background,kind:useImage?'image':'brand',color:profile.pages[index].background,...(!useImage?{assetId:undefined}:{}),overlay:0},previousAssetIds }];
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
