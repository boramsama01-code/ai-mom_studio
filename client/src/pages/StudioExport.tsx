import { StudioPublish } from "./StudioPublish";
import "../studioPublish.css";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { studioOutputDescription, studioPageCount, type StudioCard, type StudioContent, type StudioExportCheck } from "@shared/studio";
import { cardDesignOptions } from "@shared/cardDesigns";
import { TemplatePicker } from "./Design";
import { api, apiBlob } from "../api";
import { ErrorBox } from "../ui";
import { useToast } from "../toast";
import { studioAltTextDrafts, studioAltTextDefaults } from "@shared/altText";
import { AltTextEditor } from "../AltTextEditor";
import { experienceImageUrl } from "@shared/experience";
import "../studioAutomation.css";

async function downloadCard(card: StudioCard) {
  const zip = !!card.finishedDeck || !!card.sourceOutput || card.format === "카드뉴스";
  const extension = zip ? "zip" : "png";
  const blob = await apiBlob(card.sourceOutput && !card.finishedDeck ? `/channels/${card.sourceOutput.channelId}/media/${card.sourceOutput.assetId}/deck.zip` : `/studio/cards/${card.id}/export.${extension}?version=${card.version}`, zip ? "application/zip" : "image/png");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `studio-${card.id}-v${card.version}.${extension}`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function StudioQuickExport({ card }: { card: StudioCard }) {
  const toast = useToast();
  const download = useMutation({ mutationFn: () => downloadCard(card), onError: error => toast("err", error.message) });
  if (!["웹툰", "카드뉴스"].includes(card.format)) return null;
  return <div className="studio-quick-export">
    <button className="btn sm" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? "만드는 중…" : card.sourceOutput ? `${card.sourceOutput.pages.length}장 ZIP 저장` : card.format === "카드뉴스" ? `${studioPageCount(card)}장 ZIP 저장` : "PNG 저장"}</button>
    <button className="btn sm ghost" disabled={!card.caption} onClick={async () => {
      try { await navigator.clipboard.writeText(card.caption); toast("ok", "캡션을 복사했습니다."); }
      catch { toast("err", "작업을 열어 캡션을 직접 복사해 주세요."); }
    }}>캡션 복사</button>
  </div>;
}

const designs = [
  { id: "editorial", name: "에디토리얼", detail: "따뜻한 종이색" },
  { id: "spotlight", name: "스포트라이트", detail: "채널 색상 강조" },
  { id: "minimal", name: "미니멀", detail: "여백과 본문 중심" },
] as const;

