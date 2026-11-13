/** Rebuild the six current, editable Canva masters from Studio's own renderer.
 * Set HIGHSCOOP_TEMPLATE_SOURCE_DIR to a local folder of cleared example PNGs.
 * Source images are not uploaded to public hosting; only small kit previews ship.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {HIGH_SCOOP_TEMPLATE_KITS,HIGH_SCOOP_TEMPLATE_VERSION} from '../shared/highscoopTemplates';
import {buildNotionCanvaPptx,type NotionCanvaDocument,type NotionCanvaPhoto} from '../server/services/notionCanva';

const source=process.env.HIGHSCOOP_TEMPLATE_SOURCE_DIR;
if(!source)throw new Error('Set HIGHSCOOP_TEMPLATE_SOURCE_DIR to the approved local example assets.');
const target=path.resolve('docs/artifacts/highscoop-current'),publicDir=path.resolve('client/public/highscoop/current');
await fs.mkdir(target,{recursive:true});await fs.mkdir(publicDir,{recursive:true});
const refs=[['cover','01-cover-hero.png'],['document','02-answer-explanation-base.png'],['marks','02-answer-explanation-annotations.png']] as const;
const photos:NotionCanvaPhoto[]=await Promise.all(refs.map(async([id,name])=>({id,name,bytes:await fs.readFile(path.join(source,name)),mimeType:'image/png'})));
const sharedFoot='형식 예시입니다. 실제 원고·사진·출처로 바꿔 주세요.';
function sample(category:string,color:string):NotionCanvaDocument{return {title:`HighScoop · ${category} · 컬러 마스터`,category,categoryColor:color,coverStyle:'A',pages:[
  {title:'제목의 첫 줄을 넣고,\n핵심 문장을 강조해요',body:'카테고리 컬러를 고른 뒤, 필요한 내지 형식을 조합해요.',imageId:'cover',emphasis:'핵심 문장을 강조해요'},
  {title:'핵심 문장이\n먼저 읽히도록',interiorTemplate:'text',body:'첫 문단에는 독자가 가장 궁금해할 내용을 적어요.\n\n강조할 부분만 형광펜으로 표시하고, 긴 설명은 문단을 나눠요.\n\n조건과 출처는 아래 각주에 덧붙입니다.',emphasis:'강조할 부분만',footnote:sharedFoot},
  {title:'두 가지 내용을\n나란히 비교해요',interiorTemplate:'two_columns',body:'왼쪽 항목\n\n무엇인지 한 문장으로 설명해요.\n\n대상·방법·준비물처럼 같은 기준으로 정리합니다.\n---\n오른쪽 항목\n\n비교할 내용을 짧게 설명해요.\n\n같은 순서로 배치하면 차이가 더 잘 보여요.',footnote:sharedFoot},
  {title:'이미지 옆에서\n맥락을 설명해요',interiorTemplate:'image_text',imageId:'document',body:'사진이나 자료는 그대로 보여주고, 옆에는 독자가 살펴볼 부분을 적어요.\n\n이 자료가 왜 필요한지, 언제 활용하면 되는지 설명합니다.',footnote:sharedFoot},
  {title:'여러 항목은\n한눈에 보는 표로',interiorTemplate:'table',body:'항목|내용|확인할 곳\n지원 대상|예시 학년|공식 모집요강\n준비물|예시 서류|제출 목록\n신청 방법|예시 접수처|기관 홈페이지',footnote:sharedFoot},
  {title:'무엇부터 할지\n순서대로 보여줘요',interiorTemplate:'process',body:'단계|내용\n주제 고르기|아이와 관심 있는 내용을 정해요.\n준비하기|필요한 자료와 조건을 확인해요.\n직접 해보기|시도한 방법과 생각을 남겨요.\n다시 살펴보기|알게 된 점과 다음 질문을 나눠요.',footnote:sharedFoot},
  {title:'일정은 기간과\n마감이 함께 보이게',interiorTemplate:'timeline',body:'기관·과정|시작일|마감일|구분\n기관 A · 예시|2026-11-13|2026-11-20|학생 접수\n기관 B · 예시|2026-11-16|2026-11-25|학생 접수\n기관 C · 예시|2026-11-19|2026-11-27|추가 모집',footnote:'배치 예시용 가상 일정입니다. 실제 공고가 아닙니다.'},
  {title:'숫자의 차이를\n그래프로 비교해요',interiorTemplate:'bar_chart',body:'항목|값\n항목 A|30\n항목 B|45\n항목 C|25',footnote:'배치 예시용 가상 수치입니다. 실제 통계가 아닙니다.'},
  {title:'원본 캡처 위에는\n중요한 부분만 표시해요',interiorTemplate:'document_excerpt',imageId:'document',overlayImageId:'marks',body:'원본과 강조 표시는 별도 레이어예요. 캡처를 크게 보여주고, 아래에 활용 방법을 적습니다.',footnote:'원본 PDF 캡처 · 형광펜·붉은 색연필 표시 예시'},
  {title:'아이와 나눈 수다를\n말풍선으로 담아요',interiorTemplate:'dialogue',body:'화자|내용\n엄마|어디부터 보니까 좀 알겠어?\n아이|한 줄씩 보니까 괜찮은데요ㅋㅋ\n엄마|좋아. 네 말로 한 번 설명해줄래?',footnote:'가상 대화 예시입니다. 실제 원고로 바꿔 주세요.'},
]};}
const records:any[]=[];
for(const kit of HIGH_SCOOP_TEMPLATE_KITS){
 const slug=kit.key.slice('highscoop:'.length),doc=sample(kit.category,kit.color),out=await buildNotionCanvaPptx(doc,photos);
 if(out.pageCount!==11)throw new Error(`Unexpected page count: ${slug}/${out.pageCount}`);
 const pptx=path.join(target,`${slug}.pptx`);await fs.writeFile(pptx,out.bytes);
 const previews=[];
 for(let index=0;index<out.pageCount;index++){
   const p=await buildNotionCanvaPptx(doc,photos,{previewPage:index,previewOnly:true});
   if(!p.previewSvg)throw new Error(`Missing preview ${slug}/${index}`);
   const file=path.join(publicDir,`${slug}-page-${index+1}.webp`);
   await sharp(Buffer.from(p.previewSvg)).webp({quality:89}).toFile(file);previews.push(file);
 }
 await fs.writeFile(path.join(publicDir,`${slug}-cover.webp`),await fs.readFile(previews[0]));
 const thumbs=await Promise.all(previews.map((file,i)=>sharp(file).resize(216,270).toBuffer().then(input=>({input,left:i%4*216,top:Math.floor(i/4)*270}))));
 await sharp({create:{width:864,height:810,channels:3,background:'#F0F2F4'}}).composite(thumbs).webp({quality:87}).toFile(path.join(publicDir,`${slug}-overview.webp`));
 records.push({key:kit.key,category:kit.category,color:kit.color,pptx:path.relative(process.cwd(),pptx).replaceAll('\\','/'),pageCount:out.pageCount,sourcePageCount:out.sourcePageCount,sha256:crypto.createHash('sha256').update(out.bytes).digest('hex'),previewFiles:previews.map(file=>path.relative(process.cwd(),file).replaceAll('\\','/')),warnings:out.warnings});
 console.log(JSON.stringify({category:kit.category,pages:out.pageCount,bytes:out.bytes.length,warnings:out.warnings}));
}
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify({version:HIGH_SCOOP_TEMPLATE_VERSION,kitCount:records.length,categoryMastersOnly:true,renderer:'buildNotionCanvaPptx',sourceArtwork:refs.map(([id,name])=>({id,name})),records},null,2));
