import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import type { AiProvider } from "@shared/aiProviders";
import { api, apiBlob } from "../api";
import { ErrorBox, GuardedLink } from "../ui";

type Proposal = { caption: string; altTexts: string[]; version: number; mode: "all" | "alt" };
type AiStatus = { defaultProvider: AiProvider; text: Record<AiProvider, boolean> };
const names = { openai: "OpenAI", gemini: "Gemini", anthropic: "Claude" };
export function FinishedDeckAi({ card, disabled, dirty, save, onBusy, onApply }: { card: StudioCard; disabled: boolean; dirty: boolean; save: () => Promise<StudioCard>; onBusy: (busy: boolean) => void; onApply: (proposal: Proposal) => void }) {
  const [instruction, setInstruction] = useState("기존 초안의 말투를 살려 자연스럽게 다듬어 줘.");
  const [chosen, setChosen] = useState<AiProvider | null>(null);
  const status = useQuery({ queryKey: ["studio-ai-status"], queryFn: () => api<AiStatus>("/studio/ai-status"), retry: false, staleTime: 30_000 });
  const provider = chosen ?? status.data?.defaultProvider ?? "openai";
  const ready = !!status.data?.text[provider];
  const ai = useMutation({ retry: false, mutationFn: async (mode: "all" | "alt") => {
    const saved = await save();
    return api<Proposal>(`/studio/cards/${card.id}/imported-ai`, { method: "POST", body: { version: saved.version, provider, mode, instruction } });
  } });
  useEffect(() => { onBusy(ai.isPending); return () => onBusy(false); }, [ai.isPending, onBusy]);
  const original = useMutation({ mutationFn: async () => {
    const blob = await apiBlob(`/studio/cards/${card.id}/original.zip`, "application/zip"), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `original-${card.id}.zip`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  } });
  return <section className="stack finished-ai" aria-label="대체텍스트 자동 생성">
    <div><h3>대체텍스트</h3><p className="small muted">아래 이미지마다 직접 입력하거나, AI로 그림과 글을 읽어 설명을 만들 수 있어요. AI 제안은 확인 후 적용하고 저장하세요.</p></div>
    <div className="row"><label className="field">이미지를 읽을 AI<select value={provider} disabled={disabled || ai.isPending} onChange={e => setChosen(e.target.value as AiProvider)}>{(Object.keys(names) as AiProvider[]).map(p => <option key={p} value={p}>{names[p]}{status.data && !status.data.text[p] ? " · 연결 필요" : ""}</option>)}</select></label>
      <button type="button" className="btn primary" disabled={disabled || ai.isPending || !ready} onClick={() => ai.mutate("alt")}>{ai.isPending ? "이미지 설명 생성 중…" : "대체텍스트 자동 생성"}</button></div>
    {status.isLoading && <p className="small" role="status">AI 연결 확인 중…</p>}{status.error && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    {status.data && !ready && <p className="notice">{names[provider]} 연결이 필요합니다. 연결된 AI를 선택하거나 <GuardedLink href="/connections">API 연결 설정</GuardedLink>에서 연결하세요. 아래 대체텍스트 직접 입력·저장은 바로 사용할 수 있어요.</p>}
    {ready && <p className="small muted">선택한 {names[provider]} API를 사용합니다. 제공자 요금·사용 한도가 적용됩니다.{dirty ? " 생성 전에 현재 수정 내용을 저장합니다." : ""}</p>}
    <details><summary>캡션도 함께 다듬기</summary><div className="stack"><label className="field">원하는 말투나 수정 사항<textarea rows={2} maxLength={2000} value={instruction} disabled={disabled || ai.isPending} onChange={e => setInstruction(e.target.value)} /></label><button type="button" className="btn" disabled={disabled || ai.isPending || !ready} onClick={() => ai.mutate("all")}>캡션·대체텍스트 함께 제안받기</button></div></details>
    {ai.error && <><ErrorBox error={ai.error} /><p className="small">입력한 설명은 유지됩니다. 아래에서 직접 수정하고 저장할 수 있어요.</p></>}
    {ai.data && <div className="notice stack" role="status"><strong>{ai.data.mode === "alt" ? "대체텍스트 제안" : "캡션·대체텍스트 제안"} · 아직 반영되지 않았어요</strong>{ai.data.mode !== "alt" && <p className="zip-ai-caption">{ai.data.caption}</p>}<details open><summary>{ai.data.altTexts.length}장 대체텍스트</summary>{ai.data.altTexts.map((t, i) => <p key={i}>{i + 1}. {t}</p>)}</details><div className="row"><button type="button" className="btn" disabled={disabled || dirty || ai.isPending || ai.data.version !== card.version} onClick={() => { onApply(ai.data!); ai.reset(); }}>{ai.data.mode === "alt" ? "대체텍스트에 적용" : "캡션·대체텍스트에 적용"}</button><button type="button" className="btn ghost" disabled={ai.isPending} onClick={() => ai.reset()}>제안 닫기</button></div>{(dirty || ai.data.version !== card.version) && <p>내용이 변경됐습니다. 저장한 뒤 최신 내용으로 다시 생성하세요.</p>}</div>}
    <button type="button" className="btn" disabled={disabled || original.isPending} onClick={() => original.mutate()}>원본 이미지 ZIP 내려받기</button>{original.error && <ErrorBox error={original.error} />}
  </section>;
}
