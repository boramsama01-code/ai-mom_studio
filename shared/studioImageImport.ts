import type { StudioCharacter, StudioContent } from "./studio";
import { studioImageContext } from "./studioWorkflow";

export const STUDIO_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const STUDIO_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const studioCharacterReferences: Record<StudioCharacter, { name: string; detail: string }> = {
  pengpeng: { name: "펭펭", detail: "아빠, 지구 특파원. 펼친 신문을 든 모습." },
  pempem: { name: "펨펨", detail: "엄마, 전 우주기관 연구원. 학사모와 연필, 분홍 볼터치. Highscoop 안내자." },
  penguin: { name: "김펭귄", detail: "첫째, 식품공학 대학원생. 흰 용기에 담긴 노란 감자튀김. Fryday 안내자." },
  pengki: { name: "김펭키", detail: "둘째, 탐사 과학자를 꿈꾸는 학생. 작은 체구, 노란 가방." },
};

/** Deterministic handoff: no API, keys, private notes, or assumed attachment access. */
export function studioChatGptImagePrompt(content: StudioContent, panelIndex: number, channelName: string, instruction = ""): string {
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex > 3) throw new Error("컷을 선택하세요.");
  const cast = content.characters.map(id => `${studioCharacterReferences[id].name}: ${studioCharacterReferences[id].detail}`).join("\n");
  return [
    `아래 구성으로 ${content.format === "카드뉴스" ? "카드뉴스 본문에 넣을 일러스트" : "웹툰의 한 컷"} 이미지 1장을 만들어 주세요. 프롬프트 설명 대신 완성 이미지를 출력해 주세요.`,
    `[작업]\n채널: ${channelName}\n${studioImageContext(content, panelIndex)}`,
    `[화면 구성]\n가로 4:3 비율, 가능하면 1536×1152. 네 컷을 한 장에 합치지 말고 지정된 한 컷만 그립니다. 인물과 핵심 소품은 화면 중앙 80% 안에 두고 잘리지 않게 합니다. 대사에서 감정과 시선을 읽어 표정·동작에 반영합니다.`,
    `[미술 방향]\n깔끔한 편집 일러스트, 절제된 색상 3~4개, 넉넉한 여백, 균일한 선 두께. 과도한 입체 효과·광택·그라데이션·장식은 피합니다. 배경은 이야기 이해에 필요한 사물만 남깁니다. 앞 컷과 인물 비율·색상·소품·화풍을 일관되게 유지합니다.`,
    cast ? `[캐릭터 기준]\n${cast}\n우주펭귄상회 가족: 둥근 우주 헬멧, 옆모습, 뾰족한 검은 부리, 작은 흰 점 눈, 길고 가느다란 흑백 몸. 첨부된 캐릭터 원본이 있으면 외형·비율·선·색상을 최우선으로 따릅니다. 원본이 보이지 않으면 임의로 재해석하지 말고 원본 첨부를 요청해 주세요.` : "[등장인물]\n장면에 지정된 인물과 소품만 사용합니다. 임의로 마스코트를 추가하지 않습니다.",
    instruction.trim() ? `[이번 컷 추가 요청]\n${instruction.trim()}` : "",
    `[출력 조건]\n말풍선·대사·자막·제목·로고·워터마크·테두리는 이미지에 넣지 않습니다. 글자는 스튜디오에서 별도로 합성합니다. 대사의 내용을 바꾸거나 제공하지 않은 입시·시사 사실을 추가하지 않습니다.`,
  ].filter(Boolean).join("\n\n");
}

export function studioImageFileError(file: Pick<File, "type" | "size">): string | null {
  if (!STUDIO_IMAGE_TYPES.includes(file.type)) return "PNG·JPG·WEBP 이미지 파일을 선택해 주세요. 이미지 주소는 붙여넣을 수 없습니다.";
  if (!file.size) return "비어 있는 이미지입니다. 다시 복사하거나 파일로 선택해 주세요.";
  if (file.size > STUDIO_IMAGE_MAX_BYTES) return "이미지는 한 장당 12MB까지 저장할 수 있습니다.";
  return null;
}

