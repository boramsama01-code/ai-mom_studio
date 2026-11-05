import { useEffect,useRef,useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { api,ApiError } from './api';
import { ErrorBox,GuardedLink } from './ui';
import type { CardCopyV2, PageDesigns } from '../../shared/familyDialogue';
import { canvaVariant,type CanvaJobDto } from '../../shared/canvaEditorial';
import { clearCanvaRequest,parseCanvaAcceptance,parseCanvaConnection,parseCanvaJob,parseCanvaJobs,parseCanvaMaster,parseCanvaMasters,readCanvaRequest,type CanvaRequestBody } from './canvaEditorialContract';
import { canvaReconciliations } from '../../shared/canvaReconciliation';
import { CanvaRecovery } from './CanvaRecovery';
import './canvaEditorial.css';
import { CANVA_READING_MASTERS,CANVA_READING_TEMPLATE_VERSION } from '../../shared/canvaMasterCatalog';
import { READING_CARD_PROFILES,readingProfileForTemplateKey,readingProfileForTemplateVersion,readingArtworkPages } from '../../shared/readingCardProfiles';
import { cardnews14Source } from '../../shared/cardnews14Catalog';
import { readingMasterSourceApproved } from '../../shared/readingCanvaMasters';
import { selectedFamilyEnding } from '../../shared/characterVariantAssets';

const phaseLabels:Record<string,string>={validate:'템플릿 확인 중',images:'페이지 이미지 준비 중',autofill_prepare:'문구·이미지 연결 준비 중',autofill_submitting:'Canva에 새 디자인 요청 중',autofill_polling:'8장 디자인 만드는 중',export_prepare:'완성된 디자인 확인 중',export_submitting:'8장 이미지 내보내는 중',export_polling:'내보내기 기다리는 중',download:'이미지 저장 중',complete:'8장 저장 완료'};
type RequestBody=CanvaRequestBody;

export function CanvaEditorial({channelId,itemId,version,revisionId,copy,pageDesigns,disabled,onLocalRender}:{channelId:number;itemId:number;version:number;revisionId:number;copy:CardCopyV2;pageDesigns?:PageDesigns;disabled:boolean;onLocalRender?:()=>void}){
  const qc=useQueryClient(),base=`/channels/${channelId}/items/${itemId}/canva/jobs`,key=['canva-jobs',channelId,itemId];
  const connection=useQuery({queryKey:['canva-editorial-status'],queryFn:async()=>parseCanvaConnection(await api('/canva/editorial/status')),retry:false,staleTime:60_000});
  const masters=useQuery({queryKey:['canva-masters',channelId],queryFn:async()=>parseCanvaMasters(await api(`/channels/${channelId}/canva/masters`))});
  const jobs=useQuery({queryKey:key,queryFn:async()=>parseCanvaJobs(await api(base)),refetchInterval:q=>q.state.data?.items.some(j=>['queued','running'].includes(j.status))?3000:false});
  const readingProfile=readingProfileForTemplateKey(copy.templateKey);
  const outro=copy.pages.find(page=>page.id==='outro'),fullImageEnding=selectedFamilyEnding('outro',pageDesigns?.outro);
  const expectedProfile=readingProfile?'brand:allligodang:bw:20261104':'brand:space-penguin-company:20261101';
  const unsupportedOutro=fullImageEnding?'전체 이미지 엔딩은 스튜디오에서 8장으로 출력합니다. 현재 Canva 마스터는 이 엔딩을 지원하지 않습니다.':outro?.fields.logoAssetId!==expectedProfile?'선택한 프로필은 스튜디오 8장 출력에서 사용할 수 있습니다. Canva 자동 제작은 현재 마스터에 연결된 기본 프로필을 사용해야 합니다.':null;
  const variant=canvaVariant(copy),available=masters.data?.items.filter(m=>m.status==='ready'&&(readingProfile?m.templateVersion===readingProfile.templateVersion&&readingMasterSourceApproved(readingProfile,m.sourceId):!readingProfileForTemplateVersion(m.templateVersion)&&m.conceptMode===variant.conceptMode&&m.hasExternalActivity===variant.hasExternalActivity))??[];
  const [choice,setChoice]=useState<number|null>(null),selected=available.find(m=>m.id===choice)??available[0];
  const [focusedJobId,setFocusedJobId]=useState<number|null>(null);
  const pending=jobs.data?.items.find(j=>['queued','running'].includes(j.status)),unresolved=jobs.data?.items.find(j=>j.status==='result_unknown');
  const focused=jobs.data?.items.find(j=>j.id===focusedJobId),currentOutput=jobs.data?.items.find(j=>j.status==='ready'&&j.outputRevisionId===revisionId);
  const current=focused&&!(focused.status==='ready'&&focused.outputRevisionId!==revisionId&&currentOutput)?focused:pending??jobs.data?.items.find(j=>j.status==='needs_review'&&j.sourceVersion===version&&j.sourceRevisionId===revisionId)??currentOutput??jobs.data?.items[0];
  const [confirmed,setConfirmed]=useState(false),[loaded,setLoaded]=useState<number[]>([]),[failedImages,setFailedImages]=useState<number[]>([]),[imageAttempt,setImageAttempt]=useState(0);
  const changed=useRef(new Set<string>()),busy=useRef(false);
  const requestKey=`canva-request:${channelId}:${itemId}`;
  const [lostRequest,setLostRequest]=useState<RequestBody|null>(()=>readCanvaRequest(requestKey));
  useEffect(()=>{setConfirmed(false);setLoaded([]);setFailedImages([]);setImageAttempt(0);},[current?.id,current?.outputRevisionId]);
  useEffect(()=>{setConfirmed(false);},[version,revisionId]);
  useEffect(()=>{
    if(!current||!['ready','needs_review','superseded'].includes(current.status))return;
    const marker=`${current.id}:${current.status}`;if(changed.current.has(marker))return;changed.current.add(marker);
    void qc.invalidateQueries({queryKey:['ch',channelId,'item',itemId]});void qc.invalidateQueries({queryKey:['studio']});void qc.invalidateQueries({queryKey:['card-copy',channelId,itemId]});
  },[current?.id,current?.status,channelId,itemId,qc]);
  useEffect(()=>{if(lostRequest&&jobs.data?.items.some(j=>j.requestId===lostRequest.requestId&&(j.sourceVersion===lostRequest.version&&j.purpose===(lostRequest.importFromJobId?'import':'create')||canvaReconciliations(j.result).some(r=>r.original.requestId===lostRequest.requestId&&r.original.sourceVersion===lostRequest.version&&r.original.purpose===(lostRequest.importFromJobId?'import':'create'))))){clearCanvaRequest(requestKey);setLostRequest(null);}},[jobs.data,lostRequest,requestKey]);
  const start=useMutation({mutationFn:async(importFromJobId?:number)=>{
    if(busy.current)throw new Error('이미 요청 중입니다. 잠시 기다려 주세요.');
    if(disabled)throw new Error('문구와 이미지 설정을 먼저 저장해 주세요.');
    if(unsupportedOutro&&!importFromJobId&&!lostRequest)throw new Error(unsupportedOutro);
    const body=lostRequest??{version,requestId:crypto.randomUUID(),...(!importFromJobId&&selected?{masterId:selected.id}:{}),...(importFromJobId?{importFromJobId}:{})};
    busy.current=true;setLostRequest(body);try{sessionStorage.setItem(requestKey,JSON.stringify(body));}catch{/* Server idempotency remains authoritative. */}
    try{
      const result=parseCanvaJob(await api(base,{method:'POST',body}));
      const reconciledOriginal=result.requestId===body.requestId&&canvaReconciliations(result.result).some(record=>record.original.requestId===body.requestId&&record.original.sourceVersion===body.version&&record.original.purpose===(body.importFromJobId?'import':'create'));
      if(!reconciledOriginal&&(result.sourceVersion!==body.version||result.purpose!==(body.importFromJobId?'import':'create')))throw new ApiError(502,'요청한 원고 버전과 Canva 응답이 다릅니다. 같은 요청의 결과를 다시 확인해 주세요.');
      return result;
    }finally{busy.current=false;}
  },onSuccess:job=>{setFocusedJobId(job.id);qc.setQueryData<{items:CanvaJobDto[]}>(key,old=>({items:[job,...(old?.items??[]).filter(item=>item.id!==job.id)]}));clearCanvaRequest(requestKey);setLostRequest(null);void qc.invalidateQueries({queryKey:key});},onError:error=>{
    // The enqueue endpoint performs no external writes. A definitive rejection
    // may be corrected; a lost/5xx response must replay the same UUID first.
    if(error instanceof ApiError&&[400,401,403,404,409,422,429].includes(error.status)){
      clearCanvaRequest(requestKey);setLostRequest(null);void qc.invalidateQueries({queryKey:key});
    }
  }});
  const action=useMutation({mutationFn:async(a:{name:'resume'|'cancel'|'accept'|'reexport';id:number;exportJobId?:string})=>{
    const result=await api(`${base}/${a.id}/${a.name==='reexport'?'resume':a.name}`,{method:'POST',body:a.name==='accept'?{version,textConfirmedUnchanged:true}:a.name==='reexport'?{action:'reexport',expectedExportJobId:a.exportJobId}:{}});
    if(a.name==='accept')return parseCanvaAcceptance(result);
    const job=parseCanvaJob(result);if(job.id!==a.id)throw new ApiError(502,'다른 Canva 작업의 응답을 받았습니다. 저장된 작업 상태를 다시 확인해 주세요.');return job;
  },onSuccess:()=>{void qc.invalidateQueries({queryKey:key});void qc.invalidateQueries({queryKey:['ch',channelId,'item',itemId]});},onError:()=>{void qc.invalidateQueries({queryKey:key});}});
  const pages=Array.isArray(current?.result?.pages)?current!.result!.pages as Array<{id:number;title:string;sha256:string}>:[];
  const originals=Array.isArray(current?.result?.originals)?current!.result!.originals as Array<{id:number;page:number}>:[];
  const drawing=pending||start.isPending||action.isPending;
  const canStart=!disabled&&!drawing&&!unsupportedOutro&&connection.isSuccess&&masters.isSuccess&&jobs.isSuccess&&connection.data?.autofill&&!!selected&&!lostRequest&&!unresolved;
  const preferLocal=!!onLocalRender&&(!!unsupportedOutro||!!readingProfile?.sourceStyleId&&!available.length);
  const reviewMatchesCurrent=current?.sourceVersion===version&&current?.sourceRevisionId===revisionId;
  const canReexport=current?.status==='failed'&&!!current.exportJobId&&(current.errorCode==='export_expired'||current.errorCode==='job_failed'&&current.phase==='export_polling');
  return <section className="canva-editorial stack" aria-label={preferLocal?'스튜디오 8장 디자인':'Canva 8장 디자인'}>
    <div className="row between"><div><h3>8장 디자인 완성</h3><p className="small muted">{preferLocal?'저장한 문구와 사진으로 선택한 스타일의 8장을 만듭니다.':'저장한 문구와 페이지 이미지를 Canva 템플릿에 넣습니다.'}</p></div><span className="pill">자동 · {preferLocal?'스튜디오':'Canva'}</span></div>
    {readingProfile && <p className={`notice ${available.length?'':'warn'}`} data-testid="reading-canva-readiness">{readingProfile.label} · {available.length?'검증된 같은 스타일 마스터를 선택할 수 있습니다.':`스튜디오 문구 편집·미리보기를 사용할 수 있습니다. Canva 자동 제작은 8장·46개 문구·${readingProfile.images.length}개 이미지의 연결과 실제 출력을 검증한 뒤 사용할 수 있습니다.`}</p>}
    {unsupportedOutro&&<p className="notice small" data-testid="canva-outro-support">{unsupportedOutro} 직접 작성한 마지막 장 문구는 보관합니다.</p>}
    {!connection.isLoading&&!connection.error&&!connection.data?.connected&&<p className={preferLocal?'small muted':'notice warn'}>{preferLocal?'Canva 출력도 사용하려면 계정을 연결해 주세요.':'Canva 계정을 먼저 연결해 주세요.'} <GuardedLink href="/connections?service=canva">Canva 연결 설정</GuardedLink></p>}
    {connection.data?.connected&&!connection.data.autofill&&<div className="notice warn stack" data-testid="canva-capability-status" role="status"><strong>{connection.data.capabilityStatus==='unknown'?'자동 채우기 권한을 아직 확인하지 못했습니다':'연결한 계정에서 자동 채우기를 사용할 수 없습니다'}</strong><p>{connection.data.message??'연결한 계정·팀의 기능 이용 권한을 확인해 주세요.'}</p><div className="row wrap"><button className="btn sm" disabled={connection.isFetching} onClick={()=>connection.refetch()}>{connection.isFetching?'확인 중…':'권한 다시 확인'}</button>{['missing_scope','auth_required'].includes(connection.data.reason??'')&&<GuardedLink href="/connections?service=canva">Canva 다시 연결</GuardedLink>}</div></div>}
    {connection.error&&<ErrorBox error={connection.error} retry={()=>connection.refetch()}/>}
    <label className="field">템플릿 선택<select aria-label="Canva 템플릿 선택" value={selected?.id??''} disabled={!!drawing||!available.length} onChange={e=>setChoice(Number(e.target.value))}>
      {!available.length&&<option value="">이 원고 구조에 맞는 템플릿 등록 필요</option>}
      {available.map(m=><option value={m.id} key={m.id}>{readingProfile?`${readingProfile.label} · 모든 개념·활동 구조`:`${m.conceptMode==='value_definition'?'가치 정의':'과학 설명'} · ${m.hasExternalActivity?'추가 자료 포함':'집 활동'}`} · {m.templateVersion}</option>)}
    </select></label>
    {!available.length&&!masters.isLoading&&<p className="small muted"><GuardedLink href="/design">카드 디자인 설정</GuardedLink>에서 검증된 8장 마스터를 등록해 주세요.</p>}
    {masters.error&&<ErrorBox error={masters.error} retry={()=>masters.refetch()}/>}
    {disabled&&<p className="notice small">문구·이미지 설정에 미저장 변경이 있습니다. 저장한 뒤 디자인을 만들어 주세요.</p>}
    <div className="row wrap">
      {preferLocal&&<button className="btn primary" disabled={disabled||!!drawing||!jobs.isSuccess||!!lostRequest} onClick={onLocalRender}>스튜디오에서 8장 만들기</button>}
      <button className={`btn ${preferLocal?'':'primary'}`} disabled={!canStart} onClick={()=>start.mutate(undefined)}>{start.isPending?'요청 중…':'Canva 8장 만들기'}</button>
      {current?.editUrl&&<a className="btn" href={current.editUrl} target="_blank" rel="noopener noreferrer">Canva에서 열기 ↗</a>}
      {current?.designId&&<button className="btn" disabled={disabled||!!drawing||!!lostRequest||!!unresolved||!jobs.isSuccess||!connection.data?.connected} onClick={()=>start.mutate(current.id)}>최신 디자인 가져오기</button>}
    </div>
    {preferLocal&&<p className="small muted">선택한 스타일로 8장을 완성합니다. 스튜디오 자체 출력이며, Canva 자동 제작은 원본 연결·출력 검증이 끝나면 사용할 수 있습니다.</p>}
    {lostRequest&&<div className="notice warn stack"><span>요청 응답을 아직 확인하지 못했습니다. 같은 요청의 결과를 먼저 확인합니다.</span><button className="btn" disabled={!!drawing||disabled} onClick={()=>start.mutate(undefined)}>요청 결과 확인</button></div>}
    {pending&&<div className="notice" role="status"><strong>{phaseLabels[pending.phase]??'Canva 작업 중'}</strong><p className="small">창을 닫아도 저장된 작업 ID로 이어서 확인합니다. 기존 원고와 이미지는 유지합니다.</p><button className="btn sm" disabled={action.isPending} onClick={()=>action.mutate({name:'cancel',id:pending.id})}>대기 취소</button></div>}
    {current?.errorMessage&&<div className="notice warn stack" role="alert"><strong>{current.status==='result_unknown'?'Canva 결과 확인 필요':current.status==='superseded'?'이전 원고의 결과 보관':'Canva 작업 확인'}</strong><p>{current.errorMessage}</p>{['failed','result_unknown'].includes(current.status)&&<button className="btn" disabled={action.isPending} onClick={()=>action.mutate({name:'resume',id:current.id})}>저장된 작업 결과 확인</button>}</div>}
    {canReexport&&<div className="notice stack"><p>이 출력 작업의 만료 또는 실패를 확인했습니다. 기존 Canva 디자인을 그대로 두고 8장 내보내기만 다시 실행합니다.</p><button className="btn" disabled={disabled||!!drawing} onClick={()=>action.mutate({name:'reexport',id:current.id,exportJobId:current.exportJobId!})}>같은 디자인의 8장 다시 내보내기</button></div>}
    {unresolved&&unresolved.id!==current?.id&&<div className="notice warn stack"><p>이전 Canva 요청의 결과를 확인해야 합니다. 중복 디자인을 막기 위해 새 생성은 잠시 멈췄습니다.</p><button className="btn" disabled={action.isPending} onClick={()=>action.mutate({name:'resume',id:unresolved.id})}>이전 작업 결과 확인</button></div>}
    {unresolved&&<CanvaRecovery key={`${channelId}:${itemId}:${unresolved.id}`} channelId={channelId} itemId={itemId} version={version} job={unresolved} disabled={disabled} connected={!!connection.data?.connected} busy={!!drawing} onRecovered={job=>{setFocusedJobId(job.id);qc.setQueryData<{items:CanvaJobDto[]}>(key,old=>({items:[job,...(old?.items??[]).filter(value=>value.id!==job.id)]}));void qc.invalidateQueries({queryKey:key});}}/>}
    {start.error&&<ErrorBox error={start.error}/>}{action.error&&<ErrorBox error={action.error}/>}{jobs.error&&<ErrorBox error={jobs.error} retry={()=>jobs.refetch()}/>}
    {pages.length===8&&<details className="content-options" open={current?.status==='needs_review'}><summary>실제 Canva 출력 8장 {current?.outputRevisionId===revisionId?'· 현재 저장본':'· 결과 보관본'}</summary><div className="stack">
      {current?.result?.reconciled===true&&<p className="notice warn">결과 미확정 작업에 기존 디자인을 연결해 가져온 8장입니다. 제목·템플릿 필드가 같아도 원고 일치를 자동으로 보장하지 않으므로 현재 저장본과 모든 문구를 대조해 주세요.</p>}
      {current?.result?.reuseReason==='caption_only'&&<p className="notice">카드 내용은 같고 캡션만 바뀌어, 기존 8장 이미지와 원본 PNG를 그대로 재사용했습니다. Canva에 다시 생성·내보내기를 요청하지 않았습니다.</p>}
      <div className="canva-export-grid">{pages.map((page,i)=><figure key={`${page.id}:${imageAttempt}`}><a href={`/api/channels/${channelId}/media/${page.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/channels/${channelId}/media/${page.id}${imageAttempt?`?previewRetry=${imageAttempt}`:''}`} alt={`${i+1}장 ${page.title}`} onLoad={()=>{setLoaded(old=>old.includes(page.id)?old:[...old,page.id]);setFailedImages(old=>old.filter(id=>id!==page.id));}} onError={()=>{setLoaded(old=>old.filter(id=>id!==page.id));setConfirmed(false);setFailedImages(old=>old.includes(page.id)?old:[...old,page.id]);}}/></a><figcaption>{i+1} / 8{originals[i]&&<> · <a href={`/api/channels/${channelId}/media/${originals[i].id}?download=1`}>원본 PNG</a></>}</figcaption></figure>)}</div>
      <p className="small muted" role="status">이미지 {loaded.length} / 8장 불러옴</p>
      {failedImages.length>0&&<div className="notice warn"><p>{failedImages.length}장의 이미지를 불러오지 못했습니다. 모두 표시된 뒤 문구 대조를 완료해 주세요.</p><button className="btn sm" onClick={()=>{setLoaded([]);setFailedImages([]);setConfirmed(false);setImageAttempt(value=>value+1);}}>이미지 다시 불러오기</button></div>}
      <p className="small muted">Canva에서 내보낸 원본 PNG를 보관합니다. 게시 미리보기와 전송은 같은 게시용 JPEG 8장을 사용합니다.</p>
      {current?.status==='needs_review'&&<div className="notice stack"><strong>Canva에서 바꾼 문구를 대조해 주세요.</strong><p>Canva 편집 내용은 자동으로 원고에 동기화되지 않습니다. 글을 바꿨다면 스튜디오의 해당 칸도 수정·저장한 뒤 다시 가져와 주세요.</p>{!reviewMatchesCurrent&&<p className="notice warn">가져온 뒤 원고 버전이 바뀌었습니다. 최신 디자인 가져오기로 다시 대조해 주세요.</p>}<label className="check"><input type="checkbox" checked={confirmed} disabled={loaded.length!==8||disabled||action.isPending||!reviewMatchesCurrent} onChange={e=>setConfirmed(e.target.checked)}/><span>8장의 모든 문구가 현재 스튜디오 원고와 같은지 확인했습니다.</span></label><button className="btn primary" disabled={!confirmed||loaded.length!==8||disabled||action.isPending||!reviewMatchesCurrent} onClick={()=>action.mutate({name:'accept',id:current.id})}>확인한 8장을 새 버전으로 저장</button><p className="small muted">저장 후 검토·승인을 다시 진행합니다.</p></div>}
    </div></details>}
    {onLocalRender&&!preferLocal&&<details className="content-options"><summary>Canva 연결이 어려울 때</summary><div className="stack"><p className="small muted">같은 원고를 스튜디오 자체 디자인으로 만듭니다. 결과에 자체 이미지라고 표시하며 Canva 출력과 구분합니다.</p><button className="btn" disabled={disabled||!!drawing} onClick={onLocalRender}>자체 이미지로 만들기</button></div></details>}
  </section>;
}

export function CanvaMasterSettings({channelId,showPreparedMasters=false}:{channelId:number;showPreparedMasters?:boolean}){
  const qc=useQueryClient();
  const list=useQuery({queryKey:['canva-masters',channelId],queryFn:async()=>parseCanvaMasters(await api(`/channels/${channelId}/canva/masters`))});
  const [sourceId,setSourceId]=useState(''),[mode,setMode]=useState<'value_definition'|'scientific_explanation'>('value_definition'),[external,setExternal]=useState(false),[version,setVersion]=useState('v1.1');
  const [profileChoice,setProfileChoice]=useState('legacy');
  const save=useMutation({mutationFn:async(prepared?:typeof CANVA_READING_MASTERS[number])=>parseCanvaMaster(await api(`/channels/${channelId}/canva/masters`,{method:'POST',body:prepared?{sourceId:prepared.sourceId,conceptMode:prepared.conceptMode,hasExternalActivity:prepared.hasExternalActivity,templateVersion:CANVA_READING_TEMPLATE_VERSION}:{sourceId:sourceId.trim(),conceptMode:mode,hasExternalActivity:external,templateVersion:version.trim()}})),onSuccess:()=>{void qc.invalidateQueries({queryKey:['canva-masters',channelId]});}});
  return <section className="panel stack"><h3>Canva 8장 마스터</h3><p className="small muted">계정 연결 후 실제 8장과 자동 채우기 필드를 검사해 등록합니다. 원본 마스터를 보존하고 콘텐츠마다 새 디자인을 만듭니다.</p><GuardedLink href="/connections?service=canva">Canva 연결 설정</GuardedLink>
    <div className="stack"><h4>카드뉴스 스타일 14종</h4><p className="small muted">8장 구성과 46개 문구는 그대로 두고 스타일을 고릅니다. 아래 사진은 디자인 설명용 AI 예시이며 실제 기사에 자동으로 넣지 않습니다.</p><div className="canva-style-grid">{READING_CARD_PROFILES.filter(profile=>profile.sourceStyleId).map(profile=>{const source=cardnews14Source(profile.sourceStyleId!);return <article className="canva-style-card" key={profile.id}>
      <a href={profile.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`${profile.label} 8장 샘플 보기`}><img src={`/cardnews14/${profile.sourceStyleId}-cover.webp`} loading="lazy" width="270" height="337" alt={`${profile.label} 표지 예시`}/></a><h5>{profile.label}</h5><p className="small">사진 {readingArtworkPages(profile)}장 · 마지막 장은 ALL 프로필</p><span className="pill">Canva 자동 출력 검증 대기</span><div className="row wrap"><a href={profile.previewUrl} target="_blank" rel="noopener noreferrer">8장 샘플 ↗</a><a href={source.editUrl} target="_blank" rel="noopener noreferrer">Canva 저장본 ↗</a></div>
    </article>;})}</div><p className="hint">콘텐츠 편집기의 ‘카드뉴스 스타일’에서 선택합니다. 저장된 Canva 8장을 열어 볼 수 있으며, 자동 제작은 실제 채우기·출력 검증 후 사용할 수 있습니다.</p></div>
    <details className="content-options"><summary>기존 두 스타일</summary><div className="stack">{READING_CARD_PROFILES.filter(profile=>!profile.sourceStyleId).map(profile=><p key={profile.id}><strong>{profile.label}</strong> · 기존 문구·사진·저장본 유지</p>)}</div></details>
    {showPreparedMasters&&<div className="stack"><h4>알리고당 · 읽는 뉴스</h4><p className="small muted">사진 중심 표지, 차콜 바탕, 노란 포인트의 8장 디자인입니다. 연결한 계정에서 실제 필드와 권한을 검사한 마스터만 사용할 수 있습니다.</p>{CANVA_READING_MASTERS.map(master=>{const registered=list.data?.items.some(saved=>saved.sourceId===master.sourceId&&saved.templateVersion===CANVA_READING_TEMPLATE_VERSION&&saved.status==='ready');return <div className="row between wrap" key={master.sourceId}><a href={master.editUrl} target="_blank" rel="noopener noreferrer">{master.label} · 8장 보기 ↗</a><button className="btn sm" disabled={save.isPending||registered} onClick={()=>save.mutate(master)}>{registered?'등록됨':'이 마스터 검사·등록'}</button></div>;})}{save.error&&<ErrorBox error={save.error}/>}</div>}
    {list.data?.items.map(m=><div className="row between wrap" key={m.id}><span>{m.conceptMode==='value_definition'?'가치 정의':'과학 설명'} · {m.hasExternalActivity?'추가 자료 포함':'집 활동'} · {m.templateVersion} · {m.status==='ready'&&(!readingProfileForTemplateVersion(m.templateVersion)||readingMasterSourceApproved(readingProfileForTemplateVersion(m.templateVersion)!,m.sourceId))?'사용 가능':'재검사 필요'}</span>{m.editUrl&&<a href={m.editUrl} target="_blank" rel="noopener noreferrer">마스터 열기 ↗</a>}</div>)}
    <label className="field">등록할 카드뉴스 스타일<select aria-label="등록할 카드뉴스 스타일" value={profileChoice} disabled={save.isPending} onChange={event=>{setProfileChoice(event.target.value);setVersion(readingProfileForTemplateKey(event.target.value)?.templateVersion??'v1.1');}}><option value="legacy">기존 마스터 계약</option>{READING_CARD_PROFILES.map(profile=><option value={profile.templateKey} key={profile.id}>{profile.label} · 46개 문구·{profile.images.length}개 이미지</option>)}</select><span className="hint">미리보기를 확인한 실제 Canva 디자인 ID를 아래에 입력합니다. 페이지와 자동 채우기 필드가 맞지 않으면 등록하지 않습니다.</span></label>
    <details className="content-options"><summary>마스터 등록</summary><div className="stack"><label className="field">Canva 디자인 ID<input value={sourceId} onChange={e=>setSourceId(e.target.value)} placeholder="D로 시작하는 디자인 ID"/></label>{profileChoice==='legacy'?<><label className="field">6장 개념 구조<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="value_definition">가치 정의</option><option value="scientific_explanation">과학 설명</option></select></label><label className="check"><input type="checkbox" checked={external} onChange={e=>setExternal(e.target.checked)}/>7장에 검증된 외부 활동 영역 있음</label></>:<p className="hint">이 스타일은 46개 문구와 {readingProfileForTemplateKey(profileChoice)?.images.length}개 이미지 필드를 사용합니다. 원본 ID·버전·실제 출력까지 확인한 스타일만 자동 제작에 사용합니다.</p>}<label className="field">템플릿 버전<input value={version} readOnly={profileChoice!=='legacy'} onChange={e=>setVersion(e.target.value)} maxLength={80}/></label><button className="btn primary" disabled={save.isPending||!sourceId.trim()||!version.trim()} onClick={()=>save.mutate()}>{save.isPending?'8장·필드 확인 중…':'검사하고 등록'}</button>{save.error&&<ErrorBox error={save.error}/>}</div></details>
    {list.error&&<ErrorBox error={list.error}/>}
  </section>;
}
