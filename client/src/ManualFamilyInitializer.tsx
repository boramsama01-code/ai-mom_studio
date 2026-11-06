import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { familyCardCopySchema, familyFieldDescriptors, familyFieldValue, FAMILY_PAGE_LABELS, type CardCopyV2, type FamilyPage } from "@shared/familyDialogue";
import { familyManualCreateSchema, familyManualInitializeSchema, familyManualReceiptSchema, familyManualFactBindingSchema, type FamilyManualCreate, type FamilyManualReceipt } from "@shared/familyManual";
import { familyDisplayDescriptors, resolveFamilyDisplay, type FamilyDisplayKey } from "@shared/familyDisplay";
import { READING_CARD_PROFILES, readingProfileForTemplateKey, readingDisplayDescriptors } from "@shared/readingCardProfiles";
import { api, ApiError } from "./api";
import { ErrorBox } from "./ui";
import { useDirtyGuard } from "./state";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import "./manualFamily.css";

type FactBinding = FamilyManualCreate["factBindings"][number];
type ConceptMode = "value_definition" | "scientific_explanation";
type Draft = Pick<FamilyManualCreate, "title" | "copy" | "source" | "factBindings"> & { conceptAlternatives?: Partial<Record<ConceptMode, { page: FamilyPage; binding?: FactBinding }>> };
type Props = { channelId: number; channelName: string; initialTitle?: string; templateKey?: string; logoAssetId?: string; existing?: { itemId: number; version: number }; onSaved: (receipt: FamilyManualReceipt) => void; onBack: () => void };
const factPath = (index: number) => `pages.news_summary.fields.facts.${index}` as FamilyManualCreate["factBindings"][number]["fieldPath"];
const binding = (index: number): FamilyManualCreate["factBindings"][number] => ({ fieldPath: factPath(index), excerpt: "", claimType: "reported_event" });
function initialDraft(props: Props): Draft {
  const page = (id: FamilyPage["id"], index: number, fields: unknown): FamilyPage => ({ id, type: id, page: index + 1, layout: id, fields, claimRefs: [] }) as FamilyPage;
  return { title: props.initialTitle ?? "", source: { title: "", text: "" }, factBindings: [binding(0), binding(1)], copy: { version: 2, formatId: "family_dialogue_8", templateKey: readingProfileForTemplateKey(props.templateKey)?.templateKey ?? "cardnews14-cobalt-paper-v1", pages: [
    page("cover", 0, { headline: props.initialTitle ?? "", subtitle: "" }), page("news_summary", 1, { title: "자료 요약", facts: ["", ""], caveat: null }),
    page("implication", 2, { title: "자료의 의미", takeaway: "" }), page("discussion", 3, { title: "함께 나눌 질문", scenario: null, question: "" }),
    page("perspectives", 4, { title: "두 가지 시선", viewA: { label: "", body: "" }, viewB: { label: "", body: "" } }),
    page("concept", 5, { mode: "value_definition", title: "개념 다듬기", concept: "", definitionA: "", definitionB: "", boundaryCase: "", fillIn: "" }),
    page("activity", 6, { title: "작은 활동", homeActivity: { label: "", action: "", resourceId: null }, optionalActivity: null }),
    page("outro", 7, { brandName: props.channelName, parentBrand: "우주펭귄상회", brandLine: "오늘, 서로의 어떤 생각을 발견했나요?", cta: "다음 대화를 위해 저장해 두세요.", handle: "", logoAssetId: props.logoAssetId ?? null }),
  ] } };
}
const looseBinding = familyManualFactBindingSchema.safeExtend({ excerpt: z.string().max(600), speaker: z.string().max(200).nullable().optional(), timeScope: z.string().max(300).nullable().optional() });
const draftSchema = z.object({ title: z.string().max(200), copy: z.unknown(), source: z.object({ title: z.string().max(1000), text: z.string().max(100_000), url: z.string().max(4000).optional() }).strict(), factBindings: z.array(looseBinding).min(2).max(4), conceptAlternatives: z.partialRecord(z.enum(["value_definition", "scientific_explanation"]), z.object({ page: z.unknown(), binding: looseBinding.optional() }).strict()).optional() }).strict();
function parseDraft(value: unknown): Draft | null {
  const parsed = draftSchema.safeParse(value); if (!parsed.success) return null;
  // Check the complete structural schema while allowing unfinished text fields
  // in a device checkpoint. The actual save still uses the unmodified schema.
  try {
    const structural = (copy: unknown) => familyCardCopySchema.safeParse(JSON.parse(JSON.stringify(copy, (_key, entry) => entry === "" ? "_" : entry)));
    if (!structural(parsed.data.copy).success) return null;
    for (const [mode, alternative] of Object.entries(parsed.data.conceptAlternatives ?? {})) {
      const check = structural({ ...(parsed.data.copy as CardCopyV2), pages: (parsed.data.copy as CardCopyV2).pages.map(page => page.id === "concept" ? alternative.page : page) });
      if (!check.success || check.data.pages[5].id !== "concept" || check.data.pages[5].fields.mode !== mode) return null;
    }
  }
  catch { return null; }
  return parsed.data as Draft;
}
const receiptRequestSchema = z.object({ body: z.union([familyManualCreateSchema, familyManualInitializeSchema]) }).strict();
type Pending = z.infer<typeof receiptRequestSchema>;

