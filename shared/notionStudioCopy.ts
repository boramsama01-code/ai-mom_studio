import { CARD_COPY_MANUAL_LIMITS, cardCopySchema, type CardCopy } from './cardCopy';
import { NOTION_MANUSCRIPT_MAX_PAGES, type NotionDocument } from './notionSync';

// Linked manuscripts can have more pages than the generic manual/AI editor.
// Keep its field, unique-ID and story-format validation without relaxing other editors.
export const notionCardCopySchema = cardCopySchema.safeExtend({
 pages:cardCopySchema.shape.pages.element.array().min(1).max(NOTION_MANUSCRIPT_MAX_PAGES-1),
});

/** Complex editorial fields need their own round-trip format; never silently drop them. */
export function notionPlainCardCopy(value:unknown):CardCopy {
 const copy=notionCardCopySchema.parse(value);
 if(copy.storyFormat || copy.pages.some(p=>p.columns||p.resource||p.role))throw new Error('노션 연결은 일반 카드뉴스 원고용입니다. 두 칸·대화형 원고는 별도 작업으로 보존해 주세요.');
 return copy;
}
/** Never shorten a source article to fit a design. Oversize copy is an explicit validation error. */
export function notionDocumentToCopy(doc:NotionDocument,templateKey='builtin:classic'):CardCopy {
 if(doc.pages.length<2||doc.pages.length>NOTION_MANUSCRIPT_MAX_PAGES)throw new Error(`노션 원고는 표지를 포함해 2~${NOTION_MANUSCRIPT_MAX_PAGES}장으로 나누어 주세요.`);
 if(!doc.pages.every((page,i)=>page.index===i+1))throw new Error('노션 원고의 장 번호는 1장부터 빠짐없이 순서대로 작성해 주세요.');
 return notionCardCopySchema.parse({version:1,templateKey,cover:{title:doc.coverTitle.trim()||doc.pages[0].title,subtitle:doc.pages[0].body},pages:doc.pages.slice(1).map((p,i)=>({id:`body-${i+1}`,title:p.title,subtitle:'',body:p.body}))});
}
export function notionCopyText(value:CardCopy){const copy=notionPlainCardCopy(value);return {cover:{title:copy.cover.title,body:copy.cover.subtitle},pages:copy.pages.map(p=>({title:p.title,body:p.body,subtitle:p.subtitle}))};}
type WritebackContext={baseline:Pick<NotionDocument,'coverTitle'|'pages'>;current:Pick<NotionDocument,'pages'>};
export function notionCopyToPages(value:CardCopy,context?:WritebackContext){
 const copy=notionPlainCardCopy(value);
 const baseCover=context?(context.baseline.coverTitle.trim()||context.baseline.pages[0]?.title):undefined;
 // A thumbnail-title property and the source's first-page headline are separate fields.
 // Preserve that headline unless the operator actually edited the Studio cover title.
 const coverHeadline=context&&copy.cover.title===baseCover?context.current.pages[0]?.title??copy.cover.title:copy.cover.title;
 const pages:Array<{index:number;title:string;body:string;cardFields?:NonNullable<NotionDocument['pages'][number]['cardFields']>}>= [{index:1,title:coverHeadline,body:copy.cover.subtitle},...copy.pages.map((p,i)=>({index:i+2,title:p.title,body:[p.subtitle,p.body].filter(Boolean).join('\n\n')}))];
 for(const page of pages){
  const fields=context?.current.pages.find(p=>p.index===page.index)?.cardFields;
  if(!fields)continue;
  const previous=[fields.subtitle,fields.body].filter(x=>x.trim()).join('\n\n');
  if(page.body===previous){page.cardFields={...fields};continue;}
  // Keep notes in their original table columns. Studio edits the article body;
  // changing subtitle/footnote/source columns is an explicit Notion-table edit.
  const prefix=fields.subtitle.trim()?`${fields.subtitle}\n\n`:'';
  if(prefix&&!page.body.startsWith(prefix))throw new Error('표의 소제목·각주·출처표시는 노션 카드 원고 표에서 수정한 뒤 다시 가져와 주세요.');
  page.cardFields={...fields,body:page.body.slice(prefix.length)};
 }
 if(pages.slice(1).some(page=>[...page.body].length>CARD_COPY_MANUAL_LIMITS.body))throw new Error('노션으로 반영할 내지 소제목과 본문을 합쳐 1000자 이내로 작성해 주세요.');
 return pages;
}
export function notionSyncChange(sourceChanged:boolean,studioChanged:boolean){return sourceChanged?studioChanged?'conflict':'notion_changed':studioChanged?'studio_changed':'unchanged';}
