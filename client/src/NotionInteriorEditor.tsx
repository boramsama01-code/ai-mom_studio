import {z} from 'zod';
import {notionInteriorTemplateCatalog,notionInteriorTemplates,type NotionInteriorTemplate} from '@shared/notionPageTemplates';
import type {NotionStudioPhoto} from '@shared/notionStudio';

// Keep over-limit drafts recoverable too; the explicit Apply action validates fit.
export const interiorInputSchema=z.object({template:z.enum(notionInteriorTemplates),source:z.string().max(30000),intro:z.string().max(200),headers:z.array(z.string().max(30000)).max(4),rows:z.array(z.array(z.string().max(30000)).max(7)).max(10),left:z.string().max(30000),right:z.string().max(30000),regional:z.boolean(),edited:z.boolean()}).strict();
export const interiorInputsSchema=z.record(z.string().min(1).max(230),interiorInputSchema).refine(v=>Object.keys(v).length<=140);
export type InteriorInput=z.infer<typeof interiorInputSchema>;
export type InteriorInputs=z.infer<typeof interiorInputsSchema>;
const labels=Object.fromEntries(notionInteriorTemplateCatalog.map(t=>[t.id,t.label]));
const structured=new Set<NotionInteriorTemplate>(['two_columns','table','process','timeline','bar_chart']);
export const isStructuredInterior=(template?:NotionInteriorTemplate)=>!!template&&structured.has(template);
const datePart=(value:string)=>value.split(' ')[0]??'';
const timePart=(value:string)=>value.split(' ').slice(1).join(' ');
const dateTime=(date:string,time:string)=>[date.trim(),time.trim()].filter(Boolean).join(' ');
const empty=(template:NotionInteriorTemplate,source:string):InteriorInput=>({template,source,intro:'',headers:template==='table'?['','']:[],rows:template==='timeline'?[['','','','','','','학생 접수']]:template==='process'?[['',''],['','']]:[['','']],left:'',right:'',regional:true,edited:false});
function read(template:NotionInteriorTemplate,body:string):{input:InteriorInput;compatible:boolean}{
 const input=empty(template,body);
 if(template==='two_columns'){const columns=body.split('\n---\n');if(columns.length===2&&columns.every(v=>v.trim()))return {input:{...input,left:columns[0],right:columns[1]},compatible:true};return {input,compatible:false};}
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(l=>l.trim()).filter(Boolean);
 if((template==='table'||template==='timeline')&&lines[0]&&!lines[0].includes('|'))input.intro=lines.shift()!;
 const grid=lines.map(line=>line.split('|').map(s=>s.trim())),header=grid.shift();
 if(template==='table'&&header&&header.length>=2&&header.length<=4&&header.every(Boolean)&&grid.length>=1&&grid.length<=8&&grid.every(row=>row.length===header.length&&row.every(Boolean)))return {input:{...input,headers:header,rows:grid},compatible:true};
 if(template==='process'&&header?.join('|')==='단계|내용'&&grid.length>=2&&grid.length<=5&&grid.every(row=>row.length===2&&row.every(Boolean)))return {input:{...input,rows:grid},compatible:true};
 if(template==='bar_chart'&&header?.join('|')==='항목|값'&&grid.length>=1&&grid.length<=8&&grid.every(row=>row.length===2&&row.every(Boolean)))return {input:{...input,rows:grid},compatible:true};
 if(template==='timeline'&&header&&['지역|기관·과정|시작일|마감일|구분','기관·과정|시작일|마감일|구분'].includes(header.join('|'))&&grid.length>=1&&grid.length<=10&&grid.every(row=>row.length===header.length)){
  const regional=header.length===5,rows=grid.map(row=>{const [region,label,start,end,kind]=regional?row:['',...row];return [region,label,datePart(start),timePart(start),datePart(end),timePart(end),kind];});
  return {input:{...input,regional,rows},compatible:true};
 }
 return {input:empty(template,body),compatible:false};
}
export const isInteriorTemplateCompatible=(template:NotionInteriorTemplate,body:string):boolean=>!isStructuredInterior(template)||read(template,body).compatible;
function serialize(input:InteriorInput):string{
 if(input.template==='two_columns')return input.left+'\n---\n'+input.right;
 const rows=input.rows.map(row=>input.template==='timeline'?[...(input.regional?[row[0]]:[]),row[1],dateTime(row[2],row[3]),dateTime(row[4],row[5]),row[6]]:row);
 const header=input.template==='table'?input.headers:input.template==='process'?['단계','내용']:input.template==='bar_chart'?['항목','값']:input.regional?['지역','기관·과정','시작일','마감일','구분']:['기관·과정','시작일','마감일','구분'];
 return [...(input.intro?[input.intro]:[]),header.join(' | '),...rows.map(row=>row.join(' | '))].join('\n');
}
function valid(input:InteriorInput):string{
 if(input.template==='two_columns')return input.left.trim()&&input.right.trim()&&!input.left.includes('\n---\n')&&!input.right.includes('\n---\n')?'':'왼쪽과 오른쪽 본문을 모두 입력해 주세요.';
 if(input.intro.includes('|')||input.intro.includes('\n'))return '짧은 설명은 한 줄로 입력해 주세요.';
 if(input.template==='table'&&input.headers.some(v=>!v.trim()))return '열 머리글을 모두 입력해 주세요.';
 if(input.template==='timeline'){
  for(const row of input.rows){if((input.regional?!row[0].trim():!row[1].trim())||!row[2]||!row[4]||!row[6])return '지역 또는 기관과 시작일·마감일을 입력해 주세요.';
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row[2])||!/^\d{4}-\d{2}-\d{2}$/.test(row[4]))return '시작일과 마감일을 날짜 선택기로 입력해 주세요.';
   if(row[2]>row[4])return '마감일이 시작일보다 빠릅니다.';
   if(row[3]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[3])||row[5]&&!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(row[5]))return '시각은 확인된 HH:mm만 입력하고, 미기재면 비워 두세요.';
  }
 }else if(input.rows.some(row=>row.some(v=>!v.trim())))return '빈칸 없이 각 항목을 입력해 주세요.';
 if(input.template==='bar_chart'&&input.rows.some(row=>!/^\d+(?:\.\d+)?$/.test(row[1])||!Number.isFinite(Number(row[1]))))return '값은 0 이상의 숫자로 입력해 주세요. 단위는 제목·설명에 적을 수 있어요.';
 if([...input.headers,...input.rows.flat()].some(v=>v.includes('|')||v.includes('\n')))return '각 칸에는 한 줄씩 입력해 주세요. | 기호는 칸을 나누는 데 사용돼요.';
 return '';
}

