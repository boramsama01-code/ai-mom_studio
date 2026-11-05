import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { ErrorBox, GuardedLink } from "./ui";
import { useDirtyGuard } from "./state";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { isCardPageArtworkId } from "@shared/cardPageArtworkId";
import { studioImagePrompt, type CardImagePromptView } from "@shared/studioImagePrompt";

type Background = { assetId: number; opacity?: number };
export type PageArtworkResult = { assetId: number; version: number; pageId: string; source: "ai" | "upload"; credit: string; jobId: number };
type Pending = { requestId: string; pageId: string; version: number; priorAssetId: number | null; mode: "ai" | "upload" };
type PromptDraft = { prompt: string; custom: boolean };
const promptDraftOf = (view: CardImagePromptView): PromptDraft => ({ prompt: view.prompt, custom: view.custom });
const promptChanged = (draft: PromptDraft | undefined, view: CardImagePromptView | undefined) => !!draft && (!view || draft.custom !== view.custom || draft.custom && draft.prompt !== view.prompt);
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
  const guard = useDirtyGuard(), guardKey = `card-image-prompts-${channelId}-${itemId}`;
  // Observe the parent editor's existing cache; this observer never fetches or saves a draft.
  const manuscript = useQuery<{ version: number; revisionId: number }>({ queryKey: ["card-copy", channelId, itemId], queryFn: () => api(path), enabled: false });
  const storageKey = `spacepenguin.generation:${channelId}:${itemId}:page-background`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey));
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const [availableResult, setAvailableResult] = useState<PageArtworkResult | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [promptViews, setPromptViews] = useState<Record<string, CardImagePromptView>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [promptConflicts, setPromptConflicts] = useState<Record<string, boolean>>({});
  const [promptBusy, setPromptBusy] = useState(false);
  const promptView = promptViews[pageId], promptDraft = promptDrafts[pageId];
  const mounted = useRef(true), cancelled = useRef(new Set<string>()), fileInput = useRef<HTMLInputElement>(null), inFlight = useRef(false);
  const latest = useRef(props); latest.current = props;
  const latestInputs = useRef({ instructions, promptViews, promptDrafts }); latestInputs.current = { instructions, promptViews, promptDrafts };
  const promptReads = useRef<Record<string, number>>({});
  const instructionDirty = Object.entries(instructions).some(([id, value]) => value.trim() !== (promptViews[id]?.instruction ?? ""));
  const promptDirty = Object.entries(promptDrafts).some(([id, value]) => promptChanged(value, promptViews[id]));
  const recovery = useDraftRecovery<Record<string, string>>({
    recoveryKey: `item:${channelId}:${itemId}:page-background-directions`, label: "페이지별 그림 지시", version: 0,
    value: instructions, serverValue: Object.fromEntries(Object.entries(promptViews).map(([id, view]) => [id, view.instruction])), dirty: instructionDirty, ready: true,
    parse: value => value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, text]) => isCardPageArtworkId(key) && typeof text === "string" && text.length <= 2000) ? value as Record<string, string> : null,
    onRestore: setInstructions,
  });
  const promptRecovery = useDraftRecovery<Record<string, PromptDraft>>({
    recoveryKey: `item:${channelId}:${itemId}:page-image-prompts`, label: "페이지별 이미지 프롬프트",
    version: JSON.stringify(Object.entries(promptViews).map(([id, view]) => [id, view.promptVersion]).sort()),
    value: promptDrafts, serverValue: Object.fromEntries(Object.entries(promptViews).map(([id, view]) => [id, promptDraftOf(view)])),
    dirty: promptDirty, ready: Object.keys(promptViews).length > 0,
    parse: value => value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, draft]) =>
      isCardPageArtworkId(id) && draft && typeof draft === "object" && !Array.isArray(draft) && typeof (draft as PromptDraft).prompt === "string" && (draft as PromptDraft).prompt.length <= 25000 && typeof (draft as PromptDraft).custom === "boolean") ? value as Record<string, PromptDraft> : null,
    onRestore: setPromptDrafts,
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; latest.current.onBusyChange(false); }; }, []);
  useEffect(() => { props.onBusyChange(busy || promptBusy); }, [busy, promptBusy, props.onBusyChange]);
  const guardActions = useRef({ saveAllPrompts, discardPromptEdits }); guardActions.current = { saveAllPrompts, discardPromptEdits };
  useEffect(() => {
    guard.setDirty(guardKey, promptDirty || instructionDirty || promptBusy || !!recovery.pending || !!promptRecovery.pending,
      () => guardActions.current.saveAllPrompts(), () => guardActions.current.discardPromptEdits());
    return () => guard.setDirty(guardKey, false);
  }, [guard, guardKey, promptDirty, instructionDirty, promptBusy, recovery.pending, promptRecovery.pending]);
  useEffect(() => {
    const view = latestInputs.current.promptViews[pageId];
    if (!view || busy || promptBusy || !manuscript.data || view.itemVersion === manuscript.data.version && view.revisionId === manuscript.data.revisionId) return;
    void refreshPrompt(pageId).catch(e => { if (mounted.current) setError(e as Error); });
  }, [pageId, manuscript.data?.version, manuscript.data?.revisionId, busy, promptBusy]);
  function persist(value: Pending | null) {
    if (mounted.current) setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory ID still protects result lookup. */ }
  }
  function storePromptView(view: CardImagePromptView, replace = false) {
    const target = view.pageId, current = latestInputs.current, previous = current.promptViews[target], draft = current.promptDrafts[target];
    const edited = promptChanged(draft, previous), instructionEdited = current.instructions[target] !== undefined && current.instructions[target].trim() !== (previous?.instruction ?? "");
    // A background refresh may update history/defaults, but never rebase a local
    // edit onto another tab's prompt version without the operator reviewing it.
    const conflict = !replace && !!previous && (edited || instructionEdited) && previous.promptVersion !== view.promptVersion;
    const nextView = conflict ? { ...previous, defaultPrompt: view.defaultPrompt, lastGeneration: view.lastGeneration, stale: true } : view;
    const nextDraft = replace || !edited ? promptDraftOf(view) : draft!.custom ? draft! : { prompt: view.defaultPrompt, custom: false };
    const nextInstruction = replace || !instructionEdited ? view.instruction : current.instructions[target];
    const next = { promptViews: { ...current.promptViews, [target]: nextView }, promptDrafts: { ...current.promptDrafts, [target]: nextDraft }, instructions: { ...current.instructions, [target]: nextInstruction } };
    latestInputs.current = next;
    setPromptViews(next.promptViews); setPromptDrafts(next.promptDrafts); setInstructions(next.instructions);
    setPromptConflicts(value => ({ ...value, [target]: conflict }));
  }
  async function refreshPrompt(target: string) {
    const serial = (promptReads.current[target] ?? 0) + 1; promptReads.current[target] = serial;
    const view = await api<CardImagePromptView>(`${path}/image-prompt?pageId=${encodeURIComponent(target)}`);
    if (mounted.current && promptReads.current[target] === serial) storePromptView(view);
    return view;
  }
  async function loadPrompt() {
    if (disabled || busy || promptBusy || pending || recovery.pending || promptRecovery.pending) return;
    const target = pageId;
    setPromptBusy(true); setError(null);
    try {
      await latest.current.save();
      await refreshPrompt(target);
      if (!mounted.current) return;
      setNotice("최신 저장 원고와 이미지 생성 기록을 불러왔습니다. 직접 편집 중인 프롬프트와 추가 요청은 유지했습니다.");
    } catch (e) { if (mounted.current) setError(e as Error); }
    finally { if (mounted.current) setPromptBusy(false); }
  }
  async function persistPrompt(version: number, target = pageId) {
    if (!latestInputs.current.promptViews[target]) await refreshPrompt(target);
    const current = latestInputs.current, view = current.promptViews[target], draft = current.promptDrafts[target];
    if (!view || !draft) throw new Error("이미지 프롬프트를 불러온 뒤 다시 저장해 주세요.");
    const saved = await api<CardImagePromptView>(`${path}/image-prompt`, { method: "PUT", body: {
      version, promptVersion: view.promptVersion, pageId: target,
      prompt: draft.custom ? draft.prompt : null, instruction: current.instructions[target] ?? view.instruction,
    } });
    // Older concurrent GET responses must not replace the prompt just saved.
    promptReads.current[target] = (promptReads.current[target] ?? 0) + 1;
    if (mounted.current) storePromptView(saved, true);
    return saved;
  }
  async function savePrompt() {
    if (disabled || busy || promptBusy || pending || recovery.pending || promptRecovery.pending) return;
    setPromptBusy(true); setError(null);
    try { const saved = await latest.current.save(); await persistPrompt(saved.version); setNotice("이 페이지의 프롬프트를 저장했습니다. 다시 열어도 유지되며, 이미지 생성 버튼을 눌러야 새 그림을 요청합니다."); }
    catch (e) { if (mounted.current) setError(e as Error); }
    finally { if (mounted.current) setPromptBusy(false); }
  }
  async function saveAllPrompts() {
    if (busy || promptBusy || pending || recovery.pending || promptRecovery.pending) return false;
    setPromptBusy(true); setError(null);
    try {
      const current = latestInputs.current;
      const pages = [...new Set([...Object.keys(current.promptDrafts), ...Object.keys(current.instructions)])].filter(id =>
        promptChanged(current.promptDrafts[id], current.promptViews[id]) || (current.instructions[id] ?? "").trim() !== (current.promptViews[id]?.instruction ?? ""));
      if (pages.length) {
        const saved = await latest.current.save();
        for (const target of pages) await persistPrompt(saved.version, target);
      }
      return true;
    } catch (e) { if (mounted.current) setError(e as Error); return false; }
    finally { if (mounted.current) setPromptBusy(false); }
  }
  function discardPromptEdits() {
    recovery.clear(); promptRecovery.clear();
    const views = latestInputs.current.promptViews;
    const next = { promptViews: views, promptDrafts: Object.fromEntries(Object.entries(views).map(([id, view]) => [id, promptDraftOf(view)])), instructions: Object.fromEntries(Object.entries(views).map(([id, view]) => [id, view.instruction])) };
    latestInputs.current = next; setPromptDrafts(next.promptDrafts); setInstructions(next.instructions); setPromptConflicts({});
  }
  async function refreshGeneratedPrompt(target: string) {
    if (!latestInputs.current.promptViews[target]) return;
    try { await refreshPrompt(target); }
    catch { if (mounted.current) setNotice(value => `${value} 최근 생성 프롬프트는 ‘최신 원고·생성 기록 불러오기’로 다시 확인할 수 있습니다.`); }
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
      if (result.status === "succeeded" && result.response) { apply(result.response, pending); await refreshGeneratedPrompt(result.response.pageId); }
      else if (["failed", "cancelled"].includes(result.status)) { persist(null); throw new Error(result.error || "이 그림 요청은 종료됐습니다. 기존 그림과 문구는 유지했습니다."); }
      else setNotice("기존 그림 요청을 처리하고 있습니다. 잠시 뒤 결과를 확인하거나 요청을 중단할 수 있습니다. 새 유료 요청은 보내지 않았습니다.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) persist(null);
      setError(e as Error);
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function start(mode: "ai" | "upload", file?: File) {
    if (inFlight.current || disabled || promptBusy || pending || recovery.pending || promptRecovery.pending) return;
    inFlight.current = true;
    setBusy(true); setError(null); setNotice("");
    let request: Pending | null = null;
    try {
      if (file && (!/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) || file.size > 8 * 1024 * 1024)) throw new Error("PNG·JPG·WEBP 이미지를 8MB 이하로 선택해 주세요.");
      const saved = await latest.current.save();
      const savedPrompt = mode === "ai" && promptView && promptDraft ? await persistPrompt(saved.version) : undefined;
      request = { requestId: crypto.randomUUID(), pageId, version: saved.version, priorAssetId: background?.assetId ?? null, mode };
      const imageData = file ? await fileDataUrl(file) : undefined;
      persist(request);
      const result = await api<PageArtworkResult>(`${path}/background`, { method: "POST", body: { version: saved.version, requestId: request.requestId, pageId, mode, ...(mode === "ai" ? { ...(savedPrompt ? { instruction: savedPrompt.instruction, ...(savedPrompt.custom ? { prompt: savedPrompt.prompt } : {}) } : { ...(instructions[pageId] !== undefined ? { instruction: instructions[pageId] } : {}), ...(promptDraft?.custom ? { prompt: promptDraft.prompt } : {}) }) } : { imageData }) } });
      apply(result, request);
      await refreshGeneratedPrompt(result.pageId);
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
  const blocked = disabled || busy || promptBusy || !!pending || !!recovery.pending || !!promptRecovery.pending;
  return <details className="page-background-editor" onPaste={paste}>
    <summary>이 페이지 배경 · AI 이미지·프롬프트 · {background ? "이미지 사용 중" : "승인 전 미리 만들기"}</summary>
    <div className="stack">
      <RecoveryNotice recovery={recovery} formatValue={value => Object.entries(value).map(([id, text]) => `${id}\n${text}`).join("\n\n")} />
      <RecoveryNotice recovery={promptRecovery} formatValue={value => Object.entries(value).map(([id, draft]) => `${id} · ${draft.custom ? "직접 수정" : "기본 구성"}\n${draft.prompt}`).join("\n\n")} />
      {background && <img className="page-background-thumb" src={`/api${path}/background/${background.assetId}`} alt="선택한 페이지 배경" />}
      {showAi && <>
        <p className="hint">최종 승인 전에 그림을 만들고 확인할 수 있습니다. 아래 이미지 생성은 SNS 게시와 별도입니다.</p>
        {!promptView ? <button className="btn" disabled={blocked} onClick={() => void loadPrompt()}>{promptBusy ? "프롬프트 불러오는 중…" : "프롬프트 확인·수정"}</button> : <section className="image-prompt-fields stack" aria-label="AI 이미지 프롬프트 편집">
          <p className="hint">기사 제목·이 장의 문구·구도·색상·글자 여백을 기본으로 구성합니다. 직접 고친 프롬프트는 이 페이지에 저장합니다.</p>
          {promptView.stale && <p className="notice warn small">저장 후 원고가 바뀌었습니다. 직접 수정한 프롬프트를 보존했으니 현재 내용과 맞는지 확인해 주세요.</p>}
          {promptConflicts[pageId] && <p className="notice warn small" role="alert">다른 화면에서 프롬프트를 수정했습니다. 현재 입력을 보존했으며 새 저장본을 덮어쓰지 않습니다. <button className="btn sm" disabled={blocked} onClick={() => guard.confirmLeave(() => void loadPrompt(), [guardKey])}>저장본 다시 확인</button></p>}
          <label className="field">이미지 프롬프트<textarea aria-label="이미지 프롬프트" rows={7} maxLength={25000} value={promptDraft?.prompt ?? promptView.prompt} disabled={blocked} onChange={event => setPromptDrafts(value => ({ ...value, [pageId]: { prompt: event.target.value, custom: true } }))} /><span className="hint">{(promptDraft?.prompt ?? promptView.prompt).length.toLocaleString()} / 25,000자 · {promptDraft?.custom ? "직접 수정한 구성" : "원고에 따른 기본 구성"}</span></label>
          <div className="row"><button className="btn" disabled={blocked || !promptDraft?.prompt.trim()} onClick={() => void savePrompt()}>프롬프트만 저장</button><button className="btn ghost" disabled={blocked} onClick={() => setPromptDrafts(value => ({ ...value, [pageId]: { prompt: promptView.defaultPrompt, custom: false } }))}>기본 구성으로 되돌리기</button></div>
          <button className="btn ghost" disabled={blocked} onClick={() => void loadPrompt()}>최신 원고·생성 기록 불러오기</button>
          <p className="hint">저장된 원고 기준입니다. 문구를 수정했다면 위 버튼으로 저장·갱신할 수 있습니다. 직접 입력 중인 프롬프트는 유지합니다.</p>
          <details><summary>실제 AI 요청 전체 보기</summary><textarea aria-label="실제 AI 요청 전체" readOnly rows={8} value={studioImagePrompt({ purpose: "cover", prompt: promptDraft?.prompt ?? promptView.prompt, instruction: instructions[pageId] ?? promptView.instruction })} /><p className="hint">위의 프롬프트와 아래 추가 요청에 공통 출력 규칙을 더해 전달합니다. 이미지 속 글자·로고는 만들지 않고 카드 편집기에서 따로 배치합니다. {promptView.referenceAssetId ? "현재 선택한 배경 이미지도 참조로 전달합니다." : "참조 이미지 없이 생성합니다."}</p></details>
          {promptView.lastGeneration && <details><summary>최근 생성에 사용한 프롬프트</summary><p className="hint">이미지 #{promptView.lastGeneration.assetId} · {promptView.lastGeneration.model}</p><textarea aria-label="최근 생성 프롬프트" readOnly rows={7} value={promptView.lastGeneration.prompt} /></details>}
        </section>}
        <label className="field">이 페이지 그림 지시<textarea rows={3} maxLength={2000} value={instructions[pageId] ?? ""} disabled={blocked} placeholder="예: 두 사람이 서로 다른 기준으로 같은 로봇을 바라보는 장면. 중앙에는 글을 위한 여백." onChange={event => setInstructions(value => ({ ...value, [pageId]: event.target.value }))} /></label><button className="btn" disabled={blocked || !imageReady || !!promptDraft && !promptDraft.prompt.trim()} onClick={() => void start("ai")}>{busy ? "배경 작업 중…" : background ? "이 페이지 배경 다시 만들기 · 이미지 1장" : "이 페이지 배경 자동 만들기 · 이미지 1장"}</button><p className="hint">{imageModel ? `${imageModel} · ` : ""}선택한 페이지만 생성합니다. 기존 그림은 새 결과를 선택하고 저장할 때까지 유지합니다.</p>
      </>}
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
