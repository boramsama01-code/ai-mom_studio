import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { publicationOptionsSchema, type PublicationCaptions, type PublicationOptions, type PublicationDraft, type StudioPublicationDraft } from "@shared/publicationDraft";
import { api, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { useDraftRecovery } from "./useDraftRecovery";

export type Captions = PublicationCaptions;
export type { PublicationDraft, PublicationOptions } from "@shared/publicationDraft";
type Editable = { captions?: Captions; options: PublicationOptions };
type Draft = Editable & { version: number };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const values = ({ captions, options }: Draft): Editable => ({ ...(captions ? { captions } : {}), options });
const normalized = (draft: PublicationDraft | StudioPublicationDraft, defaults: PublicationOptions): Draft => ({ ...draft, options: draft.options ?? defaults });

function parseRecovery(value: unknown): Editable | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const options = publicationOptionsSchema.safeParse(record.options);
  if (!options.success) return null;
  if (record.captions !== undefined) {
    if (!record.captions || typeof record.captions !== "object") return null;
    const captions = record.captions as Record<string, unknown>;
    if (typeof captions.instagram !== "string" || typeof captions.telegram !== "string" || captions.instagram.length > 20_000 || captions.telegram.length > 20_000) return null;
    return { captions: { instagram: captions.instagram, telegram: captions.telegram }, options: options.data };
  }
  return { options: options.data };
}

