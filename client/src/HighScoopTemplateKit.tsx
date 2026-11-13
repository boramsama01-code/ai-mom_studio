import {useState,type CSSProperties} from 'react';
import {HIGH_SCOOP_TEMPLATE_KITS,HIGH_SCOOP_TEMPLATE_VERSION,highScoopTemplateForKey,type HighScoopTemplateKit as Kit} from '@shared/highscoopTemplates';
import type {TemplateOption} from '@shared/templateCatalog';
import {editorialTemplateForKey,isCurrentEditorialTemplate} from '@shared/editorialTemplates';
import './highScoopTemplateKit.css';

type DisplayKit=Pick<Kit,'key'|'category'|'color'|'soft'|'accent'|'thumbnailUrl'|'overviewUrl'|'canvaEditUrl'> & {layoutLabels:readonly string[]};
function MasterPreview({kit,brandName}:{kit:DisplayKit;brandName:string}){
 const [failed,setFailed]=useState(false);
 return <div className="highscoop-kit-preview">{!failed&&kit.thumbnailUrl?<img src={kit.thumbnailUrl} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<div className="highscoop-kit-preview-fallback" aria-hidden="true"><span>{kit.category}</span><b>{brandName}</b><i/><i/></div>}</div>;
}

/** Category selection changes only the editable draft; the ordinary Save action
 * keeps preview, persistence and Canva auto-save on the same source revision. */
export function HighScoopTemplateKit({value,onSelect,disabled=false,compact=false,selectionHint,items,brandName='HighScoop',previewUrlFor}:{value?:string;onSelect?:(key:string)=>void;disabled?:boolean;compact?:boolean;selectionHint?:string;items?:readonly TemplateOption[];brandName?:string;previewUrlFor?:(key:string)=>string}){
 const kits:readonly DisplayKit[]=items?items.filter(item=>isCurrentEditorialTemplate(item.key)).map((item,index)=>{
  const palette=editorialTemplateForKey(item.key),fallback=HIGH_SCOOP_TEMPLATE_KITS[index%HIGH_SCOOP_TEMPLATE_KITS.length];
  return {key:item.key,category:item.category??item.name,color:item.color??palette?.color??fallback.color,soft:item.soft??palette?.soft??fallback.soft,accent:item.accent??palette?.accent??fallback.accent,
   thumbnailUrl:previewUrlFor?.(item.key)??item.thumbnailUrl??'',overviewUrl:previewUrlFor?'':item.overviewUrl??'',canvaEditUrl:item.canvaEditUrl??null,layoutLabels:item.pageLabels??fallback.layoutLabels};
 }):HIGH_SCOOP_TEMPLATE_KITS;
 const resolve=(key:string|undefined|null)=>kits.find(kit=>kit.key===key)||(key? kits.find(kit=>editorialTemplateForKey(kit.key)?.colorId===editorialTemplateForKey(key)?.colorId):undefined)||(kits.length===1&&isCurrentEditorialTemplate(key)?kits[0]:undefined);
 const current=resolve(value),[previewKey,setPreviewKey]=useState<string|null>(null);
 const shown=(!onSelect?resolve(previewKey):undefined)??current;
 const active=onSelect?current:shown;
 const isHighScoop=brandName==='HighScoop';
 return <section className={`highscoop-template-kit stack${compact?' is-compact':''}`} aria-label={isHighScoop?'하이스쿱 카테고리 마스터':`${brandName} 카테고리 마스터`} data-testid="current-template-kit">
  <div><h3>{kits.length===1?'뉴스 마스터':'카테고리별 마스터'}</h3><p className="small muted">{kits.length===1?'뉴스 태그와 시안 컬러로 통일하고, 콘텐츠에 맞춰 내지를 고릅니다.':'카테고리마다 하나씩, 같은 내지 종류를 각 포인트 컬러로 사용합니다.'}</p></div>
  <div className={`highscoop-kit-grid${kits.length===1?' is-single':''}`} role="group" aria-label={`${isHighScoop?'하이스쿱':brandName} 마스터 ${kits.length}종`}>
   {kits.map(kit=><article className={`highscoop-kit-card${active?.key===kit.key?' is-selected':''}`} key={kit.key} style={{'--kit-color':kit.color,'--kit-soft':kit.soft,'--kit-accent':kit.accent} as CSSProperties}>
    <button type="button" aria-label={`${kit.category} 마스터 ${onSelect?'선택':'미리보기'}`} aria-pressed={active?.key===kit.key} disabled={disabled} onClick={()=>{setPreviewKey(kit.key);onSelect?.(kit.key);}}>
     <MasterPreview kit={kit} brandName={brandName}/><span className="highscoop-kit-category"><i aria-hidden="true"/>{kit.category}</span>{onSelect&&current?.key===kit.key&&<small>선택됨</small>}
    </button>
    {kit.canvaEditUrl?<a href={kit.canvaEditUrl} target="_blank" rel="noreferrer">Canva 원본 ↗</a>:!items&&<span className="highscoop-kit-unavailable">Canva 원본 준비 중</span>}
   </article>)}
  </div>
  {shown&&<div className="highscoop-kit-layouts"><strong>{shown.category} · 내지 종류</strong><p className="small muted">{shown.layoutLabels.join(' · ')}</p>{(!compact||!onSelect)&&shown.overviewUrl&&<a className="btn sm" href={shown.overviewUrl} target="_blank" rel="noreferrer">내지 모아보기 ↗</a>}</div>}
  <p className="small muted">{selectionHint??(onSelect?'선택한 컬러는 미리보기에서 확인한 뒤 ‘스튜디오에 저장’으로 적용하세요. 각 카드의 내지 종류는 아래에서 고릅니다.':'스튜디오로 가져온 원고에서 카테고리와 페이지별 내지를 선택할 수 있습니다.')} <span className="highscoop-kit-version">{HIGH_SCOOP_TEMPLATE_VERSION}</span></p>
 </section>;
}
