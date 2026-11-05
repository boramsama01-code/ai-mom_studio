import type { StudioCharacter, StudioPanel } from "./studio";
import { FINAL_POSE_VERSION, finalPose } from "./studioFinalAssets";

/** Stable IDs preserve existing cards. Display names and artwork reflect the approved family. */
export const STUDIO_POSE_GRID = { columns: 10, rows: 10 } as const;
export const STUDIO_POSE_COUNT = 100;
export const STUDIO_POSE_CATEGORIES = [
  "기본·회전", "표정", "손짓", "이동", "앉기·휴식",
  "생각·학습", "일·취미", "일상", "소통", "코믹 액션",
] as const;
export const STUDIO_FAMILY_REFERENCE_URL = `/api/studio/characters/reference?version=${FINAL_POSE_VERSION}`;
export const STUDIO_FAMILY_ASSET_URL = "/studio-assets/poses-v2/family-v2.png";

export const STUDIO_CHARACTERS: ReadonlyArray<{
  id: StudioCharacter; name: string; age: number; role: string; detail: string;
  appearance: string; sheetUrl: string; grid: typeof STUDIO_POSE_GRID;
}> = [
  {
    id: "pengpeng", name: "펭펭", age: 40, role: "아빠 · ALLligodang",
    detail: "정 많고 흥도 눈물도 많은 아빠. 카메라와 사원증이 특징이에요.",
    appearance: "가족 중 가장 크고 넓은 몸통, 넓은 흰 배, 카메라와 사원증, 말린 신문. 머리 위 꽁지 없음. 카메라는 항상 한 대이며 손에 들거나 삼각대에 놓으면 옆구리에 중복해 그리지 않는다.",
    sheetUrl: "/studio-assets/poses-v2/pengpeng.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "pempem", name: "펨펨", age: 37, role: "엄마 · HighScoop",
    detail: "원인과 해결책부터 짚는 완전 T 엄마. 건조한 농담과 현실적인 행동으로 챙겨요.",
    appearance: "큰 머리와 짧은 몸, 작은 비스듬한 학사모, 머리 옆 빨간 볼펜, 감자 로고 양장 책과 감자튀김 컵. 흰 점눈 바깥 속눈썹 한 가닥씩. 볼터치·옆머리·땋은 머리·숄·목걸이 없음. 완전 T 성격으로 원인과 근거, 해결책을 먼저 짚으며 자신의 감동은 남몰래 숨긴다.",
    sheetUrl: "/studio-assets/poses-v2/pempem.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "penguin", name: "김펭긴", age: 13, role: "첫째 · Fryday",
    detail: "감자튀김과 큐브를 좋아하는 13살 첫째예요.",
    appearance: "큰 머리와 작은 몸통, 막내보다 살짝 큼. 선물받은 큐브를 늘 지닌다. 머리 위 꽁지 없음. 13살 학생이며 대학원생이 아님.",
    sheetUrl: "/studio-assets/poses-v2/penguin.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "pengki", name: "김펭키", age: 12, role: "막내 · 우주펭귄상회",
    detail: "노란 가방과 하늘색 기타를 든 12살 막내예요.",
    appearance: "큰 머리와 작은 몸통, 형보다 조금 작지만 유아 체형은 아님. 노란 스트랩의 하늘색 기타를 늘 지닌다. 가족 중 유일하게 헬멧 안 정수리에 작은 두 가닥 꽁지.",
    sheetUrl: "/studio-assets/poses-v2/pengki.png", grid: STUDIO_POSE_GRID,
  },
];

export const STUDIO_CHARACTER_GUIDE = `우주펭귄상회는 남극성-09에서 온 네 펭귄 가족이다.
${STUDIO_CHARACTERS.map(c => `${c.name}(${c.age}살, ${c.role}): ${c.appearance}`).join("\n")}
네 명 모두 짙은 회색 얼굴에 작고 넓게 떨어진 흰 점눈, 길고 뾰족한 노란 부리, 단일 청록 윤곽과 테두리 없는 흰 반사광의 맑은 투명 유리헬멧을 유지한다. 빈 유리에는 배경이 비치고 얼굴과 몸통 사이에 목을 드러내지 않는다. 매끈한 펜 윤곽과 무광 페인트 채색, 큰 둥근 머리와 짧은 몸을 유지하며 연필 입자나 빗금을 넣지 않는다. 가족의 크기는 펭펭, 펨펨, 펭긴, 펭키 순으로 작아진다. 머리 위 꽁지는 막내만 있다. 펨펨에게 볼터치나 머리카락을 추가하지 않는다. 코믹 표정은 볼 눌림·납작함, 짝눈, 큰 굴곡 두세 개의 찌글찌글 놀람을 분명하게 표현하되 헬멧의 원형과 투명도는 유지한다. 네 가족 모두 감자튀김을 가장 좋아한다. 소품과 자세는 장면에 맞게 바꿀 수 있지만 캐릭터의 외형은 최종 기본 모델을 따른다. HighScoop의 입시 사실과 ALLligodang의 정보는 제공한 근거에서만 사용한다.`;

export function studioCharacterById(character: StudioCharacter) {
  return STUDIO_CHARACTERS.find(c => c.id === character)!;
}
export function poseSheetUrl(character: StudioCharacter): string {
  return studioCharacterById(character).sheetUrl;
}
export function poseImageUrl(character: StudioCharacter, pose: number, assetVersion?: typeof FINAL_POSE_VERSION): string {
  return `/api/studio/characters/${character}/poses/${pose}${assetVersion ? `?version=${assetVersion}` : ""}`;
}
export function poseLabel(character: StudioCharacter, pose: number, assetVersion?: typeof FINAL_POSE_VERSION): string {
  if (assetVersion === FINAL_POSE_VERSION) return `${studioCharacterById(character).name} · ${finalPose(character, pose)!.id} ${finalPose(character, pose)!.title}`;
  const category = STUDIO_POSE_CATEGORIES[Math.floor((pose - 1) / STUDIO_POSE_GRID.columns)];
  return `${studioCharacterById(character).name} · ${category ?? "포즈"} ${String(pose).padStart(2, "0")}`;
}

/** Numbers identify cells; captions never claim an unverified exact gesture. */
export function studioPoseGuide(panel: Pick<StudioPanel, "poseRefs">): string {
  const refs = panel.poseRefs ?? [];
  if (!refs.length) return "";
  return `[선택한 포즈 참조]\n${refs.map(ref => {
    const asset = ref.assetVersion === FINAL_POSE_VERSION ? finalPose(ref.character, ref.pose) : undefined;
    const description = asset ? `${asset.description} 표정 연출: ${asset.expression_direction}` : `10×10 시트의 ${Math.floor((ref.pose - 1) / 10) + 1}행 ${(ref.pose - 1) % 10 + 1}열. 해당 캐릭터에 이 포즈의 몸짓·구도를 참고하고 장면에 맞게 조정한다.`;
    return `${poseLabel(ref.character, ref.pose, ref.assetVersion)} — ${description} 참조 이미지: ${poseImageUrl(ref.character, ref.pose, ref.assetVersion)}`;
  }).join("\n")}\n가족 기준 그림의 외형·비율을 우선 유지하며, 선택한 포즈의 동작과 표정을 참고한다. 전체 포즈 시트나 다른 포즈를 한 컷 안에 그리지 않는다.`;
}
