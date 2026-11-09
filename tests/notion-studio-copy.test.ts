import { describe, expect, it } from "vitest";
import { notionCopyText, notionCopyToPages, notionDocumentToCopy, notionSyncChange, notionPlainCardCopy, notionCardCopySchema } from "../shared/notionStudioCopy";
import { cardCopySchema } from "../shared/cardCopy";
import { NEWS_EDITORIAL_ROLES } from "../shared/newsEditorial";
import type { NotionDocument } from "../shared/notionSync";

function manuscript(count = 5): NotionDocument {
  return {
    pageId: "4135c7c8-45fc-8101-ba1c-c4839d9445d8", url: "https://www.notion.so/4135c7c845fc8101ba1cc4839d9445d8",
    lastEditedAt: "2026-11-09T02:04:39.914Z", contentKey: "GED2027-서울-중등", title: "서울 중등 영재교육원",
    coverTitle: "원서만 쓰면 끝? 전형료 납부까지 확인하세요", channel: "HighScoop", category: "영재교육", template: "",
    stage: "원고 검토", verified: true, caption: "독립적인 게시물 캡션", sourceHash: "a".repeat(64), photos: [],
    pages: Array.from({ length: count }, (_, i) => ({
      index: i + 1, title: i ? `${i + 1}장 · 학생 지원 조건` : "원서만 쓰면 끝? 전형료 납부까지 확인하세요",
      body: i ? `현재 초6 → 중1 과정\n학생 접수는 11월 11일 18시까지\n교사 추천은 11월 12일까지 (${i + 1})` : "2027학년도 서울 중등 영재교육원\n강남서초교육지원청 영재교육원 사례\n현재 학년은 2026년 기준입니다.",
      headingBlockId: `heading-${i + 1}`, titleBlockId: `title-${i + 1}`, bodyBlockIds: [`body-${i + 1}`],
    })),
  };
}

