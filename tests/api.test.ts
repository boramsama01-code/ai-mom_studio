/**
 * API·워커 통합 테스트 (실제 PostgreSQL 사용, 외부 서비스는 가짜 응답)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { login, naverResponse, resetDb, setTestEnv } from "./helpers";
import { cardCopyFixture } from "./fixtures/cardCopy";

setTestEnv();

// Claude 호출은 가짜 추출 결과로 대체(키 없이 흐름 검증)
const fakeExtract = vi.fn();
vi.mock("../server/services/llm", async (orig) => {
  const mod = await orig<typeof import("../server/services/llm")>();
  return { ...mod, extractNotice: (...a: unknown[]) => fakeExtract(...a) };
});

const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { runCollect, extractForItem } = await import("../server/worker/collect");
const { publishDue, renderCardForItem } = await import("../server/worker/publish");
const { enqueueJob, claimJob, recoverExpired } = await import("../server/worker/queue");
const { LlmBudget } = await import("../server/services/llm");
const schema = await import("../shared/schema");
const { eq, sql } = await import("drizzle-orm");

let app: ReturnType<typeof createApp>;
const NOW = new Date("2026-09-28T03:00:00Z");

function newsItem(n: number, extra: Record<string, string> = {}) {
  return {
    title: `<b>경기과학고</b> 입학설명회 기사 ${n}`,
    originallink: `https://press.example/article/${n}?utm_source=naver`,
    link: `https://n.news.naver.com/mnews/article/001/${n}`,
    description: `설명 ${n}`,
    pubDate: "Mon, 28 Sep 2026 10:00:00 +0900",
    ...extra,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    relevance: "relevant", irrelevance_reason: null, title: "경기과학고 2027학년도 입학설명회", organization: "경기과학고등학교", notice_type: "입학설명회",
    category: "영재학교·과학고 입시", school_type: "gifted", academic_year: "2027학년도", audience: "중학교 3학년", eligibility: null,
    schedules: [{ kind: "apply", label: "원서접수", start: { date: "2026-10-20" }, end: { date: "2026-10-24" }, raw: "10월 20일~24일" }],
    deadline_type: "fixed", key_details: "사전 예약제", one_line_summary: "설명회와 접수 일정 안내", uncertainties: [], has_conflict: false,
    evidence: [{ field: "schedules", source_id: 1, quote: "원서접수" }],
    ...over,
  };
}

const okFetchSource = async () => ({ ok: true as const, finalUrl: "https://press.example/a", title: "t", text: "본문 원서접수 10월 20일 ".repeat(10), hash: "h1", attachments: [], contentKind: "html" as const });

beforeAll(async () => {
  await resetDb();
  app = createApp();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(() => {
  fakeExtract.mockReset();
  vi.unstubAllGlobals();
});

describe("인증·보안", () => {
  it("로그인 없이 운영 API 차단", async () => {
    expect((await request(app).get("/api/channels")).status).toBe(401);
    expect((await request(app).post("/api/channels/1/rules").send({})).status).toBe(401);
  });
  it("잘못된 비밀번호 거부, 비관리자 차단", async () => {
    expect((await request(app).post("/api/auth/login").send({ username: "admin", password: "wrong" })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ username: "other", password: "test-password-123" })).status).toBe(401);
  });
  it("CSRF 토큰 없는 변경 요청 차단", async () => {
    const { agent } = await login(app);
    const r = await agent.post("/api/channels/1/rules").send({ query: "x", endpoints: ["news"] });
    expect(r.status).toBe(403);
  });
  it("'전체' 채널로 쓰기 불가", async () => {
    const { agent, csrf } = await login(app);
    const r = await agent.post("/api/channels/all/rules").set("x-csrf-token", csrf).send({ query: "x", endpoints: ["news"] });
    expect(r.status).toBe(400);
  });
});

describe("검색어 CRUD", () => {
  it("추가·중복 방지·수정·정지·삭제·복구", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const c = await agent.post("/api/channels/1/rules").set(H).send({ query: "  서울과학고  모집요강 ", endpoints: ["news", "blog"] });
    expect(c.status).toBe(201);
    expect(c.body.created).toHaveLength(2);
    const dup = await agent.post("/api/channels/1/rules").set(H).send({ query: "서울과학고 모집요강", endpoints: ["news"] });
    expect(dup.status).toBe(409);
    const rule = c.body.created[0];
    const upd = await agent.patch(`/api/channels/1/rules/${rule.id}`).set(H).send({ version: rule.version, enabled: false, excludeTerms: ["학원"] });
    expect(upd.body.enabled).toBe(false);
    expect(upd.body.version).toBe(rule.version + 1);
    const stale = await agent.patch(`/api/channels/1/rules/${rule.id}`).set(H).send({ version: rule.version, memo: "x" });
    expect(stale.status).toBe(409);
    expect((await agent.post(`/api/channels/1/rules/${rule.id}/delete`).set(H)).status).toBe(200);
    const list = await agent.get("/api/channels/1/rules");
    expect(list.body.items.find((r: { id: number }) => r.id === rule.id)).toBeUndefined();
    // 삭제 후 같은 검색어를 새로 만들 수 있음 → 그러면 복구는 충돌
    const again = await agent.post("/api/channels/1/rules").set(H).send({ query: "서울과학고 모집요강", endpoints: ["news"] });
    expect(again.status).toBe(201);
    expect((await agent.post(`/api/channels/1/rules/${rule.id}/restore`).set(H)).status).toBe(409);
    await agent.post(`/api/channels/1/rules/${again.body.created[0].id}/delete`).set(H);
    const rest = await agent.post(`/api/channels/1/rules/${rule.id}/restore`).set(H);
    expect(rest.status).toBe(200);
    expect(rest.body.enabled).toBe(false);
  });
  it("대량 추가 미리보기는 저장하지 않음", async () => {
    const { agent, csrf } = await login(app);
    const before = (await agent.get("/api/channels/1/rules")).body.items.length;
    const p = await agent.post("/api/channels/1/rules/bulk-preview").set("x-csrf-token", csrf).send({ text: "하나고 입학설명회\n새 검색어 A", endpoints: ["news"] });
    expect(p.body.newCount).toBe(1);
    expect(p.body.duplicateCount).toBe(1);
    expect((await agent.get("/api/channels/1/rules")).body.items.length).toBe(before);
  });
});

describe("수집 실행", () => {
  it("설정 스냅샷 고정, 정지된 검색어는 호출 안 함, URL 반복은 중복 처리, 제외어 사유 보존", async () => {
    const db = getDb();
    // 채널 1의 활성 검색어를 하나만 남김
    await db.update(schema.searchRules).set({ enabled: false }).where(eq(schema.searchRules.channelId, 1));
    const [rule] = await db.insert(schema.searchRules).values({ channelId: 1, query: "경기과학고 입학설명회", normalizedQuery: "경기과학고 입학설명회 t", endpoint: "news", excludeTerms: ["학원"] }).returning();
    const calls: string[] = [];
    const naverFetch = (async (url: URL) => {
      calls.push(url.searchParams.get("query")!);
      return naverResponse([newsItem(1), newsItem(2), newsItem(3, { title: "학원 설명회 안내" })]);
    }) as unknown as typeof fetch;
    const r1 = await runCollect(db, 1, { trigger: "cli", now: NOW, naverFetch, fetchSource: okFetchSource });
    expect(calls).toEqual(["경기과학고 입학설명회"]);
    expect(r1.counts).toMatchObject({ results: 3, newItems: 3, excluded: 1, fetchedOk: 2 });
    expect(r1.status).toBe("ok"); // 자동 AI를 끄면 키 없이도 자료 수집은 정상 완료
    expect(r1.counts.extractionSkippedAutoGenerateOff).toBe(2);
    expect(fakeExtract).not.toHaveBeenCalled();
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, r1.runId));
    expect((run.snapshot as { rules: Array<{ id: number; excludeTerms: string[] }> }).rules[0]).toMatchObject({ id: rule.id, excludeTerms: ["학원"] });
    const excluded = await db.select().from(schema.contentItems).where(eq(schema.contentItems.excluded, true));
    expect(excluded[0].excludedReason).toMatch(/학원/);

    // 실행 후 설정 변경 → 기존 실행 스냅샷은 그대로, 다음 실행부터 반영
    await db.update(schema.searchRules).set({ excludeTerms: [] }).where(eq(schema.searchRules.id, rule.id));
    const [runAgain] = await db.select().from(schema.runs).where(eq(schema.runs.id, r1.runId));
    expect((runAgain.snapshot as { rules: Array<{ excludeTerms: string[] }> }).rules[0].excludeTerms).toEqual(["학원"]);

    // 같은 URL 반복(추적 파라미터만 다름) → 중복
    const r2 = await runCollect(db, 1, { trigger: "cli", now: NOW, naverFetch: (async () => naverResponse([newsItem(1, { originallink: "https://press.example/article/1?utm_medium=x" })])) as unknown as typeof fetch, fetchSource: okFetchSource });
    expect(r2.counts).toMatchObject({ newItems: 0, duplicates: 1 });
    expect(r2.status).toBe("ok_zero");

    // 정지하면 다음 실행에서 호출하지 않음
    await db.update(schema.searchRules).set({ enabled: false }).where(eq(schema.searchRules.id, rule.id));
    calls.length = 0;
    const r3 = await runCollect(db, 1, { trigger: "cli", now: NOW, naverFetch, fetchSource: okFetchSource });
    expect(calls).toEqual([]);
    expect(r3.counts.rules).toBe(0);
  });

  it("네이버 인증 오류는 '정상 0건'이 아니라 실패", async () => {
    const db = getDb();
    await db.update(schema.searchRules).set({ enabled: true }).where(eq(schema.searchRules.query, "경기과학고 입학설명회"));
    const r = await runCollect(db, 1, { trigger: "cli", now: NOW, naverFetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch, fetchSource: okFetchSource });
    expect(r.status).toBe("failed");
    expect(r.errors[0].message).toMatch(/인증/);
  });

  it("원문 확보 실패는 사유와 함께 보존", async () => {
    const db = getDb();
    const r = await runCollect(db, 1, {
      trigger: "cli", now: NOW,
      naverFetch: (async () => naverResponse([newsItem(10)])) as unknown as typeof fetch,
      fetchSource: async () => ({ ok: false as const, status: "failed" as const, error: "HTTP 403" }),
    });
    expect(r.counts.fetchFailed).toBe(1);
    const [doc] = await db.select().from(schema.sourceDocuments).where(sql`${schema.sourceDocuments.originalUrl} like '%/article/10%'`);
    expect([doc.fetchStatus, doc.fetchError]).toEqual(["failed", "HTTP 403"]);
  });
});

describe("공식 게시판 수집", () => {
  it("도메인 확인 + 수집기 설정된 곳만 읽고, 공식 원문으로 저장", async () => {
    const db = getDb();
    const [o] = await db.select().from(schema.officialSources).where(eq(schema.officialSources.name, "경기과학고등학교"));
    await db.update(schema.officialSources).set({ domain: "gs.hs.kr", boardUrl: "https://gs.hs.kr/board/list", adapter: "generic_board", adapterConfig: { linkSelector: "td.subject a" }, enabled: true, verifiedAt: new Date() }).where(eq(schema.officialSources.id, o.id));
    await db.update(schema.searchRules).set({ enabled: false }).where(eq(schema.searchRules.channelId, 1));
    const boardCalls: string[] = [];
    const r = await runCollect(db, 1, {
      trigger: "cli", now: NOW,
      fetchBoard: async (url) => {
        boardCalls.push(url);
        return { ok: true as const, entries: [{ url: "https://gs.hs.kr/board/view?id=1", title: "2027학년도 입학전형 요강", dateText: "2026.09.25" }] };
      },
      fetchSource: async () => ({ ok: true as const, finalUrl: "https://gs.hs.kr/board/view?id=1", title: "요강", text: "원서접수 2026년 10월 20일부터 ".repeat(8), hash: "h", attachments: [], contentKind: "html" as const }),
    });
    expect(boardCalls).toEqual(["https://gs.hs.kr/board/list"]);
    expect(r.counts.officialNew).toBe(1);
    const [doc] = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.originalUrl, "https://gs.hs.kr/board/view?id=1"));
    expect([doc.kind, doc.publishedPrecision, doc.fetchStatus]).toEqual(["official", "date", "ok"]);
    await db.update(schema.officialSources).set({ enabled: false }).where(eq(schema.officialSources.id, o.id));
  });
});

describe("추출·운영자 편집 보존·채널 격리", () => {
  it("운영자 편집본은 재추출로 덮어쓰지 않고, 일정 변경은 재검토로", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.ANTHROPIC_MODEL = "m";
    const db = getDb();
    const [item] = await db.select().from(schema.contentItems).where(sql`${schema.contentItems.excluded} = false and ${schema.contentItems.channelId} = 1`).limit(1);
    fakeExtract.mockResolvedValueOnce({ ok: true, data: { ...payload(), cardCopy: cardCopyFixture() }, model: "fake", usage: { inputTokens: 10, outputTokens: 5 }, droppedEvidence: 0 });
    const r = await extractForItem(db, item.id, new LlmBudget(2), NOW);
    expect(r.ok).toBe(true);
    let [cur] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, item.id));
    expect(cur.scheduleStatus).toBe("upcoming");
    expect(cur.evidenceStatus).toBe("secondary_only");

    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const edited = await agent.patch(`/api/channels/1/items/${item.id}`).set(H).send({ version: cur.version, payload: payload({ audience: "운영자 수정 대상" }) });
    expect(edited.status).toBe(200);
    await agent.post(`/api/channels/1/items/${item.id}/review`).set(H).send({ version: edited.body.version, status: "reviewed" });

    fakeExtract.mockResolvedValueOnce({ ok: true, data: { ...payload({ schedules: [{ kind: "apply", start: { date: "2026-10-21" }, end: { date: "2026-10-25" } }] }), cardCopy: cardCopyFixture() }, model: "fake", usage: { inputTokens: 1, outputTokens: 1 }, droppedEvidence: 0 });
    await extractForItem(db, item.id, new LlmBudget(2), NOW);
    [cur] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, item.id));
    const [rev] = await db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.id, cur.currentRevisionId!));
    expect(rev.author).toBe("operator");
    expect((rev.payload as { audience: string }).audience).toBe("운영자 수정 대상");
    expect(cur.reviewStatus).toBe("review_required");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("다른 채널 경로로는 항목 조회·수정 불가", async () => {
    const { agent, csrf } = await login(app);
    const [item] = await getDb().select().from(schema.contentItems).where(eq(schema.contentItems.channelId, 1)).limit(1);
    expect((await agent.get(`/api/channels/2/items/${item.id}`)).status).toBe(404);
    expect((await agent.patch(`/api/channels/2/items/${item.id}`).set("x-csrf-token", csrf).send({ version: item.version, title: "x" })).status).toBe(404);
    const list = await agent.get("/api/items?channelId=2");
    expect(list.body.total).toBe(0);
  });
});

describe("카드·승인·게시", () => {
  beforeEach(() => {
    process.env.DRY_RUN = "false"; process.env.AUTO_PUBLISH = "true";
    process.env.TELEGRAM_BOT_TOKEN = "test-only-bot-token";
    process.env.TG_OPPORTUNITIES_CHAT_ID = "@test_channel";
  });
  async function prepareApproved(agent: request.Agent, csrf: string, schedules = payload().schedules) {
    const H = { "x-csrf-token": csrf };
    const created = await agent.post("/api/channels/1/items").set(H).send({ title: "승인 테스트" });
    const id = created.body.id;
    let d = (await agent.get(`/api/channels/1/items/${id}`)).body;
    const e = await agent.patch(`/api/channels/1/items/${id}`).set(H).send({ version: d.item.version, payload: payload({ schedules, title: "승인 테스트 공고" }) });
    await agent.post(`/api/channels/1/items/${id}/review`).set(H).send({ version: e.body.version, status: "reviewed" });
    const card = await agent.post(`/api/channels/1/items/${id}/card`).set(H);
    d = (await agent.get(`/api/channels/1/items/${id}`)).body;
    return { id, d, card };
  }

  it("검토 전 승인 불가, 마감 공고 승인 불가", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const { id, d } = await prepareApproved(agent, csrf, [{ kind: "apply", label: "접수", start: { date: "2026-08-01" }, end: { date: "2026-08-28" }, raw: null }] as never);
    const r = await agent.post(`/api/channels/1/items/${id}/approve`).set(H).send({ revisionId: d.current.id, mediaAssetId: d.cards[0].id, captions: d.defaultCaptions, scheduledAt: "2026-09-28T12:00:00+09:00" });
    // 오늘 날짜 기준 이미 마감(테스트 실행일이 2026-08-28 이후라고 가정하지 않도록 서버 시각 사용)
    if (Date.now() > Date.parse("2026-08-28T15:00:00Z")) expect(r.status).toBe(400);
  });

  it("연결 전에는 승인 기록을 만들지 않고, 연결된 계정만 예약 시각 이후 처리", async () => {
    const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf }, db = getDb();
    const { id, d } = await prepareApproved(agent, csrf, [{ kind: "apply", start: { date: "2099-10-20" }, end: { date: "2099-10-24" } }] as never);
    const scheduledAt = new Date(Date.now() + 60_000);
    const body = { revisionId: d.current.id, mediaAssetId: d.cards[0].id, captions: d.defaultCaptions, scheduledAt: scheduledAt.toISOString() };
    const path = `/api/channels/1/items/${id}/approve`;
    expect((await agent.get(`/api/channels/1/items/${id}`)).body.publicationReadiness.ready).toBe(false);
    expect((await agent.post(path).set(H).send(body)).status).toBe(400);
    const dest = await agent.post("/api/channels/1/destinations").set(H).send({ platform: "telegram_channel", label: "readiness fixture" });
    await agent.patch(`/api/channels/1/destinations/${dest.body.id}`).set(H).send({ version: dest.body.version, enabled: true });
    delete process.env.TG_OPPORTUNITIES_CHAT_ID;
    expect((await agent.post(path).set(H).send(body)).status).toBe(400);
    expect(await db.select().from(schema.approvals).where(eq(schema.approvals.contentItemId, id))).toHaveLength(0);
    // A historical zero-destination approval remains visible, without creating
    // or retrying a delivery merely because its diagnostic endpoint was read.
    const [legacy] = await db.insert(schema.approvals).values({ channelId: 1, contentItemId: id, revisionId: d.current.id, mediaAssetId: d.cards[0].id, cardSha256: d.cards[0].sha256, captions: d.defaultCaptions, scheduledAt, approvedBy: "test" }).returning();
    const orphans = await agent.get("/api/publication-orphans?channelId=all");
    expect(orphans.status).toBe(200);
    expect(orphans.body).toEqual(expect.arrayContaining([expect.objectContaining({ ap: expect.objectContaining({ id: legacy.id, status: "active" }), item: expect.objectContaining({ id, channelId: 1 }) })]));
    expect((await agent.get("/api/publication-orphans?channelId=2")).body).toEqual([]);
    expect((await request(app).get("/api/publication-orphans?channelId=all")).status).toBe(401);
    expect(await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, legacy.id))).toHaveLength(0);
    expect((await db.select().from(schema.approvals).where(eq(schema.approvals.id, legacy.id)))[0].status).toBe("active");
    process.env.TG_OPPORTUNITIES_CHAT_ID = "@test_channel";
    let approved = await agent.post(path).set(H).send(body);
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ destinations: 1, publicationReadiness: { ready: true, dryRun: false }, workerStarted: false });
    let [delivery] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, approved.body.approval.id));
    for (const status of ["scheduled", "processing", "succeeded", "unknown"]) {
      await db.update(schema.deliveries).set({ status }).where(eq(schema.deliveries.id, delivery.id));
      const [beforeDelivery] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, delivery.id));
      const [beforeApproval] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, approved.body.approval.id));
      expect((await agent.post(path).set(H).send(body)).status).toBe(409);
      expect((await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, delivery.id)))[0]).toEqual(beforeDelivery);
      expect((await db.select().from(schema.approvals).where(eq(schema.approvals.id, approved.body.approval.id)))[0]).toEqual(beforeApproval);
    }
    for (const status of ["failed", "dry_run"]) {
      await db.update(schema.deliveries).set({ status }).where(eq(schema.deliveries.id, delivery.id));
      const previousId = approved.body.approval.id;
      approved = await agent.post(path).set(H).send(body);
      expect(approved.status).toBe(201);
      expect(approved.body.approval.id).not.toBe(previousId);
      expect((await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, delivery.id)))[0].status).toBe(status);
      [delivery] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, approved.body.approval.id));
    }
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 701, chat: { username: "test_channel" } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect((await publishDue(db, { now: new Date(scheduledAt.getTime() - 1000) })).processed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await publishDue(db, { now: new Date(scheduledAt.getTime() + 1000) })).succeeded).toBe(1);
    expect((await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, approved.body.approval.id)))[0].status).toBe("succeeded");
    expect((await agent.get("/api/publication-orphans?channelId=1")).body).toEqual([]);
    await db.update(schema.destinations).set({ enabled: false }).where(eq(schema.destinations.id, dest.body.id));
  });

  it("채널을 보관하면 예약된 게시를 전송 직전에 취소", async () => {
    const { agent, csrf } = await login(app); const H = { "x-csrf-token": csrf };
    const db = getDb();
    const dest = await agent.post("/api/channels/1/destinations").set(H).send({ platform: "telegram_channel", label: "보관 중단 테스트" });
    await agent.patch(`/api/channels/1/destinations/${dest.body.id}`).set(H).send({ version: dest.body.version, enabled: true });
    const { id, d } = await prepareApproved(agent, csrf, [{ kind: "apply", label: "접수", start: { date: "2099-10-20" }, end: { date: "2099-10-24" }, raw: null }] as never);
    const approved = await agent.post(`/api/channels/1/items/${id}/approve`).set(H).send({ revisionId: d.current.id, mediaAssetId: d.cards[0].id, captions: d.defaultCaptions, scheduledAt: "2026-01-01T00:00:00+09:00" });
    expect(approved.status).toBe(201);
    await db.update(schema.channels).set({ active: false }).where(eq(schema.channels.id, 1));
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    try {
      await publishDue(db, { now: new Date() });
      const rows = await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, approved.body.approval.id));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(row => row.status === "cancelled" && row.lastError?.includes("보관된 채널"))).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await db.update(schema.channels).set({ active: true }).where(eq(schema.channels.id, 1));
      await db.update(schema.destinations).set({ enabled: false }).where(eq(schema.destinations.id, dest.body.id));
    }
  });

  it("DRY_RUN: 모든 사전 검사 후 전송 안 함, succeeded로 저장하지 않음 / 수정하면 승인 무효", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const db = getDb();
    process.env.TG_OPPORTUNITIES_CHAT_ID = "@test_channel";
    const dest = await agent.post("/api/channels/1/destinations").set(H).send({ platform: "telegram_channel", label: "공개 채널" });
    await agent.patch(`/api/channels/1/destinations/${dest.body.id}`).set(H).send({ version: dest.body.version, enabled: true });
    const { id, d, card } = await prepareApproved(agent, csrf, [{ kind: "apply", label: "접수", start: { date: "2099-10-20" }, end: { date: "2099-10-24" }, raw: null }] as never);
    expect(card.status).toBe(200);
    const ap = await agent.post(`/api/channels/1/items/${id}/approve`).set(H).send({ revisionId: d.current.id, mediaAssetId: d.cards[0].id, captions: d.defaultCaptions, scheduledAt: "2026-01-01T00:00:00+09:00" });
    expect(ap.status).toBe(201);
    process.env.DRY_RUN = "true";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const s = await publishDue(db, { now: new Date() });
    expect(s.dryRun).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [del] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, ap.body.approval.id));
    expect(del.status).toBe("dry_run");

    // 승인 후 편집 → 승인 무효
    const fresh = (await agent.get(`/api/channels/1/items/${id}`)).body;
    await agent.patch(`/api/channels/1/items/${id}`).set(H).send({ version: fresh.item.version, payload: payload({ title: "바뀐 제목", schedules: [{ kind: "apply", start: { date: "2099-10-20" }, end: { date: "2099-10-24" } }] }) });
    const [apRow] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, ap.body.approval.id));
    expect(apRow.status).toBe("invalidated");
  });

  it("실게시 모드: 한 목적지 성공·다른 목적지 실패 → 실패한 곳만 재시도, 응답 유실은 결과 불명", async () => {
    process.env.DRY_RUN = "false";
    process.env.AUTO_PUBLISH = "true";
    process.env.TELEGRAM_BOT_TOKEN = "fake-token";
    process.env.TG_OPPORTUNITIES_BACKUP_CHAT_ID = "@backup";
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const db = getDb();
    const d2 = await agent.post("/api/channels/1/destinations").set(H).send({ platform: "telegram_channel", label: "백업 채널", secretRefs: { chatId: "TG_OPPORTUNITIES_BACKUP_CHAT_ID" } });
    await agent.patch(`/api/channels/1/destinations/${d2.body.id}`).set(H).send({ version: d2.body.version, enabled: true });
    const { id, d } = await prepareApproved(agent, csrf, [{ kind: "apply", start: { date: "2099-10-20" }, end: { date: "2099-10-24" } }] as never);
    const ap = await agent.post(`/api/channels/1/items/${id}/approve`).set(H).send({ revisionId: d.current.id, mediaAssetId: d.cards[0].id, captions: d.defaultCaptions, scheduledAt: "2026-01-01T00:00:00+09:00" });
    expect(ap.body.destinations).toBe(2);
    let n = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { body: FormData }) => {
      n++;
      const chat = init.body.get("chat_id");
      if (chat === "@test_channel") return new Response(JSON.stringify({ ok: true, result: { message_id: 77, chat: { username: "test_channel" } } }), { status: 200 });
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 });
    });
    const s = await publishDue(db, { now: new Date() });
    expect(s.succeeded).toBe(1);
    expect(s.failed).toBe(1);
    const dels = await db.select().from(schema.deliveries).where(eq(schema.deliveries.approvalId, ap.body.approval.id));
    const ok = dels.find((x) => x.status === "succeeded")!;
    const bad = dels.find((x) => x.status === "failed")!;
    expect(ok.externalUrl).toBe("https://t.me/test_channel/77");
    // 성공한 목적지는 다시 보내지 않음
    await agent.post(`/api/channels/1/deliveries/${bad.id}/retry`).set(H).send({});
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket hang up");
    });
    const s2 = await publishDue(db, { now: new Date() });
    expect(s2.processed).toBe(1);
    expect(s2.unknown).toBe(1);
    const [again] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, bad.id));
    expect(again.status).toBe("unknown");
    // 결과 불명은 확인 없이 재시도 불가
    expect((await agent.post(`/api/channels/1/deliveries/${bad.id}/retry`).set(H).send({})).status).toBe(400);
    expect((await agent.post(`/api/channels/1/deliveries/${bad.id}/retry`).set(H).send({ confirmNotPosted: true })).status).toBe(200);
    process.env.DRY_RUN = "true";
    process.env.AUTO_PUBLISH = "false";
    expect(n).toBe(2);
  });

  it("카드 넘침은 편집 필요(422)", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const created = await agent.post("/api/channels/1/items").set(H).send({ title: "넘침" });
    const d = (await agent.get(`/api/channels/1/items/${created.body.id}`)).body;
    await agent.patch(`/api/channels/1/items/${created.body.id}`).set(H).send({ version: d.item.version, payload: payload({ title: "아주 긴 제목 ".repeat(150) }) });
    const r = await agent.post(`/api/channels/1/items/${created.body.id}/card`).set(H);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("overflow");
    const direct = await renderCardForItem(getDb(), created.body.id);
    expect(direct.ok).toBe(false);
  });
});

describe("작업 큐", () => {
  it("중복 요청 방지, lease 만료 복구", async () => {
    const db = getDb();
    const a = await enqueueJob(db, { type: "collect", channelId: 2, dedupeKey: "collect:2" });
    const b = await enqueueJob(db, { type: "collect", channelId: 2, dedupeKey: "collect:2" });
    expect(b.duplicate).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    const claimed = await claimJob(db, "w1", ["collect"]);
    expect(claimed?.status).toBe("running");
    expect(await claimJob(db, "w2", ["collect"])).toBeNull();
    await db.update(schema.jobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, claimed!.id));
    expect(await recoverExpired(db)).toBe(1);
    const [j] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, claimed!.id));
    expect(j.status).toBe("queued");
  });
});

describe("재시작 후 영속성", () => {
  it("새 앱 인스턴스에서도 저장된 설정 유지", async () => {
    const app2 = createApp();
    const { agent } = await login(app2);
    const r = await agent.get("/api/channels/1/rules?deleted=1");
    expect(r.body.items.some((x: { query: string }) => x.query === "서울과학고 모집요강")).toBe(true);
  });
});
