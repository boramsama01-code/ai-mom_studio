import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const controlled = vi.hoisted(() => ({ capture: vi.fn(), load: vi.fn(), image: vi.fn() }));
vi.mock("../server/services/familyEvidence", async original => {
  const actual = await original<typeof import("../server/services/familyEvidence")>();
  return { ...actual, captureFamilySourceSnapshot: controlled.capture, loadFamilyEvidence: controlled.load,
    putFamilyEvidence: async (_db: unknown, value: any) => value.payload,
    createFamilyEvidenceSet: async (_db: unknown, item: any, snapshot: any, analysis: any, research: any, sources: any[]) => ({ evidenceSetId: "unit-evidence", sourceSnapshotId: snapshot.id, sourceAnalysisId: analysis.sourceAnalysisId, resourceResearchId: research?.resourceResearchId ?? null, itemId: item.id, channelId: item.channelId, createdAt: new Date().toISOString(), facts: analysis.facts, resources: research?.verifiedResources ?? [], sourceIds: [...snapshot.sources, ...sources].map(value => value.id) }),
  };
});
vi.mock("../server/services/familyEditorialImage", () => ({ generateFamilyCoverArtwork: controlled.image }));
import type { DB } from "../server/db";
import type { Channel, ContentItem } from "../shared/schema";
import { defaultChannelRoleSettings } from "../shared/channelAi";
import { readingProfileForTemplateKey, READING_PROFILE_LOGO_ID } from "../shared/readingCardProfiles";
import { familyExecutionPlan, proposeFamilyDialogue, type FamilyGenerateInput } from "../server/services/familyEditorial";
import { familyEvidenceFixture } from "./fixtures/familyEvidence";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { createFamilyProviderMock } from "./fixtures/familyProvider";

