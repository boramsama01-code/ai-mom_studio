import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { api, ApiError } from "./api";
import { ErrorBox, GuardedLink } from "./ui";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { isCardPageArtworkId } from "@shared/cardPageArtworkId";

type Background = { assetId: number; opacity?: number };
export type PageArtworkResult = { assetId: number; version: number; pageId: string; source: "ai" | "upload"; credit: string; jobId: number };
type Pending = { requestId: string; pageId: string; version: number; priorAssetId: number | null; mode: "ai" | "upload" };
type Props = {
  channelId: number; itemId: number; pageIndex: number; pageId?: string; background?: Background;
  disabled: boolean; showAi: boolean; imageReady: boolean; imageModel?: string; showOpacityControl?: boolean;
  save: () => Promise<{ version: number }>;
  onApply: (result: PageArtworkResult, priorAssetId: number | null) => boolean;
  onChange: (background?: Background) => void;
  onBusyChange: (busy: boolean) => void;
};
const readPending = (key: string): Pending | null => {
  try { const v = JSON.parse(sessionStorage.getItem(key) ?? "null"); return v && /^[0-9a-f-]{36}$/i.test(v.requestId) && isCardPageArtworkId(v.pageId) && Number.isSafeInteger(v.version) && ["ai", "upload"].includes(v.mode) ? v : null; }
  catch { return null; }
};
const fileDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다. 다시 선택해 주세요."));
  reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("이미지를 읽지 못했습니다.")); reader.readAsDataURL(file);
});

