import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import type { StudioCard, StudioCardDetail, StudioContent, StudioRevision } from "@shared/studio";
import { api, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { ErrorBox } from "./ui";
import "./assetResults.css";

export function historyEntry(search: string) {
  const params = new URLSearchParams(search), raw = params.get("revision");
  const open = params.get("tab") === "history";
  const valid = raw !== null && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw));
  return { open, revisionId: open && valid ? Number(raw) : null, error: open && raw !== null && !valid ? "버전 주소를 확인해 주세요. 올바른 저장 기록 번호가 필요합니다." : null };
}

/** Actual stored media references, alongside text; opening this view never writes. */
function Snapshot({ content, title }: { content: StudioContent; title: string }) {
  const video = content.videoProject;
  return <article className="studio-history-snapshot"><h3>{title}</h3><h4>{content.title}</h4><p>{content.script || "저장한 전체 원고 없음"}</p>
    {content.panels.some(panel => panel.scene || panel.dialogue || panel.imageId) && <section aria-label={`${title} 컷`}><h4>컷 구성</h4>{content.panels.map((panel, index) => <figure key={index}>{panel.imageId && <img loading="lazy" src={`/api/studio/images/${panel.imageId}`} alt={`${index + 1}컷 저장 이미지`}/>}<figcaption>{index + 1}컷 · {panel.scene}<p>{panel.dialogue}</p></figcaption></figure>)}</section>}
    {content.finishedDeck && <section aria-label={`${title} 완성 이미지`}><h4>완성 이미지 {content.finishedDeck.pages.length}장</h4>{content.finishedDeck.pages.map((page, index) => <figure key={page.imageId}><img loading="lazy" src={`/api/studio/images/${page.imageId}`} alt={page.altText || `${index + 1}장 ${page.name}`}/><figcaption>{index + 1}장 · {page.name}</figcaption></figure>)}</section>}
    {content.experience && <section><h4>사진·영상 후기</h4><p>{content.experience.event} · {content.experience.place} · {content.experience.date}</p><p>{content.experience.notes}</p>{content.experience.coverId && <img src={`/api/studio/media/${content.experience.coverId}/preview`} alt="후기 표지" loading="lazy"/>}{content.experience.pages.map((page, index) => <figure key={index}>{page.mediaId && <img src={`/api/studio/media/${page.mediaId}/preview`} alt={page.altText || page.title} loading="lazy"/>}<figcaption>{page.title}<p>{page.body}</p></figcaption></figure>)}</section>}
    {video && <section aria-label={`${title} 영상 구성`}><h4>영상 구성 · {video.ratio}</h4><p>총 {video.scenes.reduce((sum, scene) => sum + scene.duration, 0)}초 · {video.scenes.length}개 장면</p>{video.outputMediaId ? <><video controls playsInline preload="none" aria-label={`${title} 완성 영상`} src={`/api/studio/media/${video.outputMediaId}`}/><a href={`/api/studio/media/${video.outputMediaId}?download=1`} className="btn" download>저장한 완성 영상 받기</a></> : <p>저장한 완성 영상 없음</p>}<ol>{video.scenes.map(scene => <li key={scene.id}><strong>{scene.title || "이름 없는 장면"} · {scene.duration}초</strong>{scene.mediaId && <p>연결 자료 #{scene.mediaId} · <a href={`/api/studio/media/${scene.mediaId}?download=1`} download>장면 원본 받기</a></p>}<p>자막: {scene.subtitle || "없음"}</p><p>내레이션: {scene.narration || "없음"}</p>{scene.audio && <p>음향: {scene.audio}</p>}</li>)}</ol><p>음향 가이드: {video.audioGuide || "없음"}</p></section>}
    <h4>캡션</h4><p>{content.caption || "저장한 캡션 없음"}</p>
  </article>;
}

/** Only rendered for non-source Studio cards. Existing editors remain mounted. */
export function StudioHistoryEntry({ card }: { card: StudioCard }) {
  const entry = historyEntry(useSearch()), qc = useQueryClient();
  const actor = qc.getQueryData<{ user?: string; recoveryScope?: string }>(["me"]);
  const scope = JSON.stringify([actor?.user, actor?.recoveryScope, card.id, entry.revisionId]);
  // A scope key discards pending UI state and makes old callbacks inert on target changes.
  if (!entry.open || card.sourceReference) return null;
  return <HistoryPanel key={scope} scope={scope} card={card} revisionId={entry.revisionId} entryError={entry.error}/>;
}

function HistoryPanel({ card, revisionId, entryError, scope }: { card: StudioCard; revisionId: number | null; entryError: string | null; scope: string }) {
  const qc = useQueryClient(), guard = useDirtyGuard(), uid = useId();
  const [fresh, setFresh] = useState<StudioCard | null>(null), [confirmation, setConfirmation] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const active = useRef(true), serial = useRef(false);
  const baseline = fresh && fresh.version >= card.version ? fresh : card;
  const loaded = useQuery({ queryKey: ["studio", "exact-revision", scope, card.id, revisionId], enabled: revisionId !== null && !entryError, queryFn: async ({ signal }) => {
    const result = await api<StudioRevision>(`/studio/cards/${card.id}/revisions/${revisionId}`, { signal });
    if (result.id !== revisionId || result.cardId !== card.id) throw new Error("이 콘텐츠의 저장 기록을 확인하지 못했습니다. 다른 기록으로 대신 표시하지 않습니다.");
    return result;
  }, retry: false, staleTime: Infinity });
  const selected = loaded.data?.id === revisionId && loaded.data.cardId === card.id ? loaded.data : null;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (confirmation !== null && card.version > confirmation) { setConfirmation(null); setNotice("현재 작업이 변경되었습니다. 최신 버전을 다시 비교해 주세요."); } }, [card.version, confirmation]);
  useEffect(() => { const key = `studio-history-restore:${card.id}`; guard.setDirty(key, busy, async () => false); return () => guard.setDirty(key, false); }, [guard.setDirty, busy, card.id]);

  async function prepare() {
    if (serial.current || !selected) return;
    serial.current = true; setBusy(true); setConfirmation(null); setError(null); setNotice("");
    try {
      const result = await api<StudioCardDetail>(`/studio/cards/${card.id}`);
      if (!active.current) return;
      if (result.card.id !== card.id || result.card.trashedAt || result.card.sourceReference) throw new Error("현재 콘텐츠에서는 이 작업 복원을 사용할 수 없습니다. 연결 원고의 버전 기록을 확인해 주세요.");
      setFresh(result.card);
      if (result.card.version <= selected.version && selected.applied) throw new Error("선택한 버전이 이미 현재 작업입니다.");
      setConfirmation(result.card.version);
    } catch (cause) { if (active.current) setError(cause as Error); }
    finally { serial.current = false; if (active.current) setBusy(false); }
  }
  async function restore() {
    if (serial.current || !selected || confirmation === null) return;
    if (guard.hasDirty() || card.version > confirmation) { guard.confirmLeave(() => { void prepare(); }); return; }
    serial.current = true; setBusy(true); setError(null); setNotice("");
    try {
      const response = await api<StudioCard | { card: StudioCard }>(`/studio/cards/${card.id}/restore`, { method: "POST", body: { version: confirmation, revisionId: selected.id } });
      if (!active.current) return;
      const result = "card" in response ? response.card : response;
      if (result.id !== card.id || result.version <= confirmation) throw new ApiError(0, "복원 결과를 확인하지 못했습니다. 최신 작업과 기록을 확인해 주세요.");
      setFresh(result); setConfirmation(null); setNotice(`작업 v${selected.version}을 새 초안 v${result.version}으로 복원했습니다. 다시 검토하고 승인해 주세요.`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["studio"] }), qc.invalidateQueries({ queryKey: ["ch"] }), qc.invalidateQueries({ queryKey: ["asset-library"] })]);
    } catch (cause) {
      if (!active.current) return;
      setError(cause as Error); setConfirmation(null);
      setNotice(cause instanceof ApiError && cause.status === 409 ? "다른 곳에서 작업을 저장했습니다. 입력은 유지됩니다. 최신 버전을 다시 비교해 주세요." : "처리 결과를 최신 작업과 버전 기록에서 먼저 확인해 주세요. 자동으로 재시도하지 않습니다.");
    } finally { serial.current = false; if (active.current) setBusy(false); }
  }
  return <section className="studio-history-entry stack" aria-labelledby={`${uid}-heading`} aria-busy={busy}>
    <div><h2 id={`${uid}-heading`}>저장 작업 버전 비교</h2><p className="muted">주소로 선택한 기록을 현재 저장 작업과 비교합니다. 편집 중인 입력은 아래 편집기에 유지됩니다.</p></div>
    {entryError && <p className="notice err" role="alert">{entryError}</p>}{!revisionId && !entryError && <p>비교할 저장 기록 주소를 선택해 주세요.</p>}
    {loaded.isFetching && <p role="status">선택한 저장 기록 불러오는 중…</p>}{loaded.error && <ErrorBox error={loaded.error} retry={() => void loaded.refetch()}/>}
    {selected && <><p className="small muted">선택: 작업 v{selected.version} · {new Date(selected.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {selected.applied ? "저장한 작업" : "적용 전 제안 기록"}</p><div className="asset-result-comparison"><Snapshot content={baseline} title={`현재 저장 작업 v${baseline.version}`}/><Snapshot content={selected.snapshot} title={`선택한 작업 v${selected.version}`}/></div>
      <p className="notice small">복원은 과거 이미지·영상 참조와 내용을 새 초안으로 저장합니다. 이전 기록은 남고 게시 승인은 다시 필요합니다. 이미 전송한 게시물은 바뀌지 않습니다.</p>
      {confirmation !== null ? <div className="notice warn" role="group" aria-label="작업 복원 확인"><p>현재 v{confirmation}을 보존한 채 선택한 v{selected.version}을 새 초안으로 복원할까요?</p><div className="asset-result-actions"><button className="btn primary" disabled={busy} onClick={() => void restore()}>확인 후 새 초안으로 복원</button><button className="btn" disabled={busy} onClick={() => setConfirmation(null)}>취소</button></div></div> : <button className="btn" disabled={busy || selected.version === baseline.version && selected.applied} onClick={() => guard.confirmLeave(() => { void prepare(); })}>{busy ? "최신 작업 확인 중…" : "이 작업을 새 초안으로 복원"}</button>}</>}
    {error && <ErrorBox error={error}/>} {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
