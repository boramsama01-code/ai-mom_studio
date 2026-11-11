import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {CardCopy} from '@shared/cardCopy';
import type {NotionDesignEdits,NotionStudioDetail} from '@shared/notionStudio';
import {notionInteriorTemplateCatalog} from '@shared/notionPageTemplates';
import {notionConversationResultSchema,notionConversationSignature,notionProductionProfileSchema,type NotionConversationResult,type NotionProductionProfile,type NotionProductionProfileRecord} from '@shared/notionConversation';
import {api} from './api';
import {ErrorBox} from './ui';
import {readDraftRecovery,removeDraftRecovery,writeDraftRecovery} from './draftRecovery';
import './notionConversation.css';

type Draft={copy:CardCopy;designEdits:NotionDesignEdits};
type Message={id:string;role:'user'|'assistant';page:number;text:string;contextText?:string};
type Memory={input:string;messages:Message[]};
type ScopedMemory=Memory&{identity:string};
export type NotionConversationProps={
 data:NotionStudioDetail;draft:Draft;selectedPage:number;disabled?:boolean;
 onApply:(result:NotionConversationResult)=>boolean;onUndo?:()=>void;canUndo?:boolean;
};
const emptyMemory=():Memory=>({input:'',messages:[]});
const newId=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const stable=(value:unknown):string=>JSON.stringify(value,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry);
const parseMemory=(value:unknown):Memory|null=>{
 if(!value||typeof value!=='object')return null;
 const m=value as Partial<Memory>;
 if(typeof m.input!=='string'||m.input.length>2000||!Array.isArray(m.messages)||m.messages.length>16)return null;
 if(!m.messages.every(x=>x&&typeof x.id==='string'&&x.id.length<=100&&(x.role==='user'||x.role==='assistant')&&Number.isInteger(x.page)&&x.page>=0&&x.page<100&&typeof x.text==='string'&&x.text.length<=1200&&(x.contextText===undefined||typeof x.contextText==='string'&&x.contextText.length<=1200)))return null;
 return {input:m.input,messages:m.messages};
};
function selectedText(data:NotionStudioDetail,draft:Draft,index:number){
 if(index===0)return draft.copy.cover;
 const page=draft.copy.pages[index-1];if(!page)return {title:'',subtitle:''};
 const combined=[page.subtitle,page.body].filter(Boolean).join('\n\n'),subtitle=data.source.pages[index]?.cardFields?.subtitle??'',prefix=subtitle.trim()?`${subtitle}\n\n`:'';
 return {title:page.title,subtitle:prefix&&combined.startsWith(prefix)?combined.slice(prefix.length):combined};
}
const profileFields:Array<{key:keyof NotionProductionProfile;label:string;rows:number;max:number;placeholder:string}>=[
 {key:'voice',label:'우리 채널 말투',rows:4,max:2000,placeholder:'편안한 경험담처럼, 너무 가르치려 들지 않는 말투'},
 {key:'visualStyle',label:'디자인 기준',rows:4,max:2000,placeholder:'검은 페이드 표지, 흰 글씨와 코랄 강조색, 내지 형광펜 강조'},
 {key:'referenceText',label:'참고할 내 글',rows:5,max:6000,placeholder:'마음에 드는 글을 붙여 넣어 주세요. 다음 원고를 다듬을 때 참고합니다.'},
 {key:'instructions',label:'계속 지켜줄 것',rows:3,max:2000,placeholder:'실제 경험과 일반 안내를 구분하기, 확인되지 않은 내용은 만들지 않기'},
 {key:'referenceDesignUrl',label:'기준 Canva 링크 (선택)',rows:1,max:500,placeholder:'https://www.canva.com/design/…'},
];

