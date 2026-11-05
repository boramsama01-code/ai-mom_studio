import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { DB } from "../server/db";
import type { Channel } from "../shared/schema";
import { READING_CARD_PROFILES } from "../shared/readingCardProfiles";
import { layoutReadingProfilePage } from "../server/services/readingCard";
import { readingPreviewSample, renderPreview, TemplatePreviewPageError } from "../server/services/templates";

const db = new Proxy({}, { get: () => { throw new Error("A built-in template preview must not read or write draft data."); } }) as DB;
const channel = { id: 1, name: "하이스쿱", slug: "highscoop", accentColor: "#265F6A", contentType: "current_dialogue" } as Channel;

describe("native eight-page template previews", () => {
  it("fits the supplied example text in all 128 reading pages without altering the samples", () => {
    for (const profile of READING_CARD_PROFILES) for (let page = 0; page < 8; page++) {
      const { values } = readingPreviewSample(profile, page);
      const before = JSON.stringify(values);
      const result = layoutReadingProfilePage(profile, page + 1, values, { measureOnly: true });
      expect(result.textRuns.length, `${profile.id} page ${page + 1}`).toBeGreaterThan(0);
      expect(JSON.stringify(values)).toBe(before);
    }
  });

  it("renders a new cover, an interior, an outro and both original profiles without a saved draft", async () => {
    for (const [key, page] of [
      ["cardnews14-cinematic-v1", 0],
      ["cardnews14-bang-bang-v1", 4],
      ["cardnews14-amber-cream-v1", 7],
      ["reading-ink-lime-v1", 0],
      ["reading-cobalt-paper-v1", 7],
    ] as const) {
      const image = await renderPreview(db, key, channel, page);
      expect(await sharp(image).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1350, channels: 3 });
    }
  });

  it("rejects a sixth collection preview, a ninth reading preview and a second custom-layout preview", async () => {
    await expect(renderPreview(db, "set:r02", channel, 5)).rejects.toBeInstanceOf(TemplatePreviewPageError);
    await expect(renderPreview(db, "cardnews14-cinematic-v1", channel, 8)).rejects.toBeInstanceOf(TemplatePreviewPageError);
    await expect(renderPreview(db, "builtin:classic", channel, 1)).rejects.toBeInstanceOf(TemplatePreviewPageError);
  });
});
