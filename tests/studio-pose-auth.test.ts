import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import type { Express } from "express";
import { isPrivateStudioAssetPath } from "../server/studioAssetPath";
import { REGISTERED_PROFILE_ASSETS } from "../shared/characterVariantAssets";
import { readRegisteredCharacterAsset } from "../server/services/characterVariantAssets";
import { studioFinalAsset } from "../server/services/studioFinalAssets";

const testEnv = vi.hoisted(() => ({ databaseUrl: "memory-session-test", adminUsername: "pose-test-operator", isProduction: false, canonicalRedirectUrl: "", baseUrl: "http://localhost" }));
vi.mock("../server/env", () => ({ env: testEnv }));
vi.mock("../server/auth", async original => {
  const actual = await original<typeof import("../server/auth")>();
  const session = (await import("express-session")).default;
  return {
    ...actual,
    authConfigured: () => true,
    installSession(app: Express) {
      app.use(session({ secret: "pose-reference-auth-test-only", resave: false, saveUninitialized: false }));
      return true;
    },
    installAuthRoutes(app: Express) {
      app.post("/test-only/session", (req, res) => { req.session.user = testEnv.adminUsername; res.json({ ok: true }); });
    },
  };
});
const { createApp } = await import("../server/app");
let temporary = "";

it("protects final individual, shared scene, balloon and family PNGs and serves the exact selected original", async () => {
  const app = createApp();
  const operator = request.agent(app);
  await operator.post("/test-only/session");
  for (const [resource, id] of [
    ["/api/studio/characters/pengpeng/poses/24?version=final-v1.4", "PP024"],
    ["/api/studio/characters/pempem/poses/100?version=final-v1.4", "PM100"],
    ["/api/studio/characters/assets/FA001?version=final-v1.4", "FA001"],
    ["/api/studio/characters/assets/FX012?version=final-v1.4", "FX012"],
    ["/api/studio/characters/reference?version=final-v1.4", "MODEL_FAMILY"],
  ]) {
    expect((await request(app).get(resource)).status).toBe(401);
    const response = await operator.get(resource);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.body.equals(await studioFinalAsset(id, "final-v1.4"))).toBe(true);
  }
  expect((await operator.get("/api/studio/characters/assets/PP101?version=final-v1.4")).status).toBe(404);
  expect((await operator.get("/api/studio/characters/pengpeng/poses/1?version=unknown")).status).toBe(400);
});
it("protects refreshed PNG and editable SVG downloads and serves the chosen version", async () => {
  const app = createApp(), operator = request.agent(app);
  await operator.post("/test-only/session");
  for (const format of ["png", "svg"] as const) {
    const url = `/api/studio/characters/pempem/poses/5?version=final-v1.5&format=${format}&download=1`;
    expect((await request(app).get(url)).status).toBe(401);
    const response = await operator.get(url).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk))); res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(format === "svg" ? "image/svg+xml" : "image/png");
    expect(response.headers["content-disposition"]).toContain(`.${format}`);
    expect(response.body.equals(await studioFinalAsset("PM005", "final-v1.5", format))).toBe(true);
  }
  expect((await operator.get("/api/studio/characters/pempem/poses/5?version=final-v1.4&format=svg")).status).toBe(404);
});
afterEach(async () => {
  vi.restoreAllMocks();
  testEnv.databaseUrl = "memory-session-test";
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});