/** Suggestions remain local drafts; only the surrounding card editor can apply or save them. */
export function NotionConversation({data,draft,selectedPage,onApply,onUndo,canUndo=false,disabled=false}:NotionConversationProps){
 const qc=useQueryClient();
 const subscribe=useCallback((notify:()=>void)=>qc.getQueryCache().subscribe(event=>{if(event.query.queryKey[0]==='me')notify();}),[qc]);
 const sessionSnapshot=useCallback(()=>{const me=qc.getQueryData<{user?:string|null;recoveryScope?:string|null}>(['me']);return me?.user&&typeof me.recoveryScope==='string'?me.recoveryScope:null;},[qc]);
 const scope=useSyncExternalStore(subscribe,sessionSnapshot,()=>null);
 const identity=JSON.stringify([scope,data.link.id]),recoveryKey=`notion:${data.link.id}:conversation`;
 const [memory,setMemory]=useState<ScopedMemory>({...emptyMemory(),identity:''});
 const [storageIssue,setStorageIssue]=useState(false);
 const writer=useRef({identity:'',slot:newId(),token:null as string|null,recoveredToken:null as string|null});
 const activeMemory=memory.identity===identity?memory:emptyMemory();
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[notice,setNotice]=useState('');
 const [proposal,setProposal]=useState<{result:NotionConversationResult;context:string;before:{title:string;subtitle:string}}|null>(null);
 const request=useRef<{id:number;controller:AbortController;input:string}|null>(null),sequence=useRef(0);
 const [profile,setProfile]=useState<NotionProductionProfileRecord|null>(null),[profileDraft,setProfileDraft]=useState<NotionProductionProfile|null>(null),[profileOwner,setProfileOwner]=useState('');
 const [profileBusy,setProfileBusy]=useState(false),[profileError,setProfileError]=useState<unknown>(null),[profileMessage,setProfileMessage]=useState('');
 const profileRequest=useRef<AbortController|null>(null),profileOpen=useRef(false);
 const editable=selectedPage>=0&&selectedPage<=draft.copy.pages.length;
 const signature=editable?notionConversationSignature(draft.copy,draft.designEdits,selectedPage):'';
 const context=stable({identity,page:selectedPage,itemVersion:data.itemVersion,sourceHash:data.link.sourceHash,source:data.source,coverStyle:data.link.coverStyle,copy:draft.copy,designEdits:draft.designEdits});
 const latest=useRef({context,editable,disabled,signature,onApply});latest.current={context,editable,disabled,signature,onApply};
 const identityRef=useRef(identity);identityRef.current=identity;
 const profileDirty=profileOwner===identity&&!!profile&&!!profileDraft&&stable(profile.profile)!==stable(profileDraft);
 const chatAvailable=editable&&!disabled&&!busy&&!profileBusy&&!profileDirty;
 const title=editable?selectedText(data,draft,selectedPage).title:'';
 const setInput=(input:string)=>setMemory(current=>({...((current.identity===identity)?current:{...emptyMemory(),identity}),input}));
 const append=(message:Omit<Message,'id'>)=>setMemory(current=>{const base=current.identity===identity?current:{...emptyMemory(),identity};return {...base,messages:[...base.messages,{...message,id:newId()}].slice(-16)};});
 useEffect(()=>{
  const own={identity,slot:newId(),token:null as string|null,recoveredToken:null as string|null};writer.current=own;
  let recovered=emptyMemory();setStorageIssue(false);
  if(scope){const read=readDraftRecovery(scope,recoveryKey,parseMemory);if(read.ok&&read.value){recovered=read.value.value;own.recoveredToken=read.value.token;}else if(!read.ok&&read.issue!=='session_changed')setStorageIssue(true);}
  setMemory({...recovered,identity});
 },[identity,recoveryKey,scope]);
 useEffect(()=>{
  if(!scope||memory.identity!==identity||writer.current.identity!==identity)return;
  const own=writer.current;
  if(!memory.input&&!memory.messages.length){if(own.token)removeDraftRecovery(scope,recoveryKey,own.token);if(own.recoveredToken)removeDraftRecovery(scope,recoveryKey,own.recoveredToken);own.token=null;own.recoveredToken=null;return;}
  const saved=writeDraftRecovery(scope,recoveryKey,{baseVersion:1,baseValue:emptyMemory(),value:{input:memory.input,messages:memory.messages},slot:own.slot,expectedToken:own.token});
  if(!saved.ok){setStorageIssue(true);return;}
  own.token=saved.value.token;if(own.recoveredToken){removeDraftRecovery(scope,recoveryKey,own.recoveredToken);own.recoveredToken=null;}setStorageIssue(false);
 },[memory,identity,recoveryKey,scope]);
 useEffect(()=>{
  if(request.current){request.current.controller.abort();request.current=null;sequence.current++;setBusy(false);setNotice('카드나 원고가 바뀌어 이전 요청을 멈췄어요. 현재 카드에서 다시 부탁해 주세요.');}
  if(proposal&&proposal.context!==context){setNotice('원고가 바뀌어 이전 제안은 적용하지 않았어요.');setProposal(null);}
  setError(null);
 },[context]);
 useEffect(()=>{
  profileRequest.current?.abort();setProfile(null);setProfileDraft(null);setProfileOwner(identity);setProfileError(null);setProfileBusy(false);setProfileMessage('');
  if(profileOpen.current)void loadProfile();
 },[identity]);
 useEffect(()=>()=>{request.current?.controller.abort();profileRequest.current?.abort();sequence.current++;},[]);
 const loadProfile=async()=>{
  if(profileBusy&&profileOwner===identity)return;
  const capturedIdentity=identity;
  const controller=new AbortController();profileRequest.current?.abort();profileRequest.current=controller;
  setProfileBusy(true);setProfileError(null);setProfileMessage('');
  try{const record=await api<NotionProductionProfileRecord>(`/notion/links/${data.link.id}/production-profile`,{signal:controller.signal});if(controller.signal.aborted||profileRequest.current!==controller||identityRef.current!==capturedIdentity)return;setProfileOwner(capturedIdentity);setProfile(record);setProfileDraft(structuredClone(record.profile));}
  catch(e){if(!controller.signal.aborted)setProfileError(e);}
  finally{if(profileRequest.current===controller){profileRequest.current=null;setProfileBusy(false);}}
 };
 const saveProfile=async()=>{
  if(profileOwner!==identity||!profile||!profileDraft||busy||disabled)return;
  const capturedIdentity=identity;
  const parsed=notionProductionProfileSchema.safeParse(profileDraft);
  if(!parsed.success){setProfileError(new Error(parsed.error.issues[0]?.message??'제작 기준을 확인해 주세요.'));return;}
  const controller=new AbortController();profileRequest.current?.abort();profileRequest.current=controller;
  setProfileBusy(true);setProfileError(null);setProfileMessage('');
  try{const record=await api<NotionProductionProfileRecord>(`/notion/links/${data.link.id}/production-profile`,{method:'PUT',body:{version:profile.version,profile:parsed.data},signal:controller.signal});if(controller.signal.aborted||profileRequest.current!==controller||identityRef.current!==capturedIdentity)return;setProfile(record);setProfileDraft(structuredClone(record.profile));setProfileMessage('우리 채널 제작 기준을 저장했어요. 다음 수정 요청부터 참고합니다.');}
  catch(e){if(!controller.signal.aborted)setProfileError(e);}
  finally{if(profileRequest.current===controller){profileRequest.current=null;setProfileBusy(false);}}
 };
 const send=async()=>{
  const instruction=activeMemory.input.trim();if(!instruction||!chatAvailable)return;
  const captured=context,before=selectedText(data,draft,selectedPage),id=++sequence.current,controller=new AbortController();
  request.current={id,controller,input:instruction};setBusy(true);setError(null);setNotice('');setProposal(null);
  append({role:'user',page:selectedPage,text:instruction.slice(0,1200)});setInput('');
  try{
   const received=await api<NotionConversationResult>(`/notion/links/${data.link.id}/conversation`,{method:'POST',body:{version:data.link.version,itemVersion:data.itemVersion,copy:draft.copy,designEdits:draft.designEdits,page:selectedPage,instruction,history:activeMemory.messages.slice(-6).map(m=>({role:m.role,text:(m.contextText??m.text).slice(0,1200)}))},signal:controller.signal});
   if(controller.signal.aborted||sequence.current!==id||latest.current.context!==captured||latest.current.disabled)return;
   const checked=notionConversationResultSchema.safeParse(received);if(!checked.success)throw new Error('수정안을 읽지 못했어요. 현재 원고는 유지했으니 다시 요청해 주세요.');
   const result=checked.data;
   if(result.page!==selectedPage||result.sourceSignature!==latest.current.signature)throw new Error('현재 카드와 제안의 기준이 달라 적용하지 않았어요. 다시 요청해 주세요.');
   setProposal({result,context:captured,before});append({role:'assistant',page:selectedPage,text:result.summary.slice(0,1200),contextText:[result.summary,`제안 제목: ${result.patch.title}`,`제안 본문: ${result.patch.body}`].join('\n').slice(0,1200)});
  }catch(e){if(!controller.signal.aborted&&sequence.current===id){setError(e);setMemory(current=>current.identity===identity&&current.input?current:{...((current.identity===identity)?current:{...emptyMemory(),identity}),input:instruction});}}
  finally{if(request.current?.id===id){request.current=null;setBusy(false);}}
 };
 const cancel=()=>{
  const pending=request.current;if(!pending)return;pending.controller.abort();request.current=null;sequence.current++;setBusy(false);setError(null);setNotice('요청을 멈췄어요. 부탁한 내용을 고쳐 다시 보낼 수 있어요.');
  setMemory(current=>current.identity===identity&&current.input?current:{...((current.identity===identity)?current:{...emptyMemory(),identity}),input:pending.input});
 };
 const apply=()=>{
  if(!proposal||disabled||busy||proposal.context!==latest.current.context||proposal.result.sourceSignature!==latest.current.signature){setProposal(null);setNotice('원고가 바뀌어 이전 제안은 적용하지 않았어요.');return;}
  if(latest.current.onApply(proposal.result)){setProposal(null);setNotice('이 장에 적용했어요. 미리보기를 확인하고 스튜디오에 저장해 주세요.');}
  else setNotice('카드가 바뀌어 적용하지 않았어요. 현재 카드에서 다시 요청해 주세요.');
 };
 const quickPrompts=selectedPage===0?['제목을 더 궁금하게 써줘','제목을 조금 더 짧게','강조할 말을 골라줘']:['조금 더 편안한 말투로','핵심만 남겨 짧게','단계도로 정리해줘'];
 return <section className="notion-conversation stack" aria-label="카드 대화 편집">
  <header className="row between"><div><h3>말로 수정하기</h3><p className="small muted">카드를 고르고, 바꾸고 싶은 부분을 말씀해 주세요.</p></div><span className="badge">{editable?`${selectedPage+1}장`:'본문 카드 선택'}</span></header>
  <details className="notion-production-profile" onToggle={event=>{profileOpen.current=event.currentTarget.open;if(event.currentTarget.open&&!profile&&!profileBusy)void loadProfile();}}>
   <summary>우리 채널 제작 기준 <span className="small muted">말투 · 디자인 · 참고 글</span></summary>
   <div className="stack">{profileBusy&&!profile&&<p className="small muted" role="status">저장된 기준을 불러오고 있어요…</p>}
    {profileDraft&&profileOwner===identity&&<>{profileFields.map(field=><label className="field" key={field.key}>{field.label}{field.rows===1?<input aria-label={field.label} value={profileDraft[field.key]} maxLength={field.max} placeholder={field.placeholder} disabled={disabled||busy||profileBusy} onChange={event=>setProfileDraft({...profileDraft,[field.key]:event.target.value})}/>:<textarea aria-label={field.label} value={profileDraft[field.key]} rows={field.rows} maxLength={field.max} placeholder={field.placeholder} disabled={disabled||busy||profileBusy} onChange={event=>setProfileDraft({...profileDraft,[field.key]:event.target.value})}/>}</label>)}
     <p className="small muted">Canva 링크는 참고용으로 보관해요. 직접 고친 디자인의 특징은 ‘디자인 기준’에도 적어 주세요.</p>
     <div className="row"><button type="button" className="btn sm" disabled={disabled||busy||profileBusy||!profileDirty} onClick={()=>void saveProfile()}>{profileBusy?'저장하는 중…':'제작 기준 저장'}</button>{profileDirty&&<button type="button" className="btn sm" disabled={profileBusy||busy} onClick={()=>{setProfileDraft(profile?structuredClone(profile.profile):null);setProfileError(null);}}>변경 취소</button>}</div>
    </>}
    {!!profileError&&<ErrorBox error={profileError} retry={()=>void loadProfile()}/>} {profileMessage&&<p className="small notion-conversation-success" role="status">{profileMessage}</p>}
   </div>
  </details>
  {activeMemory.messages.length>0&&<div className="notion-conversation-messages" role="log" aria-label="카드 수정 대화" aria-live="polite">{activeMemory.messages.map(message=><div className={`notion-conversation-message is-${message.role}`} key={message.id}><span>{message.role==='user'?'내 요청':'수정 제안'} · {message.page+1}장</span><p>{message.text}</p></div>)}</div>}
  {!editable&&<p className="notice small">본문 카드를 선택하면 말로 수정할 수 있어요.</p>}
  <div className="notion-conversation-scope"><span className="small muted">{editable?`${selectedPage+1}장 수정 중`:'선택한 카드'}</span>{title&&<strong>{title}</strong>}</div>
  <div className="notion-conversation-prompts">{quickPrompts.map(prompt=><button type="button" className="btn sm" key={prompt} disabled={!chatAvailable} onClick={()=>{setInput(prompt);setNotice('');}}>{prompt}</button>)}</div>
  <label className="field">어떻게 바꿀까요?<textarea aria-label="카드 수정 요청" rows={3} maxLength={2000} value={activeMemory.input} disabled={!editable||disabled||busy||profileBusy} placeholder="예: 조금 덜 딱딱하게, 제가 겪은 일처럼 써줘. 마지막 문장은 그대로 둬." onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void send();}}}/></label>
  {profileDirty&&<p className="small muted">바꾼 제작 기준을 먼저 저장해 주세요.</p>}
  <div className="row between"><div className="row"><button type="button" className="btn" disabled={!chatAvailable||!activeMemory.input.trim()} onClick={()=>void send()}>{busy?'수정안을 만들고 있어요…':`${selectedPage+1}장 수정 부탁하기`}</button>{busy&&<button type="button" className="btn sm" onClick={cancel}>요청 멈추기</button>}</div><span className="small muted">{activeMemory.input.length.toLocaleString()} / 2,000</span></div>
  {!!error&&<ErrorBox error={error}/>} {notice&&<p className="small muted" role="status">{notice}</p>}
  {proposal&&<section className="notion-conversation-proposal stack" aria-label="선택한 카드 수정안"><div><strong>{proposal.result.page+1}장 수정안</strong><p className="small">{proposal.result.summary}</p></div><div className="notion-conversation-diff"><div><span className="small muted">현재</span><h4>{proposal.before.title}</h4><p>{proposal.before.subtitle}</p></div><div><span className="small muted">수정안</span><h4>{proposal.result.patch.title}</h4><p>{proposal.result.patch.body}</p></div></div>
    {proposal.result.patch.emphasis&&<p className="small">형광펜 강조: <mark>{proposal.result.patch.emphasis}</mark></p>}
    {proposal.result.patch.template&&<p className="small muted">내지: {notionInteriorTemplateCatalog.find(item=>item.id===proposal.result.patch.template)?.label}</p>}
    <div className="row"><button type="button" className="btn" disabled={disabled||busy} onClick={apply}>이 장에 적용</button><button type="button" className="btn sm" onClick={()=>{setProposal(null);setNotice('제안을 접었어요. 현재 원고는 그대로예요.');}}>제안 접기</button></div>
   </section>}
  <div className="row between notion-conversation-footer">{onUndo&&<button type="button" className="btn sm" disabled={!canUndo||disabled||busy} onClick={()=>{onUndo();setProposal(null);setNotice('직전 대화 수정을 되돌렸어요.');}}>직전 수정 되돌리기</button>}{activeMemory.messages.length>0&&<button type="button" className="btn sm" disabled={busy} onClick={()=>{setMemory(current=>({...((current.identity===identity)?current:{...emptyMemory(),identity}),messages:[]}));setProposal(null);setNotice('이 카드뉴스의 대화를 비웠어요. 원고는 그대로예요.');}}>대화 비우기</button>}</div>
  {storageIssue?<p className="small muted">이 기기에 대화를 보관하지 못했어요. 현재 대화는 이 화면에 남아 있어요.</p>:scope&&activeMemory.messages.length>0?<p className="small muted">이 기기에 최근 대화를 보관해요. 수정안을 적용한 뒤 스튜디오에 저장해 주세요.</p>:null}
 </section>;
}
