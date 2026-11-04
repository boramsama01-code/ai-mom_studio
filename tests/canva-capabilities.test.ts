import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configured: true, connected: true, capabilities: vi.fn(), mutation: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: () => ({}) }));
vi.mock("../server/services/canva", async original => ({ ...await original<object>(), canvaConfigured: () => state.configured, canvaConnected: () => state.connected }));
vi.mock("../server/services/canvaRest", async original => ({ ...await original<object>(), getCanvaCapabilities: state.capabilities }));
vi.mock("../server/services/canvaEditorial", () => ({ registerCanvaMaster: state.mutation, canvaMasterDto: state.mutation, enqueueCanvaRender: state.mutation, canvaJobDto: state.mutation, acceptCanvaImport: state.mutation, cancelCanvaJob: state.mutation, resumeCanvaJob: state.mutation, selectLocalRenderer: state.mutation }));
vi.mock("../server/services/canvaReconciliation", () => ({ reconcileCanvaJob: state.mutation }));
vi.mock("../server/worker/canva", () => ({ kickCanvaJobs: state.mutation }));
import { CanvaRestError } from "../server/services/canvaRest";
import { canvaEditorialRoutes } from "../server/routes/canvaEditorial";
import { canvaConnectionStatusSchema } from "../shared/canvaCapabilities";

const app = express().use("/api", canvaEditorialRoutes);
beforeEach(() => {
  state.configured = true; state.connected = true; state.capabilities.mockReset(); state.mutation.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Capability status tests must not call external services"); }));
});
afterEach(() => { expect(state.mutation).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("read-only Canva capability status", () => {
  it.each([
    { capabilities: ["autofill", "brand_template"], capabilityStatus: "available", autofill: true, reason: null },
    { capabilities: [], capabilityStatus: "unavailable", autofill: false, reason: "capability_missing" },
  ])("reports confirmed $capabilityStatus separately from connection presence", async expected => {
    state.capabilities.mockResolvedValue({ capabilities: expected.capabilities });
    const response = await request(app).get("/api/canva/editorial/status");
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ configured: true, connected: true, ...expected });
    expect(canvaConnectionStatusSchema.parse(response.body).checkedAt).toEqual(expect.any(String));
    expect(state.capabilities).toHaveBeenCalledOnce();
  });
  it.each([
    new CanvaRestError("연결 권한을 다시 승인해 주세요.", 403, "permission_denied", false, null, { reason: "missing_scope", providerCode: "missing_scope" }),
    new CanvaRestError("Canva 기능 응답을 확인할 수 없습니다.", 502, "invalid_response"),
    new CanvaRestError("Canva에 잠시 연결할 수 없습니다.", 503, "provider_unavailable"),
  ])("returns unknown rather than a false plan diagnosis for $reason", async error => {
    state.capabilities.mockRejectedValue(error);
    const response = await request(app).get("/api/canva/editorial/status");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ connected: true, autofill: false, capabilityStatus: "unknown", reason: error.reason, message: error.message, providerCode: error.providerCode });
    expect(canvaConnectionStatusSchema.safeParse(response.body).success).toBe(true);
    expect(state.capabilities).toHaveBeenCalledOnce();
  });
  it("does not inspect a disconnected account or claim it lacks a paid capability", async () => {
    state.connected = false;
    const response = await request(app).get("/api/canva/editorial/status");
    expect(response.body).toMatchObject({ connected: false, autofill: false, capabilityStatus: "unknown", reason: "not_connected", checkedAt: null });
    expect(state.capabilities).not.toHaveBeenCalled();
  });
  it("keeps the original boolean connection contract parseable for older fixtures", () => {
    expect(canvaConnectionStatusSchema.safeParse({ configured: true, connected: true, autofill: true, capabilities: ["autofill"] }).success).toBe(true);
  });
});
