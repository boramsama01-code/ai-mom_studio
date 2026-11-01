import type { StudioContent } from "./studio";
export const ALT_TEXT_LIMIT = 125;
export const ALT_TEXT_MAX_SENTENCES = 2;

/** Count visible Unicode characters, including spaces, instead of UTF-16 units. */
export const altTextLength = (value: string) => Array.from(value).length;

/** Sentence-boundary check for Korean/English terminal punctuation. */
export function altTextSentenceCount(value: string): number {
 const normalized = value.trim().replace(/\s+/gu, " ");
 if (!normalized) return 0;
 const stops = [...normalized.matchAll(/[.!?。！？]+(?=\s|$)/gu)].length;
 return stops + (/[.!?。！？]$/u.test(normalized) ? 0 : 1);
}
/** Use allowEmpty only while editing drafts. Existing long descriptions remain readable but need revision before export/publishing. */
export function altTextError(value: string, allowEmpty = false): string | null {
 if (!value.trim()) return allowEmpty ? null : "대체텍스트를 입력해 주세요.";
 if (altTextLength(value) > ALT_TEXT_LIMIT) return `대체텍스트는 공백 포함 최대 ${ALT_TEXT_LIMIT}자까지 입력할 수 있습니다.`;
 if (altTextSentenceCount(value) > ALT_TEXT_MAX_SENTENCES) return "대체텍스트는 1~2문장으로 작성해 주세요.";
 return null;
}
/** Make safe, brief defaults from existing written information, without inventing unseen visual details. */
export function conciseAlt(parts: Array<string | undefined | null>): string {
 const text = parts.filter((part): part is string => typeof part === "string")
  .map(part => part.replace(/\s+/gu, " ").trim()).filter(Boolean).join(" ");
 const stops = [...text.matchAll(/[.!?。！？]+(?=\s|$)/gu)];
 const selected = stops.length > 1 ? text.slice(0, (stops[1].index ?? 0) + stops[1][0].length) : text;
 if (altTextLength(selected) <= ALT_TEXT_LIMIT) return selected;
 let short = Array.from(selected).slice(0, ALT_TEXT_LIMIT - 1).join("").trimEnd();
 const boundary = short.lastIndexOf(" ");
 if (boundary > Math.floor(short.length * 0.6)) short = short.slice(0, boundary).trimEnd();
 return short.replace(/[.!?。！？,;:，、\s]+$/gu, "") + "…";
}
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

