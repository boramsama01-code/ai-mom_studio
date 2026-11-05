import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessToken, canvaConfigured, canvaConfigurationProblem, canvaConnected, exchangeCode } from "../server/services/canva";
import { templateRoutes } from "../server/routes/templates";

const app = express().use("/api", templateRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message });
app.use(errors);

beforeEach(() => {
  vi.stubEnv("CANVA_CLIENT_ID", "aimom");
  vi.stubEnv("CANVA_CLIENT_SECRET", "private-value-must-never-be-returned");
  vi.stubEnv("CANVA_ACCESS_TOKEN", "old-access-token");
  vi.stubEnv("CANVA_REFRESH_TOKEN", "old-refresh-token");
  vi.stubEnv("CANVA_TOKEN_EXPIRES_AT", String(Date.now() + 3600_000));
});
afterEach(() => vi.unstubAllEnvs());

describe("invalid Canva configuration recovery", () => {
  it("blocks OAuth before a redirect or session is created and explains how to fix settings", async () => {
    // No session middleware: reaching session setup would produce a 500 instead of the safe 400.
    const response = await request(app).get("/api/canva/connect");
    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(response.body.error).toContain("임시값");
    expect(response.body.error).not.toContain("private-value");
  });

  it("does not show a saved refresh token as a working connection when app settings are invalid", async () => {
    const response = await request(app).get("/api/canva/status");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ configured: false, connected: false });
    expect(response.body.message).toContain("실제 Client ID");
    expect(JSON.stringify(response.body)).not.toMatch(/old-access|old-refresh|private-value/);
  });

  it("rejects stale tokens and code exchanges without contacting Canva or the database", async () => {
    const external = vi.fn();
    const db = {} as Parameters<typeof accessToken>[0];
    await expect(accessToken(db, external)).rejects.toThrow("임시값");
    await expect(exchangeCode(db, { code: "code", verifier: "verifier", redirectUri: "https://example.test/callback" }, external)).rejects.toThrow("임시값");
    expect(external).not.toHaveBeenCalled();
  });

  it("accepts non-placeholder identifiers without inventing a provider ID format", () => {
    vi.stubEnv("CANVA_CLIENT_ID", "actual-client-from-developer-portal");
    expect(canvaConfigured()).toBe(true);
    expect(canvaConfigurationProblem()).toBeNull();
    expect(canvaConnected()).toBe(true);
    vi.stubEnv("CANVA_CLIENT_SECRET", "   ");
    expect(canvaConfigured()).toBe(false);
    expect(canvaConnected()).toBe(false);
  });
});