export function StudioExport({ form, base, dirty, busy: parentBusy, change, save, onFieldFocus, onPublicationBusyChange, active = true }: {
  form: StudioContent; base: StudioCard; dirty: boolean; busy: boolean;
  change: <K extends keyof StudioContent>(key: K, value: StudioContent[K]) => void;
  save: () => Promise<StudioCard>;
  onFieldFocus?: (field: string) => void;
  onPublicationBusyChange?: (busy: boolean) => void;
  active?: boolean;
}) {
  const [publicationBusy, setPublicationBusy] = useState(false);
  const reportPublicationBusy = useCallback((value: boolean) => { setPublicationBusy(value); onPublicationBusyChange?.(value); }, [onPublicationBusyChange]);
  const busy = parentBusy || publicationBusy;
  const [checkedInput, setCheckedInput] = useState(form);
  const [preview, setPreview] = useState<{ version: number; format: string } | null>(null);
  const [page, setPage] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [showCollection, setShowCollection] = useState(false);
  const toast = useToast();
  const pendingCheck = JSON.stringify(form) !== JSON.stringify(checkedInput);
  useEffect(() => { const timer = window.setTimeout(() => setCheckedInput(form), 450); return () => window.clearTimeout(timer); }, [form]);
  const check = useQuery({ queryKey: ["studio-export-check", checkedInput], queryFn: () => api<StudioExportCheck>("/studio/export-check", { method: "POST", body: checkedInput }), retry: false, staleTime: 60_000 });
  const blocked = pendingCheck || check.isFetching || !check.data || check.data.errors.length > 0;
  // A saved preview is a read, not an AI request or an implicit save of current edits.
  useEffect(() => {
    if (!active || dirty || blocked) return;
    setPreview(current => current?.version === base.version && current.format === base.format ? current : { version: base.version, format: base.format });
  }, [active, dirty, blocked, base.version, base.format]);
  useEffect(() => { setPage(current => Math.min(current, Math.max(0, studioPageCount(base) - 1))); }, [base]);
  useEffect(() => { setPreviewError(false); setPreviewLoading(!!preview); }, [preview?.version, preview?.format, page, previewRetry]);
  const prepare = useMutation({ mutationFn: async (download: boolean) => {
    const saved = await save();
    if (download) await downloadCard(saved);
    return saved;
  }, onSuccess: saved => { setPreview({ version: saved.version, format: saved.format }); setPreviewRetry(value => value + 1); setPreviewError(false); }, onError: error => toast("err", error.message) });
  const stalePreview = dirty || preview?.version !== base.version || preview?.format !== form.format;
  const previewAvailable = preview?.version === base.version && preview?.format === base.format;
  const pageLabels = base.finishedDeck ? base.finishedDeck.pages.map((_, index) => `${index + 1}페이지`) : base.experience ? ["표지", ...base.experience.pages.map((_, index) => `본문 ${index + 1}`)] : ["표지", "본문 1", "본문 2", "본문 3", "본문 4", "마무리"].slice(0, studioPageCount(base));
  const pageArt = (index: number) => {
    if (base.finishedDeck?.pages[index]) return `/api/studio/images/${base.finishedDeck.pages[index].imageId}`;
    if (base.experience) { const id = index === 0 ? base.experience.coverId : base.experience.pages[index - 1]?.mediaId; return id ? experienceImageUrl(id) : null; }
    const id = index > 0 ? base.panels[index - 1]?.imageId : null;
    return id ? `/api/studio/images/${id}` : null;
  };
  const focusField = (field: string) => { onFieldFocus?.(field); window.requestAnimationFrame(() => document.getElementById(`studio-${field}`)?.focus()); };
  return <><section className="panel stack studio-export" aria-labelledby="studio-export-heading">
    <div><h2 id="studio-export-heading">최종 이미지</h2><p className="small muted">{form.experience ? `후기 카드 ${studioPageCount(form)}장 · 1080 × 1350 PNG + 선택한 영상 원본 + 캡션` : studioOutputDescription(form.format, form.exportDesign)}</p></div>
    {!form.experience && form.format !== "카드뉴스" && <div className="studio-export-designs" role="group" aria-label="출력 디자인">
      {designs.map(design => <button key={design.id} type="button" className={`studio-design-option design-${design.id}`} aria-pressed={form.exportDesign === design.id} disabled={busy || prepare.isPending} onClick={() => change("exportDesign", design.id)}><span className="studio-design-swatch" aria-hidden="true"><i /><i /><i /></span><strong>{design.name}</strong><small>{design.detail}</small></button>)}
    </div>}
    {!form.experience && form.format === "카드뉴스" && <div className="stack">
      <button type="button" className="btn" aria-expanded={showCollection} onClick={() => setShowCollection(v => !v)}>{showCollection ? "디자인 컬렉션 접기" : "카드 디자인·컬러 둘러보기"}</button>
      {showCollection && <TemplatePicker cid="studio" studioChannel={form.channel} value={form.exportDesign} disabled={busy || prepare.isPending} onChange={key => change("exportDesign", key as StudioContent["exportDesign"])} items={cardDesignOptions()} />}
      {form.exportDesign.startsWith("set:") && <p className="small muted">사진형 표지는 첫 번째 본문의 이미지를 함께 사용합니다. 각 본문에 넣은 그림도 유지됩니다.</p>}
    </div>}
    <label className="field">출처 표기<input id="studio-sourceLabel" disabled={busy || prepare.isPending} maxLength={180} value={form.sourceLabel} onChange={event => change("sourceLabel", event.target.value)} placeholder="예: ○○대학교 입학처 · 2026.10.23 확인" /><span className="hint">이미지 하단에 표시됩니다.</span></label>
    {["카드뉴스","웹툰"].includes(form.format) && <AltTextEditor values={studioAltTextDrafts(form)} defaults={form.finishedDeck?undefined:studioAltTextDefaults(form)} selected={page} onSelect={setPage} disabled={busy||prepare.isPending} change={(index,value)=>{
      if(form.finishedDeck)change("finishedDeck",{pages:form.finishedDeck.pages.map((p,i)=>i===index?{...p,altText:value}:p)});
      else if(form.experience){const e=form.experience;change("experience",index===0?{...e,coverAltText:value}:{...e,pages:e.pages.map((p,i)=>i===index-1?{...p,altText:value}:p)});}
      else {const values=studioAltTextDrafts(form);values[index]=value;change("altTexts",values);}
    }}/>}
    {form.format === "카드뉴스" && <p className="small muted">ZIP에 페이지별 대체텍스트(alt-text.txt)를 함께 담습니다.</p>}
    <div className="studio-export-status" aria-live="polite">
      {pendingCheck || check.isFetching ? <p className="small muted">출력 영역 확인 중…</p> : check.error ? <ErrorBox error={check.error} retry={() => check.refetch()} /> : !!check.data?.errors.length ? <ul className="notice warn">{check.data.errors.map((error, i) => <li key={i}><button className="text-btn" onClick={() => focusField(error.field)}>{error.message}</button></li>)}</ul> : <p className="small export-ready">글이 출력 영역에 맞습니다.</p>}
      {!pendingCheck && check.data?.warnings.map(warning => <p className="small muted" key={warning}>{warning}</p>)}
    </div>
    <div className="row">
      <button className="btn" disabled={busy || prepare.isPending || blocked} onClick={() => prepare.mutate(false)}>{prepare.isPending ? "준비 중…" : dirty ? "저장하고 미리보기" : "미리보기"}</button>
      <button className="btn primary" disabled={busy || prepare.isPending || blocked} onClick={() => prepare.mutate(true)}>{prepare.isPending ? "준비 중…" : `${dirty ? "저장하고 " : ""}${form.format === "카드뉴스" ? `${studioPageCount(form)}장 ZIP 받기` : "PNG 받기"}`}</button>
    </div>
    {preview && <div className="studio-export-preview" aria-label="저장된 최종 이미지 미리보기">
      <p className="small"><strong>저장된 버전 {preview.version}</strong>{stalePreview ? " · 현재 입력은 아직 반영되지 않았습니다. 저장하면 미리보기가 갱신됩니다." : " · 현재 원고와 그림을 반영했습니다."}</p>
      {!previewAvailable ? <p className="notice">새 버전이 있습니다. 입력 내용을 확인하고 저장하면 최신 미리보기를 불러옵니다.</p> : <>
        {preview.format === "카드뉴스" && <div className="studio-output-pages" role="group" aria-label="미리보기 페이지">{pageLabels.map((label, index) => <button key={index} type="button" aria-label={`${index + 1}페이지 · ${label}`} aria-pressed={page === index} onClick={() => setPage(index)}>{pageArt(index) ? <img src={pageArt(index)!} alt={`${label}에 넣은 저장 그림`} loading="lazy" /> : <span className="studio-output-page-placeholder" aria-hidden="true">{index + 1}</span>}<strong>{label}</strong><span>{pageArt(index) ? "그림 포함" : "글·레이아웃"}</span></button>)}</div>}
        {preview.format === "카드뉴스" && <p className="small muted">{pageLabels[page]} · 위에서 각 본문을 선택하면 그림과 글이 합쳐진 최종 페이지를 볼 수 있습니다. 표지는 선택한 디자인에 따라 글 중심으로 표시됩니다.</p>}
        {previewError ? <div className="notice err" role="alert"><p>미리보기를 불러오지 못했습니다. 저장한 원고와 그림은 유지됩니다.</p><button type="button" className="btn sm" onClick={() => setPreviewRetry(value => value + 1)}>미리보기 다시 불러오기</button></div> : <div className="studio-output-image" aria-busy={previewLoading}>{previewLoading && <p role="status" className="small muted">페이지 이미지를 불러오는 중…</p>}<img key={`${preview.version}-${page}-${previewRetry}`} src={`/api/studio/cards/${base.id}/export.png?version=${preview.version}&page=${page}&preview=1&attempt=${previewRetry}`} alt={`${base.title} ${page + 1}페이지 출력 미리보기`} onLoad={() => setPreviewLoading(false)} onError={() => { setPreviewLoading(false); setPreviewError(true); }} /></div>}
      </>}
    </div>}
    <p className="small studio-handoff">제작 완료 후 아래에서 게시 계정과 최종 이미지를 확인하고 발행하세요.</p>
  </section>{(!base.sourceItemId || base.sourceOutput) && <StudioPublish base={base} dirty={dirty} busy={parentBusy || prepare.isPending} save={save} onBusyChange={reportPublicationBusy} />}</>;
}

