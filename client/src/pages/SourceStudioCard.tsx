import { StudioTrashButton } from "./StudioTrash";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import { studioStages, studioStageLabels } from "@shared/studio";
import { api } from "../api";
import { CardCarousel } from "../CardCarousel";
import { ErrorBox, GuardedLink } from "../ui";
import { useChannel } from "../state";

export function SourceStudioCard({ card, embedded = false }: { card: StudioCard; embedded?: boolean }) {
  const output = card.sourceOutput!;
  const { select } = useChannel();
  const qc = useQueryClient();
  const move = useMutation({ mutationFn: (stage: string) => api(`/studio/cards/${card.id}`, { method: "PATCH", body: { version: card.version, stage } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }) });
  return <div className={embedded ? "panel stack source-output-panel" : "studio source-output-detail stack"}>
    {!embedded && <GuardedLink href="/" className="studio-back">← 내 콘텐츠</GuardedLink>}
    <div className="page-head"><div><span className="studio-eyebrow">CARD NEWS · {output.pages.length} PAGES</span>{embedded ? <h2>수집 원고에서 만든 카드뉴스</h2> : <h1>{card.title}</h1>}<p className="muted small">생성한 모든 페이지가 이 작업에 자동으로 연결돼 있어요.</p></div><div className="row">{!embedded && <StudioTrashButton card={card} disabled={move.isPending} leave />}<GuardedLink className="btn" href={`/items/${output.channelId}/${output.itemId}`} onClick={() => select(output.channelId)}>원고·카드 수정 →</GuardedLink></div></div>
    {output.stale && <p className="notice warn">원고가 수정되어 이전 버전의 카드뉴스를 보고 있습니다. ‘원고·카드 수정’에서 다시 생성해 주세요.</p>}
    {!embedded && <label className="field source-output-stage">제작 단계<select value={card.stage} disabled={move.isPending} onChange={e => move.mutate(e.target.value)}>{studioStages.map(s => <option key={s} value={s}>{studioStageLabels[s]}</option>)}</select></label>}
    {move.error && <ErrorBox error={move.error} />}
    <CardCarousel key={output.assetId} channelId={output.channelId} assetId={output.assetId} pages={output.pages} credit={output.coverCredit} />
  </div>;
}
