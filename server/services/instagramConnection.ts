import { expectedInstagramUsername, instagramAccountMismatch, normalizeInstagramUsername } from "../../shared/channelInstagram";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db";
import { appSettings, channels, destinations } from "../../shared/schema";
import { defaultSecretRefs, resolveSecrets, slugToEnvPart } from "./secrets";
import { accountIdentity, publishingLimit, type InstagramAuthMode } from "./instagram";
import { isFromEnvironment, saveSecret } from "../secretStore";
import { HttpError } from "../routes/util";
import { audit } from "../audit";
import { testCloudinary } from "./connectionTest";
import { instagramDiagnostic, sanitizeInstagramDiagnostic } from "../../shared/instagramOAuthDiagnostics";
import { channelSlug } from "../../shared/channelKeys";
import { orderedChannels } from "./channelOrder";

export async function connectInstagram(db: DB, channelId: number, input: { token: string; username: string; /** Deprecated input accepted for older clients; never applies a cap. */ dailyLimit?: number; authMode?: InstagramAuthMode; expiresAt?: string | null }, actor: string) {
  const [ch] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!ch?.active) throw new HttpError(409, "사용 중인 채널을 선택하세요.", { diagnostic: { stage: "connection_validation" } });
  const intended = instagramAccountMismatch(ch.slug, input.username);
  if (intended) throw new HttpError(400, intended, { diagnostic: { stage: "connection_validation" } });
  const authMode = input.authMode ?? "instagram";
  const identity = await accountIdentity(input.token, authMode, input.username);
  if (!identity.ok) throw new HttpError(400, identity.error, { code: identity.reason, diagnostic: sanitizeInstagramDiagnostic(identity.diagnostic) });
  // Only the OAuth callback may omit a custom-channel hint. Manual token input
  // requires a username at its route, and accountIdentity admits no ambiguity.
  if (input.username && normalizeInstagramUsername(identity.username) !== normalizeInstagramUsername(input.username)) throw new HttpError(400, `이 토큰은 @${identity.username}의 토큰입니다. 게시하려는 계정과 일치하는지 확인하세요.`, { code: "account_mismatch", diagnostic: { stage: "account_profile" } });
  const mismatch = instagramAccountMismatch(ch.slug, identity.username);
  if (mismatch) throw new HttpError(409, mismatch, { diagnostic: { stage: "connection_validation" } });
  const quota = await publishingLimit(identity.userId, input.token, authMode);
  if (!quota.ok) throw new HttpError(400, `계정은 확인했지만 게시 API 접근이 거부됐습니다. 프로페셔널 계정과 ${authMode === "facebook" ? "instagram_content_publish" : "instagram_business_content_publish"} 권한을 확인하세요.`, { code: "publishing_permission", diagnostic: instagramDiagnostic("quota", "diagnostic" in quota ? quota.diagnostic : undefined, quota.lost) });
  const refs: Record<string, string> = { ...defaultSecretRefs("instagram", ch.slug), authMode: `IG_${slugToEnvPart(ch.slug)}_AUTH_MODE` };
  if (Object.values(refs).some(isFromEnvironment)) throw new HttpError(409, "서버 환경변수에서 관리하는 계정입니다. API 키 관리 화면에서 기존 연결을 확인하세요.", { diagnostic: { stage: "connection_validation" } });
  const activate: Array<() => void> = [];
  await db.transaction(async tx => {
    const [fresh] = await tx.select().from(channels).where(eq(channels.id, ch.id)).for("update");
    if (!fresh?.active) throw new HttpError(409, "사용 중인 채널을 선택하세요.", { diagnostic: { stage: "connection_validation" } });
    const others = await tx.select().from(destinations).where(and(eq(destinations.channelId, ch.id), eq(destinations.platform, "instagram"), eq(destinations.enabled, true)));
    if (others.some(other => normalizeInstagramUsername(other.label) !== normalizeInstagramUsername(identity.username))) throw new HttpError(409, "이미 다른 인스타그램 계정이 연결돼 있습니다. 채널 설정에서 기존 목적지를 확인하세요.", { diagnostic: { stage: "connection_validation" } });
    if (others.length > 1) throw new HttpError(409, "동일 계정의 활성 게시 목적지가 여러 개 있습니다. 채널 설정에서 사용할 목적지 하나를 확인한 뒤 다시 연결하세요.", { diagnostic: { stage: "connection_validation" } });
    activate.push(await saveSecret(tx as unknown as DB, refs.accessToken, input.token, actor, { activate: false }));
    activate.push(await saveSecret(tx as unknown as DB, refs.userId, identity.userId, actor, { activate: false }));
    activate.push(await saveSecret(tx as unknown as DB, refs.authMode, authMode, actor, { activate: false }));
    const existing = others[0];
    if (existing) {
      // Keep the same destination ID even if its old label has different casing
      // or omits @. A literal-label upsert would create another enabled row.
      await tx.update(destinations).set({ secretRefs: refs, enabled: true, version: existing.version + 1, updatedAt: new Date() }).where(eq(destinations.id, existing.id));
    } else {
      await tx.insert(destinations).values({ channelId: ch.id, platform: "instagram", label: `@${identity.username}`, secretRefs: refs, enabled: true })
        .onConflictDoUpdate({ target: [destinations.channelId, destinations.platform, destinations.label], set: { secretRefs: refs, enabled: true, updatedAt: new Date() } });
    }
    await tx.update(channels).set({ version: fresh.version + 1, updatedAt: new Date() }).where(eq(channels.id, ch.id));
    await tx.insert(appSettings).values({ key: `conn_test:instagram:${refs.accessToken}`, value: { ok: true, message: `@${identity.username} 계정 및 게시 API 접근 확인` } }).onConflictDoUpdate({ target: appSettings.key, set: { value: { ok: true, message: `@${identity.username} 계정 및 게시 API 접근 확인` }, updatedAt: new Date() } });
    const metadata = { authMode, username: identity.username, verifiedAt: new Date().toISOString(), expiresAt: input.expiresAt ?? null };
    await tx.insert(appSettings).values({ key: `instagram_connection:${ch.id}`, value: metadata }).onConflictDoUpdate({ target: appSettings.key, set: { value: metadata, updatedAt: new Date() } });
    await audit(tx, { actor, action: "connect_instagram", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { username: identity.username, authMode } });
  }).catch((error: unknown) => {
    // Keep validation/conflict messages and status codes unchanged for manual
    // connections. Unexpected save failures must not carry SQL, values or causes.
    if (error instanceof HttpError) {
      error.extra = { ...error.extra, diagnostic: sanitizeInstagramDiagnostic(error.extra?.diagnostic) ?? { stage: "persistence" } };
      throw error;
    }
    throw new HttpError(500, "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.", { code: "persistence_failed", diagnostic: { stage: "persistence" } });
  });
  for (const commit of activate) commit();
  return { username: identity.username, used: quota.used, total: quota.total, authMode };
}