it("keeps registered raw pose files private while authenticated studio downloads work", async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "studio-pose-auth-"));
  const publicPath = path.join(temporary, "dist/public");
  await fs.mkdir(path.join(publicPath, "studio-assets/poses-v2"), { recursive: true });
  await fs.mkdir(path.join(publicPath, "studio-assets/character-variants"), { recursive: true });
  await fs.writeFile(path.join(publicPath, "index.html"), "<html>test fixture</html>");
  await fs.writeFile(path.join(publicPath, "studio-assets/poses-v2/pengpeng.png"), "private-pose-bytes");
  await fs.writeFile(path.join(publicPath, "studio-assets/character-variants/family.png"), "private-character-variant-bytes");
  await fs.writeFile(path.join(publicPath, "studio-assets/legacy.png"), "legacy-public-asset");
  vi.spyOn(process, "cwd").mockReturnValue(temporary);
  const app = createApp();
  const resource = "/studio-assets/poses-v2/pengpeng.png";
  const encodedVariants = [
    "/studio-assets/%70oses-v2/pengpeng.png",
    "/studio-assets//poses-v2/pengpeng.png",
    "/studio-assets%2fposes-v2/pengpeng.png",
    "/studio-assets/poses-v2%2fpengpeng.png",
    "/%73tudio-assets/poses-v2/pengpeng.png",
    "/studio-assets/%2e/poses-v2/pengpeng.png",
  ];
  expect((await request(app).get(resource)).status).toBe(401);
  expect((await request(app).head(resource)).status).toBe(401);
  const characterVariant = "/studio-assets/character-variants/family.png";
  expect((await request(app).get(characterVariant)).status).toBe(401);
  expect((await request(app).get("/studio-assets/%63haracter-variants/family.png")).status).toBe(401);
  for (const variant of encodedVariants) expect((await request(app).get(variant)).status, variant).toBe(401);
  expect((await request(app).get("/api/studio/characters/reference")).status).toBe(401);
  expect((await request(app).get("/api/studio/characters/pengpeng/poses/1")).status).toBe(401);
  const operator = request.agent(app);
  expect((await operator.post("/test-only/session")).status).toBe(200);
  const response = await operator.get(resource);
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.body.toString()).toBe("private-pose-bytes");
  const variantResponse = await operator.get(characterVariant);
  expect(variantResponse.status).toBe(200);
  expect(variantResponse.body.toString()).toBe("private-character-variant-bytes");
  expect(variantResponse.headers["cache-control"]).toBe("private, no-store");
  for (const variant of encodedVariants) {
    const decodedDownload = await operator.get(variant);
    expect(decodedDownload.status, variant).toBe(200);
    expect(decodedDownload.body.toString()).toBe("private-pose-bytes");
    expect(decodedDownload.headers["cache-control"]).toBe("private, no-store");
  }
  expect((await request(app).get("/studio-assets/legacy.png")).status).toBe(200);
  expect((await operator.get("/api/studio/characters")).body.characters.map((c: { age: number }) => c.age)).toEqual([40, 37, 13, 12]);
  // A deployment lacking session configuration must never fall through to public static serving.
  testEnv.databaseUrl = "";
  expect((await request(createApp()).get(resource)).status).toBe(401);
});

it("normalizes only the private pose asset subtree and decodes once", () => {
  for (const pathname of ["/studio-assets/poses-v2", "/studio-assets//poses-v2/pengpeng.png", "/studio-assets%2Fposes-v2/pengpeng.png", "/x/../studio-assets/%70oses-v2/pengpeng.png"]) {
    expect(isPrivateStudioAssetPath(pathname), pathname).toBe(true);
  }
  for (const pathname of ["/studio-assets/legacy.png", "/studio-assets/poses-v20/file.png", "/other/poses-v2/file.png", "/studio-assets/%2570oses-v2/file.png", "/studio-assets/%ZZ/file.png"]) {
    expect(isPrivateStudioAssetPath(pathname), pathname).toBe(false);
  }
});

it("serves the registered family and actual pose PNGs through authenticated image routes", async () => {
  const sharp = (await import("sharp")).default;
  const app = createApp();
  const operator = request.agent(app);
  expect((await operator.post("/test-only/session")).status).toBe(200);
  const family = await operator.get("/api/studio/characters/reference");
  expect(family.status).toBe(200);
  expect(family.headers["content-type"]).toContain("image/png");
  expect((await sharp(family.body).metadata()).width).toBe(1942);
  for (const character of ["pengpeng", "pempem", "penguin", "pengki"]) {
    for (const pose of [1, 100]) {
      const resource = `/api/studio/characters/${character}/poses/${pose}`;
      expect((await request(app).get(resource)).status).toBe(401);
      const response = await operator.get(resource);
      expect(response.status, resource).toBe(200);
      expect(response.headers["content-type"], resource).toContain("image/png");
      const image = await sharp(response.body).metadata();
      expect(image.format).toBe("png");
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
    }
  }
});


it("protects registered brand originals, preserves exact bytes and rejects arbitrary filesystem paths", async () => {
  const app = createApp(), operator = request.agent(app);
  await operator.post("/test-only/session");
  for (const asset of REGISTERED_PROFILE_ASSETS) {
    const url = "/api/studio/brand-assets/" + encodeURIComponent(asset.id);
    expect((await request(app).get(url)).status).toBe(401);
    const response = await operator.get(url);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body.equals(readRegisteredCharacterAsset(asset))).toBe(true);
  }
  for (const id of ["../../server/env.ts", "unknown-logo", "brand:unregistered"]) {
    expect((await operator.get("/api/studio/brand-assets/" + encodeURIComponent(id))).status).toBe(404);
  }
});
