import { describe, expect, it } from "vitest";
import { compareSourceRevisions } from "../shared/sourceRevisionHistory";
import { cardCopyFixture } from "./fixtures/cardCopy";

describe("source revision comparison", () => {
  it("shows factual edits, exact card text, template changes and removed cards", () => {
    const oldCopy = cardCopyFixture("set:n01-blue"), newCopy = cardCopyFixture("set:n03");
    oldCopy.pages[3].body = "이전 카드의 여러 줄\n공백도 그대로  유지";
    newCopy.cover.title = "나중에 고친 표지";
    newCopy.pages = newCopy.pages.slice(0, 3);
    const current = { key_question: "오늘 저장한 질문", sources: [{ source_id: 7, note: "추가 근거" }], cardCopy: newCopy };
    const selected = { key_question: "과거 질문", sources: [], cardCopy: oldCopy };
    const before = structuredClone({ current, selected });
    const differences = compareSourceRevisions(current, selected);
    expect(differences.find(field => field.key === "key_question")).toMatchObject({ label: "핵심 질문", current: "오늘 저장한 질문", selected: "과거 질문", changed: true });
    expect(differences.find(field => field.key === "cardCopy.templateKey")).toMatchObject({ current: "set:n03", selected: "set:n01-blue", changed: true });
    expect(differences.find(field => field.key === "cardCopy.pages.3.body")).toMatchObject({ current: "(비어 있음)", selected: oldCopy.pages[3].body, changed: true });
    expect(differences.find(field => field.key === "sources")?.current).toContain("자료 번호: 7");
    expect({ current, selected }).toEqual(before);
  });

  it("ignores object key order and card identifiers, but preserves meaningful array order and whitespace", () => {
    const copy = cardCopyFixture();
    const reversedKeys = { sources: [{ note: "같은 근거", source_id: 1 }], cardCopy: { ...copy, pages: copy.pages.map(page => ({ ...page, id: `new-${page.id}` })) }, background: ["두 번째", "첫 번째"], scientific_basis: "근거  " };
    const current = { scientific_basis: "근거", background: ["첫 번째", "두 번째"], cardCopy: copy, sources: [{ source_id: 1, note: "같은 근거" }] };
    const differences = compareSourceRevisions(current, reversedKeys);
    expect(differences.filter(field => field.changed).map(field => field.key).sort()).toEqual(["background", "scientific_basis"]);
    expect(differences.find(field => field.key === "scientific_basis")?.selected).toBe("근거  ");
  });

  it("can inspect a revision when no current draft exists, without trimming long text", () => {
    const text = "긴 근거의 원문 표현 ".repeat(150);
    const differences = compareSourceRevisions(null, { scientific_basis: text, evidence: [], has_conflict: false });
    expect(differences.find(field => field.key === "scientific_basis")?.selected).toBe(text);
    expect(differences.find(field => field.key === "has_conflict")?.selected).toBe("충돌 없음");
  });
});
