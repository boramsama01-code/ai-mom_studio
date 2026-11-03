import { expectedInstagramUsername, instagramAccountMismatch, normalizeInstagramUsername } from "../../shared/channelInstagram";
import type { Channel, Destination, PublicationDestinationSnapshot } from "../../shared/schema";
import { accountIdentity, publishingLimit, type InstagramAuthMode } from "./instagram";
import { resolveSecrets } from "./secrets";
import { telegramChatIdentity } from "./telegram";

/** Read-only identity verification. No provider token is ever included in the snapshot. */
export async function capturePublicationDestinations(channel: Channel, selected: Destination[], now = new Date()) {
  const snapshots = new Map<number, PublicationDestinationSnapshot>();
  for (const destination of selected) {
    const sec = resolveSecrets(destination.platform, channel.slug, destination.secretRefs);
    if (sec.missing.length || sec.invalid.length) return { ok: false as const, error: "게시 계정 연결 정보가 바뀌었습니다. 다시 연결하세요." };
    const base = { version: 1 as const, destinationId: destination.id, destinationVersion: destination.version, platform: destination.platform, label: destination.label, verifiedAt: now.toISOString() };
    if (destination.platform === "instagram") {
      const authMode = (sec.values.authMode ?? "instagram") as InstagramAuthMode;
      const expected = expectedInstagramUsername(channel.slug) ?? normalizeInstagramUsername(destination.label);
      const identity = await accountIdentity(sec.values.accessToken, authMode, expected);
      if (!identity.ok) return { ok: false as const, error: `인스타그램 계정을 확인할 수 없습니다. ${identity.error}` };
      if (identity.userId !== sec.values.userId) return { ok: false as const, error: "저장된 게시 계정 ID와 토큰의 계정이 다릅니다. 인스타그램 계정을 다시 연결하세요." };
      if (normalizeInstagramUsername(identity.username) !== expected) return { ok: false as const, error: `게시할 @${expected} 계정과 연결된 계정이 다릅니다. 인스타그램 연결을 확인하세요.` };
      const mismatch = instagramAccountMismatch(channel.slug, identity.username);
      if (mismatch) return { ok: false as const, error: mismatch };
      const quota = await publishingLimit(identity.userId, sec.values.accessToken, authMode);
      if (!quota.ok) return { ok: false as const, error: "인스타그램 게시 권한을 확인할 수 없습니다. 프로페셔널 계정과 게시 권한을 확인한 뒤 다시 연결하세요." };
      snapshots.set(destination.id, { ...base, accountId: identity.userId, username: normalizeInstagramUsername(identity.username), authMode });
    } else if (destination.platform === "telegram_channel") {
      const identity = await telegramChatIdentity(sec.values.chatId);
      if (!identity.ok) return identity;
      snapshots.set(destination.id, { ...base, accountId: identity.chatId, username: identity.username, configuredAddress: sec.values.chatId });
    } else {
      return { ok: false as const, error: "지원하지 않는 게시 목적지입니다." };
    }
  }
  return { ok: true as const, snapshots };
}

/** Compare configuration/identity, not credentials: rotating a token for the same account is safe. */
export function publicationDestinationError(snapshot: PublicationDestinationSnapshot | null | undefined, destination: Destination | undefined, channel: Channel | undefined): string | null {
  if (!snapshot) return "이전 승인에는 게시 계정 확인 기록이 없습니다. 계정을 확인하고 최신 내용을 다시 승인하세요.";
  if (!destination?.enabled || !channel?.active) return "게시 목적지 또는 채널이 비활성 상태입니다. 설정을 확인하고 다시 승인하세요.";
  if (snapshot.destinationId !== destination.id || snapshot.platform !== destination.platform || destination.channelId !== channel.id) return "승인한 게시 목적지가 변경됐습니다. 계정을 확인하고 다시 승인하세요.";
  const sec = resolveSecrets(destination.platform, channel.slug, destination.secretRefs);
  if (sec.missing.length || sec.invalid.length) return "게시 계정 연결 정보가 없습니다. 계정을 다시 연결하세요.";
  if (destination.platform === "instagram") {
    const expected = expectedInstagramUsername(channel.slug) ?? normalizeInstagramUsername(destination.label);
    if (snapshot.accountId !== sec.values.userId || snapshot.authMode !== (sec.values.authMode ?? "instagram") || snapshot.username !== expected) return "승인한 인스타그램 계정이 변경됐습니다. 현재 계정을 확인하고 다시 승인하세요.";
  } else if (destination.platform === "telegram_channel" && snapshot.configuredAddress !== sec.values.chatId) {
    return "승인한 텔레그램 채널 주소가 변경됐습니다. 현재 채널을 확인하고 다시 승인하세요.";
  }
  return null;
}
