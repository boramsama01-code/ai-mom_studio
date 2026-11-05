import { useEffect, useState } from "react";
import { Icon } from "./icons";
export function ExternalDesignLink({ url, designId, disabled }: { url: string; designId: string; disabled: boolean }) {
  const key = `spacepenguin.canva-away:${designId}`;
  const [returned, setReturned] = useState(false), [copyMessage, setCopyMessage] = useState("");
  useEffect(() => {
    const check = () => { if (!document.hidden) { try { if (sessionStorage.getItem(key)) setReturned(true); } catch { /* Keep the manuscript mounted. */ } } };
    window.addEventListener("focus", check); document.addEventListener("visibilitychange", check); check();
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [key]);
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled) { event.preventDefault(); return; }
    try { sessionStorage.setItem(key, "opened"); } catch { /* The normal browser link still works. */ }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopyMessage("링크를 복사했습니다."); } catch { setCopyMessage("아래 주소를 직접 선택해 복사해 주세요."); } };
  return <div className="external-design-context"><div className="row wrap"><a className="btn" href={url} target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined} onClick={open}><Icon name="link" size={16}/>{disabled ? "원고 저장 후 Canva 열기" : "Canva에서 열기 ↗"}</a><button type="button" className="btn" onClick={copy}>편집 링크 복사</button></div><p>{disabled ? "원고와 선택 설정을 스튜디오에 저장한 뒤 이동해 주세요." : returned ? "Canva에서 돌아왔습니다. 편집 결과는 아직 가져오지 않았습니다. 최신 디자인 가져오기로 확인하세요." : "브라우저 또는 Canva 앱에서 열립니다. 스튜디오 원고와 Canva 문구는 각각 저장됩니다."}</p>{copyMessage && <p role="status">{copyMessage}</p>}{copyMessage.includes("직접") && <input aria-label="Canva 편집 주소" readOnly value={url} onFocus={event => event.currentTarget.select()}/>}</div>;
}
