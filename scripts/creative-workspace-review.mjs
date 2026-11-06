import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** A reproducible review artifact from the actual WebKit captures, without
 * changing any product artwork or calling an external image service. */
export async function writeWorkspaceReview(output) {
  const overlays=[],width=2976,height=4680;
  const escape=text=>text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  async function label(text,left,top,size=25,bold=true,colour="#17665b") {
    const input=await sharp({text:{text:'<span foreground="'+colour+'">'+escape(text)+'</span>',font:"Pretendard "+(bold?"Bold ":"")+size,fontfile:path.resolve("assets/fonts/Pretendard-"+(bold?"Bold":"Regular")+".ttf"),rgba:true,dpi:72}}).png().toBuffer();
    overlays.push({input,left,top});
  }
  async function panel(name,title,left,top) {
    await label(title,left,top);
    const input=await readFile(path.join(output,name+".png"));
    overlays.push({input,left,top:top+42});
  }
  await label("우주펭귄상회 · 크리에이티브 작업 공간",32,32,44,true,"#232c2a");
  await label("실제 구현 화면 · 검증용 자료 / main 42c643d → PR #73 / 2026.11.06",32,94,25,false,"#52655a");
  await label("승인된 v1.4 캐릭터·기존 템플릿 사용. 외부 AI 생성·SNS 게시를 실행하지 않은 브라우저 검증입니다.",32,134,23,false,"#65716c");
  await panel("before-home-1440","개선 전 · PC",32,208);
  await panel("after-home-1440","A · 선택한 방향 / 콘텐츠와 다음 작업 중심",1504,208);
  await panel("before-home-393","개선 전 · 모바일",130,1312);
  await panel("after-home-393","개선 후 · 모바일",555,1312);
  await panel("after-editor-1440","원고와 선택한 컷을 함께 편집",980,1312);
  await panel("after-video-393","영상 구성 · 수동 편집 연계",2452,1312);
  await panel("direction-b-graphite-1440","B · 비교 방향 / 짙은 탐색 영역과 높은 밀도",32,2416);
  await panel("after-capture-393","모바일 링크 저장",1630,2416);
  await panel("after-error-393","오류 · 첫 화면에서 복구",2140,2416);
  await panel("after-templates-1440","자산·템플릿 / 승인된 14종과 원래 비율",32,3520);
  await panel("after-assets-1440","자산·템플릿 / 채널별 브랜드 가이드",1504,3520);
  await label("A: #f5f5f1 배경 · #17665b 도구 · 26px 제목 · 4/8/12/16/24/32px 간격 · 모바일 입력 16px / 터치 48px",32,4596,24,false,"#232c2a");
  await label("화면 캡처는 합성 API 응답으로 재현한 실제 React 빌드입니다. 운영 배포·실제 외부 연동 검증과 구분합니다.",32,4636,22,false,"#65716c");
  const png=await sharp({create:{width,height,channels:3,background:"#f5f5f1"}}).composite(overlays).png({compressionLevel:9}).toBuffer();
  await writeFile(path.join(output,"workspace-review.png"),png);
  await writeFile(path.join(output,"workspace-review-preview.webp"),await sharp(png).resize({width:1200}).webp({quality:85}).toBuffer());
}
