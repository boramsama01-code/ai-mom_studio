import { channelSlug } from "./channelKeys";
/** Operator-confirmed account mapping; handles alone are never treated as API authorization. */
export const CHANNEL_INSTAGRAM: Record<string, string> = {
  penguin: "spacepenguin.co",
  opportunities: "highscoop.official",
  "current-dialogue": "alligodang.official",
  fryday: "fryday.official.kr",
};
export const expectedInstagramUsername = (channel: string): string | null => {
  const slug = channelSlug(channel);
  return Object.hasOwn(CHANNEL_INSTAGRAM, slug) ? CHANNEL_INSTAGRAM[slug] : null;
};
export const normalizeInstagramUsername = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
export function instagramAccountMismatch(channel: string, username: string): string | null {
  const expected = expectedInstagramUsername(channel);
  return expected && normalizeInstagramUsername(username) !== expected ? `이 채널의 게시 계정은 @${expected}입니다. 연결된 @${normalizeInstagramUsername(username)} 계정으로는 발행하지 않습니다.` : null;
}
export type InstagramAccountRow = { channelId: number; channelSlug?: string; channelName: string; expectedUsername: string; destinations: Array<{ id: number; label: string; enabled: boolean; configured: boolean; authMode?: "instagram" | "facebook" }> };

export type InstagramConnectionCheck = { ok?: boolean; username: string; checkedAt: string; used?: number; total?: number; mediaHosting?: { ok: boolean; message: string } };
export type InstagramOAuthConfig = { configured: boolean; missing: string[]; appId: string | null; redirectUri: string };
