import { AsyncLocalStorage } from "node:async_hooks";
import type { DB } from "../db";

type GenerationContext = {
  signal: AbortSignal;
  assertActive: (db: DB) => Promise<void>;
  complete?: (db: DB, response: Record<string, unknown>) => Promise<void>;
};
const context = new AsyncLocalStorage<GenerationContext>();

export function withGenerationContext<T>(value: GenerationContext, work: () => Promise<T>) {
  return context.run(value, work);
}
export const currentGenerationSignal = () => context.getStore()?.signal;

/** Called after the item/card lock, before applying an AI result. */
export async function assertGenerationActive(db: DB) {
  const active = context.getStore();
  active?.signal.throwIfAborted();
  await active?.assertActive(db);
  active?.signal.throwIfAborted();
}

/** Save the replayable response in the same transaction as the content revision. */
export async function completeGenerationResult(db: DB, response: Record<string, unknown>) {
  const active = context.getStore();
  if (!active?.complete) return;
  active.signal.throwIfAborted();
  await active.complete(db, response);
}
