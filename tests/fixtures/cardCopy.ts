import type { CardCopy } from "../../shared/cardCopy";

export function cardCopyFixture(templateKey = "builtin:classic"): CardCopy {
  return { version: 1, templateKey, cover: { title: "원문에서 확인한 핵심 안내", subtitle: "필요한 내용과 확인할 점을 나눠 살펴봐요" },
    pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `핵심 안내 ${i + 1}`, subtitle: "확인한 원문을 바탕으로", body: "원문에 나온 사실을 살펴봅니다. 아직 확인되지 않은 내용은 확인이 필요합니다." })) };
}
