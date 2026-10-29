import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, FileImage, FileText, GraduationCap, LoaderCircle, LogOut, Paperclip, Pencil, Plus, ReceiptText, RefreshCw, Search, Trash2, UploadCloud, WalletCards, X } from "lucide-react";
import { CATEGORIES, MAX_AMOUNT, MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES, MAX_FILES, RECEIPT_ACCEPT, formatWon, isDate, monthRange, todayKST, validateExpense, type Category, type Child, type Expense, type Receipt } from "./ledger";

type Draft = { id: string; paidOn: string; category: Category; child: Child | ""; title: string; amount: string; version?: number; receipts: Receipt[]; files: File[] };
type Range = { from: string; to: string };
const categoryColors: Record<Category, string> = { "교육비": "#8270ed", "식비": "#f4a259", "생활용품": "#d8ba69", "주거·통신": "#748fe7", "교통·차량": "#64b5b3", "의료·건강": "#e58caa", "쇼핑": "#b28dde", "문화·여가": "#edba55", "여행": "#5fa9dc", "기타": "#a4a8b4" };
function sizeLabel(size: number) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
function dateLabel(date: string) { return date.replaceAll("-", "."); }
function monthLabel(date: string) { const [, month, day] = date.split("-"); return `${Number(month)}월 ${Number(day)}일`; }
function csvCell(value: string | number) { const str = String(value); return `"${(/^[\s]*[=+\-@\t\r]/.test(str) ? "'" : "") + str.replaceAll('"', '""')}"`; }
async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as { error?: string; expenses?: Expense[]; ok?: boolean; id?: string } : null;
  if (!response.ok) throw new Error((typeof result?.error === "string" && result.error) || (response.status === 401 ? "로그인이 만료되었어요. 새로고침한 후 다시 로그인해 주세요." : "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요."));
  if (!result) throw new Error("서버 응답을 확인하지 못했어요. 새로고침한 후 다시 로그인해 주세요.");
  return result;
}

function Modal({ title, description, children, onClose, busy = false, className = "" }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = useId(); const closeRef = useRef(onClose); const busyRef = useRef(busy);
  closeRef.current = onClose; busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => { const first = ref.current?.querySelector<HTMLElement>("input, select, button, a[href], [tabindex='0']"); (first ?? ref.current)?.focus(); });
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== "Tab") return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']") ?? []).filter(el => el.offsetParent !== null);
      if (!nodes.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keyDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keyDown); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-shade"><div className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p className="muted">{description}</p>}</div><button className="icon-button" aria-label="창 닫기" onClick={onClose} disabled={busy}><X size={21}/></button></div>{children}</div></div>;
}

