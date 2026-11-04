import { describe, expect, it } from "vitest";
import { publicationDraftSaveSchema, publicationKstDate, publicationOptionsSchema, samePublicationOptions, studioPublicationDraftSaveSchema } from "../shared/publicationDraft";
import { assertPublicationDraftIntent } from "../server/services/publicationDraft";

const options = { destinationIds: [7], timing: "later" as const, scheduledAtKst: "2028-02-29T09:30" };
const draft = { version: 3, options };
const now = new Date("2027-01-01T00:00:00Z");
const intent = { publicationDraftVersion: 3, destinationIds: [7], timing: "later" as const, scheduledAt: new Date("2028-02-29T00:30:00Z") };

describe("saved publication intent contracts", () => {
  it("interprets the input in Korea time and rejects calendar overflow", () => {
    expect(publicationKstDate(options.scheduledAtKst)?.toISOString()).toBe("2028-02-29T00:30:00.000Z");
    for (const value of ["2027-02-29T09:30", "2028-02-30T09:30", "2028-13-01T09:30", "2028-02-29T24:00", "2028-02-29T09:60", "2028-02-29T09:30Z", "2028-2-29T09:30", ""]) expect(publicationKstDate(value)).toBeNull();
  });
  it("allows incomplete or past intentions to be saved without approving them", () => {
    expect(publicationOptionsSchema.parse({ destinationIds: [], timing: "later", scheduledAtKst: "" })).toEqual({ destinationIds: [], timing: "later", scheduledAtKst: "" });
    expect(studioPublicationDraftSaveSchema.parse({ version: 0, options: { ...options, scheduledAtKst: "2000-01-01T00:00" } }).version).toBe(0);
    expect(publicationDraftSaveSchema.parse({ version: 0, captions: { instagram: "", telegram: "" } }).options).toBeUndefined();
  });
  it("rejects duplicate, invalid, oversized and extra input fields", () => {
    for (const destinationIds of [[7, 7], [0], [-1], [1.5], [2147483648]]) expect(publicationOptionsSchema.safeParse({ ...options, destinationIds }).success).toBe(false);
    expect(publicationOptionsSchema.safeParse({ ...options, scheduledAtKst: "not-a-date" }).success).toBe(false);
    expect(publicationOptionsSchema.safeParse({ ...options, channelId: 2 }).success).toBe(false);
  });
  it("treats only destination display order as immaterial", () => {
    expect(samePublicationOptions({ ...options, destinationIds: [7, 8] }, { ...options, destinationIds: [8, 7] })).toBe(true);
    expect(samePublicationOptions(options, { ...options, destinationIds: [8] })).toBe(false);
    expect(samePublicationOptions(options, { ...options, scheduledAtKst: "2028-02-29T09:31" })).toBe(false);
    expect(samePublicationOptions(undefined, options)).toBe(false);
  });
  it("accepts only the saved version and the exact selected accounts, mode and instant", () => {
    expect(() => assertPublicationDraftIntent(draft, intent, now)).not.toThrow();
    for (const patch of [{ publicationDraftVersion: 2 }, { publicationDraftVersion: undefined }, { destinationIds: undefined }, { destinationIds: [8] }, { timing: "now" as const }, { scheduledAt: new Date("2028-02-29T09:30:00Z") }]) {
      expect(() => assertPublicationDraftIntent(draft, { ...intent, ...patch }, now)).toThrow(expect.objectContaining({ status: 409 }));
    }
  });
  it("blocks empty selections, unfinished schedules and past schedules at approval", () => {
    for (const patch of [{ destinationIds: [] }, { scheduledAtKst: "" }, { scheduledAtKst: "2000-01-01T00:00" }]) {
      expect(() => assertPublicationDraftIntent({ ...draft, options: { ...options, ...patch } }, intent, now)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
  it("preserves caption-only clients while checking their supplied draft version", () => {
    expect(() => assertPublicationDraftIntent({ version: 3 }, { ...intent, publicationDraftVersion: undefined }, now)).not.toThrow();
    expect(() => assertPublicationDraftIntent(null, { ...intent, publicationDraftVersion: 0 }, now)).not.toThrow();
    expect(() => assertPublicationDraftIntent({ version: 3 }, { ...intent, publicationDraftVersion: 2 }, now)).toThrow(expect.objectContaining({ status: 409 }));
  });
  it("keeps an old entered date as editing data when now is selected", () => {
    expect(() => assertPublicationDraftIntent({ version: 3, options: { ...options, timing: "now", scheduledAtKst: "2000-01-01T00:00" } }, { ...intent, timing: "now", scheduledAt: now }, now)).not.toThrow();
  });
});
