import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiProviders, aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { cardCopyLimits, cardCopySchema, type CardCopy } from "@shared/cardCopy";
import { api, apiBlob, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { ErrorBox, GuardedLink, Loading } from "./ui";
import "./cardCopy.css";
import { useGenerationRequest } from "./useGenerationRequest";

export type CardCopyResponse = { version: number; revisionId: number; copy: CardCopy; hasSavedCopy: boolean; recoveryNotice?: string };
type AiStatus = { defaultProvider: AiProvider; text: Record<AiProvider, boolean> };
type Proposal = Omit<CardCopyResponse, "hasSavedCopy"> & { model?: string };
type Props = {
  channelId: number;
  itemId: number;
  itemVersion?: number;
  templateKey?: string | null;
  coverMode?: "reuse" | "ai" | "typography";
  disabled?: boolean;
  renderDisabled?: boolean;
  onTemplateChange?: (key: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (saved: CardCopyResponse) => void;
  onSaveAndRender?: (saved: CardCopyResponse) => Promise<unknown>;
  renderLabel?: string;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const chars = (text: string) => [...text].length;
const copyText = (copy: CardCopy) => [
  `표지\n${copy.cover.title}\n${copy.cover.subtitle}`,
  ...copy.pages.map((page, i) => `${i + 1}번째 본문\n${page.title}\n${page.subtitle}\n${page.body}`),
].join("\n\n");

/** The preview uses the same renderer as the saved images. Caption/alt text are separate. */
export function CardCopyEditor({ channelId, itemId, itemVersion, templateKey, coverMode = "reuse", disabled = false, renderDisabled = false, onTemplateChange, onDirtyChange, onSaved, onSaveAndRender, renderLabel = "카드뉴스 만들기" }: Props) {
  const path = `/channels/${channelId}/items/${itemId}/card-copy`;
  const queryKey = ["card-copy", channelId, itemId];
  const qc = useQueryClient(), guard = useDirtyGuard(), uid = useId();
  const loaded = useQuery({ queryKey, queryFn: () => api<CardCopyResponse>(path), retry: false });
  const [base, setBase] = useState<CardCopyResponse | null>(null), baseRef = useRef<CardCopyResponse | null>(null);
  const [copy, setCopy] = useState<CardCopy | null>(null), copyRef = useRef<CardCopy | null>(null);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false), [rendering, setRendering] = useState(false), [generating, setGenerating] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null), [aiError, setAiError] = useState<Error | null>(null);
  const [conflicting, setConflicting] = useState<CardCopyResponse | null>(null), [conflictLoading, setConflictLoading] = useState(false);
  const [proposal, setProposal] = useState<(Proposal & { source: string }) | null>(null);
  const [providerChoice, setProviderChoice] = useState<AiProvider | null>(null);
  const status = useQuery({ queryKey: ["studio-ai-status"], queryFn: () => api<AiStatus>("/studio/ai-status"), retry: false, staleTime: 30_000 });
  const provider = providerChoice ?? status.data?.defaultProvider ?? "gemini", aiReady = !!status.data?.text[provider];
  const [preview, setPreview] = useState<{ url: string; signature: string } | null>(null), previewUrl = useRef<string | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const serial = useRef<Promise<CardCopyResponse> | null>(null);
  const action = useRef<"generate" | "render" | null>(null);
  const generation = useGenerationRequest(channelId, itemId, "card-copy");
  const generationSource = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null), subtitleRef = useRef<HTMLTextAreaElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !!copy && !!base && !same(copy, base.copy);
  const valid = copy ? cardCopySchema.safeParse(copy) : null;
  const invalid = valid?.success === false;
  const busy = disabled || rendering || (generating && !generation.cancelled);
  const locked = busy || saving || conflictLoading;
  const pageIndex = Math.min(selected, copy?.pages.length ?? 0);
  const page = copy ? (pageIndex === 0 ? copy.cover : copy.pages[pageIndex - 1]) : null;
  const signature = JSON.stringify({ copy, version: base?.version, page: pageIndex, coverMode });
  const previewCurrent = preview?.signature === signature;
  const callbacks = useRef({ onSaved, onTemplateChange });
  callbacks.current = { onSaved, onTemplateChange };

  function put(next: CardCopy) { copyRef.current = next; setCopy(next); }
  function adopt(next: CardCopyResponse, preserveTemplate = false) {
    const nextCopy = preserveTemplate && templateKey ? { ...next.copy, templateKey } : next.copy;
    baseRef.current = next; setBase(next); put(nextCopy);
    setSaveError(null); setConflicting(null); setProposal(null);
    callbacks.current.onTemplateChange?.(nextCopy.templateKey);
  }
  useEffect(() => {
    const next = loaded.data;
    if (!next || (baseRef.current && next.version <= baseRef.current.version)) return;
    if (!baseRef.current || same(copyRef.current, baseRef.current.copy)) adopt(next, !baseRef.current);
    else setConflicting(next);
  }, [loaded.data]);
  useEffect(() => {
    if (itemVersion && baseRef.current && itemVersion > baseRef.current.version) void loaded.refetch();
  }, [itemVersion]);
  useEffect(() => {
    if (!templateKey || !copyRef.current || copyRef.current.templateKey === templateKey) return;
    put({ ...copyRef.current, templateKey }); setProposal(null); setSaveError(null);
  }, [templateKey, !!copy]);
  useEffect(() => { setSelected(value => Math.min(value, copy?.pages.length ?? 0)); }, [copy?.pages.length]);

  async function loadConflict() {
    setConflictLoading(true);
    try { setConflicting(await api<CardCopyResponse>(path)); }
    catch (error) { setSaveError(error as Error); }
    finally { setConflictLoading(false); }
  }
  async function saveNow(): Promise<CardCopyResponse> {
    if (serial.current) { await serial.current; return saveNow(); }
    const current = baseRef.current, snapshot = copyRef.current;
    if (!current || !snapshot) throw new Error("카드 문구를 불러온 뒤 저장해 주세요.");
    const parsed = cardCopySchema.safeParse(snapshot);
    if (!parsed.success) throw new Error("제목·부제·본문의 입력 안내를 확인해 주세요.");
    if (current.hasSavedCopy && same(snapshot, current.copy)) return current;
    setSaving(true); setSaveError(null);
    const request = api<CardCopyResponse>(path, { method: "PATCH", body: { version: current.version, copy: snapshot } });
    serial.current = request;
    try {
      const saved = await request;
      baseRef.current = saved; setBase(saved);
      if (same(copyRef.current, snapshot)) put(saved.copy);
      setConflicting(null); setProposal(null);
      qc.setQueryData(queryKey, saved);
      void qc.invalidateQueries({ queryKey: ["ch", channelId, "item", itemId] });
      void qc.invalidateQueries({ queryKey: ["studio"] });
      callbacks.current.onSaved?.(saved);
      return saved;
    } catch (error) {
      setSaveError(error as Error);
      if (error instanceof ApiError && error.status === 409) await loadConflict();
      throw error;
    } finally { serial.current = null; setSaving(false); }
  }
  const saveRef = useRef(saveNow); saveRef.current = saveNow;
  useEffect(() => {
    const key = `card-copy-${channelId}-${itemId}`;
    guard.setDirty(key, dirty || saving || rendering || (generating && !generation.cancelled), async () => {
      if (rendering || (generating && !generation.cancelled) || conflicting) return false;
      try { await saveRef.current(); return same(copyRef.current, baseRef.current?.copy); } catch { return false; }
    });
    return () => guard.setDirty(key, false);
  }, [channelId, itemId, dirty, saving, rendering, generating, generation.cancelled, conflicting, guard]);
  useEffect(() => { onDirtyChange?.(dirty || locked || !base || invalid || !!conflicting); }, [dirty, locked, base, invalid, conflicting, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!copy || !base || invalid) { setPreviewBusy(false); return; }
    const controller = new AbortController(); let live = true;
    setPreviewBusy(true); setPreviewError(null);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await apiBlob(`${path}/preview`, "image/jpeg", { method: "POST", body: { version: base.version, copy, page: pageIndex, coverMode }, signal: controller.signal });
        if (!live) return;
        const url = URL.createObjectURL(blob);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url; setPreview({ url, signature });
      } catch (error) { if (live && !controller.signal.aborted) setPreviewError(error as Error); }
      finally { if (live) setPreviewBusy(false); }
    }, 450);
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [signature, invalid, previewRetry]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function saveAndRender() {
    if (!onSaveAndRender || renderDisabled || locked || conflicting || action.current) return;
    action.current = "render";
    setRendering(true); setSaveError(null);
    try { const saved = await saveNow(); await onSaveAndRender(saved); }
    catch (error) { setSaveError(error as Error); }
    finally { action.current = null; setRendering(false); }
  }
  async function generate() {
    if ((!aiReady && !generation.unresolved) || locked || conflicting || action.current) return;
    action.current = "generate";
    setGenerating(true); setAiError(null); setProposal(null);
    try {
      const recovering = generation.unresolved;
      const saved = recovering ? baseRef.current! : await saveNow();
      if (!recovering) generationSource.current = JSON.stringify(saved.copy);
      const next = await generation.run<Proposal>(`${path}/generate`, { version: saved.version, templateKey: saved.copy.templateKey, provider });
      // The same server version proves the saved baseline on a restored tab;
      // unsaved local changes still fail canApplyProposal's snapshot comparison.
      setProposal({ ...next, source: generationSource.current ?? (next.version === saved.version ? JSON.stringify(saved.copy) : "") });
    } catch (error) { setAiError(error as Error); }
    finally { action.current = null; setGenerating(false); }
  }
  function update(field: "title" | "subtitle" | "body", value: string) {
    const current = copyRef.current; if (!current) return;
    if (pageIndex === 0 && field !== "body") put({ ...current, cover: { ...current.cover, [field]: value } });
    else if (pageIndex > 0) put({ ...current, pages: current.pages.map((p, i) => i === pageIndex - 1 ? { ...p, [field]: value } : p) });
    setSaveError(null);
  }
  function issue(field: "title" | "subtitle" | "body") {
    if (!valid || valid.success) return undefined;
    const key = pageIndex === 0 ? `cover.${field}` : `pages.${pageIndex - 1}.${field}`;
    return valid.error.issues.find(error => error.path.join(".") === key)?.message;
  }
  function focus(field: "title" | "subtitle" | "body") {
    const node = field === "title" ? titleRef.current : field === "subtitle" ? subtitleRef.current : bodyRef.current;
    node?.focus(); node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (!base || !copy || !page) return <section className="card-copy-editor stack" aria-label="카드에 들어갈 문구">{loaded.error ? <ErrorBox error={loaded.error} retry={() => loaded.refetch()} /> : <Loading lines={4} label="카드 문구 불러오는 중" />}</section>;
  const limits = cardCopyLimits(copy.templateKey);
  const bodyText = pageIndex > 0 ? copy.pages[pageIndex - 1].body : null;
  const canApplyProposal = !!proposal && proposal.version === base.version && proposal.source === JSON.stringify(copy);
  return <section className="card-copy-editor stack" aria-labelledby={`${uid}-heading`}>
    <div className="card-copy-heading"><div><h3 id={`${uid}-heading`}>문구·미리보기</h3><p className="small muted">카드를 선택해서 글을 고치세요. 게시물 캡션과 별도로 저장합니다.</p></div><span className={`badge ${dirty ? "warn" : "ok"}`} role="status">{saving ? "문구 저장 중…" : dirty ? "저장하지 않은 수정" : base.hasSavedCopy ? "문구 저장됨" : "원고에서 가져온 문구"}</span></div>
    {base.recoveryNotice && <p className="notice warn small" role="status">{base.recoveryNotice} 문구를 저장하기 전까지 기존 저장 내용은 바뀌지 않습니다.</p>}
    <details className="card-copy-ai-tools"><summary>AI로 문구 다듬기</summary><div className="card-copy-ai"><label className="field">문구 작성 AI<select value={provider} disabled={locked || generation.unresolved} onChange={event => setProviderChoice(event.target.value as AiProvider)}>{aiProviders.map(p => <option key={p} value={p}>{aiProviderLabels[p]}{status.data && !status.data.text[p] ? " · 연결 필요" : ""}</option>)}</select></label><div><button className="btn" disabled={generating || locked || (!aiReady && !generation.unresolved) || invalid || !!conflicting} onClick={() => void generate()}>{generating ? "템플릿에 맞춰 작성 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : dirty || !base.hasSavedCopy ? "문구 저장 후 AI 제안받기" : "AI로 템플릿 문구 제안받기"}</button><p className="hint">선택한 템플릿에 맞는 제목·부제·본문을 제안합니다. 확인 후 적용하며, 선택한 AI의 API 요금·한도가 적용됩니다.</p></div></div>
    {status.error && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    {status.data && !aiReady && <p className="small muted">직접 입력·저장은 바로 사용할 수 있어요. AI 작성은 <GuardedLink href={`/connections?service=${provider}`}>AI 연결 설정</GuardedLink> 후 사용할 수 있습니다.</p>}
    {aiError && <ErrorBox error={aiError} retry={() => void generate()} />}
    {generation.unresolved && <div className="stack"><p className="small muted">기존 요청의 결과를 확인합니다. 응답이 없어도 새 유료 작업을 자동으로 시작하지 않습니다.</p><div><button className="btn sm" disabled={generation.cancelling} onClick={() => void generation.cancel()}>{generation.cancelling ? "중단 확인 중…" : "AI 요청 중단"}</button></div></div>}
    {generation.cancelled && <p className="notice small" role="status">AI 요청을 중단했습니다. 직접 편집·저장을 계속할 수 있습니다.</p>}
    {generation.cancelError && <ErrorBox error={generation.cancelError} />}
    {proposal && <div className="notice card-copy-proposal stack"><strong>AI 문구 제안 · 아직 카드에 반영하지 않았어요</strong><details open><summary>{proposal.copy.pages.length + 1}장 제안 전체 보기</summary><pre>{copyText(proposal.copy)}</pre></details><div className="row"><button className="btn primary sm" disabled={locked || !canApplyProposal} onClick={() => { put(proposal.copy); setProposal(null); setSelected(0); }}>제안 문구로 바꾸기</button><button className="btn ghost sm" onClick={() => setProposal(null)}>제안 닫기</button></div>{!canApplyProposal && <p className="small">제안 이후 문구나 저장 버전이 바뀌었습니다. 현재 입력은 유지되며 새 제안을 받아 적용할 수 있어요.</p>}</div>}
    </details>
    {conflicting && <div className="notice warn stack" role="alert"><strong>다른 곳에서 먼저 저장한 내용이 있어요. 입력한 문구는 유지했습니다.</strong><details><summary>최신 저장본과 현재 입력 비교하기</summary><div className="card-copy-compare"><div><h4>최신 저장본</h4><pre>{copyText(conflicting.copy)}</pre></div><div><h4>현재 입력</h4><pre>{copyText(copy)}</pre></div></div><div className="row"><button className="btn sm" disabled={locked} onClick={() => adopt(conflicting)}>최신 저장본으로 바꾸기</button><button className="btn sm" disabled={locked || invalid} onClick={() => { const latest = conflicting; baseRef.current = latest; setBase(latest); setConflicting(null); void saveNow().catch(() => {}); }}>현재 입력으로 최신 버전에 저장</button></div></details></div>}
    <nav className="card-copy-pages" aria-label="문구를 편집할 페이지"><button className="btn sm" disabled={pageIndex === 0} onClick={() => setSelected(pageIndex - 1)}>← 이전</button><div className="card-copy-dots" role="group" aria-label="페이지 선택">{[copy.cover, ...copy.pages].map((p, i) => <button key={i === 0 ? "cover" : copy.pages[i - 1].id} aria-label={i === 0 ? "표지 문구 편집" : `${i}번째 본문 문구 편집 · ${p.title}`} aria-current={i === pageIndex ? "step" : undefined} onClick={() => setSelected(i)}><span aria-hidden="true">{i <= pageIndex ? "●" : "○"}</span></button>)}</div><button className="btn sm" disabled={pageIndex === copy.pages.length} onClick={() => setSelected(pageIndex + 1)}>다음 →</button></nav>
    <div className="card-copy-workspace">
      <div className="card-copy-preview-column"><div className="row between small"><strong>{pageIndex === 0 ? "표지" : `${pageIndex}번째 본문`}</strong><span className="muted">전체 {copy.pages.length + 1}장</span></div><figure className={`card-copy-preview ${previewCurrent ? "" : "is-stale"}`} aria-busy={previewBusy}>{preview && <img src={preview.url} alt={`${pageIndex === 0 ? "표지" : `${pageIndex}번째 본문`} 실제 렌더링 미리보기${previewCurrent ? "" : " · 수정 반영 전"}`} onError={() => setPreviewError(new Error("미리보기 이미지를 불러오지 못했습니다."))} />}{!preview && <div className="card-copy-placeholder">제목·부제·본문을 카드에 배치하고 있어요.</div>}{(previewBusy || !previewCurrent) && <figcaption role="status">{previewBusy ? "수정 내용 반영 중…" : invalid ? "입력 안내를 확인해 주세요" : previewError ? "수정 내용 반영 전" : "미리보기 준비 중…"}</figcaption>}</figure>{coverMode === "ai" && <p className="hint">새 AI 표지 그림은 ‘카드뉴스 만들기’를 누를 때 생성됩니다. 미리보기는 저장된 그림을 사용합니다.</p>}{previewError && <ErrorBox error={previewError} retry={() => setPreviewRetry(value => value + 1)} />}</div>
      <div className="card-copy-fields">
        <label className="field" htmlFor={`${uid}-title`}><span className="row between"><strong>{pageIndex === 0 ? "표지 제목" : "본문 제목"}</strong><span className="hint">{chars(page.title)}자 · {pageIndex === 0 ? limits.recommended.coverTitle : limits.recommended.title}자 권장</span></span><textarea ref={titleRef} id={`${uid}-title`} rows={2} value={page.title} disabled={busy} aria-invalid={!!issue("title")} aria-describedby={`${uid}-title-help`} onChange={event => update("title", event.target.value)} /><span id={`${uid}-title-help`} className={issue("title") ? "card-copy-error" : "hint"}>{issue("title") ?? `카드에서 가장 크게 보이는 제목입니다. 최대 ${pageIndex === 0 ? limits.max.coverTitle : limits.max.title}자까지 입력할 수 있어요.`}</span></label>
        <label className="field" htmlFor={`${uid}-subtitle`}><span className="row between"><strong>{pageIndex === 0 ? "표지 부제" : "본문 부제"} <span className="muted small">선택</span></strong><span className="hint">{chars(page.subtitle)}자 · {limits.recommended.subtitle}자 권장</span></span><textarea ref={subtitleRef} id={`${uid}-subtitle`} rows={2} value={page.subtitle} disabled={busy} aria-invalid={!!issue("subtitle")} aria-describedby={`${uid}-subtitle-help`} onChange={event => update("subtitle", event.target.value)} /><span id={`${uid}-subtitle-help`} className={issue("subtitle") ? "card-copy-error" : "hint"}>{issue("subtitle") ?? "제목을 보충하는 짧은 문장입니다. 비워 두면 표시하지 않습니다."}</span></label>
        {bodyText !== null && <label className="field" htmlFor={`${uid}-body`}><span className="row between"><strong>카드 본문</strong><span className="hint">{chars(bodyText)}자 · {limits.recommended.body}자 권장</span></span><textarea ref={bodyRef} id={`${uid}-body`} rows={6} value={bodyText} disabled={busy} aria-invalid={!!issue("body")} aria-describedby={`${uid}-body-help`} onChange={event => update("body", event.target.value)} /><span id={`${uid}-body-help`} className={issue("body") ? "card-copy-error" : "hint"}>{issue("body") ?? (chars(bodyText) > limits.recommended.body ? `${limits.recommended.body}자를 넘었습니다. 글자가 잘리지 않도록 미리보기와 저장 안내를 확인해 주세요. 입력한 내용은 자동으로 자르지 않습니다.` : "이미지 안에 들어가는 본문입니다. 캡션·대체텍스트와 별도로 저장합니다.")}</span></label>}
      </div>
    </div>
    {invalid && <p className="notice warn small" role="alert">제목과 본문은 비울 수 없습니다. 제목·부제·본문의 글자 수 안내를 확인한 뒤 저장해 주세요. 입력한 내용은 그대로 유지됩니다.</p>}
    {saveError && <ErrorBox error={saveError} />}
    <div className="card-copy-savebar"><p className="small muted">{dirty ? "수정 내용을 저장하고 이미지에 반영하세요." : "작성한 글은 이 카드에만 반영돼요."}</p><div className="row"><button className="btn" disabled={locked || invalid || !!conflicting || (!dirty && base.hasSavedCopy)} onClick={() => void saveNow().catch(() => {})}>{saving ? "저장 중…" : "문구 저장"}</button>{onSaveAndRender && <button className="btn primary" disabled={generating || renderDisabled || locked || invalid || !!conflicting} onClick={() => void saveAndRender()}>{rendering ? "카드뉴스 만드는 중…" : `${dirty || !base.hasSavedCopy ? "저장하고 " : ""}${renderLabel}`}</button>}</div></div>
  </section>;
}
