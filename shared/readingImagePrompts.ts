import { FAMILY_PAGE_IDS, type FamilyPageId } from "./familyDialogue";
import type { ReadingCardProfile, ReadingImageBox } from "./readingCardProfiles";

type Bounds = { x: number; y: number; width: number; height: number };
export type ReadingArtworkComposition = {
  profileId: string; templateVersion: string; label: string; pageId: FamilyPageId; field: string;
  slot: Bounds & { fit: "cover" | "contain"; aspectRatio: number };
  textPlacement: "over_image" | "outside_image";
  /** Intersections relative to the image window, not the whole card. */
  textSafeAreas: Array<Bounds & { field: string }>;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Geometry comes only from a trusted, versioned profile; no prompt/LLM decides where text sits. */
export function readingArtworkComposition(profile: ReadingCardProfile, pageId: FamilyPageId): ReadingArtworkComposition | undefined {
  const image = profile.images.find(slot => slot.pageId === pageId && slot.kind === "artwork");
  if (!image) return undefined; // The profile logo is never an article-image generation target.
  const page = profile.pages.find(value => value.page === FAMILY_PAGE_IDS.indexOf(pageId) + 1);
  const textSafeAreas = (page?.textBoxes ?? []).flatMap(box => {
    const x = Math.max(image.x, box.x), y = Math.max(image.y, box.y);
    const right = Math.min(image.x + image.width, box.x + box.width), bottom = Math.min(image.y + image.height, box.y + box.height);
    return right > x && bottom > y ? [{ field: box.field, x: round(x - image.x), y: round(y - image.y), width: round(right - x), height: round(bottom - y) }] : [];
  });
  const fit = (image as ReadingImageBox & { fit?: "cover" | "contain" }).fit ?? "cover";
  return { profileId: profile.id, templateVersion: profile.templateVersion, label: profile.label, pageId, field: image.field,
    slot: { x: image.x, y: image.y, width: image.width, height: image.height, fit, aspectRatio: round(image.width / image.height) },
    textPlacement: textSafeAreas.length ? "over_image" : "outside_image", textSafeAreas };
}

export function readingArtworkPagesLabel(profile: ReadingCardProfile): string {
  const pages = [...new Set(profile.images.filter(slot => slot.kind === "artwork").map(slot => FAMILY_PAGE_IDS.indexOf(slot.pageId) + 1))].filter(page => page > 0).sort((a, b) => a - b);
  return pages.length ? `${pages.join("·")}장` : "사진창이 있는 장";
}

/** Shared by the brief stage and direct page regeneration, so they cannot give opposite layout instructions. */
export function readingArtworkPrompt(composition: ReadingArtworkComposition): string {
  const { slot } = composition;
  return [
    `선택한 카드뉴스 스타일은 ${composition.label}이다. ${composition.field} 사진창은 카드의 (${slot.x}, ${slot.y})에 ${slot.width}×${slot.height} 크기로 놓이며 가로/세로 비는 ${slot.aspectRatio}이다.`,
    slot.fit === "cover"
      ? "사진은 이 창을 채우도록 cover 크롭된다. 정사각형으로 생성되더라도 이 가로·세로 비로 잘린 중앙 영역에 핵심 피사체가 남도록 구성하고 중요한 물체를 가장자리에 두지 않는다."
      : "사진은 contain으로 전체가 보이도록 맞춰진다. 창의 비율과 여백을 고려해 핵심 피사체를 구성한다.",
    composition.textPlacement === "over_image"
      ? `이 사진 위에 별도로 조판한 한국어가 겹친다. 사진창 좌상단을 (0,0)으로 한 다음 영역은 글자 안전 영역이다: ${JSON.stringify(composition.textSafeAreas)}. 그 영역에는 복잡한 무늬·눈에 띄는 피사체·강한 국소 대비를 피하고 차분한 배경을 남긴다. 실제 글자는 이미지에 그리지 않는다.`
      : "이 사진창에는 카드 글자가 겹치지 않는다. 이미지 안에 불필요한 제목용 빈 공간을 만들지 않고 피사체·질감·대비를 선명하게 표현한다.",
    "중·고등학생과 학부모가 기사 쟁점을 생각할 수 있는 절제된 사진 감각 또는 개념적 일러스트를 사용한다. 실제 뉴스 현장 사진처럼 증거를 꾸미지 않으며 글자·수치·로고·워터마크를 이미지에 굽지 않는다. 사용자가 요청하지 않은 새 마스코트를 만들지 않는다.",
  ].join("\n");
}
