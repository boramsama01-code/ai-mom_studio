import { describe, expect, it } from "vitest";
import { newsEditorialResourceSchema, resolveNewsEditorialResource, validateNewsEditorialActivity, validateNewsEditorialResource } from "../shared/newsEditorialResource";
import { aiDiscussionCardCopySchema, cardCopySchema } from "../shared/cardCopy";
import { editorialCopy, editorialSource } from "./fixtures/newsEditorial";

const museum = () => ({ ...editorialSource(2), title: "국립중앙과학관 인공지능 전시 안내", url: "https://example.test/museum/ai", text: "국립중앙과학관 인공지능 전시회는 평가 조건에 따라 결과가 달라지는 장면을 소개합니다. 관람 전에 공식 홈페이지에서 운영 시간과 대상 연령을 확인해야 합니다. 이 자료는 설명용 합성 원문이며 실제 관람 가능 여부를 검증한 자료가 아닙니다." });

describe("canonical resources selected from supplied article sources", () => {
  it("copies the whole canonical title and URL from one complete source without fetching a model-authored address", () => {
    const source = museum();
    expect(resolveNewsEditorialResource(2, [editorialSource(), source])).toEqual({ sourceId: 2, title: source.title, url: source.url });
    expect(resolveNewsEditorialResource(1, [editorialSource()])).toEqual({ sourceId: 1, title: editorialSource().title, url: editorialSource().url });
    expect(validateNewsEditorialResource(resolveNewsEditorialResource(2, [source]), [source])).toBeNull();
  });

  it.each(["unknown ID", "duplicate ID", "RSS only", "empty title", "overlong title", "overlong URL", "non-HTTP", "URL credentials"])("does not offer an unverified or unsupported resource: %s", change => {
    const source = museum(); let sources = [source]; let id = 2;
    if (change === "unknown ID") id = 999;
    if (change === "duplicate ID") sources = [source, { ...source }];
    if (change === "RSS only") source.text = "본문 없음";
    if (change === "empty title") source.title = "   ";
    if (change === "overlong title") source.title = "가".repeat(181);
    if (change === "overlong URL") source.url = `https://example.test/${"a".repeat(2000)}`;
    if (change === "non-HTTP") source.url = "javascript:alert(1)";
    if (change === "URL credentials") source.url = "https://user:password@example.test/resource";
    expect(resolveNewsEditorialResource(id, sources)).toBeNull();
  });

  it("does not silently truncate resource titles and counts visible Unicode characters", () => {
    const source = { ...museum(), title: "🔬".repeat(180) };
    expect(resolveNewsEditorialResource(2, [source])?.title).toBe(source.title);
    source.title += "🔬";
    expect(resolveNewsEditorialResource(2, [source])).toBeNull();
  });

  it("refuses forged canonical names or URLs, even when a real source ID is supplied", () => {
    const source = museum(), resource = resolveNewsEditorialResource(2, [source])!;
    expect(validateNewsEditorialResource({ ...resource, title: "존재하지 않는 AI 과학관" }, [source])).toContain("제목·주소");
    expect(validateNewsEditorialResource({ ...resource, url: "https://invented.test/paper" }, [source])).toContain("제목·주소");
    expect(validateNewsEditorialResource(resource, [editorialSource()])).toContain("확인할 수 없습니다");
    expect(newsEditorialResourceSchema.safeParse({ ...resource, trusted: true }).success).toBe(false);
  });

  it("permits a named supplied institution and rejects a different invented institution despite a museum keyword in the source", () => {
    const source = museum(), resource = resolveNewsEditorialResource(2, [source])!;
    expect(validateNewsEditorialActivity("국립중앙과학관에서 평가 기준을 비교해 보세요. 방문 전 공식 안내에서 운영 시간을 확인해요.", resource, [source])).toBeNull();
    expect(validateNewsEditorialActivity("환상의미래과학관에서 완성된 AI를 직접 보세요.", resource, [source])).toContain("이름이 선택한 참고 원문과 일치하지");
    expect(validateNewsEditorialActivity("국립중앙과학관에서 비교해 보세요.", undefined, [source])).toContain("참고자료로 선택");
  });

  it("permits a source-backed paper title and rejects a paper invented beside a valid resource", () => {
    const source = { ...museum(), title: "문제 조건과 평가 결과", text: `‘문제 조건과 평가 결과’ 논문은 평가 조건을 비교한 합성 예시 자료입니다. ${editorialSource().text}` };
    const resource = resolveNewsEditorialResource(2, [source])!;
    expect(validateNewsEditorialActivity("‘문제 조건과 평가 결과’ 논문에서 평가 조건을 찾아 비교표를 만드세요.", resource, [source])).toBeNull();
    expect(validateNewsEditorialActivity("‘AI는 언제나 현명하다’ 논문을 읽고 결론을 정리해 보세요.", resource, [source])).toContain("이름이 선택한 참고 원문과 일치하지");
    expect(validateNewsEditorialActivity("이 개념을 다룬 논문에서 실험 조건을 찾아보세요.", undefined, [])).toBeNull();
  });

  it("permits references only on activity pages and keeps the AI contract limited to source IDs", () => {
    const copy: any = editorialCopy(), resource = resolveNewsEditorialResource(2, [museum()])!;
    copy.pages[5].resource = resource;
    expect(cardCopySchema.parse(copy).pages[5].resource).toEqual(resource);
    expect(aiDiscussionCardCopySchema.safeParse(copy).success).toBe(false);
    delete copy.pages[5].resource; copy.pages[5].resourceSourceId = 2;
    expect(aiDiscussionCardCopySchema.safeParse(copy).success).toBe(true);
    copy.pages[0].resourceSourceId = 2;
    expect(aiDiscussionCardCopySchema.safeParse(copy).success).toBe(false);
    delete copy.pages[0].resourceSourceId; delete copy.pages[5].resourceSourceId; copy.pages[0].resource = resource;
    expect(cardCopySchema.safeParse(copy).success).toBe(false);
  });
});