/**
 * Read-only account and media-host checks; creates no Instagram containers or posts.
 * Image hosting is a separate publishing prerequisite, not Instagram authentication.
 */
export async function checkInstagramConnection(db: DB, channelId: number, destinationId: number) {
  const [ch] = await db.select().from(channels).where(eq(channels.id, channelId));
  const [dest] = await db.select().from(destinations).where(and(eq(destinations.id, destinationId), eq(destinations.channelId, channelId), eq(destinations.platform, "instagram")));
  if (!ch?.active || !dest?.enabled) throw new HttpError(400, "사용 중인 인스타그램 계정을 선택하세요.");
  const sec = resolveSecrets(dest.platform, ch.slug, dest.secretRefs);
  if (sec.missing.length || sec.invalid.length) throw new HttpError(409, "계정 연결 정보가 비어 있습니다.");
  const authMode = (sec.values.authMode ?? "instagram") as InstagramAuthMode;
  const identity = await accountIdentity(sec.values.accessToken, authMode, expectedInstagramUsername(ch.slug) ?? normalizeInstagramUsername(dest.label));
  if (!identity.ok) throw new HttpError(400, identity.error);
  if (identity.userId !== sec.values.userId) throw new HttpError(409, "저장된 게시 계정과 토큰의 계정이 다릅니다. 계정을 다시 연결하세요.");
  const mismatch = instagramAccountMismatch(ch.slug, identity.username);
  if (mismatch) throw new HttpError(409, mismatch);
  const quota = await publishingLimit(identity.userId, sec.values.accessToken, authMode);
  if (!quota.ok) throw new HttpError(400, "게시 권한 또는 인스타그램 API 한도를 확인할 수 없습니다.");
  // A Cloudinary outage must not turn a verified Instagram account into a failed
  // connection. The caller can show the remaining image-hosting step separately.
  const mediaHosting = await testCloudinary().catch(() => ({ ok: false, message: "이미지 저장소 연결을 확인할 수 없습니다. 잠시 후 다시 확인해 주세요." }));
  return { ok: true, username: identity.username, used: quota.used, total: quota.total, checkedAt: new Date().toISOString(), mediaHosting, authMode };
}


/** Read connection presence without exposing credentials or claiming a fresh API check. */
export async function instagramAccounts(db: DB) {
  const chs = (await orderedChannels(db)).filter(channel => channel.active);
  const rows = await db.select().from(destinations).where(eq(destinations.platform, "instagram"));
  return { accounts: chs.flatMap(ch => {
    // Only canonical publishing channels belong in this connection directory.
    // Legacy aliases remain valid for historical content checks, but must not
    // create a second account card while an older channel is still active.
    if (channelSlug(ch.slug) !== ch.slug) return [];
    const expectedUsername = expectedInstagramUsername(ch.slug) ?? "";
    return [{ channelId: ch.id, channelSlug: ch.slug, channelName: ch.name, expectedUsername, destinations: rows.filter(d => d.channelId === ch.id).map(d => {
      const sec = resolveSecrets(d.platform, ch.slug, d.secretRefs);
      return { id: d.id, label: d.label, enabled: d.enabled, configured: !sec.missing.length && !sec.invalid.length, authMode: sec.values.authMode ?? "instagram" };
    }) }];
  }) };
}
