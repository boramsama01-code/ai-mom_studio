/** Editable 8-page Canva masters. Approved assets + native type/shapes; no paid AI calls.
 * Design direction: user reference, 2026-11-04, https://brunch.co.kr/@leewooyeon/7.
 * The article's imagery/typefaces/logos are not copied. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=process.cwd(),out=path.resolve(process.argv[2]||'docs/canva-masters');
await fs.mkdir(out,{recursive:true});
const C={charcoal:'#1B2023',green:'#202725',paper:'#F3F0E7',butter:'#F4D66A',muted:'#B9C2BD',rule:'#59605B'};
const brand=`data:image/png;base64,${(await fs.readFile(path.join(root,'assets/branding/space-penguin-company.png'))).toString('base64')}`;
const flat=async color=>`data:image/png;base64,${(await sharp({create:{width:1080,height:1350,channels:3,background:color}}).png().toBuffer()).toString('base64')}`;
const dark=await flat(C.charcoal),green=await flat(C.green);
// Existing original AI-staged repository artwork is only a master placeholder.
// Real article designs use the selected page asset. No text is baked into images.
const topicBytes=await sharp(path.join(root,'assets/card-art/lab.jpg')).resize(1080,1350,{fit:'cover',position:'centre'}).composite([{input:await sharp({create:{width:1080,height:1350,channels:4,background:{r:27,g:32,b:35,alpha:.58}}}).png().toBuffer()}]).png().toBuffer();
const topic=`data:image/png;base64,${topicBytes.toString('base64')}`;
const text=(name,value,x,y,w,h,size=48,color=C.paper,weight=600)=>({type:'text',name,text:value,style:{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,'font-size':`${size}px`,'font-weight':`${weight}`,'line-height':'1.45','text-align':'center',color}});
const rect=(name,x,y,w,h,color)=>({type:'shape',name,style:{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,background:color}});
const image=(name,src,x,y,w,h)=>({type:'img',name,src,style:{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,'object-fit':'contain'}});
const labels=['표지','뉴스 요약','뉴스의 의미','대화의 시작','두 가지 시선','개념을 내 말로','작은 실험','우리 집의 대화'];
const ids=['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'];
const title=(p,value)=>text(`P0${p}_TITLE`,value,90,220,900,160,54,C.paper);
const rule=(name,y,width=880)=>rect(name,(1080-width)/2,y,width,2,C.rule);
function pages(mode,external){
 const bodies=[
  [text('P01_HEADLINE','AI의 답이 맞다면,\n내가 푼 걸까?',80,245,920,420,88,C.butter,700),text('P01_SUBTITLE','도구와 실력 사이, 우리 집의 대화',105,735,870,140,39,C.paper,500)],
  [title(2,'뉴스, 먼저 짚어보기'),text('P02_FACTS','가상의 기사에서 AI 도구의 활용을 소개합니다.\n\n도구 사용과 이해의 차이를 질문합니다.\n\n실제 기사 내용으로 교체할 예시 문구입니다.',115,430,850,580,46,C.paper,500),text('P02_CAVEAT','레이아웃 검수용 가상 예시입니다.',130,1090,820,100,32,C.muted,400)],
  [title(3,'그래서, 우리에게는'),text('P03_TAKEAWAY','정답을 얻는 능력과\n이유를 설명하는 능력은\n같을까?',100,495,880,510,70,C.butter,600)],
  [title(4,'오늘의 중심 질문'),text('P04_SCENARIO','AI의 답을 제출했지만,\n왜 맞는지 설명할 수 없다면?',120,440,840,200,43,C.muted,400),text('P04_QUESTION','나는 그 문제를\n풀었다고 말할 수 있을까?',100,740,880,410,64,C.paper,600)],
  [title(5,'무엇을 기준으로 볼까?'),text('P05_A_LABEL','결과를 기준으로',130,440,820,75,33,C.butter,500),text('P05_A_BODY','도구를 잘 써서\n문제를 해결한 것도 능력이야.',130,550,820,215,45,C.paper,500),rule('P05_DIVIDER',780,600),text('P05_B_LABEL','이해를 기준으로',130,850,820,75,33,C.butter,500),text('P05_B_BODY','내가 설명할 수 있어야\n내 실력이라고 볼 수 있어.',130,960,820,215,45,C.paper,500)],
  mode==='value_definition'
   ?[title(6,'나만의 정의 만들기'),text('P06_CONCEPT','똑똑함',90,365,900,170,50,C.butter,600),text('P06_DEFINITION_A','문제를 해결하는 능력',120,545,840,140,43,C.paper,500),text('P06_DEFINITION_B','모르는 것을 알아채고 배우는 능력',120,695,840,130,43,C.paper,500),text('P06_BOUNDARY_CASE','계산은 느리지만 실수를 잘 고친다면?',120,905,840,135,37,C.muted,400),text('P06_FILL_IN','내가 생각하는 똑똑함은 ___이다.',120,1110,840,125,39,C.butter,500)]
   :[title(6,'정확히 알고, 내 말로'),text('P06_CONCEPT','검증할 과학 개념',90,365,900,170,50,C.butter,600),text('P06_ACCEPTED_DEFINITION','원자료에서 확인한 통용 정의를\n이 위치에 넣습니다.',120,580,840,230,45,C.paper,500),text('P06_EXAMPLE_OR_NON_EXAMPLE','개념의 예시 또는 비예를 비교합니다.',120,905,840,150,40,C.muted,400),text('P06_FILL_IN','내 말로 설명하면 ___이다.',120,1110,840,125,39,C.butter,500)],
  [title(7,'오늘, 한 번 해보기'),...(external
    ?[text('P07_HOME_LABEL','집에서 · 5분',130,435,820,85,33,C.butter,500),text('P07_HOME_ACTION','도구로 얻은 답 하나를 골라\n보지 않고 서로 설명해 보세요.',120,535,840,245,42,C.paper,500),rule('P07_DIVIDER',790,600),text('P07_OPTIONAL_LABEL','확인한 자료로 한 걸음 더',130,855,820,85,32,C.butter,500),text('P07_OPTIONAL_ACTION','검증된 자료를 읽고\n내 설명에서 빠진 점을 찾아보세요.',120,965,840,250,42,C.paper,500)]
    :[text('P07_HOME_LABEL','집에서 · 5분',130,475,820,95,37,C.butter,500),text('P07_HOME_ACTION','도구로 얻은 답 하나를 골라\n보지 않고 서로 설명해 보세요.',110,680,860,370,55,C.paper,500)])],
  [text('P08_BRAND_NAME','ALLligodang',90,245,900,150,94,C.butter,600),text('P08_PARENT_BRAND','우주펭귄상회',180,410,720,80,33,C.muted,400),image('P08_LOGO',brand,365,580,350,262.5),text('P08_BRAND_LINE','오늘의 뉴스, 우리 집의 대화.',100,955,880,110,43,C.paper,500),text('P08_CTA','대화하고 싶은 날을 위해 저장해 주세요.',100,1110,880,100,31,C.paper,400),text('P08_HANDLE','@alligodang.official',150,1220,780,60,27,C.muted,400)]
 ];
 return bodies.map((body,i)=>({id:ids[i],background:i===3||i===5?C.green:C.charcoal,notes:`가상 예시 문구. 원문 기사나 운영자 발언 아님. ${mode}; 외부 활동 ${external?'있음':'없음'}. 기존 원본 AI 연출 이미지 placeholder. 사용자 참고 이미지의 영화 장면과 로고는 사용하지 않음.`,elements:[...(i===0?[image('P01_IMAGE',topic,0,0,1080,1350)]:i<7?[image(`P0${i+1}_BACKGROUND`,i===3||i===5?green:dark,0,0,1080,1350)]:[]),text(`P0${i+1}_HEADER_BRAND`,'ALLligodang',72,75,936,65,30,C.butter,600),rule(`P0${i+1}_HEADER_RULE`,173,900),...body,...(i<7?[text(`P0${i+1}_PAGE_LABEL`,`${labels[i]}  ·  ${String(i+1).padStart(2,'0')} / 08`,90,1250,900,55,25,C.muted,400)]:[])]}));
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
for(const mode of ['value_definition','scientific_explanation'])for(const external of [false,true]){
 const variant=`${mode}-${external?'with-resource':'home-only'}`,layout=pages(mode,external);
 await fs.writeFile(path.join(out,`${variant}.json`),JSON.stringify(layout));
 const body=layout.map((p,i)=>`<section data-document-role="page" data-label="${String(i+1).padStart(2,'0')} ${p.id}" data-speaker-notes="${esc(p.notes)}" style="position:relative;width:1080px;height:1350px;overflow:hidden;background:${p.background};font-family:Pretendard,'Noto Sans KR',sans-serif">${p.elements.map(e=>{const css=`position:absolute;${Object.entries(e.style).map(([k,v])=>`${k}:${v}`).join(';')};white-space:pre-wrap;word-break:keep-all`;return e.type==='img'?`<img data-label="${e.name}" src="${e.src}" alt="${e.name}" style="${css}">`:`<div data-label="${e.name}" style="${css}">${esc(e.text||'')}</div>`}).join('')}</section>`).join('\n');
 await fs.writeFile(path.join(out,`${variant}.html`),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>ALLligodang 읽는 뉴스 · ${variant}</title><body style="margin:0">${body}</body></html>`);
}
console.log('Created four editable 1080×1350, 8-page reading-news master sources.');