function ReceiptViewer({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const [selected, setSelected] = useState(expense.receipts[0]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [selected.id]);
  return <Modal title="영수증 보기" description={expense.title} onClose={onClose} className="receipt-modal"><div className="receipt-tabs">{expense.receipts.map((r, i) => <button key={r.id} className={`receipt-tab ${selected.id === r.id ? "selected" : ""}`} onClick={() => setSelected(r)}>{r.mime === "application/pdf" ? <FileText size={16}/> : <FileImage size={16}/>}영수증 {i + 1}</button>)}</div><div className="receipt-preview">{failed ? <p>미리보기를 불러오지 못했어요. 아래에서 원본을 열어 주세요.</p> : selected.mime === "application/pdf" ? <iframe src={`/api/receipts/${selected.id}`} title={selected.name}/> : <img src={`/api/receipts/${selected.id}`} alt={selected.name} onError={() => setFailed(true)}/>}</div><div className="receipt-bottom"><div className="receipt-name"><strong>{selected.name}</strong><span>{sizeLabel(selected.size)}</span></div><div className="button-row"><a className="button secondary small" href={`/api/receipts/${selected.id}`} target="_blank" rel="noopener noreferrer">원본 열기</a><a className="button primary small" href={`/api/receipts/${selected.id}?download=1`} download><ArrowDownToLine size={16}/>다운로드</a></div></div></Modal>;
}

function ExpenseEditor({ draft: initialDraft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: (paidOn: string) => void }) {
  const [draft, setDraft] = useState(initialDraft); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [drag, setDrag] = useState(false); const busyRef = useRef(false); const fileRef = useRef<HTMLInputElement>(null);
  const editing = !!draft.version;
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  function addFiles(incoming: FileList | File[]) {
    if (busyRef.current) return;
    setError(""); const files = Array.from(incoming); const unique = files.filter(f => !draft.files.some(old => old.name === f.name && old.size === f.size && old.lastModified === f.lastModified));
    if (draft.receipts.length + draft.files.length + unique.length > MAX_FILES) { setError(`영수증은 한 지출에 최대 ${MAX_FILES}개까지 첨부할 수 있어요.`); return; }
    if (draft.receipts.reduce((sum, r) => sum + r.size, 0) + draft.files.reduce((sum, f) => sum + f.size, 0) + unique.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_FILE_BYTES) { setError("한 지출에 첨부하는 영수증의 전체 크기는 20MB 이하여야 해요."); return; }
    for (const file of unique) {
      if (!/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) { setError("JPG, PNG, WebP 이미지 또는 PDF를 선택해 주세요. HEIC 사진은 JPG로 변환해 주세요."); return; }
      if (!file.size || file.size > MAX_FILE_BYTES) { setError(`‘${file.name}’ 파일은 비어 있거나 10MB를 초과해요.`); return; }
    }
    setDraft(d => ({ ...d, files: [...d.files, ...unique] }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return; setError("");
    try {
      const raw = draft.amount.trim();
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw new Error("금액은 소수점 없이 숫자로 입력해 주세요. 예: 35,000");
      const amount = Number(raw.replaceAll(",", ""));
      const payload = validateExpense({ id: draft.id, paidOn: draft.paidOn, category: draft.category, child: draft.category === "교육비" ? draft.child : null, title: draft.title, amount, version: draft.version, retainedReceiptIds: draft.receipts.map(r => r.id) });
      const form = new FormData(); form.append("payload", JSON.stringify(payload)); for (const file of draft.files) form.append("files", file);
      busyRef.current = true; setBusy(true);
      await readResponse(await fetch(editing ? `/api/expenses/${draft.id}` : "/api/expenses", { method: editing ? "PUT" : "POST", body: form }));
      onSaved(draft.paidOn);
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요. 다시 시도해 주세요."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Modal title={editing ? "지출 수정" : "지출 추가"} onClose={onClose} busy={busy}><form onSubmit={submit} className="expense-form"><fieldset disabled={busy}><div className="form-grid"><label className="field">결제일 <span className="required">*</span><input type="date" value={draft.paidOn} onChange={e => setField("paidOn", e.target.value)} required min="1900-01-01" max="2200-12-31"/></label><label className="field">카테고리 <span className="required">*</span><select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as Category, child: e.target.value === "교육비" ? d.child : "" }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label></div>{draft.category === "교육비" && <div className="child-field"><span className="field-label">교육비 대상 <span className="required">*</span></span><div className="child-options">{(["현우", "정우"] as Child[]).map(child => <label key={child} className={`child-option ${draft.child === child ? "selected" : ""}`}><input type="radio" name="child" value={child} checked={draft.child === child} onChange={() => setField("child", child)} required/><GraduationCap size={18}/>{child}{draft.child === child && <Check size={16}/>}</label>)}</div></div>}<label className="field">항목 <span className="required">*</span><input type="text" value={draft.title} maxLength={100} placeholder="예: 수학 학원비, 주말 장보기" onChange={e => setField("title", e.target.value)} required/></label><label className="field">금액 <span className="required">*</span><span className="amount-input"><input type="text" inputMode="numeric" placeholder="0" value={draft.amount} maxLength={18} onChange={e => setField("amount", e.target.value)} onBlur={() => { if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(draft.amount.trim())) { const n = Number(draft.amount.replaceAll(",", "")); if (Number.isSafeInteger(n) && n <= MAX_AMOUNT) setField("amount", formatWon(n)); } }} required/><span>원</span></span></label><div className="attachment-heading"><span className="field-label">영수증 첨부 <span className="optional">선택</span></span><span>{draft.receipts.length + draft.files.length} / {MAX_FILES}</span></div><div className={`upload-area ${drag ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}><input ref={fileRef} className="visually-hidden" type="file" multiple accept={RECEIPT_ACCEPT} aria-label="영수증 파일 선택" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}/><UploadCloud size={28} strokeWidth={1.6}/><button type="button" className="upload-trigger" onClick={() => fileRef.current?.click()}>클릭하여 파일 선택<span className="desktop-only"> 또는 여기에 끌어놓기</span></button><p>JPG · PNG · WebP · PDF / 파일당 10MB, 총 20MB</p></div>{(draft.receipts.length > 0 || draft.files.length > 0) && <ul className="attachment-list">{draft.receipts.map(r => <li key={r.id}><span className="file-symbol">{r.mime === "application/pdf" ? <FileText size={18}/> : <FileImage size={18}/>}</span><div className="file-detail"><a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener noreferrer">{r.name}</a><small>{sizeLabel(r.size)} · 저장된 영수증</small></div><button type="button" className="icon-button small" aria-label={`${r.name} 첨부 제거`} onClick={() => setField("receipts", draft.receipts.filter(x => x.id !== r.id))}><X size={17}/></button></li>)}{draft.files.map((f, i) => <li key={`${f.name}-${f.lastModified}-${i}`}><span className="file-symbol">{/\.pdf$/i.test(f.name) ? <FileText size={18}/> : <FileImage size={18}/>}</span><div className="file-detail"><strong>{f.name}</strong><small>{sizeLabel(f.size)} · 저장 대기</small></div><button type="button" className="icon-button small" aria-label={`${f.name} 첨부 제거`} onClick={() => setField("files", draft.files.filter((_, index) => index !== i))}><X size={17}/></button></li>)}</ul>}</fieldset>{error && <div className="error-message" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} {busy ? "저장 중…" : "저장"}</button></div></form></Modal>;
}

export default function Ledger({ userName, onLogout, logoutBusy = false }: { userName: string; onLogout: () => void; logoutBusy?: boolean }) {
  const [range, setRange] = useState<Range>(() => monthRange());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [category, setCategory] = useState("");
  const [child, setChild] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [viewer, setViewer] = useState<Expense | null>(null);
  const [toast, setToast] = useState("");
  const [today, setToday] = useState(todayKST());
  const requestRef = useRef(0);
  const deleteRef = useRef(false);
  const invalidRange = (!!range.from && !isDate(range.from)) || (!!range.to && !isDate(range.to)) || (!!range.from && !!range.to && range.from > range.to);

  useEffect(() => {
    const id = window.setInterval(() => setToday(todayKST()), 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (invalidRange) { setLoading(false); return; }
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    fetch(`/api/expenses?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(readResponse)
      .then(result => {
        if (!Array.isArray(result.expenses)) throw new Error("내역을 불러오지 못했습니다.");
        if (requestRef.current === requestId) setExpenses(result.expenses);
      })
      .catch(e => { if (e.name !== "AbortError" && requestRef.current === requestId) setError(e.message || "내역을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted && requestRef.current === requestId) setLoading(false); });
    return () => controller.abort();
  }, [range.from, range.to, refresh, invalidRange]);

  const visible = useMemo(() => expenses.filter(e => (!category || e.category === category) && (!child || e.child === child) && (!query.trim() || e.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [expenses, category, child, query]);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const filteredTotal = visible.reduce((sum, e) => sum + e.amount, 0);
  const education = (name: Child) => expenses.filter(e => e.category === "교육비" && e.child === name).reduce((sum, e) => sum + e.amount, 0);
  const breakdown = CATEGORIES.map(c => ({ name: c, amount: expenses.filter(e => e.category === c).reduce((sum, e) => sum + e.amount, 0) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const filterActive = !!category || !!child || !!query.trim();
  const dataReady = !loading && !error && !invalidRange;
  const rangeLabel = range.from && range.to ? `${dateLabel(range.from)} – ${dateLabel(range.to)}` : range.from ? `${dateLabel(range.from)}부터` : range.to ? `${dateLabel(range.to)}까지` : "전체 기간";
  const selectedMonth = range.from && rangeMatches(monthRange(range.from)) ? `${range.from.slice(0, 4)}년 ${Number(range.from.slice(5, 7))}월` : "기간 선택";
  function rangeMatches(value: Range) { return range.from === value.from && range.to === value.to; }
  function changeMonth(offset: number) { setRange(monthRange(range.from || today, offset)); }
  function resetFilter() { setCategory(""); setChild(""); setQuery(""); }
  function filterChild(name: Child) {
    if (category === "교육비" && child === name) { setCategory(""); setChild(""); }
    else { setCategory("교육비"); setChild(name); }
  }
  function addExpense() { setDraft({ id: crypto.randomUUID(), paidOn: todayKST(), category: "식비", child: "", title: "", amount: "", receipts: [], files: [] }); }
  function editExpense(expense: Expense) { setDraft({ ...expense, child: expense.child ?? "", amount: formatWon(expense.amount), files: [] }); }
  function saved(paidOn: string) {
    setDraft(null); setRefresh(x => x + 1);
    const outside = (range.from && paidOn < range.from) || (range.to && paidOn > range.to);
    setToast(outside ? "저장했습니다. 선택한 기간 밖의 내역입니다." : "저장했습니다.");
  }
  async function confirmDelete() {
    if (!deleting || deleteRef.current) return;
    deleteRef.current = true; setDeleteBusy(true); setDeleteError("");
    try {
      await readResponse(await fetch(`/api/expenses/${deleting.id}?version=${deleting.version}`, { method: "DELETE" }));
      setDeleting(null); setRefresh(x => x + 1); setToast("지출과 첨부 영수증을 삭제했습니다.");
    } catch (e) { setDeleteError(e instanceof Error ? e.message : "삭제하지 못했습니다."); }
    finally { deleteRef.current = false; setDeleteBusy(false); }
  }
  function exportCSV() {
    const rows = [["결제일", "카테고리", "자녀", "항목", "금액(원)", "영수증 수"], ...visible.map(e => [e.paidOn, e.category, e.child ?? "", e.title, e.amount, e.receipts.length])];
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `가계부_${range.from || "전체"}_${range.to || today}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000); setToast("CSV 파일을 내보냈습니다.");
  }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="가계부 홈"><span className="brand-mark"><WalletCards size={22} strokeWidth={1.8}/></span><h1>가계부</h1></a>
      <div className="header-account"><span className="account-avatar">{userName.slice(0, 1) || "나"}</span><span className="account-name">{userName}</span><button className="icon-button logout-button" aria-label="로그아웃" title="로그아웃" onClick={onLogout} disabled={logoutBusy}>{logoutBusy ? <LoaderCircle className="spin" size={17}/> : <LogOut size={17}/>}</button></div>
    </header>
    <main className="main">
      <section className="period-toolbar" aria-label="조회 기간">
        <div className="month-selector"><button className="icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={19}/></button><h2>{selectedMonth}</h2><button className="icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight size={19}/></button></div>
        <div className="quick-ranges">{[
          { label: "이번 달", value: monthRange(today) },
          { label: "지난달", value: monthRange(today, -1) },
          { label: "올해", value: { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` } },
          { label: "전체", value: { from: "", to: "" } },
        ].map(q => <button key={q.label} onClick={() => setRange(q.value)} className={rangeMatches(q.value) ? "active" : ""} aria-pressed={rangeMatches(q.value)}>{q.label}</button>)}</div>
        <button className="button primary add-expense" onClick={addExpense}><Plus size={18}/>지출 추가</button>
      </section>
      <div className="custom-range"><CalendarDays size={15}/><input type="date" value={range.from} aria-label="조회 시작일" min="1900-01-01" max="2200-12-31" onChange={e => setRange(d => ({ ...d, from: e.target.value }))}/><span>–</span><input type="date" value={range.to} aria-label="조회 종료일" min="1900-01-01" max="2200-12-31" onChange={e => setRange(d => ({ ...d, to: e.target.value }))}/><span className="range-note">시작일·종료일 포함</span></div>
      {invalidRange && <div className="error-message range-error" role="alert">시작일은 종료일보다 늦을 수 없습니다.</div>}
      <section className="summary-panel" aria-label="선택 기간 합계">
        <div className="summary-main"><div className="summary-label">총지출 <span>{dataReady ? `${expenses.length}건` : ""}</span></div><div className="summary-amount">{dataReady ? formatWon(total) : "—"}<span>원</span></div><div className="summary-period">{rangeLabel}</div></div>
        <div className="education-summaries">{(["현우", "정우"] as Child[]).map((name, index) => <button key={name} className={`education-summary ${category === "교육비" && child === name ? "selected" : ""}`} onClick={() => filterChild(name)} aria-label={`${name} 교육비 내역 보기`} aria-pressed={category === "교육비" && child === name}><div className="education-label"><span className={`child-initial child-${index}`}>{name.slice(0, 1)}</span><span>{name} 교육비</span><ArrowRight size={15}/></div><div className="education-amount">{dataReady ? formatWon(education(name)) : "—"}<span>원</span></div></button>)}</div>
        {dataReady && breakdown.length > 0 && <div className="category-summary"><div className="category-bar">{breakdown.map(c => <div key={c.name} style={{ width: `${c.amount / total * 100}%`, background: categoryColors[c.name] }} title={`${c.name} ${formatWon(c.amount)}원`}/>)}</div><div className="category-legend">{breakdown.map(c => <button key={c.name} onClick={() => { setCategory(c.name); setChild(""); }}><i style={{ background: categoryColors[c.name] }}/>{c.name}<span>{(c.amount / total * 100).toFixed(0)}%</span></button>)}</div></div>}
      </section>

      <section className="ledger-panel" aria-label="지출 내역">
        <div className="ledger-heading"><div className="ledger-title"><h2>지출 내역</h2><span className="count-badge">{dataReady ? visible.length : "—"}</span></div><div className="button-row"><button className="icon-button" aria-label="내역 새로고침" title="새로고침" onClick={() => setRefresh(x => x + 1)} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""}/></button><button className="button secondary small export-button" onClick={exportCSV} disabled={!dataReady || !visible.length}><ArrowDownToLine size={15}/>CSV 내보내기</button></div></div>
        <div className="list-toolbar"><div className="filter-selects"><label className="select-wrap"><span className="visually-hidden">카테고리 필터</span><select value={category} onChange={e => { setCategory(e.target.value); if (e.target.value !== "교육비") setChild(""); }}><option value="">전체 카테고리</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>{category === "교육비" && <label className="select-wrap"><span className="visually-hidden">자녀 필터</span><select value={child} onChange={e => setChild(e.target.value)}><option value="">현우 · 정우</option><option>현우</option><option>정우</option></select></label>}{filterActive && <button className="reset-filter" onClick={resetFilter}>초기화</button>}</div><label className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="항목 검색" aria-label="항목 검색"/>{query && <button className="icon-button tiny" aria-label="검색어 지우기" onClick={() => setQuery("")}><X size={14}/></button>}</label></div>
        {invalidRange ? <div className="empty-state"><CalendarDays size={28}/><p>조회 기간을 확인해 주세요.</p></div> : loading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={25}/><p>불러오는 중</p></div> : error ? <div className="empty-state error-state" role="alert"><p>{error}</p><button className="button secondary" onClick={() => setRefresh(x => x + 1)}>다시 불러오기</button></div> : visible.length === 0 ? <div className="empty-state"><span className="empty-symbol"><ReceiptText size={27} strokeWidth={1.5}/></span><h3>{filterActive ? "검색 결과가 없습니다" : "지출 내역이 없습니다"}</h3>{filterActive ? <button className="button secondary small" onClick={resetFilter}>필터 초기화</button> : <button className="button primary small" onClick={addExpense}><Plus size={16}/>지출 추가</button>}</div> : <>
          <div className="table-container"><table className="expense-table"><thead><tr><th scope="col">결제일</th><th scope="col">카테고리</th><th scope="col">항목</th><th scope="col" className="right">금액</th><th scope="col" className="center">영수증</th><th scope="col" className="right"><span className="visually-hidden">관리</span></th></tr></thead><tbody>{visible.map(expense => <tr key={expense.id}>
            <td className="date-cell"><time dateTime={expense.paidOn}>{dateLabel(expense.paidOn)}</time></td>
            <td className="category-cell"><span className="category-badge"><i style={{ background: categoryColors[expense.category] }}/>{expense.category}</span>{expense.child && <span className="child-tag">{expense.child}</span>}</td>
            <td className="title-cell">{expense.title}</td>
            <td className="amount-cell"><strong>{formatWon(expense.amount)}</strong><span>원</span></td>
            <td className="receipt-cell">{expense.receipts.length ? <button className="receipt-button" onClick={() => setViewer(expense)} aria-label={`${expense.title} 영수증 ${expense.receipts.length}개 보기`}><Paperclip size={14}/>{expense.receipts.length}</button> : <span className="no-receipt">—</span>}</td>
            <td className="row-actions"><div><button className="icon-button small" aria-label={`${expense.title} 수정`} title="수정" onClick={() => editExpense(expense)}><Pencil size={15}/></button><button className="icon-button small delete-action" aria-label={`${expense.title} 삭제`} title="삭제" onClick={() => { setDeleting(expense); setDeleteError(""); }}><Trash2 size={15}/></button></div></td>
          </tr>)}</tbody></table></div>
          <div className="list-total"><span>{filterActive ? "검색 결과 합계" : "합계"}<small>{visible.length}건</small></span><strong>{formatWon(filteredTotal)}<span>원</span></strong></div>
        </>}
      </section>
    </main>
    {draft && <ExpenseEditor key={draft.id} draft={draft} onClose={() => setDraft(null)} onSaved={saved}/>}
    {viewer && <ReceiptViewer expense={viewer} onClose={() => setViewer(null)}/>}
    {deleting && <Modal title="지출 삭제" onClose={() => setDeleting(null)} busy={deleteBusy} className="confirm-modal"><div className="delete-summary"><span>{dateLabel(deleting.paidOn)} · {deleting.category}{deleting.child ? ` / ${deleting.child}` : ""}</span><strong>{deleting.title}</strong><b>{formatWon(deleting.amount)}원</b></div><p className="delete-description">첨부 영수증 {deleting.receipts.length}개도 함께 삭제됩니다. 삭제한 내역은 복구할 수 없습니다.</p>{deleteError && <div className="error-message" role="alert">{deleteError}</div>}<div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>취소</button><button className="button danger" onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? <LoaderCircle size={16} className="spin"/> : <Trash2 size={16}/>}삭제</button></div></Modal>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19}/><span>{toast}</span><button className="icon-button tiny" onClick={() => setToast("")} aria-label="알림 닫기"><X size={15}/></button></div>}
  </div>;
}
