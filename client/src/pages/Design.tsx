/**
 * 카드 디자인 — 템플릿 고르기, 내 배경 템플릿 올리기, Canva 자동 채우기, 대량 제작·망고보드용 글자 내보내기
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useChannel } from "../state";
import { useToast } from "../toast";
import { Empty, ErrorBox, GuardedLink, Loading } from "../ui";
import { templateSelection, type TemplateCatalogItem, type TemplateListReply, type TemplateOption } from "@shared/templateCatalog";
import {isCurrentEditorialTemplate,editorialTemplateForKey} from '@shared/editorialTemplates';
import {HighScoopTemplateKit} from '../HighScoopTemplateKit';
import "../templateCatalog.css";

export type Tpl = TemplateOption;
export type { TemplateListReply } from "@shared/templateCatalog";

export function useTemplates(cid: number | "all") {
  return useQuery({ queryKey: ["ch", cid, "templates"], queryFn: () => api<TemplateListReply>(`/channels/${cid}/templates`), enabled: cid !== "all" });
}

/** The same current catalogue is used from channel settings, Inbox and Studio. */
export function TemplatePicker({ cid, value, onChange, items, version, studioChannel, brandName="현재 채널", disabled = false }: { cid: number | "studio"; value: string; onChange: (k: string, item?: TemplateCatalogItem) => void; items: Tpl[]; version?: string; studioChannel?: string; brandName?:string; disabled?: boolean }) {
  const current = items.filter(item => isCurrentEditorialTemplate(item.key));
  const selectedValue=current.length===1&&isCurrentEditorialTemplate(value)?current[0].key:value;
  const previewUrlFor = (key: string) => `${cid === "studio" ? "/api/studio/design-preview" : `/api/channels/${cid}/templates/preview`}?size=sm&key=${encodeURIComponent(key)}&page=0&v=${encodeURIComponent(version ?? "current")}${studioChannel ? `&channel=${encodeURIComponent(studioChannel)}` : ""}`;
  return <div className="collection-picker" data-testid="current-template-picker">
    {!current.some(item => item.key === selectedValue) && <p className="small muted collection-legacy">현재 작업에는 이전 디자인이 적용되어 있습니다. 원고와 이미지는 유지하며 아래 최신 마스터를 적용할 수 있습니다.</p>}
    {current.length ? <HighScoopTemplateKit items={current} value={selectedValue} disabled={disabled} brandName={brandName} previewUrlFor={previewUrlFor} onSelect={key => {
      const item = current.find(option => option.key === key);
      if (item) onChange(key, templateSelection(item, key));
    }} selectionHint="선택은 현재 원고에만 반영됩니다. 문구·디자인 저장으로 확정하세요. 페이지별 내지는 편집기에서 고릅니다."/> : <Empty>현재 마스터를 불러오지 못했습니다. 화면을 새로고침해 주세요.</Empty>}
  </div>;
}

export function DesignPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { current, selected } = useChannel();
  if (selected === "all" || !current) return <>
    {!embedded && <h1>디자인 템플릿</h1>}
    <Empty>보기 채널을 고르면 현재 사용하는 마스터를 확인할 수 있습니다.</Empty>
  </>;
  return <>
    {!embedded && <div className="page-head"><div><h1>{current.name} 디자인 템플릿</h1><p className="small muted">컬러 마스터 하나를 고르고, 콘텐츠 편집기에서 페이지별 내지를 선택하세요.</p></div></div>}
    <CurrentDefaultTemplate key={current.id} cid={current.id} brandName={current.name}/>
  </>;
}

function CurrentDefaultTemplate({cid,brandName}:{cid:number;brandName:string}){
 const qc=useQueryClient(),toast=useToast(),q=useTemplates(cid),[selection,setSelection]=useState('');
 const previous=selection||q.data?.current,items=q.data?.items??[];
 const chosen=items.length===1&&isCurrentEditorialTemplate(previous)?items[0].key:previous,current=editorialTemplateForKey(q.data?.current);
 const save=useMutation({
  mutationFn:(key:string)=>api(`/channels/${cid}/design`,{method:'PUT',body:{cardTemplate:key}}),
  onSuccess:(_result,key)=>{
   qc.setQueryData<TemplateListReply>(['ch',cid,'templates'],old=>old?{...old,current:key}:old);
   void qc.invalidateQueries({queryKey:['ch',cid,'templates']});void qc.invalidateQueries({queryKey:['channels']});
   toast('ok','기본 마스터를 저장했습니다. 새로 만드는 콘텐츠부터 적용됩니다.');
  },onError:error=>toast('err',(error as Error).message),
 });
 return <section className="panel stack" aria-label={`${brandName} 현재 템플릿`}>
  {q.isPending?<Loading label="현재 마스터 불러오는 중"/>:q.error?<ErrorBox error={q.error} retry={()=>void q.refetch()}/>:<>
   {!current&&<p className="notice small">현재 기본값은 이전 디자인입니다. 아래에서 새 컬러 마스터를 선택해 주세요.</p>}
   <HighScoopTemplateKit items={q.data?.items??[]} brandName={brandName} value={chosen} disabled={save.isPending} onSelect={setSelection} previewUrlFor={key=>`/api/channels/${cid}/templates/preview?size=sm&key=${encodeURIComponent(key)}&page=0`} selectionHint="컬러를 고른 뒤 ‘이 마스터를 기본으로 사용’을 눌러 저장하세요. 콘텐츠 원고에서는 페이지별 내지를 선택할 수 있습니다."/>
   <div className="row"><button type="button" className="btn primary" disabled={save.isPending||!isCurrentEditorialTemplate(chosen)||chosen===q.data?.current} onClick={()=>chosen&&save.mutate(chosen)}>{save.isPending?'저장 중…':chosen===q.data?.current?'현재 기본 마스터':'이 마스터를 기본으로 사용'}</button><GuardedLink className="btn" href="/inbox">수집함에서 콘텐츠 만들기</GuardedLink><GuardedLink className="btn ghost" href="/connections?service=canva">Canva 연결 설정</GuardedLink></div>
   <p className="small muted">공통 내지는 텍스트·형광펜, 2단 비교, 사진과 글, 표, 단계도, 기간표, 그래프, 문서 캡처, 메신저 대화로 구성됩니다. 이전 작업의 원고와 이미지는 계속 보관합니다.</p>
  </>}
 </section>;
}
