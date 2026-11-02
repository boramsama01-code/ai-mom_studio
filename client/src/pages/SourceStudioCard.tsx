import { StudioTrashButton } from "./StudioTrash";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import { studioStages, studioStageLabels } from "@shared/studio";
import { api } from "../api";
import { CardCarousel } from "../CardCarousel";
import { CardCopyEditor, type CardCopyResponse } from "../CardCopyEditor";
import type { CardCarousel as CarouselData } from "@shared/carousel";
import { TemplatePicker, useTemplates } from "./Design";
import { ErrorBox, GuardedLink } from "../ui";
import { useChannel } from "../state";

export function SourceStudioCard({ card, embedded = false }: { card: StudioCard; embedded?: boolean }) {
  const output = card.sourceOutput!;
  const { select } = useChannel();
  const qc = useQueryClient();
  const templates = useTemplates(output.channelId);
  const [templateKey, setTemplateKey] = useState<string | null>(null), [showTemplates, setShowTemplates] = useState(false);
  const [copyDirty, setCopyDirty] = useState(true), [altDirty, setAltDirty] = useState(false), [needsRender, setNeedsRender] = useState(false);
  const render = useMutation({ mutationFn: (saved: CardCopyResponse) => api<{ id: number; carousel: CarouselData; studioCardId: number }>(`/channels/${output.channelId}/items/${output.itemId}/card`, { method: "POST", body: { version: saved.version, templateKey: saved.copy.templateKey, coverMode: "reuse" } }), onSuccess: () => { setNeedsRender(false); void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["ch", output.channelId, "item", output.itemId] }); } });
  useEffect(() => { if (render.data && output.assetId === render.data.id) render.reset(); }, [output.assetId, render.data?.id]);
  const displayed = render.data ? { ...output, assetId: render.data.id, pages: render.data.carousel.pages, coverCredit: render.data.carousel.cover.credit, stale: false } : output;
  const downloadBlocked = copyDirty || needsRender || displayed.stale;
  const move = useMutation({ mutationFn: (stage: string) => api(`/studio/cards/${card.id}`, { method: "PATCH", body: { version: card.version, stage } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }) });
  return <div className={embedded ? "panel stack source-output-panel" : "studio source-output-detail stack"}>
    {!embedded && <GuardedLink href="/" className="studio-back">← 내 콘텐츠</GuardedLink>}
    <div className="page-head"><div><span className="studio-eyebrow">CARD NEWS · {displayed.pages.length} PAGES</span>{embedded ? <h2>수집 원고에서 만든 카드뉴스</h2> : <h1>{card.title}</h1>}<p className="muted small">이 화면에서 각 페이지의 제목·부제·본문을 고치고 카드 이미지를 다시 만들 수 있어요.</p></div><div className="row">{!embedded && <StudioTrashButton card={card} disabled={move.isPending || copyDirty || altDirty} leave />}<GuardedLink className="btn" href={`/items/${output.channelId}/${output.itemId}`} onClick={() => select(output.channelId)}>원문·요약 확인 →</GuardedLink></div></div>
    {(displayed.stale || needsRender) && <p className="notice warn">저장된 문구와 완성 이미지의 버전이 다릅니다. 아래에서 문구를 확인한 뒤 ‘카드뉴스 다시 만들기’를 누르면 새 이미지에 반영됩니다.</p>}
    {!embedded && <label className="field source-output-stage">제작 단계<select value={card.stage} disabled={move.isPending || copyDirty || altDirty} onChange={e => move.mutate(e.target.value)}>{studioStages.map(s => <option key={s} value={s}>{studioStageLabels[s]}</option>)}</select></label>}
    {move.error && <ErrorBox error={move.error} />}
    <div><button className="btn" disabled={render.isPending} aria-expanded={showTemplates} onClick={() => setShowTemplates(value => !value)}>템플릿: {templates.data?.items.find(t => t.key === templateKey || t.colors?.some(color => color.key === templateKey))?.name ?? "저장된 디자인"} ▾</button><p className="hint">템플릿을 바꿔도 작성한 문구는 유지됩니다. 저장된 표지 그림을 재사용하며 이미지 AI를 자동 호출하지 않습니다.</p></div>
    {showTemplates && templates.data && <TemplatePicker cid={output.channelId} value={templateKey ?? templates.data.current} items={templates.data.items} onChange={setTemplateKey} disabled={render.isPending} />}
    <CardCopyEditor key={`${output.channelId}-${output.itemId}`} channelId={output.channelId} itemId={output.itemId} templateKey={templateKey} onTemplateChange={setTemplateKey} onDirtyChange={setCopyDirty} onSaved={() => setNeedsRender(true)} onSaveAndRender={saved => render.mutateAsync(saved)} renderLabel="카드뉴스 다시 만들기" disabled={render.isPending || altDirty || move.isPending} />
    {render.isSuccess && <p className="notice ok" role="status">수정한 문구로 {displayed.pages.length}장 카드뉴스를 다시 만들었습니다.</p>}
    {render.error && <ErrorBox error={render.error} />}
    <CardCarousel key={displayed.assetId} channelId={output.channelId} assetId={displayed.assetId} pages={displayed.pages} credit={displayed.coverCredit} onDirtyChange={setAltDirty} downloadDisabled={downloadBlocked} />
  </div>;
}
