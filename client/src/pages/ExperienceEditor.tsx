import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioContentSchema, type StudioCard, type StudioContent, type StudioCardDetail, type StudioBoard } from "@shared/studio";
import { emptyExperience, experienceImageUrl, experienceMediaUrl, type Experience, type ExperienceMedia } from "@shared/experience";
import { studioKey } from "@shared/channelKeys";
import { api, apiUpload, ApiError } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink } from "../ui";
import { useToast } from "../toast";
import { compatiblePhoto, validateExperienceFile, videoFrame } from "../experienceMedia";
import { StudioTrashButton } from "./StudioTrash";
import { StudioExport } from "./StudioExport";
import "../experience.css";

export function experienceContentOf({id,version,sourceItemId,createdAt,updatedAt,trashedAt,sourceOutput,...content}:StudioCard):StudioContent{return studioContentSchema.parse(content);}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function ExperienceEditor({data,refresh}:{data:StudioCardDetail;refresh:()=>unknown}){
 const [base,setBase]=useState(data.card),baseRef=useRef(data.card);
 const [form,setForm]=useState(()=>experienceContentOf(data.card)),formRef=useRef(form);
 const [step,setStep]=useState<"media"|"story"|"finish">(()=>data.card.experience?.pages.length?"finish":"media");
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<Error|null>(null),[uploading,setUploading]=useState("");
 const [uploadErrors,setUploadErrors]=useState<string[]>([]),[selected,setSelected]=useState(0),[history,setHistory]=useState(false);
 const [instruction,setInstruction]=useState(""); const serial=useRef<Promise<StudioCard>|null>(null);
 const [conflicting,setConflicting]=useState<StudioCard|null>(null);
 const fileInput=useRef<HTMLInputElement>(null),qc=useQueryClient(),guard=useDirtyGuard(),toast=useToast();
 const {allChannels}=useChannel();const channels=allChannels.filter(c=>c.active).map(c=>({id:studioKey(c.slug),name:c.name}));
 const board=useQuery({queryKey:["studio","cards"],queryFn:()=>api<StudioBoard>("/studio/cards")});
 const media=useQuery({queryKey:["studio","experience-media",base.id],queryFn:()=>api<ExperienceMedia[]>(`/studio/cards/${base.id}/media`)});
 const e=form.experience??emptyExperience(),dirty=!same(form,experienceContentOf(base));
 const working=data.jobs.some(j=>["queued","running"].includes(j.status));
 const currentAssets=media.data??[],selectedIds=new Set(e.media.map(m=>m.id));
 const currentJob=data.jobs[0];
 function put(next:StudioContent){formRef.current=next;setForm(next);}
 function change<K extends keyof StudioContent>(key:K,value:StudioContent[K]){put({...formRef.current,[key]:value});}
 function edit(patch:Partial<Experience>){change("experience",{...(formRef.current.experience??emptyExperience()),...patch});}
 function adopt(card:StudioCard){baseRef.current=card;setBase(card);put(experienceContentOf(card));setSaveError(null);setConflicting(null);}
 async function saveNow():Promise<StudioCard>{
  if(serial.current){await serial.current;return saveNow();}
  const snapshot=formRef.current,current=baseRef.current;
  if(same(snapshot,experienceContentOf(current)))return current;
  if(!snapshot.title.trim())throw new Error("제목을 입력해 주세요.");
  setSaving(true);setSaveError(null);
  const request=api<StudioCard>(`/studio/cards/${current.id}`,{method:"PATCH",body:{...snapshot,version:current.version}});serial.current=request;
  try{const saved=await request;baseRef.current=saved;setBase(saved);if(same(formRef.current,snapshot))put(experienceContentOf(saved));setConflicting(null);qc.invalidateQueries({queryKey:["studio","cards"]});qc.invalidateQueries({queryKey:["studio","card",saved.id]});return saved;}
  catch(error){setSaveError(error as Error);if(error instanceof ApiError&&error.status===409&&error.body.current)setConflicting(error.body.current as StudioCard);throw error;}
  finally{serial.current=null;setSaving(false);}
 }
 useEffect(()=>{const incoming=data.card;if(incoming.version>baseRef.current.version&&!serial.current&&same(formRef.current,experienceContentOf(baseRef.current))){adopt(incoming);qc.invalidateQueries({queryKey:["studio","experience-media",incoming.id]});}},[data.card.version]);
 useEffect(()=>{if(!dirty||saving||working||uploading||saveError||!form.title.trim())return;const t=window.setTimeout(()=>{void saveNow().catch(()=>{});},1300);return()=>clearTimeout(t);},[form,base.version,saving,working,uploading,saveError]);
 useEffect(()=>{guard.setDirty("experience",dirty||!!uploading,async()=>{if(uploading)return false;try{await saveNow();return true;}catch{return false;}});return()=>guard.setDirty("experience",false);},[dirty,form,uploading]);
 useEffect(()=>{setSelected(i=>Math.min(i,e.pages.length));},[e.pages.length]);
 const generate=useMutation({mutationFn:async()=>{const saved=await saveNow();return api(`/studio/cards/${saved.id}/generate`,{method:"POST",body:{version:saved.version,kind:"text",textTarget:"experience",provider:"openai",instruction,requestId:crypto.randomUUID()}});},onSuccess:()=>{void refresh();setStep("finish");},onError:error=>toast("err",error.message)});
 const busy=working||generate.isPending||!!uploading;
 const restore=useMutation({mutationFn:async(revisionId:number)=>{const saved=await saveNow();return api<StudioCard>(`/studio/cards/${saved.id}/restore`,{method:"POST",body:{version:saved.version,revisionId}});},onSuccess:card=>{adopt(card);setHistory(false);void refresh();},onError:error=>toast("err",error.message)});
 async function upload(files:File[]){
  if(busy||saving)return;setUploadErrors([]);setUploading("자료 준비 중…");const errors:string[]=[];
  try{await saveNow();for(let i=0;i<files.length;i++){
   const original=files[i];setUploading(`${i+1} / ${files.length} · ${original.name}`);
   try{const video=validateExperienceFile(original),file=video?original:await compatiblePhoto(original);
    const result=await apiUpload<{card:StudioCard;mediaId:number}>(`/studio/cards/${base.id}/media?version=${baseRef.current.version}&name=${encodeURIComponent(file.name)}`,file);adopt(result.card);
    if(video){try{const frame=await videoFrame(original);const saved=await apiUpload<StudioCard>(`/studio/cards/${base.id}/media/${result.mediaId}/preview?version=${baseRef.current.version}&seconds=${frame.seconds}`,frame.file);adopt(saved);}catch(error){errors.push(`${original.name}: 원본은 저장했습니다. 대표 장면 사진을 따로 추가해 주세요. ${(error as Error).message}`);}}
   }catch(error){errors.push((error as Error).message);if((error as {status?:number}).status===409)break;}
  }}catch(error){errors.push((error as Error).message);}finally{setUploading("");setUploadErrors(errors);void media.refetch();void refresh();if(fileInput.current)fileInput.current.value="";}
 }
 async function manualFrame(asset:ExperienceMedia,file?:File){if(!file||busy)return;setUploading("영상 대표 장면 저장 중…");try{await saveNow();const converted=await compatiblePhoto(file);const saved=await apiUpload<StudioCard>(`/studio/cards/${base.id}/media/${asset.id}/preview?version=${baseRef.current.version}`,converted);adopt(saved);void media.refetch();}catch(error){toast("err",(error as Error).message);}finally{setUploading("");}}
 function toggleAsset(id:number){const next=selectedIds.has(id)?e.media.filter(m=>m.id!==id):[...e.media,{id,note:""}];const keepCover=next.some(m=>m.id===e.coverId);edit({media:next,coverId:keepCover?e.coverId:next[0]?.id??null,coverAltText:keepCover?e.coverAltText:"",pages:e.pages.map(p=>p.mediaId===id&&!next.some(m=>m.id===id)?{...p,mediaId:null,altText:""}:p)});}
 function moveAsset(id:number,delta:number){const next=[...e.media],index=next.findIndex(m=>m.id===id),to=index+delta;if(index<0||to<0||to>=next.length)return;[next[index],next[to]]=[next[to],next[index]];edit({media:next});}
 function manualDraft(){edit({pages:Array.from({length:e.pageCount-1},(_,i)=>({mediaId:e.media[i]?.id??null,title:["현장에서","기억에 남은 장면","나누고 싶은 이야기","방문 메모"][i]??`기록 ${i+1}`,body:i===0?e.notes.slice(0,300):i===1?e.takeaway.slice(0,300):i===e.pageCount-2?e.tips.slice(0,300):"",altText:"",fit:"contain" as const})),questions:[]});setStep("finish");}
 function updatePage(index:number,patch:Partial<Experience["pages"][number]>){edit({pages:e.pages.map((p,i)=>i===index?{...p,...patch}:p)});}
 function movePage(index:number,delta:number){const to=index+delta;if(to<0||to>=e.pages.length)return;const pages=[...e.pages];[pages[index],pages[to]]=[pages[to],pages[index]];edit({pages});setSelected(to+1);}
 const selectedPage=e.pages[selected-1],selectedMediaId=selected===0?e.coverId:selectedPage?.mediaId;
 const selectedAsset=currentAssets.find(a=>a.id===selectedMediaId);
 return <div className="experience-workspace">
  <header className="experience-header"><div><GuardedLink href="/">← 내 콘텐츠</GuardedLink><div className="experience-kicker">사진·영상 후기 · {channels.find(c=>c.id===form.channel)?.name??form.channel}</div><h1>{form.title}</h1></div>
   <div className="experience-save"><span role="status">{uploading?"업로드 중":saving?"저장 중…":saveError?"저장 실패":dirty?"저장 대기":"모든 변경사항 저장됨"}</span><button className="btn sm" disabled={saving||busy||!dirty} onClick={()=>void saveNow().catch(()=>{})}>저장</button><StudioTrashButton card={base} disabled={dirty||saving||busy}/></div>
  </header>
  {saveError&&<div className="notice err" role="alert"><p>{saveError.message} 입력한 내용은 이 화면에 남아 있습니다.</p>{conflicting?<details><summary>저장된 내용과 비교하고 선택하기</summary><div className="grid grid-2"><div><strong>저장된 버전 · {conflicting.title}</strong><p style={{whiteSpace:"pre-wrap"}}>{[conflicting.experience?.notes,...conflicting.experience?.pages.map(p=>`${p.title}\n${p.body}`)??[],conflicting.caption].filter(Boolean).join("\n\n")}</p></div><div><strong>현재 입력 · {form.title}</strong><p style={{whiteSpace:"pre-wrap"}}>{[e.notes,...e.pages.map(p=>`${p.title}\n${p.body}`),form.caption].filter(Boolean).join("\n\n")}</p></div></div><p>선택 전까지 자동 저장은 멈춥니다. 기존 저장본은 버전 기록에 남습니다.</p><div className="row"><button className="btn sm" onClick={()=>adopt(conflicting)}>저장된 버전으로 바꾸기</button><button className="btn sm" disabled={saving||busy} onClick={()=>{baseRef.current=conflicting;setBase(conflicting);void saveNow().catch(()=>{});}}>현재 입력으로 저장</button></div></details>:<button className="btn sm" onClick={()=>void saveNow().catch(()=>{})}>다시 저장</button>}</div>}
  <nav className="experience-steps" aria-label="후기 제작 단계">{([['media','01','사진·영상'],['story','02','내 경험'],['finish','03','카드·캡션']] as const).map(([id,n,label])=><button key={id} aria-current={step===id?"step":undefined} onClick={()=>setStep(id)}><span>{n}</span>{label}{id==="media"&&e.media.length>0&&<small>{e.media.length}</small>}</button>)}</nav>
  <section hidden={step!=="media"} className="experience-section">
   <div className="experience-section-head"><div><h2>촬영한 순간부터 모아 주세요</h2><p>사진과 영상을 한 번에 올리고, 후기에 쓸 자료와 표지를 고르세요.</p></div><span className="small muted">{currentAssets.length} / 12개</span></div>
   <div className="experience-drop" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!busy&&!saving)void upload(Array.from(event.dataTransfer.files));}}>
    <span className="experience-upload-icon" aria-hidden="true">＋</span><strong>사진·영상 여러 개 올리기</strong><p>파일을 놓거나 버튼을 눌러 선택하세요.</p><button className="btn primary" disabled={busy||saving||currentAssets.length>=12} onClick={()=>fileInput.current?.click()}>내 사진·영상 선택</button>
    <input ref={fileInput} className="sr-only" aria-label="후기 사진·영상 업로드" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.heic,.heif,.mov" multiple disabled={busy||saving} onChange={event=>void upload(Array.from(event.target.files??[]))}/>
    <small>사진 12MB · 영상 25MB · 작업당 최대 12개 / 100MB</small>
   </div>
   {uploading&&<p className="notice" role="status">{uploading}</p>}{uploadErrors.length>0&&<ul className="notice warn" role="alert">{uploadErrors.map((err,i)=><li key={i}>{err}</li>)}</ul>}
   {media.error&&<ErrorBox error={media.error} retry={()=>media.refetch()}/>}
   <div className="experience-media-grid">{[...currentAssets].sort((a,b)=>{const ai=e.media.findIndex(m=>m.id===a.id),bi=e.media.findIndex(m=>m.id===b.id);return (ai<0?999:ai)-(bi<0?999:bi);}).map(asset=>{
    const index=e.media.findIndex(m=>m.id===asset.id),used=index>=0;return <article key={asset.id} className={`experience-media ${used?"selected":""}`}>
     <div className="experience-media-picture">{asset.hasPreview?<img src={experienceImageUrl(asset.id)} alt={asset.name}/>:<span>영상 대표 장면 없음</span>}<span className="experience-media-kind">{asset.kind==="video"?"영상":"사진"}</span>{e.coverId===asset.id&&<span className="experience-cover-badge">표지</span>}</div>
     <div className="experience-media-controls"><label className="check"><input type="checkbox" checked={used} disabled={busy} onChange={()=>toggleAsset(asset.id)}/>{used?`${index+1}번째 자료`:"후기에 사용"}</label><span title={asset.name}>{asset.name}</span>
      {used&&<><input aria-label={`${asset.name} 장면 메모`} placeholder="이 장면에서 기억할 것 (선택)" value={e.media[index].note} maxLength={500} disabled={busy} onChange={event=>edit({media:e.media.map(m=>m.id===asset.id?{...m,note:event.target.value}:m)})}/>
      <div className="row"><button className="btn sm" aria-pressed={e.coverId===asset.id} disabled={busy||!asset.hasPreview} onClick={()=>edit({coverId:asset.id,coverAltText:""})}>{e.coverId===asset.id?"선택한 표지":"표지로"}</button><button className="btn sm ghost" aria-label={`${asset.name} 앞으로`} disabled={busy||index===0} onClick={()=>moveAsset(asset.id,-1)}>←</button><button className="btn sm ghost" aria-label={`${asset.name} 뒤로`} disabled={busy||index===e.media.length-1} onClick={()=>moveAsset(asset.id,1)}>→</button></div></>}
      {asset.kind==="video"&&<details><summary>영상 원본 보기</summary><video controls playsInline preload="metadata" src={experienceMediaUrl(asset.id)} aria-label={`${asset.name} 영상 원본`}/></details>}
      {asset.kind==="video"&&!asset.hasPreview&&<label className="field">대표 장면 사진 추가<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>void manualFrame(asset,event.target.files?.[0])}/></label>}
     </div></article>;
   })}</div>
   {!!currentAssets.length&&<p className="small muted">체크를 해제한 자료는 AI에 보내지 않습니다. 영상은 대표 장면을 카드에 사용하고, 선택한 영상 원본은 ZIP에 함께 담습니다.</p>}
   <div className="experience-bottom"><span>{e.media.length?`${e.media.length}개 자료 선택됨`:"후기에 쓸 자료를 선택하세요."}</span><button className="btn primary" disabled={!e.media.length||busy} onClick={()=>setStep("story")}>다음 · 내 경험 적기 →</button></div>
  </section>
  <section hidden={step!=="story"} className="experience-section">
   <div className="experience-section-head"><div><h2>사진에 담기지 않은 경험을 알려 주세요</h2><p>완성된 글이 아니어도 됩니다. 짧은 메모를 AI가 카드 문구와 캡션으로 정리합니다.</p></div></div>
   <fieldset disabled={busy} className="experience-fields"><div className="grid grid-2"><label className="field">작업 제목<input value={form.title} maxLength={160} onChange={v=>change("title",v.target.value)}/></label><label className="field">올릴 채널<select value={form.channel} onChange={v=>change("channel",v.target.value)}>{channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
    <div className="grid grid-3"><label className="field">행사·방문 이름<input value={e.event} maxLength={160} onChange={v=>edit({event:v.target.value})} placeholder="예: 과학관 체험 프로그램"/></label><label className="field">장소<input value={e.place} maxLength={160} onChange={v=>edit({place:v.target.value})} placeholder="직접 다녀온 장소"/></label><label className="field">방문일<input type="date" value={e.date} onChange={v=>edit({date:v.target.value})}/></label></div>
    <label className="field">실제로 무엇을 했나요? <span className="hint">필수 · 사진만으로 알 수 없는 경험을 적어 주세요.</span><textarea rows={5} value={e.notes} maxLength={8000} onChange={v=>edit({notes:v.target.value})} placeholder="참여한 활동, 인상적이었던 장면, 아쉬웠던 점을 편하게 적어 주세요."/></label>
    <div className="grid grid-2"><label className="field">기억에 남는 반응·대화<textarea rows={3} value={e.takeaway} maxLength={2000} onChange={v=>edit({takeaway:v.target.value})} placeholder="아이와 실제로 나눈 말이나 내 생각 (선택)"/></label><label className="field">다음 사람에게 알려줄 팁<textarea rows={3} value={e.tips} maxLength={2000} onChange={v=>edit({tips:v.target.value})} placeholder="직접 확인한 준비물·동선·예약 경험 등 (선택)"/></label></div>
    <div className="grid grid-2"><label className="field">글의 톤<select value={e.tone} onChange={v=>edit({tone:v.target.value as Experience["tone"]})}>{["담백한 기록","아이와 나눈 대화","실용적인 방문 팁"].map(t=><option key={t}>{t}</option>)}</select></label><label className="field">카드 장수<select value={e.pageCount} onChange={v=>edit({pageCount:Number(v.target.value)})}>{Array.from({length:8},(_,i)=>i+3).map(n=><option key={n} value={n}>{n}장 · 표지 포함{n===5?" (기본)":""}</option>)}</select></label></div>
    <details><summary>AI에 추가로 요청하기</summary><textarea aria-label="후기 AI 추가 요청" rows={3} value={instruction} maxLength={8000} onChange={v=>setInstruction(v.target.value)} placeholder="예: 과장 없이, 아이가 던진 질문을 중심으로 써 줘."/></details>
   </fieldset>
   {working&&<p className="notice" role="status">사진과 메모를 읽고 후기·캡션을 작성 중입니다. 다른 페이지로 이동해도 작업은 계속됩니다.</p>}
   {board.data?.ai.text.openai===false&&<p className="notice">사진을 읽어 초안을 쓰려면 <GuardedLink href="/connections?service=openai">OpenAI 연결</GuardedLink>이 필요합니다. 직접 구성은 지금도 할 수 있습니다.</p>}
   <div className="experience-bottom"><button className="btn ghost" onClick={()=>setStep("media")}>← 사진·영상</button><div><button className="btn" disabled={busy||!e.media.length} onClick={manualDraft}>직접 구성하기</button><button className="btn primary" disabled={busy||!e.media.length||!e.notes.trim()||board.data?.ai.text.openai===false} onClick={()=>generate.mutate()}>{working||generate.isPending?"초안 작성 중…":e.pages.length?"수정 요청으로 새 초안 만들기":"GPT로 후기·캡션 만들기"}</button></div></div>
   <p className="small muted">선택한 사진·영상 대표 장면과 메모를 OpenAI에 보내며 API 이용료가 발생합니다. 영상 음성은 분석하지 않습니다. 결과는 편집 가능한 새 버전으로 저장됩니다.</p>
  </section>
  <section hidden={step!=="finish"} className="experience-section">
   {working?<div className="experience-pending" role="status"><span className="resume-indicator"/><h2>촬영한 순간을 이야기로 정리하고 있어요</h2><p>사진 배치, 카드 문구와 게시 캡션을 함께 준비합니다.</p></div>:!e.pages.length?<div className="experience-empty"><h2>아직 구성한 카드가 없습니다</h2><p>내 경험을 적고 AI 초안을 만들거나 직접 구성해 주세요.</p><button className="btn primary" onClick={()=>setStep("story")}>내 경험 적기</button></div>:<>
    <div className="experience-section-head"><div><h2>내 경험에 맞게 마지막으로 다듬기</h2><p>순서·사진·문구를 바꾸면 자동으로 저장됩니다. 대표 장면을 클릭해 편집하세요.</p></div><button className="btn" onClick={()=>setStep("story")}>메모·AI 요청 수정</button></div>
    {!!e.questions.length&&<details className="experience-questions" open><summary>AI가 확인을 요청한 내용 {e.questions.length}개</summary><ul>{e.questions.map((q,i)=><li key={i}>{q}</li>)}</ul><p className="small">확인한 내용을 메모나 카드 문구에 반영해 주세요. 이 질문은 캡션에 포함되지 않습니다.</p></details>}
    <fieldset disabled={busy} className="experience-fields"><div className="experience-layouts" role="group" aria-label="후기 디자인"><button className={`experience-layout layout-photo`} aria-pressed={e.layout==="photo"} onClick={()=>edit({layout:"photo"})}><span aria-hidden="true"/><strong>사진 중심</strong><small>전체 배경 표지 · 장면을 크게</small></button><button className="experience-layout layout-journal" aria-pressed={e.layout==="journal"} onClick={()=>edit({layout:"journal"})}><span aria-hidden="true"/><strong>포토 노트</strong><small>사진 전체와 차분한 기록</small></button></div>
    <div className="experience-filmstrip" role="group" aria-label="후기 카드 순서">{[null,...e.pages].map((p,i)=>{const id=i===0?e.coverId:p?.mediaId,asset=currentAssets.find(a=>a.id===id);return <button key={i} aria-label={i===0?"후기 표지 편집":`${i+1}페이지 편집`} aria-pressed={selected===i} onClick={()=>setSelected(i)}>{asset?.hasPreview?<img src={experienceImageUrl(asset.id)} alt=""/>:<span className="experience-text-tile">Aa</span>}<small>{i===0?"표지":`${i+1}. ${p?.title||"제목 없음"}`}</small></button>;})}<button className="experience-add-page" disabled={e.pages.length>=9} onClick={()=>{edit({pages:[...e.pages,{title:"",body:"",mediaId:null,altText:"",fit:"contain"}]});setSelected(e.pages.length+1);}}>＋<small>페이지 추가</small></button></div>
    <div className="experience-edit-grid"><div className={`experience-card-preview ${selected===0&&e.layout==="photo"?"cover-photo":""}`}>
     {selectedAsset?.hasPreview?<img src={experienceImageUrl(selectedAsset.id)} style={{objectFit:selected===0&&e.layout==="photo"?"cover":selectedPage?.fit??"contain"}} alt="선택한 카드의 사진"/>:<div className="experience-photo-placeholder">사진 없는 페이지</div>}
     <div><small>{selected===0?"직접 다녀온 기록":`${selected+1} / ${e.pages.length+1}`}</small><h3>{selected===0?form.title:selectedPage?.title}</h3><p>{selected===0?[e.place,e.date].filter(Boolean).join(" · "):selectedPage?.body}</p></div>
    </div><div className="stack"><div className="row between"><h3>{selected===0?"표지":`${selected+1}페이지`}</h3>{selected>0&&<div className="row"><button className="btn sm" disabled={selected<=1} onClick={()=>movePage(selected-1,-1)}>← 앞</button><button className="btn sm" disabled={selected>=e.pages.length} onClick={()=>movePage(selected-1,1)}>뒤 →</button><button className="btn sm ghost danger" disabled={e.pages.length<=2} onClick={()=>{edit({pages:e.pages.filter((_,i)=>i!==selected-1)});setSelected(Math.max(0,selected-1));}}>페이지 삭제</button></div>}</div>
     <label className="field">사진·영상 장면<select value={selectedMediaId??""} onChange={v=>selected===0?edit({coverId:Number(v.target.value)||null,coverAltText:""}):updatePage(selected-1,{mediaId:Number(v.target.value)||null,altText:""})}><option value="">사진 없이 구성</option>{e.media.map(m=>{const asset=currentAssets.find(a=>a.id===m.id);return <option key={m.id} value={m.id}>{asset?.name??`자료 ${m.id}`}{asset?.kind==="video"?" · 영상 장면":""}</option>;})}</select></label>
     <label className="field">{selected===0?"표지 제목":"카드 제목"}<input value={selected===0?form.title:selectedPage?.title??""} maxLength={selected===0?160:70} onChange={v=>selected===0?change("title",v.target.value):updatePage(selected-1,{title:v.target.value})}/></label>
     {selected>0&&<><label className="field">카드 본문<textarea rows={6} value={selectedPage?.body??""} maxLength={300} onChange={v=>updatePage(selected-1,{body:v.target.value})}/><span className="hint">{selectedPage?.body.length??0} / 300자 · 짧게 쓸수록 사진이 잘 보입니다.</span></label><label className="field">사진 배치<select value={selectedPage?.fit??"contain"} onChange={v=>updatePage(selected-1,{fit:v.target.value as "contain"|"cover"})}><option value="contain">전체 보이기 · 잘림 없음</option><option value="cover">영역 채우기 · 가장자리 잘림</option></select></label></>}
     {selected===0&&<p className="small muted">사진 중심 표지는 전체 배경에 맞춰 일부가 잘릴 수 있습니다. 인물이나 전체 장면을 살리려면 포토 노트를 선택하세요.</p>}
     {selectedAsset?.kind==="video"&&<p className="small muted">카드에는 정지 장면이 들어갑니다. 영상 원본은 ZIP에 함께 담깁니다.</p>}
    </div></div>
    <div className="experience-caption"><div className="row between"><h3>게시용 캡션</h3><button className="btn sm" disabled={!form.caption} onClick={async()=>{try{await navigator.clipboard.writeText(form.caption);toast("ok","캡션을 복사했습니다.");}catch{toast("err","캡션을 직접 선택해 복사해 주세요.");}}}>캡션 복사</button></div><textarea aria-label="후기 게시용 캡션" rows={7} value={form.caption} maxLength={8000} onChange={v=>change("caption",v.target.value)}/><span className="small muted">{form.caption.length} / 2,200자 권장</span></div>
    </fieldset>
    <StudioExport form={form} base={base} dirty={dirty} busy={busy} change={change} save={saveNow}/>
    <div className="experience-bottom"><button className="btn ghost" onClick={()=>setStep("story")}>← 내 경험</button><button className="btn" disabled={busy||saving} onClick={async()=>{change("stage","done");try{await saveNow();toast("ok","제작 완료로 저장했습니다.");}catch{}}}>{form.stage==="done"?"제작 완료됨":"검토를 마치고 제작 완료"}</button></div>
   </>}
   {currentJob?.status==="failed"&&<p className="notice err" role="alert">{currentJob.lastError}</p>}
  </section>
  <div className="experience-history"><button className="btn sm ghost" aria-expanded={history} onClick={()=>setHistory(v=>!v)}>버전 기록 {data.revisions.length}개</button>{history&&<div className="panel stack">{data.revisions.map(r=><div key={r.id} className="row between"><span>r{r.version} · {r.instruction||"저장"}{!r.applied?" · 미적용 후보":""}</span><button className="btn sm" disabled={busy||saving||restore.isPending} onClick={()=>restore.mutate(r.id)}>이 버전 적용</button></div>)}</div>}</div>
 </div>;
}
