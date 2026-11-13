import sharp from 'sharp';
import {editorialBrandForChannel,editorialTemplateForKey,editorialTemplateOptions,type EditorialChannel} from '../../shared/editorialTemplates';
import {buildNotionCanvaPptx,type NotionCanvaDocument,type NotionCanvaPhoto} from './notionCanva';
import {loadReadingFont} from './readingCardFonts';

let samplePhoto:Promise<Buffer>|undefined;
function capture(){return samplePhoto??=Promise.resolve().then(async()=>{
 const font=loadReadingFont('Noto Sans KR',700),title=font.path('생각의 과정을 남기는 연습',85,150,42),regular=loadReadingFont('Noto Sans KR',400);
 const rows=['문제를 읽고, 알고 있는 조건부터 정리해요.','첫 번째 방법: 그림으로 관계를 나타내 보기','두 번째 방법: 조건을 하나씩 바꾸어 보기','다시 설명하기: 내 말로 풀이를 남겨 보기'];
 const body=rows.map((value,i)=>`<path d="${regular.path(value,85,280+i*145,27)}" fill="#454545"/><path d="M85 ${320+i*145}h720" stroke="#D7D7D7"/>`).join('');
 return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#F8F7F3"/><path d="${title}" fill="#202020"/>${body}<ellipse cx="420" cy="425" rx="270" ry="45" stroke="#E5584A" stroke-width="4" fill="none"/><path d="M90 725h520" stroke="#FFE37F" stroke-width="30" opacity=".6"/></svg>`)).png().toBuffer();
 });}
export function editorialSampleDocument(channel:EditorialChannel,key:string):NotionCanvaDocument{
 const current=editorialTemplateForKey(key),kit=editorialTemplateOptions(channel).find(item=>item.colorId===current?.colorId);
 if(!kit)throw new Error('현재 공통 템플릿을 찾을 수 없습니다.');
 const note='배치 예시입니다. 실제 원고·사진·출처로 바꿔 주세요.';
 return {title:`${editorialBrandForChannel(channel).name} · ${kit.category}`,category:kit.category,categoryColor:kit.color,coverStyle:'A',pages:[
 {title:'제목의 첫 줄을 넣고,\n핵심 문장을 강조해요',body:'주제에 맞는 컬러를 고른 뒤, 필요한 내지를 조합해요.',imageId:'sample',emphasis:'핵심 문장을 강조해요'},
 {title:'핵심 문장이\n먼저 읽히도록',interiorTemplate:'text',body:'독자가 가장 궁금해할 내용을 먼저 적어요.\n\n강조할 부분만 형광펜으로 표시하고, 긴 설명은 문단을 나눠요.\n\n조건과 출처는 각주에 덧붙입니다.',emphasis:'강조할 부분만',footnote:note},
 {title:'두 가지 내용을\n나란히 비교해요',interiorTemplate:'two_columns',body:'첫 번째 관점\n\n무엇인지 짧게 설명해요.\n\n같은 기준으로 내용을 정리합니다.\n---\n두 번째 관점\n\n차이점을 짧게 설명해요.\n\n같은 순서로 배치하면 더 잘 보여요.',footnote:note},
 {title:'이미지 옆에서\n맥락을 설명해요',interiorTemplate:'image_text',imageId:'sample',body:'사진이나 자료를 그대로 보여주고, 독자가 살펴볼 부분을 옆에 적어요.\n\n왜 필요한 자료인지, 어떻게 활용할지 설명합니다.',footnote:note},
 {title:'여러 항목은\n한눈에 보는 표로',interiorTemplate:'table',body:'항목|내용|확인할 곳\n대상|참여 가능한 조건|공식 안내\n준비물|필요한 자료|준비 목록\n방법|참여하는 순서|기관 홈페이지',footnote:note},
 {title:'무엇부터 할지\n순서대로 보여줘요',interiorTemplate:'process',body:'단계|내용\n주제 고르기|관심 있는 내용을 정해요.\n준비하기|필요한 자료를 확인해요.\n직접 해보기|방법과 생각을 남겨요.\n다시 살펴보기|알게 된 점을 나눠요.',footnote:note},
 {title:'일정은 기간과\n마감이 함께 보이게',interiorTemplate:'timeline',body:'기관·과정|시작일|마감일|구분\n기관 A · 예시|2026-11-13|2026-11-20|학생 접수\n기관 B · 예시|2026-11-16|2026-11-25|학생 접수\n기관 C · 예시|2026-11-19|2026-11-27|추가 모집',footnote:'배치 예시용 가상 일정입니다. 실제 공고가 아닙니다.'},
 {title:'숫자의 차이를\n그래프로 비교해요',interiorTemplate:'bar_chart',body:'항목|값\n항목 A|30\n항목 B|45\n항목 C|25',footnote:'배치 예시용 가상 수치입니다. 실제 통계가 아닙니다.'},
 {title:'원본 캡처를\n크게 보여주세요',interiorTemplate:'document_excerpt',imageId:'sample',body:'실제 PDF 부분 캡처를 넣고, 중요한 내용을 짧게 덧붙여요.',footnote:note},
 {title:'주고받은 이야기를\n말풍선에 담아요',interiorTemplate:'dialogue',body:'화자|내용\n엄마|어디부터 보니까 좀 알겠어?\n아이|한 줄씩 보니까 괜찮은데요ㅋㅋ\n엄마|좋아. 네 말로 한 번 설명해줄래?',footnote:'가상 대화 예시입니다. 실제 원고로 바꿔 주세요.'}
 ]};
}
export async function renderEditorialTemplateSample(channel:EditorialChannel,key:string,page:number){
 const doc=editorialSampleDocument(channel,key),kit=editorialTemplateForKey(key)!;
 const photos:NotionCanvaPhoto[]=[{id:'sample',bytes:await capture(),mimeType:'image/png'}];
 const rendered=await buildNotionCanvaPptx(doc,photos,{previewPage:page,previewOnly:true,brand:editorialBrandForChannel(channel),soft:kit.soft});
 if(!rendered.previewSvg)throw new Error('미리보기 페이지를 만들 수 없습니다.');
 return sharp(Buffer.from(rendered.previewSvg)).jpeg({quality:88}).toBuffer();
}
