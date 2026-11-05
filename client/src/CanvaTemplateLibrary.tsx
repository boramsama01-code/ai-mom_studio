import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  CANVA_LIBRARY_DEFAULT_FOLDER_ID,
  canvaTemplateLibraryStateSchema,
  parseCanvaFolderId,
  type CanvaLibraryItem,
  type CanvaTemplateLibraryState,
} from "@shared/canvaTemplateLibrary";
import { api, ApiError } from "./api";
import { ErrorBox, GuardedLink } from "./ui";
import { CANVA_READING_TEXT_FIELDS } from "@shared/canvaEditorial";
import "./canvaTemplateLibrary.css";

export const CANVA_LIBRARY_QUERY_KEY = ["canva-template-library"] as const;

function parseLibrary(value: unknown): CanvaTemplateLibraryState {
  const result = canvaTemplateLibraryStateSchema.safeParse(value);
  if (!result.success) throw new ApiError(502, "Canva 폴더 응답을 확인하지 못했습니다. 저장한 원고는 유지되며 다시 확인할 수 있습니다.");
  return result.data;
}

export function useCanvaTemplateLibrary() {
  return useQuery({
    queryKey: CANVA_LIBRARY_QUERY_KEY,
    queryFn: async ({ signal }) => parseLibrary(await api("/canva/template-library", { signal })),
    retry: false,
    staleTime: 20_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: query => {
      const state = query.state.data;
      if (!state?.enabled || !state.configured) return false;
      if (state.syncStatus === "syncing") return 5_000;
      if (!state.connected) return false;
      if (state.syncStatus === "ready" && state.items.some(item => ["pending", "stale"].includes(item.previewStatus))) return 5_000;
      return state.syncIntervalSeconds * 1000;
    },
    refetchIntervalInBackground: false,
  });
}

export function safeCanvaLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")) ? value : null;
  } catch { return null; }
}

/** Library previews are authenticated server images, never provider-supplied navigation. */
export function safeCanvaPreview(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/api/canva/template-library/designs/")) return null;
  try {
    const url = new URL(value, "https://studio.invalid");
    return url.origin === "https://studio.invalid" && /^\/api\/canva\/template-library\/designs\/[^/]+\/preview$/.test(url.pathname) ? value : null;
  } catch { return null; }
}

export function libraryTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "아직 확인 전";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "확인 시각 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(date);
}

const statusLabels: Record<CanvaLibraryItem["status"], string> = {
  ready: "원고 연결됨",
  needs_fields: "원고 연결 필요",
  unsupported_pages: "구성 확인 필요",
  unavailable: "연결 확인 필요",
  missing: "폴더에서 제외됨",
};

function syncLabel(state: CanvaTemplateLibraryState): string {
  if (!state.configured) return "Canva 연결 대기";
  if (state.syncStatus === "syncing") return "최신 디자인 확인 중";
  if (state.syncStatus === "needs_reconnect") return "Canva 재연결 필요";
  if (state.syncStatus === "error") return "최근 확인 실패";
  if (!state.enabled || state.syncStatus === "disabled") return "자동 확인 일시정지";
  if (!state.connected) return "Canva 연결 대기";
  return "자동 확인 중";
}

function LibraryConnection({ state }: { state: CanvaTemplateLibraryState }) {
  if (!state.configured) return <div className="notice stack">
    <strong>Studio에 Canva 계정을 연결해 주세요.</strong>
    <p>Canva 폴더를 연결하면 표지와 내지를 직접 고친 내용이 이곳에 반영됩니다.</p>
    <GuardedLink className="btn" href="/connections?service=canva">Canva 앱 연결 설정</GuardedLink>
  </div>;
  if (!state.connected && state.syncStatus === "syncing") return <p className="notice small" role="status">Canva 연결과 폴더를 확인하고 있습니다. 확인이 끝나면 디자인이 표시됩니다.</p>;
  if (!state.connected || state.syncStatus === "needs_reconnect") return <div className="notice stack" role="status">
    <strong>{state.syncStatus === "needs_reconnect" ? "Canva 폴더 접근을 허용해 주세요." : "Canva 계정 연결을 마무리해 주세요."}</strong>
    <p>{state.message ?? "템플릿 폴더의 디자인과 각 페이지를 읽을 수 있도록 계정을 연결합니다."}</p>
    <a className="btn" href="/api/canva/connect" target="_blank" rel="noopener noreferrer">{state.syncStatus === "needs_reconnect" ? "Canva 다시 연결" : "Canva 계정 연결"} ↗</a>
    <p className="small muted">새 창에서 연결한 뒤 이 화면으로 돌아오면 상태를 다시 확인합니다.</p>
  </div>;
  return null;
}

