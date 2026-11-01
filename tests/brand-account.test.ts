import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, setTestEnv, TEST_PASSWORD } from "./helpers";

setTestEnv();
process.env.ADMIN_USERNAME = "spacepenguin";
const { createApp } = await import("../server/app");
const { closeDb } = await import("../server/db");
beforeAll(resetDb);
afterAll(closeDb);

describe("Studio account branding", () => {
  it("uses the renamed account with the same password and a new session cookie", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const signedIn = await agent.post("/api/auth/login").send({ username: "spacepenguin", password: TEST_PASSWORD });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toBe("spacepenguin");
    expect(String(signedIn.headers["set-cookie"])).toContain("spacepenguin.sid=");
    expect((await agent.get("/api/channels")).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ username: "aimom", password: TEST_PASSWORD })).status).toBe(401);
    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/channels")).status).toBe(401);
  });

  it("moves old browser links while keeping API callbacks, paths and authentication intact", async () => {
    process.env.APP_CANONICAL_REDIRECT_URL = "https://spacepenguin.onrender.com";
    try {
      const app = createApp();
      const page = await request(app).get("/studio/3?view=cards");
      expect(page.status).toBe(308);
      expect(page.headers.location).toBe("https://spacepenguin.onrender.com/studio/3?view=cards");
      expect((await request(app).get("//another.example/path")).headers.location).toBe("https://spacepenguin.onrender.com//another.example/path");
      expect((await request(app).get("/api/auth/me")).status).toBe(200);
      expect((await request(app).get("/api/channels")).status).toBe(401);
      expect((await request(app).get("/").set("host","spacepenguin.onrender.com")).status).not.toBe(308);
    } finally {
      delete process.env.APP_CANONICAL_REDIRECT_URL;
    }
  });
});