/** Caption and publication choices share one independent CAS; neither changes image versions. */
function usePreparation({ incoming, defaults, path, detailPath, queryKey, guardKey, recoveryKey, ready = true }: {
  incoming: PublicationDraft | StudioPublicationDraft; defaults: PublicationOptions; path: string; detailPath: string;
  queryKey: QueryKey; guardKey: string; recoveryKey: string;
  ready?: boolean;
}) {
  const qc = useQueryClient(), guard = useDirtyGuard();
  const initial = normalized(incoming, defaults);
  const [base, setBase] = useState(initial), baseRef = useRef(initial);
  const [hasOptions, setHasOptions] = useState(!!incoming.options), persistedOptions = useRef(!!incoming.options);
  const [value, setValue] = useState(values(initial)), valueRef = useRef(value);
  const [saving, setSaving] = useState(false), [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState<Draft | null>(null);
  const conflictRef = useRef<Draft | null>(null); conflictRef.current = conflict;
  const conflictHasOptions = useRef(false);
  const inFlight = useRef<Promise<Draft> | null>(null);
  const dirty = !equal(value, values(base)) || (!!conflict && !equal(value, values(conflict)));
  const put = (next: Editable) => { valueRef.current = next; setValue(next); setError(null); };
  const adopt = (next: Draft, savedOptions = true) => {
    baseRef.current = next; setBase(next); persistedOptions.current = savedOptions; setHasOptions(savedOptions);
    put(values(next)); conflictRef.current = null; setConflict(null);
  };
  const recovery = useDraftRecovery<Editable>({
    recoveryKey, label: "게시 준비", version: base.version, serverValue: values(base), value, dirty, ready,
    parse: value => { const parsed = parseRecovery(value); return parsed && (!!parsed.captions === !!baseRef.current.captions) ? parsed : null; },
    onRestore: put,
  });
  const incomingSignature = JSON.stringify({ ...initial, hasOptions: !!incoming.options });
  useEffect(() => {
    if (!ready) return;
    const next = normalized(incoming, defaults);
    if (next.version < baseRef.current.version) return;
    if (equal(next, baseRef.current) && persistedOptions.current === !!incoming.options) return;
    if (equal(valueRef.current, values(baseRef.current))) adopt(next, !!incoming.options);
    else { conflictHasOptions.current = !!incoming.options; conflictRef.current = next; setConflict(next); }
  }, [incomingSignature, ready]);

  async function save(allowConflict = false): Promise<Draft> {
    if (!ready) throw new Error("저장된 게시 준비를 불러온 뒤 다시 시도해 주세요.");
    if (recovery.pending) throw new Error("이 기기의 복구본을 먼저 확인해 주세요.");
    if (inFlight.current) { await inFlight.current; return save(allowConflict); }
    if (conflictRef.current && !allowConflict) throw new Error("다른 곳에서 저장한 게시 준비와 비교한 뒤 저장해 주세요.");
    const expected = baseRef.current, snapshot = valueRef.current;
    if (persistedOptions.current && expected.version > 0 && equal(snapshot, values(expected))) return expected;
    setSaving(true); setError(null);
    const request = api<Draft>(path, { method: "PATCH", body: { version: expected.version, ...snapshot } });
    inFlight.current = request;
    try {
      const saved = await request;
      if (!saved.options) throw new Error("게시 계정과 시각의 저장을 확인하지 못했습니다. 입력을 유지했으니 다시 확인해 주세요.");
      const cached = qc.getQueryData<{ publicationDraft?: PublicationDraft | StudioPublicationDraft }>(queryKey)?.publicationDraft;
      const newer = [baseRef.current, conflictRef.current, cached ? normalized(cached, expected.options) : null]
        .filter((candidate): candidate is Draft => !!candidate && candidate.version > saved.version)
        .sort((a, b) => b.version - a.version)[0];
      if (newer) {
        // A late PATCH response cannot erase a newer version already observed by polling.
        if (equal(valueRef.current, values(newer))) { adopt(newer); recovery.clear(); return newer; }
        conflictHasOptions.current = true; conflictRef.current = newer; setConflict(newer);
        throw new Error("저장하는 동안 다른 곳에서 게시 준비를 변경했습니다. 내 입력과 최신 저장본을 비교해 주세요.");
      }
      baseRef.current = saved; setBase(saved); persistedOptions.current = true; setHasOptions(true);
      if (equal(snapshot, valueRef.current)) { put(values(saved)); recovery.clear(); }
      conflictRef.current = null; setConflict(null);
      qc.setQueryData(queryKey, (detail: (Record<string, unknown> & { publicationDraft?: { version: number } }) | undefined) =>
        detail && (detail.publicationDraft?.version ?? 0) <= saved.version ? { ...detail, publicationDraft: saved } : detail);
      // A preparation change can revoke queued approvals; refresh their visible state too.
      void qc.invalidateQueries({ queryKey });
      return saved;
    } catch (caught) {
      setError(caught as Error);
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const fresh = await api<{ publicationDraft: PublicationDraft | StudioPublicationDraft }>(detailPath);
          if (fresh.publicationDraft) { const next = normalized(fresh.publicationDraft, expected.options); conflictHasOptions.current = !!fresh.publicationDraft.options; conflictRef.current = next; setConflict(next); }
        } catch { /* Keep both the input and the original save error. */ }
      }
      throw caught;
    } finally { inFlight.current = null; setSaving(false); }
  }
  const saveRef = useRef(save); saveRef.current = save;
  const saveForLeave = useCallback(async () => {
    try { await saveRef.current(); return equal(valueRef.current, values(baseRef.current)); }
    catch { return false; }
  }, []);
  useEffect(() => {
    guard.setDirty(guardKey, dirty || saving || !!recovery.pending, saveForLeave, () => { recovery.clear(); adopt(baseRef.current, persistedOptions.current); });
    return () => guard.setDirty(guardKey, false);
  }, [guard, guardKey, dirty, saving, recovery.pending, saveForLeave]);
  const saveMine = async () => {
    if (!conflictRef.current) return;
    persistedOptions.current = conflictHasOptions.current; setHasOptions(conflictHasOptions.current);
    baseRef.current = conflictRef.current; setBase(conflictRef.current); conflictRef.current = null; setConflict(null);
    await save(true);
  };
  return {
    ...value, setCaptions: (captions: Captions) => put({ ...valueRef.current, captions }),
    setOptions: (options: PublicationOptions) => put({ ...valueRef.current, options: { ...options, destinationIds: [...options.destinationIds].sort((a, b) => a - b) } }),
    version: base.version, dirty, needsSave: dirty || !hasOptions || base.version === 0, saving, error, conflict, recovery, save, saveMine,
    acceptServer: () => { if (conflictRef.current) { recovery.clear(); adopt(conflictRef.current, conflictHasOptions.current); } },
  };
}

export function usePublicationDraft(channelId: number, itemId: number, incoming: PublicationDraft, defaults: PublicationOptions) {
  const draft = usePreparation({ incoming, defaults, path: `/channels/${channelId}/items/${itemId}/publication-draft`,
    detailPath: `/channels/${channelId}/items/${itemId}`, queryKey: ["ch", channelId, "item", itemId],
    guardKey: `publication-draft-${channelId}-${itemId}`, recoveryKey: `item:${channelId}:${itemId}:publication` });
  return { ...draft, captions: draft.captions! };
}

export function useStudioPublicationDraft(cardId: number, channel: string, incoming: StudioPublicationDraft, defaults: PublicationOptions, ready = true) {
  return usePreparation({ incoming, defaults, path: `/studio/cards/${cardId}/publication-draft`,
    detailPath: `/studio/cards/${cardId}/publication`, queryKey: ["studio-publication", cardId, channel],
    guardKey: `studio-publication-${cardId}`, recoveryKey: `studio:${cardId}:publication`, ready });
}
