import { useEffect, useState, type FormEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import type { NotionConnectionStatus, NotionDocument, NotionDocumentList } from "@shared/notionSync";
import type { NotionStudioDetail, NotionStudioList, NotionStudioLink } from "@shared/notionStudio";
import { api, apiBlob, ApiError, qs } from "../api";
import { useChannel } from "../state";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import "../notionSync.css";

type CoverStyle = "A" | "B" | "C";
type CopyPage = { index: number; title: string; body: string };
const phaseLabel: Record<NotionStudioLink["canva"]["phase"], string> = {
  idle: "제작 전", importing: "캔바 디자인 만드는 중", ready: "캔바 편집 가능", exporting: "완성본 가져오는 중",
  complete: "완성본 저장됨", failed: "다시 확인 필요", result_unknown: "처리 결과 확인 필요",
};
const dateLabel = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function externalUrl(value?: string | null) {
  try { const url = new URL(value || ""); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
}
function pageIdFromInput(value: string) {
  const input = value.trim();
  const match = input.match(/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})(?=[/?#]|$)/i);
  if (!match) return null;
  const id = match[0].replace(/-/g, "");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function CoverStyles({ value, onChange, disabled = false, name }: { value: CoverStyle; onChange: (value: CoverStyle) => void; disabled?: boolean; name: string }) {
  return <fieldset className="notion-cover-styles"><legend>표지 유형</legend><div className="notion-style-options">{(["A", "B", "C"] as const).map(style => <label key={style} className={value === style ? "selected" : ""}>
    <input type="radio" name={name} value={style} checked={value === style} disabled={disabled} onChange={() => onChange(style)} />
    <span className={`notion-style-preview style-${style.toLowerCase()}`} aria-hidden="true"><i /><b /><b /></span><strong>{style}형</strong>
  </label>)}</div></fieldset>;
}

function Manuscript({ pages, coverTitle, label }: { pages: CopyPage[]; coverTitle?: string; label: string }) {
  return <div className="notion-manuscript" aria-label={label}>
    {pages.map((page, i) => <article className="notion-copy-page" key={`${page.index}-${i}`}><span className="small muted">{page.index}장{page.index === 1 ? " · 표지" : ""}</span><h4>{(page.index === 1 ? coverTitle || page.title : page.title) || "제목 없음"}</h4><p>{page.body || "본문 없음"}</p></article>)}
    {!pages.length && <p className="muted">등록된 본문이 없습니다.</p>}
  </div>;
}

function Photos({ photos, preview = false }: { photos: Array<{ name: string; url: string }>; preview?: boolean }) {
  return <section className="notion-photos" aria-label="첨부 사진"><h3>첨부 사진 <span className="badge">{photos.length}개</span></h3>
    {photos.length ? <ul>{photos.map((photo, index) => <li key={`${photo.name}-${index}`}>
      {!preview && <img src={photo.url} alt={photo.name || `첨부 사진 ${index + 1}`} loading="lazy" />}
      <span>{photo.name || `사진 ${index + 1}`}</span>
    </li>)}</ul> : <p className="small muted">첨부된 사진이 없습니다.</p>}
    {preview && !!photos.length && <p className="small muted">가져온 뒤 사진 미리보기를 확인할 수 있습니다.</p>}
  </section>;
}

export function NotionSyncPage() {
  const { selected, allChannels } = useChannel();
  const activeChannels = allChannels.filter(channel => channel.active);
  const [, navigate] = useLocation();
  const search = useSearch();
  const selectedLink = Number(new URLSearchParams(search).get("link"));
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sourceChannel, setSourceChannel] = useState("");
  const [directInput, setDirectInput] = useState("");
  const [directError, setDirectError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [channelId, setChannelId] = useState<number | "">(selected === "all" ? "" : selected);
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("A");
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["notion-status"], queryFn: ({ signal }) => api<NotionConnectionStatus>("/notion/status", { signal }) });
  const documents = useInfiniteQuery({
    queryKey: ["notion-documents", query, sourceChannel], initialPageParam: "",
    queryFn: ({ pageParam, signal }) => api<NotionDocumentList>(`/notion/documents?${qs({ query, channel: sourceChannel, cursor: pageParam })}`, { signal }),
    getNextPageParam: last => last.hasMore ? last.nextCursor : undefined,
    enabled: status.data?.configured === true,
  });
  const document = useQuery({ queryKey: ["notion-document", documentId], queryFn: ({ signal }) => api<NotionDocument>(`/notion/documents/${encodeURIComponent(documentId)}`, { signal }), enabled: !!documentId && status.data?.configured === true });
  const links = useQuery({ queryKey: ["notion-links"], queryFn: ({ signal }) => api<NotionStudioList>("/notion/links", { signal }) });
  useEffect(() => { if (selected !== "all") setChannelId(selected); }, [selected]);
  const importing = useMutation({
    mutationFn: () => {
      if (!document.data || !channelId) throw new Error("원고와 저장할 채널을 선택해 주세요.");
      return api<NotionStudioDetail>("/notion/import", { method: "POST", body: { pageId: document.data.pageId, channelId, expectedSourceHash: document.data.sourceHash, coverStyle } });
    }, retry: false,
    onSuccess: detail => { qc.setQueryData(["notion-link", detail.link.id], detail); void qc.invalidateQueries({ queryKey: ["notion-links"] }); void qc.invalidateQueries({ queryKey: ["studio"] }); navigate(`/notion?link=${detail.link.id}`); },
  });
  const submitDirect = (event: FormEvent) => { event.preventDefault(); const id = pageIdFromInput(directInput); if (!id) { setDirectError("노션 페이지 링크 또는 페이지 ID를 확인해 주세요."); return; } setDirectError(""); setDocumentId(id); importing.reset(); };
  const sourceDocuments = documents.data?.pages.flatMap(page => page.documents) ?? [];
  return <div className="notion-sync-page stack">
    <header className="page-head"><div><span className="studio-eyebrow">CONNECTED WORKSPACE</span><h1>노션 원고 연결</h1><p className="muted">원고와 사진을 스튜디오로 가져오고, 캔바에서 완성한 디자인까지 이어 보세요.</p></div><GuardedLink className="btn ghost" href="/">내 콘텐츠로 돌아가기</GuardedLink></header>
    <section className="panel notion-connection"><div><h2>노션 연결</h2>{status.isPending ? <p className="muted" role="status">연결 상태 확인 중…</p> : status.data && <p className={documents.isSuccess ? "notion-connected" : "muted"}>{!status.data.configured ? "연결 설정에서 노션을 먼저 연결해 주세요." : documents.isError ? "연결 키는 등록돼 있으나 제작표 접근을 확인하지 못했습니다." : documents.data ? "제작표 원고 목록을 불러왔습니다." : "연결 키가 등록돼 있습니다. 제작표 접근을 확인하는 중입니다."}</p>}</div><div className="row"><button className="btn sm" onClick={() => { void status.refetch(); void documents.refetch(); }} disabled={status.isFetching}>상태 다시 확인</button><GuardedLink className="btn sm" href="/connections?service=notion">연결 설정</GuardedLink></div></section>
    {status.error && <ErrorBox error={status.error} retry={() => void status.refetch()} />}
    <div className="notion-workspace">
      <section className="panel notion-picker stack"><div><h2>노션 원고 가져오기</h2><p className="small muted">원고를 선택해 내용과 첨부 사진을 확인하세요.</p></div>
        <form className="notion-search" onSubmit={event => { event.preventDefault(); setQuery(queryInput.trim()); }}><label className="field">원고 검색<input type="search" value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="제목 또는 콘텐츠 이름" /></label><button className="btn" disabled={!status.data?.configured}>검색</button></form>
        <label className="field">노션 채널 필터<select value={sourceChannel} onChange={event => setSourceChannel(event.target.value)}><option value="">전체 채널</option>{activeChannels.map(channel => <option key={channel.id} value={channel.name}>{channel.name}</option>)}</select></label>
        {documents.isFetching && !documents.data && status.data?.configured && <Loading label="노션 원고 불러오는 중" />}
        {documents.error && <ErrorBox error={documents.error} retry={() => void documents.refetch()} />}
        <ul className="notion-document-list">{sourceDocuments.map(source => <li key={source.pageId}><button type="button" aria-pressed={source.pageId === documentId} disabled={importing.isPending} onClick={() => { setDocumentId(source.pageId); importing.reset(); }}><strong>{source.title || source.coverTitle || "제목 없는 원고"}</strong><span>{[source.channel, source.category, source.stage].filter(Boolean).join(" · ")}</span><small>{dateLabel(source.lastEditedAt)}</small></button></li>)}</ul>
        {documents.data && !sourceDocuments.length && <p className="muted">조건에 맞는 원고가 없습니다. 페이지 링크로도 가져올 수 있습니다.</p>}
        {documents.hasNextPage && <button className="btn" disabled={documents.isFetchingNextPage} onClick={() => void documents.fetchNextPage()}>{documents.isFetchingNextPage ? "불러오는 중…" : "원고 더 보기"}</button>}
        <details className="notion-direct"><summary>페이지 링크로 직접 찾기</summary><form className="stack" onSubmit={submitDirect}><label className="field">노션 페이지 링크<input value={directInput} onChange={event => setDirectInput(event.target.value)} placeholder="노션 페이지 링크를 붙여 넣으세요" /></label><button className="btn" disabled={!status.data?.configured || !directInput.trim() || importing.isPending}>원고 확인</button></form>{directError && <p className="notice err" role="alert">{directError}</p>}</details>
      </section>
      <section className="panel notion-preview stack" aria-label="가져올 원고 미리보기"><h2>가져올 원고 미리보기</h2>
        {!documentId && <p className="muted">목록에서 원고를 선택하거나 노션 페이지 링크를 입력하세요.</p>}
        {document.isFetching && !document.data && documentId && <Loading label="선택한 원고 확인 중" />}
        {document.error && <ErrorBox error={document.error} retry={() => void document.refetch()} />}
        {document.data && <><div className="row between"><h3>{document.data.title}</h3>{externalUrl(document.data.url) && <a href={externalUrl(document.data.url)} target="_blank" rel="noreferrer">노션에서 열기 ↗</a>}</div><Manuscript label="가져올 노션 원고" pages={document.data.pages} coverTitle={document.data.coverTitle} /><Photos photos={document.data.photos} preview />
          <label className="field">저장할 채널<select value={channelId} disabled={importing.isPending} onChange={event => setChannelId(event.target.value ? Number(event.target.value) : "")}><option value="">채널 선택</option>{activeChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
          <CoverStyles value={coverStyle} onChange={setCoverStyle} disabled={importing.isPending} name="import-cover-style" />
          <button className="btn primary" disabled={!channelId || !activeChannels.some(channel => channel.id === channelId) || importing.isPending || document.isFetching} onClick={() => importing.mutate()}>{importing.isPending ? "원고와 사진 가져오는 중…" : "스튜디오로 가져오기"}</button>
          {importing.error && <ErrorBox error={importing.error} retry={() => void document.refetch()} />}
        </>}
      </section>
    </div>
    <section className="panel stack"><div className="row between"><div><h2>연결된 원고</h2><p className="small muted">양쪽의 원고를 비교하고 적용할 방향을 선택하세요.</p></div><button className="btn sm" onClick={() => void links.refetch()} disabled={links.isFetching}>목록 새로고침</button></div>
      {links.isPending && <Loading label="연결된 원고 불러오는 중" />}{links.error && <ErrorBox error={links.error} retry={() => void links.refetch()} />}
      <ul className="notion-link-list">{links.data?.links.map(link => <li key={link.id}><GuardedLink href={`/notion?link=${link.id}`} ariaCurrent={selectedLink === link.id}><strong>{link.title || "제목 없는 원고"}</strong><span>{allChannels.find(channel => channel.id === link.channelId)?.name || "연결 채널"} · 사진 {link.photoCount}개</span><span className="badge">{phaseLabel[link.canva.phase]}</span></GuardedLink></li>)}</ul>
      {links.data && !links.data.links.length && <p className="muted">아직 연결한 원고가 없습니다.</p>}
    </section>
    {Number.isSafeInteger(selectedLink) && selectedLink > 0 && <NotionLinkedDocument key={selectedLink} id={selectedLink} />}
  </div>;
}

type LinkAction = { kind: "pull" | "push" | "style" | "autoSync" | "canva" | "export"; resolveConflict?: boolean; coverStyle?: CoverStyle; autoSync?: boolean };
function conflictDetail(error: ApiError): NotionStudioDetail | undefined {
  const candidate = error.body.detail ?? error.body.current;
  return candidate && typeof candidate === "object" && "link" in candidate && "copy" in candidate ? candidate as NotionStudioDetail : undefined;
}

export function NotionLinkedDocument({ id }: { id: number }) {
  const qc = useQueryClient();
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [conflict, setConflict] = useState<{ detail: NotionStudioDetail; choice: "pull" | "push" | null } | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const detail = useQuery({
    queryKey: ["notion-link", id], queryFn: ({ signal }) => api<NotionStudioDetail>(`/notion/links/${id}?refresh=1`, { signal }),
    refetchInterval: query => ["importing", "exporting"].includes(query.state.data?.link.canva.phase || "") ? 2500 : query.state.data?.link.autoSync ? 60_000 : false,
  });
  const data = detail.data;
  const signature = data ? `${data.link.version}:${data.itemVersion}:${data.notion?.sourceHash ?? data.link.sourceHash}:${data.link.canva.designId ?? ""}` : "";
  useEffect(() => { setExportConfirmed(false); setConflict(current => current ? { ...current, choice: null } : null); }, [signature]);
  const update = useMutation({
    mutationFn: (action: LinkAction) => {
      if (!data) throw new Error("연결된 원고를 먼저 확인해 주세요.");
      const body = { version: data.link.version, itemVersion: data.itemVersion, expectedSourceHash: data.notion?.sourceHash ?? data.link.sourceHash, resolveConflict: action.resolveConflict === true };
      if (action.kind === "style" || action.kind === "autoSync") return api<NotionStudioDetail>(`/notion/links/${id}`, { method: "PATCH", body: { version: data.link.version, ...(action.kind === "style" ? { coverStyle: action.coverStyle } : { autoSync: action.autoSync }) } });
      if (action.kind === "export") {
        if (!exportConfirmed) throw new Error("현재 원고와 캔바 문구를 대조한 뒤 확인해 주세요.");
        return api<NotionStudioDetail>(`/notion/links/${id}/canva/export`, { method: "POST", body: { version: data.link.version, itemVersion: data.itemVersion, confirmed: true } });
      }
      if (action.kind === "canva") return api<NotionStudioDetail>(`/notion/links/${id}/canva`, { method: "POST", body: { version: data.link.version, itemVersion: data.itemVersion } });
      return api<NotionStudioDetail>(`/notion/links/${id}/${action.kind}`, { method: "POST", body });
    }, retry: false,
    onSuccess: result => { qc.setQueryData(["notion-link", id], result); setConflict(null); setExportConfirmed(false); void qc.invalidateQueries({ queryKey: ["notion-links"] }); void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["notion-documents"] }); },
    onError: async (error, action) => {
      if (!(error instanceof ApiError) || error.status !== 409 || !["pull", "push"].includes(action.kind)) return;
      let current = conflictDetail(error);
      if (!current) { try { current = await api<NotionStudioDetail>(`/notion/links/${id}?refresh=1`); } catch { /* Keep both displayed drafts and the conflict error. */ } }
      if (current) qc.setQueryData(["notion-link", id], current);
      if (current || data) setConflict({ detail: current ?? data!, choice: null });
    },
  });
  const refresh = async () => { const result = await detail.refetch(); if (!result.error) { update.reset(); setDownloadError(null); } };
  const download = async () => {
    setDownloading(true); setDownloadError(null);
    try { const blob = await apiBlob(`/notion/links/${id}/output.zip`, "application/zip"); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "완성본.zip"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { setDownloadError(error); } finally { setDownloading(false); }
  };
  if (detail.isPending) return <section className="panel"><Loading label="연결 원고 확인 중" /></section>;
  if (!data) return <section className="panel"><ErrorBox error={detail.error || new Error("연결된 원고를 찾지 못했습니다.")} retry={() => void detail.refetch()} /></section>;
  const busy = update.isPending || ["importing", "exporting"].includes(data.link.canva.phase);
  const canvaUrl = externalUrl(data.link.canva.editUrl) ?? externalUrl(data.link.canva.viewUrl);
  const studioPages = [{ index: 1, title: data.copy.cover.title, body: data.copy.cover.subtitle }, ...data.copy.pages.map((page, index) => ({ index: index + 2, title: page.title, body: [page.subtitle, page.body, ...(page.columns?.map(column => `${column.title}\n${column.body}`) ?? [])].filter(Boolean).join("\n\n") }))];
  const notionPages = data.notion?.pages ?? data.source.pages;
  const notionCoverTitle = data.notion ? data.notion.coverTitle || notionPages.find(page => page.index === 1)?.title : data.source.coverTitle;
  const comparing = conflict?.detail ?? data;
  return <section className="panel notion-link-detail stack" aria-label="연결 원고 관리">
    <header className="row between"><div><span className="studio-eyebrow">연결된 원고</span><h2>{data.link.title}</h2><p className="small muted">마지막 동기화 {dateLabel(data.link.lastSyncedAt)}</p></div><span className="badge">{data.link.status === "studio_changed" ? "스튜디오 원고 변경됨" : data.notion?.changed ? "노션 원고 변경됨" : "동기화됨"}</span></header>
    <div className="row notion-actions"><a className="btn" href={externalUrl(data.link.notionUrl)} target="_blank" rel="noreferrer">노션 원고 열기 ↗</a>{data.link.studioCardId && <GuardedLink className="btn" href={`/studio/${data.link.studioCardId}`}>스튜디오 원고 편집</GuardedLink>}<button className="btn" disabled={busy || detail.isFetching} onClick={() => void refresh()}>{detail.isFetching ? "변경 확인 중…" : "노션 변경 확인"}</button></div>
    <div className="notice notion-auto-sync"><label className="notion-toggle"><input type="checkbox" checked={data.link.autoSync} disabled={busy} onChange={event => update.mutate({ kind: "autoSync", autoSync: event.target.checked })} /><strong>자동 동기화</strong></label><p className="small muted">원고 한쪽만 바뀌면 반대쪽에 반영합니다. 양쪽이 바뀌면 적용을 멈추고 비교를 기다립니다. 캔바 제작과 완성본 가져오기는 아래 버튼으로 진행하세요.</p>{data.link.lastCheckedAt && <p className="small muted">마지막 변경 확인 {dateLabel(data.link.lastCheckedAt)}</p>}</div>
    {detail.error && <ErrorBox error={detail.error} retry={() => void detail.refetch()} />}
    <div className="notion-comparison"><section><h3>노션 원고</h3><Manuscript label="현재 노션 원고" pages={notionPages} coverTitle={notionCoverTitle} /></section><section><h3>스튜디오 원고</h3><Manuscript label="현재 스튜디오 원고" pages={studioPages} coverTitle={data.copy.cover.title} /></section></div>
    <Photos photos={data.photos} />
    {!!data.warnings.length && <div className="notice warn"><ul>{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {conflict ? <section className="notice warn notion-conflict" aria-label="원고 충돌 해결"><h3>양쪽 원고가 달라졌습니다</h3><p>위의 노션 원고와 스튜디오 원고를 비교한 뒤, 유지할 쪽을 직접 선택해 주세요.</p><fieldset><legend>어느 쪽 원고를 유지할까요?</legend><label><input type="radio" name={`conflict-${id}`} checked={conflict.choice === "pull"} onChange={() => setConflict({ detail: comparing, choice: "pull" })} />노션 원고를 유지하고 스튜디오에 적용</label><label><input type="radio" name={`conflict-${id}`} checked={conflict.choice === "push"} onChange={() => setConflict({ detail: comparing, choice: "push" })} />스튜디오 원고를 유지하고 노션에 반영</label></fieldset><button className="btn" disabled={!conflict.choice || busy} onClick={() => conflict.choice && update.mutate({ kind: conflict.choice, resolveConflict: true })}>선택한 원고로 동기화</button></section> : <div className="row notion-actions"><button className="btn" disabled={busy || detail.isFetching} onClick={() => update.mutate({ kind: "pull" })}>노션 → 스튜디오 적용</button><button className="btn" disabled={busy || detail.isFetching} onClick={() => update.mutate({ kind: "push" })}>스튜디오 → 노션 반영</button></div>}
    {update.error && <ErrorBox error={update.error} retry={() => void refresh()} />}
    <section className="notion-canva stack"><div><h3>캔바 디자인</h3><p className="small muted">원고와 사진으로 디자인을 만들고, 캔바에서 편집한 완성본을 가져옵니다.</p></div>
      <CoverStyles value={data.link.coverStyle} disabled={busy || !!conflict} onChange={coverStyle => update.mutate({ kind: "style", coverStyle })} name={`linked-cover-style-${id}`} />
      <div className="row notion-actions"><button className="btn primary" disabled={busy || !!conflict || detail.isFetching} onClick={() => update.mutate({ kind: "canva" })}>{data.link.canva.designId ? "현재 원고로 새 디자인 만들기" : "캔바로 제작"}</button>{canvaUrl && <a className="btn" href={canvaUrl} target="_blank" rel="noreferrer">캔바 열기 ↗</a>}</div>
      <p className={data.link.canva.phase === "failed" || data.link.canva.phase === "result_unknown" ? "notice warn" : "small muted"} role="status">{phaseLabel[data.link.canva.phase]}{data.link.canva.error && ` · ${data.link.canva.error}`}</p>
      {["importing", "exporting", "result_unknown", "failed"].includes(data.link.canva.phase) && <button className="btn" disabled={detail.isFetching || update.isPending} onClick={() => void refresh()}>처리 상태 다시 확인</button>}
      {data.link.canva.designId && <div className="notion-canva-output stack"><label className="notion-export-confirm"><input type="checkbox" checked={exportConfirmed} disabled={busy || !!conflict} onChange={event => setExportConfirmed(event.target.checked)} /><span>현재 스튜디오 원고와 캔바의 모든 문구를 대조했습니다.</span></label><button className="btn" disabled={!exportConfirmed || busy || !!conflict || detail.isFetching} onClick={() => update.mutate({ kind: "export" })}>완성본 가져오기</button></div>}
      {data.link.canva.outputAssetId && <button className="btn" disabled={downloading} onClick={() => void download()}>{downloading ? "파일 준비 중…" : "완성본 ZIP 내려받기"}</button>}
      {!!downloadError && <ErrorBox error={downloadError} retry={() => void download()} />}
    </section>
  </section>;
}
