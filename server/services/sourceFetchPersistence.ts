import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { sourceDocuments, type SourceDocument } from "../../shared/schema";
import type { ExtractResult } from "./extract";

export type SourceFetchAttemptOptions = { attemptStartedAt?: Date; attemptedAt?: Date };
const usableBody = (document: SourceDocument) => document.fetchStatus === "ok" && !!document.fetchedText?.trim() && !!document.contentHash;

/**
 * Fetch outside the transaction, then lock and re-read the shared cache before saving.
 * A delayed failure may describe this attempt, but may never erase another attempt's good body.
 * A result started before a more recent recorded attempt cannot replace an acquired body.
 * If no usable body exists, a late success can still recover it while retaining newer failure metadata.
 */
export async function persistSourceFetchAttempt(db: DB, sourceId: number, result: ExtractResult, options: SourceFetchAttemptOptions = {}) {
  const attemptedAt = options.attemptedAt ?? new Date();
  const attemptStartedAt = options.attemptStartedAt ?? attemptedAt;
  return db.transaction(async tx => {
    const [current] = await tx.select().from(sourceDocuments).where(eq(sourceDocuments.id, sourceId)).for("update");
    if (!current) throw new Error("원문 자료를 찾을 수 없습니다.");
    const previousStartedAt = typeof current.meta.lastFetchAttemptStartedAt === "string" ? Date.parse(current.meta.lastFetchAttemptStartedAt) : NaN;
    // Older installations only recorded completion time. Prefer preserving their newer cache too.
    const mostRecentAttempt = Number.isFinite(previousStartedAt) ? previousStartedAt : current.lastFetchedAt?.getTime();
    const olderThanLatestAttempt = mostRecentAttempt !== undefined && mostRecentAttempt > attemptStartedAt.getTime();
    // An older success may still recover the first usable body after a newer failure.
    // It may not replace a body that another attempt already acquired.
    const staleAttempt = olderThanLatestAttempt && (!result.ok || usableBody(current));
    if (staleAttempt) return { document: current, changed: false, preservedBody: !result.ok && usableBody(current), attemptSucceeded: result.ok, hasUsableBody: usableBody(current), staleAttempt: true };
    const preserve = !result.ok && usableBody(current);
    const { lastFetchFailure: _previousFailure, ...currentMeta } = current.meta;
    const meta = {
      ...currentMeta,
      lastFetchAttemptStartedAt: attemptStartedAt.toISOString(),
      lastFetchAttemptAt: attemptedAt.toISOString(),
      lastFetchAttemptStatus: result.ok ? "ok" : result.status,
      lastFetchAttemptError: result.ok ? null : result.error,
      ...(!result.ok ? { lastFetchFailure: { status: result.status, error: result.error, at: attemptedAt.toISOString() } } : {}),
      ...(olderThanLatestAttempt ? {
        lastFetchAttemptStartedAt: current.meta.lastFetchAttemptStartedAt ?? current.lastFetchedAt?.toISOString(),
        lastFetchAttemptAt: current.meta.lastFetchAttemptAt ?? current.lastFetchedAt?.toISOString(),
        lastFetchAttemptStatus: current.meta.lastFetchAttemptStatus ?? current.fetchStatus,
        lastFetchAttemptError: current.meta.lastFetchAttemptError ?? current.fetchError,
        ...(current.meta.lastFetchFailure ? { lastFetchFailure: current.meta.lastFetchFailure } : {}),
      } : {}),
      ...(result.ok ? { finalUrl: result.finalUrl, pageTitle: result.title } : {}),
    };
    const [document] = await tx.update(sourceDocuments).set(result.ok
      ? { fetchStatus: "ok", fetchError: null, fetchedText: result.text, contentHash: result.hash, attachments: result.attachments, lastFetchedAt: attemptedAt, updatedAt: attemptedAt, meta }
      : preserve ? { meta, updatedAt: attemptedAt }
        : { fetchStatus: result.status, fetchError: result.error, attachments: result.attachments ?? current.attachments, lastFetchedAt: attemptedAt, updatedAt: attemptedAt, meta }
    ).where(eq(sourceDocuments.id, sourceId)).returning();
    return { document, changed: result.ok && (current.contentHash !== result.hash || current.fetchedText !== result.text), preservedBody: preserve, attemptSucceeded: result.ok, hasUsableBody: usableBody(document), staleAttempt: false };
  });
}
