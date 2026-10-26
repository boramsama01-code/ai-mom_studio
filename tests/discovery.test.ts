/**
 * 자동 화제 발굴 — 사건 묶기·화제도(단위) + 수집 실행 안의 발굴·선정·초안(통합, 외부 서비스는 가짜 응답)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { login, naverResponse, resetDb, setTestEnv } from "./helpers";

setTestEnv();

const fakeCurate = vi.fn();
const fakeScience = vi.fn();
const fakeReview = vi.fn();
vi.mock("../server/services/telegram", async (orig) => {
  const mod = await orig<typeof import("../server/services/telegram")>();
  return { ...mod, sendReviewMessage: (...a: unknown[]) => fakeReview(...a) };
});
vi.mock("../server/services/llm", async (orig) => {
  const mod = await orig<typeof import("../server/services/llm")>();
  return { ...mod, curateIssues: (...a: unknown[]) => fakeCurate(...a), draftScience: (...a: unknown[]) => fakeScience(...a) };
});

const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { runCollect } = await import("../server/worker/collect");
const { clusterArticles, rankClusters, toArticle, tokenize, outletOf, blockedReason } = await import("../server/services/discover");
const { mapNaverItem } = await import("../server/services/naver");
const { __resetNaverProviderForTest } = await import("../server/services/naver");
const schema = await import("../shared/schema");
const { eq } = await import("drizzle-orm");

const NOW = new Date("2026-10-02T03:00:00Z");
const SCIENCE = 2; // 시드 순서: 1 도전·진학, 2 과학, 3 시사

function news(title: string, host: string, n: number, desc = "") {
  return {
    title,
    originallink: `https://${host}/news/${n}`,
    link: n % 2 ? `https://n.news.naver.com/mnews/article/0${n}/${n}` : `https://${host}/news/${n}`,
    description: desc || title,
    pubDate: `Fri, 02 Oct 2026 ${String(8 + (n % 3)).padStart(2, "0")}:00:00 +0900`,
  };
}

// 같은 사건(누리호 발사)을 언론 4곳, 다른 사건(새 공룡 화석)을 2곳, 단독 기사 몇 건
const NURI = [
  news("누리호 5차 발사 성공…위성 8기 궤도 안착", "www.yna.co.kr", 1, "한국형 발사체 누리호가 5차 발사에 성공해 위성 8기를 궤도에 올렸다"),
  news("[속보] 한국형 발사체 누리호 5차 발사 성공", "www.hani.co.kr", 2, "누리호 5차 발사 성공으로 위성 궤도 진입"),
  news("누리호, 5번째 발사도 성공…위성 궤도 진입 확인", "news.kbs.co.kr", 3, "누리호 발사 성공, 위성 8기 궤도 진입"),
  news("누리호 5차 발사 성공, 민간 주도 첫 발사", "www.donga.com", 4, "누리호 5차 발사 성공 민간 기업 주도"),
];
const FOSSIL = [
  news("경남 고성서 새로운 공룡 화석 발견", "www.chosun.com", 5, "연구팀이 새로운 공룡 화석을 발견했다"),
  news("고성에서 새로운 공룡 화석 발견…연구팀 발표", "www.joongang.co.kr", 6, "새로운 공룡 화석 발견 연구팀"),
];
const SINGLE = [
  news("대학 연구실 탐방기: 반도체 소자 실험", "www.etnews.com", 7),
  news("주가 급등한 우주 관련주 정리", "www.mk.co.kr", 8),
];

describe("사건 묶기·화제도", () => {
  const arts = [...NURI, ...FOSSIL, ...SINGLE].map((it) => toArticle(mapNaverItem("news", it), "우주 탐사"));

  it("낱말 추출: 조사·머리말 제거", () => {
    const t = tokenize("[속보] 누리호가 발사에 성공했다");
    expect(t.has("누리호")).toBe(true);
    expect(t.has("발사")).toBe(true);
    expect([...t].some((w) => w.includes("속보"))).toBe(false);
  });

  it("언론사 도메인 정리", () => {
    expect(outletOf({ originallink: "https://www.yna.co.kr/view/1", link: "" })).toBe("yna.co.kr");
    expect(outletOf({ originallink: "https://news.kbs.co.kr/a", link: "" })).toBe("kbs.co.kr");
    expect(outletOf({ originallink: "https://www.donga.com/a", link: "" })).toBe("donga.com");
  });

  it("같은 사건끼리 묶고, 언론사 수로 순위를 매긴다", () => {
    const clusters = clusterArticles(arts);
    const ranked = rankClusters(clusters, { strictTopic: true });
    expect(ranked[0].articles.map((a) => a.outlet).sort()).toEqual(["donga.com", "hani.co.kr", "kbs.co.kr", "yna.co.kr"]);
    expect(ranked[0].score).toBe(4);
    expect(ranked[1].score).toBe(2);
    expect(ranked[1].representative.title).toContain("공룡");
    // 1곳만 다룬 기사는 화제 후보에서 빠짐
    expect(ranked.every((c) => c.score >= 2)).toBe(true);
    // 대표 기사는 네이버 뉴스 주소가 있는 기사 우선
    expect(ranked[0].representative.link).toContain("n.news.naver.com");
  });

  it("부적절·채널 밖 주제 거르기", () => {
    const bad = clusterArticles([toArticle(mapNaverItem("news", news("마약 투약 혐의 체포", "a.com", 9)), "q")]);
    expect(blockedReason(bad[0], false)).toContain("마약");
    const stock = clusterArticles([toArticle(mapNaverItem("news", SINGLE[1]), "q")]);
    expect(blockedReason(stock[0], false)).toBeNull();
    expect(blockedReason(stock[0], true)).toContain("주가");
  });
});

describe("수집 실행 안의 자동 발굴", () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    await resetDb();
    app = createApp();
    __resetNaverProviderForTest();
  });
  afterAll(async () => {
    await closeDb();
  });

  const naverFetch = (async (u: URL) => {
    const q = new URL(String(u)).searchParams.get("query");
    if (q === "우주 탐사") return naverResponse([...NURI, ...SINGLE]);
    if (q === "연구팀 발견") return naverResponse(FOSSIL);
    return naverResponse([]);
  }) as unknown as typeof fetch;
  const okFetch = async (url: string) => ({ ok: true as const, finalUrl: url, title: "t", text: `원문 본문 ${url} `.repeat(20), hash: "h", attachments: [], contentKind: "html" as const });

  it("검색어 없이도 화제를 골라 저장하고, 다른 언론사 기사를 보조 근거로 연결(Claude 없음 → 화제도 순)", async () => {
    const db = getDb();
    const rules = await db.select().from(schema.searchRules).where(eq(schema.searchRules.channelId, SCIENCE));
    expect(rules).toHaveLength(0);

    const r = await runCollect(db, SCIENCE, { trigger: "cli", now: NOW, naverFetch, fetchSource: okFetch });
    expect(r.counts.discoveryQueries).toBe(4);
    expect(r.counts.discoveryPicked).toBe(2); // 누리호(4곳), 공룡 화석(2곳). 단독·주가 기사는 제외
    expect(r.status).toBe("ok"); // Claude 미연결은 오류가 아니라 안내(초안만 건너뜀)
    expect(r.counts.draftSkippedAutoGenerateOff).toBe(2);

    const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.channelId, SCIENCE));
    expect(items).toHaveLength(2);
    const nuri = items.find((i) => i.title.includes("누리호"))!;
    expect(nuri.origin).toBe("discovered");
    expect(nuri.discovery).toMatchObject({ score: 4, pickedBy: "buzz", query: "우주 탐사" });
    const links = await db.select().from(schema.contentSources).where(eq(schema.contentSources.contentItemId, nuri.id));
    expect(links).toHaveLength(3); // 대표 외 언론사 3곳
    expect(r.counts.supportingFetched).toBeGreaterThan(0);

    // 오늘의 작업에 최근 화제로 나온다
    const { agent } = await login(app);
    const t = await agent.get(`/api/channels/${SCIENCE}/today`);
    expect(t.body.discovered).toHaveLength(2);
    expect(t.body.discovery).toMatchObject({ enabled: true, picksPerRun: 3 });
  });

  it("다음 실행에서 같은 사건은 다시 고르지 않는다", async () => {
    const r = await runCollect(getDb(), SCIENCE, { trigger: "cli", now: new Date(NOW.getTime() + 3600_000), naverFetch, fetchSource: okFetch });
    expect(r.counts.discoveryPicked).toBe(0);
  });

  it("Claude 연결 시: 선정 이유·질문 저장, 초안 자동 생성", async () => {
    // 앞 테스트에서 저장한 과학 채널 항목 지우기(세션 테이블은 유지)
    const { getPool } = await import("../server/db");
    await getPool().query(`delete from content_sources where content_item_id in (select id from content_items where channel_id = ${SCIENCE});
      delete from content_revisions where content_item_id in (select id from content_items where channel_id = ${SCIENCE});
      delete from content_items where channel_id = ${SCIENCE};`);
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.ANTHROPIC_MODEL = "m";
    process.env.AUTO_GENERATE = "true";
    fakeCurate.mockImplementation(async (args: { candidates: Array<{ id: number; titles: string[] }>; budget: { take(): boolean } }) => {
      args.budget.take();
      const fossil = args.candidates.find((c) => c.titles[0].includes("공룡"))!;
      return { ok: true, model: "m", usage: { inputTokens: 100, outputTokens: 50 }, droppedEvidence: 0, data: { picks: [{ candidate_id: fossil.id, reason: "화석으로 과거를 추론하는 과정을 이야기하기 좋음", angle: "뼈 몇 조각으로 어떻게 새 종이라고 알 수 있을까?" }] } };
    });
    fakeScience.mockResolvedValue({
      ok: true, model: "m", usage: { inputTokens: 1000, outputTokens: 500 }, droppedEvidence: 0,
      data: { topic: "공룡 화석", age_band: "중1~3", key_question: "뼈 몇 조각으로 새 종을 알 수 있을까?", background: ["a", "b", "c"], discussion_questions: ["1", "2", "3"], scientific_basis: "x", misconceptions: [], parent_hints: [], safe_activity: null, sources: [], evidence: [] },
    });
    try {
      const db = getDb();
      const r = await runCollect(db, SCIENCE, { trigger: "cli", now: NOW, naverFetch, fetchSource: okFetch });
      expect(fakeCurate).toHaveBeenCalledOnce();
      expect(r.counts.discoveryPicked).toBe(1);
      expect(r.counts.drafted).toBe(1);
      const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.channelId, SCIENCE));
      expect(item.discovery).toMatchObject({ pickedBy: "claude", angle: "뼈 몇 조각으로 어떻게 새 종이라고 알 수 있을까?" });
      expect(item.currentRevisionId).not.toBeNull();
      expect(item.reviewStatus).toBe("pending"); // 초안이 생겨도 검토 대기
      expect(item.title).toBe("뼈 몇 조각으로 새 종을 알 수 있을까?");
      expect((item.discovery as { headline: string }).headline).toContain("공룡");
      const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, r.runId));
      expect(run.llmUsage).toMatchObject({ calls: 2 });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_MODEL;
      process.env.AUTO_GENERATE = "false";
    }
  });

  it.each([false, true])("수집 전용=%s에서 AI·알림 호출 없이 자료만 저장한다", async (collectionOnly) => {
    const { getPool } = await import("../server/db");
    await getPool().query(`delete from content_sources where content_item_id in (select id from content_items where channel_id = ${SCIENCE});
      delete from content_revisions where content_item_id in (select id from content_items where channel_id = ${SCIENCE});
      delete from content_items where channel_id = ${SCIENCE};`);
    vi.stubEnv("ANTHROPIC_API_KEY", "configured-test-key");
    vi.stubEnv("AUTO_GENERATE", String(collectionOnly));
    vi.stubEnv("COLLECT_REVIEW_NOTIFICATIONS", String(collectionOnly));
    vi.stubEnv("TELEGRAM_REVIEW_CHAT_ID", "configured-test-destination");
    fakeCurate.mockClear(); fakeScience.mockClear(); fakeReview.mockClear();
    try {
      const r = await runCollect(getDb(), SCIENCE, { trigger: "schedule", now: NOW, naverFetch, fetchSource: okFetch, collectionOnly });
      expect(r.counts.discoveryPicked).toBe(2);
      expect(r.counts.draftSkippedAutoGenerateOff).toBe(2);
      expect(fakeCurate).not.toHaveBeenCalled();
      expect(fakeScience).not.toHaveBeenCalled();
      expect(fakeReview).not.toHaveBeenCalled();
      const [run] = await getDb().select().from(schema.runs).where(eq(schema.runs.id, r.runId));
      expect(run.llmUsage).toMatchObject({ calls: 0 });
    } finally { vi.unstubAllEnvs(); }
  });

  it("연결 확인은 대기 작업을 실행하지 않고 12시간 수집 간격을 연결 상태로 유지한다", async () => {
    const { checkWorkerConnection } = await import("../server/worker/run");
    const r = await checkWorkerConnection();
    expect(r).toMatchObject({ connected: true, collected: 0, published: 0 });
    const db = getDb();
    const { agent } = await login(app);
    await db.update(schema.workerRuns).set({ startedAt: new Date(Date.now() - 12 * 3600_000) }).where(eq(schema.workerRuns.id, r.runId));
    expect((await agent.get("/api/status")).body.workerConnected).toBe(true);
    await db.update(schema.workerRuns).set({ startedAt: new Date(Date.now() - 15 * 3600_000) }).where(eq(schema.workerRuns.id, r.runId));
    expect((await agent.get("/api/status")).body.workerConnected).toBe(false);
  });

  it("발굴 설정 저장·끄기, 끄면 탐색 호출 없음", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const bad = await agent.put(`/api/channels/1/discovery`).set(H).send({ enabled: true, queries: ["a"], picksPerRun: 3, autoDraft: true });
    expect(bad.status).toBe(400); // 공고 채널에는 없음
    const s = await agent.put(`/api/channels/${SCIENCE}/discovery`).set(H).send({ enabled: true, queries: ["  블랙홀 ", "블랙홀", "백신 연구"], picksPerRun: 2, autoDraft: false });
    expect(s.status).toBe(200);
    expect(s.body.discovery).toEqual({ enabled: true, queries: ["블랙홀", "백신 연구"], picksPerRun: 2, autoDraft: false });
    const rules = await agent.get(`/api/channels/${SCIENCE}/rules`);
    expect(rules.body.estimate).toMatchObject({ discoveryCalls: 2, callsPerRun: 2 });

    await agent.put(`/api/channels/${SCIENCE}/discovery`).set(H).send({ enabled: false, queries: ["블랙홀"], picksPerRun: 2, autoDraft: false });
    const calls: string[] = [];
    const spy = (async (u: URL) => {
      calls.push(String(u));
      return naverResponse([]);
    }) as unknown as typeof fetch;
    await runCollect(getDb(), SCIENCE, { trigger: "cli", now: NOW, naverFetch: spy, fetchSource: okFetch });
    expect(calls).toHaveLength(0);
  });

  it("자동 수집 스위치", async () => {
    const { agent, csrf } = await login(app);
    expect((await agent.get("/api/status")).body.autoCollect).toBe(false);
    await agent.put("/api/settings/auto-collect").set({ "x-csrf-token": csrf }).send({ enabled: true });
    expect((await agent.get("/api/status")).body.autoCollect).toBe(true);
    const { autoCollectEnabled } = await import("../server/worker/run");
    expect(await autoCollectEnabled(getDb())).toBe(true);
  });

  it("지금 수집: 웹 서버에서 바로 처리(워커 없이)", async () => {
    process.env.INLINE_WORKER = "true";
    delete process.env.NAVER_CLIENT_ID; // 키가 없으면 빠르게 실패 처리되는지로 '바로 처리됨'을 확인
    try {
      const { agent, csrf } = await login(app);
      await agent.put(`/api/channels/${SCIENCE}/discovery`).set({ "x-csrf-token": csrf }).send({ enabled: true, queries: ["블랙홀"], picksPerRun: 2, autoDraft: false });
      const r = await agent.post(`/api/channels/${SCIENCE}/jobs/collect`).set({ "x-csrf-token": csrf }).send({});
      expect(r.status).toBe(201);
      expect(r.body.inline).toBe(true);
      const { waitInlineIdle } = await import("../server/worker/inline");
      await waitInlineIdle();
      const [job] = await getDb().select().from(schema.jobs).where(eq(schema.jobs.id, r.body.job.id));
      expect(job.status).toBe("failed");
      expect(job.lastError).toContain("네이버");
    } finally {
      process.env.INLINE_WORKER = "false";
      process.env.NAVER_CLIENT_ID = "test-id";
    }
  });
});

