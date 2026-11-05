import { z } from "zod";
import { cardCopySchema, type CardCopy } from "./cardCopy";
import { familyCardCopySchema, type CardCopyV2 } from "./familyDialogue";

/** Preserve the legacy CardCopy alias. New boundaries explicitly opt into both versions. */
export const storedCardCopySchema = z.union([cardCopySchema, familyCardCopySchema]);
export type StoredCardCopy = CardCopy | CardCopyV2;
export function storedCardCopyFromStored(payload: Record<string, unknown>): StoredCardCopy | undefined {
  return payload.cardCopy === undefined ? undefined : storedCardCopySchema.parse(payload.cardCopy);
}
