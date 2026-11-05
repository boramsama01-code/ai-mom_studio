import { describe, expect, it } from "vitest";
import { buildCaptions } from "../server/services/cardModel";
import { composeReadableCaption } from "../shared/captionStyle";
import { composeFamilyCaption } from "../server/services/familyEditorial";
import { familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { familyEvidenceFixture } from "./fixtures/familyEvidence";

const emoji = (text: string) => text.match(/\p{Extended_Pictographic}/gu) ?? [];

describe("readable generated captions", () => {
  it.each([["여름 과학 캠프", "🏕️"], ["과학고 신입생 입학전형", "🎓"], ["전국 수학 경시대회", "🏆"]])("uses a matching varied set for %s without changing dates or source data", (title, marker) => {
    const payload = { title, audience: "중학교 1~3학년", key_details: "공식 공고에 나온 준비물을 확인하세요.", schedules: [{ kind: "apply", label: "접수", start: { date: "2026-11-05" }, end: { date: "2026-11-12" } }] };
    const before = structuredClone(payload);
    const caption = buildCaptions({ kind: "notice", payload, sourceOrg: "공식 주최기관", sourceUrl: "https://example.com/official" });
    expect(caption.instagram.startsWith(marker)).toBe(true);
    const symbols = emoji(caption.instagram);
    expect(symbols.length).toBeGreaterThanOrEqual(3); expect(symbols.length).toBeLessThanOrEqual(6);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(caption.instagram).toContain("2026-11-05"); expect(caption.instagram).toContain("2026-11-12");
    expect(caption.instagram).toContain("출처: 공식 주최기관"); expect(caption.instagram).not.toContain("https://");
    expect(caption.telegram).toContain("https://example.com/official"); expect(payload).toEqual(before);
  });

  it("does not decorate tragic topics or alter already decorated sections", () => {
    const sober = buildCaptions({ kind: "current_dialogue", payload: { title: "재난 피해자 지원 방안", summary: "제공된 자료에 근거한 내용.", why_it_matters: "지원 제도를 확인합니다.", discussion_questions: ["어떤 기준이 필요할까요?"] }, sourceOrg: "공식 기관", sourceUrl: null });
    expect(emoji(sober.instagram)).toHaveLength(0);
    expect(composeReadableCaption([{ text: "💬 이미 작성한 질문", emoji: "💬" }, { text: "📅 원문 일정", emoji: "📅" }])).toBe("💬 이미 작성한 질문\n\n📅 원문 일정");
  });

  it("keeps the canonical question and exact source references while composing a family caption", () => {
    const metadata = familyDialogueMetadataFixture(), bundle = familyEvidenceFixture();
    const { contentRevision: _revision, sourceCredit: _credit, fullCaption: _full, origin: _origin, ...draft } = metadata.captionPackage!;
    if (!("hook" in draft)) throw new Error("Expected AI caption fixture");
    const copy = structuredClone(draft);
    const result = composeFamilyCaption(draft, bundle.snapshot, 17);
    expect(result.coreQuestion).toBe(draft.coreQuestion); expect(result.fullCaption).toContain(draft.coreQuestion);
    expect(result.fullCaption).toContain(draft.parentLine); expect(result.sourceCredit.length).toBeGreaterThan(0);
    expect(emoji(result.fullCaption).length).toBeLessThanOrEqual(6);
    expect(emoji(result.fullCaption).length).toBeGreaterThanOrEqual(3);
    expect(draft).toEqual(copy);
  });
});
