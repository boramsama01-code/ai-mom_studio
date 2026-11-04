import { describe, expect, it } from "vitest";
import { familyCardCopyAiSchema, familyCardCopySchema } from "../shared/familyDialogue";
import { resolveFamilyDialogueSettings, normalizeOptionalResourceInput, familyDialogueSettingsSchema } from "../shared/familyDialogueSettings";
import { storedCardCopySchema } from "../shared/storedCardCopy";
import { familyEvidenceView, validateFamilyEvidenceReferences, validateFamilySourceAnalysis } from "../server/services/familyEvidence";
import { applyFamilyFieldPatches, composeFamilyCaption, familyTargetHash, selectedFamilyResources, synchronizeFamilyQuestion, validateFamilyLockedFields, validateFamilyReviewScope } from "../server/services/familyEditorial";
import { verifyFamilyResourceCandidate } from "../server/services/familyResourceResearch";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { familyAiDraftFixture, familyEvidenceFixture } from "./fixtures/familyEvidence";
import { cardCopyFixture } from "./fixtures/cardCopy";

describe("v2 editorial contracts and evidence", () => {
  it("keeps v1 readable and requires exactly eight semantic v2 pages without a ninth cover", () => {
    const copy = familyDialogueCardFixture();
    expect(storedCardCopySchema.parse(cardCopyFixture()).version).toBe(1);
    expect(storedCardCopySchema.parse(copy).version).toBe(2);
    expect(familyCardCopySchema.safeParse({ ...copy, pages: [...copy.pages, copy.pages[0]] }).success).toBe(false);
    expect(familyCardCopySchema.safeParse({ ...copy, pages: [...copy.pages].reverse() }).success).toBe(false);
    expect(familyCardCopyAiSchema.safeParse(familyAiDraftFixture().cardCopy).success).toBe(true);
  });
  it("keeps generous manual text without applying initial AI budgets or silent truncation", () => {
    const copy = familyDialogueCardFixture();
    if (copy.pages[0].id === "cover") copy.pages[0].fields.headline = "운영자가 직접 추가한 문장을 전부 저장하며 글자를 잘라 버리지 않습니다.";
    expect(familyCardCopySchema.parse(copy)).toEqual(copy);
    expect(familyCardCopyAiSchema.safeParse(copy).success).toBe(false);
  });
  it("checks actual source excerpts and distinguishes article-only from primary verification", () => {
    const bundle = familyEvidenceFixture();
    expect(validateFamilySourceAnalysis(bundle.analysis, bundle.snapshot)).toEqual([]);
    bundle.analysis.facts[0].evidenceExcerpt = "원문에는 없는 주장";
    bundle.analysis.facts[1].verificationStatus = "primary_checked";
    expect(validateFamilySourceAnalysis(bundle.analysis, bundle.snapshot).map(error => error.code)).toEqual(["unsupported_excerpt", "overstated_scope"]);
  });
  it("preserves a forecast speaker and rejects promotion into a research finding", () => {
    const copy = familyDialogueCardFixture(), bundle = familyEvidenceFixture(), metadata = familyDialogueMetadataFixture();
    expect(validateFamilyEvidenceReferences(copy, bundle, metadata.editorialPlan, metadata.parentGuide)).toEqual([]);
    copy.pages[1].claimRefs[0].claimType = "research_finding";
    expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("claim_promotion");
    copy.pages[1].claimRefs[0].claimType = "forecast";
    if (copy.pages[1].id === "news_summary") copy.pages[1].fields = { title: "확정한 결과", facts: ["AI가 사람보다 똑똑합니다.", "미래는 이미 정해졌습니다."], caveat: null };
    expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("forecast_attribution");
  });
  it("rejects fact/resource IDs outside this immutable evidence set", () => {
    const copy = familyDialogueCardFixture(), bundle = familyEvidenceFixture();
    copy.pages[1].claimRefs[0].factIds = ["F99"];
    expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("unknown_evidence");
    if (copy.pages[6].id === "activity") copy.pages[6].fields.optionalActivity = { label: "허구의 논문", action: "이 문헌에서 증거를 찾아보세요.", resourceId: "R99" };
    expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("invalid_activity_resource");
  });
  it("cannot relabel a summary forecast as a question or interpretation to bypass attribution and conditions", () => {
    const bundle = familyEvidenceFixture();
    for (const claimType of ["question", "editorial_interpretation", "hypothetical", "attributed_statement"] as const) {
      const copy = familyDialogueCardFixture(); copy.pages[1].claimRefs[0].claimType = claimType;
      expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("summary_claim_type");
    }
    // Real questions, hypotheses and editorial interpretations on their own
    // pages remain valid; the stricter rule applies to news facts only.
    expect(validateFamilyEvidenceReferences(familyDialogueCardFixture(), bundle)).toEqual([]);
  });
  it("does not qualify an attributed forecast or another page's field as a scientific definition", () => {
    const copy = familyDialogueCardFixture(), bundle = familyEvidenceFixture();
    copy.pages[5] = { id: "concept", type: "concept", page: 6, layout: "scientific_explanation", fields: { mode: "scientific_explanation", title: "속력", concept: "평균 속력", acceptedDefinition: "거리를 시간으로 나눈 값", exampleOrNonExample: "같은 거리를 더 빨리 이동해요.", fillIn: "내 말로 설명하면 ___" }, claimRefs: [{ fieldPath: "fields.acceptedDefinition", claimType: "research_finding", factIds: ["F1"], resourceIds: [] }] };
    expect(validateFamilyEvidenceReferences(copy, bundle).map(error => error.code)).toContain("definition_evidence_type");
    copy.pages[5].claimRefs[0].fieldPath = "pages.cover.fields.acceptedDefinition";
    const codes = validateFamilyEvidenceReferences(copy, bundle).map(error => error.code);
    expect(codes).toContain("invalid_evidence_path"); expect(codes).toContain("definition_needs_source");
  });
  it("does not accept a scientific definition without a source reference", () => {
    const copy = familyDialogueCardFixture();
    copy.pages[5] = { id: "concept", type: "concept", page: 6, layout: "scientific_explanation", fields: { mode: "scientific_explanation", title: "속력", concept: "평균 속력", acceptedDefinition: "거리를 시간으로 나눈 값", exampleOrNonExample: "같은 거리를 더 빨리 이동해요.", fillIn: "내 말로 설명하면 ___" }, claimRefs: [] };
    expect(validateFamilyEvidenceReferences(copy, familyEvidenceFixture()).map(error => error.code)).toContain("definition_needs_source");
  });
});

