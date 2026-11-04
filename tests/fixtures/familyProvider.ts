import sharp from "sharp";
import type { SourceAnalysis } from "../../shared/familyEvidence";
import { familyAiDraftFixture } from "./familyEvidence";
import { familyDialogueMetadataFixture } from "./familyDialogueCard";

export type FamilyMockStage = "article_analysis" | "editorial_plan" | "resource_search" | "resource_research" | "card_copy" | "caption" | "image_brief" | "editorial_review" | "partial_copy" | "image_generation";
export type FamilyMockCall = { stage: FamilyMockStage; url: string; body: any; input: any };
function inputFrom(body: any) {
  const text = typeof body.input === "string" ? body.input : body.contents?.find((entry: any) => entry.role === "user")?.parts?.map((part: any) => part.text ?? "").join("") ?? body.messages?.[0]?.content;
  try { return typeof text === "string" ? JSON.parse(text) : {}; } catch { return {}; }
}
function stageFrom(url: string, body: any, input: any): FamilyMockStage {
  if (url.includes("/images/")) return "image_generation";
  if (body.tools?.some((tool: any) => tool.googleSearch)) return "resource_search";
  if (body.text?.format?.name?.startsWith("family_")) return body.text.format.name.slice(7);
  if (input.sourceAnalysisId) return "article_analysis";
  if (input.allowedFieldPaths) return "partial_copy";
  if (input.templateContract) return "card_copy";
  if (input.actualImagesProvided === false) return "editorial_review";
  if (input.providedResources) return "resource_research";
  if (input.pageId) return "image_brief";
  if (input.sourceCredit) return "caption";
  if (input.sourceAnalysis) return "editorial_plan";
  throw new Error("Unexpected non-editorial provider request in isolated fixture");
}
export function familyMockStageData(stage: FamilyMockStage, input: any): unknown {
  const draft = familyAiDraftFixture(), metadata = familyDialogueMetadataFixture();
  if (stage === "article_analysis") {
    const primary = input.sources.find((source: any) => source.role === "primary_article") ?? input.sources[0];
    const speaker = primary.text.includes("김가람") ? "김가람" : primary.text.includes("게이츠") ? "빌 게이츠" : null;
    const forecast = !!speaker && /전망|예측/.test(primary.text);
    const excerpts = primary.text.split(/(?<=[.!?。])\s+|\n+/).filter((value: string) => value.trim().length >= 4);
    const first = excerpts[0]?.slice(0, 240) ?? primary.text.slice(0, 200), second = excerpts[1]?.slice(0, 240) ?? first;
    const analysis: SourceAnalysis = { sourceSnapshotId: input.sourceSnapshotId, sourceAnalysisId: input.sourceAnalysisId, articleCore: "제공 기사에서 확인한 주장과 그 조건을 살펴봅니다.", articleType: forecast ? "forecast" : "report", facts: [
      { id: "F1", statement: forecast ? `${speaker}는 일부 평가의 미래 가능성을 전망했다.` : "기사에서 핵심 사건을 설명했다.", claimType: forecast ? "forecast" : "reported_event", speaker: forecast ? speaker : null, sourceId: primary.id, sourceScope: primary.scope, timeScope: forecast ? "미래 전망" : null, conditions: ["기사에 제시된 조건"], evidenceExcerpt: first, verificationStatus: "article_only" },
      { id: "F2", statement: forecast ? `${speaker}의 발언을 기사가 전했다.` : "기사에는 확인할 조건과 근거가 제시되어 있다.", claimType: forecast ? "attributed_statement" : "reported_event", speaker: forecast ? speaker : null, sourceId: primary.id, sourceScope: primary.scope, timeScope: null, conditions: [], evidenceExcerpt: second, verificationStatus: "article_only" },
    ], essentialConditions: ["확인한 기사 범위에서만 판단합니다."], cannotConclude: ["모든 상황에 그대로 적용된다는 결론"], missingInformation: [], headlineBodyGap: null, conceptCandidates: [{ concept: "똑똑함", mode: "value_definition", reason: "판단 기준을 비교합니다." }] };
    return analysis;
  }
  if (stage === "editorial_plan") return draft.editorialPlan;
  if (stage === "card_copy") {
    draft.editorialPlan = input.editorialPlan; draft.parentGuide.coreQuestion = input.editorialPlan.coreQuestion;
    draft.cardCopy.templateKey = input.templateContract.templateKey;
    const summary = draft.cardCopy.pages[1], discussion = draft.cardCopy.pages[3], outro = draft.cardCopy.pages[7];
    if (summary.id === "news_summary") { summary.fields.title = "기사에서 확인한 내용"; summary.fields.facts = input.sourceAnalysis.facts.slice(0, 2).map((fact: any) => fact.claimType === "forecast" ? `${fact.speaker}는 미래 가능성을 전망했어요.` : fact.claimType === "attributed_statement" ? `${fact.speaker}의 발언을 기사가 전했어요.` : fact.statement); summary.fields.caveat = "확인한 기사 범위에서만 판단해요."; summary.claimRefs = input.sourceAnalysis.facts.slice(0, 2).map((fact: any, index: number) => ({ fieldPath: `fields.facts.${index}`, claimType: fact.claimType, factIds: [fact.id], resourceIds: [] })); }
    if (discussion.id === "discussion") discussion.fields.question = input.editorialPlan.coreQuestion;
    if (outro.id === "outro") outro.fields = { ...outro.fields, ...input.channelSettings };
    return draft;
  }
  if (stage === "caption") {
    const { contentRevision: _r, sourceCredit: _c, fullCaption: _f, ...caption } = metadata.captionPackage!;
    return { ...caption, coreQuestion: input.editorialPlan.coreQuestion, newsSummary: "원문에서 확인한 내용과 조건을 함께 살펴봅니다." };
  }
  if (stage === "image_brief") return { pageId: input.pageId, visualSubject: "판단 기준을 상징하는 유리 저울과 작은 조명", composition: "실물 피사체를 하단에 놓고 상단과 중앙을 넓게 비웁니다.", mood: "차분한 사진 감각", palette: ["#202725", "#F4D66A"], textSafeArea: "상단 45%와 중앙 여백", referenceAssetIds: input.referenceAssetIds ?? [], avoidElements: ["글자", "새 로고", "실제 뉴스 현장처럼 보이는 연출"], imagePrompt: "An understated conceptual still life with subtle grain, dark green lighting and ample clean space above the objects; no text or logos." };
  if (stage === "editorial_review") return { reviewScope: ["source", "text", "caption", "image_brief"], checks: [{ name: "원문 구절과 문구 구분", status: "passed", detail: "이 격리 fixture의 텍스트만 대조했습니다." }, { name: "최종 렌더", status: "not_checked", detail: "이미지 바이트를 전달하지 않았습니다." }], issues: [], minimumPatches: [], mustFixBeforeUse: false };
  if (stage === "partial_copy") return { patches: input.allowedFieldPaths.map((path: string) => ({ path, value: path.endsWith("headline") ? "조건을 바꾸면, 답도 달라질까?" : "같은 결과라도 판단 기준은 다를 수 있어요.", claimRefs: [{ fieldPath: path.split(".").slice(2).join("."), claimType: "editorial_interpretation", factIds: [], resourceIds: [] }] })) };
  throw new Error(`No text fixture for ${stage}`);
}

