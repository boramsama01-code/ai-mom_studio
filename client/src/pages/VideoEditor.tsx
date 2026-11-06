import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { emptyExperience, experienceSchema, experienceMediaUrl, experienceImageUrl, type ExperienceMedia } from "@shared/experience";
import { emptyVideoProject, videoProjectSchema, videoSceneSchema, videoSubtitles, type VideoProject, type VideoScene } from "@shared/videoProject";
import type { StudioCard, StudioCardDetail } from "@shared/studio";
import { api, apiUpload } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink } from "../ui";
import { SaveState } from "../SaveState";
import { useDraftRecovery } from "../useDraftRecovery";
import { RecoveryNotice } from "../RecoveryNotice";
import { studioKey } from "@shared/channelKeys";
import { Icon } from "../icons";

const inputOf = (card: StudioCard) => ({ title: card.title, caption: card.caption, experience: card.experience ?? emptyExperience(), videoProject: card.videoProject ?? emptyVideoProject() });
type Form = ReturnType<typeof inputOf>;
const recoverySchema = z.object({ title: z.string(), caption: z.string(), experience: experienceSchema, videoProject: videoProjectSchema });
export function VideoEditor({ data }: { data: StudioCardDetail }) {
  const qc = useQueryClient(), guard = useDirtyGuard(), { allChannels } = useChannel();
  const [base,setBase] = useState(data.card), baseRef = useRef(base); baseRef.current = base;
  const [form,setForm] = useState(() => inputOf(data.card)), formRef = useRef(form); formRef.current = form;
  const [sceneId,setSceneId] = useState<string | null>(form.videoProject.scenes[0]?.id ?? null);
  const [uploading,setUploading] = useState(false), uploadLock = useRef(false);
  const sent = useRef(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base));
  const newer = data.card.version > base.version;
  const accept = (card: StudioCard) => { baseRef.current = card; setBase(card); setForm(inputOf(card)); };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["studio"] }); };
  const recovery = useDraftRecovery<Form>({
    recoveryKey: `studio:${base.id}:video`, label: "영상 구성", version: base.version, serverValue: inputOf(base), value: form, dirty,
    parse: value => { const result = recoverySchema.safeParse(value); return result.success ? result.data as Form : null; }, onRestore: setForm,
  });
  useEffect(() => { if (!dirty && data.card.version > base.version) accept(data.card); }, [data.card.version, dirty, base.version]);
  const save = useMutation({
    mutationFn: async () => {
      if (recovery.pending) throw new Error("기기 복구본을 먼저 확인해 주세요.");
      sent.current = formRef.current;
      return api<StudioCard>(`/studio/cards/${base.id}`, { method: "PATCH", body: { version: baseRef.current.version, ...sent.current } });
    },
    onSuccess: card => { if (JSON.stringify(formRef.current) === JSON.stringify(sent.current)) { recovery.clear(); accept(card); } else { baseRef.current = card; setBase(card); } refresh(); },
  });
  const saveNow = async (): Promise<StudioCard> => dirty || !baseRef.current.experience || !baseRef.current.videoProject ? save.mutateAsync() : baseRef.current;
  const restore = useMutation({
    mutationFn: (revisionId: number) => api<StudioCard>(`/studio/cards/${base.id}/restore`, { method: "POST", body: { version: baseRef.current.version, revisionId } }),
    onSuccess: card => { recovery.clear(); accept(card); refresh(); },
  });
  const busy = uploading || save.isPending || restore.isPending;
  useEffect(() => {
    const key = `video:${base.id}`;
    guard.setDirty(key, dirty || uploading || !!recovery.pending, async () => { if (uploading || recovery.pending) return false; try { await saveNow(); return true; } catch { return false; } }, () => { recovery.clear(); setForm(inputOf(baseRef.current)); });
    return () => guard.setDirty(key,false);
  }, [dirty, uploading, form, recovery.pending, base.version]);
  const media = useQuery({ queryKey: ["studio","media",base.id], queryFn: () => api<ExperienceMedia[]>(`/studio/cards/${base.id}/media`) });
  const [uploadError,setUploadError] = useState<unknown>(null);
  const upload = async (file: File | undefined) => {
    if (!file || uploadLock.current) return;
    uploadLock.current = true; setUploading(true); setUploadError(null);
    try {
      const saved = await saveNow();
      const result = await apiUpload<{ card: StudioCard; mediaId: number }>(`/studio/cards/${base.id}/media?version=${saved.version}&name=${encodeURIComponent(file.name)}`,file);
      accept(result.card); recovery.clear(); refresh();
    } catch(error) { setUploadError(error); refresh(); }
    finally { uploadLock.current = false; setUploading(false); }
  };
  const project = form.videoProject;
  const update = (patch: Partial<VideoProject>) => setForm(current => ({ ...current, videoProject: { ...current.videoProject, ...patch } }));
  const scene = project.scenes.find(value => value.id === sceneId) ?? project.scenes[0];
  const changeScene = (patch: Partial<VideoScene>) => update({ scenes: project.scenes.map(value => value.id === scene?.id ? { ...value, ...patch } : value) });
  const addScene = () => { const next = videoSceneSchema.parse({ id: crypto.randomUUID(), title: `장면 ${project.scenes.length+1}` }); update({ scenes: [...project.scenes,next] }); setSceneId(next.id); };
  const moveScene = (delta: number) => {
    const index = project.scenes.findIndex(value => value.id === scene?.id), to = index + delta;
    if(index < 0 || to < 0 || to >= project.scenes.length) return;
    const next = [...project.scenes], [moving] = next.splice(index,1); next.splice(to,0,moving); update({ scenes: next });
  };
  const selectedMedia = media.data?.find(item => item.id === scene?.mediaId);
  const total = project.scenes.reduce((seconds,value) => seconds + value.duration,0);
  const [downloadError,setDownloadError] = useState<unknown>(null);
  const downloadSubtitles = async () => {
    try {
      setDownloadError(null); const saved = await saveNow();
      const blob = new Blob(["\uFEFF", videoSubtitles(saved.videoProject ?? project)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `video-${base.id}-v${saved.version}.srt`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch(error) { setDownloadError(error); }
  };
  const channel = allChannels.find(value => studioKey(value.slug) === base.channel);
  return <div className="studio video-workspace">
    <GuardedLink href="/" className="studio-back">← 내 콘텐츠</GuardedLink>
    <header className="page-head"><div><span className="studio-channel-tag">{channel?.name ?? base.channel} · 영상</span><h1>{base.title}</h1><SaveState version={base.version} dirty={dirty} saving={save.isPending} error={save.error} local={recovery.status === "saved"}/></div><button className="btn primary" disabled={!dirty || busy || !form.title.trim() || !!recovery.pending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "영상 구성 저장"}</button></header>
    <RecoveryNotice recovery={recovery}/>
    {newer && dirty && <div className="notice warn" role="status">다른 기기의 새 저장본이 있습니다. 현재 입력은 보존했습니다. 저장 충돌을 확인한 뒤 최신 내용을 선택해 주세요.</div>}
    {!!(save.error || restore.error || uploadError || downloadError) && <ErrorBox error={save.error || restore.error || uploadError || downloadError}/>}
    <div className="video-capability"><Icon name="video" size={18}/><div><strong>장면·대본·자막은 스튜디오에서, 영상 편집은 외부 도구에서</strong><p>자료 업로드, 순서·길이 구성, SRT 자막 저장과 완성 파일 보관을 지원합니다. 영상 합성·인코딩과 SNS 영상 전송은 외부 편집·게시 도구에서 진행해 주세요.</p></div></div>
    <fieldset className="video-edit-fields" disabled={busy || !!recovery.pending}>
      <div className="video-project-header"><label className="field">작업 제목<input value={form.title} maxLength={160} onChange={e => setForm({ ...form,title:e.target.value })}/></label><label className="field">화면 비율<select value={project.ratio} onChange={e => update({ ratio:e.target.value as VideoProject["ratio"] })}>{["9:16","16:9","1:1"].map(ratio => <option key={ratio}>{ratio}</option>)}</select></label><div className="video-length"><span>계획한 길이</span><strong>{total.toFixed(1)}<small>초</small></strong></div></div>
      <div className="video-production-layout">
        <section className="video-scenes" aria-label="장면 목록"><div className="row between"><h2>장면 <span>{project.scenes.length}</span></h2><button type="button" className="btn icon ghost" aria-label="장면 추가" disabled={project.scenes.length >= 60} onClick={addScene}><Icon name="plus" size={18}/></button></div>
          {project.scenes.length ? <ol>{project.scenes.map((value,index) => <li key={value.id}><button type="button" aria-pressed={scene?.id === value.id} onClick={() => setSceneId(value.id)}><span>{String(index+1).padStart(2,"0")}</span><strong>{value.title || "제목 없는 장면"}</strong><small>{value.duration}초</small></button></li>)}</ol> : <div className="video-empty"><Icon name="video" size={28}/><p>첫 장면을 추가해 이야기를 구성하세요.</p><button type="button" className="btn" onClick={addScene}>첫 장면 추가</button></div>}
        </section>
        <section className="video-scene-editor" aria-label="선택한 장면 편집">{scene ? <>
          <div className="row between"><h2>{project.scenes.findIndex(value => value.id === scene.id)+1}번 장면</h2><div className="row"><button type="button" className="btn sm" disabled={project.scenes[0]?.id === scene.id} onClick={() => moveScene(-1)}>앞으로</button><button type="button" className="btn sm" disabled={project.scenes.at(-1)?.id === scene.id} onClick={() => moveScene(1)}>뒤로</button></div></div>
          <label className="field">장면 제목<input value={scene.title} maxLength={200} onChange={e => changeScene({ title:e.target.value })}/></label><div className="grid grid-2"><label className="field">촬영 자료<select value={scene.mediaId ?? ""} onChange={e => changeScene({ mediaId:e.target.value ? Number(e.target.value) : null })}><option value="">자료 선택 전</option>{media.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">길이 (초)<input type="number" min=".1" max="600" step=".1" value={scene.duration} onChange={e => changeScene({ duration:Math.max(.1,Math.min(600,Number(e.target.value)||.1)) })}/></label></div>
          <label className="field">대본·내레이션<textarea rows={4} value={scene.narration} maxLength={3000} onChange={e => changeScene({ narration:e.target.value })}/></label><label className="field">화면 자막<textarea aria-label="화면 자막" rows={3} value={scene.subtitle} maxLength={2000} onChange={e => changeScene({ subtitle:e.target.value })}/></label><label className="field">오디오·편집 메모<input value={scene.audio} maxLength={1000} onChange={e => changeScene({ audio:e.target.value })}/></label><button type="button" className="btn ghost" onClick={() => { update({ scenes:project.scenes.filter(value => value.id !== scene.id) }); setSceneId(project.scenes.find(value => value.id !== scene.id)?.id ?? null); }}>이 장면 제거</button>
        </> : <p className="muted">장면을 선택하면 이곳에서 대본과 자막을 다듬을 수 있습니다.</p>}</section>
        <aside className="video-stage" aria-label="촬영 자료 미리보기"><div className="video-preview" style={{ aspectRatio:project.ratio.replace(":","/") }}>{selectedMedia?.kind === "video" ? <video key={selectedMedia.id} src={experienceMediaUrl(selectedMedia.id)} controls preload="metadata" aria-label={selectedMedia.name}/> : selectedMedia ? <img src={experienceImageUrl(selectedMedia.id)} alt={selectedMedia.name}/> : <div><Icon name="video" size={32}/><p>선택한 촬영 자료</p></div>}</div><p className="small muted">선택한 자료의 확인용 미리보기입니다. 편집·자막이 합성된 영상은 외부 도구에서 확인하세요.</p></aside>
      </div>
      <details className="panel video-media" open><summary>촬영 자료 · {media.data?.length ?? 0}개</summary><div className="stack">{media.error && <ErrorBox error={media.error} retry={() => media.refetch()}/>}<label className="field">사진·영상 올리기<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" onChange={e => { const file=e.target.files?.[0]; e.target.value=""; void upload(file); }}/><span className="hint">PNG·JPG·WEBP 사진 12MB, 영상 25MB, 작업당 합계 100MB. 사진은 긴 변 1600px 이하의 JPEG 편집용 사본으로, 영상은 업로드한 원본으로 보관합니다. 사진 원본은 별도로 보관해 주세요.</span></label><div className="video-media-list">{media.data?.map(item => <div key={item.id}><Icon name={item.kind === "video" ? "video" : "design"} size={18}/><span>{item.name}<small>{(item.size/1048576).toFixed(1)}MB</small></span><a className="btn sm" href={experienceMediaUrl(item.id)+"?download=1"}>{item.kind === "video" ? "영상 원본 받기" : "편집용 사진 받기"}</a></div>)}</div></div></details>
      <div className="video-output-fields"><label className="field">전체 오디오 가이드<textarea rows={3} value={project.audioGuide} maxLength={4000} onChange={e => update({ audioGuide:e.target.value })}/></label><label className="field">표지 이미지<select value={project.coverMediaId ?? ""} onChange={e => update({ coverMediaId:e.target.value ? Number(e.target.value) : null })}><option value="">표지 선택 전</option>{media.data?.filter(item => item.kind === "photo" || item.hasPreview).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">완성 영상 파일<select value={project.outputMediaId ?? ""} onChange={e => update({ outputMediaId:e.target.value ? Number(e.target.value) : null })}><option value="">외부 편집 후 업로드해 주세요</option>{media.data?.filter(item => item.kind === "video").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="hint">{project.outputMediaId ? "업로드한 완성 파일을 선택했습니다. 스튜디오에서 합성·발행한 상태는 아닙니다." : "편집한 파일을 위 촬영 자료에 업로드한 뒤 선택하세요."}</span></label><label className="field">게시용 캡션<textarea rows={4} value={form.caption} maxLength={8000} onChange={e => setForm({ ...form,caption:e.target.value })}/></label></div>
    </fieldset>
    <details className="panel video-history"><summary>버전 기록 · {data.revisions.length}개</summary><div className="stack">{data.revisions.map(revision => <details key={revision.id}><summary>v{revision.version} · {revision.instruction || "저장"}</summary><p className="small muted">이전 버전을 새 수정본으로 복원합니다. 기존 기록은 보존됩니다.</p><pre>{JSON.stringify(revision.snapshot.videoProject ?? { title: revision.snapshot.title, format: revision.snapshot.format }, null, 2)}</pre><button type="button" className="btn" disabled={busy || !!recovery.pending} onClick={() => guard.confirmLeave(() => restore.mutate(revision.id))}>이 버전으로 복원</button></details>)}{!data.revisions.length && <p className="muted">저장한 버전이 여기에 표시됩니다.</p>}</div></details>
    <footer className="video-savebar"><span role="status">{uploading ? "촬영 자료를 서버에 저장 중…" : project.outputMediaId ? "완성 파일 선택됨" : "장면 구성 중"} · {project.scenes.length}장면</span><div className="row"><button type="button" className="btn" disabled={busy || !!recovery.pending || !project.scenes.some(value => value.subtitle.trim())} onClick={() => void downloadSubtitles()}>SRT 자막 받기</button><button type="button" className="btn primary" disabled={busy || !dirty || !form.title.trim() || !!recovery.pending} onClick={() => save.mutate()}>저장</button></div></footer>
  </div>;
}