describe("partial proposal isolation", () => {
  it("enforces indexed fact locks during a full proposal, including deleted array members", () => {
    const original = familyDialogueCardFixture(), edited = structuredClone(original), path = "pages.news_summary.fields.facts.0";
    if (edited.pages[1].id === "news_summary") edited.pages[1].fields.facts[0] = "잠긴 사실을 바꾼 문장";
    expect(validateFamilyLockedFields(original, edited, { [path]: true })).toEqual([expect.objectContaining({ path, code: "locked_field_changed" })]);
    expect(validateFamilyLockedFields(original, edited, { [path]: false })).toEqual([]);
    const third = structuredClone(original);
    if (third.pages[1].id === "news_summary") third.pages[1].fields.facts.push("세 번째로 잠근 사실");
    expect(validateFamilyLockedFields(third, original, { "pages.news_summary.fields.facts.2": true })).toHaveLength(1);
    expect(validateFamilyLockedFields(original, edited, { "pages.news_summary.fields.facts": true })).toHaveLength(1);
    expect(validateFamilyLockedFields(original, structuredClone(original), { [path]: true })).toEqual([]);
  });
  it("changes one semantic field and its refs atomically while preserving every other page", () => {
    const original = familyDialogueCardFixture(), before = structuredClone(original);
    const path = "pages.implication.fields.takeaway", value = "능력을 비교하려면 무엇을 잘하는지부터 살펴봐야 해요.";
    const updated = applyFamilyFieldPatches(original, [{ path, value, claimRefs: [{ fieldPath: "fields.takeaway", claimType: "editorial_interpretation", factIds: [], resourceIds: [] }] }], [path], {});
    expect(original).toEqual(before);
    expect(updated.pages.filter(page => page.id !== "implication")).toEqual(before.pages.filter(page => page.id !== "implication"));
    expect(updated.pages[2]).toMatchObject({ fields: { takeaway: value }, claimRefs: [{ fieldPath: "fields.takeaway", claimType: "editorial_interpretation" }] });
  });
  it("rejects locked paths, collateral edits, duplicate fields and mismatched evidence paths", () => {
    const copy = familyDialogueCardFixture(), path = "pages.cover.fields.headline", patch = { path, value: "새 제목", claimRefs: [] };
    expect(() => applyFamilyFieldPatches(copy, [patch], [path], { [path]: true })).toThrow("잠금");
    expect(() => applyFamilyFieldPatches(copy, [patch], ["pages.discussion.fields.question"], {})).toThrow("허용");
    expect(() => applyFamilyFieldPatches(copy, [patch, patch], [path], {})).toThrow("허용");
    expect(() => applyFamilyFieldPatches(copy, [{ ...patch, claimRefs: [{ fieldPath: "fields.subtitle", claimType: "question", factIds: [], resourceIds: [] }] }], [path], {})).toThrow("범위");
  });
  it("hashes selected values and evidence, leaving unrelated changes out of a field hash", () => {
    const copy = familyDialogueCardFixture(), metadata = familyDialogueMetadataFixture(), path = "pages.cover.fields.headline", initial = familyTargetHash(copy, metadata, [path]);
    if (copy.pages[3].id === "discussion") copy.pages[3].fields.title = "다른 질문 제목";
    expect(familyTargetHash(copy, metadata, [path])).toBe(initial);
    if (copy.pages[0].id === "cover") copy.pages[0].fields.headline = "새 표지";
    expect(familyTargetHash(copy, metadata, [path])).not.toBe(initial);
    expect(familyTargetHash(familyDialogueCardFixture(), { ...metadata, evidenceBinding: { ...metadata.evidenceBinding, evidenceSetId: "new-evidence" } }, [path])).not.toBe(initial);
  });
  it("uses one manual question in plan and parent guide while keeping the old caption for review", () => {
    const copy = familyDialogueCardFixture(), metadata = familyDialogueMetadataFixture();
    if (copy.pages[3].id === "discussion") copy.pages[3].fields.question = "우리의 기준은 언제 바뀔까요?";
    const updated = synchronizeFamilyQuestion(copy, metadata);
    expect(updated.editorialPlan.coreQuestion).toBe("우리의 기준은 언제 바뀔까요?");
    expect(updated.parentGuide?.coreQuestion).toBe(updated.editorialPlan.coreQuestion);
    expect(updated.captionPackage).toEqual(metadata.captionPackage);
  });
});

