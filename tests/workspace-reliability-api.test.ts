import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { login, resetDb, setTestEnv } from "./helpers";
import { emptyPayload } from "../shared/payloads";
import { approvals, contentItems, contentRevisions, deliveries, destinations, mediaAssets, studioCards } from "../shared/schema";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const app = createApp();
const outbound = vi.fn(() => { throw new Error("Workspace regression must not call external services"); });
beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture() {
  const { agent, csrf } = await login(app);
  const H = { "x-csrf-token": csrf };
  const created = await agent.post("/api/channels/2/items").set(H).send({ title: "저장 보존 회귀 자료" });
  expect(created.status).toBe(201);
  const endpoint = `/api/channels/2/items/${created.body.id}`;
  const detail = (await agent.get(endpoint)).body;
  return { agent, H, endpoint, item: detail.item, current: detail.current };
}

async function scheduled(f: Awaited<ReturnType<typeof fixture>>, label = "격리 대상") {
  const db = getDb();
  const [asset] = await db.insert(mediaAssets).values({ channelId: 2, contentItemId: f.item.id, revisionId: f.current.id, sha256: `fixture-${f.item.id}`, bytes: Buffer.from("fixture-only"), width: 1, height: 1 }).returning();
  const [approval] = await db.insert(approvals).values({ channelId: 2, contentItemId: f.item.id, revisionId: f.current.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: { instagram: "이전 캡션", telegram: "" }, scheduledAt: new Date("2026-11-04T00:30:00Z"), approvedBy: "test" }).returning();
  const [destination] = await db.insert(destinations).values({ channelId: 2, platform: "instagram", label: `${label}-${f.item.id}`, enabled: false }).returning();
  const [delivery] = await db.insert(deliveries).values({ channelId: 2, approvalId: approval.id, destinationId: destination.id, status: "scheduled" }).returning();
  await db.update(contentItems).set({ reviewStatus: "reviewed", publishStatus: "scheduled" }).where(eq(contentItems.id, f.item.id));
  return { approval, delivery, asset };
}

