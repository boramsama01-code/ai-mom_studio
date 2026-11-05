import { defaultPageDesigns, familyCardCopySchema, type CardCopyV2, type FamilyDialogueMetadata, type aiCaptionPackageSchema } from "../../shared/familyDialogue";
import type { z } from "zod";

/** Manually authored test proposal about the supplied Gates interview.
 * It is neither an AI response nor a saved production revision. */
export function familyDialogueCardFixture(): CardCopyV2 {
  return familyCardCopySchema.parse({ version: 2, formatId: "family_dialogue_8", templateKey: "set:n03", pages: [
    { id: "cover", type: "cover", page: 1, layout: "centered", fields: { headline: "AI가 더 잘하면,\n더 똑똑할까?", subtitle: "빌 게이츠의 전망에서 시작하는 지능 이야기" }, claimRefs: [] },
    { id: "news_summary", type: "news_summary", page: 2, layout: "facts", fields: { title: "게이츠가 내다본 미래", facts: ["게이츠는 AI가 전문 업무에서 앞설 것으로 전망했어요.", "기사는 인터뷰 발언을 전하며 미래를 이야기해요."], caveat: "모든 지능에서 우월하다는 연구 결과는 아니에요." }, claimRefs: [{ fieldPath: "fields.facts.0", claimType: "forecast", factIds: ["F1"], resourceIds: [] }, { fieldPath: "fields.facts.1", claimType: "attributed_statement", factIds: ["F2"], resourceIds: [] }] },
    { id: "implication", type: "implication", page: 3, layout: "takeaway", fields: { title: "평가 기준이 달라질 때", takeaway: "문제를 잘 푸는 능력과, 어떤 문제가 중요한지 판단하는 능력은 다르게 평가할 수 있어요." }, claimRefs: [{ fieldPath: "fields.takeaway", claimType: "editorial_interpretation", factIds: [], resourceIds: [] }] },
    { id: "discussion", type: "discussion", page: 4, layout: "question", fields: { title: "좋은 답의 기준은?", scenario: "만약 AI는 답을 빨리 찾고, 친구는 이유를 잘 설명한다면?", question: "무엇을 할 수 있어야 똑똑하다고 볼까요?" }, claimRefs: [{ fieldPath: "fields.scenario", claimType: "hypothetical", factIds: [], resourceIds: [] }, { fieldPath: "fields.question", claimType: "question", factIds: [], resourceIds: [] }] },
    { id: "perspectives", type: "perspectives", page: 5, layout: "stacked", fields: { title: "무엇을 중요하게 볼까?", viewA: { label: "결과를 볼 때", body: "도구를 활용해 빠르고 정확하게 해결하는 것도 능력이에요." }, viewB: { label: "이해를 볼 때", body: "왜 그런지 설명하고 잘못된 조건을 찾는 힘도 중요해요." } }, claimRefs: [{ fieldPath: "fields.viewA.body", claimType: "editorial_interpretation", factIds: [], resourceIds: [] }, { fieldPath: "fields.viewB.body", claimType: "editorial_interpretation", factIds: [], resourceIds: [] }] },
    { id: "concept", type: "concept", page: 6, layout: "value_definition", fields: { mode: "value_definition", title: "똑똑함의 경계", concept: "똑똑함", definitionA: "주어진 문제를 빠르게 해결하는 힘", definitionB: "좋은 문제인지 묻고 이유를 설명하는 힘", boundaryCase: "답은 맞지만 이유를 모른다면 어떤가요?", fillIn: "나는 똑똑함을 ___라고 정의한다." }, claimRefs: [] },
    { id: "activity", type: "activity", page: 7, layout: "home_only", fields: { title: "전망과 사실, 색을 나누기", homeActivity: { label: "원문에 두 가지 색 칠하기", action: "원문에서 확인된 사실은 파랑, 미래의 전망은 노랑으로 표시해 보세요.", resourceId: null }, optionalActivity: null }, claimRefs: [] },
    { id: "outro", type: "outro", page: 8, layout: "brand_close", fields: { brandName: "ALLligodang", parentBrand: "우주펭귄상회", brandLine: "오늘의 뉴스, 우리 집의 대화.", cta: "다음 대화도 함께하려면 저장해 주세요.", handle: "@test_allligodang", logoAssetId: "brand:space-penguin-company:20261101" }, claimRefs: [] },
  ] });
}

