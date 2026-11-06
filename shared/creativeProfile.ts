import { z } from "zod";
import { studioFormats, studioExportDesigns, studioCharacters, type StudioFormat } from "./studio";
import { studioKey } from "./channelKeys";
import { isRegisteredProfileAssetId, type RegisteredProfileAssetId } from "./characterVariantAssets";

export const creativeRoutes = ["writing", "source", "media", "upload"] as const;
export type CreativeRoute = typeof creativeRoutes[number];
export const creativeRouteLabels: Record<CreativeRoute, string> = {
  writing: "아이디어·원고", source: "뉴스·자료", media: "사진·영상", upload: "완성 이미지",
};
export const creativeProfileSchema = z.object({
  version: z.literal(1).default(1),
  formats: z.array(z.enum(studioFormats)).min(1).max(studioFormats.length)
    .refine(values => new Set(values).size === values.length, "콘텐츠 형식이 중복됐습니다."),
  defaultFormat: z.enum(studioFormats),
  defaultRoute: z.enum(creativeRoutes).default("writing"),
  defaultTemplate: z.enum(studioExportDesigns).default("editorial"),
  characters: z.array(z.enum(studioCharacters)).max(4).default([]),
  logoAssetId: z.custom<RegisteredProfileAssetId>(isRegisteredProfileAssetId, { message: "등록된 로고 자산을 선택해 주세요." }).optional(),
  logoUrl: z.union([z.literal(""), z.string().url().startsWith("https://").max(2000)]).default(""),
  font: z.enum(["Pretendard", "Noto Sans KR", "Noto Serif KR"]).default("Pretendard"),
  tone: z.string().trim().max(1000).default(""),
  assetGuide: z.string().trim().max(2000).default(""),
}).strict().superRefine((profile, ctx) => {
  if (!profile.formats.includes(profile.defaultFormat)) ctx.addIssue({ code: "custom", path: ["defaultFormat"], message: "기본 형식을 허용 형식에 포함해 주세요." });
});
export type CreativeProfile = z.infer<typeof creativeProfileSchema>;

/** Legacy brand defaults live only at this compatibility boundary. New brands use data. */
export function creativeProfileFor(channel: { slug: string; creativeProfile?: CreativeProfile | null }): CreativeProfile {
  if (channel.creativeProfile) return creativeProfileSchema.parse(channel.creativeProfile);
  const key = studioKey(channel.slug);
  const legacy: Record<string, { format: StudioFormat; template: CreativeProfile["defaultTemplate"]; characters: CreativeProfile["characters"]; logoAssetId?: RegisteredProfileAssetId }> = {
    penguin: { format: "웹툰", template: "editorial", characters: ["pengki"], logoAssetId: "brand:space-penguin-company:20261101" },
    highscoop: { format: "카드뉴스", template: "set:r01", characters: ["pempem"], logoAssetId: "brand:highscoop:original:20261101" },
    news: { format: "카드뉴스", template: "set:n03", characters: ["pengpeng"], logoAssetId: "brand:allligodang:bw:20261104" },
    fryday: { format: "카드뉴스", template: "set:f01", characters: ["penguin"] },
  };
  const defaults = legacy[key] ?? { format: "카드뉴스" as const, template: "editorial" as const, characters: [], logoAssetId: undefined };
  return creativeProfileSchema.parse({
    formats: [...studioFormats], defaultFormat: defaults.format,
    defaultRoute: "writing", defaultTemplate: defaults.template, characters: defaults.characters, logoAssetId: defaults.logoAssetId,
  });
}

/** Only a registry ID becomes a local image URL; client input is never a filesystem path. */
export function creativeLogoSource(profile: Pick<CreativeProfile, "logoUrl" | "logoAssetId">): string | null {
  return profile.logoUrl || (profile.logoAssetId ? `/api/studio/brand-assets/${encodeURIComponent(profile.logoAssetId)}` : null);
}