describe("persistent editing contracts on PostgreSQL", () => {
  it("saves captions without approval and preserves them when the editor is reopened", async () => {
    const f = await fixture();
    const captions = { instagram: "직접 쓴 게시물 설명\n다음 줄도 보존", telegram: "보조 계정 설명" };
    const result = await f.agent.patch(`${f.endpoint}/publication-draft`).set(f.H).send({ version: 0, captions });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toEqual({ version: 1, captions });
    const reopened = (await f.agent.get(f.endpoint)).body;
    expect(reopened.publicationDraft).toEqual(result.body);
    expect(reopened.current.id).toBe(f.current.id);
    expect(reopened.item.version).toBe(f.item.version);
    expect(reopened.approvals).toHaveLength(0);
    expect((await f.agent.patch(`${f.endpoint}/publication-draft`).send({ version: 1, captions })).status).toBe(403);
    expect((await f.agent.patch(f.endpoint.replace("/channels/2/", "/channels/1/") + "/publication-draft").set(f.H).send({ version: 1, captions })).status).toBe(404);
  });

  it("allows only one concurrent caption save at the same version", async () => {
    const f = await fixture();
    const responses = await Promise.all(["첫 번째", "두 번째"].map(instagram => f.agent.patch(`${f.endpoint}/publication-draft`).set(f.H).send({ version: 0, captions: { instagram, telegram: "" } })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winning = responses.find(r => r.status === 200)!;
    expect((await f.agent.get(f.endpoint)).body.publicationDraft).toEqual(winning.body);
  });

  it("caption changes revoke a pending approval in the same transaction", async () => {
    const f = await fixture(), pending = await scheduled(f);
    const saved = await f.agent.patch(`${f.endpoint}/publication-draft`).set(f.H).send({ version: 0, captions: { instagram: "수정한 캡션", telegram: "" } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await getDb().select().from(approvals).where(eq(approvals.id, pending.approval.id)))[0].status).toBe("invalidated");
    expect((await getDb().select().from(deliveries).where(eq(deliveries.id, pending.delivery.id)))[0].status).toBe("cancelled");
  });

  it.each(["held", "rejected", "pending"])("review %s revokes waiting publication", async status => {
    const f = await fixture(), pending = await scheduled(f);
    const saved = await f.agent.post(`${f.endpoint}/review`).set(f.H).send({ version: f.item.version, status });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await getDb().select().from(deliveries).where(eq(deliveries.id, pending.delivery.id)))[0].status).toBe("cancelled");
    expect((await getDb().select().from(approvals).where(eq(approvals.id, pending.approval.id)))[0].status).toBe("invalidated");
  });

  it("single exclusion and bulk exclusion cancel pending deliveries", async () => {
    for (const bulk of [false, true]) {
      const f = await fixture(), pending = await scheduled(f);
      const response = bulk
        ? await f.agent.post("/api/channels/2/items/bulk").set(f.H).send({ ids: [f.item.id], action: "exclude" })
        : await f.agent.post(`${f.endpoint}/exclude`).set(f.H).send({ version: f.item.version, excluded: true });
      expect(response.status).toBe(200);
      expect((await getDb().select().from(deliveries).where(eq(deliveries.id, pending.delivery.id)))[0].status).toBe("cancelled");
    }
  });

  it("starts a manual draft once after failed AI and lists it before any rendering", async () => {
    const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf };
    const [item] = await getDb().insert(contentItems).values({ channelId: 2, kind: "science_dialogue", title: "AI 없이 직접 쓰기", relevance: "relevant" }).returning();
    const endpoint = `/api/channels/2/items/${item.id}/draft`;
    const responses = await Promise.all([agent.post(endpoint).set(H).send({ version: item.version }), agent.post(endpoint).set(H).send({ version: item.version })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect(await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId, item.id))).toHaveLength(1);
    const board = (await agent.get("/api/studio/cards")).body.cards.find((card: any) => card.sourceItemId === item.id);
    expect(board).toMatchObject({ sourceReference: { itemId: item.id, channelId: 2 } });
    expect(board.sourceOutput).toBeUndefined();
  });

  it("a source PATCH cannot submit stale hidden card copy using a refreshed version", async () => {
    const f = await fixture();
    const copy = { version: 1, templateKey: "set:n03", cover: { title: "다른 편집기에서 저장한 최신 문구", subtitle: "" }, pages: [{ id: "body-1", title: "최신 카드", subtitle: "", body: "반드시 보존되어야 할 최신 카드 내용" }] };
    const savedCopy = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.H).send({ version: f.item.version, copy });
    expect(savedCopy.status, JSON.stringify(savedCopy.body)).toBe(200);
    const sourcePayload = { ...emptyPayload("science_dialogue", "원문 필드 수정"), key_question: "저장 충돌 이후 질문", cardCopy: { ...copy, cover: { title: "오래된 숨은 문구", subtitle: "" } } };
    const savedSource = await f.agent.patch(f.endpoint).set(f.H).send({ version: savedCopy.body.version, payload: sourcePayload });
    expect(savedSource.status, JSON.stringify(savedSource.body)).toBe(200);
    const detail = (await f.agent.get(f.endpoint)).body;
    expect(detail.current.payload.cardCopy).toEqual(copy);
    expect(detail.current.payload.key_question).toBe("저장 충돌 이후 질문");
  });
});

