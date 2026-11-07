import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, ApiError } from "./api";
import { ErrorBox, GuardedLink } from "./ui";
import { parseCanvaJob } from "./canvaEditorialContract";
import type { CanvaJobDto } from "@shared/canvaEditorial";
import { canvaDesignIdFromInput, canvaManualImportRequestSchema, canvaManualSnapshotSchema } from "@shared/canvaManualImport";

type Props = {
  channelId: number; itemId: number; version: number; revisionId: number;
  disabled: boolean; busy: boolean; connected: boolean; recommended: boolean;
  /** Increment only for an explicit request to open and focus this form. */
  openRequest?: number;
  jobs: CanvaJobDto[]; originalDesignIds: string[];
  onBlockingChange: (blocked: boolean) => void; onJob: (job: CanvaJobDto) => void;
};
const pendingSchema = z.object({ request: canvaManualImportRequestSchema, revisionId: z.number().int().positive() }).strict();
type Pending = z.infer<typeof pendingSchema>;
function readPending(key: string): Pending | null {
  try { const parsed = pendingSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null")); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
function readDesign(key: string) {
  try { return canvaDesignIdFromInput(sessionStorage.getItem(key) ?? "") ?? ""; }
  catch { return ""; }
}
function matches(job: CanvaJobDto, intent: Pending) {
  const snapshot = canvaManualSnapshotSchema.safeParse(job.result?.manualImport);
  return job.requestId === intent.request.requestId && job.purpose === "import" && job.sourceVersion === intent.request.version
    && job.sourceRevisionId === intent.revisionId && job.designId === intent.request.designId && snapshot.success && snapshot.data.designId === intent.request.designId;
}

/** The server owns output jobs and manuscript versions; this receipt only prevents a new UUID after a lost response. */
export function CanvaManualImport(props: Props) {
  const me = useQueryClient().getQueryData<{ user?: string | null; recoveryScope?: string | null }>(["me"]);
  const scope = JSON.stringify([me?.user ?? null, me?.recoveryScope ?? null, props.channelId, props.itemId]);
  return <ManualImportForm key={scope} {...props} storageKey={`spacepenguin.canva-manual:${scope}`} persistent={!!me?.user} />;
}

function ManualImportForm({ storageKey, persistent, ...props }: Props & { storageKey: string; persistent: boolean }) {
  const { channelId, itemId, version, revisionId, disabled, busy, connected, recommended, openRequest = 0, jobs, originalDesignIds, onBlockingChange, onJob } = props;
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(() => persistent ? readPending(storageKey) : null);
  const [designInput, setDesignInput] = useState(() => pending?.request.designId ?? (persistent ? readDesign(storageKey + ":design") : ""));
  const [copyConfirmed, setCopyConfirmed] = useState(false), [textConfirmed, setTextConfirmed] = useState(false);
  const [open, setOpen] = useState(recommended || !!pending), [error, setError] = useState<Error | null>(null);
  const submitting = useRef(false), touched = useRef(false), resolved = useRef(new Set<string>());
  const designField = useRef<HTMLInputElement>(null), summary = useRef<HTMLElement>(null);
  const lastOpenRequest = useRef(openRequest), focusRequested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const designId = canvaDesignIdFromInput(designInput), isOriginal = !!designId && originalDesignIds.includes(designId);
  const keep = (intent: Pending | null) => {
    setPending(intent);
    try { if (persistent) { if (intent) sessionStorage.setItem(storageKey, JSON.stringify(intent)); else sessionStorage.removeItem(storageKey); } } catch { /* The same in-memory request remains available. */ }
  };
  const receive = (job: CanvaJobDto, intent: Pending) => {
    if (!mounted.current) return;
    resolved.current.add(intent.request.requestId); keep(null); setError(null); setCopyConfirmed(false); setTextConfirmed(false); onJob(job);
  };
  useEffect(() => { if (recommended) setOpen(true); }, [recommended]);
  useEffect(() => {
    if (openRequest === lastOpenRequest.current) return;
    lastOpenRequest.current = openRequest;
    focusRequested.current = true;
    setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!open || !focusRequested.current) return;
    focusRequested.current = false;
    const target = designField.current && !designField.current.disabled ? designField.current : summary.current;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  }, [open, openRequest]);
  useEffect(() => { setCopyConfirmed(false); setTextConfirmed(false); }, [version, revisionId]);
  useEffect(() => {
    if (touched.current || pending || designInput) return;
    const previous = jobs.find(job => canvaManualSnapshotSchema.safeParse(job.result?.manualImport).success);
    if (previous?.designId) setDesignInput(previous.designId);
  }, [jobs, pending, designInput]);
  useEffect(() => {
    if (!pending) return;
    const receipt = jobs.find(job => job.requestId === pending.request.requestId);
    if (!receipt) return;
    if (matches(receipt, pending)) receive(receipt, pending);
    else setError(new ApiError(502, "이 요청과 다른 Canva 작업이 조회되었습니다. 기존 요청을 유지하고 결과를 다시 확인해 주세요."));
  }, [jobs, pending]);
  const request = useMutation({
    retry: false,
    mutationFn: async (intent: Pending) => {
      const job = parseCanvaJob(await api(`/channels/${channelId}/items/${itemId}/canva/manual-imports`, { method: "POST", body: intent.request }));
      if (!matches(job, intent)) throw new ApiError(502, "요청한 사본·원고 버전과 Canva 응답이 다릅니다. 같은 요청의 결과를 다시 확인해 주세요.");
      return job;
    },
    onSuccess: (job, intent) => { if (!resolved.current.has(intent.request.requestId)) receive(job, intent); },
    onError: (failure, intent) => {
      if (!mounted.current || resolved.current.has(intent.request.requestId)) return;
      setError(failure as Error);
      if (failure instanceof ApiError && [400, 401, 403, 404, 409, 422, 429].includes(failure.status)) {
        keep(null); setCopyConfirmed(false); setTextConfirmed(false);
      }
      void qc.invalidateQueries({ queryKey: ["canva-jobs", channelId, itemId] });
    },
    onSettled: () => { submitting.current = false; },
  });
  useEffect(() => { onBlockingChange(!!pending || request.isPending); }, [pending, request.isPending, onBlockingChange]);
  useEffect(() => () => onBlockingChange(false), [onBlockingChange]);
  const blocked = disabled || busy || !connected;
  const submit = () => {
    if (submitting.current || request.isPending) return;
    let intent = pending;
    if (!intent) {
      if (blocked || !designId || isOriginal || !copyConfirmed || !textConfirmed) return;
      intent = { request: { version, requestId: crypto.randomUUID(), designId, confirmed: true }, revisionId };
      keep(intent);
    }
    setOpen(true); setError(null); submitting.current = true; request.mutate(intent);
  };
  return <details className="content-options canva-manual-import" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary ref={summary}>{pending ? "직접 편집한 8장 가져오기 · 요청 결과 확인 필요" : "Canva에서 직접 편집한 8장 가져오기"}</summary>
    {open && <form className="stack" aria-label="Canva 사본 8장 가져오기" onSubmit={event => { event.preventDefault(); submit(); }}>
      <p>원본 템플릿은 보관하고 Canva에서 이 콘텐츠용 사본을 만들어 8장을 완성하세요. 자동 채우기 권한 없이 사본의 이미지를 가져올 수 있습니다.</p>
      <p className="small muted">Canva 문구와 스튜디오 원고는 자동으로 동기화되지 않습니다. 문구가 다르면 먼저 스튜디오 원고를 수정·저장한 뒤, 가져온 8장을 다시 대조해 주세요.</p>
      {!connected && <p className="notice warn small">새 가져오기는 Canva 계정 연결이 필요합니다. <GuardedLink href="/connections?service=canva">Canva 연결 확인</GuardedLink></p>}
      {disabled && <p className="notice small">현재 원고·이미지 설정을 먼저 저장해 주세요. 입력한 사본 링크와 기존 결과는 유지합니다.</p>}
      {busy && !pending && <p className="small muted">진행 중인 작업이나 결과 확인을 마친 뒤 새 사본을 가져올 수 있습니다.</p>}
      <label className="field">이 콘텐츠용 Canva 사본 링크 또는 ID<input ref={designField} aria-label="가져올 Canva 사본 링크 또는 ID" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8192} value={pending?.request.designId ?? designInput} readOnly={!!pending} disabled={request.isPending} placeholder="https://www.canva.com/design/D…/edit" onChange={event => {
        const value = event.target.value, id = canvaDesignIdFromInput(value); touched.current = true; setDesignInput(value); setCopyConfirmed(false); setTextConfirmed(false); setError(null);
        try { if (persistent) { if (id) sessionStorage.setItem(storageKey + ":design", id); else sessionStorage.removeItem(storageKey + ":design"); } } catch { /* Keep the input in this editor. */ }
      }} /></label>
      {!!designInput.trim() && !designId && !pending && <p className="notice warn small">Canva의 디자인 링크 또는 D로 시작하는 디자인 ID를 입력해 주세요.</p>}
      {isOriginal && !pending && <p className="notice warn small">등록된 원본 템플릿입니다. Canva에서 이 콘텐츠용 사본을 만든 뒤 사본 링크를 입력해 주세요.</p>}
      {!pending && <>
        <label className="check canva-manual-confirm"><input type="checkbox" checked={copyConfirmed} disabled={blocked || !designId || isOriginal || request.isPending} onChange={event => setCopyConfirmed(event.target.checked)} /><span>원본 템플릿을 보존한 이 콘텐츠용 사본입니다.</span></label>
        <label className="check canva-manual-confirm"><input type="checkbox" checked={textConfirmed} disabled={blocked || !designId || isOriginal || request.isPending} onChange={event => setTextConfirmed(event.target.checked)} /><span>8장의 모든 문구를 현재 저장된 스튜디오 원고와 맞췄습니다.</span></label>
      </>}
      {pending && <p className="notice warn" role="status">저장본 v{pending.request.version}의 가져오기 응답을 아직 확인하지 못했습니다. 입력을 유지하고 같은 요청 번호로 확인합니다.{pending.request.version !== version && " 현재 저장본이 바뀌어도 이전 요청의 결과부터 확인합니다."}</p>}
      <button type="submit" className="btn primary" disabled={request.isPending || !pending && (blocked || !designId || isOriginal || !copyConfirmed || !textConfirmed)}>{request.isPending ? "사본 확인 중…" : pending ? "수동 가져오기 요청 결과 확인" : "이 사본의 8장 가져오기"}</button>
      <p className="small muted">소유 계정·팀과 1080×1350 크기 8장을 검사합니다. 원본 디자인은 수정하지 않습니다. 가져온 뒤 이미지 확인 → 문구 대조 → 새 버전 저장 → 검토·승인으로 이어집니다.</p>
      {error && <ErrorBox error={error} />}
    </form>}
  </details>;
}