const rows: any[] = [];
// Unit-only receipt sink. Real SQL locking/idempotency is exercised in the PG suite.
const empty = () => { const query: any = { where: () => query, orderBy: () => query, limit: () => query, then: (resolve: any) => Promise.resolve([]).then(resolve) }; return query; };
const db = { select: () => ({ from: () => empty() }), insert: () => ({ values: (value: any) => { rows.push(value); const pending: any = { onConflictDoNothing: () => pending, returning: async () => [{ id: value.id }], then: (resolve: any) => Promise.resolve(undefined).then(resolve) }; return pending; } }), update: () => ({ set: (value: any) => ({ where: async () => { const pending = [...rows].reverse().find(row => row.status === "running"); if (pending) Object.assign(pending, value); } }) }) } as unknown as DB;
function fixture(saved = false) {
  const aiSettings = defaultChannelRoleSettings(); aiSettings.editorial = { additionalResourcesAutoSearch: false, visitScope: "off" };
  aiSettings.roleModels.article_analysis = { provider: "gemini", model: "gemini-analysis-unit" };
  aiSettings.roleModels.card_copy = { provider: "openai", model: "gpt-copy-unit" };
  aiSettings.roleModels.caption = { provider: "openai", model: "gpt-caption-unit" };
  aiSettings.roleModels.editorial_review = { provider: "openai", model: "gpt-review-unit" };
  const channel = { id: 2, slug: "current-dialogue", name: "알리고당", description: "아이와 함께 나누는 뉴스", audience: "중학생과 부모", editorialGuide: "", version: 7, aiSettings, budget: { llmCallsPerRun: 12 } } as Channel;
  const item = { id: 1, channelId: 2, version: 4, currentRevisionId: 30, kind: "science_dialogue", title: "게이츠의 전망" } as ContentItem;
  const revision = { id: 30, payload: saved ? { cardCopy: familyDialogueCardFixture(), ...familyDialogueMetadataFixture() } : {} };
  const input: FamilyGenerateInput = { version: 4, requestId: randomUUID(), formatId: "family_dialogue_8", templateKey: "set:n03", scope: "all", baseRevision: 30 };
  return { channel, item, revision, input, plan: familyExecutionPlan(channel, 30) };
}
beforeEach(() => {
  rows.length = 0; controlled.capture.mockReset().mockResolvedValue(familyEvidenceFixture().snapshot); controlled.load.mockReset().mockResolvedValue(familyEvidenceFixture());
  controlled.image.mockReset().mockResolvedValue({ assetId: 991 });
  vi.stubEnv("GEMINI_API_KEY", "isolated-gemini-key"); vi.stubEnv("OPENAI_API_KEY", "isolated-openai-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("family editorial pipeline with mock provider HTTP", () => {
  it("pins the reading layout and approved profile asset while preserving manual text and photos on regeneration", async () => {
    const f = fixture(true), payload = f.revision.payload as any, profile = readingProfileForTemplateKey("reading-ink-lime-v1")!;
    f.input.templateKey = profile.templateKey;
    payload.cardCopy.pages[1].displayOverrides = { sourceCredit: "직접 확인한 기사", kicker: "오늘 함께 읽기" };
    payload.cardCopy.pages[7].fields.brandLine = "서로의 판단 기준을 나눠요";
    payload.pageDesigns.cover.background = { ...payload.pageDesigns.cover.background, kind: "image", assetId: 700 };
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy?.templateKey).toBe(profile.templateKey);
    expect(result.copy?.pages[7].fields).toMatchObject({ logoAssetId: READING_PROFILE_LOGO_ID, brandLine: "서로의 판단 기준을 나눠요" });
    expect(result.copy?.pages[1].displayOverrides).toEqual(payload.cardCopy.pages[1].displayOverrides);
    expect(result.pageDesigns?.cover).toMatchObject({ alignment: "left", background: { kind: "image", assetId: 700, color: "#171918" } });
    expect(result.pageDesigns?.news_summary.background).toMatchObject({ kind: "brand", color: "#F4F3E9" });
    const contract = mock.calls.find(call => call.stage === "card_copy")?.input.templateContract;
    expect(contract.fixedTypography).toMatchObject({ doNotShrink: true, countExplicitLineBreaks: true });
    expect(contract.fixedTypography.fields).toHaveLength(46);
    expect(contract.fixedTypography.fields.find((field: any) => field.field === "P01_HEADLINE")).toMatchObject({ fontSize: 112, maxLines: 2 });
    expect(controlled.image).not.toHaveBeenCalled();
    expect(payload.cardCopy.templateKey).toBe("set:n03");
  });

  it("preserves display overrides and manual brand values during full regeneration", async () => {
    const f = fixture(true), copy = (f.revision.payload as any).cardCopy;
    copy.pages[1].displayOverrides = { kicker: "", pageNumber: "두 번째", sourceCredit: "직접 대조한 출처" };
    copy.pages[7].fields.brandLine = "현재 콘텐츠에서 직접 쓴 브랜드 문구";
    copy.pages[7].fields.handle = "@current_content";
    const before = structuredClone(copy);
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy?.pages[1].displayOverrides).toEqual(before.pages[1].displayOverrides);
    expect(result.copy?.pages[7]).toMatchObject({ fields: { brandLine: before.pages[7].fields.brandLine, handle: "@current_content" } });
    expect((f.revision.payload as any).cardCopy).toEqual(before);
  });

  it("requires the actual main article before any paid stage", async () => {
    controlled.capture.mockResolvedValue(null); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const f = fixture(), result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result).toMatchObject({ status: "needs_source", copy: null, reviewFlags: [{ code: "full_source_required" }] });
    expect(fetcher).not.toHaveBeenCalled(); expect(rows).toEqual([]); expect(controlled.image).not.toHaveBeenCalled();
  });
  it("uses each admission-pinned role in separate requests and proposes a cover asset without saving source copy", async () => {
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const f = fixture(), before = structuredClone(f.revision.payload);
    f.channel.aiSettings = defaultChannelRoleSettings(); // settings changed after admission
    const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.reviewFlags, JSON.stringify(rows)).toEqual([]);
    expect(result.copy?.pages).toHaveLength(8); expect(result.pageDesigns?.cover.background).toMatchObject({ kind: "image", assetId: 991 });
    expect(result.copy?.pages[7]).toMatchObject({ fields: { brandLine: "오늘, 서로의 어떤 생각을 발견했나요?" } });
    expect(JSON.stringify(mock.calls[0].body)).toContain("중·고등학생 자녀와 학부모");
    expect(result.parentGuide?.coreQuestion).toBe(result.editorialPlan?.coreQuestion); expect(result.captionPackage?.coreQuestion).toBe(result.editorialPlan?.coreQuestion);
    expect(mock.calls.map(call => call.stage)).toEqual(["article_analysis", "editorial_plan", "card_copy", "caption", "image_brief", "editorial_review"]);
    expect(mock.calls[0].url).toContain("gemini-analysis-unit"); expect(mock.calls.find(call => call.stage === "card_copy")?.body.model).toBe("gpt-copy-unit");
    expect(mock.calls.find(call => call.stage === "caption")?.body.model).toBe("gpt-caption-unit"); expect(mock.calls.find(call => call.stage === "editorial_review")?.body.model).toBe("gpt-review-unit");
    expect(result.generationRuns?.every(run => run.provenance?.settingsVersion === 7)).toBe(true);
    expect(f.revision.payload).toEqual(before); expect(result.captionPackage?.contentRevision).toBe(30); expect(controlled.image).toHaveBeenCalledOnce();
  });
  it("keeps verified analysis when copy fails without automatically repeating paid requests", async () => {
    const mock = createFamilyProviderMock({ failStages: new Set(["card_copy"]) }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const f = fixture(), result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy).toBeNull(); expect(result.sourceAnalysis?.facts).toHaveLength(2); expect(result.evidenceBinding?.sourceAnalysisId).toBe(result.sourceAnalysis?.sourceAnalysisId);
    expect(result.generationRuns?.at(-1)).toMatchObject({ stage: "card_copy", status: "failed", provenance: { usageStatus: "usage_unknown" } });
    expect(mock.calls.filter(call => call.stage === "card_copy")).toHaveLength(1); expect(controlled.image).not.toHaveBeenCalled();
    expect(f.revision.payload).toEqual({}); expect(JSON.stringify(result)).not.toContain("isolated upstream error body");
  });
  it("returns editable eight-page text when automatic cover generation fails", async () => {
    controlled.image.mockResolvedValue({ assetId: null, reviewFlag: { path: "pageDesigns.cover.background", code: "cover_image_incomplete", message: "그림 응답을 확인하지 못했습니다. 문구는 유지했습니다." } });
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const f = fixture(), result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy?.pages).toHaveLength(8); expect(result.captionPackage).toBeTruthy(); expect(result.parentGuide).toBeTruthy();
    expect(result.status).toBe("needs_review"); expect(result.reviewFlags).toContainEqual(expect.objectContaining({ code: "cover_image_incomplete" }));
  });
  it("keeps existing user background selections and does not buy an unsolicited replacement image", async () => {
    const f = fixture(true); (f.revision.payload as any).pageDesigns.cover.background = { ...(f.revision.payload as any).pageDesigns.cover.background, kind: "image", assetId: 700 };
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy?.pages).toHaveLength(8); expect(result.pageDesigns?.cover.background.assetId).toBe(700); expect(controlled.image).not.toHaveBeenCalled();
  });
  it("rejects invented quotes before planning or writing cards", async () => {
    const mock = createFamilyProviderMock({ transform: (call, data) => { if (call.stage === "article_analysis") data.facts[0].evidenceExcerpt = "This quotation is not in the source"; return data; } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const f = fixture(), result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy).toBeNull(); expect(result.reviewFlags[0].code).toBe("unsupported_excerpt"); expect(mock.calls).toHaveLength(1);
  });
  it("does not let copy generation silently change the approved central question", async () => {
    const mock = createFamilyProviderMock({ transform: (call, data) => { if (call.stage === "card_copy") data.editorialPlan.coreQuestion = "원문과 무관한 다른 질문인가요?"; return data; } }); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const f = fixture(), result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
    expect(result.copy).toBeNull(); expect(result.reviewFlags.map(flag => flag.code)).toContain("plan_changed"); expect(controlled.image).not.toHaveBeenCalled();
  });
  it("runs only the copy role for a selected field, retaining other pages and dependent outputs for review", async () => {
    const f = fixture(true), before = structuredClone(f.revision.payload), path = "pages.implication.fields.takeaway";
    const mock = createFamilyProviderMock(); vi.stubGlobal("fetch", vi.fn(mock.fetch));
    const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, { ...f.input, scope: "field", pageId: "implication", allowedFieldPaths: [path] }, f.plan);
    expect(mock.calls.map(call => call.stage)).toEqual(["partial_copy"]); expect(controlled.capture).not.toHaveBeenCalled(); expect(controlled.image).not.toHaveBeenCalled();
    expect(result.copy?.pages.filter(page => page.id !== "implication")).toEqual((before as any).cardCopy.pages.filter((page: any) => page.id !== "implication"));
    expect(result.dependencies).toMatchObject({ caption: "needs_review", render: "needs_review" }); expect(result.targetFieldHash).toMatch(/^[a-f0-9]{64}$/); expect(f.revision.payload).toEqual(before);
  });
  it("stops before provider I/O for a locked field or stale target hash", async () => {
    const f = fixture(true), path = "pages.cover.fields.headline", fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    (f.revision.payload as any).fieldLocks[path] = true;
    await expect(proposeFamilyDialogue(db, f.item, f.channel, f.revision, { ...f.input, scope: "field", pageId: "cover", allowedFieldPaths: [path] }, f.plan)).rejects.toThrow("잠겨");
    (f.revision.payload as any).fieldLocks[path] = false;
    await expect(proposeFamilyDialogue(db, f.item, f.channel, f.revision, { ...f.input, scope: "field", pageId: "cover", allowedFieldPaths: [path], targetFieldHash: "old-hash" }, f.plan)).rejects.toThrow("변경");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
