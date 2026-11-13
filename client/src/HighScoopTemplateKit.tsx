import {useState,type CSSProperties} from 'react';
import {HIGH_SCOOP_TEMPLATE_KITS,HIGH_SCOOP_TEMPLATE_VERSION,highScoopTemplateForKey,type HighScoopTemplateKit as Kit} from '@shared/highscoopTemplates';
import './highScoopTemplateKit.css';

function MasterPreview({kit}:{kit:Kit}){
 const [failed,setFailed]=useState(false);
 return <div className="highscoop-kit-preview">{!failed&&kit.thumbnailUrl?<img src={kit.thumbnailUrl} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<div className="highscoop-kit-preview-fallback" aria-hidden="true"><span>{kit.category}</span><b>HighScoop</b><i/><i/></div>}</div>;
}

/** Category selection changes only the editable draft; the ordinary Save action
 * keeps preview, persistence and Canva auto-save on the same source revision. */
export function HighScoopTemplateKit({value,onSelect,disabled=false,compact=false,selectionHint}:{value?:string;onSelect?:(key:string)=>void;disabled?:boolean;compact?:boolean;selectionHint?:string}){
 const current=highScoopTemplateForKey(value),[previewKey,setPreviewKey]=useState<string|null>(null);
 const shown=(!onSelect?highScoopTemplateForKey(previewKey):undefined)??current;
 const active=onSelect?current:shown;
 return <section className={`highscoop-template-kit stack${compact?' is-compact':''}`} aria-label="하이스쿱 카테고리 마스터">
  <div><h3>카테고리별 마스터</h3><p className="small muted">카테고리마다 하나씩, 같은 내지 종류를 각 포인트 컬러로 사용합니다.</p></div>
  <div className="highscoop-kit-grid" role="group" aria-label="하이스쿱 마스터 6종">
   {HIGH_SCOOP_TEMPLATE_KITS.map(kit=><article className={`highscoop-kit-card${active?.key===kit.key?' is-selected':''}`} key={kit.key} style={{'--kit-color':kit.color,'--kit-soft':kit.soft,'--kit-accent':kit.accent} as CSSProperties}>
    <button type="button" aria-label={`${kit.category} 마스터 ${onSelect?'선택':'미리보기'}`} aria-pressed={active?.key===kit.key} disabled={disabled} onClick={()=>{setPreviewKey(kit.key);onSelect?.(kit.key);}}>
     <MasterPreview kit={kit}/><span className="highscoop-kit-category"><i aria-hidden="true"/>{kit.category}</span>{onSelect&&current?.key===kit.key&&<small>선택됨</small>}
    </button>
    {kit.canvaEditUrl?<a href={kit.canvaEditUrl} target="_blank" rel="noreferrer">Canva 원본 ↗</a>:<span className="highscoop-kit-unavailable">Canva 원본 준비 중</span>}
   </article>)}
  </div>
  {shown&&<div className="highscoop-kit-layouts"><strong>{shown.category} · 내지 종류</strong><p className="small muted">{shown.layoutLabels.join(' · ')}</p>{(!compact||!onSelect)&&shown.overviewUrl&&<a className="btn sm" href={shown.overviewUrl} target="_blank" rel="noreferrer">내지 모아보기 ↗</a>}</div>}
  <p className="small muted">{selectionHint??(onSelect?'선택한 컬러는 미리보기에서 확인한 뒤 ‘스튜디오에 저장’으로 적용하세요. 각 카드의 내지 종류는 아래에서 고릅니다.':'스튜디오로 가져온 원고에서 카테고리와 페이지별 내지를 선택할 수 있습니다.')} <span className="highscoop-kit-version">{HIGH_SCOOP_TEMPLATE_VERSION}</span></p>
 </section>;
}
