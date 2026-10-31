import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { studioStageLabels, type StudioBoard, type StudioCard, type StudioTrashResult } from "@shared/studio";
import { studioKey } from "@shared/channelKeys";
import { api } from "../api";
import { Icon } from "../icons";
import { useChannel, useDirtyGuard } from "../state";
import { useToast } from "../toast";
import { ErrorBox, GuardedLink, Loading } from "../ui";

export function StudioTrashButton({ card, disabled, prepare, leave = false }: { card: StudioCard; disabled?: boolean; prepare?: () => Promise<StudioCard>; leave?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const move = useMutation({
    mutationFn: async () => {
      const current = prepare ? await prepare() : card;
      return api<StudioTrashResult>(`/studio/cards/${current.id}/trash`, { method: "POST", body: { version: current.version } });
    },
    onSuccess: result => {
      if (leave) { guard.setDirty("studio-card", false); navigate("/"); }
      void qc.invalidateQueries({ queryKey: ["studio"] });
      const message = result.cancelledJobs ? "작업을 취소하고 휴지통으로 이동했어요." : "휴지통으로 이동했어요.";
      toast("ok", message, { label: "실행 취소", onClick: async () => {
        await api(`/studio/cards/${result.card.id}/untrash`, { method: "POST", body: { version: result.card.version } });
        await qc.invalidateQueries({ queryKey: ["studio"] });
        toast("ok", "원래 작업 상태로 복원했어요.");
      } });
      if (result.alreadyProcessing) toast("info", "이미 전송 중이거나 게시된 콘텐츠는 회수되지 않아요. 게시 현황에서 확인해 주세요.");
      else if (result.cancelledDeliveries) toast("info", "연결된 예약 게시도 취소했어요. 복원 후에는 다시 승인해 주세요.");
    },
    onError: e => { toast("err", e.message); void qc.invalidateQueries({ queryKey: ["studio"] }); },
  });
  return <button className="btn sm ghost studio-trash-button" disabled={disabled || move.isPending} aria-label={`${card.title} 휴지통으로 이동`} title="작업을 취소하고 휴지통으로 이동 · 복원 가능" onClick={() => move.mutate()}><Icon name="trash" size={16} />{move.isPending ? "이동 중…" : "휴지통"}</button>;
}

function RestoreButton({ card }: { card: StudioCard }) {
  const qc = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: () => api<StudioTrashResult>(`/studio/cards/${card.id}/untrash`, { method: "POST", body: { version: card.version } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["studio"] }); toast("ok", "원래 작업 상태로 복원했어요."); },
    onError: e => { toast("err", e.message); void qc.invalidateQueries({ queryKey: ["studio"] }); },
  });
  return <button className="btn sm" aria-label={`${card.title} 복원`} disabled={restore.isPending} onClick={() => restore.mutate()}><Icon name="undo" size={16} />{restore.isPending ? "복원 중…" : "복원"}</button>;
}

export function TrashedStudioDetail({ card }: { card: StudioCard }) {
  return <div className="studio studio-trashed-detail"><GuardedLink href="/" className="studio-back">← 내 콘텐츠</GuardedLink><section className="studio-home-empty"><Icon name="trash" size={36} /><h1>{card.title}</h1><h2>휴지통에 있는 콘텐츠예요</h2><p>원고·이미지와 수정 기록은 그대로 보관하고 있어요.<br />복원하면 이어서 편집할 수 있습니다.</p><RestoreButton card={card} /><p className="small muted">취소된 생성 작업과 예약 게시는 자동으로 재개되지 않아요.</p></section></div>;
}

export function StudioTrashView({ onBack }: { onBack: () => void }) {
  const q = useQuery({ queryKey: ["studio", "trash"], queryFn: () => api<StudioBoard>("/studio/cards?trash=1") });
  const { allChannels } = useChannel();
  const [search, setSearch] = useState("");
  const cards = (q.data?.cards ?? []).filter(c => `${c.title} ${c.memo}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="studio-trash-view">
    <button className="studio-back" onClick={onBack}>← 내 콘텐츠</button>
    <header className="studio-home-heading"><div><h1>휴지통 <span className="studio-trash-count">{q.data?.cards.length ?? ""}</span></h1><p>잠시 내려놓은 이야기. 필요할 때 다시 꺼내세요.</p></div><Icon name="trash" size={28} /></header>
    <div className="studio-trash-note"><Icon name="undo" size={19} /><p>원고·이미지와 수정 기록을 보관합니다. 복원하면 원래 제작 단계로 돌아가요.<br /><span>취소된 AI 생성과 예약 게시는 다시 시작되지 않습니다.</span></p></div>
    <label className="studio-home-search"><Icon name="search" size={18} /><span className="sr-only">휴지통 검색</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="휴지통에서 검색" /></label>
    {q.isLoading ? <Loading lines={3} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : cards.length ? <div className="studio-trash-list">{cards.map(card => {
      const source = card.sourceOutput;
      const image = card.panels.find(p => p.imageId)?.imageId;
      const thumbnail = source ? `/api/channels/${source.channelId}/media/${source.assetId}` : image ? `/api/studio/images/${image}` : card.imagePath;
      return <article className="studio-trash-row" key={card.id}><div className="studio-trash-thumb">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <Icon name="design" size={24} />}</div><div className="studio-trash-copy"><h2>{card.title}</h2><p>{allChannels.find(c => studioKey(c.slug) === card.channel)?.name ?? card.channel} · {card.format} · {studioStageLabels[card.stage]}</p><time dateTime={card.trashedAt ?? undefined}>{card.trashedAt && new Date(card.trashedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" })} 이동</time></div><RestoreButton card={card} /></article>;
    })}</div> : <div className="studio-home-empty"><Icon name="trash" size={36} /><h2>{search ? "검색한 콘텐츠가 없어요" : "휴지통이 비어 있어요"}</h2><p>{search ? "다른 제목으로 검색해 보세요." : "버린 콘텐츠는 여기에 모이고, 언제든 복원할 수 있어요."}</p><button className="btn" onClick={search ? () => setSearch("") : onBack}>{search ? "검색 초기화" : "내 콘텐츠로 돌아가기"}</button></div>}
  </section>;
}