describe("Notion manuscript canonical card copy", () => {
  it("preserves every character and line break of the actual cover context and four body cards", () => {
    const source = manuscript(), before = structuredClone(source), copy = notionDocumentToCopy(source);
    expect(copy.cover).toEqual({ title: source.coverTitle, subtitle: source.pages[0].body });
    expect(copy.pages).toHaveLength(4);
    expect(copy.pages.map(p => ({ title: p.title, body: p.body }))).toEqual(source.pages.slice(1).map(p => ({ title: p.title, body: p.body })));
    expect(copy.pages.map(p => p.id)).toEqual(["body-1", "body-2", "body-3", "body-4"]);
    expect(source).toEqual(before);
  });
  it("uses the explicit cover-title property while retaining the original first-page title in the source", () => {
    const source = manuscript(); source.coverTitle = "  따로 정한 썸네일 제목  "; const original = source.pages[0].title;
    expect(notionDocumentToCopy(source).cover.title).toBe("따로 정한 썸네일 제목");
    expect(source.pages[0].title).toBe(original);
  });
  it("falls back to the original first-page headline when the cover-title property is empty", () => {
    const source = manuscript(); source.coverTitle = "   ";
    expect(notionDocumentToCopy(source).cover.title).toBe(source.pages[0].title);
  });
  it("keeps caption and source metadata separate from rendered card copy", () => {
    const source = manuscript(), copy = notionDocumentToCopy(source), text = JSON.stringify(notionCopyText(copy));
    expect(text).not.toContain(source.caption); expect(text).not.toContain(source.contentKey); expect(text).not.toContain(source.sourceHash);
  });
  it("preserves the requested Studio template without making any wording changes", () => {
    const source = manuscript(), normal = notionDocumentToCopy(source), chosen = notionDocumentToCopy(source, "set:highscoop-magazine");
    expect(chosen.templateKey).toBe("set:highscoop-magazine"); expect(notionCopyText(chosen)).toEqual(notionCopyText(normal));
  });
  it("refuses an eight-card discussion layout rather than losing its two-column copy", () => {
    const columns=[{title:"시선 하나",body:"첫 번째 의견을 반드시 보존"},{title:"시선 둘",body:"두 번째 의견을 반드시 보존"}];
    const complex=cardCopySchema.parse({version:1,templateKey:"builtin:classic",storyFormat:"discussion8",cover:{title:"함께 생각하기",subtitle:""},
      pages:NEWS_EDITORIAL_ROLES.map((role,i)=>({id:`body-${i+1}`,role,title:`${i+1}번 제목`,subtitle:"",body:"원문 본문",...(role==="perspectives"?{columns}:{})}))});
    expect(()=>notionPlainCardCopy(complex)).toThrow(/일반 카드뉴스/);
    expect(()=>notionCopyText(complex)).toThrow();expect(()=>notionCopyToPages(complex)).toThrow();
  });
  it("accepts the full manual limits by Unicode code point without truncating emoji or long prose", () => {
    const source = manuscript(2); source.coverTitle = "🍨".repeat(200); source.pages[0].body = "🍨".repeat(120);
    source.pages[1].title = "가".repeat(120); source.pages[1].body = "🍨".repeat(1000);
    const copy = notionDocumentToCopy(source);
    expect(copy.cover.title).toBe(source.coverTitle); expect(copy.cover.subtitle).toBe(source.pages[0].body);
    expect(copy.pages[0].body).toBe(source.pages[1].body); expect(copy.pages[0].body.length).toBe(2000);
  });
  it.each([
    ["cover headline", (doc: NotionDocument) => { doc.coverTitle = "가".repeat(201); }],
    ["cover context", (doc: NotionDocument) => { doc.pages[0].body = "가".repeat(121); }],
    ["body headline", (doc: NotionDocument) => { doc.pages[1].title = "가".repeat(121); }],
    ["body prose", (doc: NotionDocument) => { doc.pages[1].body = "가".repeat(1001); }],
  ] as const)("rejects oversized %s explicitly instead of shortening it", (_name, change) => {
    const source = manuscript(2); change(source); const before = structuredClone(source);
    expect(() => notionDocumentToCopy(source)).toThrow(); expect(source).toEqual(before);
  });
  it.each([2, 10, 20])("supports %i total pages without inserting or dropping a chapter", count => {
    const source = manuscript(count), copy = notionDocumentToCopy(source);
    expect(copy.pages).toHaveLength(count - 1); expect(notionCopyToPages(copy)).toHaveLength(count);
  });
  it.each([1, 21])("rejects %i total pages as an unsupported structure", count => {
    expect(() => notionDocumentToCopy(manuscript(count))).toThrow(/2~20/);
  });
  it("round-trips a full regional manuscript without relaxing other editors or duplicate-ID checks",()=>{
    const source=manuscript(20),copy=notionDocumentToCopy(source);
    expect(notionCardCopySchema.safeParse(copy).success).toBe(true);
    expect(cardCopySchema.safeParse(copy).success).toBe(false);
    expect(notionCopyToPages(copy,{baseline:source,current:source})).toEqual(source.pages.map(({index,title,body})=>({index,title,body})));
    copy.pages[18].id=copy.pages[0].id;
    expect(notionCardCopySchema.safeParse(copy).success).toBe(false);
  });
  it.each([[[2, 3]], [[1, 3]], [[2, 1]], [[1, 1]]])("rejects noncanonical source chapter numbers %j before any import", indexes => {
    const source = manuscript(2); source.pages.forEach((page, i) => { page.index = indexes[i]; });
    expect(() => notionDocumentToCopy(source)).toThrow();
  });
});

