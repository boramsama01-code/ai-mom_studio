import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DB } from "../server/db";
import { __setOriginalEnvForTest, decryptValue, saveSecret } from "../server/secretStore";

const key = "IG_TEST_CHANNEL_ACCESS_TOKEN";
beforeEach(() => { process.env.APP_SESSION_SECRET = "test-only-secret-key-long-enough"; delete process.env.APP_SECRETS_KEY; delete process.env[key]; __setOriginalEnvForTest([]); });
afterEach(() => { delete process.env[key]; });

it("defers live credential activation until the enclosing transaction commits", async () => {
  let encrypted: any;
  const db = { insert: () => ({ values: (value: unknown) => { encrypted = value; return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }; } }) } as unknown as DB;
  const activate = await saveSecret(db, key, "test-only-token", "test", { activate: false });
  expect(process.env[key]).toBeUndefined();
  expect(encrypted.ciphertext).not.toContain("test-only-token");
  expect(decryptValue(encrypted)).toBe("test-only-token");
  activate();
  expect(process.env[key]).toBe("test-only-token");
});

it("does not activate a credential when persistence fails", async () => {
  process.env[key] = "previous-token";
  const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("database failure")) }) }) } as unknown as DB;
  await expect(saveSecret(db, key, "new-token", "test", { activate: false })).rejects.toThrow("database failure");
  expect(process.env[key]).toBe("previous-token");
});
