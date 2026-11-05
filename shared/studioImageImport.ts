import type { StudioCharacter, StudioContent } from "./studio";
import { studioImageContext } from "./studioWorkflow";
import { STUDIO_CHARACTERS, STUDIO_CHARACTER_GUIDE } from "./studioCharacters";

export const STUDIO_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const STUDIO_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const studioCharacterReferences = Object.fromEntries(STUDIO_CHARACTERS.map(c => [c.id, { name: c.name, detail: `${c.age}살, ${c.role}. ${c.appearance}` }])) as Record<StudioCharacter, { name: string; detail: string }>;

/** Deterministic handoff: no API, keys, private notes, or assumed attachment access. */
export function studioChatGptImagePrompt(content: StudioContent, panelIndex: number, channelName: string, instruction = ""): string {
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex > 3) throw new Error("컷을 선택하세요.");
  const cast = content.characters.map(id => `${studioCharacterReferences[id].name}: ${studioCharacterReferences[id].detail}`).join("\n");
  return [
    `아래 구성으로 ${content.format === "카드뉴스" ? "카드뉴스 본문에 넣을 일러스트" : "웹툰의 한 컷"} 이미지 1장을 만들어 주세요. 프롬프트 설명 대신 완성 이미지를 출력해 주세요.`,
    `[작업]\n채널: ${channelName}\n${studioImageContext(content, panelIndex)}`,
    `[화면 구성]\n가로 4:3 비율, 가능하면 1536×1152. 네 컷을 한 장에 합치지 말고 지정된 한 컷만 그립니다. 인물과 핵심 소품은 화면 중앙 80% 안에 두고 잘리지 않게 합니다. 대사에서 감정과 시선을 읽어 표정·동작에 반영합니다.`,
    `[미술 방향]\n${cast ? "확정된 최종 가족 모델의 매끈한 펜 윤곽과 무광 페인트 채색, 큰 둥근 머리와 짧은 몸을 유지합니다. 맑은 투명 유리헬멧의 단일 청록 윤곽과 테두리 없는 흰 반사광을 유지하고 빈 유리에는 배경이 비치게 합니다." : "깔끔한 편집 일러스트, 절제된 색상 3~4개, 넉넉한 여백, 균일한 선 두께."} 과도한 입체 효과·장식은 피합니다. 배경은 이야기 이해에 필요한 사물만 남깁니다. 앞 컷과 인물 비율·색상·소품·화풍을 일관되게 유지합니다.`,
    cast ? `[이번 컷에 사용할 수 있는 등장인물]\n${cast}\n[최신 가족 외형 기준]\n${STUDIO_CHARACTER_GUIDE}\n첨부된 가족 기준 그림은 외형 참조이며 네 명 모두를 그리라는 뜻이 아닙니다. 선택한 등장인물 중 장면에 필요한 인물만 그립니다. 원본의 외형·비율·선·색상을 최우선으로 따릅니다. 가족 기준 그림과 선택한 개별 포즈 이미지는 직접 첨부한 파일을 확인해야 합니다. 주소만으로 이미지를 확인했다고 가정하지 마세요. 원본이 보이지 않으면 임의로 재해석하지 말고 원본 첨부를 요청해 주세요.` : "[등장인물]\n장면에 지정된 인물과 소품만 사용합니다. 임의로 마스코트를 추가하지 않습니다.",
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


