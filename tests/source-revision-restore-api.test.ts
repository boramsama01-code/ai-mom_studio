import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { emptyPayload } from "../shared/payloads";
import { approvals, auditLogs, contentItems, contentRevisions, contentSources, deliveries, destinations, mediaAssets, sourceDocuments } from "../shared/schema";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { login, resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const { createRevision } = await import("../server/content");
const app = createApp();
const outbound = vi.fn(() => { throw new Error("Revision restore tests must not call external services"); });

// PostgreSQL integration tests: run serially with the shared test schema, never production.
beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture(kind: "science_dialogue" | "notice" = "science_dialogue") {
  const channelId = kind === "notice" ? 1 : 2;
  const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf };
  const id = randomUUID();
  const db = getDb();
  const [source] = await db.insert(sourceDocuments).values({
    normalizedUrl: `https://example.invalid/revision/${id}`, originalUrl: `https://example.invalid/revision/${id}`,
    kind: "manual", title: "보존할 원문 제목", fetchedText: "이미 확보한 정상 본문을 복원 작업이 바꾸지 않습니다.", fetchStatus: "ok",
  }).returning();
  const result = await db.transaction(async tx => {
    const [created] = await tx.insert(contentItems).values({ channelId, kind, origin: "manual", primarySourceId: source.id, title: "현재 제목", relevance: "relevant" }).returning();
    await tx.insert(contentSources).values({ contentItemId: created.id, sourceDocumentId: source.id, role: "primary" });
    const oldPayload = {
      ...emptyPayload(kind, "과거 제목"),
      ...(kind === "science_dialogue" ? { key_question: "과거에 저장한 질문", scientific_basis: "과거 근거의 공백  \n다음 줄" } : {
        relevance: "relevant", category: "STEM 캠프", school_type: "org", audience: "  과거 대상의 앞뒤 공백  ",
        schedules: [{ kind: "apply", start: { date: "2001-01-01" }, end: { date: "2001-01-02" }, raw: "지난 접수 일정" }], deadline_type: "fixed",
      }),
      cardCopy: cardCopyFixture("set:n01-blue"),
      historical_extra: { note: "스키마에서 제거하지 않고 보존할 이전 필드" },
    };
    oldPayload.cardCopy.cover.title = "이전 카드의 표지";
    const old = await createRevision(tx, { contentItemId: created.id, author: "operator", payload: oldPayload });
    const currentPayload = { ...structuredClone(oldPayload), ...(kind === "science_dialogue" ? { key_question: "현재 원고의 질문", scientific_basis: "나중에 수정한 근거" } : { title: "현재 원고 제목", category: "STEM 대회", schedules: [] }), cardCopy: cardCopyFixture("set:n03") };
    currentPayload.cardCopy.cover.title = "나중에 수정한 표지";
    const current = await createRevision(tx, { contentItemId: created.id, author: "operator", payload: currentPayload });
    const [item] = await tx.update(contentItems).set({ version: 2, edited: currentPayload, reviewStatus: "reviewed", evidenceStatus: "official_confirmed", scheduleStatus: "open", category: "STEM 대회" }).where(eq(contentItems.id, created.id)).returning();
    return { item, old, current };
  });
  const endpoint = `/api/channels/${channelId}/items/${result.item.id}`;
  return { agent, H, endpoint, restore: `${endpoint}/revisions/${result.old.id}/restore`, source, ...result };
}

async function publication(f: Awaited<ReturnType<typeof fixture>>) {
  const db = getDb();
  const [asset] = await db.insert(mediaAssets).values({ channelId: f.item.channelId, contentItemId: f.item.id, revisionId: f.current.id, sha256: `restoration-fixture-${f.item.id}`, bytes: Buffer.from("fixture-image-immutable"), width: 1, height: 1 }).returning();
  const [approval] = await db.insert(approvals).values({ channelId: f.item.channelId, contentItemId: f.item.id, revisionId: f.current.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: { instagram: "기존 승인 스냅샷", telegram: "" }, scheduledAt: new Date("2035-01-01T00:30:00Z"), approvedBy: "test" }).returning();
  const rows = [];
  for (const status of ["scheduled", "waiting", "processing", "unknown", "succeeded"]) {
    const [destination] = await db.insert(destinations).values({ channelId: f.item.channelId, platform: "instagram", label: `restore-${f.item.id}-${status}`, enabled: false }).returning();
    const [delivery] = await db.insert(deliveries).values({ channelId: f.item.channelId, approvalId: approval.id, destinationId: destination.id, status,
      ...(status === "succeeded" ? { externalId: "fixture-published-id", externalUrl: "https://example.invalid/published" } : {}),
      ...(status === "unknown" ? { externalContainerId: "fixture-container", needsReconciliation: true } : {}),
      ...(status === "processing" ? { phase: "dispatching", leaseToken: "fixture-lease", leaseOwner: "fixture-worker", leaseExpiresAt: new Date("2035-01-01T00:30:00Z") } : {}),
    }).returning();
    rows.push(delivery);
  }
  return { asset, approval, rows };
}

