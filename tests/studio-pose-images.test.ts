import fs from "node:fs/promises";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { studioPanelReferences, studioPoseReference } from "../server/services/studioCharacters";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("passes the actual selected image cells after the identity master without any network or paid call", async () => {
  // Deterministic colored cells test extraction independently of the character artwork.
  const pixels = Buffer.alloc(1254 * 1254 * 3);
  for (let y = 0; y < 1254; y++) for (let x = 0; x < 1254; x++) {
    const i = (y * 1254 + x) * 3;
    pixels[i] = Math.floor(x / 10);
    pixels[i + 1] = Math.floor(y / 10);
    pixels[i + 2] = 90;
  }
  const sheet = await sharp(pixels, { raw: { width: 1254, height: 1254, channels: 3 } }).png().toBuffer();
  const master = await sharp({ create: { width: 80, height: 30, channels: 3, background: "#fafafa" } }).png().toBuffer();
  const read = vi.spyOn(fs, "readFile").mockImplementation((async (file: unknown) => {
    const name = String(file).replaceAll("\\", "/");
    if (name.endsWith("/poses-v2/family-v2.png")) return master;
    if (/\/poses-v2\/(pengpeng|pempem|penguin|pengki)\.png$/.test(name)) return sheet;
    throw Error("Untrusted asset path");
  }) as typeof fs.readFile);
  const fetch = vi.fn(() => { throw Error("Network must not be used"); });
  vi.stubGlobal("fetch", fetch);
  const refs = await studioPanelReferences({ poseRefs: [{ character: "pengpeng", pose: 1 }, { character: "pempem", pose: 100 }] });
  expect(refs).toHaveLength(3);
  const decode = (ref: string) => Buffer.from(ref.split(",")[1], "base64");
  expect(await sharp(decode(refs[0])).metadata()).toMatchObject({ width: 80, height: 30 });
  expect(await sharp(decode(refs[1])).metadata()).toMatchObject({ width: 125, height: 132 });
  expect(await sharp(decode(refs[2])).metadata()).toMatchObject({ width: 134, height: 108 });
  expect([...((await sharp(decode(refs[1])).raw().toBuffer()).subarray(0, 3))]).toEqual([0, 0, 90]);
  expect([...((await sharp(decode(refs[2])).raw().toBuffer()).subarray(0, 3))]).toEqual([112, 114, 90]);
  const all = await studioPanelReferences({ poseRefs: [
    { character: "pengpeng", pose: 10 }, { character: "pempem", pose: 11 },
    { character: "penguin", pose: 50 }, { character: "pengki", pose: 99 },
  ] });
  expect(all).toHaveLength(5); // Even with an existing panel added by the worker this stays at six.
  const before = read.mock.calls.length;
  await expect(studioPoseReference("../../secret" as "pengpeng", 1)).rejects.toThrow();
  await expect(studioPoseReference("pengpeng", 101)).rejects.toThrow();
  expect(read.mock.calls.length).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});
