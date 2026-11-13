import { channelCategories } from './channelCategories';
import { studioKey } from './channelKeys';
import { channelBrandName } from './branding';
import {expectedInstagramUsername} from './channelInstagram';
import { HIGH_SCOOP_LAYOUT_LABELS, HIGH_SCOOP_TEMPLATE_KITS, HIGH_SCOOP_TEMPLATE_VERSION, isHighScoopChannel } from './highscoopTemplates';

/** One current page system. Historical brand keys remain valid aliases for saved work. */
export const EDITORIAL_TEMPLATE_VERSION = `${HIGH_SCOOP_TEMPLATE_VERSION}-news`;
export const EDITORIAL_LAYOUT_LABELS = HIGH_SCOOP_LAYOUT_LABELS;
export const EDITORIAL_COLOR_IDS = ['red','mint','purple','blue','yellow','cyan'] as const;
export type EditorialColorId = typeof EDITORIAL_COLOR_IDS[number];
export type EditorialChannel = {slug?:string;name?:string;categories?:readonly string[]|null};
export type EditorialTemplate = {key:string;colorId:EditorialColorId;color:string;soft:string;accent:string;category:string;label:string;pageCount:11;layoutLabels:typeof EDITORIAL_LAYOUT_LABELS;canvaEditUrl:string|null;canvaDesignId:string|null};
export type EditorialBrand = {id:string;name:string;handle?:string;logoPath?:string;darkLogoPath?:string;follow:string;introduction:string;action:string};
const COLOR_LABELS=['코랄','민트','라벤더','블루','옐로','시안'] as const;

export function editorialTemplateForKey(key:string|undefined|null):EditorialTemplate|undefined {
 const index=EDITORIAL_COLOR_IDS.findIndex((id,i)=>key===`editorial:${id}`||key===HIGH_SCOOP_TEMPLATE_KITS[i].key);
 if(index<0)return;
 const kit=HIGH_SCOOP_TEMPLATE_KITS[index];
 return {...kit,key:key!.startsWith('highscoop:')?kit.key:`editorial:${EDITORIAL_COLOR_IDS[index]}`,colorId:EDITORIAL_COLOR_IDS[index]};
}
export function isCurrentEditorialTemplate(key:string|undefined|null):boolean{return !!editorialTemplateForKey(key);}
/** Public news posts use one shared tag/color; source topic metadata stays separate. */
export function isEditorialNewsChannel(channel:EditorialChannel):boolean{return studioKey(channel.slug??'')==='news';}
export function editorialTemplateOptions(channel:EditorialChannel):EditorialTemplate[]{
 if(isEditorialNewsChannel(channel)){
  const kit=HIGH_SCOOP_TEMPLATE_KITS[5];
  return [{...kit,key:'editorial:cyan',colorId:'cyan',category:'뉴스',label:'뉴스',canvaEditUrl:null,canvaDesignId:null}];
 }
 const high=isHighScoopChannel(channel),categories=channelCategories(channel.slug??'',channel.categories);
 return EDITORIAL_COLOR_IDS.map((id,index)=>{
  const kit=HIGH_SCOOP_TEMPLATE_KITS[index],category=high?kit.category:categories[index]??COLOR_LABELS[index];
  return {...kit,key:high?kit.key:`editorial:${id}`,colorId:id,category,label:category,
   canvaEditUrl:high?kit.canvaEditUrl:null,canvaDesignId:high?kit.canvaDesignId:null};
 });
}
/** Saved color keys remain readable while News now presents the cyan master. */
export function editorialTemplateForChannel(channel:EditorialChannel,key:string|undefined|null):EditorialTemplate|undefined{
 const current=editorialTemplateForKey(key);if(!current)return;
 const options=editorialTemplateOptions(channel);
 return options.find(kit=>kit.colorId===current.colorId)??(isEditorialNewsChannel(channel)?options[0]:undefined);
}
/** Paths are consumed only by trusted server rendering, never accepted from request bodies. */
export function editorialBrandForChannel(channel:EditorialChannel):EditorialBrand{
 const id=isHighScoopChannel(channel)?'highscoop':studioKey(channel.slug??''),name=channelBrandName({slug:channel.slug??'',name:channel.name?.trim()||channel.slug||'Studio'});
 const username=expectedInstagramUsername(channel.slug??''),handle=username?`@${username}`:undefined;
 if(id==='highscoop')return {id,name:'HighScoop',handle:'@highscoop.official',logoPath:'assets/branding/highscoop-magazine-color.png',darkLogoPath:'assets/branding/highscoop-magazine-dark.png',follow:'아이의 관심에서 다음 도전까지',introduction:'아이의 호기심을 놓치지 않고,\n함께 도전할 기회를 찾아봅니다.',action:'다음 이야기도 궁금하다면, 하이스쿱을 찾아주세요.'};
 if(id==='news')return {id,name:'Alligodang',handle,logoPath:'assets/branding/allligodang-bw.png',follow:'세상 이야기가 우리 집 대화로',introduction:'뉴스와 과학, 세상의 새로운 이야기를\n아이와 함께 읽고 나눕니다.',action:'다음 이야기도 궁금하다면, 알리고당을 찾아주세요.'};
 return {id,name,handle,...(id==='penguin'?{logoPath:'assets/branding/space-penguin-company.png'}:{}),follow:name,introduction:'새로운 이야기와 다음 콘텐츠를 함께 만나보세요.',action:`다음 이야기도 궁금하다면, ${name}을 찾아주세요.`};
}