describe("source revision restoration on real PostgreSQL", () => {
  it("copies exact historical source and card text into a new revision, retaining the current draft, source and publication settings", async () => {
    const f = await fixture(), db = getDb();
    const draft = { version: 7, captions: { instagram: "지금 보관한 캡션", telegram: "보조 캡션" }, options: { destinationIds: [31, 42], timing: "later" as const, scheduledAtKst: "2035-01-01T09:30" } };
    await db.update(contentItems).set({ publicationDraft: draft, excluded: true, excludedReason: "운영자 제외 유지" }).where(eq(contentItems.id, f.item.id));
    // Non-current AI suggestions also occupy revision numbers. Restoring must append after all of them.
    const proposal = await createRevision(db, { contentItemId: f.item.id, author: "llm", payload: { ...f.current.payload, key_question: "아직 채택하지 않은 AI 제안" }, makeCurrent: false });
    const beforeLinks = await db.select().from(contentSources).where(eq(contentSources.contentItemId, f.item.id));
    const response = await f.agent.post(f.restore).set(f.H).send({ version: f.item.version });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ previousRevisionId: f.current.id, restoredFrom: { id: f.old.id, revisionNo: f.old.revisionNo }, item: { version: 3, reviewStatus: "review_required", evidenceStatus: "needs_review", publicationDraft: draft, excluded: true, excludedReason: "운영자 제외 유지" } });
    expect(response.body.revision.id).not.toBe(f.old.id);
    expect(response.body.revision.id).not.toBe(f.current.id);
    expect(response.body.revision).toMatchObject({ revisionNo: proposal.revisionNo + 1, author: "operator", payload: f.old.payload, model: null, usage: null });
    expect(response.body.item.currentRevisionId).toBe(response.body.revision.id);
    expect(response.body.item.edited).toEqual(f.old.payload);
    expect(response.body.item.title).toBe(f.old.payload.key_question);
    for (const original of [f.old, f.current, proposal]) expect((await db.select().from(contentRevisions).where(eq(contentRevisions.id, original.id)))[0]).toEqual(original);
    expect((await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, f.source.id)))[0]).toEqual(f.source);
    expect(await db.select().from(contentSources).where(eq(contentSources.contentItemId, f.item.id))).toEqual(beforeLinks);
    expect((await f.agent.get(`${f.endpoint}/revisions/${f.current.id}`)).body.payload).toEqual(f.current.payload);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "restore_revision"), eq(auditLogs.entityId, String(f.item.id))));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor: "admin", detail: { restoredFromRevisionId: f.old.id, previousRevisionId: f.current.id, revisionId: response.body.revision.id } });
  });

  it("invalidates old approval, cancels only queued destinations and retains immutable old images and dispatched evidence", async () => {
    const f = await fixture(), p = await publication(f), db = getDb();
    const response = await f.agent.post(f.restore).set(f.H).send({ version: f.item.version });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [approval] = await db.select().from(approvals).where(eq(approvals.id, p.approval.id));
    expect(approval.status).toBe("invalidated");
    expect(approval.captions).toEqual(p.approval.captions);
    for (const original of p.rows) {
      const [row] = await db.select().from(deliveries).where(eq(deliveries.id, original.id));
      if (["waiting", "scheduled"].includes(original.status)) expect(row).toMatchObject({ status: "cancelled", errorKind: "approval_required" });
      else expect(row).toEqual(original);
    }
    const images = await db.select().from(mediaAssets).where(eq(mediaAssets.contentItemId, f.item.id));
    expect(images).toEqual([p.asset]);
    expect(images.every(asset => asset.revisionId !== response.body.item.currentRevisionId)).toBe(true);
    const detail = (await f.agent.get(f.endpoint)).body;
    expect(detail.deliveries.some((row: any) => row.d.status === "unknown")).toBe(true);
    expect(detail.deliveries.some((row: any) => row.d.status === "processing")).toBe(true);
  });

  it("allows exactly one concurrent restore at the same content version", async () => {
    const f = await fixture();
    const results = await Promise.all([1, 2].map(() => f.agent.post(f.restore).set(f.H).send({ version: f.item.version })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const revisions = await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id));
    expect(revisions).toHaveLength(3);
    expect(new Set(revisions.map(revision => revision.revisionNo)).size).toBe(3);
    const current = (await f.agent.get(f.endpoint)).body;
    expect(current.current.id).toBe(results.find(result => result.status === 200)!.body.revision.id);
    expect(current.item.version).toBe(f.item.version + 1);
  });

  it("serializes restore against a simultaneous source edit without losing the winning version", async () => {
    const f = await fixture();
    const editPayload = { ...f.current.payload, scientific_basis: "같은 버전에서 운영자가 직접 수정한 근거" };
    const [restored, edited] = await Promise.all([
      f.agent.post(f.restore).set(f.H).send({ version: f.item.version }),
      f.agent.patch(f.endpoint).set(f.H).send({ version: f.item.version, payload: editPayload }),
    ]);
    expect([restored.status, edited.status].sort()).toEqual([200, 409]);
    const detail = (await f.agent.get(f.endpoint)).body;
    expect(detail.revisions).toHaveLength(3);
    expect(detail.item.version).toBe(f.item.version + 1);
    if (restored.status === 200) expect(detail.current.payload).toEqual(f.old.payload);
    else expect(detail.current.payload.scientific_basis).toBe(editPayload.scientific_basis);
    expect((await f.agent.get(`${f.endpoint}/revisions/${f.current.id}`)).body.payload).toEqual(f.current.payload);
  });

  it("rejects unauthenticated, CSRF-less and cross-item/channel restore without creating a version", async () => {
    const f = await fixture(), other = await fixture();
    const body = { version: f.item.version };
    expect((await request(app).post(f.restore).send(body)).status).toBe(401);
    expect((await f.agent.post(f.restore).send(body)).status).toBe(403);
    expect((await f.agent.post(f.restore.replace("/channels/2/", "/channels/1/")).set(f.H).send(body)).status).toBe(404);
    expect((await f.agent.post(`${f.endpoint}/revisions/${other.old.id}/restore`).set(f.H).send(body)).status).toBe(404);
    expect((await f.agent.post(f.restore).set(f.H).send({ ...body, payload: {} })).status).toBe(400);
    expect((await f.agent.post(f.restore).set(f.H).send({ version: 0 })).status).toBe(400);
    const after = (await f.agent.get(f.endpoint)).body;
    expect(after.item.version).toBe(f.item.version);
    expect(after.current.payload).toEqual(f.current.payload);
    expect(after.revisions).toHaveLength(2);
  });

  it("does not alter anything for the current revision, invalid legacy payload or stale expected version", async () => {
    const f = await fixture(), db = getDb();
    const before = (await f.agent.get(f.endpoint)).body;
    expect((await f.agent.post(`${f.endpoint}/revisions/${f.current.id}/restore`).set(f.H).send({ version: f.item.version })).status).toBe(409);
    expect((await f.agent.post(f.restore).set(f.H).send({ version: f.item.version - 1 })).status).toBe(409);
    const legacy = await createRevision(db, { contentItemId: f.item.id, author: "system", payload: { old_format: "기록은 읽을 수 있지만 현재 스키마에 맞지 않음" }, makeCurrent: false });
    expect((await f.agent.get(`${f.endpoint}/revisions/${legacy.id}`)).body.payload).toEqual(legacy.payload);
    const invalid = await f.agent.post(`${f.endpoint}/revisions/${legacy.id}/restore`).set(f.H).send({ version: f.item.version });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(422);
    const after = (await f.agent.get(f.endpoint)).body;
    expect(after.item).toEqual(before.item);
    expect(after.current).toEqual(before.current);
    expect(after.revisions).toHaveLength(3); // only the deliberately inserted legacy record
  });

  it("recomputes notice category and present-day schedule status while preserving exact historical payload strings", async () => {
    const f = await fixture("notice");
    const restored = await f.agent.post(f.restore).set(f.H).send({ version: f.item.version });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.item).toMatchObject({ category: "STEM 캠프", schoolType: "org", relevance: "relevant", scheduleStatus: "closed", reviewStatus: "review_required" });
    expect(restored.body.revision.payload.audience).toBe("  과거 대상의 앞뒤 공백  ");
    expect(restored.body.revision.payload).toEqual(f.old.payload);
  });
});
