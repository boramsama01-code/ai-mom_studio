import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { studioChatGptImagePrompt, studioImageFileError } from "@shared/studioImageImport";
import type { StudioContent } from "@shared/studio";
import { useDirtyGuard } from "../state";
import { useToast } from "../toast";

export function StudioPanelImport({ content, index, channelName, instruction, disabled, upload }: {
  content: StudioContent; index: number; channelName: string; instruction: string; disabled: boolean;
  upload: (file: File, panelIndex: number) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const guard = useDirtyGuard();
  const toast = useToast();
  const prompt = studioChatGptImagePrompt(content, index, channelName, instruction);
  const imageId = content.panels[index].imageId;
  const label = `${index + 1}컷`;
  useEffect(() => { setCopied(false); }, [prompt]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    guard.setDirty(`studio-image-${index}`, state === "saving" || state === "error" && !!file, async () => {
      toast("err", state === "saving" ? "이미지 저장이 끝날 때까지 기다려 주세요." : "이미지의 ‘다시 저장’을 누른 뒤 이동해 주세요.");
      return false;
    });
    return () => guard.setDirty(`studio-image-${index}`, false);
  }, [state, file, index, guard, toast]);
  useEffect(() => { if (showPrompt && !copied) promptField.current?.select(); }, [showPrompt]);

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); toast("ok", `${label} 프롬프트를 복사했습니다. ChatGPT에 붙여넣어 주세요.`); }
    catch { setShowPrompt(true); promptField.current?.select(); toast("err", "프롬프트를 직접 선택해 복사해 주세요."); }
  }
  async function receive(next: File) {
    if (disabled || lock.current) return;
    const problem = studioImageFileError(next);
    if (problem) { setError(problem); return; }
    lock.current = true; setFile(next); setState("saving"); setError("");
    try { await upload(next, index); setState("saved"); setFile(null); }
    catch (e) { setState("error"); setError(e instanceof Error ? e.message : "이미지 저장에 실패했습니다."); }
    finally { lock.current = false; }
  }
  function receiveFiles(files: File[]) {
    if (files.length !== 1) { setError("한 컷에 이미지 한 장씩 넣어 주세요."); return; }
    void receive(files[0]);
  }
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (disabled || lock.current) return;
    event.preventDefault();
    const files = Array.from(event.clipboardData.items).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((f): f is File => !!f);
    if (!files.length) { setError("이미지 자체를 복사해 붙여넣거나, 내려받은 파일을 선택해 주세요. 텍스트·주소는 저장하지 않습니다."); return; }
    receiveFiles(files);
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false);
    if (disabled || lock.current) return;
    receiveFiles(Array.from(event.dataTransfer.files));
  }
  return <div className="studio-manual-image">
    <div className="studio-prompt-actions"><button className="btn primary" onClick={copyPrompt}>{copied ? "✓ 프롬프트 복사됨" : "1 · 프롬프트 복사"}</button><button className="btn ghost" aria-expanded={showPrompt} onClick={() => setShowPrompt(!showPrompt)}>내용 보기</button></div>
    {showPrompt && <label className="field small">{label} ChatGPT 프롬프트<textarea ref={promptField} readOnly rows={7} value={prompt} onFocus={e => e.target.select()} /></label>}
    <div className={`studio-image-drop ${dragging ? "dragging" : ""} ${state === "error" ? "has-error" : ""}`} role="group" tabIndex={disabled ? -1 : 0} aria-label={`${label} 이미지 붙여넣기`} aria-disabled={disabled} aria-busy={state === "saving"}
      onPaste={paste} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} onClick={e => { if (!(e.target as HTMLElement).closest("button")) e.currentTarget.focus(); }}>
      {preview || imageId ? <img className="studio-import-preview" src={preview || `/api/studio/images/${imageId}`} alt={`${label} ${preview ? "저장 전" : "저장된"} 이미지 미리보기`} /> : <div className="studio-drop-empty" aria-hidden="true">＋</div>}
      <strong>{state === "saving" ? "이미지 저장 중…" : "2 · 여기를 누르고 이미지 붙여넣기"}</strong>
      <span className="small muted">Ctrl+V / ⌘V · 파일을 끌어놓아도 됩니다</span>
      <button type="button" className="btn sm" disabled={disabled || state === "saving"} onClick={() => input.current?.click()}>{imageId ? "다른 이미지 선택" : "이미지 파일 선택"}</button>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label} 이미지 파일`} disabled={disabled} onChange={e => { if (e.target.files?.length) receiveFiles(Array.from(e.target.files)); e.target.value = ""; }} />
      <span className="small muted">PNG·JPG·WEBP · 최대 12MB · 붙여넣으면 자동 저장</span>
    </div>
    <div aria-live="polite" className="small studio-import-status">{state === "saving" ? "장면·대사와 이미지를 저장하고 있습니다." : state === "saved" ? "✓ 저장 완료 · 미리보기와 내보내기에 반영했습니다." : imageId ? "저장된 이미지 · 교체 전 그림은 버전 기록에 남습니다." : "ChatGPT에서 만든 이미지를 이 컷으로 가져오세요."}</div>
    {error && <div className="notice err small" role="alert">{error}{state === "error" && file && <><p>미리보기는 아직 저장되지 않았습니다. 기존 저장 내용은 유지됩니다.</p><div className="row"><button className="btn sm" disabled={disabled} onClick={() => void receive(file)}>다시 저장</button><button className="btn sm ghost" disabled={disabled} onClick={() => { setFile(null); setState("idle"); setError(""); }}>미리보기 취소</button></div></>}</div>}
  </div>;
}
