/**
 * 통합 테스트 준비 — TEST_DATABASE_URL(없으면 로컬 spacepenguin_test)을 비우고 마이그레이션·시드를 다시 적용
 */
import bcrypt from "bcryptjs";
import request from "supertest";

export const TEST_PASSWORD = "test-password-123";

export function setTestEnv() {
  process.env.APP_ENV = "test";
  process.env.APP_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@127.0.0.1:5433/spacepenguin_test";
  process.env.APP_SESSION_SECRET = "test-session-secret-test-session-secret";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
  process.env.APP_BASE_URL = "http://127.0.0.1";
  process.env.DRY_RUN = "true";
  process.env.AUTO_PUBLISH = "false";
  process.env.AUTO_GENERATE = "false";
  process.env.COLLECT_REVIEW_NOTIFICATIONS = "false";
  process.env.INLINE_WORKER = "false";
  process.env.NAVER_CLIENT_ID = "test-id";
  process.env.NAVER_CLIENT_SECRET = "test-secret";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.APP_PRIVATE_LINK_SHA256;
  delete process.env.APP_CANONICAL_REDIRECT_URL;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.TELEGRAM_REVIEW_CHAT_ID;
}

export async function resetDb() {
  const { getPool, getDb } = await import("../server/db");
  await getPool().query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  const { runMigrations } = await import("../server/migrate");
  await runMigrations();
  const { seedIfNeeded } = await import("../server/seed");
  await seedIfNeeded(getDb());
}

export async function login(app: import("express").Express) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").send({ username: "admin", password: TEST_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  return { agent, csrf: r.body.csrf as string };
}

/** 네이버 검색 응답 흉내(문서의 필드 형식) */
export function naverResponse(items: Array<Record<string, string>>) {
  return new Response(JSON.stringify({ total: items.length, start: 1, display: items.length, items }), { status: 200, headers: { "content-type": "application/json" } });
}


