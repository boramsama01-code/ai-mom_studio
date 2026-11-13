import { describe, expect, it } from "vitest";
import { cardCopySchema } from "../shared/cardCopy";
import { familyCardCopySchema, pageDesignsSchema } from "../shared/familyDialogue";
import { notionInteriorTemplates } from "../shared/notionPageTemplates";
import { editorialFamilyPageBody } from "../shared/editorialPageContent";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { resolvedReadingPageDesigns } from "../shared/readingPageImages";

const plain = () => ({ version: 1, templateKey: "editorial:red", cover: { title: "표지", subtitle: "설명" }, pages: [{ id: "body-1", title: "본문", subtitle: "", body: "원래 본문을 보존합니다.", sourceIds: [31] }] });
describe("current common interior presentation schema", () => {
  it.each(notionInteriorTemplates)("round trips the %s layout without dropping copy or evidence", interiorTemplate => {
    const copy = plain(), page = { ...copy.pages[0], interiorTemplate, emphasis: "본문", footnote: "공식 원문 각주", background: { assetId: 501 } };
    const parsed = cardCopySchema.parse({ ...copy, pages: [page] });
    expect(parsed.pages[0]).toEqual(page); expect(parsed.cover).toEqual(copy.cover);
  });
  it("keeps the legacy plain-background restriction and rejects unknown layouts/invalid asset IDs", () => {
    expect(cardCopySchema.safeParse({ ...plain(), templateKey: "set:n03", pages: [{ ...plain().pages[0], background: { assetId: 501 } }] }).success).toBe(false);
    expect(cardCopySchema.safeParse({ ...plain(), pages: [{ ...plain().pages[0], interiorTemplate: "legacy-37" }] }).success).toBe(false);
    expect(cardCopySchema.safeParse({ ...plain(), pages: [{ ...plain().pages[0], background: { assetId: -1 } }] }).success).toBe(false);
  });
  it("keeps V2 original fields, claim refs, and image history independent of an applied layout", () => {
    const copy = familyDialogueCardFixture(), before = structuredClone(copy), metadata = familyDialogueMetadataFixture();
    const pageDesigns = pageDesignsSchema.parse({ ...metadata.pageDesigns, news_summary: { ...metadata.pageDesigns.news_summary, interiorTemplate: "table", interiorBody: "항목 | 내용\n전망 | 원문 확인", emphasis: "전망", footnote: "원문 각주", previousAssetIds: [501], background: { ...metadata.pageDesigns.news_summary.background, kind: "image", assetId: 501 } } });
    expect(pageDesigns.news_summary).toMatchObject({ interiorTemplate: "table", interiorBody: "항목 | 내용\n전망 | 원문 확인", previousAssetIds: [501], background: { assetId: 501 } });
    expect(familyCardCopySchema.parse(copy)).toEqual(before);
  });
  it("projects every visible V2 content string in order without leaking internal identifiers", () => {
    const copy = familyDialogueCardFixture();
    const page = copy.pages[5];
    expect(editorialFamilyPageBody(page)).toBe("똑똑함\n\n주어진 문제를 빠르게 해결하는 힘\n\n좋은 문제인지 묻고 이유를 설명하는 힘\n\n답은 맞지만 이유를 모른다면 어떤가요?\n\n나는 똑똑함을 ___라고 정의한다.");
    expect(editorialFamilyPageBody(copy.pages[6])).toBe("원문에 두 가지 색 칠하기\n\n원문에서 확인된 사실은 파랑, 미래의 전망은 노랑으로 표시해 보세요.");
    expect(editorialFamilyPageBody(copy.pages[7])).toContain("@test_allligodang");
    expect(editorialFamilyPageBody(copy.pages[7])).not.toContain("brand:space-penguin-company");
  });
  it("resolves current-kit cover inheritance without changing stored page images or crop settings", () => {
    const copy = { ...familyDialogueCardFixture(), templateKey: "editorial:cyan" }, designs = familyDialogueMetadataFixture().pageDesigns;
    designs.cover.background = { ...designs.cover.background, kind: "image", assetId: 501 };
    designs.news_summary.background = { ...designs.news_summary.background, inheritCover: true, focalX: 25, brightness: 80 };
    designs.implication.background = { ...designs.implication.background, kind: "image", assetId: 502, inheritCover: true };
    const before = structuredClone(designs), resolved = resolvedReadingPageDesigns(copy, designs);
    expect(resolved.news_summary.background).toMatchObject({ kind: "image", assetId: 501, focalX: 25, brightness: 80 });
    expect(resolved.implication.background.assetId).toBe(502); expect(designs).toEqual(before);
    expect(resolvedReadingPageDesigns({ ...copy, templateKey: "set:n03" }, designs)).toBe(designs);
  });
});
