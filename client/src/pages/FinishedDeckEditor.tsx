import { CategorySelect } from "../CategorySelect";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StudioCard, StudioCardDetail } from "@shared/studio";
import { studioImageFileError } from "@shared/studioImageImport";
import { ALT_TEXT_LIMIT, altTextLength, altTextError } from "@shared/altText";
import { api, apiUpload } from "../api";
import { ErrorBox, GuardedLink } from "../ui";
import { useDirtyGuard } from "../state";
import { StudioQuickExport } from "./StudioExport";
import { StudioPublish } from "./StudioPublish";
import { FinishedDeckAi } from "./FinishedDeckAi";
import { AltTextInput } from "../AltTextEditor";
import "../studioPublish.css";

export function FinishedDeckEditor({ data }: { data: StudioCardDetail }) {
  const [base, setBase] = useState(data.card), [form, setForm] = useState(data.card);
  const [progress, setProgress] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const qc = useQueryClient(), guard = useDirtyGuard();
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const pages = form.finishedDeck!.pages;
  const invalidAltIndex = pages.findIndex(p => !!altTextError(p.altText, true));
  const adopt = (card: StudioCard) => { setBase(card); setForm(card); qc.invalidateQueries({ queryKey: ["studio"] }); qc.invalidateQueries({ queryKey: ["studio-publication", card.id] }); };
  useEffect(() => { if (!dirty) { setBase(data.card); setForm(data.card); } }, [data.card]);
  async function save(): Promise<StudioCard> {
    if (!dirty) return base;
    const card = await api<StudioCard>(`/studio/cards/${base.id}`, { method: "PATCH", body: { version: base.version, subcategory: form.subcategory ?? "", title: form.title, caption: form.caption, finishedDeck: form.finishedDeck, stage: form.stage } });
    adopt(card); return card;
  }
  const saving = useMutation({ mutationFn: save });
  const uploading = useMutation({ mutationFn: async (files: File[]) => {
    if (files.length + pages.length > 10) throw new Error("한 게시물에는 최대 10장까지 넣을 수 있습니다.");
    for (const f of files) { const error = studioImageFileError(f); if (error) throw new Error(`${f.name}: ${error}`); }
    let card = await save();
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    for (const [i, f] of sorted.entries()) {
      setProgress(`${i + 1} / ${sorted.length}장 저장 중 · ${f.name}`);
      card = await apiUpload<StudioCard>(`/studio/cards/${card.id}/finished-images?version=${card.version}&name=${encodeURIComponent(f.name)}&uploadId=${crypto.randomUUID()}`, f);
      adopt(card);
    }
    return card;
  }, onError: async () => {
    try { const current = await api<StudioCardDetail>(`/studio/cards/${base.id}`); adopt(current.card); } catch { /* Keep the last confirmed upload when offline. */ }
  }, onSettled: () => { setProgress(""); qc.invalidateQueries({ queryKey: ["studio"] }); } });
  const busy = saving.isPending || uploading.isPending || aiBusy;
  useEffect(() => { guard.setDirty(`finished-${base.id}`, dirty || uploading.isPending, async () => { if (uploading.isPending) return false; try { await save(); return true; } catch { return false; } }); return () => guard.setDirty(`finished-${base.id}`, false); }, [dirty, uploading.isPending, form, base]);
  const move = (index: number, direction: number) => { const next = [...pages]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setForm(f => ({ ...f, finishedDeck: { pages: next } })); };
  return <div className="finished-deck-editor stack">
    <div className="page-head"><div><GuardedLink href="/">← 제작보드</GuardedLink><h1>완성 이미지로 게시물 만들기</h1><p className="small muted">한 작업이 게시물 한 건입니다. 표지부터 마지막 장까지 파일 이름 순서로 가져옵니다.</p></div><span className="badge">{pages.length} / 10장</span></div>
    <section className="panel stack">
      <CategorySelect channel={form.channel} value={form.subcategory ?? ""} onChange={subcategory => setForm(f => ({ ...f, subcategory }))} disabled={busy} />
      <label className="field">게시물 제목<input value={form.title} maxLength={160} disabled={busy} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></label>
      <div className="finished-drop" onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!busy) uploading.mutate(Array.from(e.dataTransfer.files)); }}>
        <strong>완성 이미지 여러 장 가져오기</strong><p>PNG · JPG · WEBP / 한 장 12MB 이하</p><p className="small">5장·7장 묶음을 그대로 올리세요. 마무리 이미지는 추가한 뒤 맨 끝으로 옮기면 됩니다.</p>
        <button className="btn primary" disabled={busy || pages.length >= 10} onClick={() => file.current?.click()}>이미지 선택</button>
        <input ref={file} className="sr-only" aria-label="완성 이미지 파일" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) uploading.mutate(files); }} />
      </div>
      {progress && <p role="status">{progress}</p>}{uploading.error && <><ErrorBox error={uploading.error} /><p className="small">이미 저장한 장은 남아 있습니다. 목록을 확인하고 빠진 파일만 추가하세요.</p></>}
      {pages.length > 0 && <FinishedDeckAi card={base} dirty={dirty} save={save} disabled={saving.isPending || uploading.isPending} onBusy={setAiBusy} onApply={proposal => setForm(f => ({ ...f, caption: proposal.mode === "alt" ? f.caption : proposal.caption, finishedDeck: { pages: f.finishedDeck!.pages.map((p, i) => ({ ...p, altText: proposal.altTexts[i] })) } }))} />}
      <div className="finished-pages">{pages.map((p, i) => <article key={p.imageId} className="finished-page"><img src={`/api/studio/images/${p.imageId}`} alt={p.altText || `${i + 1}페이지: ${p.name}`} /><strong>{i + 1}장 · {i === 0 ? "표지" : i === pages.length - 1 ? "마지막 장" : "본문"}</strong><small title={p.name}>{p.name}</small><div className="row"><button className="btn sm" aria-label={`${i + 1}장 앞으로`} disabled={busy || !i} onClick={() => move(i, -1)}>←</button><button className="btn sm" aria-label={`${i + 1}장 뒤로`} disabled={busy || i === pages.length - 1} onClick={() => move(i, 1)}>→</button><button className="btn sm ghost" disabled={busy} onClick={() => setForm(f => ({ ...f, finishedDeck: { pages: pages.filter(x => x.imageId !== p.imageId) } }))}>빼기</button></div><label className="field">대체텍스트 (이미지 설명)<AltTextInput aria-label={`${i + 1}페이지 대체텍스트`} rows={3} value={p.altText} disabled={busy} placeholder="이미지의 핵심을 1~2문장으로 설명" change={value => setForm(f => ({ ...f, finishedDeck: { pages: pages.map((x, j) => j === i ? { ...x, altText: value } : x) } }))} /><span className="hint">공백 포함 {altTextLength(p.altText)} / {ALT_TEXT_LIMIT}자 · 1~2문장</span>{altTextError(p.altText,true) && <span role="alert" className="small notice warn">{altTextError(p.altText,true)}</span>}</label></article>)}</div>
      <p className="small muted">인스타용 4:5 크기에 맞추고 비율이 다른 이미지는 흰 여백으로 채웁니다. 그림과 글자는 잘리지 않습니다.</p>
      <label className="field">게시할 캡션<textarea rows={7} value={form.caption} disabled={busy} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} /><span className="hint">{[...form.caption].length} / 2,200자</span></label>
      {invalidAltIndex >= 0 && <p className="notice warn" role="alert">{invalidAltIndex + 1}페이지 대체텍스트를 1~2문장, 공백 포함 125자 이내로 수정해 주세요. 기존 문구는 자동 삭제하지 않습니다.</p>}
      <div className="row"><button className="btn" disabled={busy || invalidAltIndex >= 0 || !dirty || !form.title.trim()} onClick={() => saving.mutate()}>{saving.isPending ? "저장 중…" : dirty ? "변경 내용 저장" : "저장됨"}</button>{!dirty && pages.length > 0 && <StudioQuickExport card={base} />}</div>
      {saving.error && <ErrorBox error={saving.error} />}
    </section>
    <StudioPublish base={base} dirty={dirty} busy={busy} save={save} />
  </div>;
}



