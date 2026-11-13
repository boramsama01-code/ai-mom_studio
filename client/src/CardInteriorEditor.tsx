import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { notionInteriorTemplateCatalog, notionInteriorTemplates, type NotionInteriorTemplate } from "@shared/notionPageTemplates";
import { interiorInputSchema, isInteriorTemplateCompatible, isStructuredInterior, NotionInteriorEditor, supportsInteriorPhoto, type InteriorInput } from "./NotionInteriorEditor";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { useDirtyGuard } from "./state";
import "./notionSync.css";

const pageDraftSchema = z.object({ template: z.enum(notionInteriorTemplates), buffer: interiorInputSchema.optional() }).strict();
export const cardInteriorDraftsSchema = z.record(z.string().min(1).max(64), pageDraftSchema).refine(value => Object.keys(value).length <= 20);
export type CardInteriorDraft = z.infer<typeof pageDraftSchema>;
type InteriorDrafts = z.infer<typeof cardInteriorDraftsSchema>;

/** Unapplied table cells etc. are separate recoverable drafts, never a body rewrite. */
export function useCardInteriorDrafts(channelId: number, itemId: number, version: number, ready: boolean) {
  const [drafts, setDrafts] = useState<InteriorDrafts>({}), guard = useDirtyGuard();
  const dirty = Object.keys(drafts).length > 0;
  const recovery = useDraftRecovery<InteriorDrafts>({
    recoveryKey: `item:${channelId}:${itemId}:card-interior-inputs`, label: "내지 구성 입력", version,
    value: drafts, serverValue: {}, dirty, ready,
    parse: value => { const result = cardInteriorDraftsSchema.safeParse(value); return result.success ? result.data : null; },
    onRestore: setDrafts,
  });
  const pending = dirty || !!recovery.pending;
  useEffect(() => {
    const key = `card-interior-inputs-${channelId}-${itemId}`;
    guard.setDirty(key, pending, async () => !pending, () => { recovery.clear(); setDrafts({}); });
    return () => guard.setDirty(key, false);
  }, [guard, channelId, itemId, pending, recovery.clear]);
  return { drafts, pending, recovery, set: (pageId: string, next: CardInteriorDraft | null) => setDrafts(current => {
    const value = { ...current }; if (next) value[pageId] = next; else delete value[pageId]; return value;
  }) };
}

type Props = {
  value?: NotionInteriorTemplate; body: string; emphasis?: string; footnote?: string;
  draft?: CardInteriorDraft; disabled: boolean; limit: number;
  onDraft: (draft: CardInteriorDraft | null) => void;
  onChange: (value: { interiorTemplate?: NotionInteriorTemplate; body?: string; emphasis?: string; footnote?: string }) => void;
  rawEditor: ReactNode; independentBody?: boolean; onResetBody?: () => void; recovery?: ReturnType<typeof useCardInteriorDrafts>["recovery"];
};

/** The nine current layouts, shared by Inbox and Notion's proven structured inputs. */
export function CardInteriorEditor({ value, body, emphasis, footnote, draft, disabled, limit, onDraft, onChange, rawEditor, independentBody, onResetBody, recovery }: Props) {
  const template = draft?.template ?? value, choice = notionInteriorTemplateCatalog.find(item => item.id === template);
  const choose = (next?: NotionInteriorTemplate) => {
    if (!next && independentBody && onResetBody) { onDraft(null); onResetBody(); return; }
    if (next && isStructuredInterior(next) && !isInteriorTemplateCompatible(next, body)) {
      onDraft(draft?.template === next ? draft : { template: next });
      return;
    }
    onDraft(null); onChange({ interiorTemplate: next });
  };
  return <fieldset className="card-interior-editor stack"><legend>이 페이지 내지 구성</legend>
    {recovery && <RecoveryNotice recovery={recovery} />}
    <label className="field">내지 템플릿<select aria-label="내지 템플릿" disabled={disabled} value={template ?? "auto"} onChange={event => choose(event.target.value === "auto" ? undefined : event.target.value as NotionInteriorTemplate)}>
      <option value="auto">기존 원고 형식 유지</option>{notionInteriorTemplateCatalog.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
    </select></label>
    <p className="hint">{choice?.description ?? "저장된 원고와 페이지 역할을 그대로 배치합니다."} · 구성 선택과 직접 편집에는 AI를 사용하지 않습니다.</p>
    {draft && <p className="notice small" role="status">구성 입력은 아직 원고에 적용하지 않았습니다. 내용을 적용하거나 구성 입력을 취소한 뒤 저장해 주세요.</p>}
    {template && isStructuredInterior(template) ? <NotionInteriorEditor template={template} body={body} limit={limit} disabled={disabled} buffer={draft?.buffer}
      onBuffer={(buffer: InteriorInput | null) => onDraft(buffer ? { template, buffer } : null)}
      onApply={nextBody => onChange({ interiorTemplate: template, body: nextBody })} rawEditor={rawEditor} /> : rawEditor}
    {independentBody && onResetBody && <button className="btn sm ghost" type="button" disabled={disabled} onClick={onResetBody}>구성 본문을 원래 원고로 되돌리기</button>}
    {supportsInteriorPhoto(template) && <p className="hint">{template === "document_excerpt" ? "PDF의 필요한 부분을 PNG·JPG로 캡처해 아래 페이지 이미지에 올려 주세요. 원본 글자를 그대로 표시합니다." : "아래 페이지 이미지에서 이 콘텐츠에 사용할 사진을 올리거나 저장된 이미지를 고르세요."}</p>}
    <label className="field">형광펜 강조 문구<input aria-label="형광펜 강조 문구" value={emphasis ?? ""} maxLength={160} disabled={disabled} onChange={event => onChange({ emphasis: event.target.value || undefined })}/><span className="hint">본문에 있는 문구를 입력하면 선택한 카테고리 색으로 강조합니다.</span></label>
    <label className="field">각주<textarea aria-label="내지 각주" value={footnote ?? ""} rows={2} maxLength={1000} disabled={disabled} onChange={event => onChange({ footnote: event.target.value || undefined })}/></label>
  </fieldset>;
}
