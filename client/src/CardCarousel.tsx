import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiBlob } from "./api";
import { ErrorBox } from "./ui";
import "./studioPublish.css";
import { AltTextEditor } from "./AltTextEditor";
import { useDirtyGuard } from "./state";

export function CardCarousel({ channelId, assetId, pages, credit = "", onDirtyChange }: { channelId: number; assetId: number; pages: Array<{ id: number; title: string; altText?: string }>; credit?: string; onDirtyChange?:(dirty:boolean)=>void }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const qc=useQueryClient(),guard=useDirtyGuard(),path=`/channels/${channelId}/media/${assetId}/alt-text`;
  const alt=useQuery({queryKey:["card-alt",assetId],queryFn:()=>api<{version:number;values:string[]}>(path),retry:false});
  const [draft,setDraft]=useState<string[]|null>(null),values=draft??alt.data?.values??pages.map(p=>p.altText||p.title);
  const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(alt.data?.values);
  const save=useMutation({mutationFn:()=>api<{version:number;values:string[]}>(path,{method:"PATCH",body:{version:alt.data?.version,values}}),onSuccess:saved=>{qc.setQueryData(["card-alt",assetId],saved);setDraft(null);qc.invalidateQueries({queryKey:["ch",channelId]});qc.invalidateQueries({queryKey:["studio"]});}});
  useEffect(()=>{onDirtyChange?.(dirty||!alt.data||!!alt.error||save.isPending);},[dirty,alt.data,alt.error,save.isPending,onDirtyChange]);
  useEffect(()=>{guard.setDirty(`card-alt-${assetId}`,dirty,async()=>{try{await save.mutateAsync();return true;}catch{return false;}});return()=>{guard.setDirty(`card-alt-${assetId}`,false);};},[dirty,draft]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  const page = pages[Math.min(index, pages.length - 1)];
  const select = (value: number) => { setIndex(value); setFailed(false); };
  const download = useMutation({ mutationFn: async () => {
    const blob = await apiBlob(`/channels/${channelId}/media/${assetId}/deck.zip`, "application/zip");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `cardnews-${assetId}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } });
  if (!page) return null;
  return <div className="card-carousel" aria-label="카드뉴스 전체 미리보기">
    <div className="row between"><strong>완성된 카드뉴스 <span className="muted">{pages.length}장</span></strong><button className="btn sm" disabled={download.isPending||dirty} onClick={() => download.mutate()}>{download.isPending ? "준비 중…" : `${pages.length}장 ZIP 다운로드`}</button></div>
    <div className="card-carousel-stage">
      {failed ? <div role="alert" className="notice err">이미지를 불러오지 못했습니다.<button className="btn sm" onClick={() => setFailed(false)}>다시 보기</button></div> : <img key={page.id} src={`/api/channels/${channelId}/media/${page.id}`} alt={values[index]||`${index + 1} / ${pages.length} · ${page.title}`} onError={() => setFailed(true)} />}
    </div>
    <div className="row between card-carousel-controls"><button className="btn sm" aria-label="이전 페이지" disabled={index === 0} onClick={() => select(index - 1)}>← 이전</button><div className="page-dots" role="group" aria-label="페이지 선택">{pages.map((p, i) => <button key={p.id} className={i <= index ? "filled" : ""} aria-label={`${i + 1}페이지`} aria-current={i === index ? "step" : undefined} onClick={() => select(i)}>{i <= index ? "●" : "○"}</button>)}</div><button className="btn sm" aria-label="다음 페이지" disabled={index >= pages.length - 1} onClick={() => select(index + 1)}>다음 →</button></div>
    <div className="card-carousel-thumbs" role="group" aria-label="페이지 선택">{pages.map((p, i) => <button key={p.id} aria-label={`${i + 1}페이지 · ${p.title}`} aria-pressed={i === index} onClick={() => select(i)}><img src={`/api/channels/${channelId}/media/${p.id}`} loading="lazy" alt="" /><span aria-hidden="true">{i <= index ? "●" : "○"}</span></button>)}</div>
    {credit && <p className="small muted">{credit}</p>}
    <AltTextEditor values={values} selected={index} onSelect={select} disabled={!alt.data||save.isPending} change={(i,value)=>setDraft(values.map((v,n)=>n===i?value:v))}/>
    {dirty&&<div className="row"><span className="small">대체텍스트를 저장한 뒤 다운로드·승인할 수 있습니다.</span><button className="btn sm primary" disabled={save.isPending||values.some(v=>!v.trim())} onClick={()=>save.mutate()}>{save.isPending?"저장 중…":"대체텍스트 저장"}</button></div>}
    {alt.error&&<ErrorBox error={alt.error} retry={()=>alt.refetch()}/>}{save.error&&<ErrorBox error={save.error}/>}
    <p className="small muted">ZIP에 alt-text.txt가 포함됩니다. 최종 승인한 설명이 이미지별로 인스타그램에 전달됩니다. 기존 승인본을 바꾸려면 다시 승인해 주세요.</p>
    {download.error && <ErrorBox error={download.error} />}
  </div>;
}
