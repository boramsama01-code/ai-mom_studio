import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { ErrorBox } from "./ui";
import type { SourceDocument } from "@shared/schema";
import { SOURCE_QUOTE_COUNT, SOURCE_QUOTE_LIMIT, SOURCE_TEXT_LIMIT, suggestSourceQuotes } from "@shared/sourceText";

export function SourceTextEditor({ cid, itemId, version, source, onDirtyChange }: { cid: number; itemId: number; version: number; source: SourceDocument | null; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient(), guard = useDirtyGuard();
  const initial = useMemo(() => ({ url: source?.originalUrl ?? "", text: source?.kind === "manual_text" ? source.fetchedText ?? "" : "", quotes: source?.kind === "manual_text" && Array.isArray(source.meta.quotes) ? source.meta.quotes.filter((q): q is string => typeof q === "string") : [] }), [source?.id]);
  const [form, setForm] = useState(initial), [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [baseVersion, setBaseVersion] = useState(version), [message, setMessage] = useState("");
  const [open, setOpen] = useState(!source || source.fetchStatus !== "ok");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(form) !== baseline;
  const candidates = useMemo(() => [...new Set([...suggestSourceQuotes(form.text), ...form.quotes])], [form.text, form.quotes]);
  useEffect(() => { if (!dirty) { setForm(initial); setBaseline(JSON.stringify(initial)); setBaseVersion(version); } }, [initial, version]);
  const save = useMutation({
    mutationFn: (value: typeof form) => api<{ version: number; quoteCount: number }>(`/channels/${cid}/items/${itemId}/source-text`, { method: "POST", body: { ...value, version: baseVersion } }),
    onSuccess: async (r, value) => {
      setBaseline(JSON.stringify(value)); setBaseVersion(r.version); setMessage(`본문과 근거 구절 ${r.quoteCount}개를 저장했습니다. 편집 탭에서 이어서 작성할 수 있습니다.`);
      await qc.invalidateQueries({ queryKey: ["ch", cid] });
    },
  });
  const doSave = useCallback(async () => { try { await save.mutateAsync(form); return true; } catch { return false; } }, [save.mutateAsync, form]);
  useEffect(() => { guard.setDirty(`source-text-${itemId}`, dirty, doSave); return () => guard.setDirty(`source-text-${itemId}`, false); }, [dirty, doSave, guard, itemId]);
  useEffect(() => { onDirtyChange?.(dirty || save.isPending); }, [dirty, save.isPending, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const updateText = (text: string) => { setForm(f => ({ ...f, text, quotes: suggestSourceQuotes(text) })); setMessage(""); };
  const addSelection = () => {
    const el = textarea.current;
    const quote = el ? form.text.slice(el.selectionStart, el.selectionEnd).trim() : "";
    if (!quote) return setMessage("본문에서 근거로 남길 구절을 먼저 선택해 주세요.");
    if (quote.length > SOURCE_QUOTE_LIMIT) return setMessage(`구절은 ${SOURCE_QUOTE_LIMIT}자 이내로 선택해 주세요.`);
    if (form.quotes.length >= SOURCE_QUOTE_COUNT && !form.quotes.includes(quote)) return setMessage(`근거 구절은 최대 ${SOURCE_QUOTE_COUNT}개까지 저장할 수 있습니다.`);
    setForm(f => ({ ...f, quotes: [...new Set([...f.quotes, quote])] })); setMessage("");
  };
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  return <div className="stack">
    <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{source?.kind === "manual_text" ? "저장한 본문 수정" : "본문 직접 붙여넣기"}</button>
    {open && <form className="stack" onSubmit={e => { e.preventDefault(); save.mutate(form); }}>
      <p className="small muted" style={{ margin: 0 }}>원문 링크를 열어 본문을 복사해 넣어 주세요. 저장하면 선택한 구절이 바로 표시됩니다. 본문 저장·발췌에는 AI 비용이 들지 않습니다.</p>
      <label className="field">복사한 원문의 주소<input type="url" value={form.url} required maxLength={2000} disabled={save.isPending} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://" /></label>
      <label className="field">원문 본문<textarea ref={textarea} rows={10} value={form.text} required minLength={20} maxLength={SOURCE_TEXT_LIMIT} disabled={save.isPending} onChange={e => updateText(e.target.value)} placeholder="기사나 공고의 본문을 여기에 붙여넣으세요." /><span className="hint">{form.text.length.toLocaleString()} / {SOURCE_TEXT_LIMIT.toLocaleString()}자 · 본문 수정 시 발췌 후보도 새로 선택됩니다.</span></label>
      <button type="button" className="btn sm" disabled={save.isPending} onClick={addSelection}>선택한 구절을 근거로 추가</button>
      {!!candidates.length && <fieldset className="stack" style={{ minWidth: 0 }}><legend>함께 저장할 근거 구절</legend><p className="small muted">본문에서 그대로 가져온 후보입니다. 내용에 맞는 구절을 선택하세요.</p>{candidates.map(quote => <label key={quote} className="check" style={{ alignItems: "flex-start", overflowWrap: "anywhere" }}><input type="checkbox" checked={form.quotes.includes(quote)} disabled={save.isPending || (!form.quotes.includes(quote) && form.quotes.length >= SOURCE_QUOTE_COUNT)} onChange={e => setForm(f => ({ ...f, quotes: e.target.checked ? [...f.quotes, quote] : f.quotes.filter(q => q !== quote) }))} /><span className="small">{quote}</span></label>)}</fieldset>}
      {save.error && <ErrorBox error={save.error} />}
      {conflict && <div className="notice warn small">다른 변경이 먼저 저장됐습니다. 붙여넣은 내용은 유지했습니다. <button type="button" className="btn sm" onClick={async () => {
        try { const fresh = await api<{ item: { version: number } }>(`/channels/${cid}/items/${itemId}`); setBaseVersion(fresh.item.version); setMessage("최신 상태를 확인했습니다. 입력 내용을 확인한 뒤 다시 저장하세요."); }
        catch { setMessage("최신 상태를 확인하지 못했습니다. 입력 내용은 그대로 유지됩니다."); }
      }}>최신 상태 확인</button></div>}
      {message && <p className="small" role="status">{message}</p>}
      <button className="btn primary" disabled={save.isPending || form.text.trim().length < 20}>{save.isPending ? "저장 중…" : "본문과 근거 구절 저장"}</button>
    </form>}
  </div>;
}
