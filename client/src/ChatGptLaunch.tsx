import { useEffect, useRef, useState } from "react";
import { CHATGPT_HOME, chatGptPromptLink } from "@shared/chatgptLink";

export function ChatGptLaunch({ prompt, label = "ChatGPT에서 초안 받기 ↗", copyLabel = "프롬프트 복사", disabled = false }: {
  prompt: string; label?: string; copyLabel?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false), [message, setMessage] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const href = chatGptPromptLink(prompt);
  const unavailable = disabled || !prompt.trim();
  useEffect(() => { setMessage(""); }, [prompt]);
  useEffect(() => { if (show) field.current?.select(); }, [show]);
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setMessage("전체 요청을 복사했습니다. ChatGPT에 붙여넣고 전송하세요."); }
    catch { setShow(true); setMessage("자동 복사가 되지 않았습니다. 아래 전체 요청을 직접 복사해 ChatGPT에 붙여넣으세요."); }
  }
  return <div className="stack">
    <div className="row">
      {unavailable ? <button type="button" className="btn primary" disabled>{label}</button>
        : <a className="btn primary" href={href ?? CHATGPT_HOME} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
          onClick={() => { if (!href) void copy(); else setMessage("ChatGPT 새 탭에서 답변을 확인하세요. 입력창에 요청만 표시되면 전송을 눌러 주세요."); }}>
          {href ? label : "전체 요청 복사하고 ChatGPT 열기 ↗"}
        </a>}
      <button type="button" className="btn sm" disabled={unavailable} onClick={() => void copy()}>{copyLabel}</button>
      <button type="button" className="btn ghost sm" aria-expanded={show} onClick={() => setShow(!show)}>프롬프트 보기</button>
    </div>
    <p className="small muted" style={{ margin: 0 }}>현재 작성 자료와 요청이 ChatGPT 새 탭으로 전달됩니다. 별도 API 결제 없이 ChatGPT 이용 한도를 사용합니다. 로그인·전송 확인이 필요할 수 있습니다.</p>
    {!href && !unavailable && <p className="notice warn small">자료가 길어 링크로 모두 전달할 수 없습니다. 전체 요청을 복사해 새로 열린 ChatGPT에 붙여넣고 전송하세요. 내용은 생략하지 않습니다.</p>}
    {show && <label className="field small">복사할 프롬프트<textarea ref={field} readOnly rows={8} value={prompt} onFocus={event => event.target.select()} /></label>}
    {message && <p className="small" role="status">{message}</p>}
  </div>;
}