describe("resource verification and honest scopes", () => {
  const candidate = () => ({ sourceId: "resource-1", kind: "visit" as const, evidenceExcerpt: "서울에서 2026년 1월 1일부터 2026년 12월 31일까지 운영하는 지능과 측정 전시입니다.", connectionReason: "평가 기준을 비교하는 전시", readingTarget: "측정 전시 안내", action: "측정의 조건을 비교해 보세요.", priority: 1, visitRegion: "서울", availability: { startsAt: "2026-01-01", endsAt: "2026-12-31", evidenceExcerpt: "2026년 1월 1일부터 2026년 12월 31일까지 운영" } });
  const source = () => ({ ...familyEvidenceFixture().snapshot.sources[0], id: "resource-1", role: "researched" as const, scope: "web_page" as const, title: "서울 측정 전시", text: `${candidate().evidenceExcerpt} 전시의 관찰 활동에서는 하나의 조건만 바꾸어 비교하고, 같은 측정 도구를 사용하도록 안내합니다. 공식 안내에서 실제 운영하는 프로그램과 방문 기간을 확인할 수 있습니다.` });
  it("does not turn a search result into read evidence and enforces off/region/national settings", () => {
    expect(verifyFamilyResourceCandidate(candidate(), { ...source(), scope: "search_result" }, { visitScope: "national", today: "2026-11-04", recommendationEligible: true }).resource).toBeNull();
    expect(verifyFamilyResourceCandidate(candidate(), source(), { visitScope: "off", today: "2026-11-04", recommendationEligible: true }).resource).toBeNull();
    expect(verifyFamilyResourceCandidate(candidate(), source(), { visitScope: "region", activityRegion: "부산", today: "2026-11-04", recommendationEligible: true }).resource).toBeNull();
    expect(verifyFamilyResourceCandidate(candidate(), source(), { visitScope: "region", activityRegion: "서울", today: "2026-11-04", recommendationEligible: true }).resource?.title).toBe(source().title);
  });
  it("rejects expired or invented visit dates and abstract-only full-paper instructions", () => {
    expect(verifyFamilyResourceCandidate(candidate(), source(), { visitScope: "national", today: "2027-01-02", recommendationEligible: true }).resource).toBeNull();
    expect(verifyFamilyResourceCandidate({ ...candidate(), availability: { ...candidate().availability, endsAt: "2027-12-31" } }, source(), { visitScope: "national", today: "2026-11-04", recommendationEligible: true }).resource).toBeNull();
    expect(verifyFamilyResourceCandidate({ ...candidate(), kind: "paper", readingTarget: "논문 본문의 그림 3", availability: null }, { ...source(), scope: "abstract" }, { visitScope: "off", today: "2026-11-04", recommendationEligible: true }).resource).toBeNull();
  });
  it("preserves false and zero, defaults auto search on and requires an explicit region", () => {
    expect(resolveFamilyDialogueSettings(undefined)).toEqual({ additionalResourcesAutoSearch: true, visitScope: "off" });
    expect(resolveFamilyDialogueSettings({ additionalResourcesAutoSearch: false })).toMatchObject({ additionalResourcesAutoSearch: false });
    expect(normalizeOptionalResourceInput({ region: "없음", enabled: false, count: 0 })).toEqual({ enabled: false, count: 0 });
    expect(familyDialogueSettingsSchema.safeParse({ visitScope: "region" }).success).toBe(false);
    expect(familyDialogueSettingsSchema.safeParse({ visitScope: "national" }).success).toBe(true);
  });
  it("credits manually provided text without manufacturing a public URL", () => {
    const metadata = familyDialogueMetadataFixture(), bundle = familyEvidenceFixture(), { contentRevision: _r, sourceCredit: _s, fullCaption: _f, ...draft } = metadata.captionPackage!;
    bundle.snapshot.sources[0].finalUrl = "manual://pasted-body";
    const caption = composeFamilyCaption(draft, bundle.snapshot, 99);
    expect(caption.sourceCredit[0].url).toBeNull(); expect(caption.contentRevision).toBe(99);
    expect(caption.fullCaption).toContain("직접 제공한 원문"); expect(caption.fullCaption).not.toContain("manual://");
    expect(caption.fullCaption).toContain(metadata.editorialPlan.coreQuestion);
  });
  it("exposes the actual read scope without article bodies and credits only resources used in the card", () => {
    const bundle = familyEvidenceFixture(), copy = familyDialogueCardFixture(), metadata = familyDialogueMetadataFixture();
    const verified = verifyFamilyResourceCandidate({ ...candidate(), kind: "online", availability: null }, source(), { visitScope: "off", today: "2026-11-04", recommendationEligible: true }).resource!;
    bundle.evidenceSet.resources = [{ ...verified, id: "R1", url: "https://museum.example/measure" }, { ...verified, id: "R2", title: "사용하지 않은 자료", url: "https://museum.example/unused" }];
    bundle.researchedSources = [source()];
    if (copy.pages[6].id === "activity") copy.pages[6].fields.optionalActivity = { label: "측정 기준 비교", action: "안내에 나온 비교 기준 하나를 찾아보세요.", resourceId: "R1" };
    const selected = selectedFamilyResources(copy, bundle.evidenceSet.resources);
    expect(selected.map(value => value.id)).toEqual(["R1"]);
    const { contentRevision: _r, sourceCredit: _s, fullCaption: _f, ...draft } = metadata.captionPackage;
    const caption = composeFamilyCaption(draft, bundle.snapshot, 99, selected);
    expect(caption.sourceCredit.map(value => value.url)).toContain("https://museum.example/measure");
    expect(caption.fullCaption).toContain("https://museum.example/measure"); expect(caption.fullCaption).not.toContain("unused");
    const view = familyEvidenceView(bundle);
    expect(view.evidenceSetId).toBe(bundle.evidenceSet.evidenceSetId); expect(view.sources.at(-1)).toMatchObject({ scope: "web_page", fetchedAt: expect.any(String) });
    expect(view.sources.every(value => !("text" in value) && !("requestedUrl" in value))).toBe(true);
  });
  it("does not pass image/render checks when only text was submitted", () => {
    const base = { reviewScope: ["text" as const], checks: [], issues: [], minimumPatches: [], mustFixBeforeUse: false };
    expect(validateFamilyReviewScope(base)).toEqual([]);
    expect(validateFamilyReviewScope({ ...base, reviewScope: ["text", "images"] })).toHaveLength(1);
    expect(validateFamilyReviewScope({ ...base, checks: [{ name: "최종 렌더", status: "passed", detail: "" }] })).toHaveLength(1);
    expect(validateFamilyReviewScope({ ...base, checks: [{ name: "이미지 브리프", status: "passed", detail: "문서만 확인" }] })).toEqual([]);
  });

});
