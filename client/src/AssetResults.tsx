import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { AssetLibraryItem, AssetLibraryPreview, AssetLibraryReply } from "@shared/assetLibrary";
import { studioKey } from "@shared/channelKeys";
import { api, qs } from "./api";
import { useChannel } from "./state";
import { ErrorBox, GuardedLink, Loading } from "./ui";
import { useListContext, useListScroll } from "./useListContext";
import "./assetResults.css";

const preferences = z.object({ kind: z.enum(["all", "image", "video"]), view: z.enum(["latest", "history", "all"]), q: z.string().max(100), search: z.string().max(100), offset: z.number().int().min(0).max(1000), selected: z.string().nullable() });
const defaults = { kind: "all" as const, view: "latest" as const, q: "", search: "", offset: 0, selected: null };
const parse = (value: unknown) => { const result = preferences.safeParse(value); return result.success ? result.data : null; };
const approvalLabel = (status: string | null | undefined) => ({ active: "승인 저장됨", completed: "전송 완료된 승인", invalidated: "이전 승인 · 현재 무효", cancelled: "승인 취소 기록" }[status ?? ""] ?? "게시 승인 없음");
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

function AssetVisual({ asset, title, player = false }: { asset: Pick<AssetLibraryPreview, "kind" | "previewUrl" | "downloadUrl" | "mimeType">; title: string; player?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="asset-result-unavailable">미리보기를 표시할 수 없습니다. 원본 파일을 내려받아 확인해 주세요.</div>;
  if (asset.kind === "video" && player) return <video className="asset-result-visual" aria-label={title} controls playsInline preload="none" poster={asset.previewUrl ?? undefined} src={asset.downloadUrl} onError={() => setFailed(true)} />;
  return asset.previewUrl ? <img className="asset-result-visual" alt={title} src={asset.previewUrl} loading={player ? "eager" : "lazy"} onError={() => setFailed(true)} /> : <div className="asset-result-unavailable">{asset.kind === "video" ? "영상 · 재생하려면 선택" : "미리보기 없음"}</div>;
}

function ResultDetail({ item }: { item: AssetLibraryItem }) {
  const { channels } = useChannel();
  const channel = channels.find(value => value.id === item.channelId);
  const manual = channel ? `/?start=finished&channel=${encodeURIComponent(studioKey(channel.slug))}&mode=manual` : null;
  const current = item.currentPreview;
  return <section className="asset-result-detail stack" aria-label="선택한 결과 비교">
    <div><span className="section-kicker">SAVED OUTPUT</span><h2>{item.title}</h2><p className="muted">{item.channelName} · {item.name} · {date(item.createdAt)} (한국 시간)</p></div>
    <div className="asset-result-comparison">
      <article><h3>선택한 저장 파일</h3><p className="small">{item.kind === "video" ? "저장 영상 · 게시 승인 없음" : approvalLabel(item.approval?.status)}</p><AssetVisual key={item.key} asset={item} title="선택한 저장 파일 미리보기" player/><a className="btn" href={item.downloadUrl} download>선택한 원본 파일 받기</a>{item.bundleDownloadUrl && <a className="btn" href={item.bundleDownloadUrl} download>{item.pageCount}장 이미지 묶음 받기</a>}</article>
      <article><h3>현재 버전의 연결 결과</h3>{current ? <><p className="small">{current.kind === "video" ? "현재 선택한 완성 영상 · 게시 승인 없음" : current.approvalStatus ? approvalLabel(current.approvalStatus) : "현재 초안 이미지 · 게시 승인 없음"}</p><AssetVisual key={`${item.channelId}:${current.kind}:${current.assetId}`} asset={current} title="현재 버전 연결 결과 미리보기" player/><a className="btn" href={current.downloadUrl} download>현재 연결 파일 받기</a></> : <p className="asset-result-unavailable">현재 버전에는 연결된 완성 결과가 없습니다. 이전 파일로 대신 표시하지 않습니다.</p>}</article>
    </div>
    <dl className="asset-result-meta"><div><dt>저장 기준</dt><dd>{item.source.studioVersion !== null ? `작업 v${item.source.studioVersion}` : item.source.sourceRevisionNo !== null ? `원고 r${item.source.sourceRevisionNo}` : "저장 기록"} · 현재 작업 v{item.source.currentVersion}</dd></div><div><dt>파일</dt><dd>{item.mimeType}{item.width && item.height ? ` · ${item.width} × ${item.height}` : ""} · {item.kind === "image" ? `${item.pageCount}장` : "영상 파일 1개"}{item.sha256 ? ` · SHA ${item.sha256.slice(0, 12)}` : ""}</dd></div>{item.approval && <div><dt>승인 기록</dt><dd>{date(item.approval.approvedAt)} · {item.approval.approvedBy}</dd></div>}</dl>
    <div className="asset-result-actions"><GuardedLink className="btn" href={item.editorUrl}>현재 콘텐츠 열기</GuardedLink>{item.historyUrl && <GuardedLink className="btn" href={item.historyUrl}>{item.source.studioRevisionId !== null ? "저장 작업 버전 비교" : "원고 버전 비교"}</GuardedLink>}</div>
    {item.kind === "image" && <div className="notice"><strong>이전 결과를 다시 사용하려면</strong><p>{item.source.studioRevisionId !== null ? "작업 버전 비교에서 저장된 이미지 참조를 새 초안으로 복원할 수 있습니다. 복원 후 다시 검토하고 승인해 주세요." : "원고 버전 복원은 문구만 복원하며, 이 승인 이미지나 승인을 다시 활성화하지 않습니다. 원본 이미지 또는 이미지 묶음을 받아 완성 이미지 콘텐츠로 직접 추가할 수 있습니다."}</p>{manual && <GuardedLink className="btn" href={manual}>완성 이미지로 새 콘텐츠 시작</GuardedLink>}<p className="small muted">여러 장은 내 콘텐츠의 ‘가져오기·관리 → 카드뉴스 ZIP 가져오기’에서 추가할 수 있습니다. 새로 가져온 파일은 정규화될 수 있으며 새 게시물의 검토·승인이 필요합니다.</p></div>}
    {item.kind === "video" && <p className="notice small">영상은 작업에 저장한 자료입니다. 사용 중인 원본 장면도 포함되며, 게시 승인이나 완성 영상임을 뜻하지 않습니다. 위 재생 화면에서 실제 파일을 비교한 뒤 작업 버전 기록을 확인해 주세요.</p>}
  </section>;
}

export function AssetResults() {
  const { selected, select, channels } = useChannel();
  const context = useListContext("asset-results", selected, defaults, parse);
  const value = context.value;
  const query = useQuery({ queryKey: ["asset-library", context.scope, selected, value.kind, value.view, value.q, value.offset], queryFn: ({ signal }) => api<AssetLibraryReply>(`/assets/library?${qs({ channelId: selected, kind: value.kind, view: value.view, q: value.q, limit: 24, offset: value.offset })}`, { signal }), retry: false });
  useListScroll(context.key, query.isSuccess);
  const item = query.data?.items.find(row => row.key === value.selected) ?? null;
  const update = (change: Partial<typeof value>) => context.update({ ...change, offset: 0, selected: null });
  const latestLabel = value.kind === "image" ? "현재 원고 승인본" : value.kind === "video" ? "현재 작업 사용 영상" : "현재 원고 승인본·사용 영상";
  return <div className="asset-results stack">
    <div><h2>승인 이미지·저장 영상</h2><p className="muted">승인 당시의 이미지와 작업에 저장한 영상을 찾고 현재 결과와 비교합니다. 저장 영상에는 게시 승인이 없습니다.</p></div>
    <form className="asset-result-filters" aria-label="콘텐츠 결과 찾기" onSubmit={event => { event.preventDefault(); update({ q: value.search.trim() }); }}>
      <label className="field">채널<select aria-label="채널" value={selected} onChange={event => select(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">모든 채널</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label className="field">결과 종류<select aria-label="결과 종류" value={value.kind} onChange={event => update({ kind: event.target.value as typeof value.kind })}><option value="all">이미지·영상 모두</option><option value="image">승인 이미지</option><option value="video">저장 영상</option></select></label>
      <label className="field">기록 범위<select aria-label="기록 범위" value={value.view} onChange={event => update({ view: event.target.value as typeof value.view })}><option value="latest">{latestLabel}</option><option value="history">이전 승인·사용 기록</option><option value="all">현재와 이전 기록 모두</option></select></label>
      <label className="field asset-result-search">콘텐츠·파일 이름<input aria-label="콘텐츠·파일 이름" type="search" maxLength={100} value={value.search} onChange={event => context.update({ search: event.target.value })}/></label><button className="btn" type="submit">결과 찾기</button>
    </form>
    <p className="small muted">‘현재 원고 승인본’은 현재 원고와 연결된 승인이 있는 이미지입니다. 원고를 수정한 뒤에는 과거 승인 이미지가 ‘이전 승인·사용 기록’에 남습니다.</p>
    {query.isPending && <Loading label="콘텐츠 결과 불러오는 중" lines={4}/>}{query.error && <ErrorBox error={query.error} retry={() => void query.refetch()}/>}
    {query.data && <>
      {!query.data.items.length && <div className="notice"><p>조건에 맞는 승인 이미지·저장 영상이 없습니다.</p>{value.view === "latest" && <button className="btn" onClick={() => update({ view: "history" })}>이전 승인·사용 기록 보기</button>}</div>}
      <div className="asset-result-grid" aria-label="저장한 콘텐츠 결과">{query.data.items.map(row => <button className={`asset-result-card ${row.key === item?.key ? "selected" : ""}`} key={row.key} aria-pressed={row.key === item?.key} aria-label={`${row.title} · ${row.kind === "image" ? "승인 이미지" : "저장 영상"} 비교`} onClick={() => context.update({ selected: row.key })}><AssetVisual key={`${row.channelId}:${row.key}:${row.previewUrl}`} asset={row} title={`${row.title} 썸네일`}/><span className="asset-result-card-copy"><strong>{row.title}</strong><span>{row.channelName} · {row.kind === "video" ? "저장 영상 · 게시 승인 없음" : approvalLabel(row.approval?.status)}</span><span>{row.source.studioVersion !== null ? `작업 v${row.source.studioVersion}` : `원고 r${row.source.sourceRevisionNo ?? "?"}`} · {row.current ? row.kind === "video" ? "현재 작업에서 사용" : "현재 원고" : "이전 기록"}{row.kind === "image" ? ` · ${row.pageCount}장` : ""}</span></span></button>)}</div>
      <nav className="asset-result-actions" aria-label="콘텐츠 결과 페이지"><button className="btn" disabled={!value.offset || query.isFetching} onClick={() => context.update({ offset: Math.max(0, value.offset - 24), selected: null })}>이전 결과</button><span>{Math.floor(value.offset / 24) + 1}페이지</span><button className="btn" disabled={!query.data.hasMore || query.data.nextOffset === null || query.isFetching} onClick={() => context.update({ offset: query.data!.nextOffset!, selected: null })}>다음 결과</button></nav>
      {query.data.hasMore && query.data.nextOffset === null && <p className="notice small">표시할 수 있는 기록 범위에 도달했습니다. 채널이나 검색어를 좁혀 나머지 기록을 찾아 주세요.</p>}
      {item && <ResultDetail key={`${context.scope}:${item.key}`} item={item}/>}
    </>}
  </div>;
}
