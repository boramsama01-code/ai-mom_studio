/**
 * 화면에서 입력하는 연결 키 — 암호화 저장, 값 비노출, 환경변수 우선, 재시작 후 복원
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { login, naverResponse, resetDb, setTestEnv } from "./helpers";

setTestEnv();
delete process.env.NAVER_CLIENT_ID;
delete process.env.NAVER_CLIENT_SECRET;
process.env.TELEGRAM_BOT_TOKEN = "env-token-from-render";

const store = await import("../server/secretStore");
store.__setOriginalEnvForTest(Object.keys(process.env).filter((k) => process.env[k]));
const { createApp } = await import("../server/app");
const { getDb, closeDb, getPool } = await import("../server/db");

let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  await resetDb();
  app = createApp();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("암호화", () => {
  it("왕복 복호화, 다른 암호키로는 실패", () => {
    const enc = store.encryptValue("비밀-값-123");
    expect(enc.ciphertext).not.toContain("비밀");
    expect(store.decryptValue(enc)).toBe("비밀-값-123");
    const saved = process.env.APP_SESSION_SECRET;
    process.env.APP_SESSION_SECRET = "another-secret-another-secret-12";
    expect(() => store.decryptValue(enc)).toThrow();
    process.env.APP_SESSION_SECRET = saved;
  });
});

describe("연결 키 API", () => {
  it("저장 후 값은 응답하지 않고(비밀값), 비밀이 아닌 값만 표시", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    expect((await agent.put("/api/secrets/NAVER_CLIENT_SECRET").set(H).send({ value: "naver-secret-XYZ" })).status).toBe(200);
    expect((await agent.put("/api/secrets/NAVER_CLIENT_ID").set(H).send({ value: "naver-id-ABC" })).status).toBe(200);
    const r = await agent.get("/api/secrets");
    const text = JSON.stringify(r.body);
    expect(text).not.toContain("naver-secret-XYZ");
    const sec = r.body.statuses.find((s: { key: string }) => s.key === "NAVER_CLIENT_SECRET");
    const id = r.body.statuses.find((s: { key: string }) => s.key === "NAVER_CLIENT_ID");
    expect([sec.source, sec.value]).toEqual(["screen", null]);
    expect([id.source, id.value]).toEqual(["screen", "naver-id-ABC"]);
    // DB에는 암호문만
    const raw = await getPool().query("select ciphertext from stored_secrets where key = 'NAVER_CLIENT_SECRET'");
    expect(raw.rows[0].ciphertext).not.toContain("naver-secret");
    // 감사 기록에도 값 없음
    const audit = await getPool().query("select detail::text from audit_logs where entity = 'secret'");
    expect(JSON.stringify(audit.rows)).not.toContain("naver-secret-XYZ");
    // 연결 상태에 즉시 반영
    expect((await agent.get("/api/status")).body.integrations.naver).toBe(true);
  });

  it("Render 환경변수가 있으면 그 값이 우선, 화면 입력은 거부", async () => {
    const { agent, csrf } = await login(app);
    const r = await agent.put("/api/secrets/TELEGRAM_BOT_TOKEN").set("x-csrf-token", csrf).send({ value: "screen-token" });
    expect(r.status).toBe(409);
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe("env-token-from-render");
    const s = (await agent.get("/api/secrets")).body.statuses.find((x: { key: string }) => x.key === "TELEGRAM_BOT_TOKEN");
    expect(s.source).toBe("environment");
  });

  it("허용되지 않은 이름·로그인 없는 요청 거부", async () => {
    const { agent, csrf } = await login(app);
    expect((await agent.put("/api/secrets/APP_DATABASE_URL").set("x-csrf-token", csrf).send({ value: "x" })).status).toBe(400);
    expect((await agent.put("/api/secrets/IG_UNKNOWN_CHANNEL_ACCESS_TOKEN").set("x-csrf-token", csrf).send({ value: "x" })).status).toBe(400);
    expect((await agent.put("/api/secrets/TG_OPPORTUNITIES_CHAT_ID").set("x-csrf-token", csrf).send({ value: "@ch" })).status).toBe(200);
    expect((await request(app).get("/api/secrets")).status).toBe(401);
    expect((await agent.put("/api/secrets/NAVER_CLIENT_ID").send({ value: "x" })).status).toBe(403); // CSRF 없음
  });

  it("재시작(워커 시작)하면 DB 값을 다시 불러옴", async () => {
    // 새 프로세스처럼: 화면 입력값은 아직 환경변수에 없음
    for (const k of ["NAVER_CLIENT_SECRET", "NAVER_CLIENT_ID", "TG_OPPORTUNITIES_CHAT_ID"]) delete process.env[k];
    store.__setOriginalEnvForTest(Object.keys(process.env).filter((k) => process.env[k]));
    const r = await store.loadStoredSecrets(getDb());
    expect(r.loaded).toBe(3);
    expect(process.env.NAVER_CLIENT_ID).toBe("naver-id-ABC");
    expect(process.env.NAVER_CLIENT_SECRET).toBe("naver-secret-XYZ");
  });

  it("연결 확인: 네이버 인증 실패/성공 메시지", async () => {
    const { agent, csrf } = await login(app);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const bad = await agent.post("/api/secrets/test/naver").set("x-csrf-token", csrf).send({});
    expect(bad.body.ok).toBe(false);
    expect(bad.body.message).toMatch(/인증 실패/);
    vi.stubGlobal("fetch", async () => naverResponse([{ title: "t", description: "d", link: "https://n.news.naver.com/1", originallink: "https://a.example/1", pubDate: "Mon, 28 Sep 2026 10:00:00 +0900" }]));
    const ok = await agent.post("/api/secrets/test/naver").set("x-csrf-token", csrf).send({});
    expect(ok.body.ok).toBe(true);
    const list = await agent.get("/api/secrets");
    expect(list.body.tests.naver.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it("지우기", async () => {
    const { agent, csrf } = await login(app);
    expect((await agent.delete("/api/secrets/NAVER_CLIENT_ID").set("x-csrf-token", csrf)).status).toBe(200);
    expect(process.env.NAVER_CLIENT_ID).toBeUndefined();
    expect((await agent.get("/api/status")).body.integrations.naver).toBe(false);
  });
});