/** Native wire responses for all seven roles. It never uses real HTTP or paid AI. */
export function createFamilyProviderMock(options: { failStages?: Set<FamilyMockStage>; failStatus?: number; onStage?: (call: FamilyMockCall) => void | Promise<void>; transform?: (call: FamilyMockCall, data: any) => any } = {}) {
  const calls: FamilyMockCall[] = [];
  let png: Promise<Buffer> | null = null;
  return { calls, fetch: async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url), body = JSON.parse(String(init?.body ?? "{}")), input = inputFrom(body), stage = stageFrom(address, body, input), call = { stage, url: address, body, input };
    calls.push(call); await options.onStage?.(call);
    if (options.failStages?.has(stage)) return new Response("isolated upstream error body", { status: options.failStatus ?? 502 });
    if (stage === "image_generation") {
      png ??= sharp({ create: { width: 24, height: 30, channels: 3, background: "#202725" } }).png().toBuffer();
      return new Response(JSON.stringify({ id: "image-fixture", model: body.model, data: [{ b64_json: (await png).toString("base64") }] }));
    }
    if (stage === "resource_search") return new Response(JSON.stringify({ modelVersion: "gemini-research-fixture", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "추가로 읽은 실제 자료가 없습니다." }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 8 } }));
    let data = familyMockStageData(stage, input);
    if (options.transform) data = options.transform(call, data);
    const output = { status: "ready", data, reviewFlags: [] };
    if (address.includes("generativelanguage.googleapis.com")) return new Response(JSON.stringify({ modelVersion: decodeURIComponent(address.match(/models\/([^:]+)/)?.[1] ?? "gemini-mock"), responseId: `fixture-${stage}`, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22, thoughtsTokenCount: 3 } }));
    return new Response(JSON.stringify({ id: `fixture-${stage}`, status: "completed", model: body.model, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 33, output_tokens: 44 } }));
  } };
}
