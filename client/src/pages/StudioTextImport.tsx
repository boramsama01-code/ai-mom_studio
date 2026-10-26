import { useEffect, useRef, useState } from "react";
import type { StudioContent } from "@shared/studio";
import { applyStudioTextReply, parseStudioTextReply, STUDIO_TEXT_REPLY_LIMIT, studioChatGptTextPrompt, studioTextAdditions, type StudioTextDraft } from "@shared/studioTextImport";
import { useDirtyGuard } from "../state";
import { useToast } from "../toast";

export function StudioPromptCopy({ prompt, label, disabled = false }: { prompt: string; label: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  useEffect(() => { setCopied(false); }, [prompt]);
  useEffect(() => { if (show) field.current?.select(); }, [show]);
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); toast("ok", "프롬프트를 복사했습니다. ChatGPT에 붙여넣어 주세요."); }
    catch { setShow(true); toast("err", "아래 프롬프트를 직접 선택해 복사해 주세요."); }
  }
  return <div className="studio-prompt-copy">
    <div className="row"><button type="button" className="btn primary" disabled={disabled} onClick={copy}>{copied ? "✓ 프롬프트 복사됨" : label}</button><button type="button" className="btn ghost sm" aria-expanded={show} onClick={() => setShow(!show)}>프롬프트 보기</button></div>
    {show && <label className="field small">복사할 프롬프트<textarea ref={field} readOnly rows={6} value={prompt} onFocus={event => event.target.select()} /></label>}
  </div>;
}

export function StudioTextImport({ content, channelName, disabled, apply }: {
  content: StudioContent; channelName: string; disabled: boolean; apply: (content: StudioContent) => void;
}) {
  const [includeMemo, setIncludeMemo] = useState(false);
  const [reply, setReply] = useState("");
  const [draft, setDraft] = useState<StudioTextDraft | null>(null);
  const [error, setError] = useState("");
  const guard = useDirtyGuard();
  const toast = useToast();
  const additions = draft ? studioTextAdditions(content, draft) : [];
  useEffect(() => {
    guard.setDirty("studio-text-reply", !!reply.trim(), async () => {
      toast("err", "붙여넣은 답변을 확인해 빈칸에 반영하거나, 답변 지우기를 누른 뒤 이동해 주세요."); return false;
    });
    return () => guard.setDirty("studio-text-reply", false);
  }, [reply, guard, toast]);
  function clear() { setReply(""); setDraft(null); setError(""); }
  function review() {
    try { setDraft(parseStudioTextReply(reply)); setError(""); }
    catch (e) { setDraft(null); setError((e as Error).message); }
  }
  function accept() {
    if (disabled || !draft || !additions.length) return;
    apply(applyStudioTextReply(content, draft)); clear();
    toast("ok", "빈칸에 초안을 반영했습니다. 내용을 검토한 뒤 상단의 저장을 눌러 주세요.");
  }
  return <div className="studio-text-import stack">
    <p className="small muted">프롬프트 복사 → ChatGPT에서 초안 작성 → 답변 가져오기</p>
    {!!content.memo.trim() && <label className="studio-memo-option"><input type="checkbox" disabled={disabled} checked={includeMemo} onChange={event => setIncludeMemo(event.target.checked)} />기획·참고 자료도 프롬프트에 포함</label>}
    <StudioPromptCopy prompt={studioChatGptTextPrompt(content, channelName, includeMemo)} label="1 · 초안 프롬프트 복사" disabled={disabled || !content.title.trim()} />
    <details className="studio-more studio-text-answer" open={reply ? true : undefined}>
      <summary>2 · ChatGPT 답변 가져오기</summary>
      <div className="stack">
        <label className="field">ChatGPT 답변 붙여넣기<textarea rows={5} maxLength={STUDIO_TEXT_REPLY_LIMIT} disabled={disabled} value={reply} onChange={event => { setReply(event.target.value); setDraft(null); setError(""); }} placeholder="ChatGPT 답변의 코드 블록을 통째로 복사해서 붙여넣으세요." /></label>
        <div className="row"><button type="button" className="btn" disabled={disabled || !reply.trim()} onClick={review}>답변 확인</button>{reply && <button type="button" className="btn ghost sm" disabled={disabled} onClick={clear}>답변 지우기</button>}</div>
        {error && <p role="alert" className="notice err">{error}</p>}
        {draft && <div className="studio-text-review stack" aria-label="반영할 초안 미리보기">
          <strong>{additions.length ? `${additions.length}개 빈칸에 넣을 내용` : "채울 빈칸이 없습니다"}</strong>
          <p className="small muted">기존 글·그림·제작 단계는 유지합니다. 저장 전에는 자유롭게 수정할 수 있습니다.</p>
          {additions.length > 0 && <><dl>{additions.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.text}</dd></div>)}</dl><button type="button" className="btn primary" disabled={disabled} onClick={accept}>검토한 초안을 빈칸에 반영</button></>}
        </div>}
      </div>
    </details>
  </div>;
}
