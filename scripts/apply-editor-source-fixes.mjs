import { readFileSync, writeFileSync } from 'node:fs';
function edit(path, changes) {
  let text = readFileSync(path, 'utf8');
  for (const [before, after] of changes) {
    if (text.includes(after)) continue;
    if (text.split(before).length !== 2) throw new Error(`Expected exactly one patch anchor: ${path}: ${before.slice(0, 90)}`);
    text = text.replace(before, after);
  }
  writeFileSync(path, text);
}
edit('client/src/pages/Studio.tsx', [
  ['const [textMode, setTextMode] = useState<"chatgpt" | "api">("chatgpt");', 'const [textMode, setTextMode] = useState<"chatgpt" | "api">("api");'],
  ['직접 쓰거나 ChatGPT 초안을 가져오세요.', 'API로 자동 작성하거나 ChatGPT 초안을 가져오세요.'],
  ['<button aria-pressed={textMode === "chatgpt"} onClick={() => setTextMode("chatgpt")}>ChatGPT로 초안 만들기</button><button aria-pressed={textMode === "api"} onClick={() => setTextMode("api")}>API 자동 작성</button>', '<button aria-pressed={textMode === "api"} onClick={() => setTextMode("api")}>API 자동 작성</button><button aria-pressed={textMode === "chatgpt"} onClick={() => setTextMode("chatgpt")}>ChatGPT로 초안 만들기</button>'],
  ['<div hidden={textMode !== "chatgpt"}><StudioTextImport content={form} channelName={channelName(form.channel)} disabled={busy || working || newer} apply={setForm} /></div>\n        <div className="stack" hidden={textMode !== "api"}>', '<div className="stack" hidden={textMode !== "api"} data-testid="studio-api-writing">'],
  ['        {archivedChannel && <p className="notice warn small">보관된 채널입니다.', '        <div hidden={textMode !== "chatgpt"}><StudioTextImport content={form} channelName={channelName(form.channel)} disabled={busy || working || newer} apply={setForm} /></div>\n        {archivedChannel && <p className="notice warn small">보관된 채널입니다.'],
  ['<details className="panel studio-work-status" open={working || undefined}>', '<details className="panel studio-work-status" open={working || !!generate.error || latestJob?.status === "failed" || latestJob?.result?.applied === false}>'],
]);
edit('client/src/pages/ItemDetail.tsx', [
  ['useCallback, useEffect, useMemo, useState', 'useCallback, useEffect, useMemo, useRef, useState'],
  ['function EditPanel({ d, cid }:', 'export function EditPanel({ d, cid }:'],
  ['  const base = useMemo(() => d.current?.payload ?? null, [d.current]);', '  const incoming = useMemo(() => d.current?.payload ?? null, [d.current]);\n  const [base, setBase] = useState<Record<string, any> | null>(incoming);\n  const submittedDraft = useRef<Record<string, any> | null>(null);'],
  ['    if (!dirty) {\n      setDraft(base);\n      setVersion(d.item.version);\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [base, d.item.version]);', '    // Compare edits with the accepted baseline, never with the newly arrived AI payload.\n    if (!dirty && d.item.version >= version) {\n      setBase(incoming);\n      setDraft(incoming);\n      setVersion(d.item.version);\n    }\n  }, [incoming, d.item.version, dirty, version]);'],
  ['    mutationFn: () => api<ContentItem>(`/channels/${cid}/items/${d.item.id}`, { method: "PATCH", body: { version, payload: cleanPayload(draft!), title: (draft?.title || draft?.key_question || d.item.title).toString().slice(0, 200) } }),', '    mutationFn: () => {\n      submittedDraft.current = draft;\n      return api<ContentItem>(`/channels/${cid}/items/${d.item.id}`, { method: "PATCH", body: { version, payload: cleanPayload(draft!), title: (draft?.title || draft?.key_question || d.item.title).toString().slice(0, 200) } });\n    },'],
  ['    onSuccess: async (it) => {\n      setVersion(it.version);', '    onSuccess: async (it) => {\n      setBase(submittedDraft.current); // Do not erase edits made while saving.\n      setVersion(it.version);'],
  ['      <details className="studio-more"><summary>Gemini·GPT API로 자동 작성</summary>', '      <details className="studio-more" open><summary>API 자동 작성 · Gemini·GPT</summary>'],
  ['      {gen.error && <ErrorBox error={gen.error} />}', '      {d.item.version > version && dirty && <div className="notice warn">서버에 새 초안이 있습니다. 직접 입력한 내용은 유지했습니다. <button className="btn sm" onClick={() => guard.confirmLeave(() => { setBase(incoming); setDraft(incoming); setVersion(d.item.version); })}>새 초안 불러오기</button></div>}\n      {gen.error && <ErrorBox error={gen.error} />}'],
  ['              <details>\n                <summary>확보한 원문 텍스트 보기', '              <details open>\n                <summary>확보한 원문 텍스트 보기'],
  ['아직 초안이 없습니다. 위에서 ChatGPT로 초안을 받으세요.', '아직 초안이 없습니다. 위의 API 자동 작성으로 초안을 만들거나 ChatGPT 초안을 가져오세요.'],
  ['  const p = d.primary;\n', '  const p = d.primary;\n  const sourceUrl = p && typeof p.meta.finalUrl === "string" && /^https?:\\/\\//.test(p.meta.finalUrl) ? p.meta.finalUrl : p?.originalUrl;\n'],
  ['            <a href={p.originalUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>', '            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>'],
]);
{
  const path = 'client/src/pages/ItemDetail.tsx';
  let text = readFileSync(path, 'utf8');
  const start = text.indexOf('      <ChatGptLaunch prompt={itemChatGptPrompt(');
  const end = text.indexOf('      <details className="studio-more" open><summary>API 자동 작성', start);
  const destination = text.indexOf('      {d.current && (', end);
  if (start >= 0 && end > start && destination > end) {
    const block = text.slice(start, end);
    text = text.slice(0, start) + text.slice(end, destination) + block + text.slice(destination);
    writeFileSync(path, text);
  } else if (!text.includes('API 자동 작성 · Gemini·GPT')) throw new Error('Item editor API block not found');
}
edit('server/routes/items.ts', [
  ['    const r = await fetchAndExtract((doc.meta as { fetchUrl?: string }).fetchUrl || doc.originalUrl);', '    const r = await fetchAndExtract((doc.meta as { fetchUrl?: string }).fetchUrl || doc.originalUrl, undefined, { title: doc.title, publisherUrl: typeof doc.meta.publisherUrl === "string" ? doc.meta.publisherUrl : undefined });'],
  ['    if (changed && item.reviewStatus === "reviewed") await db.update(contentItems).set({ reviewStatus: "review_required", updatedAt: now }).where(eq(contentItems.id, item.id));', '    if (item.evidenceStatus === "fetch_failed") await db.update(contentItems).set({ evidenceStatus: "needs_review", updatedAt: now }).where(eq(contentItems.id, item.id));\n    if (changed && item.reviewStatus === "reviewed") await db.update(contentItems).set({ reviewStatus: "review_required", updatedAt: now }).where(eq(contentItems.id, item.id));'],
]);
edit('server/worker/collect.ts', [
  ['    const r = await fetchDoc(db, item.primarySourceId!, fetcher, now, () => (fetchCalls < budget.fetchCallsPerRun && !opts.fetchSource ? (fetchCalls++, true) : false));\n    fetchCalls++;', '    fetchCalls++; // Reserve the primary request before any redirect/feed/attachment request.\n    const r = await fetchDoc(db, item.primarySourceId!, fetcher, now, () => (fetchCalls < budget.fetchCallsPerRun && !opts.fetchSource ? (fetchCalls++, true) : false));'],
  ['  const r = await fetcher(meta.fetchUrl || doc.originalUrl);', '  const r = await fetcher(meta.fetchUrl || doc.originalUrl, undefined, { title: doc.title, publisherUrl: typeof doc.meta.publisherUrl === "string" ? doc.meta.publisherUrl : undefined, takeExtraCall });'],
]);
console.log('Applied guarded editor/source patches. No database, credentials, or publishing configuration changed.');