export function familyDialogueMetadataFixture(contentRevision = 30): FamilyDialogueMetadata & { captionPackage: z.infer<typeof aiCaptionPackageSchema> } {
  const question = "무엇을 할 수 있어야 똑똑하다고 볼까요?";
  return {
    editorialPlan: { articleCore: "게이츠의 인터뷰에 담긴 AI 전망", coreQuestion: question, thinkingSkill: "perspectives", keyConcept: "똑똑함", conceptMode: "value_definition", connectionReason: "전문 업무 성과에 대한 전망에서 지능을 판단하는 기준을 함께 묻습니다.", essentialConditions: ["인물의 전망이며 모든 지능의 우월성을 검증한 연구 결과가 아닙니다."], questionCandidates: [question], resourceNeeds: [] },
    evidenceBinding: { evidenceSetId: "fixture-evidence-28-v2", sourceSnapshotId: "fixture-source-2600", sourceAnalysisId: "fixture-analysis-2600", resourceResearchId: null },
    pageDesigns: defaultPageDesigns(), fieldLocks: {}, generationRuns: [], visualBriefs: {}, editorialReview: null,
    dependencies: { caption: "current", visuals: "not_generated", review: "not_generated", render: "not_generated" },
    parentGuide: { timing: [
      { step: "read", minutes: 2, instruction: "기사를 누가 어떤 말로 전했는지 함께 읽어요." },
      { step: "question", minutes: 4, instruction: "각자 생각하는 기준을 한 가지씩 말해 보세요." },
      { step: "compare", minutes: 3, instruction: "서로 다른 두 기준을 비교하고 나의 정의를 적어 봐요." },
      { step: "close", minutes: 1, instruction: "오늘 들은 생각을 한 문장으로 돌려줘요." },
    ], coreQuestion: question, optionalFollowup: "그 기준이 통하지 않는 경우도 있을까요?", optionalDeepening: "두 능력을 비교한다면 무엇을 측정할 수 있을까요?", whenUnsure: "아직 몰라도 괜찮아. 떠오르는 장면부터 이야기해 볼까?", whenDisagree: "서로 무엇을 중요하게 생각했는지 먼저 들어보자.", whenMisunderstood: "그 말이 기사에 있었는지 원문을 같이 찾아볼까?", whenTired: "오늘은 여기까지 해도 좋아. 이야기해 줘서 고마워.", closingReflection: "네가 ___를 중요하게 생각했다는 말이 기억에 남아." },
    captionPackage: { contentRevision, hook: "AI가 더 잘하면, 더 똑똑할까요?", newsSummary: "빌 게이츠가 인터뷰에서 전한 AI 전망을 출발점으로 삼았습니다.", coreQuestion: question, conversationGuide: "읽기 2분 · 질문 4분 · 관점과 개념 3분 · 마무리 1분", parentLine: "아직 몰라도 괜찮아. 네가 중요하게 생각하는 기준은 무엇이니?", optionalFollowup: null, cta: "다음 대화를 위해 저장해 주세요.", hashtags: ["#가족대화", "#뉴스읽기", "#생각하는힘"], sourceCredit: [{ title: "제공된 빌 게이츠 인터뷰 기사", publisher: "테스트용 원문 메타데이터", url: "https://source.example/gates-interview" }], fullCaption: `AI가 더 잘하면, 더 똑똑할까요?\n\n빌 게이츠가 인터뷰에서 전한 전망에서 출발해 이야기해 봅니다.\n\n${question}\n\n읽기 2분 · 질문 4분 · 관점과 개념 3분 · 마무리 1분\n\n아직 몰라도 괜찮아. 네가 중요하게 생각하는 기준은 무엇이니?\n\n다음 대화를 위해 저장해 주세요.\n#가족대화 #뉴스읽기 #생각하는힘` },
  };
}

export function scientificFamilyCardFixture(): CardCopyV2 {
  const copy = familyDialogueCardFixture();
  copy.pages[5] = { id: "concept", type: "concept", page: 6, layout: "scientific_explanation", fields: { mode: "scientific_explanation", title: "측정으로 설명하는 속력", concept: "평균 속력", acceptedDefinition: "이동한 거리를 걸린 시간으로 나눈 값이에요.", exampleOrNonExample: "같은 거리를 짧은 시간에 갔다면 평균 속력이 커요.", fillIn: "내 말로 설명하면 ___" }, claimRefs: [{ fieldPath: "fields.acceptedDefinition", claimType: "research_finding", factIds: ["F3"], resourceIds: [] }] };
  return familyCardCopySchema.parse(copy);
}
