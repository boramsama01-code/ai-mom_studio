import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useChannel } from "./state";
import { ErrorBox, GuardedLink, Modal } from "./ui";
import { Icon } from "./icons";
export function QuickCapture({ onClose }: { onClose: () => void }) {
  const { channels, selected } = useChannel();
  const [channel, setChannel] = useState(selected === "all" ? "" : String(selected));
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [clipboardMessage, setClipboardMessage] = useState("");
  const input = useRef<HTMLInputElement>(null), submitting = useRef(false);
  const qc = useQueryClient();
  const save = useMutation({
    retry: false,
    mutationFn: () => api<{ studioCardId: number; duplicate: boolean; bodyStatus: string }>(`/channels/${channel}/capture`, { method: "POST", body: { url: url.trim(), title: title.trim() } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["ch"] }); },
    onSettled: () => { submitting.current = false; },
  });
  const paste = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard unavailable");
      const text = await navigator.clipboard.readText();
      setUrl(text.trim()); setClipboardMessage("붙여넣었습니다. 주소와 저장 채널을 확인해 주세요.");
    } catch {
      setClipboardMessage("주소 입력칸을 길게 눌러 직접 붙여넣어 주세요.");
      input.current?.focus();
    }
  };
  return <Modal title="링크 저장" onClose={() => !save.isPending && onClose()}>
    {save.data ? <div className="capture-result stack"><span className="capture-check"><Icon name="check" size={26}/></span><h3>{save.data.duplicate ? "이미 저장한 자료를 찾았습니다" : "자료를 서버에 저장했습니다"}</h3><p className="muted">PC에서도 같은 콘텐츠를 열어 이어서 편집할 수 있습니다. 원문 확인과 본문 가져오기는 콘텐츠에서 진행하세요.</p><GuardedLink className="btn primary" href={`/studio/${save.data.studioCardId}`} onClick={onClose}>이 콘텐츠 열기 <Icon name="arrow" size={17}/></GuardedLink><button className="btn" onClick={() => { save.reset(); setUrl(""); setTitle(""); }}>다른 링크 저장</button></div> :
    <form className="stack quick-capture" onSubmit={e => { e.preventDefault(); if (submitting.current) return; submitting.current = true; save.mutate(); }}>
      <p className="muted">먼저 링크를 모아 두세요. 본문과 원고는 나중에 확인해도 됩니다.</p>
      <label className="field">저장할 채널<select aria-label="저장할 채널" required value={channel} disabled={save.isPending} onChange={e => setChannel(e.target.value)}><option value="" disabled>채널 선택</option>{channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></label>
      <label className="field">원문 URL<div className="capture-url"><input aria-label="원문 URL" ref={input} type="url" required inputMode="url" autoComplete="off" autoCapitalize="none" placeholder="https://" value={url} maxLength={2000} disabled={save.isPending} onChange={e => setUrl(e.target.value)}/><button type="button" className="btn" disabled={save.isPending} onClick={paste}>붙여넣기</button></div></label>
      {clipboardMessage && <p className="small muted" role="status">{clipboardMessage}</p>}
      <label className="field">내가 알아볼 제목 <span className="muted">(선택)</span><input value={title} maxLength={160} disabled={save.isPending} onChange={e => setTitle(e.target.value)} placeholder="나중에 찾기 쉽게 짧게 적어 주세요"/></label>
      {save.error && <ErrorBox error={save.error}/>}
      {save.error instanceof ApiError && save.error.status === 0 && <p className="small muted">같은 링크로 다시 저장해도 콘텐츠는 한 번만 만들어집니다.</p>}
      <div className="capture-footer"><span className="small muted">본문 미확인 상태로 보관</span><button className="btn primary" disabled={!channel || !url.trim() || save.isPending}>{save.isPending ? "서버에 저장 중…" : "자료 저장"}</button></div>
    </form>}
  </Modal>;
}
