import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import type { Express } from "express";
import { isPrivateStudioAssetPath } from "../server/studioAssetPath";

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
afterEach(async () => {
  vi.restoreAllMocks();
  testEnv.databaseUrl = "memory-session-test";
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});

it("keeps registered raw pose files private while authenticated studio downloads work", async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "studio-pose-auth-"));
  const publicPath = path.join(temporary, "dist/public");
  await fs.mkdir(path.join(publicPath, "studio-assets/poses-v2"), { recursive: true });
  await fs.writeFile(path.join(publicPath, "index.html"), "<html>test fixture</html>");
  await fs.writeFile(path.join(publicPath, "studio-assets/poses-v2/pengpeng.png"), "private-pose-bytes");
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
  for (const variant of encodedVariants) expect((await request(app).get(variant)).status, variant).toBe(401);
  expect((await request(app).get("/api/studio/characters/reference")).status).toBe(401);
  expect((await request(app).get("/api/studio/characters/pengpeng/poses/1")).status).toBe(401);
  const operator = request.agent(app);
  expect((await operator.post("/test-only/session")).status).toBe(200);
  const response = await operator.get(resource);
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.body.toString()).toBe("private-pose-bytes");
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
