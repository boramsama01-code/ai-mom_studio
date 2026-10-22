import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { login, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const mockText = vi.fn();
const mockImage = vi.fn();
vi.mock("../server/services/studioAi", () => ({
  studioAiStatus: () => ({ defaultProvider: "openai", text: { openai: true, anthropic: true }, image: true }),
  generateStudioText: (...a: unknown[]) => mockText(...a), generateStudioImage: (...a: unknown[]) => mockImage(...a),
}));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { claimJob, recoverExpired } = await import("../server/worker/queue");
const { processStudioJob } = await import("../server/worker/studio");
const { saveStudioCard } = await import("../server/services/studio");
const { appSettings, studioCards, studioImages, jobs, studioRevisions } = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(async () => { await closeDb(); });
beforeEach(() => { mockText.mockReset(); mockImage.mockReset(); });
const generated = () => ({ title: "생성 제목", script: "생성 원고", caption: "생성 캡션", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `장면 ${i + 1}`, dialogue: `대사 ${i + 1}` })), provider: "openai", model: "mock-model" });

async function setup() {
  const auth = await login(app);
  const headers = { "x-csrf-token": auth.csrf };
  const created = await auth.agent.post("/api/studio/cards").set(headers).send({ title: "작업 중인 만화" });
  expect(created.status).toBe(201);
  return { ...auth, headers, card: created.body };
}
describe("통합 제작 보드", () => {
  it("로그인·CSRF 없이 제작 데이터 조회·변경 불가", async () => {
    expect((await request(app).get("/api/studio/cards")).status).toBe(401);
    const { agent } = await login(app);
    expect((await agent.post("/api/studio/cards").send({ title: "차단" })).status).toBe(403);
  });
  it("낙관적 잠금과 기록 복원으로 원고를 보존", async () => {
    const { agent, headers, card } = await setup();
    const update = await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 1, script: "직접 쓴 원고" });
    expect(update.status).toBe(200);
    expect(update.body.version).toBe(2);
    const stale = await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 1, script: "덮어쓰기" });
    expect(stale.status).toBe(409);
    const detail = await agent.get(`/api/studio/cards/${card.id}`);
    expect(detail.body.revisions).toHaveLength(2);
    const restored = await agent.post(`/api/studio/cards/${card.id}/restore`).set(headers).send({ version: 2, revisionId: detail.body.revisions[1].id });
    expect(restored.body.version).toBe(3);
    expect(restored.body.script).toBe("");
    expect((await agent.get(`/api/studio/cards/${card.id}`)).body.revisions).toHaveLength(3);
  });
  it("단계만 변경해도 기존 채널·원고·대사·캡션이 유지됨", async () => {
    const { agent, headers, card } = await setup();
    const edited = await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 1, channel: "highway", memo: "입시 자료", script: "원고", caption: "캡션", panels: card.panels.map((p: object) => ({ ...p, scene: "장면", dialogue: "대사" })) });
    const stageOnly = await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 2, stage: "review" });
    expect(stageOnly.body).toMatchObject({ channel: "highway", memo: "입시 자료", script: "원고", caption: "캡션", panels: edited.body.panels, stage: "review" });
  });
  it("전역 정지는 새 요청과 이미 대기 중인 유료 작업을 차단", async () => {
    const { agent, headers, card } = await setup();
    const body = { version: 1, kind: "text", instruction: "개선", requestId: crypto.randomUUID() };
    const queued = await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send(body);
    expect(queued.status).toBe(202);
    await getDb().update(appSettings).set({ value: true }).where(eq(appSettings.key, "global_stop"));
    try {
      const blocked = await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send({ ...body, requestId: crypto.randomUUID() });
      expect(blocked.status).toBe(409);
      const job = await claimJob(getDb(), "stopped-studio", ["studio_generate"]);
      expect(await processStudioJob(getDb(), job!, "stopped-studio")).toBe(false);
      expect(mockText).not.toHaveBeenCalled();
    } finally { await getDb().update(appSettings).set({ value: false }).where(eq(appSettings.key, "global_stop")); }
  });
  it("같은 생성 요청은 완료 뒤에도 재과금하지 않으며 실제 작업 핸들러가 호출됨", async () => {
    const { agent, headers, card } = await setup();
    const body = { version: 1, kind: "text", provider: "openai", instruction: "네 컷으로 써줘", requestId: crypto.randomUUID() };
    mockText.mockResolvedValue(generated());
    const queued = await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send(body);
    expect(queued.status).toBe(202);
    const job = await claimJob(getDb(), "test-studio", ["studio_generate"]);
    expect(job?.id).toBe(queued.body.job.id);
    expect(await processStudioJob(getDb(), job!, "test-studio")).toBe(true);
    expect(mockText).toHaveBeenCalledOnce();
    const replay = await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send(body);
    expect(replay.status).toBe(202);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.job.id).toBe(job!.id);
    const detail = await agent.get(`/api/studio/cards/${card.id}`);
    expect(detail.body.card.script).toBe("생성 원고");
    expect(detail.body.card.stage).toBe("review");
    expect(detail.body.revisions[0].provider).toBe("openai");
  });
  it("생성 도중 직접 수정한 내용은 지키고 생성 결과는 적용 가능한 기록으로 남김", async () => {
    const { agent, headers, card } = await setup();
    mockText.mockImplementation(async () => {
      await saveStudioCard(getDb(), card.id, 1, { script: "사용자의 최신 수정" }, "admin");
      return generated();
    });
    await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send({ version: 1, kind: "text", instruction: "개선해줘", requestId: crypto.randomUUID() });
    const job = await claimJob(getDb(), "test-studio-race", ["studio_generate"]);
    expect(await processStudioJob(getDb(), job!, "test-studio-race")).toBe(true);
    const detail = await agent.get(`/api/studio/cards/${card.id}`);
    expect(detail.body.card.script).toBe("사용자의 최신 수정");
    expect(detail.body.revisions[0].applied).toBe(false);
    expect(detail.body.revisions[0].snapshot.script).toBe("생성 원고");
  });
  it("유료 호출 실패·lease 만료는 자동 재시도하지 않음", async () => {
    const { agent, headers, card } = await setup();
    mockText.mockRejectedValue(new Error("API 응답 시간 초과"));
    await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send({ version: 1, kind: "text", instruction: "개선해줘", requestId: crypto.randomUUID() });
    const job = await claimJob(getDb(), "test-studio-error", ["studio_generate"]);
    expect(job!.maxAttempts).toBe(1);
    expect(await processStudioJob(getDb(), job!, "test-studio-error")).toBe(false);
    const result = await agent.get(`/api/studio/jobs/${job!.id}`);
    expect(result.body.status).toBe("failed");
    expect(mockText).toHaveBeenCalledOnce();
    await getDb().update(jobs).set({ status: "running", leaseExpiresAt: new Date(0) }).where(eq(jobs.id, job!.id));
    await recoverExpired(getDb());
    expect((await agent.get(`/api/studio/jobs/${job!.id}`)).body.status).toBe("failed");
  });
  it("이미지는 선택 컷만 변경하고 이전 이미지와 다른 세 컷을 유지", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    const { agent, headers, card } = await setup();
    // Empty reference selection keeps this test independent of binary checkout assets.
    await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 1, characters: [] });
    mockImage.mockResolvedValue({ bytes: png, mimeType: "image/png", model: "mock-image" });
    await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send({ version: 2, kind: "image", panelIndex: 1, instruction: "부리만 수정", requestId: crypto.randomUUID() });
    const job = await claimJob(getDb(), "test-studio-image", ["studio_generate"]);
    expect(await processStudioJob(getDb(), job!, "test-studio-image")).toBe(true);
    const detail = await agent.get(`/api/studio/cards/${card.id}`);
    expect(detail.body.card.panels[1].imageId).toBeTypeOf("number");
    expect(detail.body.card.panels.filter((_: unknown, i: number) => i !== 1)).toEqual(card.panels.filter((_: unknown, i: number) => i !== 1));
    const image = await agent.get(`/api/studio/images/${detail.body.card.panels[1].imageId}`);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/image\/png/);
  });
  it("저장한 네 컷과 한글 대사를 합쳐 다운로드하며 대사 넘침은 알림", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#abcdef" } }).png().toBuffer();
    const { agent, headers, card } = await setup();
    expect((await agent.get(`/api/studio/cards/${card.id}/export.png`)).status).toBe(400);
    const images = await getDb().insert(studioImages).values(Array.from({ length: 4 }, (_, panelIndex) => ({ cardId: card.id, panelIndex, bytes: png, mimeType: "image/png", model: "fixture" }))).returning();
    const panels = images.map(image => ({ scene: "가족이 함께 있다", dialogue: "우리 같이 고향에 가자!", imageId: image.id }));
    const saved = await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 1, panels });
    expect(saved.status).toBe(200);
    const file = await agent.get(`/api/studio/cards/${card.id}/export.png`);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain(`studio-${card.id}-v2.png`);
    const info = await sharp(file.body).metadata();
    expect([info.width, info.height]).toEqual([1080, 1350]);
    expect(mockImage).not.toHaveBeenCalled();
    await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({ version: 2, panels: panels.map(p => ({ ...p, dialogue: "가족의 이야기 ".repeat(100) })) });
    expect((await agent.get(`/api/studio/cards/${card.id}/export.png`)).status).toBe(400);
  });
  it("Sites 가져오기는 중복 없이 기존 편집을 유지하며 비밀값을 받지 않음", async () => {
    const { agent, csrf } = await login(app);
    const headers = { "x-csrf-token": csrf };
    const source = { id: "legacy-one", title: "옛 보드", channel: "highway", format: "웹툰", stage: "idea", dueDate: "", memo: "메모", createdAt: "2026-10-10T00:00:00Z" };
    const first = await agent.post("/api/studio/import").set(headers).send({ exportedAt: new Date().toISOString(), cards: [source] });
    expect(first.body.imported).toBe(1);
    const [imported] = await getDb().select().from(studioCards).where(eq(studioCards.externalId, "sites:legacy-one"));
    await saveStudioCard(getDb(), imported.id, 1, { title: "Render에서 수정" }, "admin");
    const replay = await agent.post("/api/studio/import").set(headers).send({ cards: [source] });
    expect(replay.body.skipped).toBe(1);
    expect((await agent.get(`/api/studio/cards/${imported.id}`)).body.card.title).toBe("Render에서 수정");
    expect((await agent.post("/api/studio/import").set(headers).send({ cards: [], apiKey: "not-accepted" })).status).toBe(400);
    expect((await getDb().select().from(studioRevisions).where(eq(studioRevisions.cardId, imported.id)))).toHaveLength(2);
  });
});
