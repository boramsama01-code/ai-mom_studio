import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES, isDate, validateExpense, type Expense, type ExpenseInput, type Receipt } from './ledger.ts';

const DB_NAME = 'woori-ledger';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKUP_FORMAT = 'woori-ledger-backup';
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
type StoredReceipt = Receipt & { expenseId: string; blob: Blob };
type BackupReceipt = Receipt & { expenseId: string; data: string };
type Backup = { format: string; version: number; exportedAt: string; expenses: Expense[]; receipts: BackupReceipt[] };
class StorageError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
let opening: Promise<IDBDatabase> | undefined;

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) return '브라우저 저장공간이 부족하거나 사용할 수 없습니다. 백업 후 저장공간을 확인해 주세요.';
  if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'InvalidStateError')) return '이 브라우저에서 저장공간을 사용할 수 없습니다. 일반 창에서 다시 열어 주세요.';
  return error instanceof Error ? error.message : '브라우저에 저장하지 못했습니다. 다시 시도해 주세요.';
}
function database() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new StorageError('이 브라우저는 내역 저장을 지원하지 않습니다. 최신 브라우저로 열어 주세요.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('receipts')) { const receipts = db.createObjectStore('receipts', { keyPath: 'id' }); receipts.createIndex('expenseId', 'expenseId'); }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new StorageError('다른 가계부 탭을 닫고 다시 시도해 주세요.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw new StorageError(errorMessage(error)); });
  return opening;
}
function read<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await database(); const tx = db.transaction(['expenses', 'receipts'], mode);
  const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new StorageError('저장 작업을 완료하지 못했습니다.')); tx.onerror = () => {}; });
  // Attach a handler immediately so an aborted transaction cannot become an unhandled rejection.
  complete.catch(() => {});
  try { const result = await work(tx); await complete; return result; }
  catch (error) { try { tx.abort(); } catch {} await complete.catch(() => {}); throw error; }
}
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function meta(receipt: StoredReceipt): Receipt { return { id: receipt.id, name: receipt.name, mime: receipt.mime, size: receipt.size }; }
function fileName(name: string) { return name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180); }
async function detectMime(blob: Blob, name: string): Promise<string> {
  if (!blob.size || blob.size > MAX_FILE_BYTES) throw new StorageError(`‘${name}’ 파일은 비어 있거나 10MB를 초과합니다.`);
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer()); const chars = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  let mime = '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && /\.jpe?g$/i.test(name)) mime = 'image/jpeg';
  else if ([137,80,78,71,13,10,26,10].every((n, i) => b[i] === n) && /\.png$/i.test(name)) mime = 'image/png';
  else if (chars(0, 4) === 'RIFF' && chars(8, 12) === 'WEBP' && /\.webp$/i.test(name)) mime = 'image/webp';
  else if (chars(0, 5) === '%PDF-' && /\.pdf$/i.test(name)) mime = 'application/pdf';
  if (!mime) throw new StorageError(`‘${name}’ 파일을 확인해 주세요. JPG·PNG·WebP·PDF만 첨부할 수 있습니다.`);
  return mime;
}
async function preparedFiles(files: File[], expenseId: string): Promise<StoredReceipt[]> {
  if (files.length > MAX_FILES) throw new StorageError('영수증은 최대 5개까지 첨부할 수 있습니다.');
  const receipts: StoredReceipt[] = [];
  for (const file of files) { const name = fileName(file.name); const mime = await detectMime(file, name); receipts.push({ id: newId(), expenseId, name, mime, size: file.size, blob: file.slice(0, file.size, mime) }); }
  return receipts;
}
function receiptLimits(receipts: Receipt[]) {
  if (receipts.length > MAX_FILES || receipts.reduce((sum, r) => sum + r.size, 0) > MAX_TOTAL_FILE_BYTES) throw new StorageError('영수증은 최대 5개, 파일당 10MB, 전체 20MB까지 첨부할 수 있습니다.');
}
async function save(input: ExpenseInput, files: File[], editing: boolean) {
  const added = await preparedFiles(files, input.id);
  return transaction('readwrite', async tx => {
    const entries = tx.objectStore('expenses'), blobs = tx.objectStore('receipts');
    const old = await read<Expense | undefined>(entries.get(input.id));
    if (editing && (!old || input.version !== old.version)) throw new StorageError('내역이 다른 탭에서 변경되었습니다. 새로고침한 후 다시 수정해 주세요.', 409);
    if (!editing && old) throw new StorageError('이미 저장된 내역입니다. 새로고침해 확인해 주세요.', 409);
    if (!old && input.retainedReceiptIds.length) throw new StorageError('첨부 영수증을 확인해 주세요.');
    const retained = input.retainedReceiptIds.map(id => { const receipt = old?.receipts.find(r => r.id === id); if (!receipt) throw new StorageError('첨부 영수증을 찾을 수 없습니다.'); return receipt; });
    const receipts = [...retained, ...added.map(meta)]; receiptLimits(receipts);
    const expense: Expense = { id: input.id, paidOn: input.paidOn, category: input.category, child: input.child, title: input.title, amount: input.amount, version: (old?.version || 0) + 1, createdAt: old?.createdAt || new Date().toISOString(), receipts };
    for (const r of old?.receipts || []) if (!input.retainedReceiptIds.includes(r.id)) blobs.delete(r.id);
    for (const r of added) blobs.add(r);
    entries.put(expense); return expense;
  });
}
export async function receiptBlob(id: string): Promise<Blob> {
  const result = await transaction('readonly', tx => read<StoredReceipt | undefined>(tx.objectStore('receipts').get(id)));
  if (!result) throw new StorageError('영수증 파일을 찾을 수 없습니다.'); return result.blob;
}
export async function ledgerRequest(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    init.signal?.throwIfAborted(); const url = new URL(input, 'https://ledger.local'); const method = init.method || 'GET';
    if (url.pathname === '/api/expenses' && method === 'GET') {
      const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
      if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) throw new StorageError('조회 기간을 확인해 주세요.');
      const expenses = await transaction('readonly', tx => read<Expense[]>(tx.objectStore('expenses').getAll()));
      init.signal?.throwIfAborted();
      return Response.json({ expenses: expenses.filter(e => (!from || e.paidOn >= from) && (!to || e.paidOn <= to)).sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)) });
    }
    if ((url.pathname === '/api/expenses' && method === 'POST') || (/^\/api\/expenses\/[^/]+$/.test(url.pathname) && method === 'PUT')) {
      if (!(init.body instanceof FormData)) throw new StorageError('지출 내용을 확인해 주세요.');
      const payload = init.body.get('payload'); if (typeof payload !== 'string') throw new StorageError('지출 내용을 확인해 주세요.');
      const value = validateExpense(JSON.parse(payload));
      if (method === 'PUT' && url.pathname.split('/').pop() !== value.id) throw new StorageError('지출 내용을 확인해 주세요.');
      const files = init.body.getAll('files'); if (files.some(f => !(f instanceof File))) throw new StorageError('첨부 파일을 확인해 주세요.');
      await save(value, files as File[], method === 'PUT'); return Response.json({ ok: true, id: value.id }, { status: method === 'POST' ? 201 : 200 });
    }
    if (/^\/api\/expenses\/[^/]+$/.test(url.pathname) && method === 'DELETE') {
      const id = url.pathname.split('/').pop()!; const version = Number(url.searchParams.get('version'));
      await transaction('readwrite', async tx => {
        const entries = tx.objectStore('expenses'), receipts = tx.objectStore('receipts'); const old = await read<Expense | undefined>(entries.get(id));
        if (!old || old.version !== version) throw new StorageError('내역이 다른 탭에서 변경되었습니다. 새로고침한 후 다시 시도해 주세요.', 409);
        for (const receipt of old.receipts) receipts.delete(receipt.id); entries.delete(id);
      }); return Response.json({ ok: true });
    }
    throw new StorageError('요청한 내역을 찾을 수 없습니다.', 404);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return Response.json({ error: errorMessage(error) }, { status: error instanceof StorageError ? error.status : 400 });
  }
}
function encodeBase64(bytes: Uint8Array): string { let out = ''; for (let i = 0; i < bytes.length; i += 24576) out += btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))); return out; }
function decodeBase64(data: string): Uint8Array {
  if (!data || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))) throw new StorageError('백업 파일의 영수증 데이터가 올바르지 않습니다.');
  const binary = atob(data); return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function exportBackup(): Promise<Blob> {
  const snapshot = await transaction('readonly', async tx => {
    const entries = read<Expense[]>(tx.objectStore('expenses').getAll()), files = read<StoredReceipt[]>(tx.objectStore('receipts').getAll());
    return { expenses: await entries, receipts: await files };
  });
  const receipts: BackupReceipt[] = [];
  for (const r of snapshot.receipts) receipts.push({ ...meta(r), expenseId: r.expenseId, data: encodeBase64(new Uint8Array(await r.blob.arrayBuffer())) });
  const backup: Backup = { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), expenses: snapshot.expenses, receipts };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new StorageError('백업 파일이 512MB를 초과합니다. 첨부파일 용량을 줄인 후 다시 시도해 주세요.');
  return blob;
}
export async function importBackup(file: File): Promise<{ imported: number; preserved: number }> {
  if (!file.size || file.size > MAX_BACKUP_BYTES) throw new StorageError('512MB 이하의 가계부 백업 파일을 선택해 주세요.');
  let value: unknown; try { value = JSON.parse(await file.text()); } catch { throw new StorageError('가계부 백업 JSON 파일을 선택해 주세요.'); }
  const data = value as Partial<Backup> | null;
  if (!data || data.format !== BACKUP_FORMAT || data.version !== 1 || !Array.isArray(data.expenses) || !Array.isArray(data.receipts)) throw new StorageError('지원하지 않는 백업 파일입니다.');
  const expenses: Expense[] = [], receipts = new Map<string, StoredReceipt>(); const entryIds = new Set<string>();
  for (const r of data.receipts) {
    if (!r || !UUID.test(r.id) || !UUID.test(r.expenseId) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 180 || fileName(r.name) !== r.name || typeof r.data !== 'string' || !Number.isSafeInteger(r.size) || r.size < 1 || r.size > MAX_FILE_BYTES || receipts.has(r.id)) throw new StorageError('백업 파일의 영수증 정보가 올바르지 않습니다.');
    const bytes = decodeBase64(r.data); if (bytes.byteLength !== r.size) throw new StorageError('백업 파일의 영수증 크기가 일치하지 않습니다.');
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: r.mime }); const mime = await detectMime(blob, r.name);
    if (mime !== r.mime) throw new StorageError('백업 파일의 영수증 형식이 일치하지 않습니다.');
    receipts.set(r.id, { ...meta(r as unknown as StoredReceipt), expenseId: r.expenseId, blob });
  }
  const usedReceiptIds = new Set<string>();
  for (const entry of data.expenses) {
    if (!entry || !Array.isArray(entry.receipts) || entryIds.has(entry.id) || typeof entry.createdAt !== 'string' || Number.isNaN(Date.parse(entry.createdAt))) throw new StorageError('백업 파일의 지출 정보가 올바르지 않습니다.');
    const input = validateExpense({ ...entry, retainedReceiptIds: entry.receipts.map(r => r?.id) });
    if (!Number.isSafeInteger(entry.version) || entry.version < 1) throw new StorageError('백업 파일의 지출 버전이 올바르지 않습니다.');
    const fileList = entry.receipts.map(r => { const saved = receipts.get(r.id); if (!saved || saved.expenseId !== entry.id || saved.name !== r.name || saved.mime !== r.mime || saved.size !== r.size || usedReceiptIds.has(r.id)) throw new StorageError('백업 파일의 영수증 연결이 올바르지 않습니다.'); usedReceiptIds.add(r.id); return meta(saved); });
    receiptLimits(fileList); entryIds.add(entry.id);
    expenses.push({ id: input.id, paidOn: input.paidOn, category: input.category, child: input.child, title: input.title, amount: input.amount, version: entry.version, createdAt: entry.createdAt, receipts: fileList });
  }
  if (usedReceiptIds.size !== receipts.size) throw new StorageError('백업 파일에 연결되지 않은 영수증이 있습니다.');
  return transaction('readwrite', async tx => {
    const entries = tx.objectStore('expenses'), blobs = tx.objectStore('receipts'); let imported = 0, preserved = 0;
    for (const entry of expenses) {
      if (await read(entries.getKey(entry.id))) { preserved++; continue; }
      let collision = false;
      for (const receipt of entry.receipts) if (await read(blobs.getKey(receipt.id))) collision = true;
      if (collision) { preserved++; continue; }
      for (const receipt of entry.receipts) blobs.add(receipts.get(receipt.id)!);
      entries.add(entry); imported++;
    }
    return { imported, preserved };
  }).catch(error => { throw new StorageError(errorMessage(error)); });
}
