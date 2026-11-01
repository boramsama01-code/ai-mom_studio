import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import { api, apiBlob } from "../api";
import { ErrorBox } from "../ui";

export function FinishedDeckAi({ card, disabled, onBusy, onApply }: { card: StudioCard; disabled: boolean; onBusy: (busy: boolean) => void; onApply: (proposal: { caption: string; altTexts: string[] }) => void }) {
  const [instruction, setInstruction] = useState("기존 초안의 말투를 살려 자연스럽게 다듬어 줘.");
  const ai = useMutation({ retry: false, mutationFn: () => api<{ caption: string; altTexts: string[]; version: number }>(`/studio/cards/${card.id}/imported-ai`, { method: "POST", body: { version: card.version, instruction } }) });
  useEffect(() => { onBusy(ai.isPending); return () => onBusy(false); }, [ai.isPending, onBusy]);
  const original = useMutation({ mutationFn: async () => {
    const blob = await apiBlob(`/studio/cards/${card.id}/original.zip`, "application/zip"), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `original-${card.id}.zip`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  } });
  return <div className="stack"><button className="btn" disabled={disabled || original.isPending} onClick={() => original.mutate()}>원본 이미지 ZIP 내려받기</button>{original.error && <ErrorBox error={original.error} />}
    <details><summary>AI로 캡션·대체텍스트 다듬기</summary><div className="stack"><p className="small muted">저장된 이미지 전체와 동봉된 설정·초안을 읽고 제안합니다. OpenAI API 사용 비용이 발생하며, 적용 후 저장할 수 있어요.</p><label className="field">원하는 말투나 수정 사항<textarea rows={2} maxLength={2000} value={instruction} disabled={disabled || ai.isPending} onChange={e => setInstruction(e.target.value)} /></label><button className="btn" disabled={disabled || ai.isPending} onClick={() => ai.mutate()}>{ai.isPending ? "이미지를 읽고 제안 작성 중…" : "AI 제안 받기"}</button>{disabled && !ai.isPending && <p className="small">먼저 변경 내용을 저장해 주세요.</p>}{ai.error && <ErrorBox error={ai.error} />}
      {ai.data && <div className="notice stack"><strong>AI 제안 · 아직 반영되지 않았어요</strong><p className="zip-ai-caption">{ai.data.caption}</p><details><summary>{ai.data.altTexts.length}장 대체텍스트 보기</summary>{ai.data.altTexts.map((t, i) => <p key={i}>{i + 1}. {t}</p>)}</details><button className="btn" disabled={disabled || ai.isPending || ai.data.version !== card.version} onClick={() => { onApply(ai.data!); ai.reset(); }}>캡션·대체텍스트에 적용</button><button className="btn ghost" disabled={ai.isPending} onClick={() => ai.reset()}>제안 닫기</button>{ai.data.version !== card.version && <p>저장본이 변경됐습니다. 최신 내용으로 제안을 다시 받아 주세요.</p>}</div>}
    </div></details>
  </div>;
}