export function NotionInteriorTemplatePicker({value,onChange,disabled,photos,photoId,defaultPhoto,onPhotoChange}:{value?:NotionInteriorTemplate;onChange:(value?:NotionInteriorTemplate)=>void;disabled:boolean;photos:NotionStudioPhoto[];photoId?:number;defaultPhoto?:NotionStudioPhoto;onPhotoChange:(id?:number)=>void}){
 const item=notionInteriorTemplateCatalog.find(t=>t.id===value),stale=photoId!==undefined&&!photos.some(photo=>photo.id===photoId);
 return <div className="notion-interior-picker stack">
  <label className="field">내지 템플릿<select aria-label="내지 템플릿" value={value??'auto'} disabled={disabled} onChange={event=>onChange(event.target.value==='auto'?undefined:event.target.value as NotionInteriorTemplate)}><option value="auto">기존 원고 형식 유지</option>{notionInteriorTemplateCatalog.map(template=><option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
  <div className="notion-interior-choice"><span className={`notion-template-mini template-${value??'auto'}`} aria-hidden="true"><i/><i/><i/><i/></span><div><strong>{item?.label??'기존 원고 형식 유지'}</strong><p className="small muted">{item?.description??'노션 원고에 지정된 사진·도식 배치를 사용합니다.'}</p></div></div>
  <p className="small muted">템플릿 선택·입력·미리보기에는 AI를 사용하지 않습니다.</p>
  {value==='image_text'&&<div className="stack"><label className="field">페이지 사진<select aria-label="페이지 사진" disabled={disabled} value={photoId??''} onChange={event=>onPhotoChange(event.target.value?Number(event.target.value):undefined)}><option value="">{defaultPhoto?`순서에 따라 자동 선택 · ${defaultPhoto.name}`:'사진을 선택하세요'}</option>{stale&&<option value={photoId} disabled>사용할 수 없는 사진 · 다시 선택하세요</option>}{photos.map(photo=><option key={photo.id} value={photo.id}>{photo.name}</option>)}</select></label>{!photos.length&&<p className="notice warn">노션 ‘사진 원본’에 사진을 올린 뒤 가져와 주세요.</p>}{stale&&<p className="notice warn" role="alert">이전에 고른 사진이 현재 연결에 없습니다. 사진을 다시 선택해 주세요.</p>}{(photos.find(photo=>photo.id===photoId)??(!photoId?defaultPhoto:undefined))&&<img className="notion-interior-photo" src={(photos.find(photo=>photo.id===photoId)??defaultPhoto)!.url} alt="선택한 페이지 사진"/>}</div>}
 </div>;
}

export function NotionInteriorEditor({template,body,limit,disabled,buffer,onBuffer,onApply,rawEditor}:{template:NotionInteriorTemplate;body:string;limit:number;disabled:boolean;buffer?:InteriorInput;onBuffer:(value:InteriorInput|null)=>void;onApply:(body:string)=>void;rawEditor:React.ReactNode}){
 const parsed=read(template,body),input=buffer??parsed.input,error=valid(input),serialized=serialize(input),tooLong=[...serialized].length>limit,stale=!!buffer&&buffer.source!==body;
 const set=(next:InteriorInput)=>onBuffer({...next,edited:true});
 const cell=(row:number,col:number,value:string)=>set({...input,rows:input.rows.map((values,i)=>i===row?values.map((old,j)=>j===col?value:old):values)});
 const minRows=template==='process'?2:1,maxRows=template==='timeline'?10:template==='process'?5:8;
 const blank=()=>template==='timeline'?['','','','','','','학생 접수']:Array.from({length:template==='table'?input.headers.length:2},()=> '');
 const label=labels[template],applyLabel=template==='two_columns'?'2단 내용 적용':`${label} 내용 적용`;
 return <div className="notion-interior-form stack" aria-label={`${label} 구성 입력`}>
  {!parsed.compatible&&<p className="notice">기존 원고를 유지했습니다. 아래 칸에 내용을 정리한 뒤 ‘{applyLabel}’을 눌러 주세요.</p>}
  {stale&&<p className="notice warn">원고가 바뀌었어요. 작성 중인 구성 입력은 유지했습니다. 현재 원고를 다시 불러오려면 구성 입력을 취소하세요.</p>}
  {template==='two_columns'?<div className="notion-two-column-inputs"><label className="field">왼쪽 본문<textarea aria-label="왼쪽 본문" rows={7} value={input.left} disabled={disabled} onChange={event=>set({...input,left:event.target.value})}/></label><label className="field">오른쪽 본문<textarea aria-label="오른쪽 본문" rows={7} value={input.right} disabled={disabled} onChange={event=>set({...input,right:event.target.value})}/></label></div>:<>
   {(template==='table'||template==='timeline')&&<label className="field">짧은 설명<input aria-label="구성 짧은 설명" value={input.intro} maxLength={200} disabled={disabled} onChange={event=>set({...input,intro:event.target.value})}/></label>}
   {template==='table'&&<><div className="row between"><strong>열 머리글</strong><div className="row"><button type="button" className="btn sm" disabled={disabled||input.headers.length>=4} onClick={()=>set({...input,headers:[...input.headers,''],rows:input.rows.map(row=>[...row,''])})}>열 추가</button><button type="button" className="btn sm" disabled={disabled||input.headers.length<=2} onClick={()=>set({...input,headers:input.headers.slice(0,-1),rows:input.rows.map(row=>row.slice(0,-1))})}>마지막 열 삭제</button></div></div><div className="notion-table-headers" style={{gridTemplateColumns:`repeat(${input.headers.length},minmax(0,1fr))`}}>{input.headers.map((header,col)=><label className="field" key={col}>{col+1}열 머리글<input aria-label={`${col+1}열 머리글`} value={header} disabled={disabled} onChange={event=>set({...input,headers:input.headers.map((v,i)=>i===col?event.target.value:v)})}/></label>)}</div><p className="small muted">표 글자는 가운데 정렬됩니다. 첫 열이 ‘지역’이면 같은 지역의 연속 셀을 병합합니다.</p></>}
   {template==='timeline'&&<><label className="notion-toggle small"><input type="checkbox" aria-label="지역 열 사용" checked={input.regional} disabled={disabled} onChange={event=>set({...input,regional:event.target.checked})}/>지역 열 사용</label><p className="small muted">원문에서 확인된 시작일·마감일만 입력하세요. 시각이 없으면 비워 둡니다.</p></>}
   <div className="notion-interior-rows">{input.rows.map((row,index)=><fieldset className="notion-interior-row" key={index}><legend>{template==='process'?`${index+1}단계`:`${index+1}행`}</legend>
    {template==='timeline'?<><div className="notion-input-pair">{input.regional&&<label className="field">지역<input aria-label={`${index+1}행 지역`} value={row[0]} disabled={disabled} onChange={event=>cell(index,0,event.target.value)}/></label>}<label className="field">기관·과정<input aria-label={`${index+1}행 기관·과정`} value={row[1]} disabled={disabled} onChange={event=>cell(index,1,event.target.value)}/></label></div><div className="notion-input-pair"><label className="field">시작일<input type="date" aria-label={`${index+1}행 시작일`} min="1900-01-01" max="2199-12-31" value={row[2]} disabled={disabled} onChange={event=>cell(index,2,event.target.value)}/></label><label className="field">시작 시각 (선택)<input aria-label={`${index+1}행 시작 시각`} value={row[3]} maxLength={5} placeholder="미기재면 비워 두세요" disabled={disabled} onChange={event=>cell(index,3,event.target.value)}/></label></div><div className="notion-input-pair"><label className="field">마감일<input type="date" aria-label={`${index+1}행 마감일`} min="1900-01-01" max="2199-12-31" value={row[4]} disabled={disabled} onChange={event=>cell(index,4,event.target.value)}/></label><label className="field">마감 시각 (선택)<input aria-label={`${index+1}행 마감 시각`} value={row[5]} maxLength={5} placeholder="미기재면 비워 두세요" disabled={disabled} onChange={event=>cell(index,5,event.target.value)}/></label></div><label className="field">접수 구분<select aria-label={`${index+1}행 접수 구분`} value={row[6]} disabled={disabled} onChange={event=>cell(index,6,event.target.value)}>{['학생 접수','추가 모집','사전 제출','연계 접수'].map(kind=><option key={kind}>{kind}</option>)}</select></label></>:<div className={template==='table'?'notion-table-headers':'notion-input-pair'} style={template==='table'?{gridTemplateColumns:`repeat(${input.headers.length},minmax(0,1fr))`}:undefined}>{row.map((value,col)=><label className="field" key={col}>{template==='table'?(input.headers[col]||`${col+1}열`):template==='process'?(col?'설명':'단계 이름'):(col?'값':'항목')}<input aria-label={`${index+1}행 ${col+1}열`} value={value} inputMode={template==='bar_chart'&&col===1?'decimal':undefined} disabled={disabled} onChange={event=>cell(index,col,event.target.value)}/></label>)}</div>}
    <button type="button" className="btn sm" disabled={disabled||input.rows.length<=minRows} onClick={()=>set({...input,rows:input.rows.filter((_,i)=>i!==index)})}>{index+1}{template==='process'?'단계':'행'} 삭제</button>
   </fieldset>)}</div>
   <button type="button" className="btn sm" disabled={disabled||input.rows.length>=maxRows} onClick={()=>set({...input,rows:[...input.rows,blank()]})}>{template==='process'?'단계 추가':'행 추가'}</button>
   <p className="small muted">{template==='process'?'2~5단계':`최대 ${maxRows}행`}{template==='table'?' · 2~4열':''}{template==='bar_chart'?' · 0 이상의 숫자':''}</p>
  </>}
  {buffer?.edited&&error&&<p className="small notion-input-error" role="alert">{error}</p>}{tooLong&&<p className="notice warn" role="alert">구성 내용이 {limit}자를 넘었어요. 내용을 줄이거나 다른 장에 나눠 주세요. 문구는 자르지 않았습니다.</p>}
  <div className="row"><button type="button" className="btn" disabled={disabled||!!error||tooLong||!buffer?.edited} onClick={()=>{onApply(serialized);onBuffer(null);}}>{applyLabel}</button>{buffer&&<button type="button" className="btn sm" disabled={disabled} onClick={()=>onBuffer(null)}>구성 입력 취소</button>}</div>
  <p className="small muted">입력한 구성은 ‘{applyLabel}’을 눌러 미리보기에 반영한 뒤 저장하세요.</p>
  <details className="notion-raw-editor" open={!parsed.compatible}><summary>원고 직접 편집{!parsed.compatible?' · 기존 원고 확인':''}</summary>{rawEditor}</details>
 </div>;
}
