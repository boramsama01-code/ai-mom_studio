/** Real PostgreSQL integration: run only against the isolated TEST_DATABASE_URL used by CI. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { sourceDocuments } from "../shared/schema";
import { sha256 } from "../server/services/text";
import { persistSourceFetchAttempt } from "../server/services/sourceFetchPersistence";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const body = "이미 확보한 정상 원문을 최신 재수집 실패가 지우면 안 됩니다. ".repeat(10);
const success = { ok: true as const, finalUrl: "https://press.example/article/1", title: "정상 주기사", text: body, hash: sha256(body), attachments: [], contentKind: "html" as const };
const failure = { ok: false as const, status: "blocked" as const, error: "HTTP 403 — 원문 직접 확인 필요" };

describe("shared source cache result concurrency", () => {
  beforeAll(resetDb);
  afterAll(closeDb);
  async function fixture() {
    const url = `https://press.example/article/${crypto.randomUUID()}`;
    const [doc] = await getDb().insert(sourceDocuments).values({ normalizedUrl: url, originalUrl: url, title: "수집 제목", kind: "rss_direct" }).returning();
    return doc;
  }

  it("preserves the latest good body when a second channel's earlier request fails late", async () => {
    const doc = await fixture(), older = new Date("2026-11-01T01:00:00Z"), newer = new Date("2026-11-01T01:00:01Z");
    const saved = await persistSourceFetchAttempt(getDb(), doc.id, success, { attemptStartedAt: newer, attemptedAt: new Date("2026-11-01T01:00:02Z") });
    expect(saved.changed).toBe(true);
    const late = await persistSourceFetchAttempt(getDb(), doc.id, failure, { attemptStartedAt: older, attemptedAt: new Date("2026-11-01T01:00:03Z") });
    expect(late).toMatchObject({ changed: false, preservedBody: true, hasUsableBody: true, staleAttempt: true });
    const [current] = await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id, doc.id));
    expect(current).toMatchObject({ fetchStatus: "ok", fetchedText: body, contentHash: success.hash, fetchError: null, meta: { finalUrl: success.finalUrl, lastFetchAttemptStatus: "ok" } });
  });

  it("merges a newer failed attempt into metadata without replacing good body status/hash", async () => {
    const doc = await fixture();
    await persistSourceFetchAttempt(getDb(), doc.id, success, { attemptStartedAt: new Date("2026-11-01T01:00:00Z"), attemptedAt: new Date("2026-11-01T01:00:01Z") });
    const saved = await persistSourceFetchAttempt(getDb(), doc.id, failure, { attemptStartedAt: new Date("2026-11-01T01:00:02Z"), attemptedAt: new Date("2026-11-01T01:00:03Z") });
    expect(saved).toMatchObject({ changed: false, preservedBody: true, hasUsableBody: true, staleAttempt: false });
    expect(saved.document).toMatchObject({ fetchStatus: "ok", fetchedText: body, contentHash: success.hash, meta: { finalUrl: success.finalUrl, lastFetchAttemptStatus: "blocked", lastFetchAttemptError: failure.error } });
  });

  it("serializes concurrent successful and failed attempts and retains the newer good result", async () => {
    const doc = await fixture();
    await Promise.all([
      persistSourceFetchAttempt(getDb(), doc.id, failure, { attemptStartedAt: new Date("2026-11-01T01:00:00Z"), attemptedAt: new Date("2026-11-01T01:00:03Z") }),
      persistSourceFetchAttempt(getDb(), doc.id, success, { attemptStartedAt: new Date("2026-11-01T01:00:01Z"), attemptedAt: new Date("2026-11-01T01:00:02Z") }),
    ]);
    const [current] = await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id, doc.id));
    expect(current).toMatchObject({ fetchStatus: "ok", fetchedText: body, contentHash: success.hash, meta: { lastFetchAttemptStatus: "ok" } });
  });

  it("does not let a slow older success overwrite a newer article correction", async () => {
    const doc = await fixture(), corrected = "정정된 원문의 조건입니다. ".repeat(15);
    await persistSourceFetchAttempt(getDb(), doc.id, { ...success, text: corrected, hash: sha256(corrected) }, { attemptStartedAt: new Date("2026-11-01T01:00:01Z"), attemptedAt: new Date("2026-11-01T01:00:02Z") });
    const old = await persistSourceFetchAttempt(getDb(), doc.id, success, { attemptStartedAt: new Date("2026-11-01T01:00:00Z"), attemptedAt: new Date("2026-11-01T01:00:03Z") });
    expect(old).toMatchObject({ changed: false, staleAttempt: true, document: { fetchedText: corrected, contentHash: sha256(corrected) } });
  });

  it("keeps an older successful response if a newer failed request has not acquired any body", async () => {
    const doc = await fixture();
    await persistSourceFetchAttempt(getDb(), doc.id, failure, { attemptStartedAt: new Date("2026-11-01T01:00:01Z"), attemptedAt: new Date("2026-11-01T01:00:02Z") });
    const recovered = await persistSourceFetchAttempt(getDb(), doc.id, success, { attemptStartedAt: new Date("2026-11-01T01:00:00Z"), attemptedAt: new Date("2026-11-01T01:00:03Z") });
    expect(recovered).toMatchObject({ changed: true, staleAttempt: false, hasUsableBody: true, document: { fetchStatus: "ok", fetchedText: body, meta: { lastFetchAttemptStatus: "blocked", lastFetchAttemptError: failure.error } } });
  });
});
