import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { FINAL_STUDIO_ASSETS, FINAL_POSE_VERSION, PREVIOUS_POSE_VERSION, finalPose } from "../shared/studioFinalAssets";
import { studioFinalAsset } from "../server/services/studioFinalAssets";
import { studioPanelReferences, studioPoseReference } from "../server/services/studioCharacters";
import { studioContentSchema } from "../shared/studio";
import { studioPoseGuide } from "../shared/studioCharacters";

it("registers all 449 original RGBA PNGs byte-for-byte, including all 160 comic faces", async () => {
  const manifest = JSON.parse(await fs.readFile("assets/studio-final-v14/manifest.json", "utf8"));
  expect(manifest.files).toHaveLength(449);
  expect(FINAL_STUDIO_ASSETS.filter(a => a.category === "individual")).toHaveLength(400);
  expect(FINAL_STUDIO_ASSETS.filter(a => a.category === "group")).toHaveLength(36);
  expect(FINAL_STUDIO_ASSETS.filter(a => a.category === "nonverbal")).toHaveLength(12);
  for (const character of ["pengpeng", "pempem", "penguin", "pengki"] as const) {
    expect(Array.from({ length: 100 }, (_, i) => finalPose(character, i + 1)).filter(a => a?.comic_face_type !== "normal")).toHaveLength(40);
  }
  for (const asset of manifest.files) {
    const bytes = await studioFinalAsset(asset.id, PREVIOUS_POSE_VERSION);
    expect(createHash("sha256").update(bytes).digest("hex"), asset.id).toBe(asset.sha256);
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format, asset.id).toBe("png");
    expect(metadata.hasAlpha, asset.id).toBe(true);
  }
  await expect(studioFinalAsset("../../package.json")).rejects.toThrow();
  await expect(studioFinalAsset("PP101")).rejects.toThrow();
});

it("keeps old references distinct and preserves final IDs through serialization and image guidance", async () => {
  const draft = studioContentSchema.parse({ title: "최종 포즈", characters: ["pengpeng", "pempem"], panels: Array.from({ length: 4 }, () => ({ scene: "가족 회의", dialogue: "" })) });
  draft.panels[0].poseRefs = [{ character: "pengpeng", pose: 24, assetVersion: FINAL_POSE_VERSION }, { character: "pempem", pose: 8 }];
  const reopened = studioContentSchema.parse(JSON.parse(JSON.stringify(draft)));
  expect(reopened.panels[0].poseRefs).toEqual(draft.panels[0].poseRefs);
  expect(studioPoseGuide(reopened.panels[0])).toContain("PP024");
  expect(studioPoseGuide(reopened.panels[0])).toContain("10×10 시트");
  expect(studioPoseGuide(reopened.panels[0])).toContain(`version=${FINAL_POSE_VERSION}`);
  const final = await studioPoseReference("pengpeng", 24, FINAL_POSE_VERSION);
  const old = await studioPoseReference("pengpeng", 24);
  expect(final.equals(old)).toBe(false);
  expect(final.equals(await studioFinalAsset("PP024"))).toBe(true);
  const references = await studioPanelReferences(reopened.panels[0]);
  expect(references).toHaveLength(3);
  expect(Buffer.from(references[1].split(",")[1], "base64").equals(final)).toBe(true);
  expect(Buffer.from(references[2].split(",")[1], "base64").equals(await studioPoseReference("pempem", 8))).toBe(true);
});

it("serves all 400 refreshed poses as flat vectors and transparent 1024px PNGs without replacing v1.4", async () => {
  const manifest = JSON.parse(await fs.readFile("assets/studio-final-v15/manifest.json", "utf8"));
  expect(manifest.files).toHaveLength(802);
  for (const asset of manifest.files) {
    const bytes = await studioFinalAsset(asset.id, FINAL_POSE_VERSION, asset.format);
    expect(createHash("sha256").update(bytes).digest("hex"), asset.file).toBe(asset.sha256);
    if (asset.format === "svg") {
      const svg = bytes.toString();
      expect(svg, asset.id).toContain("#56515B");
      expect(svg, asset.id).not.toMatch(/<image|<filter|<linearGradient|<radialGradient|<script|href=/i);
    } else {
      const metadata = await sharp(bytes).metadata();
      expect(metadata.hasAlpha, asset.id).toBe(true);
      expect(Math.max(metadata.width!, metadata.height!), asset.id).toBeGreaterThanOrEqual(1023);
    }
  }
  const current = await studioFinalAsset("PM005", FINAL_POSE_VERSION);
  const previous = await studioFinalAsset("PM005", PREVIOUS_POSE_VERSION);
  expect(current.equals(previous)).toBe(false);
  expect((await studioPoseReference("pempem", 5, PREVIOUS_POSE_VERSION)).equals(previous)).toBe(true);
  await expect(studioFinalAsset("PM005", PREVIOUS_POSE_VERSION, "svg")).rejects.toThrow();
});
