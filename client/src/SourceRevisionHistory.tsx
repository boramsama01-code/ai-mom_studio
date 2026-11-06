import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { compareSourceRevisions, type SourceRevisionCurrent, type SourceRevisionRestoreResponse, type SourceRevisionSnapshot, type SourceRevisionSummary } from "@shared/sourceRevisionHistory";
import { api, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import "./sourceRevisionHistory.css";

type Props = {
  channelId: number;
  itemId: number;
  itemVersion: number;
  current: SourceRevisionCurrent | null;
  revisions: SourceRevisionSummary[];
  onRestored?: () => void;
  requestedRevisionId?: number | null;
  entryError?: string | null;
};
type SavedDetail = { item: { id: number; channelId: number; version: number }; current: SourceRevisionCurrent | null; revisions: SourceRevisionSummary[] };
type Confirmation = { revisionId: number; version: number };
const author = (value: string) => ({ operator: "직접 수정", llm: "AI 작성", system: "시스템" }[value] ?? value);
const date = (value: string | Date) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "시각 확인 필요" : parsed.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};

/** Read comparisons without touching the editor. Restoring requires a fresh CAS version. */
export function SourceRevisionHistory({ channelId, itemId, itemVersion, current, revisions, onRestored, requestedRevisionId, entryError }: Props) {
  const qc = useQueryClient(), guard = useDirtyGuard(), uid = useId();
  const [selectedId, setSelectedId] = useState<number | null>(requestedRevisionId ?? null);
  const [allFields, setAllFields] = useState(false);
  const [fresh, setFresh] = useState<SavedDetail | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [checking, setChecking] = useState(false), [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const serial = useRef(false), selection = useRef(selectedId), mounted = useRef(true);
  selection.current = selectedId;
  const path = `/channels/${channelId}/items/${itemId}`;
  const loaded = useQuery({
    queryKey: ["source-revision", channelId, itemId, selectedId],
    queryFn: async ({ signal }) => {
      const result = await api<SourceRevisionSnapshot>(`${path}/revisions/${selectedId}`, { signal });
      if (result.id !== selectedId || result.contentItemId !== itemId) throw new Error("이 콘텐츠의 원고 기록을 확인하지 못했습니다. 다른 원고로 대신 표시하지 않습니다.");
      return result;
    },
    enabled: selectedId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const baseline = fresh && fresh.item.version >= itemVersion ? fresh : { item: { id: itemId, channelId, version: itemVersion }, current, revisions };
  const selected = loaded.data?.id === selectedId ? loaded.data : null;
  const changes = selected ? compareSourceRevisions(baseline.current?.payload ?? null, selected.payload) : [];
  const changedCount = changes.filter(field => field.changed).length;
  const visible = allFields ? changes : changes.filter(field => field.changed);
  const isCurrent = selected?.id === baseline.current?.id;
  const busy = checking || restoring;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (requestedRevisionId !== undefined) { setSelectedId(requestedRevisionId); setConfirmation(null); setError(null); setNotice(""); } }, [requestedRevisionId]);
  useEffect(() => {
    if (confirmation && itemVersion > confirmation.version) {
      setConfirmation(null);
      setNotice("현재 저장본이 변경되었습니다. 최신 내용을 다시 비교한 뒤 복원해 주세요.");
    }
  }, [itemVersion, confirmation]);
  useEffect(() => {
    const key = `source-revision-restore-${channelId}-${itemId}`;
    guard.setDirty(key, restoring, async () => false);
    return () => guard.setDirty(key, false);
  }, [channelId, itemId, restoring, guard]);

  // This runs after the dirty guard has saved/discarded every registered editor.
  // A save may advance the item version, so its old render-time version is unsafe.
  async function refreshComparison(target: number) {
    if (serial.current) return;
    serial.current = true; setChecking(true); setError(null); setConfirmation(null); setNotice("");
    try {
      const latest = await api<SavedDetail>(path);
      if (!mounted.current || selection.current !== target) return;
      setFresh(latest);
      // Update alias and canonical detail keys together. The editors' own dirty
      // baselines decide whether to adopt; a read never resets mounted editors.
      qc.setQueriesData({ predicate: query => query.queryKey[0] === "ch" && query.queryKey[2] === "item" && Number(query.queryKey[3]) === itemId }, latest);
      if (latest.current?.id === target) throw new Error("선택한 버전이 이미 현재 원고입니다. 다른 버전을 선택해 주세요.");
      setConfirmation({ revisionId: target, version: latest.item.version });
    } catch (cause) { if (mounted.current) setError(cause as Error); }
    finally { serial.current = false; if (mounted.current) setChecking(false); }
  }
  function prepareRestore() {
    const target = selectedId;
    if (!target || !selected || isCurrent || serial.current) return;
    guard.confirmLeave(() => { void refreshComparison(target); });
  }
  async function restore() {
    const confirmed = confirmation;
    if (!confirmed || !selected || confirmed.revisionId !== selected.id || serial.current) return;
    // Edits made after opening the confirmation need their own consent as well.
    if (guard.hasDirty() || itemVersion > confirmed.version) { prepareRestore(); return; }
    serial.current = true; setRestoring(true); setError(null); setNotice("");
    try {
      const result = await api<SourceRevisionRestoreResponse>(`${path}/revisions/${confirmed.revisionId}/restore`, { method: "POST", body: { version: confirmed.version } });
      if (!mounted.current) return;
      setFresh(previous => ({
        item: result.item,
        current: result.revision,
        revisions: [result.revision, ...(previous?.revisions ?? revisions)],
      }));
      setConfirmation(null);
      setNotice(`r${result.restoredFrom.revisionNo}의 원고를 새 버전 r${result.revision.revisionNo}으로 복원했습니다. 원고를 다시 검토하고 이미지를 새로 만들어 주세요.`);
      onRestored?.();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ch"] }),
        qc.invalidateQueries({ queryKey: ["card-copy", channelId, itemId] }),
        qc.invalidateQueries({ queryKey: ["studio"] }),
        qc.invalidateQueries({ queryKey: ["collection"] }),
      ]);
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause as Error); setConfirmation(null);
      if (cause instanceof ApiError && cause.status === 409) setNotice("다른 곳에서 저장한 원고가 있습니다. 최신 저장본을 다시 비교한 뒤 복원해 주세요. 입력 중인 내용은 유지됩니다.");
      else if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) setNotice("복원 결과를 아직 확인하지 못했습니다. 최신 저장본과 버전 기록을 먼저 확인해 주세요.");
    } finally { serial.current = false; if (mounted.current) setRestoring(false); }
  }

  return <section className="source-revision-history stack" aria-labelledby={`${uid}-heading`} aria-busy={busy}>
    <div><h3 id={`${uid}-heading`}>원고 버전 비교</h3><p className="small muted">현재 저장본과 과거 원고·카드 문구를 비교합니다. 복원하면 이전 기록을 보존한 채 새 버전으로 저장됩니다. 승인 당시의 이미지 파일과 승인은 복원하지 않습니다.</p></div>
    {entryError && <p className="notice err" role="alert">{entryError}</p>}
    <label className="field">비교할 버전
      <select value={selectedId ?? ""} disabled={busy} onChange={event => {
        setSelectedId(event.target.value ? Number(event.target.value) : null);
        setConfirmation(null); setError(null); setNotice("");
      }}>
        <option value="">버전을 선택해 주세요</option>
        {selectedId !== null && !baseline.revisions.some(revision => revision.id === selectedId) && <option value={selectedId}>{selected ? `r${selected.revisionNo}` : `기록 #${selectedId}`} · 주소로 선택한 기록</option>}
        {baseline.revisions.map(revision => <option key={revision.id} value={revision.id}>r{revision.revisionNo} · {author(revision.author)} · {date(revision.createdAt)}{revision.id === baseline.current?.id ? " · 현재 저장본" : ""}</option>)}
      </select>
    </label>
    {!revisions.length && <p className="muted">아직 저장한 원고 기록이 없습니다. 원고를 저장하면 여기서 비교할 수 있습니다.</p>}
    {selectedId && loaded.isPending && <p role="status">선택한 원고를 불러오는 중…</p>}
    {selectedId && loaded.error && <div className="notice err" role="alert"><p>{loaded.error.message}</p><button className="btn" onClick={() => void loaded.refetch()}>선택한 원고 다시 불러오기</button></div>}
    {selected && <>
      <p className="small muted">선택한 기록: r{selected.revisionNo} · {author(selected.author)} · {date(selected.createdAt)} (한국 시간){selected.note ? ` · ${selected.note}` : ""}</p>
      <div className="source-revision-summary"><strong>{changedCount ? `${changedCount}개 항목이 다릅니다` : "원고·카드 문구가 같습니다"}</strong><label><input type="checkbox" checked={allFields} onChange={event => setAllFields(event.target.checked)} /> 같은 항목도 보기</label></div>
      <div className="source-revision-columns" aria-hidden="true"><strong>현재 저장본{baseline.current ? ` r${baseline.current.revisionNo}` : " 없음"}</strong><strong>선택한 버전 r{selected.revisionNo}</strong></div>
      {(["source", "copy"] as const).map(section => {
        const fields = visible.filter(field => field.section === section);
        if (!fields.length) return null;
        return <section className="source-revision-section" key={section} aria-label={section === "source" ? "원고 내용 비교" : "카드 문구 비교"}>
          <h4>{section === "source" ? "원고 내용" : "카드에 들어갈 문구"}</h4>
          {fields.map(field => <div className={`source-revision-field ${field.changed ? "changed" : ""}`} key={field.key}>
            <h5>{field.label}</h5><div className="source-revision-values"><div><span className="source-revision-side">현재 저장본{baseline.current ? ` r${baseline.current.revisionNo}` : " 없음"}</span><p>{field.current}</p></div><div><span className="source-revision-side">선택한 버전 r{selected.revisionNo}</span><p>{field.selected}</p></div></div>
          </div>)}
        </section>;
      })}
      {!visible.length && <p className="muted">{changedCount ? "표시할 항목을 선택해 주세요." : "변경된 문구가 없습니다. ‘같은 항목도 보기’로 전체 내용을 확인할 수 있습니다."}</p>}
      <p className="small muted">캡션·게시 계정·예약 시각과 연결 자료는 원고 버전의 복원 대상에 포함되지 않습니다. 지금 저장된 게시 설정을 유지합니다.</p>
      {confirmation ? <div className="notice warn source-revision-confirm" role="group" aria-label="원고 복원 확인">
        <p><strong>r{selected.revisionNo}을 새 원고 버전으로 복원할까요?</strong></p>
        <p>현재 저장본도 기록에 남습니다. 승인은 해제되고 아직 시작하지 않은 예약은 취소됩니다. 복원 후 원고 검토와 이미지 갱신이 필요합니다. 이미 전송 중인 작업과 게시 결과는 발행함에서 확인해 주세요.</p>
        <div className="source-revision-actions"><button className="btn primary" disabled={busy} onClick={() => void restore()}>{restoring ? "새 버전으로 복원 중…" : "확인 후 새 버전으로 복원"}</button><button className="btn" disabled={busy} onClick={() => setConfirmation(null)}>취소</button></div>
      </div> : <button className="btn source-revision-restore" disabled={busy || isCurrent} onClick={prepareRestore}>{checking ? "최신 저장본 확인 중…" : isCurrent ? "현재 저장본입니다" : "이 버전 복원하기"}</button>}
    </>}
    {error && <p className="notice err" role="alert">{error.message}</p>}
    {notice && <p className="notice small" role="status">{notice}</p>}
  </section>;
}
