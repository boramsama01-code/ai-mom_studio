import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiBlob } from "./api";
import { ErrorBox } from "./ui";

export function CardCarousel({ channelId, assetId, pages, credit = "" }: { channelId: number; assetId: number; pages: Array<{ id: number; title: string }>; credit?: string }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
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
    <div className="row between"><strong>완성된 카드뉴스 <span className="muted">{pages.length}장</span></strong><button className="btn sm" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? "준비 중…" : `${pages.length}장 ZIP 다운로드`}</button></div>
    <div className="card-carousel-stage">
      {failed ? <div role="alert" className="notice err">이미지를 불러오지 못했습니다.<button className="btn sm" onClick={() => setFailed(false)}>다시 보기</button></div> : <img key={page.id} src={`/api/channels/${channelId}/media/${page.id}`} alt={`${index + 1} / ${pages.length} · ${page.title}`} onError={() => setFailed(true)} />}
    </div>
    <div className="row between card-carousel-controls"><button className="btn sm" aria-label="이전 페이지" disabled={index === 0} onClick={() => select(index - 1)}>← 이전</button><span aria-live="polite">{index + 1} / {pages.length} <span className="muted">· {index === 0 ? "표지" : page.title}</span></span><button className="btn sm" aria-label="다음 페이지" disabled={index >= pages.length - 1} onClick={() => select(index + 1)}>다음 →</button></div>
    <div className="card-carousel-thumbs" role="group" aria-label="페이지 선택">{pages.map((p, i) => <button key={p.id} aria-label={`${i + 1}페이지 · ${p.title}`} aria-pressed={i === index} onClick={() => select(i)}><img src={`/api/channels/${channelId}/media/${p.id}`} loading="lazy" alt="" /><span>{i === 0 ? "표지" : String(i + 1).padStart(2, "0")}</span></button>)}</div>
    {credit && <p className="small muted">{credit}</p>}
    {download.error && <ErrorBox error={download.error} />}
  </div>;
}
