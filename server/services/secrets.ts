/**
 * 목적지별 비밀값 참조.
 * DB에는 환경변수 "이름"만 저장하고, 허용된 패턴(채널 slug에 묶인 이름)인지 검증한 뒤에만 읽는다.
 * 임의 DB 문자열로 아무 환경변수나 읽지 못하게 한다.
 */
export function slugToEnvPart(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export const SECRET_FIELDS: Record<string, string[]> = {
  instagram: ["accessToken", "userId", "authMode"],
  telegram_channel: ["chatId"],
};

export function allowedSecretName(platform: string, slug: string, field: string, name: string): boolean {
  const s = slugToEnvPart(slug);
  const prefix = platform === "instagram" ? "IG" : platform === "telegram_channel" ? "TG" : null;
  if (!prefix || !SECRET_FIELDS[platform]?.includes(field)) return false;
  return new RegExp(`^${prefix}_${s}_[A-Z0-9_]{2,40}$`).test(name);
}

export function defaultSecretRefs(platform: string, slug: string): Record<string, string> {
  const s = slugToEnvPart(slug);
  if (platform === "instagram") return { accessToken: `IG_${s}_ACCESS_TOKEN`, userId: `IG_${s}_USER_ID` };
  if (platform === "telegram_channel") return { chatId: `TG_${s}_CHAT_ID` };
  return {};
}

export function resolveSecrets(platform: string, slug: string, refs: Record<string, string>): { values: Record<string, string>; missing: string[]; invalid: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const field of SECRET_FIELDS[platform] ?? []) {
    const name = refs[field];
    // Destinations saved before Unified Login keep their Instagram Login path.
    if (platform === "instagram" && field === "authMode" && !name) { values.authMode = "instagram"; continue; }
    if (!name || !allowedSecretName(platform, slug, field, name)) {
      invalid.push(field);
      continue;
    }
    const v = process.env[name];
    if (!v) missing.push(name);
    else if (platform === "instagram" && field === "authMode" && !["instagram", "facebook"].includes(v)) invalid.push(field);
    else values[field] = v;
  }
  return { values, missing, invalid };
}
