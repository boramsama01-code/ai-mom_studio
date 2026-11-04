import { CategorySelect } from "../CategorySelect";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioStages, type StudioCard, type StudioCardDetail } from "@shared/studio";
import { studioImageFileError } from "@shared/studioImageImport";
import { ALT_TEXT_LIMIT, altTextLength, altTextError } from "@shared/altText";
import { api, apiUpload, ApiError } from "../api";
import { ErrorBox, GuardedLink } from "../ui";
import { useDirtyGuard } from "../state";
import { StudioQuickExport } from "./StudioExport";
import { StudioPublish } from "./StudioPublish";
import { FinishedDeckAi } from "./FinishedDeckAi";
import { AltTextInput } from "../AltTextEditor";
import { useDraftRecovery } from "../useDraftRecovery";
import { RecoveryNotice } from "../RecoveryNotice";
import "../studioPublish.css";

// A checkpoint contains editable text and references to already saved images,
// never File/Blob/base64 data or server identity/authentication fields.
const recoveryDeckSchema = z.object({
  title: z.string(), caption: z.string(), subcategory: z.string(), stage: z.enum(studioStages),
  finishedDeck: z.object({ pages: z.array(z.object({ imageId: z.number().int().positive(), name: z.string(), altText: z.string(), uploadId: z.string().uuid().optional() }).strict()).max(10)
    .refine(pages => new Set(pages.map(page => page.imageId)).size === pages.length) }).strict(),
}).strict();
type DeckDraft = z.infer<typeof recoveryDeckSchema>;
const inputOf = (card: StudioCard): DeckDraft => ({ title: card.title, caption: card.caption, subcategory: card.subcategory ?? "", stage: card.stage, finishedDeck: card.finishedDeck ?? { pages: [] } });
const parseRecoveryDeck = (value: unknown): DeckDraft | null => { const parsed = recoveryDeckSchema.safeParse(value); return parsed.success ? parsed.data : null; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const deckText = (value: DeckDraft) => [`제목\n${value.title}`, `게시물 캡션\n${value.caption}`, `분류: ${value.subcategory || "없음"} · 단계: ${value.stage}`,
  ...value.finishedDeck.pages.map((page, index) => `${index + 1}장 · 저장 이미지 #${page.imageId} · ${page.name}\n대체텍스트: ${page.altText}`)].join("\n\n");

export function FinishedDeckEditor({ data }: { data: StudioCardDetail }) {
  const [base, setBase] = useState(data.card), baseRef = useRef(data.card);
  // Keep the editing origin separate from a newer, unaccepted conflict. A
  // reopened checkpoint must still require comparing against that newer version.
  const [recoveryBase, setRecoveryBase] = useState(data.card);
  const [form, setForm] = useState(() => inputOf(data.card)), formRef = useRef(form);
  const serial = useRef<Promise<StudioCard> | null>(null);
  const [savePending, setSavePending] = useState(false), [saveError, setSaveError] = useState<Error | null>(null);
  const [conflicting, setConflicting] = useState<StudioCard | null>(null), conflictRef = useRef<StudioCard | null>(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const qc = useQueryClient(), guard = useDirtyGuard();
  const file = useRef<HTMLInputElement>(null);
  const dirty = !same(form, inputOf(base));
  const pages = form.finishedDeck.pages;
  const invalidAltIndex = pages.findIndex(p => !!altTextError(p.altText, true));
  const put = (next: DeckDraft) => { formRef.current = next; setForm(next); };
  const update = (change: (current: DeckDraft) => DeckDraft) => put(change(formRef.current));
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["studio-publication", baseRef.current.id] }); };
  function clearConflict() { conflictRef.current = null; setConflicting(null); setSaveError(null); }
  function noteConflict(card: StudioCard, message = "다른 곳에서 저장한 최신 버전이 있습니다. 입력을 유지했으니 비교한 뒤 선택해 주세요.") {
    const latest = card.version >= baseRef.current.version ? card : baseRef.current;
    baseRef.current = latest; setBase(latest); conflictRef.current = latest; setConflicting(latest);
    const error = new ApiError(409, message, { current: latest }); setSaveError(error); return error;
  }
  function adopt(card: StudioCard) {
    if (card.version < baseRef.current.version) return;
    baseRef.current = card; setBase(card); setRecoveryBase(card); put(inputOf(card)); clearConflict();
  }
  const recovery = useDraftRecovery<DeckDraft>({ recoveryKey: `studio:${base.id}:finished-deck`, label: "완성 이미지 게시물", version: recoveryBase.version,
    serverValue: inputOf(recoveryBase), value: form, dirty: !same(form, inputOf(recoveryBase)), parse: parseRecoveryDeck, onRestore: put });
  function acceptSaved(card: StudioCard, snapshot: DeckDraft) {
    if (card.version < baseRef.current.version) throw noteConflict(baseRef.current, "저장 요청 뒤 더 최신 버전이 도착했습니다. 현재 입력과 최신 저장본을 비교해 주세요.");
    baseRef.current = card; setBase(card); setRecoveryBase(card);
    if (same(formRef.current, snapshot)) { recovery.clear(); put(inputOf(card)); }
    clearConflict(); invalidate();
    return card;
  }
  useEffect(() => {
    if (data.card.version <= baseRef.current.version) return;
    if (serial.current || !same(formRef.current, inputOf(baseRef.current))) noteConflict(data.card);
    else adopt(data.card);
  }, [data.card]);
  async function save(): Promise<StudioCard> {
    if (recovery.pending) throw new Error("기기 복구본을 먼저 불러오거나 버려 주세요.");
    if (serial.current) { await serial.current; return save(); }
    if (conflictRef.current) throw noteConflict(conflictRef.current);
    const current = baseRef.current, snapshot = formRef.current;
    if (same(snapshot, inputOf(current))) return current;
    if (!snapshot.title.trim()) throw new Error("게시물 제목을 입력해 주세요.");
    const invalid = snapshot.finishedDeck.pages.findIndex(page => !!altTextError(page.altText, true));
    if (invalid >= 0) throw new Error(`${invalid + 1}페이지 대체텍스트의 길이와 문장을 확인해 주세요.`);
    setSavePending(true); setSaveError(null);
    const request = api<StudioCard>(`/studio/cards/${current.id}`, { method: "PATCH", body: { version: current.version, ...snapshot } }); serial.current = request;
    try { return acceptSaved(await request, snapshot); }
    catch (error) {
      setSaveError(error as Error);
      if (error instanceof ApiError && error.status === 409 && error.body.current) noteConflict(error.body.current as StudioCard);
      throw error;
    } finally { serial.current = null; setSavePending(false); }
  }
  const saving = useMutation({ mutationFn: save });
  const uploading = useMutation({ mutationFn: async (files: File[]) => {
    if (files.length + formRef.current.finishedDeck.pages.length > 10) throw new Error("한 게시물에는 최대 10장까지 넣을 수 있습니다.");
    for (const f of files) { const error = studioImageFileError(f); if (error) throw new Error(`${f.name}: ${error}`); }
    let card = await save();
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    for (const [i, f] of sorted.entries()) {
      setProgress(`${i + 1} / ${sorted.length}장 저장 중 · ${f.name}`);
      const snapshot = formRef.current;
      card = await apiUpload<StudioCard>(`/studio/cards/${card.id}/finished-images?version=${card.version}&name=${encodeURIComponent(f.name)}&uploadId=${crypto.randomUUID()}`, f);
      acceptSaved(card, snapshot);
    }
    return card;
  }, onError: async () => {
    try {
      const current = await api<StudioCardDetail>(`/studio/cards/${baseRef.current.id}`);
      if (current.card.version < baseRef.current.version) return;
      if (same(formRef.current, inputOf(baseRef.current))) adopt(current.card);
      else if (current.card.version > baseRef.current.version) noteConflict(current.card);
    } catch { /* Keep the draft and last confirmed upload when offline. */ }
  }, onSettled: () => { setProgress(""); qc.invalidateQueries({ queryKey: ["studio"] }); } });
  const ownBusy = savePending || saving.isPending || uploading.isPending || aiBusy || !!recovery.pending;
  const busy = ownBusy || publicationBusy;
  useEffect(() => {
    const key = `finished-${base.id}`;
    guard.setDirty(key, dirty || !!recovery.pending || savePending || uploading.isPending || aiBusy || publicationBusy, async () => {
      if (uploading.isPending || aiBusy || publicationBusy || recovery.pending || conflictRef.current) return false;
      try { await save(); return same(formRef.current, inputOf(baseRef.current)); } catch { return false; }
    }, () => { recovery.clear(); setRecoveryBase(baseRef.current); put(inputOf(baseRef.current)); clearConflict(); });
    return () => guard.setDirty(key, false);
  }, [dirty, recovery.pending, savePending, uploading.isPending, aiBusy, publicationBusy, form, base, guard]);
  const move = (index: number, direction: number) => { const next = [...formRef.current.finishedDeck.pages], to = index + direction; if (to < 0 || to >= next.length) return; [next[index], next[to]] = [next[to], next[index]]; update(f => ({ ...f, finishedDeck: { pages: next } })); };
  return <div className="finished-deck-editor stack">
    <div className="page-head"><div><GuardedLink href="/">← 제작보드</GuardedLink><h1>완성 이미지로 게시물 만들기</h1><p className="small muted">한 작업이 게시물 한 건입니다. 표지부터 마지막 장까지 파일 이름 순서로 가져옵니다.</p></div><span className="badge">{pages.length} / 10장</span></div>
    <RecoveryNotice recovery={recovery} formatValue={deckText} />
    {conflicting && <section className="notice warn stack" aria-label="완성 이미지 저장 충돌">
      <strong>다른 곳에서 저장한 내용이 있습니다. 현재 입력은 유지했습니다.</strong>
      <details><summary>최신 저장본과 현재 입력 비교</summary><div className="draft-recovery-compare"><div><h4>최신 저장본 · v{conflicting.version}</h4><pre>{deckText(inputOf(conflicting))}</pre></div><div><h4>현재 입력</h4><pre>{deckText(form)}</pre></div></div></details>
      <div className="row"><button className="btn sm" disabled={busy} onClick={() => { recovery.clear(); adopt(conflicting); }}>최신 저장본으로 바꾸기</button><button className="btn sm" disabled={busy || invalidAltIndex >= 0 || !form.title.trim()} onClick={() => { setRecoveryBase(baseRef.current); clearConflict(); saving.mutate(); }}>현재 입력으로 다시 저장</button></div>
    </section>}
    <section className="panel stack">
      <CategorySelect channel={base.channel} value={form.subcategory} onChange={subcategory => update(f => ({ ...f, subcategory }))} disabled={busy} />
      <label className="field">게시물 제목<input value={form.title} maxLength={160} disabled={busy} onChange={e => update(f => ({ ...f, title: e.target.value }))} /></label>
      <div className="finished-drop" onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!busy) uploading.mutate(Array.from(e.dataTransfer.files)); }}>
        <strong>완성 이미지 여러 장 가져오기</strong><p>PNG · JPG · WEBP / 한 장 12MB 이하</p><p className="small">5장·7장 묶음을 그대로 올리세요. 마무리 이미지는 추가한 뒤 맨 끝으로 옮기면 됩니다.</p>
        <button className="btn primary" disabled={busy || !!conflicting || pages.length >= 10} onClick={() => file.current?.click()}>이미지 선택</button>
        <input ref={file} className="sr-only" aria-label="완성 이미지 파일" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) uploading.mutate(files); }} />
      </div>
      {progress && <p role="status">{progress}</p>}{uploading.error && <><ErrorBox error={uploading.error} /><p className="small">이미 저장한 장은 남아 있습니다. 목록을 확인하고 빠진 파일만 추가하세요.</p></>}
      {pages.length > 0 && <FinishedDeckAi card={base} dirty={dirty} save={save} disabled={savePending || saving.isPending || uploading.isPending || publicationBusy || !!recovery.pending || !!conflicting} onBusy={setAiBusy} onApply={proposal => update(f => ({ ...f, caption: proposal.mode === "alt" ? f.caption : proposal.caption, finishedDeck: { pages: f.finishedDeck.pages.map((p, i) => ({ ...p, altText: proposal.altTexts[i] })) } }))} />}
      <div className="finished-pages">{pages.map((p, i) => <article key={p.imageId} className="finished-page"><img src={`/api/studio/images/${p.imageId}`} alt={p.altText || `${i + 1}페이지: ${p.name}`} /><strong>{i + 1}장 · {i === 0 ? "표지" : i === pages.length - 1 ? "마지막 장" : "본문"}</strong><small title={p.name}>{p.name}</small><div className="row"><button className="btn sm" aria-label={`${i + 1}장 앞으로`} disabled={busy || !i} onClick={() => move(i, -1)}>←</button><button className="btn sm" aria-label={`${i + 1}장 뒤로`} disabled={busy || i === pages.length - 1} onClick={() => move(i, 1)}>→</button><button className="btn sm ghost" disabled={busy} onClick={() => update(f => ({ ...f, finishedDeck: { pages: f.finishedDeck.pages.filter(x => x.imageId !== p.imageId) } }))}>빼기</button></div><label className="field">대체텍스트 (이미지 설명)<AltTextInput aria-label={`${i + 1}페이지 대체텍스트`} rows={3} value={p.altText} disabled={busy} placeholder="이미지의 핵심을 1~2문장으로 설명" change={value => update(f => ({ ...f, finishedDeck: { pages: f.finishedDeck.pages.map(x => x.imageId === p.imageId ? { ...x, altText: value } : x) } }))} /><span className="hint">공백 포함 {altTextLength(p.altText)} / {ALT_TEXT_LIMIT}자 · 1~2문장</span>{altTextError(p.altText,true) && <span role="alert" className="small notice warn">{altTextError(p.altText,true)}</span>}</label></article>)}</div>
      <p className="small muted">인스타용 4:5 크기에 맞추고 비율이 다른 이미지는 흰 여백으로 채웁니다. 그림과 글자는 잘리지 않습니다.</p>
      <label className="field">게시할 캡션<textarea rows={7} value={form.caption} disabled={busy} onChange={e => update(f => ({ ...f, caption: e.target.value }))} /><span className="hint">{[...form.caption].length} / 2,200자</span></label>
      {invalidAltIndex >= 0 && <p className="notice warn" role="alert">{invalidAltIndex + 1}페이지 대체텍스트를 1~2문장, 공백 포함 125자 이내로 수정해 주세요. 기존 문구는 자동 삭제하지 않습니다.</p>}
      <div className="row"><button className="btn" disabled={busy || !!conflicting || invalidAltIndex >= 0 || !dirty || !form.title.trim()} onClick={() => saving.mutate()}>{savePending || saving.isPending ? "저장 중…" : dirty ? "변경 내용 저장" : "저장됨"}</button>{!dirty && !conflicting && !recovery.pending && pages.length > 0 && <StudioQuickExport card={base} />}</div>
      {saveError && <ErrorBox error={saveError} />}
    </section>
    <StudioPublish base={base} dirty={dirty || !!conflicting || !!recovery.pending} busy={ownBusy || !!conflicting} save={save} onBusyChange={setPublicationBusy} />
  </div>;
}



