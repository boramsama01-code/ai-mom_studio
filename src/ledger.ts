export const CATEGORIES = ["교육비", "식비", "생활용품", "주거·통신", "교통·차량", "의료·건강", "쇼핑", "문화·여가", "여행", "기타"] as const;
export type Category = typeof CATEGORIES[number];
export type Child = "현우" | "정우";
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_AMOUNT = 999_999_999_999;
export const RECEIPT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
export type Receipt = { id: string; name: string; mime: string; size: number };
export type Expense = { id: string; paidOn: string; category: Category; child: Child | null; title: string; amount: number; version: number; createdAt: string; receipts: Receipt[] };
export type ExpenseInput = { id: string; paidOn: string; category: Category; child: Child | null; title: string; amount: number; version?: number; retainedReceiptIds: string[] };

export function todayKST() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function monthRange(date = todayKST(), offset = 0) {
  const [year, month] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2200-12-31") return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function formatWon(amount: number) { return new Intl.NumberFormat("ko-KR").format(amount); }
export function validateExpense(value: unknown): ExpenseInput {
  const x = value as Partial<ExpenseInput> | null;
  if (!x || typeof x !== "object") throw new Error("지출 내용을 확인해 주세요.");
  if (typeof x.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x.id)) throw new Error("저장 요청이 올바르지 않아요. 창을 다시 열어 주세요.");
  if (!isDate(x.paidOn)) throw new Error("결제일을 올바르게 입력해 주세요.");
  if (!CATEGORIES.includes(x.category as Category)) throw new Error("카테고리를 선택해 주세요.");
  if (x.category === "교육비" && x.child !== "현우" && x.child !== "정우") throw new Error("교육비는 현우 또는 정우를 선택해 주세요.");
  if (typeof x.title !== "string" || !x.title.trim() || x.title.trim().length > 100) throw new Error("항목은 1~100자로 입력해 주세요.");
  if (!Number.isSafeInteger(x.amount) || x.amount! < 1 || x.amount! > MAX_AMOUNT) throw new Error("금액은 1원 이상, 1조 원 미만의 정수로 입력해 주세요.");
  if (!Array.isArray(x.retainedReceiptIds) || x.retainedReceiptIds.length > MAX_FILES || x.retainedReceiptIds.some(id => typeof id !== "string") || new Set(x.retainedReceiptIds).size !== x.retainedReceiptIds.length) throw new Error("영수증 목록을 확인해 주세요.");
  if (x.version !== undefined && (!Number.isSafeInteger(x.version) || x.version < 1)) throw new Error("지출 버전이 올바르지 않아요.");
  return { id: x.id, paidOn: x.paidOn, category: x.category!, child: x.category === "교육비" ? x.child as Child : null, title: x.title.trim(), amount: x.amount!, version: x.version, retainedReceiptIds: x.retainedReceiptIds };
}
