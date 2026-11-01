import { useRef, useState, type TextareaHTMLAttributes } from "react";
import { ALT_TEXT_LIMIT, altTextLength, altTextError, limitAltTextInput } from "@shared/altText";
import { useToast } from "./toast";
type AltTextInputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange" | "maxLength" | "onCompositionStart" | "onCompositionEnd"> & { value: string; change: (value: string) => void };
/** Keep IME composition intact, then apply the shared Unicode limit on commit/paste. */
export function AltTextInput({ value, change, ...props }: AltTextInputProps) {
 const beforeComposition = useRef<string | null>(null);
 const [compositionValue, setCompositionValue] = useState<string | null>(null);
 return <textarea {...props} value={compositionValue ?? value}
  onCompositionStart={() => { beforeComposition.current = value; setCompositionValue(value); }}
  onCompositionEnd={event => {
   const previous = beforeComposition.current ?? value;
   beforeComposition.current = null;
   setCompositionValue(null);
   change(limitAltTextInput(event.currentTarget.value, previous));
  }}
  onChange={event => {
   if (beforeComposition.current !== null) setCompositionValue(event.target.value);
   else change(limitAltTextInput(event.target.value, value));
  }} />;
}
export function AltTextEditor({values,change,disabled=false,selected,onSelect,defaults}:{values:string[];change:(index:number,value:string)=>void;disabled?:boolean;selected?:number;onSelect?:(index:number)=>void;defaults?:string[]}){
 const [picked,setPicked]=useState(0),toast=useToast(),index=Math.max(0,Math.min(selected??picked,values.length-1)),value=values[index]??"",issue=altTextError(value,true);
 if(!values.length)return null;
 return <details open className="panel stack alt-text-editor" style={{boxShadow:"none",padding:16}}><summary style={{cursor:"pointer",fontWeight:650}}>페이지별 대체텍스트 · {values.length}개</summary>
  <p className="small muted">이미지를 보지 못하는 사람에게 장면과 카드의 핵심 글을 설명합니다. 이미지별로 1~2문장, 공백 포함 최대 125자로 적어 주세요. 사진·본문을 바꾸면 설명도 다시 확인해 주세요.</p>
  <div className="page-dots" role="group" aria-label="대체텍스트 페이지">{values.map((_,i)=><button type="button" className={i<=index?"filled":""} key={i} aria-label={`${i+1}페이지 대체텍스트`} aria-pressed={index===i} onClick={()=>{setPicked(i);onSelect?.(i);}} />)}</div>
  <label className="field">{index+1}페이지 대체텍스트<AltTextInput rows={3} value={value} disabled={disabled} change={next=>change(index,next)}/><span className="hint">공백 포함 {altTextLength(value)} / {ALT_TEXT_LIMIT}자 · 1~2문장 · 해시태그 제외</span>{issue && <span role="alert" className="small notice warn">{issue} 기존 설명은 직접 수정하기 전까지 삭제되지 않습니다.</span>}</label>
  <div className="row">{defaults?.[index]&&<button type="button" className="btn sm" disabled={disabled} onClick={()=>change(index,defaults[index])}>이 페이지 본문으로 초안 채우기</button>}<button type="button" className="btn sm" disabled={!value} onClick={async()=>{try{await navigator.clipboard.writeText(value);toast("ok",`${index+1}페이지 대체텍스트를 복사했습니다.`);}catch{toast("err","대체텍스트를 직접 선택해 복사해 주세요.");}}}>이 페이지 대체텍스트 복사</button></div>
 </details>;
}