function PreviewImage({ src, alt, small = false }: { src: string | null; alt: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className={`canva-library-placeholder ${small ? "is-small" : ""}`} role="img" aria-label={alt}>
    <span aria-hidden="true">C</span>
    <small>{failed ? "미리보기 연결 확인" : "미리보기 준비 중"}</small>
  </div>;
  return <img src={src} alt={alt} loading={small ? "lazy" : "eager"} onError={() => setFailed(true)} />;
}

const fieldPages = ["표지", "뉴스 요약", "의미", "질문", "두 관점", "개념", "활동", "마무리"].map((title, index) => ({
  page: index + 1,
  title,
  fields: CANVA_READING_TEXT_FIELDS.filter(name => name.startsWith(`P${String(index + 1).padStart(2, "0")}_`)),
}));

function CanvaFieldHelp() {
  const [message, setMessage] = useState<string | null>(null);
  const copy = async (fields: readonly string[], label: string) => {
    try { await navigator.clipboard.writeText(fields.join("\n")); setMessage(`${label}을 복사했습니다.`); }
    catch { setMessage("자동 복사를 사용할 수 없습니다. 아래 페이지를 열고 필드 이름을 직접 선택해 복사해 주세요."); }
  };
  return <details className="canva-library-field-help">
    <summary>새 디자인에 원고 연결하기</summary>
    <div className="stack">
      <p className="small">가장 간단한 방법은 원고가 연결된 기존 8장 템플릿을 복제하는 것입니다. 텍스트 요소와 라벨을 유지한 채 표지와 내지를 꾸며 주세요.</p>
      <p className="small">처음부터 만든 디자인은 1080 × 1350 크기의 8장으로 준비하고, Canva의 대량 만들기(Bulk Create)에서 아래 이름을 각 텍스트 요소에 연결해 주세요. 대소문자와 밑줄을 그대로 사용합니다.</p>
      <button type="button" className="btn sm" onClick={() => copy(CANVA_READING_TEXT_FIELDS, `전체 ${CANVA_READING_TEXT_FIELDS.length}개 필드 이름`)}>전체 {CANVA_READING_TEXT_FIELDS.length}개 필드 이름 복사</button>
      {message && <p className="small canva-library-feedback" role="status">{message}</p>}
      <div className="canva-library-field-pages">
        {fieldPages.map(({ page, title, fields }) => <details className="canva-library-field-page" key={page}>
          <summary>{page} · {title} <span className="muted">{fields.length}개 필드</span></summary>
          <textarea readOnly rows={fields.length} aria-label={`${page}페이지 원고 필드 이름`} value={fields.join("\n")} spellCheck={false} wrap="off" onFocus={event => event.currentTarget.select()} />
          <button type="button" className="btn sm" onClick={() => copy(fields, `${page}페이지 필드 이름`)}>{page}페이지 필드 이름 복사</button>
        </details>)}
      </div>
      <p className="small muted">연결을 저장한 뒤 ‘지금 동기화’로 원고 연결 상태를 다시 확인해 주세요. 사진과 기본 사진 출처는 Canva 원본을 유지합니다.</p>
    </div>
  </details>;
}

export function CanvaLibraryBrowser({ items, selectedDesignId, disabled = false, onSelect, canCreate = true }: {
  items: CanvaLibraryItem[];
  selectedDesignId?: string | null;
  disabled?: boolean;
  onSelect?: (item: CanvaLibraryItem) => void;
  canCreate?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(selectedDesignId ?? null);
  const [pageNumber, setPageNumber] = useState(1);
  const priorSelection = useRef(selectedDesignId);
  useEffect(() => {
    if (selectedDesignId !== priorSelection.current) {
      setPreviewId(selectedDesignId ?? null);
      setPageNumber(1);
      priorSelection.current = selectedDesignId;
    }
  }, [selectedDesignId]);
  const normalized = search.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
  const visible = items.filter(item => (item.status !== "missing" || item.designId === selectedDesignId)
    && (!normalized || `${item.title} ${item.designId}`.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").includes(normalized)));
  const active = visible.find(item => item.designId === previewId)
    ?? visible.find(item => item.designId === selectedDesignId) ?? visible[0];
  const activePage = active?.pages.find(page => page.pageNumber === pageNumber) ?? active?.pages[0];
  const shownPage = activePage?.pageNumber ?? 1;
  const activePreview = safeCanvaPreview(activePage?.previewUrl ?? (shownPage === 1 ? active?.thumbnailUrl : null));
  const editUrl = safeCanvaLink(active?.editUrl);
  const selectedMissing = !!selectedDesignId && !items.some(item => item.designId === selectedDesignId && item.status !== "missing");
  const canSelect = !!active?.canCreate && active.status === "ready" && active.previewStatus === "ready" && canCreate;
  const unavailable = active?.reason ?? (active?.status !== "ready" ? statusLabels[active?.status ?? "unavailable"] : null);
  return <div className="canva-library-browser">
    <div className="canva-library-toolbar">
      <label className="field">Canva 디자인 검색<input type="search" value={search} placeholder="디자인 이름으로 찾기" onChange={event => { setSearch(event.target.value); setPageNumber(1); }} /></label>
      <span className="small muted" role="status">{visible.length}개 디자인</span>
    </div>
    {selectedMissing && <p className="notice warn small">선택했던 디자인이 연결된 폴더에서 확인되지 않습니다. 현재 원고는 보존되어 있으며, 새로 만들 때 사용할 다른 Canva 템플릿을 선택해 주세요.</p>}
    {!visible.length ? <p className="canva-library-empty">{search ? "검색어에 맞는 디자인이 없습니다." : "연결한 폴더에 디자인을 넣으면 이곳에 자동으로 추가됩니다."}</p> : <div className="canva-library-workspace">
      <div className="canva-library-grid" role="group" aria-label="Canva 폴더 디자인">
        {visible.map(item => <button type="button" className="canva-library-card" key={item.designId} aria-pressed={active?.designId === item.designId} aria-label={`${item.title} 미리보기`} onClick={() => { setPreviewId(item.designId); setPageNumber(1); }}>
          <div className="canva-library-cover"><PreviewImage src={safeCanvaPreview(item.thumbnailUrl ?? item.pages[0]?.previewUrl)} alt="" small />
            <span className="canva-library-page-count">{item.pageCount === null ? "Canva" : `${item.pageCount}장`}</span>
            {item.designId === selectedDesignId && <span className="canva-library-selected">선택됨</span>}
          </div>
          <strong>{item.title || "이름 없는 디자인"}</strong>
          <span className={`canva-library-item-status ${item.canCreate && item.previewStatus === "ready" ? "is-ready" : ""}`}>{item.previewStatus === "stale" ? "새 미리보기 갱신 중" : item.previewStatus === "pending" ? "미리보기 준비 중" : statusLabels[item.status]}</span>
        </button>)}
      </div>
      {active && <aside className="canva-library-detail" aria-label="Canva 디자인 상세">
        <div className="row between"><span className="small muted">{active.previewStatus === "stale" ? "이전 미리보기 · 새 버전 준비 중" : active.previewStatus === "pending" ? "미리보기 준비 중" : "Canva 원본 미리보기"}</span><span className="small muted">{shownPage} / {active.pageCount ?? (active.pages.length || 1)}</span></div>
        {activePreview ? <a className="canva-library-large" href={activePreview} target="_blank" rel="noopener noreferrer" aria-label={`${active.title} ${shownPage}페이지 크게 보기`}><PreviewImage src={activePreview} alt={`${active.title} ${shownPage}페이지 Canva 원본`} /></a>
          : <div className="canva-library-large"><PreviewImage src={null} alt={`${active.title} 미리보기 준비 중`} /></div>}
        {active.pages.length > 1 && <div className="canva-library-pages" role="group" aria-label="Canva 원본 페이지">
          {active.pages.map(page => <button type="button" key={page.pageNumber} aria-pressed={shownPage === page.pageNumber} aria-label={`${page.pageNumber}페이지${page.pageNumber === 1 ? " 표지" : ""}`} onClick={() => setPageNumber(page.pageNumber)}>{page.pageNumber === 1 ? "표지" : page.pageNumber}</button>)}
        </div>}
        {active.pageCount !== null && active.pageCount > active.pages.length && <p className="small muted">처음 {active.pages.length}장을 표시합니다. 모든 페이지는 Canva에서 볼 수 있습니다.</p>}
        <h3>{active.title}</h3>
        <p className="small muted">Canva 수정 · {libraryTime(active.updatedAt)}</p>
        {active.previewStatus === "stale" && <p className="small muted" role="status">지금 보이는 이미지는 이전 버전입니다. Canva 수정 내용을 다시 불러오면 자동으로 바뀝니다.</p>}
        {active.previewStatus === "pending" && <p className="small muted" role="status">최신 미리보기를 준비하고 있습니다. 준비가 끝나면 원고를 채울 템플릿으로 선택할 수 있습니다.</p>}
        {["failed", "unavailable"].includes(active.previewStatus) && <p className="notice small" role="status">{active.previewStatus === "failed" ? "미리보기를 다시 준비해야 합니다. ‘지금 동기화’로 확인하거나 Canva에서 원본을 열어 주세요." : "이 디자인의 미리보기를 아직 가져올 수 없습니다. Canva에서 원본을 확인해 주세요."}</p>}
        {unavailable && <p className="notice small" role="status">{unavailable}</p>}
        {active.status === "needs_fields" && <><p className="small muted">기존 8장 템플릿을 복제해 수정하면 원고를 채우는 연결도 함께 유지할 수 있습니다.</p><CanvaFieldHelp key={active.designId} /></>}
        <div className="canva-library-actions">
          {editUrl && <a className="btn" href={editUrl} target="_blank" rel="noopener noreferrer">Canva에서 편집 ↗</a>}
          {onSelect && <button type="button" className="btn primary" disabled={disabled || !canSelect || selectedDesignId === active.designId} onClick={() => onSelect(active)}>{selectedDesignId === active.designId ? "선택한 Canva 템플릿" : "이 Canva 템플릿 선택"}</button>}
        </div>
        {onSelect && <p className="small muted">Canva의 배치·이미지와 기본 사진 출처를 유지하고 저장된 원고를 채웁니다.</p>}
      </aside>}
    </div>}
  </div>;
}

export function CanvaLibraryPanel({ query, manageFolder = false, selectedDesignId, disabled = false, onSelect }: {
  query: UseQueryResult<CanvaTemplateLibraryState, Error>;
  manageFolder?: boolean;
  selectedDesignId?: string | null;
  disabled?: boolean;
  onSelect?: (item: CanvaLibraryItem) => void;
}) {
  const qc = useQueryClient();
  const state = query.data;
  const inputId = useId();
  const [folder, setFolder] = useState(`https://www.canva.com/folder/${CANVA_LIBRARY_DEFAULT_FOLDER_ID}`);
  const [enabled, setEnabled] = useState(true);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!state || settingsDirty) return;
    setFolder(state.folderUrl || state.folderId);
    setEnabled(state.enabled);
  }, [state?.folderId, state?.folderUrl, state?.enabled, settingsDirty]);
  const refreshQueries = () => {
    void qc.invalidateQueries({ queryKey: ["canva-masters"] });
    void qc.invalidateQueries({ queryKey: ["canva-editorial-status"] });
  };
  const sync = useMutation({
    mutationFn: async () => parseLibrary(await api("/canva/template-library/sync", { method: "POST", body: {} })),
    onSuccess: value => { qc.setQueryData(CANVA_LIBRARY_QUERY_KEY, value); refreshQueries(); setNotice(value.syncStatus === "syncing" ? "최신 디자인을 확인하고 있습니다." : "Canva 폴더의 최신 상태를 확인했습니다."); },
  });
  const save = useMutation({
    mutationFn: async () => {
      const folderId = parseCanvaFolderId(folder);
      if (!folderId) throw new Error("Canva 폴더 링크 또는 FA로 시작하는 폴더 ID를 넣어 주세요.");
      return parseLibrary(await api("/canva/template-library", { method: "PUT", body: { folderId, enabled } }));
    },
    onSuccess: value => { qc.setQueryData(CANVA_LIBRARY_QUERY_KEY, value); setSettingsDirty(false); refreshQueries(); setNotice(!value.enabled ? "폴더 자동 확인을 잠시 멈췄습니다." : value.syncStatus === "syncing" ? "폴더 설정을 저장했습니다. 최신 디자인을 확인하고 있습니다." : !value.connected || value.syncStatus === "needs_reconnect" ? "폴더 설정을 저장했습니다. Canva 계정 연결을 마무리하면 디자인을 확인합니다." : "템플릿 폴더를 연결했습니다."); },
  });
  const mutating = save.isPending || sync.isPending;
  const folderUrl = safeCanvaLink(state?.folderUrl);
  return <div className="canva-library-panel stack">
    {query.isLoading && <p className="small muted" role="status">Canva 템플릿 폴더를 불러오는 중…</p>}
    {query.error && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    {state && <>
      <LibraryConnection state={state} />
      <div className="canva-library-sync-bar">
        <div><strong>{state.folderName ?? "Canva 템플릿 폴더"}</strong><p className="small muted">마지막 확인 · {libraryTime(state.lastSyncedAt)} · {syncLabel(state)}</p></div>
        <div className="row wrap">
          {folderUrl && <a className="btn sm" href={folderUrl} target="_blank" rel="noopener noreferrer">폴더 열기 ↗</a>}
          <button type="button" className="btn sm" disabled={mutating || !state.configured || !state.connected || state.syncStatus === "needs_reconnect"} onClick={() => { setNotice(null); sync.mutate(); }}>{sync.isPending || state.syncStatus === "syncing" ? "확인 중…" : "지금 동기화"}</button>
        </div>
      </div>
      {state.syncStatus === "error" && state.message && <p className="notice warn" role="alert">{state.message}</p>}
      {state.syncStatus === "disabled" && <p className="notice small">자동 확인이 일시정지되어 있습니다. 폴더 설정에서 다시 켤 수 있습니다.</p>}
      {state.connected && !state.autofill && <p className="notice small">원본 미리보기와 Canva 편집은 사용할 수 있습니다. 원고 자동 채우기는 연결한 Canva 계정의 기능·권한 확인이 필요합니다.</p>}
    </>}
    {manageFolder && <details className="content-options" open={!state?.connected || settingsDirty || !state?.lastSyncedAt}>
      <summary>템플릿 폴더 설정</summary>
      <form className="stack canva-library-settings" onSubmit={event => { event.preventDefault(); setNotice(null); save.mutate(); }}>
        <label className="field" htmlFor={inputId}>Canva 폴더 링크 또는 ID<input id={inputId} aria-label="Canva 템플릿 폴더 링크 또는 ID" value={folder} disabled={save.isPending} maxLength={1000} placeholder="https://www.canva.com/folder/FA…" onChange={event => { setSettingsDirty(true); setFolder(event.target.value); }} /></label>
        <label className="check"><input type="checkbox" checked={enabled} disabled={save.isPending} onChange={event => { setSettingsDirty(true); setEnabled(event.target.checked); }} />폴더의 수정 내용과 새 디자인 자동 확인</label>
        <p className="small muted">Canva에서 표지·내지를 저장하면 Studio 서비스가 실행 중일 때 약 2분마다 확인합니다. 화면을 열거나 ‘지금 동기화’를 눌러 바로 확인할 수도 있습니다.</p>
        <div><button type="submit" className="btn primary" disabled={mutating || !folder.trim()}>{save.isPending ? "연결 중…" : "폴더 설정 저장"}</button></div>
      </form>
    </details>}
    {!manageFolder && <div><GuardedLink href="/design#canva-template-library">템플릿 폴더 연결·설정</GuardedLink></div>}
    {notice && <p className="small canva-library-feedback" role="status">{notice}</p>}
    {sync.error && <ErrorBox error={sync.error} retry={() => sync.mutate()} />}
    {save.error && <ErrorBox error={save.error} />}
    {state && <CanvaLibraryBrowser items={state.items} selectedDesignId={selectedDesignId} disabled={disabled || mutating} onSelect={onSelect} canCreate={state.enabled && state.connected && state.autofill && state.syncStatus !== "needs_reconnect"} />}
  </div>;
}

export function CanvaTemplateLibrary() {
  const query = useCanvaTemplateLibrary();
  return <section className="panel stack canva-library" id="canva-template-library" aria-labelledby="canva-library-heading">
    <div><h2 id="canva-library-heading">Canva에서 관리하는 템플릿</h2><p className="small muted">폴더에 디자인을 추가하면 선택지가 늘어나고, Canva에서 고친 표지와 내지가 미리보기에 반영됩니다.</p></div>
    <CanvaLibraryPanel query={query} manageFolder />
  </section>;
}