describe("Notion and Studio text round trips", () => {
  it("keeps original cover/body order and text through an ordinary import→writeback round trip", () => {
    const source = manuscript(), copy = notionDocumentToCopy(source), pages = notionCopyToPages(copy);
    expect(pages).toEqual(source.pages.map(({ index, title, body }) => ({ index, title, body })));
    expect(pages.every(page => Object.keys(page).sort().join() === "body,index,title")).toBe(true);
  });
  it("follows an operator's Studio card order while assigning consecutive Notion chapter numbers", () => {
    const copy = notionDocumentToCopy(manuscript(3)); copy.pages.reverse();
    const pages = notionCopyToPages(copy);
    expect(pages.map(p => p.index)).toEqual([1, 2, 3]);
    expect(pages.slice(1).map(p => p.title)).toEqual(copy.pages.map(p => p.title));
  });
  it("preserves a distinct original first-page headline when an unchanged thumbnail title is pushed",()=>{
    const baseline=manuscript(2);baseline.coverTitle="별도 썸네일 제목";
    const copy=notionDocumentToCopy(baseline),current=structuredClone(baseline);
    expect(notionCopyToPages(copy,{baseline,current})[0].title).toBe(baseline.pages[0].title);
    copy.cover.title="Studio에서 직접 고친 제목";
    expect(notionCopyToPages(copy,{baseline,current})[0].title).toBe(copy.cover.title);
  });
  it("keeps a fresh remote headline separate when only the cover-title property changed remotely",()=>{
    const baseline=manuscript(2);baseline.coverTitle="원래 썸네일";
    const copy=notionDocumentToCopy(baseline),current=structuredClone(baseline);
    current.coverTitle="Notion에서 고친 썸네일";current.pages[0].title="Notion의 본문 제목도 별도로 보존";
    expect(notionCopyToPages(copy,{baseline,current})[0].title).toBe(current.pages[0].title);
  });
  it("retains both an edited Studio subtitle and body once, in reading order", () => {
    const copy = notionDocumentToCopy(manuscript(2)); copy.pages[0].subtitle = "별도 소제목"; copy.pages[0].body = "본문 첫 줄\n본문 둘째 줄";
    const pages = notionCopyToPages(copy);
    expect(pages[1].body).toBe("별도 소제목\n\n본문 첫 줄\n본문 둘째 줄");
    const reimported = notionDocumentToCopy({ ...manuscript(2), pages: pages.map((p, i) => ({ ...p, headingBlockId: `h${i}`, bodyBlockIds: [] })) });
    expect(reimported.pages[0].body).toBe(pages[1].body);
  });
  it("does not merge empty subtitles into extra paragraph separators", () => {
    const copy = notionDocumentToCopy(manuscript(2)); expect(notionCopyToPages(copy)[1].body).toBe(copy.pages[0].body);
  });
  it("rejects an overlong merged subtitle/body before writing a source that cannot be reimported",()=>{
    const copy=notionDocumentToCopy(manuscript(2));copy.pages[0].subtitle="소제목";copy.pages[0].body="가".repeat(1000);
    expect(cardCopySchema.safeParse(copy).success).toBe(true);
    expect(()=>notionCopyToPages(copy)).toThrow(/합쳐 1000자/);
    expect(copy.pages[0].body).toHaveLength(1000);
  });
  it("compares content text independently of template choice and generated page IDs", () => {
    const a = notionDocumentToCopy(manuscript()), b = cardCopySchema.parse({ ...a, templateKey: "builtin:another", pages: a.pages.map((p, i) => ({ ...p, id: `new-${i}` })) });
    expect(notionCopyText(a)).toEqual(notionCopyText(b));
    b.pages[0].body += "\n새 지원 조건"; expect(notionCopyText(a)).not.toEqual(notionCopyText(b));
  });
});

describe("Two-sided synchronization decisions", () => {
  it.each([
    [false, false, "unchanged"],
    [true, false, "notion_changed"],
    [false, true, "studio_changed"],
    [true, true, "conflict"],
  ] as const)("sourceChanged=%s studioChanged=%s yields %s", (sourceChanged, studioChanged, expected) => {
    expect(notionSyncChange(sourceChanged, studioChanged)).toBe(expected);
  });
});
