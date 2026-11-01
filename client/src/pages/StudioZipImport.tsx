import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { readCardNewsZip, ZIP_MAX_BYTES, type ZipImportResult } from "@shared/zipImport";
import { apiUpload } from "../api";
import { ErrorBox, GuardedLink } from "../ui";

export function StudioZipImport({ channels, initialChannel, onClose }: { channels: Array<{ id: string; name: string }>; initialChannel: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), qc = useQueryClient();
  const [channel, setChannel] = useState(initialChannel), [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ posts: Array<{ title: string; count: number; caption: boolean; names: string[] }>; count: number } | null>(null);
  const [error, setError] = useState<Error | null>(null), [reading, setReading] = useState(false);
  const selection = useRef(0);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const upload = useMutation({ mutationFn: () => apiUpload<ZipImportResult>(`/studio/import-zip?channel=${encodeURIComponent(channel)}`, file!), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }) });
  async function choose(next: File | undefined) {
    const token = ++selection.current; setFile(null); setPreview(null); setError(null); upload.reset();
    if (!next) return;
    setReading(true);
    try {
      if (!/\.zip$/i.test(next.name) || next.size > ZIP_MAX_BYTES) throw new Error("100MB 이하의 ZIP 파일을 선택해 주세요.");
      const parsed = readCardNewsZip(new Uint8Array(await next.arrayBuffer()));
      if (token !== selection.current) return;
      setPreview({ count: parsed.pageCount, posts: parsed.posts.map(p => ({ title: p.title, count: p.pages.length, caption: !!p.caption, names: p.pages.map(page => page.name.split("/").at(-1)!) })) }); setFile(next);
    } catch (e) { if (token === selection.current) setError(e as Error); }
    finally { if (token === selection.current) setReading(false); }
  }
  const busy = upload.isPending || reading;
  return <dialog ref={dialog} className="studio-dialog zip-import-dialog" aria-label="완성 카드뉴스 ZIP 가져오기" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="row between"><h2>완성 카드뉴스 가져오기</h2><button className="btn ghost" aria-label="닫기" disabled={busy} onClick={onClose}>✕</button></div>
    <p className="muted">게시물별 폴더를 자동으로 나누고, 파일 번호순으로 묶어요. 함께 넣은 캡션도 가져옵니다.</p>
    {!upload.data ? <div className="stack">
      <label className="field">저장할 채널<select value={channel} disabled={busy} onChange={e => setChannel(e.target.value)}>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="zip-dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void choose(e.dataTransfer.files[0]); }}><strong>{file?.name ?? "ZIP을 끌어 놓거나 파일 선택"}</strong><span>ZIP 100MB · 게시물당 1~10장 · 최대 20건</span><input type="file" accept=".zip,application/zip,application/x-zip-compressed" disabled={busy} onChange={e => void choose(e.target.files?.[0])} /></label>
      {reading && <p role="status">폴더와 페이지 순서를 확인하고 있어요…</p>}
      {preview && <><strong>{preview.posts.length}건 · 총 {preview.count}장</strong><ol className="zip-import-posts">{preview.posts.map((p, i) => <li key={i}><div><strong>{p.title}</strong><span>{p.count}장 · {p.caption ? "캡션 포함" : "가져온 뒤 캡션 작성"}</span></div><p className="small muted">{p.names.join(" → ")}</p></li>)}</ol><p className="small muted">원본 파일은 별도로 보관합니다. 게시용 이미지는 글과 그림이 잘리지 않도록 여백을 넣어 1080 × 1350으로 맞춥니다.</p></>}
      {error && <ErrorBox error={error} />}{upload.error && <ErrorBox error={upload.error} />}
      <button className="btn primary" disabled={!preview || !file || busy || !channel} onClick={() => upload.mutate()}>{upload.isPending ? `${preview?.count}장 업로드·저장 중…` : `${preview?.posts.length ?? ""}건 검토함에 가져오기`}</button>
      <p className="small muted">가져온 뒤 이미지·캡션을 검토하고 발행할 수 있어요. 다시 올린 파일은 기존 작업으로 연결됩니다.</p>
    </div> : <div className="stack"><p className="notice ok" role="status">새 작업 {upload.data.imported}건 저장 · 기존 작업 {upload.data.skipped}건 연결 · 총 {upload.data.pageCount}장</p><div className="zip-import-results">{upload.data.cards.map(c => <GuardedLink key={c.id} href={`/studio/${c.id}`} className="btn" onClick={onClose}>{c.title} · {c.pages}장{c.trashed ? " · 휴지통에서 복원" : c.duplicate ? " · 기존 작업" : ""} →</GuardedLink>)}</div><button className="btn primary" onClick={onClose}>내 콘텐츠에서 보기</button></div>}
  </dialog>;
}
