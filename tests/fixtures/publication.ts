import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { approvals, channels, contentItems, contentRevisions, deliveries, deliveryAttempts, destinations, mediaAssets, type Delivery } from "../../shared/schema";
import { getDb } from "../../server/db";
import { sha256 } from "../../server/services/text";

let sequence = 0;
export const publicationAccounts = new Map<string, { userId: string; username: string }>();

/** Actual PostgreSQL rows, isolated by resetDb; all outbound adapters are mocked by the test. */
export async function publicationFixture(status = "scheduled", platform = "instagram") {
  const db = getDb(), number = ++sequence, slug = `pub-fixture-${number}`;
  const [channel] = await db.insert(channels).values({ slug, name: `게시 테스트 ${number}`, contentType: "current_dialogue", accentColor: "#334455",
    budget: { naverCallsPerRun: 0, resultsPerRun: 0, fetchTargetsPerRun: 0, fetchCallsPerRun: 0, llmCallsPerRun: 0, dailyPublishLimit: 100 } }).returning();
  const userId = String(100000 + channel.id), username = `publication_${channel.id}`, token = `test-only-token-${channel.id}`;
  const prefix = `IG_PUB_FIXTURE_${number}`, tgPrefix = `TG_PUB_FIXTURE_${number}`;
  process.env[`${prefix}_ACCESS_TOKEN`] = token; process.env[`${prefix}_USER_ID`] = userId;
  process.env[`${tgPrefix}_CHAT_ID`] = `@${username}`;
  publicationAccounts.set(token, { userId, username });
  const [destination] = await db.insert(destinations).values({ channelId: channel.id, platform, label: `@${username}`, enabled: true,
    secretRefs: platform === "instagram" ? { accessToken: `${prefix}_ACCESS_TOKEN`, userId: `${prefix}_USER_ID` } : { chatId: `${tgPrefix}_CHAT_ID` } }).returning();
  const [item] = await db.insert(contentItems).values({ channelId: channel.id, kind: "current_dialogue", origin: "manual", title: "승인한 원고", reviewStatus: "reviewed", relevance: "relevant", publishStatus: status, isSample: true }).returning();
  const [revision] = await db.insert(contentRevisions).values({ contentItemId: item.id, revisionNo: 1, author: "operator", payload: { title: "승인한 원고", summary: "테스트 본문" } }).returning();
  await db.update(contentItems).set({ currentRevisionId: revision.id }).where(eq(contentItems.id, item.id)); item.currentRevisionId = revision.id;
  const bytes = Buffer.from(`isolated-test-image-${item.id}`);
  const [asset] = await db.insert(mediaAssets).values({ channelId: channel.id, contentItemId: item.id, revisionId: revision.id, sha256: sha256(bytes), bytes, width: 1080, height: 1350, cloudinaryUrl: "https://example.com/approved-test.jpg" }).returning();
  const [approval] = await db.insert(approvals).values({ channelId: channel.id, contentItemId: item.id, revisionId: revision.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: { instagram: "승인된 게시 캡션", telegram: "승인된 게시 캡션", altTexts: ["승인된 카드 설명."] }, scheduledAt: new Date(Date.now() - 1000), approvedBy: "test" }).returning();
  const snapshot = { version: 1 as const, destinationId: destination.id, destinationVersion: destination.version, platform, label: destination.label, accountId: platform === "instagram" ? userId : String(-100000 - channel.id), username, verifiedAt: new Date().toISOString(),
    ...(platform === "instagram" ? { authMode: "instagram" as const } : { configuredAddress: `@${username}` }) };
  const [delivery] = await db.insert(deliveries).values({ channelId: channel.id, approvalId: approval.id, destinationId: destination.id, status, phase: status === "scheduled" ? "queued" : status === "unknown" ? "unknown" : "finished", destinationSnapshot: snapshot,
    attempts: 0, lastError: status === "failed" ? "fixture failure" : null }).returning();
  return { db, channel, destination, item, revision, asset, approval, delivery, userId, username, token,
    async read() { return (await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]; },
    async patch(value: Partial<Delivery>) { const [row] = await db.update(deliveries).set(value).where(eq(deliveries.id, delivery.id)).returning(); Object.assign(delivery, row); return row; },
  };
}

export async function expiredPublicationAttempt(f: Awaited<ReturnType<typeof publicationFixture>>, phase: string, extra: Partial<Delivery> = {}) {
  const attemptId = randomUUID();
  await f.db.insert(deliveryAttempts).values({ id: attemptId, deliveryId: f.delivery.id, attemptNo: 1, actor: "terminated-test-worker" });
  return f.patch({ status: "processing", attempts: 1, lastAttemptId: attemptId, leaseToken: randomUUID(), leaseOwner: "terminated-test-worker", leaseExpiresAt: new Date(Date.now() - 1000),
    phase, dispatchStartedAt: phase === "dispatching" ? new Date(Date.now() - 5000) : null, ...extra });
}