export function ManualFamilyInitializer(props: Props) {
  const qc = useQueryClient();
  const subscribe = useCallback((notify: () => void) => qc.getQueryCache().subscribe(event => { if (event.query.queryKey[0] === "me") notify(); }), [qc]);
  const scope = useSyncExternalStore(subscribe, () => { const me = qc.getQueryData<{ user?: string; recoveryScope?: string }>(["me"]); return JSON.stringify([me?.user ?? null, me?.recoveryScope ?? null]); }, () => "[]");
  return <ManualFamilyForm key={`${scope}:${props.channelId}:${props.existing?.itemId ?? "new"}`} {...props} scope={scope} />;
}
function ManualFamilyForm({ scope, ...props }: Props & { scope: string }) {
  const qc = useQueryClient(), guard = useDirtyGuard(), baseline = useRef(initialDraft(props)).current;
  const receiptKey = `spacepenguin.manual-family:${scope}:${props.channelId}:${props.existing?.itemId ?? "new"}`;
  const [pending, setPending] = useState<Pending | null>(() => { try { const result = receiptRequestSchema.safeParse(JSON.parse(sessionStorage.getItem(receiptKey) ?? "null")); return result.success ? result.data : null; } catch { return null; } });
  const [draft, setDraft] = useState<Draft>(() => pending ? { title: pending.body.title, copy: pending.body.copy, source: pending.body.source, factBindings: pending.body.factBindings } : baseline);
  const [selected, setSelected] = useState(0), [confirmed, setConfirmed] = useState(false), [error, setError] = useState<Error | null>(null), [completed, setCompleted] = useState(false);
  const active = useRef(true), busy = useRef(false), guardKey = `manual-family:${receiptKey}`;
  const editEpoch = useRef(0), importEpoch = useRef(0), latest = useRef({ locked: !!pending });
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const dirty = !completed && JSON.stringify(draft) !== JSON.stringify(baseline);
  const recovery = useDraftRecovery({ recoveryKey: `manual-family:${props.channelId}:${props.existing?.itemId ?? "new"}`, label: "직접 작성 8장 원고", version: props.existing?.version ?? 0, serverValue: baseline, value: draft, dirty, parse: parseDraft, onRestore: value => { if (!pending) { editEpoch.current++; setDraft(value); setConfirmed(false); } } });
  const keepPending = (value: Pending | null) => { editEpoch.current++; latest.current.locked = !!value || busy.current; setPending(value); try { if (value) sessionStorage.setItem(receiptKey, JSON.stringify(value)); else sessionStorage.removeItem(receiptKey); } catch { /* The exact request stays in memory. */ } };
  const request = useMutation({ retry: false, mutationFn: async (intent: Pending) => {
    const path = props.existing ? `/channels/${props.channelId}/items/${props.existing.itemId}/card-copy/manual-initialize` : `/channels/${props.channelId}/items/manual-family`;
    const receipt = familyManualReceiptSchema.parse(await api(path, { method: "POST", body: intent.body }));
    if (receipt.requestId !== intent.body.requestId || props.existing && receipt.itemId !== props.existing.itemId) throw new ApiError(502, "다른 원고의 저장 응답입니다. 입력과 같은 요청 번호를 유지하고 결과를 다시 확인해 주세요.");
    return receipt;
  }, onSuccess: receipt => {
    if (!active.current) return;
    setCompleted(true); keepPending(null); recovery.clear(); guard.setDirty(guardKey, false);
    void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["ch", props.channelId] });
    props.onSaved(receipt);
  }, onError: failure => {
    if (!active.current) return;
    setError(failure instanceof z.ZodError ? new ApiError(502, "저장 응답을 확인할 수 없습니다. 같은 요청 결과를 다시 확인해 주세요.") : failure as Error);
    if (failure instanceof ApiError && [400, 401, 403, 404, 409, 422, 429].includes(failure.status)) { keepPending(null); setConfirmed(false); }
  }, onSettled: () => { busy.current = false; } });
  latest.current.locked = !!pending || request.isPending || completed;
  useEffect(() => {
    guard.setDirty(guardKey, dirty || !!pending || request.isPending || !!recovery.pending, undefined, () => { if (!pending) recovery.clear(); });
    return () => guard.setDirty(guardKey, false);
  }, [guard, guardKey, dirty, pending, request.isPending, recovery.pending]);
  const update = (change: (value: Draft) => Draft) => { if (!active.current || latest.current.locked) return; editEpoch.current++; setDraft(change); setConfirmed(false); setError(null); };
  const putField = (path: string, value: string | null) => update(current => {
    const copy = structuredClone(current.copy), [, id, ...segments] = path.split("."), page = copy.pages.find(page => page.id === id)!;
    let object: any = page; for (const segment of segments.slice(0, -1)) object = object[segment]; object[segments.at(-1)!] = value;
    return { ...current, copy };
  });
  const editBinding = (path: string, change: Record<string, unknown>) => update(current => ({ ...current, factBindings: current.factBindings.map(value => value.fieldPath === path ? { ...value, ...change } : value) }));
  const switchConcept = (mode: ConceptMode) => update(current => {
    const copy = structuredClone(current.copy), old = copy.pages[5]; if (old.id !== "concept" || old.fields.mode === mode) return current;
    const path = "pages.concept.fields.acceptedDefinition", alternatives = { ...current.conceptAlternatives, [old.fields.mode]: { page: old, binding: current.factBindings.find(value => value.fieldPath === path) } };
    const previous = alternatives[mode], fields = { title: old.fields.title, concept: old.fields.concept, fillIn: old.fields.fillIn };
    const restored = previous?.page.id === "concept" ? previous.page.fields : null;
    copy.pages[5] = { ...old, fields: mode === "value_definition" ? { ...(restored?.mode === mode ? restored : { definitionA: "", definitionB: "", boundaryCase: "" }), ...fields, mode } : { ...(restored?.mode === mode ? restored : { acceptedDefinition: "", exampleOrNonExample: "" }), ...fields, mode } };
    return { ...current, copy, conceptAlternatives: alternatives, factBindings: [...current.factBindings.filter(value => value.fieldPath !== path), ...(mode === "scientific_explanation" ? [previous?.binding ?? { fieldPath: path as FactBinding["fieldPath"], excerpt: "", claimType: "reported_event" as const }] : [])] };
  });
  const submit = () => {
    if (busy.current || request.isPending || completed) return;
    let intent = pending;
    if (!intent) {
      if (!confirmed || recovery.pending) return;
      const raw = { title: draft.title, copy: draft.copy, source: draft.source, factBindings: draft.factBindings, requestId: crypto.randomUUID(), confirmed: true, ...(props.existing ? { version: props.existing.version } : {}) };
      const check = (props.existing ? familyManualInitializeSchema : familyManualCreateSchema).safeParse(raw);
      if (!check.success) { setError(new Error("입력하지 않은 필수 문구와 자료·근거 구절을 확인해 주세요. " + check.error.issues.slice(0, 3).map(issue => issue.message).join(" · "))); return; }
      intent = { body: check.data }; keepPending(intent);
    }
    busy.current = true; setError(null); request.mutate(intent);
  };
  const importFile = async (file: File | undefined) => {
    if (!file || latest.current.locked) return;
    const ticket = ++importEpoch.current, edits = editEpoch.current;
    const current = () => active.current && ticket === importEpoch.current && edits === editEpoch.current && !latest.current.locked;
    try {
      if (file.size > 600_000) throw new Error("원고 파일은 600KB 이내로 불러와 주세요.");
      const raw = JSON.parse(await file.text());
      if (!current()) return;
      const checked = familyManualCreateSchema.parse({ ...raw, requestId: crypto.randomUUID(), confirmed: true });
      update(() => ({ title: checked.title, copy: checked.copy, source: checked.source, factBindings: checked.factBindings })); setSelected(0);
    } catch { if (current()) setError(new Error("8장 원고 파일의 문구·자료·근거 구절을 확인해 주세요. 현재 입력은 유지했습니다.")); }
  };
  const page = draft.copy.pages[selected], profile = readingProfileForTemplateKey(draft.copy.templateKey), locked = !!pending || request.isPending || completed;
  const displays = profile ? readingDisplayDescriptors(profile, page) : familyDisplayDescriptors(page), displayValues = resolveFamilyDisplay(page, { sourceCredit: "제공 문서 · 별도 검증 필요" });
  const currentBindings = draft.factBindings.filter(value => value.fieldPath.startsWith(`pages.${page.id}.`));
  return <section className="manual-family-initializer stack" aria-label="AI 없이 8장 원고 직접 작성">
    <p>직접 쓴 문구와 제공받은 자료로 새 8장 원고를 저장합니다. AI를 호출하지 않습니다. 자료에 적힌 내용과 별도로 검증한 사실은 구분하며, 이전 원고는 버전 기록에 남습니다.</p>
    {!pending && <RecoveryNotice recovery={recovery} formatValue={value => [value.title, value.source.title, value.source.text, ...value.copy.pages.map(page => FAMILY_PAGE_LABELS[page.id] + "\n" + JSON.stringify(page.fields))].join("\n\n")} />}
    <form className="stack" aria-label="직접 작성 8장 원고" onSubmit={event => { event.preventDefault(); submit(); }}>
      <fieldset disabled={locked || !!recovery.pending} className="stack manual-family-fields">
        <label className="field">작업 제목<input aria-label="8장 작업 제목" value={draft.title} maxLength={200} onChange={event => update(current => ({ ...current, title: event.target.value }))} /></label>
        <label className="field">8장 디자인<select aria-label="직접 작성 8장 디자인" value={draft.copy.templateKey} onChange={event => update(current => ({ ...current, copy: { ...current.copy, templateKey: event.target.value } }))}>{READING_CARD_PROFILES.map(profile => <option key={profile.id} value={profile.templateKey}>{profile.label}</option>)}</select></label>
        <details className="content-options" open><summary>제공 자료와 확인 범위</summary><div className="stack">
          <label className="field">제공 자료 제목<input aria-label="제공 자료 제목" value={draft.source.title} maxLength={1000} onChange={event => update(current => ({ ...current, source: { ...current.source, title: event.target.value } }))} /></label>
          <label className="field">제공 자료 주소 <span className="hint">선택 · 주소 입력만으로 조회하거나 검증하지 않습니다.</span><input aria-label="제공 자료 주소" type="url" inputMode="url" value={draft.source.url ?? ""} maxLength={4000} onChange={event => update(current => ({ ...current, source: { ...current.source, url: event.target.value || undefined } }))} /></label>
          <label className="field">제공 자료 본문<textarea aria-label="제공 자료 본문" value={draft.source.text} rows={6} maxLength={100_000} onChange={event => update(current => ({ ...current, source: { ...current.source, text: event.target.value } }))} /></label>
          <p className="hint">템플릿 예시라면 자료 제목과 본문에 예시임을 남겨 주세요. 실제 뉴스·연구를 확인한 기록이나 AI 작성 기록으로 표시하지 않습니다.</p>
        </div></details>
        <nav className="manual-family-pages" aria-label="직접 작성할 8장">{draft.copy.pages.map((value, index) => <button type="button" key={value.id} className="btn sm" aria-current={selected === index ? "step" : undefined} onClick={() => setSelected(index)}>{index + 1} {FAMILY_PAGE_LABELS[value.id]}</button>)}</nav>
        <h3>{selected + 1} / 8 · {FAMILY_PAGE_LABELS[page.id]}</h3>
        {page.id === "concept" && <label className="field">개념 설명 방식<select aria-label="직접 작성 개념 설명 방식" value={page.fields.mode} onChange={event => switchConcept(event.target.value as ConceptMode)}><option value="value_definition">다른 정의를 비교하기</option><option value="scientific_explanation">자료에서 확인한 과학 개념 설명</option></select></label>}
        {familyFieldDescriptors(page).map(field => {
          const value = familyFieldValue(draft.copy, field.fieldPath);
          const inputText = (text: string) => text || (["pages.news_summary.fields.caveat", "pages.discussion.fields.scenario"].includes(field.fieldPath) ? null : "");
          const maxLength = field.fieldPath === "pages.discussion.fields.question" ? 300 : field.fieldPath === "pages.concept.fields.concept" ? 100 : field.manualMax;
          return Array.isArray(value) ? <div key={field.path} className="stack">{value.map((text, index) => <label className="field" key={index}>{field.label} {index + 1}<textarea aria-label={`${field.label} ${index + 1}`} value={text} maxLength={1000} rows={3} onChange={event => putField(`${field.fieldPath}.${index}`, event.target.value)} /></label>)}{value.length === 2 && <button className="btn sm" type="button" onClick={() => update(current => { const copy = structuredClone(current.copy); if (copy.pages[1].id === "news_summary") copy.pages[1].fields.facts.push(""); return { ...current, copy, factBindings: [...current.factBindings, binding(2)] }; })}>세 번째 요약 문구 추가</button>}</div> : <label className="field" key={field.path}>{field.label}{!field.required && <span className="hint">선택</span>}<textarea aria-label={field.label} value={typeof value === "string" ? value : ""} rows={field.kind === "textarea" ? 3 : 2} maxLength={maxLength} onChange={event => putField(field.fieldPath, inputText(event.target.value))} /></label>;
        })}
        {currentBindings.map((value, index) => <fieldset key={value.fieldPath} className="stack manual-family-binding"><legend>{page.id === "concept" ? "통용 정의" : `요약 문구 ${index + 1}`}의 제공 자료 근거</legend>
          <label className="field">문구의 성격<select aria-label={`근거 ${index + 1} 문구의 성격`} value={value.claimType} onChange={event => editBinding(value.fieldPath, { claimType: event.target.value })}><option value="reported_event">사실·보고</option><option value="research_finding">연구 결과</option><option value="attributed_statement">누군가의 발언</option><option value="forecast">미래 전망</option></select></label>
          <label className="field">자료에서 직접 옮긴 구절<textarea aria-label={`근거 ${index + 1} 원문 구절`} value={value.excerpt} maxLength={600} rows={3} onChange={event => editBinding(value.fieldPath, { excerpt: event.target.value })} /></label>
          {(value.claimType === "attributed_statement" || value.claimType === "forecast") && <label className="field">발언자<input aria-label={`근거 ${index + 1} 발언자`} value={value.speaker ?? ""} maxLength={200} onChange={event => editBinding(value.fieldPath, { speaker: event.target.value || null })} /></label>}
          <label className="field">시점·범위 <span className="hint">선택</span><input aria-label={`근거 ${index + 1} 시점·범위`} value={value.timeScope ?? ""} maxLength={300} onChange={event => editBinding(value.fieldPath, { timeScope: event.target.value || null })} /></label>
          <label className="field">확인할 조건 <span className="hint">선택 · 한 줄에 하나씩</span><textarea aria-label={`근거 ${index + 1} 조건`} value={(value.conditions ?? []).join("\n")} rows={2} maxLength={3207} onChange={event => editBinding(value.fieldPath, { conditions: event.target.value.split("\n").filter(line => line.trim()) })} /></label>
          <p className="hint">위 제공 자료에 실제로 있는 구절을 연결합니다. 제공 자료만 확인한 기록이며 독립 검증 완료로 표시하지 않습니다.</p>
        </fieldset>)}
        <details className="content-options"><summary>이 장의 표시 문구 · 선택</summary><div className="stack">{displays.map(field => <label className="field" key={field.key}>{field.label}<input aria-label={`직접 작성 ${field.label}`} value={displayValues[field.key]} maxLength={field.max} onChange={event => update(current => ({ ...current, copy: { ...current.copy, pages: current.copy.pages.map(value => value.id === page.id ? { ...value, displayOverrides: { ...value.displayOverrides, [field.key as FamilyDisplayKey]: event.target.value } } : value) } }))} /></label>)}</div></details>
        <div className="row"><button type="button" className="btn" disabled={selected === 0} onClick={() => setSelected(value => value - 1)}>이전 장</button><button type="button" className="btn" disabled={selected === 7} onClick={() => setSelected(value => value + 1)}>다음 장</button></div>
        <details className="content-options"><summary>8장 원고 파일에서 불러오기</summary><p className="hint">문구·제공 자료·근거 구절이 담긴 원고 파일(.json)을 불러옵니다. 불러오기는 입력에만 반영하며 서버에 저장하지 않습니다.</p><input aria-label="8장 원고 파일" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} /></details>
        <label className="check manual-family-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>8장 문구와 제공 자료의 근거 구절을 직접 대조했습니다. 예시·발언·전망을 검증된 뉴스로 바꾸지 않으며 검토·승인은 별도로 진행합니다.</span></label>
      </fieldset>
      {pending && <p className="notice warn" role="status">원고 저장 응답을 아직 확인하지 못했습니다. 입력을 보존하고 같은 요청 번호로 결과부터 확인합니다. 새 원고를 중복으로 만들지 않습니다.</p>}
      {error && <ErrorBox error={error} />}
      <div className="row manual-family-actions"><button className="btn primary" type="submit" disabled={request.isPending || completed || !pending && (!confirmed || !!recovery.pending)}>{request.isPending ? "원고 저장 확인 중…" : pending ? "8장 원고 저장 결과 확인" : props.existing ? "직접 쓴 8장을 새 버전으로 저장·전환" : "직접 쓴 8장 원고 저장"}</button><button className="btn" type="button" disabled={request.isPending} onClick={() => guard.confirmLeave(props.onBack, [guardKey])}>이전으로</button></div>
      <p className="hint">저장 후 8장 편집기에서 미리보기·문구 수정·Canva 사본 가져오기를 이어갑니다. 자동 채우기·유료 AI·게시를 실행하지 않습니다.</p>
    </form>
  </section>;
}
