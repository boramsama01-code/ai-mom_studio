import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { operatorCredentials, operatorPasswordResets } from "../../shared/schema";
import { passwordError } from "../../shared/password";
import { HttpError } from "../routes/util";

const invalidLink = () => new HttpError(400, "설정 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요.");
export const resetTokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function operatorCredential(db: DB) {
  const [row] = await db.select().from(operatorCredentials).where(eq(operatorCredentials.username, env.adminUsername));
  return { passwordHash: row?.passwordHash || env.adminPasswordHash, version: row?.version ?? 0, blockedPrivateLinkHash: row?.blockedPrivateLinkHash ?? null, changedAt: row?.passwordHash ? row.updatedAt : null };
}

function resetFilter(token: string, version: number) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidLink();
  return and(eq(operatorPasswordResets.tokenHash, resetTokenHash(token)), eq(operatorPasswordResets.username, env.adminUsername), eq(operatorPasswordResets.credentialVersion, version), gt(operatorPasswordResets.expiresAt, new Date()), isNull(operatorPasswordResets.usedAt));
}

export async function checkPasswordReset(db: DB, token: string) {
  const credential = await operatorCredential(db);
  const [row] = await db.select({ expiresAt: operatorPasswordResets.expiresAt }).from(operatorPasswordResets).where(resetFilter(token, credential.version));
  if (!row) throw invalidLink();
  return { username: env.adminUsername, expiresAt: row.expiresAt.toISOString() };
}

/** Serialize password updates per operator; a racing reset/change cannot revive a stale token. */
export async function setOperatorPassword(db: DB, input: { password: string; token?: string; currentPassword?: string; expectedVersion?: number }) {
  const error = passwordError(input.password);
  if (error) throw new HttpError(400, error);
  if (input.token !== undefined) await checkPasswordReset(db, input.token);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try { await db.transaction(async tx => {
    await tx.insert(operatorCredentials).values({ username: env.adminUsername }).onConflictDoNothing();
    const [credential] = await tx.select().from(operatorCredentials).where(eq(operatorCredentials.username, env.adminUsername)).for("update");
    if (input.token !== undefined) {
      const used = await tx.update(operatorPasswordResets).set({ usedAt: new Date() }).where(resetFilter(input.token, credential.version)).returning({ tokenHash: operatorPasswordResets.tokenHash });
      if (!used.length) throw invalidLink();
    } else {
      if (input.expectedVersion !== credential.version || !input.currentPassword || !(await bcrypt.compare(input.currentPassword, credential.passwordHash || env.adminPasswordHash))) throw new HttpError(400, "현재 비밀번호가 일치하지 않습니다.");
    }
    await tx.update(operatorCredentials).set({ passwordHash, version: credential.version + 1, blockedPrivateLinkHash: env.privateLinkHash || null, updatedAt: new Date() }).where(eq(operatorCredentials.username, env.adminUsername));
    await audit(tx, { actor: env.adminUsername, action: input.token !== undefined ? "password_reset" : "password_change", entity: "operator_account" });
  }); } catch (error) {
    if (error instanceof HttpError) throw error;
    // Do not let database query errors log credential hashes or reset metadata.
    throw new HttpError(503, "비밀번호를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
