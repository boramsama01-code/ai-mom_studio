import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useDirtyGuard } from "./state";

export type Captions = { instagram: string; telegram: string };
export type PublicationDraft = { version: number; captions: Captions };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Captions have their own CAS version; saving them never changes the image revision. */
export function usePublicationDraft(channelId: number, itemId: number, incoming: PublicationDraft) {
  const qc = useQueryClient(), guard = useDirtyGuard();
  const [base, setBase] = useState(incoming), baseRef = useRef(incoming);
  const [captions, setValue] = useState(incoming.captions), valueRef = useRef(incoming.captions);
  const [saving, setSaving] = useState(false), [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState<PublicationDraft | null>(null);
  const inFlight = useRef<Promise<PublicationDraft> | null>(null);
  const dirty = !equal(captions, base.captions);
  const setCaptions = (next: Captions) => { valueRef.current = next; setValue(next); setError(null); };
  const adopt = (next: PublicationDraft) => {
    baseRef.current = next; setBase(next); setCaptions(next.captions); setConflict(null);
  };
  useEffect(() => {
    if (incoming.version < baseRef.current.version) return;
    if (equal(incoming, baseRef.current)) return;
    if (equal(valueRef.current, baseRef.current.captions)) adopt(incoming);
    else if (incoming.version > baseRef.current.version) setConflict(incoming);
  }, [incoming.version, incoming.captions.instagram, incoming.captions.telegram]);

  async function save(allowConflict = false): Promise<PublicationDraft> {
    if (inFlight.current) { await inFlight.current; return save(allowConflict); }
    if (conflict && !allowConflict) throw new Error("다른 곳에서 저장한 캡션과 비교한 뒤 저장해 주세요.");
    const expected = baseRef.current, snapshot = valueRef.current;
    if (expected.version > 0 && equal(snapshot, expected.captions)) return expected;
    setSaving(true); setError(null);
    const request = api<PublicationDraft>(`/channels/${channelId}/items/${itemId}/publication-draft`, {
      method: "PATCH", body: { version: expected.version, captions: snapshot },
    });
    inFlight.current = request;
    try {
      const saved = await request;
      baseRef.current = saved; setBase(saved);
      if (equal(snapshot, valueRef.current)) setCaptions(saved.captions);
      setConflict(null);
      qc.setQueryData(["ch", channelId, "item", itemId], (detail: Record<string, unknown> | undefined) => detail ? { ...detail, publicationDraft: saved } : detail);
      return saved;
    } catch (caught) {
      setError(caught as Error);
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const fresh = await api<{ publicationDraft: PublicationDraft }>(`/channels/${channelId}/items/${itemId}`);
          if (fresh.publicationDraft) setConflict(fresh.publicationDraft);
        } catch { /* Keep both the input and the original save error. */ }
      }
      throw caught;
    } finally { inFlight.current = null; setSaving(false); }
  }
  const saveRef = useRef(save); saveRef.current = save;
  const saveForLeave = useCallback(async () => {
    try { await saveRef.current(); return equal(valueRef.current, baseRef.current.captions); }
    catch { return false; }
  }, []);
  useEffect(() => {
    const key = `publication-draft-${channelId}-${itemId}`;
    guard.setDirty(key, dirty || saving, saveForLeave, () => adopt(baseRef.current));
    return () => guard.setDirty(key, false);
  }, [guard, channelId, itemId, dirty, saving, saveForLeave]);
  const saveMine = async () => {
    if (!conflict) return;
    baseRef.current = conflict; setBase(conflict); setConflict(null);
    await save(true);
  };
  return { captions, setCaptions, version: base.version, dirty, needsSave: dirty || base.version === 0, saving, error, conflict, save, saveMine, acceptServer: () => { if (conflict) adopt(conflict); } };
}