/** Keeps only small request metadata in session storage, never pasted image bytes. */
export function PageBackgroundEditor(props: Props) {
  const { channelId, itemId, pageIndex, background, disabled, showAi, imageReady, imageModel } = props;
  const pageId = props.pageId ?? (pageIndex === 0 ? "cover" : `body-${pageIndex}`);
  const path = `/channels/${channelId}/items/${itemId}/card-copy`;
  const storageKey = `spacepenguin.generation:${channelId}:${itemId}:page-background`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey));
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const [availableResult, setAvailableResult] = useState<PageArtworkResult | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const mounted = useRef(true), cancelled = useRef(new Set<string>()), fileInput = useRef<HTMLInputElement>(null), inFlight = useRef(false);
  const latest = useRef(props); latest.current = props;
  const recovery = useDraftRecovery<Record<string, string>>({
    recoveryKey: `item:${channelId}:${itemId}:page-background-directions`, label: "페이지별 그림 지시", version: 0,
    value: instructions, serverValue: {}, dirty: Object.values(instructions).some(value => value.trim()), ready: true,
    parse: value => value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, text]) => isCardPageArtworkId(key) && typeof text === "string" && text.length <= 2000) ? value as Record<string, string> : null,
    onRestore: setInstructions,
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; latest.current.onBusyChange(false); }; }, []);
  useEffect(() => { props.onBusyChange(busy); }, [busy, props.onBusyChange]);
  function persist(value: Pending | null) {
    if (mounted.current) setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory ID still protects result lookup. */ }
  }
  function apply(result: PageArtworkResult, request: Pending) {
    if (!mounted.current) return; // Reopening uses the saved request ID to recover the result.
    if (cancelled.current.has(request.requestId)) return;
    if (result.version !== request.version || result.pageId !== request.pageId || !latest.current.onApply(result, request.priorAssetId)) {
      setAvailableResult(result);
      setNotice("그림을 만드는 동안 원고나 배경 선택이 바뀌었습니다. 현재 입력은 유지했습니다. 아래 결과를 확인하고 사용할 페이지를 선택해 주세요.");
    } else {
      setAvailableResult(null); persist(null);
      setNotice(`${result.credit}를 요청한 페이지에 선택했습니다. 문구와 함께 저장하면 확정됩니다.`);
    }
  }
  async function lookup() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const result = await api<{ status: string; response?: PageArtworkResult; error?: string }>(`${path}/background-requests/${pending.requestId}`);
      if (result.status === "succeeded" && result.response) apply(result.response, pending);
      else if (["failed", "cancelled"].includes(result.status)) { persist(null); throw new Error(result.error || "이 그림 요청은 종료됐습니다. 기존 그림과 문구는 유지했습니다."); }
      else setNotice("기존 그림 요청을 처리하고 있습니다. 잠시 뒤 결과를 확인하거나 요청을 중단할 수 있습니다. 새 유료 요청은 보내지 않았습니다.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) persist(null);
      setError(e as Error);
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function start(mode: "ai" | "upload", file?: File) {
    if (inFlight.current || disabled || pending || recovery.pending) return;
    inFlight.current = true;
    setBusy(true); setError(null); setNotice("");
    let request: Pending | null = null;
    try {
      if (file && (!/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) || file.size > 8 * 1024 * 1024)) throw new Error("PNG·JPG·WEBP 이미지를 8MB 이하로 선택해 주세요.");
      const saved = await latest.current.save();
      request = { requestId: crypto.randomUUID(), pageId, version: saved.version, priorAssetId: background?.assetId ?? null, mode };
      const imageData = file ? await fileDataUrl(file) : undefined;
      persist(request);
      const result = await api<PageArtworkResult>(`${path}/background`, { method: "POST", body: { version: saved.version, requestId: request.requestId, pageId, mode, ...(mode === "ai" ? { instruction: instructions[pageId] ?? "" } : { imageData }) } });
      apply(result, request);
    } catch (e) {
      if (request && e instanceof ApiError && (e.body.jobStatus === "failed" || e.body.jobStatus === "cancelled" || [400, 401, 403, 404, 413, 422].includes(e.status))) persist(null);
      if (mounted.current) setError(e as Error);
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!pending) return;
    try {
      const result = await api<{ cancelled: boolean }>(`/channels/${channelId}/items/${itemId}/generation-cancel`, { method: "POST", body: { requestId: pending.requestId } });
      if (!result.cancelled) throw new Error("이미 완료된 요청일 수 있습니다. 기존 결과를 확인해 주세요.");
      cancelled.current.add(pending.requestId); persist(null); setNotice("그림 요청을 중단했습니다. 기존 그림과 문구를 유지합니다.");
    } catch (e) { setError(e as Error); }
  }
  function paste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault(); void start("upload", file);
  }
  const blocked = disabled || busy || !!pending || !!recovery.pending;
  return <details className="page-background-editor" onPaste={paste}>
    <summary>이 페이지 배경 · {background ? "이미지 사용 중" : "선택 사항"}</summary>
    <div className="stack">
      <RecoveryNotice recovery={recovery} formatValue={value => Object.entries(value).map(([id, text]) => `${id}\n${text}`).join("\n\n")} />
      {background && <img className="page-background-thumb" src={`/api${path}/background/${background.assetId}`} alt="선택한 페이지 배경" />}
      {showAi && <><label className="field">이 페이지 그림 지시<textarea rows={3} maxLength={2000} value={instructions[pageId] ?? ""} disabled={blocked} placeholder="예: 두 사람이 서로 다른 기준으로 같은 로봇을 바라보는 장면. 중앙에는 글을 위한 여백." onChange={event => setInstructions(value => ({ ...value, [pageId]: event.target.value }))} /></label><button className="btn" disabled={blocked || !imageReady} onClick={() => void start("ai")}>{busy ? "배경 작업 중…" : background ? "이 페이지 배경 다시 만들기 · 이미지 1장" : "이 페이지 배경 자동 만들기 · 이미지 1장"}</button><p className="hint">{imageModel ? `${imageModel} · ` : ""}선택한 페이지만 생성합니다. 기존 그림은 새 결과를 선택하고 저장할 때까지 유지합니다.</p></>}
      {showAi && !imageReady && <p className="hint">이미지 AI 연결이 필요합니다. <GuardedLink href="/connections?service=openai">OpenAI 연결 설정</GuardedLink>에서 연결하거나 직접 이미지를 선택할 수 있어요.</p>}
      <div className="page-background-upload" tabIndex={0} aria-label="페이지 배경 이미지 붙여넣기 영역"><span>이미지를 복사한 뒤 이 영역에 붙여넣거나 파일을 선택하세요.</span><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="페이지 배경 이미지 파일" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; if (file) void start("upload", file); event.target.value = ""; }} /><button className="btn" disabled={blocked} onClick={() => fileInput.current?.click()}>배경 이미지 선택</button><span className="hint">PNG·JPG·WEBP, 8MB 이하. 문구는 이미지 위에 별도로 배치합니다.</span></div>
      {background && <>{props.showOpacityControl !== false && <label className="field">배경 선명도 {background.opacity ?? 100}%<input type="range" min={0} max={100} value={background.opacity ?? 100} disabled={blocked} onChange={event => props.onChange({ ...background, opacity: Number(event.target.value) })} /></label>}<button className="btn ghost" disabled={blocked} onClick={() => props.onChange(undefined)}>이 페이지 배경 빼기</button></>}
      {availableResult && <div className="notice stack"><strong>확인 후 사용할 수 있는 배경</strong><img className="page-background-thumb" src={`/api${path}/background/${availableResult.assetId}`} alt="기존 요청에서 완성된 배경" /><button className="btn" disabled={disabled || busy} onClick={() => { props.onChange({ assetId: availableResult.assetId, opacity: 100 }); setAvailableResult(null); persist(null); setNotice("선택한 페이지에 배경을 불러왔습니다. 문구와 함께 저장해 주세요."); }}>{pageIndex === 0 ? "현재 표지" : `현재 ${pageIndex + 1}페이지`}에 이 배경 사용</button><button className="btn ghost" disabled={busy} onClick={() => { setAvailableResult(null); persist(null); setNotice("현재 배경을 유지했습니다."); }}>현재 배경 유지</button></div>}
      {pending && !availableResult && <div className="notice stack"><span>응답을 놓쳐도 같은 요청의 결과만 확인합니다.</span><div className="row"><button className="btn" disabled={busy} onClick={() => void lookup()}>기존 배경 작업 결과 확인</button><button className="btn ghost" onClick={() => void cancel()}>배경 요청 중단</button></div></div>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {error && <ErrorBox error={error} />}
    </div>
  </details>;
}