describe("publication list contracts", () => {
  it("repairs legacy undefined success IDs without resending or changing verified posts", async () => {
    const { repairLegacyPublicationResults } = await import("../server/services/legacyPublicationRepair");
    const f = await fixture(), pending = await scheduled(f, "잘못된 이전 완료");
    const db = getDb();
    await db.update(deliveries).set({ status: "succeeded", externalId: "undefined" }).where(eq(deliveries.id, pending.delivery.id));
    const verified = await fixture(), verifiedPending = await scheduled(verified, "운영자 확인 완료");
    await db.update(deliveries).set({ status: "succeeded", externalId: null, externalUrl: "https://www.instagram.com/p/verified-post/", outcomeSource: "operator_confirmed" }).where(eq(deliveries.id, verifiedPending.delivery.id));
    expect(await repairLegacyPublicationResults(db)).toBe(1);
    expect((await db.select().from(deliveries).where(eq(deliveries.id, pending.delivery.id)))[0]).toMatchObject({ status: "unknown", externalId: null, needsReconciliation: true });
    expect((await db.select().from(deliveries).where(eq(deliveries.id, verifiedPending.delivery.id)))[0].status).toBe("succeeded");
    expect(await repairLegacyPublicationResults(db)).toBe(0);
  });

  it("keeps an old unknown delivery visible after more than five newer approvals", async () => {
    const f = await fixture(), pending = await scheduled(f, "이전 결과 확인");
    const db = getDb();
    await db.update(approvals).set({ status: "invalidated" }).where(eq(approvals.id, pending.approval.id));
    await db.update(deliveries).set({ status: "unknown" }).where(eq(deliveries.id, pending.delivery.id));
    await db.insert(approvals).values(Array.from({ length: 6 }, () => ({
      channelId: 2, contentItemId: f.item.id, revisionId: f.current.id, mediaAssetId: pending.asset.id,
      cardSha256: pending.asset.sha256, captions: { instagram: "이후 취소한 승인", telegram: "" },
      status: "cancelled", scheduledAt: new Date("2026-11-05T00:30:00Z"), approvedBy: "test",
    })));
    const detail = (await f.agent.get(f.endpoint)).body;
    expect(detail.approvals.some((approval: any) => approval.id === pending.approval.id)).toBe(true);
    expect(detail.deliveries.find((row: any) => row.d.id === pending.delivery.id).d.status).toBe("unknown");
    expect(detail.canonicalStudioCardId).toBeGreaterThan(0);
  });

  it("returns filtered totals and later pages beyond 100 deliveries with canonical editor links", async () => {
    const f = await fixture(), pending = await scheduled(f, "페이지 조회");
    const db = getDb();
    await db.update(approvals).set({ scheduledAt: new Date("2026-11-07T00:30:00Z") }).where(eq(approvals.id, pending.approval.id));
    const targets = await db.insert(destinations).values(Array.from({ length: 124 }, (_, i) => ({ channelId: 2, platform: "instagram", label: `paged-${f.item.id}-${i}`, enabled: false }))).returning({ id: destinations.id });
    await db.insert(deliveries).values(targets.map((target, i) => ({ channelId: 2, approvalId: pending.approval.id, destinationId: target.id, status: i < 121 ? "failed" : "succeeded" })));
    const response = await f.agent.get("/api/deliveries").query({ channelId: 2, status: "failed", from: "2026-11-07", to: "2026-11-07", page: 5, pageSize: 30 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ total: 121, page: 5, pageSize: 30, counts: { failed: 121, succeeded: 3 } });
    expect(response.body.items).toHaveLength(1);
    const [board] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, f.item.id));
    expect(response.body.items[0].canonicalStudioCardId).toBe(board.id);
    expect(response.body.items.every((row: any) => row.d.status === "failed")).toBe(true);
    expect((await f.agent.get("/api/deliveries").query({ channelId: 2, page: 1, from: "2026-11-05", to: "2026-11-04" })).status).toBe(400);
  });

  it("includes late-result reconciliation flags in attention filters while the current attempt is still processing", async () => {
    const f = await fixture(), pending = await scheduled(f, "늦은 응답");
    await getDb().update(approvals).set({ scheduledAt: new Date("2026-11-08T00:00:00Z") }).where(eq(approvals.id, pending.approval.id));
    await getDb().update(deliveries).set({ status: "processing", needsReconciliation: true }).where(eq(deliveries.id, pending.delivery.id));
    const result = await f.agent.get("/api/deliveries").query({ channelId: 2, page: 1, status: "unknown", from: "2026-11-08", to: "2026-11-08" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ total: 1, counts: { processing: 1, needsAttention: 1 } });
    expect(result.body.items[0].d).toMatchObject({ id: pending.delivery.id, status: "processing", needsReconciliation: true });
  });
});
