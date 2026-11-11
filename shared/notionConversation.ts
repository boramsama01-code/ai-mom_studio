import {z} from 'zod';
import type {CardCopy} from './cardCopy';
import {notionEditorRequestSchema,type NotionDesignEdits,type NotionStudioDetail} from './notionStudio';
import {notionInteriorTemplates,type NotionInteriorTemplate} from './notionPageTemplates';

const text=(max:number,required=false)=>z.string().refine(value=>!required||!!value.trim(),'내용을 입력해 주세요.').refine(value=>[...value].length<=max,`${max}자 이내로 입력해 주세요.`);
export const notionProductionProfileSchema=z.object({
 voice:text(2000),visualStyle:text(2000),referenceText:text(6000),instructions:text(2000),
 referenceDesignUrl:z.string().max(500).refine(value=>!value||/^https:\/\/www\.canva\.com\/(?:design|d)\/[A-Za-z0-9_/-]+(?:\?[^\s]*)?$/.test(value),'Canva 디자인 링크를 입력해 주세요.'),
}).strict();
export type NotionProductionProfile=z.infer<typeof notionProductionProfileSchema>;
export type NotionProductionProfileRecord={version:number;profile:NotionProductionProfile};
export const notionProductionProfileRequestSchema=z.object({version:z.number().int().min(0),profile:notionProductionProfileSchema}).strict();
export const defaultNotionProductionProfile=(highscoop=true):NotionProductionProfile=>({
 voice:highscoop?'영재교육원 10년차 워킹맘이 직접 겪은 일을 편하게 들려주는 말투. 짧고 긴 문장을 섞고 ㅎㅎ·^^와 괄호 속 여담은 소량 사용. 훈계하거나 모범 부모처럼 포장하지 않는다. 개인 경험과 기관의 공식 절차를 구분한다.':'채널의 기존 원고와 말투를 유지하며 자연스럽고 명확한 한국어로 쓴다.',
 visualStyle:highscoop?'사진 위 아래에서 올라오는 검은 페이드, 흰색 제목과 코랄 포인트. 내지는 크림·흰색 바탕, 굵은 제목, 얇은 구분선, 필요한 곳에 형광펜 강조. 안전영역은 첫 썸네일에만 적용. 표의 텍스트는 가운데 정렬. 마지막은 둥근 검색창 속 @highscoop.official.':'현재 선택한 카드의 템플릿과 강조색을 유지한다.',
 referenceText:highscoop?'2020년에는 정보가 없어서 여기서 많이 배워가겠다고 글을 마쳤었는데, 이번에는 제가 찾아본 것도 조금 나눌 수 있으면 좋겠네요^^':'',instructions:'없는 경험·날짜·수치·기관 조건을 만들지 않는다. 자료가 없으면 확인 필요라고 표시한다. 실제 서류·인물 사진을 대신 지어내지 않는다.',
 referenceDesignUrl:highscoop?'https://www.canva.com/design/DAHafIuAd5c/2Wc0SG4uVCmXjzIXJEjxBA/edit':'',
});
export const notionConversationMessageSchema=z.object({role:z.enum(['user','assistant']),text:text(1200,true)}).strict();
export const notionConversationRequestSchema=notionEditorRequestSchema.extend({
 page:z.number().int().min(0).max(19),instruction:text(2000,true),history:z.array(notionConversationMessageSchema).max(6).default([]),
}).strict();
export type NotionConversationRequest=z.infer<typeof notionConversationRequestSchema>;
export const notionConversationPatchSchema=z.object({title:text(200,true),body:text(1000),emphasis:text(100),template:z.enum(notionInteriorTemplates).optional()}).strict();
export type NotionConversationPatch=z.infer<typeof notionConversationPatchSchema>;
export const notionConversationResultSchema=z.object({page:z.number().int().min(0).max(19),sourceSignature:z.string().min(1).max(100),patch:notionConversationPatchSchema,summary:text(500,true)}).strict();
export type NotionConversationResult=z.infer<typeof notionConversationResultSchema>;
type SourcePage=NotionStudioDetail['source']['pages'][number]|undefined;

/** Draft freshness marker only; authorization and durable versions are checked on the server. */
export function notionConversationSignature(copy:CardCopy,designEdits:NotionDesignEdits,page:number):string{
 const serialized=JSON.stringify({copy,designEdits,page},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 let hash=2166136261;for(let i=0;i<serialized.length;i++){hash^=serialized.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return `${page}:${serialized.length}:${(hash>>>0).toString(16)}`;
}
export function notionConversationBody(copy:CardCopy,page:number,sourcePage:SourcePage):string{
 if(page===0)return copy.cover.subtitle;
 const selected=copy.pages[page-1];if(!selected)throw new Error('수정할 카드를 선택해 주세요.');
 const combined=[selected.subtitle,selected.body].filter(Boolean).join('\n\n');
 const subtitle=sourcePage?.cardFields?.subtitle??'',prefix=subtitle.trim()?`${subtitle}\n\n`:'';
 return prefix&&combined.startsWith(prefix)?combined.slice(prefix.length):combined;
}
/** Only the chosen card can change. Source subtitle/footnotes and every other card are preserved. */
export function applyNotionConversationPatch(copy:CardCopy,designEdits:NotionDesignEdits,page:number,sourcePage:SourcePage,patch:NotionConversationPatch):{copy:CardCopy;designEdits:NotionDesignEdits}{
 if(!Number.isInteger(page)||page<0||page>copy.pages.length)throw new Error('원고의 표지 또는 본문 카드를 선택해 주세요.');
 const nextCopy=structuredClone(copy),nextEdits=structuredClone(designEdits),key=sourcePage?.key??`page:${page+1}`;
 if(page===0){
  if(patch.template!==undefined)throw new Error('표지는 현재 선택한 표지 디자인을 유지합니다.');
  nextCopy.cover={...nextCopy.cover,title:patch.title,subtitle:patch.body};
 }else{
  const subtitle=sourcePage?.cardFields?.subtitle??'',prefix=subtitle.trim()?`${subtitle}\n\n`:'';
  const body=prefix&&patch.body.startsWith(prefix)?patch.body.slice(prefix.length):patch.body;
  nextCopy.pages[page-1]={...nextCopy.pages[page-1],title:patch.title,subtitle:'',body:prefix+body};
  if(patch.template!==undefined)nextEdits.templateByPage={...nextEdits.templateByPage,[key]:patch.template};
 }
 nextEdits.emphasisByPage={...nextEdits.emphasisByPage,[key]:patch.emphasis};
 return {copy:nextCopy,designEdits:nextEdits};
}

export type {NotionInteriorTemplate};
