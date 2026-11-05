// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCopyEditor, type StoredCardCopyResponse } from "../client/src/CardCopyEditor";
import { familyCopyText, type FamilyDialogueResponse } from "../client/src/FamilyDialogueEditor";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { ApiError } from "../client/src/api";
import { activateDraftRecoveryScope } from "../client/src/draftRecovery";
import { READING_CARD_PROFILES, READING_PROFILE_LOGO_ID } from "../shared/readingCardProfiles";
import { defaultPageDesigns, familyFieldValue } from "../shared/familyDialogue";
import type { FamilyEvidenceView } from "../shared/familyEvidence";
import { familyEvidenceFixture } from "./fixtures/familyEvidence";
import { familyEvidenceView, validateFamilyEvidenceReferences } from "../server/services/familyEvidence";
import { FAMILY_PROFILE_ASSET_ID, FAMILY_ENDING_ASSET_IDS } from "../shared/characterVariantAssets";

const mocks = vi.hoisted(() => ({ api: vi.fn(), blob: vi.fn(), guard: { setDirty: vi.fn() } }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api, apiBlob: mocks.blob }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const path = "/channels/3/items/28/card-copy";
let root: Root, host: HTMLDivElement, client: QueryClient, saved: StoredCardCopyResponse;
let patch: ((body: any) => Promise<StoredCardCopyResponse>) | null, generate: ((body: any) => Promise<any>) | null;
function fresh(): FamilyDialogueResponse { return { version: 3, revisionId: 30, hasSavedCopy: true, copy: familyDialogueCardFixture(), ...familyDialogueMetadataFixture(), ai: { summary: { provider: "gemini", model: "fixture-summary" }, copy: { provider: "openai", model: "fixture-copy" }, image: { provider: "openai", model: "fixture-image" } } }; }
function evidenceFixture(evidenceSetId: string): FamilyEvidenceView {
  return { evidenceSetId,
    facts: [{ id: "F1", statement: "인터뷰에서 AI의 미래를 전망했습니다.", claimType: "forecast", speaker: "인터뷰 발언자", sourceId: "article-1", sourceScope: "article_body", timeScope: null, conditions: ["인터뷰의 전망입니다."], evidenceExcerpt: "특정 전문 업무에서의 미래 가능성을 이야기했습니다.", verificationStatus: "article_only" }],
    resources: [{ id: "R1", sourceId: "paper-1", kind: "paper", title: "직접 확인한 추천 자료", publisher: "검증용 학술 자료", url: "https://source.example/paper", scope: "abstract", checkedAt: "2026-11-04T01:20:00Z", evidenceExcerpt: "이 자료는 초록의 한계까지 확인한 모의 자료입니다.", connectionReason: "속도와 판단 기준을 나누어 생각하도록 돕습니다.", readingTarget: "초록의 연구 질문과 한계를 읽어 보세요.", action: "우리의 기준과 한 가지 차이를 찾아요.", priority: 1, recommendationEligible: true, visitRegion: null, availability: null }],
    sources: [{ id: "article-1", title: "원문 인터뷰", url: "https://source.example/interview", scope: "article_body", fetchedAt: "2026-11-04T00:00:00Z" }, { id: "paper-1", title: "연결 문서", url: "javascript:alert(1)", scope: "abstract", fetchedAt: "2026-11-04T01:20:00Z" }],
  };
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); saved = fresh(); patch = null; generate = null;
  let sequence = 0; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:family-preview-${++sequence}`) }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn(); mocks.blob.mockResolvedValue(new Blob(["local-jpeg"], { type: "image/jpeg" }));
  mocks.api.mockImplementation(async (request: string, options?: { method?: string; body?: any }) => {
    if (request === "/studio/ai-status") return { text: { gemini: true, openai: true, anthropic: false }, image: true };
    if (request === path && options?.method === "PATCH") {
      if (patch) return patch(options.body);
      saved = { ...saved, ...structuredClone(options.body), version: saved.version + 1, revisionId: saved.revisionId + 1, hasSavedCopy: true };
      return structuredClone(saved);
    }
    if (request === path) return structuredClone(saved);
    if (request === `${path}/generate`) {
      if (generate) return generate(options?.body);
      return { ...structuredClone(saved), status: "ready", reviewFlags: [], scope: "field", baseRevision: saved.revisionId, jobId: 87 };
    }
    throw new Error(`Unexpected mock request: ${request}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle(ms = 25) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function render(node: ReactNode = createElement(CardCopyEditor, { channelId: 3, itemId: 28 })) { await act(async () => root.render(createElement(QueryClientProvider, { client }, node))); await settle(); }
function button(label: string) { const node = [...host.querySelectorAll("button")].find(node => node.textContent === label) ?? [...host.querySelectorAll("button")].find(node => node.textContent?.includes(label)); if (!node) throw new Error(`Missing button ${label}`); return node; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.click()); await settle(); }
async function selectPage(label: string) { const node = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); expect(node).not.toBeNull(); await act(async () => node!.click()); await settle(); }
function field(path: string) { const node = host.querySelector<HTMLTextAreaElement>(`textarea[id$="-${path}"]`); if (!node) throw new Error(`Missing field ${path}`); return node; }
async function input(path: string, value: string) { const node = field(path); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(); }
function lockFor(path: string) { return field(path).closest(".family-field")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!; }
async function conceptMode(mode: string) { const node = host.querySelector<HTMLSelectElement>('.card-copy-fields select')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(node, mode); node.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
function acceptValidLocks() {
  patch = async body => {
    expect(Object.values(body.fieldLocks).every(value => value === true)).toBe(true);
    for (const key of Object.keys(body.fieldLocks)) expect(familyFieldValue(body.copy, key), `saved lock must address a current field: ${key}`).not.toBeUndefined();
    saved = { ...saved, ...structuredClone(body), version: saved.version + 1, revisionId: saved.revisionId + 1, hasSavedCopy: true };
    return structuredClone(saved);
  };
}
function requireActualEvidence(bundle = familyEvidenceFixture(28, 3), initial = fresh()) {
  initial.evidence = familyEvidenceView(bundle); saved = initial;
  patch = async body => {
    const current = saved as FamilyDialogueResponse;
    const flags = validateFamilyEvidenceReferences(body.copy, bundle, current.editorialPlan, body.parentGuide ?? current.parentGuide);
    if (flags.length) throw new ApiError(422, flags[0].message, { code: flags[0].code, field: flags[0].path, reviewFlags: flags });
    saved = { ...current, ...structuredClone(body), version: current.version + 1, revisionId: current.revisionId + 1, hasSavedCopy: true };
    return structuredClone(saved);
  };
  return bundle;
}
function evidencePanel(path: string) {
  const panel = host.querySelector<HTMLDetailsElement>(`.family-field-evidence[data-field-path="${path}"]`);
  if (!panel) throw new Error(`Missing evidence control ${path}`);
  return panel;
}
async function connectEvidence(path: string, evidenceId: string) {
  const panel = evidencePanel(path), option = panel.querySelector<HTMLInputElement>(`[data-evidence-id="${evidenceId}"]`)!;
  expect(option).not.toBeNull(); expect(option.disabled).toBe(false);
  await act(async () => option.click()); await settle();
  const confirmed = panel.querySelector<HTMLInputElement>("[data-evidence-confirm]")!;
  expect(confirmed.disabled).toBe(false); await act(async () => confirmed.click()); await settle();
  const connect = [...panel.querySelectorAll("button")].find(node => node.textContent === "대조한 근거를 이 칸에 연결")!;
  expect(connect.disabled).toBe(false); await act(async () => connect.click()); await settle();
}

describe("family dialogue v2 editor", () => {
  it("saves and reopens character revisions, preserves the selected profile across styles, and restores editable ending text",async()=>{
    const choose=async(label:string,value:string)=>{const picker=host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;expect(picker).not.toBeNull();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(picker,value);picker.dispatchEvent(new Event('change',{bubbles:true}));});await settle();};
    await render();await selectPage('8페이지 · 닫는 표지');await input('fields.cta','다음 대화를 위해 저장해 주세요.');
    await choose('마지막 장 프로필',FAMILY_PROFILE_ASSET_ID);
    await choose('카드뉴스 스타일','cardnews14-cinematic-v1');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="마지막 장 프로필"]')!.value).toBe(FAMILY_PROFILE_ASSET_ID);
    const endingOptions=host.querySelector<HTMLSelectElement>('[aria-label="마지막 장 방식"]')!.options;
    expect([...endingOptions].filter(option=>option.textContent?.includes('전체 이미지로 적용'))).toHaveLength(3);
    expect([...endingOptions].filter(option=>option.textContent?.includes('이전 수정안'))).toHaveLength(2);
    await choose('마지막 장 방식',FAMILY_ENDING_ASSET_IDS[2]);await choose('마지막 장 방식',FAMILY_ENDING_ASSET_IDS[0]);
    expect(host.textContent).toContain('이미지 속 문구 고정');expect(host.textContent).toContain('@spacepenguin.co');
    expect(field('fields.cta').value).toBe('다음 대화를 위해 저장해 주세요.');
    await choose('카드뉴스 스타일','cardnews14-ink-lime-v1');await click('문구·디자인 저장');
    expect((saved as FamilyDialogueResponse).pageDesigns.outro.outroPresentation).toEqual({mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]});
    expect(saved.copy.pages[7]).toMatchObject({fields:{logoAssetId:FAMILY_PROFILE_ASSET_ID,cta:'다음 대화를 위해 저장해 주세요.'}});
    const copied=familyCopyText(saved.copy as FamilyDialogueResponse['copy'],saved as FamilyDialogueResponse);expect(copied).toContain('고정 문구: 구독 · 좋아요 · @spacepenguin.co');
    await render(null);client.clear();await render();await selectPage('8페이지 · 닫는 표지');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="마지막 장 방식"]')!.value).toBe(FAMILY_ENDING_ASSET_IDS[0]);
    await choose('마지막 장 방식','template');expect(host.querySelector('[data-testid="family-outro-full-image-notice"]')).toBeNull();
    expect(field('fields.cta').value).toBe('다음 대화를 위해 저장해 주세요.');expect(field('fields.cta').disabled).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="마지막 장 프로필"]')!.value).toBe(FAMILY_PROFILE_ASSET_ID);
    await input('fields.cta','돌아온 뒤 직접 수정');await click('문구·디자인 저장');
    expect((saved as FamilyDialogueResponse).pageDesigns.outro.outroPresentation).toEqual({mode:'template'});expect(saved.copy.pages[7]).toMatchObject({fields:{cta:'돌아온 뒤 직접 수정'}});
  });
  it("saves and reopens the 14-style photo layouts without losing an edited field or an intentionally empty display label",async()=>{
    await render(); await input('fields.headline','내가 고친 제목');await input('displayOverrides.kicker','');
    const choose=async(key:string)=>{const picker=host.querySelector<HTMLSelectElement>('[aria-label="카드뉴스 스타일"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(picker,key);picker.dispatchEvent(new Event('change',{bubbles:true}));});await settle();};
    await choose('cardnews14-cinematic-v1');await selectPage('2페이지 · 뉴스 요약');expect(host.querySelector('.page-background-editor')).not.toBeNull();
    await choose('cardnews14-swiss-modernism-v1');expect(host.querySelector('.page-background-editor')).toBeNull();expect(host.textContent).toContain('사진은 1·3·4·7장');
    await selectPage('3페이지 · 뉴스의 의미');expect(host.querySelector('.page-background-editor')).not.toBeNull();
    await click('문구·디자인 저장');expect(saved.copy.templateKey).toBe('cardnews14-swiss-modernism-v1');
    await render(null);client.clear();await render();expect(field('fields.headline').value).toBe('내가 고친 제목');expect(field('displayOverrides.kicker').value).toBe('');
  });
  it("selects a reading profile, preserves manual text, exposes its photo slots, and reopens the saved style", async () => {
    await render();
    await input("fields.headline", "서로의 판단 기준");
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="카드뉴스 스타일"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(picker, READING_CARD_PROFILES[0].templateKey); picker.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
    expect(field("fields.headline").value).toBe("서로의 판단 기준");
    expect(host.querySelector('.page-background-editor')).not.toBeNull();
    await selectPage("2페이지 · 뉴스 요약");
    expect(host.querySelector('.page-background-editor')).toBeNull();
    expect(host.textContent).toContain("사진은 1·4·7장");
    expect(field("displayOverrides.sourceCredit").value).toContain("테스트용 원문");
    await selectPage("4페이지 · 중심 질문");expect(host.querySelector('.page-background-editor')).not.toBeNull();
    await selectPage("8페이지 · 닫는 표지");expect(host.querySelector('[data-testid="family-reading-outro-design"]')).not.toBeNull();
    await input("fields.brandLine", "오늘 서로의 생각은?");await click("문구·디자인 저장");
    expect(saved.copy.templateKey).toBe(READING_CARD_PROFILES[0].templateKey);
    expect(saved.copy.pages[7]).toMatchObject({fields:{logoAssetId:"brand:space-penguin-company:20261101",brandLine:"오늘 서로의 생각은?"}});
    await render(null);client.clear();await render();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="카드뉴스 스타일"]')!.value).toBe(READING_CARD_PROFILES[0].templateKey);
    expect(field("fields.headline").value).toBe("서로의 판단 기준");
  });

  it("keeps a new image credit in unsaved recovery, preview inputs and copied text", async () => {
    const session = { user: "operator", recoveryScope: "a".repeat(64) };
    expect(activateDraftRecoveryScope(session.recoveryScope).ok).toBe(true);
    client.setQueryData(["me"], session);
    generate = async () => {
      const result = structuredClone(saved) as FamilyDialogueResponse;
      result.pageDesigns.cover.background = { ...result.pageDesigns.cover.background, kind: "image", assetId: 991 };
      result.artworkCredits = { "991": "AI 일러스트 · OpenAI" };
      return { ...result, status: "ready", reviewFlags: [], scope: "all", baseRevision: saved.revisionId, jobId: 88 };
    };
    await render(); await click("8장 전체 다시 제안"); await click("제안을 편집기에 적용");
    expect(field("displayOverrides.imageCredit").value).toBe("AI 일러스트 · OpenAI");
    const current = fresh(); current.pageDesigns.cover.background = { ...current.pageDesigns.cover.background, kind: "image", assetId: 991 };
    current.artworkCredits = { "991": "AI 일러스트 · OpenAI" };
    const text = familyCopyText(current.copy, current);
    expect(text).toContain("출처: 테스트용 원문 메타데이터"); expect(text).toContain("AI 일러스트 · OpenAI");
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
    await render(null); client.clear(); client.setQueryData(["me"], session); await render();
    const recovery = host.querySelector(".draft-recovery")!;
    expect(recovery.textContent).toContain("기기 복구본");
    expect(recovery.textContent).toContain("AI 일러스트 · OpenAI");
    await click("복구본을 편집기에 불러오기");
    expect(field("displayOverrides.imageCredit").value).toBe("AI 일러스트 · OpenAI");
    expect(field("displayOverrides.sourceCredit").value).toBe("출처: 테스트용 원문 메타데이터");
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

  it("edits every closing brand field and display label, saves them, and reopens without changing channel defaults", async () => {
    await render();
    await selectPage("8페이지 · 닫는 표지");
    for (const key of ["brandName", "parentBrand", "brandLine", "handle"]) expect(field("fields." + key).readOnly).toBe(false);
    await input("fields.brandName", "이번 콘텐츠 브랜드");
    await input("fields.parentBrand", "우주펭귄상회");
    await input("fields.brandLine", "오늘 나눈 생각을 기억해요.");
    await input("fields.handle", "@my_current_content");
    await selectPage("2페이지 · 뉴스 요약");
    expect(field("displayOverrides.kicker").value).toBe("뉴스 읽기");
    await input("displayOverrides.kicker", "우리의 뉴스 읽기");
    await input("displayOverrides.sourceCredit", "출처: 직접 확인한 기사");
    await input("displayOverrides.pageNumber", "2");
    await click("문구·디자인 저장");
    expect(saved.copy.pages[7]).toMatchObject({ fields: { brandName: "이번 콘텐츠 브랜드", brandLine: "오늘 나눈 생각을 기억해요.", handle: "@my_current_content" } });
    expect(saved.copy.pages[1]).toMatchObject({ displayOverrides: { kicker: "우리의 뉴스 읽기", sourceCredit: "출처: 직접 확인한 기사", pageNumber: "2" } });
    await render(null); client.clear(); await render(); await selectPage("2페이지 · 뉴스 요약");
    expect(field("displayOverrides.sourceCredit").value).toBe("출처: 직접 확인한 기사");
    await input("displayOverrides.kicker", "");
    await click("문구·디자인 저장");
    expect(saved.copy.pages[1]).toMatchObject({ displayOverrides: { kicker: "" } });
    expect(mocks.api.mock.calls.some(([request, options]) => request === "/channels/3" && options?.method === "PATCH")).toBe(false);
  });

  it("saves semantic fields, layouts and locks without flattening two views, then reopens the same values", async () => {
    await render(); expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(8);
    await selectPage("5페이지 · 두 가지 시선");
    await input("fields.viewA.body", "내가 직접 보탠 판단 기준을 그대로 보존합니다.");
    const lock = [...host.querySelectorAll<HTMLInputElement>('.family-field input[type="checkbox"]')][2];
    await act(async () => lock.click());
    await click("문구·디자인 저장");
    expect(saved.copy.version).toBe(2);
    if (saved.copy.version !== 2) throw new Error("v2 expected");
    expect(saved.copy.pages[4].fields).toMatchObject({ viewA: { body: "내가 직접 보탠 판단 기준을 그대로 보존합니다." } });
    expect(saved.copy.pages[4].layout).toBe("stacked");
    expect(saved.copy.pages[4].claimRefs.map(ref => ref.fieldPath)).toEqual(["fields.viewB.body"]);
    expect(saved.fieldLocks?.["pages.perspectives.fields.viewA.body"]).toBe(true);
    const written = mocks.api.mock.calls.find(([, options]) => options?.method === "PATCH")?.[1].body;
    expect(written).not.toHaveProperty("editorialPlan"); expect(written).not.toHaveProperty("evidenceBinding");
    await render(null); client.clear(); await render(); await selectPage("5페이지 · 두 가지 시선");
    expect(field("fields.viewA.body").value).toBe("내가 직접 보탠 판단 기준을 그대로 보존합니다.");
  });

  it("keeps text entered during an AI request and treats its late answer as a non-applicable proposal", async () => {
    let finish!: (value: any) => void;
    generate = () => new Promise(resolve => { finish = resolve; });
    await render(); await selectPage("5페이지 · 두 가지 시선");
    const fieldButtons = [...host.querySelectorAll<HTMLButtonElement>(".family-field-actions button")];
    await act(async () => fieldButtons[2].click()); await click("선택한 칸 자동 제안");
    expect(mocks.api.mock.calls.find(([request]) => request.endsWith("/generate"))?.[1].body).toMatchObject({ formatId: "family_dialogue_8", scope: "field", baseRevision: 30, pageId: "perspectives", allowedFieldPaths: ["pages.perspectives.fields.viewA.body"] });
    await input("fields.viewA.body", "기다리는 동안 내가 고친 문장");
    const proposed = fresh(); if (proposed.copy.pages[4].id === "perspectives") proposed.copy.pages[4].fields.viewA.body = "늦게 도착한 AI 문장";
    await act(async () => finish({ ...proposed, status: "ready", reviewFlags: [], scope: "field", baseRevision: 30, jobId: 88 })); await settle();
    expect(field("fields.viewA.body").value).toBe("기다리는 동안 내가 고친 문장");
    expect(button("제안을 편집기에 적용").disabled).toBe(true);
    await click("문구·디자인 저장");
    expect(saved.copy.pages[4]).toMatchObject({ fields: { viewA: { body: "기다리는 동안 내가 고친 문장" } } });
  });

  it("keeps typing after a save starts and does not lose long pasted text or change to manual mode on failure", async () => {
    let finish!: (value: StoredCardCopyResponse) => void, snapshot: any;
    patch = body => { snapshot = structuredClone(body); return new Promise(resolve => { finish = resolve; }); };
    await render(); await input("fields.headline", "먼저 저장한 제목");
    await act(async () => button("문구·디자인 저장").click()); await settle();
    await input("fields.headline", "저장 요청 후에도 계속 입력한 제목");
    const response = { ...saved, copy: snapshot.copy, version: 4, revisionId: 31 };
    await act(async () => { saved = response; finish(response); }); await settle();
    expect(field("fields.headline").value).toBe("저장 요청 후에도 계속 입력한 제목");
    expect(host.textContent).toContain("미저장 변경");
    patch = null; await input("fields.headline", "가".repeat(1001));
    expect(field("fields.headline").value).toHaveLength(1001); expect(button("문구·디자인 저장").disabled).toBe(true);
    await input("fields.headline", "AI가 실패해도 남을 제목"); await click("문구·디자인 저장");
    generate = async () => { throw new ApiError(503, "AI가 일시적으로 응답하지 않았습니다.", { jobStatus: "failed" }); };
    await click("이 페이지 자동 제안");
    expect(field("fields.headline").value).toBe("AI가 실패해도 남을 제목"); expect(host.textContent).toContain("자동으로 문구 다듬기");
    await input("fields.headline", "실패 후 직접 고친 제목"); await click("문구·디자인 저장");
    expect(saved.copy.pages[0]).toMatchObject({ fields: { headline: "실패 후 직접 고친 제목" } });
  });

  it("recovers an old request by its original ID without treating its old answer as the newest saved draft", async () => {
    const old = fresh(), latest = fresh(); latest.version = 4; latest.revisionId = 31;
    if (latest.copy.pages[0].id === "cover") latest.copy.pages[0].fields.headline = "그 뒤에 저장한 새 제목";
    saved = latest;
    const requestId = "10000000-0000-4000-8000-000000000028";
    sessionStorage.setItem("spacepenguin.generation:3:28:card-copy", JSON.stringify({ path: `${path}/generate`, body: { version: 3, baseRevision: 30, formatId: "family_dialogue_8", scope: "page", pageId: "cover" }, requestId, status: "uncertain" }));
    generate = async body => { expect(body.version).toBe(3); expect(body.requestId).toBe(requestId); return { ...old, status: "ready", reviewFlags: [], scope: "page", baseRevision: 30, lateResult: false, jobId: 89 }; };
    await render(); await click("이전 요청 결과 확인");
    expect(field("fields.headline").value).toBe("그 뒤에 저장한 새 제목"); expect(button("제안을 편집기에 적용").disabled).toBe(true);
    expect(mocks.api.mock.calls.filter(([request]) => request.endsWith("/generate"))).toHaveLength(1);
  });

  it("does not unmount an unsaved v2 draft when another editor saves a legacy format", async () => {
    await render(); await input("fields.headline", "형식 충돌에도 잃지 않을 제목");
    const remote = { version: 4, revisionId: 31, hasSavedCopy: true, copy: cardCopyFixture() };
    await act(async () => client.setQueryData(["card-copy", 3, 28], remote)); await settle();
    expect(field("fields.headline").value).toBe("형식 충돌에도 잃지 않을 제목");
    expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(8);
    expect(host.textContent).toContain("다른 곳에서 카드 형식을 바꿔 저장했습니다.");
    expect(button("문구·디자인 저장").disabled).toBe(true);
  });

  it("shows both concept modes and the parent guide, and refuses to apply a caption for an edited revision", async () => {
    const applyCaption = vi.fn(); await render(createElement(CardCopyEditor, { channelId: 3, itemId: 28, onApplyCaption: applyCaption }));
    expect(host.textContent).toContain("함께 읽기 · 2분"); expect(host.textContent).toContain("중심 질문 · 4분");
    await click("게시 준비의 캡션 칸에 적용"); expect(applyCaption).toHaveBeenCalledTimes(1);
    await selectPage("6페이지 · 개념 다듬기");
    const old = field("fields.definitionA").value;
    const select = host.querySelector<HTMLSelectElement>('.card-copy-fields select')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "scientific_explanation"); select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
    expect(field("fields.acceptedDefinition").value).toBe(""); expect(field("fields.fillIn").value).toContain("내 말로 설명하면");
    expect(host.querySelector('textarea[id$="-fields.definitionA"]')).toBeNull(); expect(button("게시 준비의 캡션 칸에 적용").disabled).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "value_definition"); select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
    expect(field("fields.definitionA").value).toBe(old);
    await selectPage("7페이지 · 작은 활동"); expect(host.textContent).toContain("선택 활동 영역은 이미지에서도 완전히 빠집니다.");
  });

  it("can save a changed concept mode without obsolete locks and restores the prior mode's text and locks on return", async () => {
    const initial = fresh(); initial.fieldLocks = { "pages.concept.fields.definitionA": true, "pages.concept.fields.definitionB": false, "pages.perspectives.fields.viewB.body": true }; saved = initial; acceptValidLocks();
    await render(); await selectPage("6페이지 · 개념 다듬기");
    const original = field("fields.definitionA").value;
    expect(lockFor("fields.definitionA").checked).toBe(true);
    await conceptMode("scientific_explanation");
    expect(host.textContent).toContain("사라진 칸의 잠금 1개를 현재 원고에서 해제했습니다");
    await input("fields.acceptedDefinition", "평균 속력은 이동한 총거리를 걸린 총시간으로 나눈 값입니다.");
    await input("fields.exampleOrNonExample", "10미터를 5초 동안 이동했다면 평균 속력은 초속 2미터예요.");
    await act(async () => lockFor("fields.acceptedDefinition").click());
    await click("문구·디자인 저장");
    expect(saved.fieldLocks).toEqual({ "pages.concept.fields.acceptedDefinition": true, "pages.perspectives.fields.viewB.body": true });
    await conceptMode("value_definition");
    expect(field("fields.definitionA").value).toBe(original); expect(lockFor("fields.definitionA").checked).toBe(true);
    expect(host.textContent).toContain("이전 방식의 문구와 잠금 1개를 복구했습니다");
    await click("문구·디자인 저장");
    expect(saved.fieldLocks).toEqual({ "pages.concept.fields.definitionA": true, "pages.perspectives.fields.viewB.body": true });
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/generate"))).toBe(false);
  });

  it("removes only the deleted fact's lock so the remaining manual facts can still be saved and reopened", async () => {
    const initial = fresh(), summary = initial.copy.pages[1]; if (summary.id !== "news_summary") throw new Error("summary fixture required");
    summary.fields.facts.push("운영자가 직접 더한 세 번째 사실입니다.");
    initial.fieldLocks = { "pages.news_summary.fields.facts.0": true, "pages.news_summary.fields.facts.2": true };
    saved = initial; acceptValidLocks();
    await render(); await selectPage("2페이지 · 뉴스 요약");
    await click("마지막 사실 칸 빼기");
    expect(host.textContent).toContain("사실 칸을 빼면서 사라진 칸의 잠금 1개를 해제했습니다");
    expect(host.querySelector('textarea[id$="-fields.facts.2"]')).toBeNull(); expect(lockFor("fields.facts.0").checked).toBe(true);
    await click("문구·디자인 저장"); expect(saved.fieldLocks).toEqual({ "pages.news_summary.fields.facts.0": true });
    await render(null); client.clear(); await render(); await selectPage("2페이지 · 뉴스 요약");
    expect(host.querySelectorAll(".family-facts textarea")).toHaveLength(2); expect(lockFor("fields.facts.0").checked).toBe(true);
  });

  it("removes optional activity locks on explicit deletion while keeping home activity text and locks", async () => {
    const initial = fresh(), activity = initial.copy.pages[6]; if (activity.id !== "activity") throw new Error("activity fixture required");
    activity.fields.optionalActivity = { label: "추가 읽기", action: "제공한 원문의 근거를 함께 표시해 보세요.", resourceId: "R1" };
    initial.fieldLocks = { "pages.activity.fields.optionalActivity.action": true, "pages.activity.fields.homeActivity.action": true };
    saved = initial; acceptValidLocks();
    await render(); await selectPage("7페이지 · 작은 활동"); const home = field("fields.homeActivity.action").value;
    await click("추가 활동 빼기"); expect(host.textContent).toContain("추가 활동을 빼면서 사라진 칸의 잠금 1개를 해제했습니다");
    expect(host.querySelector('textarea[id$="-fields.optionalActivity.action"]')).toBeNull(); expect(field("fields.homeActivity.action").value).toBe(home);
    await click("문구·디자인 저장"); expect(saved.fieldLocks).toEqual({ "pages.activity.fields.homeActivity.action": true });
    expect(saved.copy.pages[6]).toMatchObject({ fields: { optionalActivity: null, homeActivity: { action: home } } });
  });

  it("preserves a v1 deck until the operator explicitly saves the full v2 proposal as a new revision", async () => {
    saved = { version: 3, revisionId: 30, hasSavedCopy: true, recommendedStoryFormat: "discussion8", copy: cardCopyFixture() };
    const original = structuredClone(saved.copy), proposal = fresh();
    generate = async body => ({ ...proposal, copy: { ...proposal.copy, templateKey: body.templateKey }, status: "ready", reviewFlags: [], scope: "all", jobId: 91, baseRevision: 30 });
    patch = async body => { expect(body.proposalJobId).toBe(91); saved = { ...proposal, ...body, version: 4, revisionId: 31, hasSavedCopy: true }; return structuredClone(saved); };
    await render(); await click("새 8장 형식 자동 제안");
    expect(saved.copy).toEqual(original); expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(0);
    await click("새 8장 원고로 저장·전환");
    expect(saved.copy.version).toBe(2); expect(host.querySelectorAll(".family-page-strip>button")).toHaveLength(8); expect(host.textContent).toContain("문구 배치 미리보기");
  });

  it("shows the selected activity's canonical resource and inspected scope as readonly evidence without sending it in edits", async () => {
    const initial = fresh(), activity = initial.copy.pages[6]; if (activity.id !== "activity") throw new Error("activity required");
    activity.fields.optionalActivity = { label: "추가 읽기", action: "초록의 연구 질문을 찾아보세요.", resourceId: "R1" };
    initial.evidence = evidenceFixture(initial.evidenceBinding.evidenceSetId); saved = initial;
    await render();
    const panel = host.querySelector<HTMLDetailsElement>(".family-evidence")!;
    expect(panel.open).toBe(false);
    const resource = panel.querySelector('[data-testid="family-selected-resource"]')!;
    expect(resource.querySelector('a[href="https://source.example/paper"]')?.textContent).toContain("직접 확인한 추천 자료");
    expect(resource.textContent).toContain("읽은 범위: 논문 초록"); expect(resource.textContent).toContain("2026-11-04 10:20 (한국 시간)");
    expect(resource.textContent).toContain("초록의 연구 질문과 한계를 읽어 보세요");
    expect(panel.textContent).toContain("전망·예측"); expect(panel.textContent).toContain("발언자: 인터뷰 발언자");
    expect(panel.querySelector('a[href^="javascript:"]')).toBeNull(); expect(panel.textContent).toContain("연결 문서");
    await input("fields.headline", "운영자가 직접 수정한 제목"); await click("문구·디자인 저장");
    const request = mocks.api.mock.calls.find(([, options]) => options?.method === "PATCH")?.[1].body;
    expect(request).not.toHaveProperty("evidence"); expect(request).not.toHaveProperty("evidenceBinding");
  });

  it("does not present stale evidence as belonging to a different saved binding", async () => {
    const initial = fresh(); initial.evidence = evidenceFixture("different-evidence-set"); saved = initial;
    await render();
    expect(host.querySelector('[data-testid="family-evidence-stale"]')?.textContent).toContain("문구를 저장한 뒤 다시 열어 주세요");
    expect(host.querySelector('[data-testid="family-evidence-details"]')).toBeNull();
    expect(host.querySelector('.family-evidence a[href="https://source.example/interview"]')).toBeNull();
  });

  it("uses a fixed brand notice on the outro, leaves its wording editable, and explains the scope of other page controls", async () => {
    await render();
    expect(host.querySelector('[data-testid="family-canva-design-scope"]')?.textContent).toContain("Canva는 등록된 템플릿의 정렬·글자색을 사용합니다");
    expect(host.querySelector(".family-design")).not.toBeNull(); expect(host.querySelector(".page-background-editor")).not.toBeNull();
    const before = structuredClone((saved as FamilyDialogueResponse).pageDesigns.outro);
    await selectPage("8페이지 · 닫는 표지");
    expect(host.querySelector('[data-testid="family-outro-fixed-design"]')?.textContent).toContain("고정 배경·중앙 정렬·기존 로고");
    expect(host.querySelector(".family-design")).toBeNull(); expect(host.querySelector(".page-background-editor")).toBeNull();
    expect(host.querySelector('input[aria-label="페이지 배경 이미지 파일"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some(node => node.textContent === "승인된 닫는 표지 배치 사용")).toBe(false);
    expect(field("fields.cta").readOnly).toBe(false);
    await input("fields.cta", "다음 대화를 위해 저장해 주세요."); await click("문구·디자인 저장");
    expect(saved.copy.pages[7]).toMatchObject({ fields: { cta: "다음 대화를 위해 저장해 주세요." } });
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(before);
    await selectPage("7페이지 · 작은 활동");
    expect(host.querySelector(".family-design")).not.toBeNull(); expect(host.querySelector(".page-background-editor")).not.toBeNull();
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/background") || request.endsWith("/generate"))).toBe(false);
  });

  it("preserves an existing outro design until an explicit draft reset, retaining the old asset history and undo", async () => {
    const initial = fresh();
    initial.pageDesigns.outro = { ...initial.pageDesigns.outro, alignment: "left", previousAssetIds: [70, 71], background: { kind: "image", assetId: 81, color: "#FAFAFA", fit: "contain", focalX: 23, focalY: 68, brightness: 73, overlay: 62 } };
    saved = initial;
    const originalDesign = structuredClone(initial.pageDesigns.outro), originalCopy = structuredClone(initial.copy);
    await render(); await selectPage("8페이지 · 닫는 표지");
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(originalDesign);
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
    await input("fields.cta", "직접 쓴 마지막 안내를 보존합니다."); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(originalDesign);
    expect(saved.copy.pages[7]).toMatchObject({ fields: { cta: "직접 쓴 마지막 안내를 보존합니다." } });
    const writesBeforeReset = mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH").length;
    await click("승인된 닫는 표지 배치 사용");
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(originalDesign);
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(writesBeforeReset);
    expect(host.textContent).toContain("이전 배경 이미지는 기록에 보관했고 문구는 유지했습니다");
    await click("이전 닫는 표지 배치 되돌리기"); expect(button("승인된 닫는 표지 배치 사용").disabled).toBe(false);
    expect(field("fields.cta").value).toBe("직접 쓴 마지막 안내를 보존합니다.");
    await click("승인된 닫는 표지 배치 사용"); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual({ ...defaultPageDesigns().outro, previousAssetIds: [70, 71, 81] });
    expect(saved.copy.pages.slice(0, 7)).toEqual(originalCopy.pages.slice(0, 7));
    expect(saved.copy.pages[7]).toMatchObject({ fields: { cta: "직접 쓴 마지막 안내를 보존합니다." } });
    await render(null); client.clear(); await render(); await selectPage("8페이지 · 닫는 표지");
    expect(host.querySelector(".page-background-editor")).toBeNull();
    expect([...host.querySelectorAll("button")].some(node => node.textContent === "승인된 닫는 표지 배치 사용")).toBe(false);
    expect((saved as FamilyDialogueResponse).pageDesigns.outro.previousAssetIds).toContain(81);
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/background") || request.endsWith("/generate"))).toBe(false);
  });

  it("recovers an old outro image as a proposal without silently changing the approved close", async () => {
    const requestId = "10000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("spacepenguin.generation:3:28:page-background", JSON.stringify({ requestId, pageId: "outro", version: 3, priorAssetId: null, mode: "ai" }));
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (request, options) => request === `${path}/background-requests/${requestId}`
      ? { status: "succeeded", response: { assetId: 82, version: 3, pageId: "outro", source: "ai", credit: "기존 요청에서 만든 그림", jobId: 99 } }
      : fallback(request, options));
    await render(); await click("기존 배경 작업 결과 확인");
    expect(host.textContent).toContain("확인 후 사용할 수 있는 배경");
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(defaultPageDesigns().outro);
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
    await click("현재 표지에 이 배경 사용"); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).pageDesigns.cover.background).toMatchObject({ kind: "image", assetId: 82 });
    expect((saved as FamilyDialogueResponse).pageDesigns.outro).toEqual(defaultPageDesigns().outro);
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/background") || request.endsWith("/generate"))).toBe(false);
  });

  it.each([false, true])("manually edits one summary fact, explicitly reconnects its actual evidence, and saves/reopens without losing sibling refs (legacy aggregate: %s)", aggregate => {
    return (async () => {
      const initial = fresh(), summary = initial.copy.pages[1]; if (summary.id !== "news_summary") throw new Error("summary required");
      if (aggregate) {
        summary.fields.facts[1] = "게이츠는 전문 업무에서 AI의 성과를 전망했어요.";
        summary.claimRefs = [{ fieldPath: "fields.facts", claimType: "forecast", factIds: ["F1"], resourceIds: [] }];
      }
      requireActualEvidence(undefined, initial);
      await render(); await selectPage("2페이지 · 뉴스 요약");
      const text = "게이츠는 AI가 전문 업무에서 앞설 가능성을 전망했어요.";
      await input("fields.facts.0", text);
      expect(evidencePanel("pages.news_summary.fields.facts.0").querySelector("summary")?.textContent).toContain("재연결 필요");
      expect(evidencePanel("pages.news_summary.fields.facts.1").querySelector("summary")?.textContent).toContain("연결됨");
      await click("문구·디자인 저장");
      expect(host.textContent).toContain("뉴스 요약의 각 사실에 근거를 연결"); expect(field("fields.facts.0").value).toBe(text);
      const failedBody = mocks.api.mock.calls.filter(([, options]) => options?.method === "PATCH").at(-1)![1].body;
      expect(failedBody.copy.pages[1].claimRefs).toEqual([{ fieldPath: "fields.facts.1", claimType: aggregate ? "forecast" : "attributed_statement", factIds: [aggregate ? "F1" : "F2"], resourceIds: [] }]);
      const panel = evidencePanel("pages.news_summary.fields.facts.0");
      expect(panel.textContent).toContain("발언자: 빌 게이츠"); expect(panel.textContent).toContain("전문 업무의 성과");
      await connectEvidence("pages.news_summary.fields.facts.0", "fact:F1"); await click("문구·디자인 저장");
      expect((saved as FamilyDialogueResponse).copy.pages[1].claimRefs).toContainEqual({ fieldPath: "fields.facts.0", claimType: "forecast", factIds: ["F1"], resourceIds: [] });
      expect(saved.copy.pages[1]).toMatchObject({ fields: { facts: [text, summary.fields.facts[1]] } });
      await render(null); client.clear(); await render(); await selectPage("2페이지 · 뉴스 요약");
      expect(field("fields.facts.0").value).toBe(text);
      expect(evidencePanel("pages.news_summary.fields.facts.0").querySelector("summary")?.textContent).toContain("연결됨");
      expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/generate"))).toBe(false);
    })();
  });

  it("requires fresh evidence for a new fact and removes only the deleted row's binding", async () => {
    requireActualEvidence(); await render(); await selectPage("2페이지 · 뉴스 요약");
    await click("사실 한 칸 추가"); await input("fields.facts.2", "게이츠는 전문 업무의 미래를 전망했어요.");
    expect(evidencePanel("pages.news_summary.fields.facts.2").querySelector("summary")?.textContent).toContain("재연결 필요");
    await connectEvidence("pages.news_summary.fields.facts.2", "fact:F1"); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).copy.pages[1].claimRefs).toHaveLength(3);
    await click("마지막 사실 칸 빼기"); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).copy.pages[1].claimRefs).toEqual(fresh().copy.pages[1].claimRefs);
    await click("사실 한 칸 추가");
    expect(evidencePanel("pages.news_summary.fields.facts.2").querySelector("summary")?.textContent).toContain("재연결 필요");
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/generate"))).toBe(false);
  });

  it("switches to a scientific definition and saves it against an inspected resource without any AI call", async () => {
    const bundle = familyEvidenceFixture(28, 3), resource = evidenceFixture(bundle.evidenceSet.evidenceSetId).resources[0];
    Object.assign(resource, { kind: "definition", sourceId: "definition-1", title: "평균 속력의 통용 정의 · 모의 자료", url: "https://source.example/speed-definition", scope: "provided_document", evidenceExcerpt: "평균 속력은 이동한 총거리를 걸린 총시간으로 나눈 값이다.", readingTarget: "평균 속력의 정의 문장과 단위를 읽으세요." });
    bundle.evidenceSet.resources = [resource, { ...resource, id: "R2", kind: "visit" }, { ...resource, id: "R3", kind: "paper", scope: "search_result" }];
    bundle.researchedSources = [{ ...bundle.snapshot.sources[0], id: "definition-1", documentId: null, role: "provided", title: resource.title, scope: "provided_document", requestedUrl: resource.url, finalUrl: resource.url, text: resource.evidenceExcerpt }];
    requireActualEvidence(bundle);
    await render(createElement(CardCopyEditor, { channelId: 3, itemId: 28, showAi: false })); await selectPage("6페이지 · 개념 다듬기");
    await conceptMode("scientific_explanation"); await input("fields.title", "평균 속력 알아보기"); await input("fields.concept", "평균 속력");
    await input("fields.acceptedDefinition", resource.evidenceExcerpt); await input("fields.exampleOrNonExample", "10미터를 5초 동안 이동했다면 초속 2미터예요.");
    await click("문구·디자인 저장"); expect(host.textContent).toContain("과학적 통용 정의의 실제 근거");
    const panel = evidencePanel("pages.concept.fields.acceptedDefinition");
    expect(panel.querySelector('[data-evidence-id="fact:F1"]')).toBeNull(); expect(panel.querySelector('[data-evidence-id="fact:F2"]')).toBeNull();
    expect(panel.querySelector('[data-evidence-id="resource:R2"]')).toBeNull(); expect(panel.querySelector('[data-evidence-id="resource:R3"]')).toBeNull();
    expect(panel.textContent).toContain(resource.evidenceExcerpt); expect(panel.querySelector('a[href="https://source.example/speed-definition"]')).not.toBeNull();
    await connectEvidence("pages.concept.fields.acceptedDefinition", "resource:R1"); await click("문구·디자인 저장");
    expect((saved as FamilyDialogueResponse).copy.pages[5].claimRefs).toContainEqual({ fieldPath: "fields.acceptedDefinition", claimType: "research_finding", factIds: [], resourceIds: ["R1"] });
    await render(null); client.clear(); await render(); await selectPage("6페이지 · 개념 다듬기");
    expect(field("fields.acceptedDefinition").value).toBe(resource.evidenceExcerpt);
    expect(evidencePanel("pages.concept.fields.acceptedDefinition").querySelector("summary")?.textContent).toContain("연결됨");
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/generate"))).toBe(false);
  });

  it("offers only the matching evidence view and reloads it without losing the operator's unsaved wording", async () => {
    const bundle = familyEvidenceFixture(28, 3); requireActualEvidence(bundle);
    (saved as FamilyDialogueResponse).evidence = { ...familyEvidenceView(bundle), evidenceSetId: "old-evidence" };
    await render(); await selectPage("2페이지 · 뉴스 요약"); await input("fields.facts.0", "게이츠는 AI의 전문 업무 성과를 전망했어요.");
    const panel = evidencePanel("pages.news_summary.fields.facts.0"); expect(panel.querySelector("[data-evidence-id]")).toBeNull();
    const reload = [...panel.querySelectorAll("button")].find(node => node.textContent === "현재 원문 근거 다시 불러오기")!;
    (saved as FamilyDialogueResponse).evidence = familyEvidenceView(bundle);
    await act(async () => reload.click()); await settle();
    expect(field("fields.facts.0").value).toBe("게이츠는 AI의 전문 업무 성과를 전망했어요.");
    expect(panel.querySelector('[data-evidence-id="fact:F1"]')).not.toBeNull();
    await connectEvidence("pages.news_summary.fields.facts.0", "fact:F1"); await click("문구·디자인 저장");
    expect(saved.copy.pages[1]).toMatchObject({ fields: { facts: ["게이츠는 AI의 전문 업무 성과를 전망했어요.", "기사는 인터뷰 발언을 전하며 미래를 이야기해요."] } });
    expect(mocks.api.mock.calls.some(([request]) => request.endsWith("/generate"))).toBe(false);
  });
});
