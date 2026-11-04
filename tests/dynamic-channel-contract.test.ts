import { describe, expect, it } from "vitest";
import { channelCategories, validSubcategory } from "../shared/channelCategories";
import { channelCategoriesSchema, channelCreateSchema, newChannelSlugSchema } from "../shared/channelSettings";
import { channelSlug, channelStoredKeys, normalizeStudioChannel, RESERVED_CHANNEL_KEYS, studioKey } from "../shared/channelKeys";
import { studioContentSchema, studioGenerationSchema } from "../shared/studio";
import { expectedInstagramUsername } from "../shared/channelInstagram";
import { buildCardModel } from "../server/services/cardModel";

describe("persisted channel keys and editable taxonomy", () => {
  it("round-trips new keys and all historical aliases without inventing another brand", () => {
    for (const key of ["atelier-7", "regional-news", "legacy_key", "constructor", "tostring"]) {
      expect(channelSlug(studioKey(key))).toBe(key);
      expect(normalizeStudioChannel(key)).toBe(key);
      expect(studioContentSchema.parse({ title: "직접 제작", channel: key }).channel).toBe(key);
      expect(channelCategories(key)).toEqual([]);
      expect(expectedInstagramUsername(key)).toBeNull();
    }
    for (const [keys, stored, studio] of [
      [["highway", "highscoop", "opportunities"], "opportunities", "highscoop"],
      [["science-dialogue", "current-dialogue", "news"], "current-dialogue", "news"],
      [["penguin"], "penguin", "penguin"], [["fryday"], "fryday", "fryday"],
    ] as const) for (const key of keys) {
      expect(channelSlug(key)).toBe(stored);
      expect(studioKey(key)).toBe(studio);
      expect(studioContentSchema.parse({ title: key, channel: key }).channel).toBe(studio);
      expect(channelStoredKeys(stored)).toContain(key);
    }
  });

  it("keeps reserved filters, old aliases and credential-prefix collisions out of new slugs", () => {
    for (const key of [...RESERVED_CHANNEL_KEYS, "brand_name", "../brand", "brand--name", "brand-", "7brand", "a".repeat(49)]) {
      expect(newChannelSlugSchema.safeParse(key).success, key).toBe(false);
    }
    expect(newChannelSlugSchema.parse("  Brand-7  ")).toBe("brand-7");
  });

  it("defaults a new channel to a source-capable draft format with explicit empty categories", () => {
    expect(channelCreateSchema.parse({ name: " 새 브랜드 " })).toMatchObject({ name: "새 브랜드", contentType: "current_dialogue", categories: [], accentColor: "#51635A" });
    expect(channelCreateSchema.parse({ name: "직접 제작", contentType: "manual", categories: null }).categories).toBeNull();
    expect(channelCreateSchema.safeParse({ name: "외부 설정", budget: {} }).success).toBe(false);
    expect(channelCreateSchema.safeParse({ name: "미지원", contentType: "unknown" }).success).toBe(false);
  });

  it("distinguishes inherited defaults from an intentionally empty or custom category list", () => {
    expect(channelCategories("news", null)).toEqual(channelCategories("current-dialogue"));
    expect(channelCategories("news", [])).toEqual([]);
    expect(channelCategories("atelier", ["지역 소식"])).toEqual(["지역 소식"]);
    expect(validSubcategory("atelier", "지역 소식", ["지역 소식"])).toBe(true);
    expect(validSubcategory("atelier", "과학", ["지역 소식"])).toBe(false);
    expect(validSubcategory("news", "과학", [])).toBe(false);
    expect(validSubcategory("atelier", null, [])).toBe(true);
  });

  it("normalizes Korean labels and rejects duplicate or implicit unclassified options", () => {
    const decomposed = "과학".normalize("NFD");
    expect(channelCategoriesSchema.parse([` ${decomposed} `])).toEqual(["과학"]);
    for (const values of [["과학", decomposed], ["미분류"], [" "], Array.from({ length: 31 }, (_, i) => `분류${i}`)]) {
      expect(channelCategoriesSchema.safeParse(values).success).toBe(false);
    }
  });

  it("keeps a custom brand's display name even when it matches a historical alias", () => {
    const args = { kind: "current_dialogue", payload: { title: "지역 소식", summary: "직접 쓴 요약" }, channelName: "Highway", accent: "#123456", sourceOrg: null, checkedDate: "2026-11-04" };
    expect(buildCardModel({ ...args, channelSlug: "local-atelier" }).brandLine).toBe("Highway");
    expect(buildCardModel({ ...args, channelSlug: "opportunities" }).brandLine).toBe("Highscoop");
    expect(buildCardModel(args).brandLine).toBe("Highscoop");
  });

  it("accepts one bounded image batch or a single panel edit without overlapping targets", () => {
    const base = { version: 1, requestId: "c53031c4-583e-467b-a67d-a889ed3155af" };
    expect(studioGenerationSchema.parse({ ...base, kind: "image", panelIndexes: [0, 2, 3] }).panelIndexes).toEqual([0, 2, 3]);
    expect(studioGenerationSchema.parse({ ...base, kind: "image", panelIndex: 0 }).panelIndex).toBe(0);
    expect(studioGenerationSchema.parse({ ...base, kind: "text", textTarget: "panel", panelIndex: 2 }).textTarget).toBe("panel");
    for (const input of [
      { kind: "image", panelIndexes: [] }, { kind: "image", panelIndexes: [0, 0] },
      { kind: "image", panelIndexes: [4] }, { kind: "image", panelIndexes: [1], panelIndex: 0 },
      { kind: "text", textTarget: "panel" }, { kind: "image", textTarget: "panel", panelIndex: 0 },
      { kind: "text", textTarget: "fill", panelIndexes: [0] },
    ]) expect(studioGenerationSchema.safeParse({ ...base, ...input }).success).toBe(false);
  });
});
