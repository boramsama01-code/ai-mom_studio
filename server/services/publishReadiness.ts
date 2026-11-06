import { and, eq, inArray } from "drizzle-orm";
import { expectedInstagramUsername, instagramAccountMismatch, normalizeInstagramUsername } from "../../shared/channelInstagram";
import type { PublicationReadiness } from "../../shared/publicationReadiness";
import { channels, destinations } from "../../shared/schema";
import type { DB } from "../db";
import { env } from "../env";
import { getSetting } from "../seed";
import { accountIdentity, publishingLimit, type InstagramAuthMode } from "./instagram";
import { resolveSecrets } from "./secrets";

type Channel = typeof channels.$inferSelect;
type Destination = typeof destinations.$inferSelect;

/** Local prerequisites only. A page refresh must never contact a social API. */
export function publicationReadinessFor(channel: Channel | undefined, selected: Destination[], globalStop: boolean): PublicationReadiness {
  const blockers: string[] = [];
  const expectedUsername = channel ? expectedInstagramUsername(channel.slug) : null;
  if (!channel?.active) blockers.push("사용 중인 채널을 선택하세요.");
  if (globalStop) blockers.push("전체 작업이 일시 정지돼 있습니다. 정지를 해제한 뒤 승인하세요.");
  if (!selected.length) blockers.push("게시할 계정이 연결되지 않았습니다. 인스타그램 연결에서 계정을 먼저 연결하세요.");
  if (env.dryRun) blockers.push("현재 모의 실행 상태라 실제 게시할 수 없습니다. 실제 게시 모드로 변경한 뒤 승인하세요.");
  if (!env.autoPublish) blockers.push("서버의 실제 게시가 중지돼 있습니다. 게시를 켠 뒤 승인하세요.");
  if (env.canonicalRedirectUrl) blockers.push("이전 서버에서는 발행하지 않습니다. 현재 Studio에서 승인하세요.");
  const choices = selected.map(destination => {
    const sec = resolveSecrets(destination.platform, channel?.slug ?? "", destination.secretRefs);
    const known = destination.platform === "instagram" || destination.platform === "telegram_channel";
    const configured = known && !sec.missing.length && !sec.invalid.length;
    if (!known) blockers.push(`${destination.label}: 지원하지 않는 게시 목적지입니다.`);
    else if (!configured) blockers.push(`${destination.label}: 게시 계정 연결 정보가 없습니다. 계정을 다시 연결하세요.`);
    if (destination.platform === "telegram_channel" && !env.telegramBotToken) blockers.push("텔레그램 봇 토큰을 연결하세요.");
    return { id: destination.id, label: destination.label, platform: destination.platform, configured };
  });
  if (selected.some(destination => destination.platform === "instagram")) {
    if (!env.cloudinaryConfigured) blockers.push("이미지 저장소가 연결되지 않았습니다. API 키 관리에서 Cloudinary를 연결하세요.");
    if (!/^v\d+\.\d+$/.test(env.instagramApiVersion)) blockers.push("API 키 관리에서 올바른 Instagram API 버전을 입력하세요.");
    if (selected.filter(destination => destination.platform === "instagram").length > 1) blockers.push("이 채널에 활성 인스타그램 목적지가 여러 개 있습니다. 사용할 계정 하나를 확인하세요.");
  }
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], dryRun: env.dryRun, autoPublish: env.autoPublish, expectedUsername, destinations: choices };
}

export async function loadPublicationReadiness(db: DB, channelId: number, destinationIds?: number[]) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  const selected = await db.select().from(destinations).where(and(eq(destinations.channelId, channelId), eq(destinations.enabled, true), destinationIds ? inArray(destinations.id, destinationIds) : undefined));
  const readiness = publicationReadinessFor(channel, selected, await getSetting(db, "global_stop", false));
  if (destinationIds && selected.length !== destinationIds.length) {
    readiness.ready = false;
    readiness.blockers.push("게시 목적지가 변경됐습니다. 계정을 다시 확인하세요.");
  }
  return { channel, selected, readiness };
}

export async function publicationReadiness(db: DB, channelId: number): Promise<PublicationReadiness> {
  return (await loadPublicationReadiness(db, channelId)).readiness;
}

/** Read-only confirmation immediately before a new approval; never creates media. */
export async function verifyInstagramPublicationAccess(channel: Channel, selected: Destination[]): Promise<string | null> {
  for (const destination of selected) {
    if (destination.platform !== "instagram") continue;
    const sec = resolveSecrets(destination.platform, channel.slug, destination.secretRefs);
    if (sec.missing.length || sec.invalid.length) return "인스타그램 계정 연결 정보가 바뀌었습니다. 다시 연결하세요.";
    const authMode = (sec.values.authMode ?? "instagram") as InstagramAuthMode;
    const expected = expectedInstagramUsername(channel.slug) ?? normalizeInstagramUsername(destination.label);
    const identity = await accountIdentity(sec.values.accessToken, authMode, expected);
    if (!identity.ok) return `인스타그램 계정을 확인할 수 없습니다. ${identity.error}`;
    if (identity.userId !== sec.values.userId) return "저장된 게시 계정 ID와 토큰의 계정이 다릅니다. 인스타그램 계정을 다시 연결하세요.";
    if (normalizeInstagramUsername(identity.username) !== expected) return `게시할 @${expected} 계정과 연결된 계정이 다릅니다. 인스타그램 연결을 확인하세요.`;
    const mismatch = instagramAccountMismatch(channel.slug, identity.username);
    if (mismatch) return mismatch;
    const quota = await publishingLimit(identity.userId, sec.values.accessToken, authMode);
    if (!quota.ok) return "인스타그램 게시 권한을 확인할 수 없습니다. 프로페셔널 계정과 게시 권한을 확인한 뒤 다시 연결하세요.";
  }
  return null;
}
