import type { StudioCharacter, StudioPanel } from "./studio";

/** Stable IDs preserve existing cards. Display names and artwork reflect the approved family. */
export const STUDIO_POSE_GRID = { columns: 10, rows: 10 } as const;
export const STUDIO_POSE_COUNT = 100;
export const STUDIO_POSE_CATEGORIES = [
  "기본·회전", "표정", "손짓", "이동", "앉기·휴식",
  "생각·학습", "일·취미", "일상", "소통", "코믹 액션",
] as const;
export const STUDIO_FAMILY_REFERENCE_URL = "/api/studio/characters/reference";
export const STUDIO_FAMILY_ASSET_URL = "/studio-assets/poses-v2/family-v2.png";

export const STUDIO_CHARACTERS: ReadonlyArray<{
  id: StudioCharacter; name: string; age: number; role: string; detail: string;
  appearance: string; sheetUrl: string; grid: typeof STUDIO_POSE_GRID;
}> = [
  {
    id: "pengpeng", name: "펭펭", age: 40, role: "아빠 · ALLligodang",
    detail: "든든한 아빠이자 지구 특파원. 카메라와 사원증이 특징이에요.",
    appearance: "가족 중 가장 크고 듬직한 몸통. 넓은 흰 배, 카메라, 청록색 사원증 목걸이. 머리 위 꽁지 없음.",
    sheetUrl: "/studio-assets/poses-v2/pengpeng.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "pempem", name: "펨펨", age: 37, role: "엄마 · HighScoop",
    detail: "머스터드 숄과 초승달 목걸이를 한 엄마. 배움과 진학을 안내해요.",
    appearance: "머스터드색 자수 숄과 짧은 술, 작은 초승달 목걸이, 학사모, 연필과 노트. 볼터치·옆머리·땋은 머리 없음. 작은 흰 점눈 바깥에 짧게 올라간 속눈썹 한 가닥씩.",
    sheetUrl: "/studio-assets/poses-v2/pempem.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "penguin", name: "김펭긴", age: 13, role: "첫째 · Fryday",
    detail: "감자튀김과 큐브를 좋아하는 13살 첫째예요.",
    appearance: "큰 머리와 작은 몸통, 막내보다 살짝 큼. 감자튀김과 큐브가 소품. 머리 위 꽁지 없음. 13살 학생이며 대학원생이 아님.",
    sheetUrl: "/studio-assets/poses-v2/penguin.png", grid: STUDIO_POSE_GRID,
  },
  {
    id: "pengki", name: "김펭키", age: 12, role: "막내 · 우주펭귄상회",
    detail: "노란 가방과 하늘색 기타를 든 12살 막내예요.",
    appearance: "큰 머리와 작은 몸통, 형보다 조금 작지만 유아 체형은 아님. 노란 가방과 하늘색 기타. 가족 중 유일하게 헬멧 안 정수리에 작은 두 가닥 꽁지.",
    sheetUrl: "/studio-assets/poses-v2/pengki.png", grid: STUDIO_POSE_GRID,
  },
];

export const STUDIO_CHARACTER_GUIDE = `우주펭귄상회는 남극성-09에서 온 네 펭귄 가족이다.
${STUDIO_CHARACTERS.map(c => `${c.name}(${c.age}살, ${c.role}): ${c.appearance}`).join("\n")}
네 명 모두 검은 얼굴에 작고 동그란 흰 점눈, 길고 뾰족한 노란 부리, 하얀 반사와 옅은 하늘색 테두리가 있는 투명 유리 우주헬멧을 유지한다. 얼굴과 몸통 사이에 목을 드러내지 않는다. 검은 잉크와 색연필로 끄적인 질감, 큰 머리와 작은 검은 발을 유지한다. 아빠의 몸통은 넓고 길며 아이들은 확정된 작고 귀여운 몸통을 유지한다. 머리 위 꽁지는 막내만 있다. 펨펨에게 볼터치나 머리카락을 추가하지 않는다. 소품과 자세는 장면에 맞게 바꿀 수 있지만 캐릭터의 외형은 기준 이미지를 따른다. HighScoop의 입시 사실과 ALLligodang의 정보는 제공한 근거에서만 사용한다.`;

export function studioCharacterById(character: StudioCharacter) {
  return STUDIO_CHARACTERS.find(c => c.id === character)!;
}
export function poseSheetUrl(character: StudioCharacter): string {
  return studioCharacterById(character).sheetUrl;
}
export function poseImageUrl(character: StudioCharacter, pose: number): string {
  return `/api/studio/characters/${character}/poses/${pose}`;
}
export function poseLabel(character: StudioCharacter, pose: number): string {
  const category = STUDIO_POSE_CATEGORIES[Math.floor((pose - 1) / STUDIO_POSE_GRID.columns)];
  return `${studioCharacterById(character).name} · ${category ?? "포즈"} ${String(pose).padStart(2, "0")}`;
}

/** Numbers identify cells; captions never claim an unverified exact gesture. */
export function studioPoseGuide(panel: Pick<StudioPanel, "poseRefs">): string {
  const refs = panel.poseRefs ?? [];
  if (!refs.length) return "";
  return `[선택한 포즈 참조]\n${refs.map(ref => `${poseLabel(ref.character, ref.pose)} — 10×10 시트의 ${Math.floor((ref.pose - 1) / 10) + 1}행 ${(ref.pose - 1) % 10 + 1}열. 해당 캐릭터에 이 포즈의 몸짓·구도를 참고하고 장면에 맞게 조정한다. 참조 이미지: ${poseImageUrl(ref.character, ref.pose)}`).join("\n")}\n가족 기준 그림의 외형·비율을 우선 유지하며, 선택한 포즈의 동작만 참고한다. 전체 포즈 시트나 다른 포즈를 한 컷 안에 그리지 않는다.`;
}
