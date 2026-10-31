import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { studioOutputDescription, type StudioCard, type StudioContent, type StudioExportCheck } from "@shared/studio";
import { api, apiBlob } from "../api";
import { ErrorBox } from "../ui";
import { useToast } from "../toast";

async function downloadCard(card: StudioCard) {
  const zip = !!card.sourceOutput || card.format === "카드뉴스";
  const extension = zip ? "zip" : "png";
  const blob = await apiBlob(card.sourceOutput ? `/channels/${card.sourceOutput.channelId}/media/${card.sourceOutput.assetId}/deck.zip` : `/studio/cards/${card.id}/export.${extension}?version=${card.version}`, zip ? "application/zip" : "image/png");
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
    <button className="btn sm" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? "만드는 중…" : card.sourceOutput ? `${card.sourceOutput.pages.length}장 ZIP 저장` : card.format === "카드뉴스" ? "6장 ZIP 저장" : "PNG 저장"}</button>
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

export function StudioExport({ form, base, dirty, busy, change, save, onFieldFocus }: {
  form: StudioContent; base: StudioCard; dirty: boolean; busy: boolean;
  change: <K extends keyof StudioContent>(key: K, value: StudioContent[K]) => void;
  save: () => Promise<StudioCard>;
  onFieldFocus?: (field: string) => void;
}) {
  const [checkedInput, setCheckedInput] = useState(form);
  const [preview, setPreview] = useState<{ version: number; format: string } | null>(null);
  const [page, setPage] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const toast = useToast();
  const pendingCheck = JSON.stringify(form) !== JSON.stringify(checkedInput);
  useEffect(() => { const timer = window.setTimeout(() => setCheckedInput(form), 450); return () => window.clearTimeout(timer); }, [form]);
  const check = useQuery({ queryKey: ["studio-export-check", checkedInput], queryFn: () => api<StudioExportCheck>("/studio/export-check", { method: "POST", body: checkedInput }), retry: false, staleTime: 60_000 });
  const blocked = pendingCheck || check.isFetching || !check.data || check.data.errors.length > 0;
  const prepare = useMutation({ mutationFn: async (download: boolean) => {
    const saved = await save();
    if (download) await downloadCard(saved);
    return saved;
  }, onSuccess: saved => { setPreview({ version: saved.version, format: saved.format }); setPage(0); setPreviewError(false); }, onError: error => toast("err", error.message) });
  const stalePreview = dirty || preview?.version !== base.version || preview?.format !== form.format;
  const focusField = (field: string) => { onFieldFocus?.(field); window.requestAnimationFrame(() => document.getElementById(`studio-${field}`)?.focus()); };
  return <section className="panel stack studio-export" aria-labelledby="studio-export-heading">
    <div><h2 id="studio-export-heading">최종 이미지</h2><p className="small muted">{studioOutputDescription(form.format)}</p></div>
    <div className="studio-export-designs" role="group" aria-label="출력 디자인">
      {designs.map(design => <button key={design.id} type="button" className={`studio-design-option design-${design.id}`} aria-pressed={form.exportDesign === design.id} disabled={busy || prepare.isPending} onClick={() => change("exportDesign", design.id)}><span className="studio-design-swatch" aria-hidden="true"><i /><i /><i /></span><strong>{design.name}</strong><small>{design.detail}</small></button>)}
    </div>
    <label className="field">출처 표기<input id="studio-sourceLabel" disabled={busy || prepare.isPending} maxLength={180} value={form.sourceLabel} onChange={event => change("sourceLabel", event.target.value)} placeholder="예: ○○대학교 입학처 · 2026.10.23 확인" /><span className="hint">이미지 하단에 표시됩니다.</span></label>
    <div className="studio-export-status" aria-live="polite">
      {pendingCheck || check.isFetching ? <p className="small muted">출력 영역 확인 중…</p> : check.error ? <ErrorBox error={check.error} retry={() => check.refetch()} /> : !!check.data?.errors.length ? <ul className="notice warn">{check.data.errors.map((error, i) => <li key={i}><button className="text-btn" onClick={() => focusField(error.field)}>{error.message}</button></li>)}</ul> : <p className="small export-ready">글이 출력 영역에 맞습니다.</p>}
      {!pendingCheck && check.data?.warnings.map(warning => <p className="small muted" key={warning}>{warning}</p>)}
    </div>
    <div className="row">
      <button className="btn" disabled={busy || prepare.isPending || blocked} onClick={() => prepare.mutate(false)}>{prepare.isPending ? "준비 중…" : dirty ? "저장하고 미리보기" : "미리보기"}</button>
      <button className="btn primary" disabled={busy || prepare.isPending || blocked} onClick={() => prepare.mutate(true)}>{prepare.isPending ? "준비 중…" : `${dirty ? "저장하고 " : ""}${form.format === "카드뉴스" ? "6장 ZIP 받기" : "PNG 받기"}`}</button>
    </div>
    {preview && <div className="studio-export-preview">
      {stalePreview ? <p className="notice">편집 내용이 바뀌었습니다. 저장하고 미리보기를 갱신하세요.</p> : <>
        {preview.format === "카드뉴스" && <div className="studio-preview-pages" role="group" aria-label="미리보기 페이지">{["표지", "1", "2", "3", "4", "마무리"].map((label, index) => <button className="btn sm" key={index} aria-pressed={page === index} onClick={() => { setPage(index); setPreviewError(false); }}>{label}</button>)}</div>}
        {previewError ? <p className="notice err" role="alert">미리보기를 불러오지 못했습니다. 최신 버전인지 확인하고 다시 눌러 주세요.</p> : <img key={`${preview.version}-${page}`} src={`/api/studio/cards/${base.id}/export.png?version=${preview.version}&page=${page}&preview=1`} alt={`${base.title} ${page + 1}페이지 출력 미리보기`} onError={() => setPreviewError(true)} />}
      </>}
    </div>}
    <p className="small studio-handoff">이미지를 내려받고 위 캡션을 복사해 SNS에 직접 게시하세요. ‘완료’는 제작 완료를 뜻합니다.</p>
  </section>;
}

