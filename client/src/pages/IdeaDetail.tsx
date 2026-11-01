import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { ContentItem } from "@shared/schema";
import type { EditorialIdea } from "@shared/ideaBank";
import { studioKey } from "@shared/channelKeys";
import { api } from "../api";
import { Badge, ErrorBox, GuardedLink } from "../ui";
export function IdeaDetail({item,idea,channel}:{item:ContentItem;idea:EditorialIdea;channel:string}) {
  const [,navigate]=useLocation();
  const transfer=useMutation({mutationFn:()=>api<{id:number}>("/studio/cards",{method:"POST",body:{title:item.title,channel:studioKey(channel),format:idea.format,sourceItemId:item.id}}),onSuccess:card=>navigate(`/studio/${card.id}`)});
  return <div className="idea-detail"><GuardedLink href="/inbox">← 아이디어 수집함</GuardedLink><header className="idea-detail-head"><div className="row"><Badge>{idea.category}</Badge><span className="small muted">IDEA {String(idea.number).padStart(3,"0")} / 100</span></div><h1>{idea.title}</h1><p>{idea.angle}</p></header>
    <section className="panel"><h2>{idea.format==="웹툰"?"네 컷 구성안":"표지 + 본문 4장 구성안"}</h2><p className="small muted">아래 구성은 출발점입니다. 제작 보드에서 실제 원고와 이미지로 다듬으세요.</p><ol className="idea-beats">{idea.beats.map((beat,i)=><li key={i}><span>{String(i+1).padStart(2,"0")}</span><p>{beat}</p></li>)}</ol></section>
    <section className="panel idea-references"><h2>제작 전에 확인할 것</h2><p className="small muted">{idea.verification}</p>{idea.references.length?<ul>{idea.references.map(r=><li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.label} ↗</a></li>)}</ul>:<p className="small">{idea.format==="웹툰"?"직접 겪은 일로 바꾸거나 창작 에피소드로 소개하세요.":"직접 관찰·시식하거나 공식 자료를 찾아 근거를 추가하세요."}</p>}</section>
    {transfer.error&&<ErrorBox error={transfer.error}/>}<div className="idea-start"><div><strong>{idea.format}으로 만들기</strong><p className="small muted">구성안과 참고 링크를 제작 보드로 가져옵니다.</p></div><button className="btn primary" disabled={transfer.isPending} onClick={()=>transfer.mutate()}>{transfer.isPending?"가져오는 중…":"제작 보드로 가져오기 →"}</button></div></div>;
}
