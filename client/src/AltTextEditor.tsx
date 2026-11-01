import { useState } from "react";
import { ALT_TEXT_LIMIT } from "@shared/altText";
import { useToast } from "./toast";
export function AltTextEditor({values,change,disabled=false,selected,onSelect,defaults}:{values:string[];change:(index:number,value:string)=>void;disabled?:boolean;selected?:number;onSelect?:(index:number)=>void;defaults?:string[]}){
 const [picked,setPicked]=useState(0),toast=useToast(),index=Math.max(0,Math.min(selected??picked,values.length-1)),value=values[index]??"";
 if(!values.length)return null;
 return <details open className="panel stack alt-text-editor" style={{boxShadow:"none",padding:16}}><summary style={{cursor:"pointer",fontWeight:650}}>페이지별 대체텍스트 · {values.length}개</summary>
  <p className="small muted">이미지를 보지 못하는 사람에게 장면과 카드의 핵심 글을 설명합니다. 초안을 확인하고 실제 사진에 맞게 수정하세요. 사진·본문을 바꾸면 설명도 함께 확인해 주세요.</p>
  <div className="page-dots" role="group" aria-label="대체텍스트 페이지">{values.map((_,i)=><button type="button" className={i<=index?"filled":""} key={i} aria-label={`${i+1}페이지 대체텍스트`} aria-pressed={index===i} onClick={()=>{setPicked(i);onSelect?.(i);}} />)}</div>
  <label className="field">{index+1}페이지 대체텍스트<textarea rows={5} value={value} maxLength={ALT_TEXT_LIMIT} disabled={disabled} onChange={e=>change(index,e.target.value)}/><span className="hint">{value.length} / {ALT_TEXT_LIMIT}자 · 해시태그나 홍보 문구는 넣지 않습니다.</span></label>
  <div className="row">{defaults?.[index]&&<button type="button" className="btn sm" disabled={disabled} onClick={()=>change(index,defaults[index])}>이 페이지 본문으로 초안 채우기</button>}<button type="button" className="btn sm" disabled={!value} onClick={async()=>{try{await navigator.clipboard.writeText(value);toast("ok",`${index+1}페이지 대체텍스트를 복사했습니다.`);}catch{toast("err","대체텍스트를 직접 선택해 복사해 주세요.");}}}>이 페이지 대체텍스트 복사</button></div>
 </details>;
}
