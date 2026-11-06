import { creativeProfileSchema } from "./creativeProfile";
import { z } from "zod";
import { RESERVED_CHANNEL_KEYS } from "./channelKeys";
import { UNCLASSIFIED } from "./channelCategories";
import { channelAiSettingsSchema } from "./channelAi";

export const channelContentTypes = ["current_dialogue", "notice", "science_dialogue", "manual"] as const;
export type ChannelContentType = typeof channelContentTypes[number];
export const channelContentTypeLabels: Record<ChannelContentType, string> = {
  current_dialogue: "일반 자료·뉴스", notice: "공지·모집", science_dialogue: "과학 자료", manual: "직접 제작",
};

// A canonical kebab key also has a unique secret-variable prefix: foo-bar and
// foo_bar must not become two channels using the same IG_FOO_BAR credentials.
export const newChannelSlugSchema = z.string().trim().toLowerCase().min(1).max(48)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "영문 소문자·숫자와 단어 사이 하이픈으로 입력해 주세요.")
  .refine(value => !(RESERVED_CHANNEL_KEYS as readonly string[]).includes(value), "기본 채널이나 전체 보기에서 사용하는 주소입니다. 다른 주소를 입력해 주세요.");

export const channelCategoriesSchema = z.array(z.string().trim().min(1).max(40).transform(value => value.normalize("NFC")))
  .max(30).refine(values => new Set(values).size === values.length, "소분류 이름이 중복됐습니다.")
  .refine(values => !values.includes(UNCLASSIFIED), "미분류는 자동으로 제공됩니다. 목록에서 빼 주세요.")
  .nullable();

export const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: newChannelSlugSchema.optional(),
  contentType: z.enum(channelContentTypes).default("current_dialogue"),
  description: z.string().trim().max(500).default(""),
  audience: z.string().trim().min(1).max(60).default("일반 독자"),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#51635A"),
  categories: channelCategoriesSchema.default([]),
  aiSettings: channelAiSettingsSchema.nullable().optional(),
  creativeProfile: creativeProfileSchema.nullable().optional(),
}).strict();
export type ChannelCreateInput = z.input<typeof channelCreateSchema>;
