import type { StudioContent } from "./studio";
export const ALT_TEXT_LIMIT=1000;
export const conciseAlt=(parts:Array<string|undefined|null>)=>parts.filter(Boolean).join("\n").trim().slice(0,ALT_TEXT_LIMIT);
/** Always derived from displayed text and supplied scene notes; never invent visual details. */
export function studioAltTexts(c:StudioContent):string[]{
 if(c.finishedDeck)return c.finishedDeck.pages.map((p,i)=>p.altText||conciseAlt([c.title,`${i+1} / ${c.finishedDeck!.pages.length}페이지`]));
 const e=c.experience;
 if(e)return [e.coverAltText||conciseAlt([`카드뉴스 표지. ${c.title}`,e.event,e.place,e.date,e.media.find(m=>m.id===e.coverId)?.note,c.sourceLabel]),...e.pages.map(p=>p.altText||conciseAlt([p.title,p.body,e.media.find(m=>m.id===p.mediaId)?.note,c.sourceLabel]))];
 const defaults=c.format==="웹툰"?[conciseAlt([c.title,...c.panels.flatMap((p,i)=>[`${i+1}컷. ${p.scene}`,p.dialogue]),c.sourceLabel])]:[conciseAlt([`카드뉴스 표지. ${c.title}`,c.panels[0]?.imageId?c.panels[0].scene:"",c.sourceLabel]),...c.panels.map((p,i)=>conciseAlt([`${i+2}페이지.`,p.imageId?p.scene:"",p.dialogue,c.sourceLabel])),...(!c.exportDesign.startsWith("set:")?[conciseAlt(["마무리 카드. 다음 이야기에서 만나요.","우주펭귄상회",c.sourceLabel])]:[])];
 return defaults.map((value,i)=>c.altTexts[i]||value);
}
/** Editing must preserve an intentionally cleared field instead of restoring the fallback on each keystroke. */
export function studioAltTextDrafts(c:StudioContent):string[]{
 if(c.finishedDeck)return c.finishedDeck.pages.map(p=>p.altText);
 if(c.experience)return [c.experience.coverAltText,...c.experience.pages.map(p=>p.altText)];
 return studioAltTexts(c).map((value,i)=>c.altTexts[i]??value);
}
export function studioAltTextDefaults(c:StudioContent):string[]{
 return studioAltTexts({...c,altTexts:[],finishedDeck:c.finishedDeck?{pages:c.finishedDeck.pages.map(p=>({...p,altText:""}))}:null,
  experience:c.experience?{...c.experience,coverAltText:"",pages:c.experience.pages.map(p=>({...p,altText:""}))}:null});
}
export const altTextFile=(values:string[])=>values.map((text,i)=>`[${String(i+1).padStart(2,"0")}페이지]\n${text}`).join("\n\n");

