import {useCallback,useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {cardCopySchema,type CardCopy} from '@shared/cardCopy';
import {notionDesignEditsSchema,type NotionDesignEdits,type NotionStudioDetail} from '@shared/notionStudio';
import {notionSourceReferencePageCount} from '@shared/notionSync';
import {api,apiBlob,ApiError} from './api';
import {useDirtyGuard} from './state';
import {useDraftRecovery} from './useDraftRecovery';
import {RecoveryNotice} from './RecoveryNotice';
import {ErrorBox} from './ui';
import {z} from 'zod';

type Draft={copy:CardCopy;designEdits:NotionDesignEdits};
const initial=(data:NotionStudioDetail):Draft=>({copy:structuredClone(data.copy),designEdits:structuredClone(data.designEdits??{emphasisByPage:{}})});
const stable=(value:unknown):string=>JSON.stringify(value,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry);
const same=(a:unknown,b:unknown)=>stable(a)===stable(b);
// Checkpoint incomplete edits too; nonempty/length validation belongs to saving.
const recoveryCopySchema=z.object({version:z.literal(1),templateKey:z.string(),cover:z.object({title:z.string(),subtitle:z.string()}),pages:z.array(z.object({id:z.string(),title:z.string(),subtitle:z.string(),body:z.string()})).min(1).max(9)});
const recoveryDraft=(value:unknown):Draft|null=>{
  if(!value||typeof value!=='object'||!('copy' in value)||!('designEdits' in value))return null;
  const copy=recoveryCopySchema.safeParse(value.copy),edits=notionDesignEditsSchema.safeParse(value.designEdits);
  return copy.success&&edits.success?{copy:copy.data,designEdits:edits.data}:null;
};

/** This editor owns unsaved input independently from query refreshes. */
export function NotionCardEditor({data,disabled=false,onDirtyChange}:{data:NotionStudioDetail;disabled?:boolean;onDirtyChange:(dirty:boolean)=>void}){
  const qc=useQueryClient(),guard=useDirtyGuard();
  const [base,setBase]=useState(data),baseRef=useRef(data);
  const [draft,setDraft]=useState<Draft>(()=>initial(data)),draftRef=useRef(draft);draftRef.current=draft;
  const [selected,setSelected]=useState(0),[saving,setSaving]=useState(false),[savedMessage,setSavedMessage]=useState('');
  const [saveError,setSaveError]=useState<unknown>(null),[remote,setRemote]=useState<NotionStudioDetail|null>(null);
  const [preview,setPreview]=useState<{url:string;signature:string}|null>(null),previewUrl=useRef<string|null>(null);
  const [previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState<unknown>(null),[retry,setRetry]=useState(0),[safeArea,setSafeArea]=useState(false);
  const dirty=!same(draft,initial(base)),valid=cardCopySchema.safeParse(draft.copy).success;
  const put=(next:Draft)=>{draftRef.current=next;setDraft(next);setSavedMessage('');};
  const adopt=(next:NotionStudioDetail)=>{baseRef.current=next;setBase(next);put(initial(next));setRemote(null);setSaveError(null);};
  const recovery=useDraftRecovery<Draft>({recoveryKey:`notion:${data.link.id}:visual-copy`,label:'카드 편집',version:base.itemVersion,value:draft,serverValue:initial(base),dirty,ready:true,parse:recoveryDraft,onRestore:put});
  const recoveryRef=useRef(recovery);recoveryRef.current=recovery;
  useEffect(()=>{
    if(data.itemVersion===baseRef.current.itemVersion&&data.link.version===baseRef.current.link.version)return;
    if(!same(draftRef.current,initial(baseRef.current))||recoveryRef.current.pending)setRemote(data);else adopt(data);
  },[data]);
  const sourcePages=base.source.pages,coreCount=draft.copy.pages.length+1,sourceCount=notionSourceReferencePageCount(base.source.sourceReferences);
  const pageTitles=[draft.copy.cover.title,...draft.copy.pages.map(page=>page.title),...Array.from({length:sourceCount},(_,i)=>`원문 QR ${i+1}/${sourceCount}`),...(base.source.teaser?['다음 편 예고']:[]),'하이스쿱 소개'];
  const pageIndex=Math.min(selected,pageTitles.length-1),editable=pageIndex<coreCount;
  const sourcePage=sourcePages[pageIndex],designKey=sourcePage?.key??`page:${pageIndex+1}`;
  const page=pageIndex===0?draft.copy.cover:draft.copy.pages[pageIndex-1];
  const combined=editable?(pageIndex===0?draft.copy.cover.subtitle:[draft.copy.pages[pageIndex-1].subtitle,draft.copy.pages[pageIndex-1].body].filter(Boolean).join('\n\n')):'';
  const sourceSubtitle=sourcePage?.cardFields?.subtitle??'',prefix=sourceSubtitle.trim()?`${sourceSubtitle}\n\n`:'';
  const protectedValid=!editable||!prefix||combined.startsWith(prefix);
  const body=prefix&&combined.startsWith(prefix)?combined.slice(prefix.length):combined;
  const emphasis=draft.designEdits.emphasisByPage[designKey]??sourcePage?.emphasis??'';
  const locked=disabled||saving||!!recovery.pending||!!remote;
  const change=(field:'title'|'body',value:string)=>{
    const copy=structuredClone(draftRef.current.copy);
    if(pageIndex===0){if(field==='title')copy.cover.title=value;else copy.cover.subtitle=prefix+value;}
    else if(field==='title')copy.pages[pageIndex-1].title=value;else{copy.pages[pageIndex-1].subtitle='';copy.pages[pageIndex-1].body=prefix+value;}
    put({...draftRef.current,copy});setSaveError(null);
  };
  const save=useCallback(async()=>{
    const current=baseRef.current,snapshot=draftRef.current;
    if(recoveryRef.current.pending)throw new Error('기기 복구본을 먼저 확인해 주세요.');
    if(same(snapshot,initial(current)))return true;
    if(!cardCopySchema.safeParse(snapshot.copy).success)throw new Error('제목·본문의 입력 길이를 확인해 주세요.');
    setSaving(true);setSaveError(null);
    try{
      const result=await api<NotionStudioDetail>(`/notion/links/${current.link.id}/copy`,{method:'PATCH',body:{version:current.link.version,itemVersion:current.itemVersion,...snapshot}});
      baseRef.current=result;setBase(result);if(same(draftRef.current,snapshot)){recoveryRef.current.clear();put(initial(result));}setRemote(null);setSavedMessage('스튜디오에 저장했습니다. 캔바에는 아래 새 디자인 만들기로 적용하세요.');
      qc.setQueryData(['notion-link',result.link.id],result);void qc.invalidateQueries({queryKey:['notion-links']});void qc.invalidateQueries({queryKey:['studio']});void qc.invalidateQueries({queryKey:['card-copy',result.link.channelId,result.link.itemId]});return true;
    }catch(error){setSaveError(error);if(error instanceof ApiError&&error.status===409){const detail=error.body.detail;if(detail&&typeof detail==='object'&&'link' in detail)setRemote(detail as NotionStudioDetail);}throw error;}
    finally{setSaving(false);}
  },[qc]);
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{const key=`notion-visual-${data.link.id}`;guard.setDirty(key,dirty||saving||!!recovery.pending,async()=>{if(disabled||remote)return false;try{return await saveRef.current();}catch{return false;}},()=>{recoveryRef.current.clear();put(initial(baseRef.current));});return()=>guard.setDirty(key,false);},[data.link.id,dirty,saving,recovery.pending,disabled,remote,guard]);
  useEffect(()=>{onDirtyChange(dirty||saving||!!recovery.pending||!!remote);},[dirty,saving,recovery.pending,remote,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
  const signature=stable({draft,page:pageIndex,version:base.link.version,itemVersion:base.itemVersion});
  useEffect(()=>{
    if(!valid||!protectedValid||remote){setPreviewBusy(false);return;}
    const controller=new AbortController();let live=true;setPreviewBusy(true);setPreviewError(null);
    const timer=window.setTimeout(async()=>{
      try{const blob=await apiBlob(`/notion/links/${base.link.id}/preview`,'image/jpeg',{method:'POST',body:{version:base.link.version,itemVersion:base.itemVersion,...draft,page:pageIndex},signal:controller.signal});if(!live)return;const url=URL.createObjectURL(blob);if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=url;setPreview({url,signature});}
      catch(error){if(live&&!controller.signal.aborted)setPreviewError(error);}finally{if(live)setPreviewBusy(false);}
    },450);return()=>{live=false;window.clearTimeout(timer);controller.abort();};
  },[signature,valid,protectedValid,remote,retry]);
  useEffect(()=>()=>{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);},[]);
  const sourceStart=coreCount,sourceGroup=pageIndex-sourceStart;
  const visibleReferences=sourceGroup>=0&&sourceGroup<sourceCount?base.source.sourceReferences?.slice(sourceGroup*4,sourceGroup*4+4):undefined;
  return <section className="notion-card-editor stack" aria-label="카드 보며 수정">
    <header className="row between"><div><h3>카드 보며 수정</h3><p className="small muted">문구를 바꾸면 미리보기에 반영됩니다. 저장 후 캔바 디자인을 새로 만들 수 있어요.</p></div><span className="badge">{dirty?'저장하지 않은 변경':`저장본 · ${pageTitles.length}장`}</span></header>
    {base.link.coverStyle==='A'&&!base.photos.length&&<p className="notice warn" role="alert">A형 표지에 사용할 사진이 없습니다. 현재는 검정 배경으로 표시됩니다. 노션의 ‘사진 원본’에 사진을 올린 뒤 ‘노션 → 스튜디오 적용’으로 가져오세요.</p>}
    <RecoveryNotice recovery={recovery}/>
    {remote&&<div className="notice warn stack" role="alert"><strong>다른 곳에서 새 버전을 저장했습니다. 입력한 문구는 그대로 유지했습니다.</strong><p>최신 저장본을 불러오기 전에 필요한 문구를 복사해 두세요.</p><button className="btn" onClick={()=>guard.confirmLeave(()=>{recovery.clear();adopt(remote);})}>최신 저장본 불러오기</button></div>}
    <nav className="notion-card-strip" aria-label="카드 선택">{pageTitles.map((title,i)=><button type="button" key={i} aria-pressed={pageIndex===i} onClick={()=>setSelected(i)}><span>{String(i+1).padStart(2,'0')} · {i===0?'표지':i<coreCount?'본문':i<coreCount+sourceCount?'원문':i===pageTitles.length-1?'소개':'예고'}</span><strong>{title||'제목 입력'}</strong></button>)}</nav>
    <div className="notion-card-workbench">
      <div className="notion-card-visual"><div className="row between"><button className="btn sm" disabled={pageIndex===0} onClick={()=>setSelected(pageIndex-1)}>이전 카드</button><span>{pageIndex+1} / {pageTitles.length}</span><button className="btn sm" disabled={pageIndex===pageTitles.length-1} onClick={()=>setSelected(pageIndex+1)}>다음 카드</button></div>
        <div className="notion-card-image" aria-busy={previewBusy}>{preview&&<img src={preview.url} alt={`${pageIndex+1}장 디자인 미리보기`} className={preview.signature===signature?'':'is-stale'}/>} {!preview&&<p className="muted">{previewBusy?'카드 미리보기 만드는 중…':'미리보기를 확인해 주세요.'}</p>}{safeArea&&<span className="notion-card-safe-area" aria-hidden="true"/>}</div>
        <label className="notion-toggle small"><input type="checkbox" checked={safeArea} onChange={event=>setSafeArea(event.target.checked)}/>안전영역 표시</label>
        <p className="small muted" role="status">{previewBusy?'수정한 문구로 미리보기 갱신 중…':preview?.signature===signature?'현재 입력을 반영한 미리보기':'미리보기에 아직 반영되지 않은 변경이 있습니다.'}</p>
        {!!previewError&&<ErrorBox error={previewError} retry={()=>setRetry(value=>value+1)}/>}<p className="small muted">캔바 전송과 같은 배치·글자 크기·QR을 사용합니다. 캔바에서 편집한 결과와 줄바꿈은 다를 수 있어요.</p>
      </div>
      <div className="notion-card-fields stack">{editable&&page?<>
        <label className="field">카드 제목<textarea aria-label="카드 제목" rows={3} value={page.title} disabled={locked} onChange={event=>change('title',event.target.value)}/></label>
        {sourceSubtitle&&<div className="notion-protected-field"><span className="small muted">노션 소제목</span><p>{sourceSubtitle}</p></div>}
        <label className="field">{pageIndex===0?'표지 설명':'카드 본문'}<textarea aria-label={pageIndex===0?'표지 설명':'카드 본문'} rows={pageIndex===0?5:10} value={body} disabled={locked||!protectedValid} onChange={event=>change('body',event.target.value)}/><span className="small muted">{[...combined].length} / {pageIndex===0?120:1000}자 · 노션 소제목 포함</span></label>
        {!protectedValid&&<p className="notice warn">노션 소제목과 저장된 본문이 다릅니다. 노션 원고를 비교한 뒤 다시 가져와 주세요.</p>}
        <label className="field">강조문구<input aria-label="강조문구" value={emphasis} maxLength={100} disabled={locked} onChange={event=>put({...draftRef.current,designEdits:{emphasisByPage:{...draftRef.current.designEdits.emphasisByPage,[designKey]:event.target.value}}})}/><span className="small muted">제목·본문에 있는 문구를 입력하세요. 스튜디오 디자인에 저장하며 노션의 강조문구는 유지합니다.</span></label>
        {sourcePage?.cardFields&&<details className="notion-protected-field"><summary>노션 각주·출처 확인</summary><p>{sourcePage.cardFields.footnote||'각주 없음'}</p><p>{sourcePage.cardFields.sourceLabel||'출처표시 없음'}</p><span className="small muted">소제목·각주·출처는 노션 입력표에서 수정한 뒤 가져옵니다.</span></details>}
      </>:<div className="stack"><h4>{pageTitles[pageIndex]}</h4><p className="small muted">이 페이지는 원문·예고·채널 정보로 자동 배치됩니다. 문구와 주소는 노션에서 수정한 뒤 가져오세요.</p>{visibleReferences&&<ul className="notion-source-links">{visibleReferences.map(reference=><li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title} ↗</a></li>)}</ul>}{pageIndex===coreCount+sourceCount&&base.source.teaser&&<p className="notion-readonly-copy">{base.source.teaser.body}</p>}<a href={base.link.notionUrl} target="_blank" rel="noreferrer">노션 원고 열기 ↗</a></div>}
      {!valid&&<p className="notice warn" role="alert">제목·본문을 채우고 입력 길이를 확인해 주세요. 문구는 자르지 않았습니다.</p>}
      <div className="row"><button className="btn primary" disabled={!dirty||locked||!valid||!protectedValid} onClick={()=>void save().catch(()=>undefined)}>{saving?'저장 중…':'스튜디오에 저장'}</button><button className="btn" disabled={!dirty||saving} onClick={()=>guard.confirmLeave(()=>{recovery.clear();put(initial(baseRef.current));setSaveError(null);})}>수정 취소</button></div>
      {savedMessage&&<p className="notice" role="status">{savedMessage}</p>}{!!saveError&&<ErrorBox error={saveError}/>}<p className="small muted">{base.link.autoSync?'저장한 원고는 켜져 있는 자동 동기화에 따라 노션에도 반영됩니다.':'노션에는 ‘스튜디오 → 노션 반영’으로 적용합니다.'} 강조문구 디자인 설정과 캔바 완성본은 별도로 적용합니다.</p>
      </div>
    </div>
  </section>;
}
