import { cardCopySchema, type CardCopy, type NewsEditorialRole } from "./cardCopy";
import { defaultPageDesigns, type FamilyPageId, type PageDesigns } from "./familyDialogue";

/** Keep the complete saved v1 manuscript as editorial input. It is not a new
 * evidence source and is never silently shortened or written back to the old revision. */
export function legacyFamilyCopy(payload: Record<string, unknown>): CardCopy | null {
  const parsed = cardCopySchema.safeParse(payload.cardCopy);
  return parsed.success ? parsed.data : null;
}

export const LEGACY_FAMILY_CONVERSION_RULES = "기존 version=1 원고를 version=2의 8장 구조로 전환하는 비교 제안이다. 기존 문구의 표현·수동 수정·제목·구체적인 조건을 최대한 이어 쓰고, 새 필드 구조 때문에 필요한 재배치만 제안한다. 기존 원고는 참고 편집본이며 사실 근거로 승격하지 않는다. 주장은 제공된 원문 근거와 대조하고, 근거가 없거나 길이가 맞지 않으면 reviewFlags에 차이를 설명한다. 새 제안은 운영자가 비교 후 적용하며 원래 저장본을 덮어쓰지 않는다.";

/** V1 discussion decks already have stable semantic roles. Copy their immutable
 * image IDs, leaving any hidden photo recoverable in the chosen profile's history. */
export function legacyFamilyPageDesigns(copy: CardCopy, reusableCoverAssetId?: number | null): PageDesigns {
  const designs = defaultPageDesigns();
  const apply = (id: FamilyPageId, background?: { assetId: number; opacity?: number }) => {
    if (!background) return;
    designs[id] = { ...designs[id], background: { ...designs[id].background, kind: "image", assetId: background.assetId, overlay: 100 - (background.opacity ?? 100), inheritCover: false }, previousAssetIds: [background.assetId] };
  };
  apply("cover", copy.cover.background ?? (reusableCoverAssetId ? { assetId: reusableCoverAssetId } : undefined));
  const targets: Record<NewsEditorialRole, FamilyPageId> = { summary: "news_summary", implication: "implication", discussion: "discussion", perspectives: "perspectives", concept: "concept", activity: "activity", closing: "outro" };
  for (const page of copy.pages) if (page.role) apply(targets[page.role], page.background);
  return designs;
}
