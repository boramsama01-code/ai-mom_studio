import type { FamilyPageId } from "@shared/familyDialogue";
import { familyCollectionDesign } from "@shared/familyCollectionDesigns";
import { useQuery } from "@tanstack/react-query";
import { editorialTemplateCatalogOptions, type TemplateListReply } from "@shared/templateCatalog";
import { editorialTemplateForKey, isCurrentEditorialTemplate } from "@shared/editorialTemplates";
import { api } from "./api";
import { HighScoopTemplateKit } from "./HighScoopTemplateKit";
import { ErrorBox, Loading } from "./ui";

/** A role diagram only: it never contains manuscript text or rendered artwork. */
export function FamilyPageLayout({ pageId }: { pageId: FamilyPageId }) {
  const line = (y: number, width = 52, x = 14) => <rect x={x} y={y} width={width} height="3" rx="1.5" />;
  const panel = (x: number, y: number, width: number, height: number) => <rect className="family-layout-panel" x={x} y={y} width={width} height={height} rx="3" />;
  return <svg className="family-page-layout" viewBox="0 0 80 100" aria-hidden="true" focusable="false">
    <rect className="family-layout-paper" x="1" y="1" width="78" height="98" rx="5" />
    {pageId === "cover" && <>{line(12, 26)}{line(24)}{line(32, 40)}{panel(14, 45, 52, 32)}{line(86, 32)}</>}
    {pageId === "news_summary" && <>{line(12, 36)}{panel(14, 25, 52, 17)}{panel(14, 47, 52, 17)}{panel(14, 69, 52, 17)}</>}
    {pageId === "implication" && <>{line(12, 38)}{line(27)}{line(35, 44)}{panel(14, 48, 52, 30)}{line(87, 30)}</>}
    {pageId === "discussion" && <>{line(12, 28)}{panel(12, 30, 56, 40)}{line(80, 44)}{line(88, 32)}</>}
    {pageId === "perspectives" && <>{line(12, 40)}{panel(10, 27, 27, 54)}{panel(43, 27, 27, 54)}{line(88, 36)}</>}
    {pageId === "concept" && <>{line(12, 36)}{panel(14, 27, 52, 24)}{line(59, 44)}{line(67)}{line(75, 40)}{line(87, 28)}</>}
    {pageId === "activity" && <>{line(12, 34)}{panel(14, 27, 52, 22)}{line(59)}{line(69, 46)}{line(79, 38)}{line(89, 24)}</>}
    {pageId === "outro" && <><circle className="family-layout-panel" cx="40" cy="30" r="15" />{line(57, 40, 20)}{line(68, 48, 16)}{line(80, 28, 26)}</>}
  </svg>;
}

type FamilyDesignPickerProps={templateKey:string;disabled:boolean;onChange:(key:string)=>void;channelId?:number};
export function FamilyDesignPicker(props:FamilyDesignPickerProps) {
  return props.channelId ? <ChannelFamilyDesignPicker {...props} channelId={props.channelId}/> : <CurrentFamilyDesignPicker {...props} items={editorialTemplateCatalogOptions({slug:'news'})}/>;
}
function ChannelFamilyDesignPicker(props:FamilyDesignPickerProps & {channelId:number}) {
  const query=useQuery({queryKey:['ch',props.channelId,'templates'],queryFn:()=>api<TemplateListReply>(`/channels/${props.channelId}/templates`)});
  if(query.isPending)return <Loading label="현재 디자인 불러오는 중"/>;
  if(query.error)return <ErrorBox error={query.error} retry={()=>void query.refetch()}/>;
  return <CurrentFamilyDesignPicker {...props} items={query.data.items}/>;
}
function CurrentFamilyDesignPicker({templateKey,disabled,onChange,channelId,items}:FamilyDesignPickerProps & {items:TemplateListReply['items']}) {
  const current=items.filter(item=>isCurrentEditorialTemplate(item.key));
  const selected=current.find(item=>item.key===templateKey)||current.find(item=>editorialTemplateForKey(item.key)?.colorId===editorialTemplateForKey(templateKey)?.colorId);
  return <details className="family-whole-design">
    <summary><strong>전체 카드 디자인</strong><span>현재 · {selected?.name??'이전 디자인 · 원고 보관 중'}</span></summary>
    <div className="family-design-content stack">
      <label className="field">컬러·카테고리 선택
        <select aria-label="전체 목록에서 선택" value={selected?.key??''} disabled={disabled} onChange={event=>{if(isCurrentEditorialTemplate(event.target.value))onChange(event.target.value);}}>
          {!selected&&<option value="" disabled>최신 마스터를 선택하세요</option>}
          {current.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}
        </select>
      </label>
      <HighScoopTemplateKit value={selected?.key} items={current} brandName="현재 채널" disabled={disabled} onSelect={onChange} previewUrlFor={channelId?key=>`/api/channels/${channelId}/templates/preview?size=sm&key=${encodeURIComponent(key)}&page=0`:undefined} selectionHint="컬러를 바꿔도 현재 원고의 장수·문구·근거 자료·사진은 유지합니다. 문구·디자인 저장으로 확정하세요."/>
    </div>
  </details>;
}