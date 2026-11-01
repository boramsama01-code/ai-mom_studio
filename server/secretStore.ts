/**
 * 화면에서 입력한 연결 키 저장소
 *
 * - 값은 AES-256-GCM으로 암호화해 DB(stored_secrets)에 저장한다.
 * - 암호키: APP_SECRETS_KEY(있으면) 또는 APP_SESSION_SECRET에서 HKDF로 유도. 암호키 자체는 DB에 없다.
 * - 우선순위: Render/GitHub에 직접 넣은 환경변수 > 화면에서 입력한 값.
 * - 시작할 때(웹서버·워커) DB 값을 복호화해 process.env에 채운다. 이후 코드는 기존처럼 환경변수를 읽는다.
 * - 비밀값은 API 응답·로그·감사 기록에 절대 남기지 않는다(감사 기록에는 키 이름만).
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import { storedSecrets } from "../shared/schema";

/** 프로세스 시작 시점에 이미 있던 환경변수(= Render/GitHub에서 직접 넣은 값) */
const ORIGINAL_ENV_KEYS = new Set(Object.keys(process.env).filter((k) => process.env[k]));
const fromStore = new Set<string>();
const unreadable = new Set<string>();

export class SecretKeyMissing extends Error {
  constructor() {
    super("암호키가 없습니다(APP_SESSION_SECRET 또는 APP_SECRETS_KEY 필요).");
  }
}

function masterMaterial(): string {
  const m = process.env.APP_SECRETS_KEY || process.env.APP_SESSION_SECRET || "";
  if (m.length < 16) throw new SecretKeyMissing();
  return m;
}

function derivedKey(): Buffer {
  // Immutable encryption context: changing this historical value would make
  // every previously saved API key unreadable. It is never a public brand label.
  return Buffer.from(crypto.hkdfSync("sha256", masterMaterial(), "ai-mom-studio", "stored-secrets-v1", 32));
}

export function keyFingerprint(): string {
  return crypto.createHash("sha256").update(derivedKey()).digest("hex").slice(0, 12);
}

export function encryptValue(value: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", derivedKey(), iv);
  const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), keyFingerprint: keyFingerprint() };
}

export function decryptValue(row: { ciphertext: string; iv: string; tag: string }): string {
  const d = crypto.createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(row.iv, "base64"));
  d.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(row.ciphertext, "base64")), d.final()]).toString("utf8");
}

export function isFromEnvironment(key: string): boolean {
  return ORIGINAL_ENV_KEYS.has(key) && !fromStore.has(key);
}

/** DB에 저장된 값을 process.env에 채운다(직접 넣은 환경변수는 덮어쓰지 않음) */
export async function loadStoredSecrets(db: DB): Promise<{ loaded: number; skippedEnv: number; unreadable: string[] }> {
  let loaded = 0, skippedEnv = 0;
  unreadable.clear();
  let rows: Array<typeof storedSecrets.$inferSelect>;
  try {
    rows = await db.select().from(storedSecrets);
  } catch {
    return { loaded: 0, skippedEnv: 0, unreadable: [] }; // 마이그레이션 전 등
  }
  if (rows.length) {
    try {
      masterMaterial();
    } catch {
      console.warn("APP_SESSION_SECRET(또는 APP_SECRETS_KEY)가 없어 화면에서 입력한 연결 키를 읽지 못했습니다. GitHub Actions라면 Secrets에 APP_SESSION_SECRET을 추가하세요.");
      rows.forEach((r) => !isFromEnvironment(r.key) && unreadable.add(r.key));
      return { loaded: 0, skippedEnv: 0, unreadable: [...unreadable] };
    }
  }
  for (const r of rows) {
    if (isFromEnvironment(r.key)) {
      skippedEnv++;
      continue;
    }
    try {
      process.env[r.key] = decryptValue(r);
      fromStore.add(r.key);
      loaded++;
    } catch {
      unreadable.add(r.key); // 암호키가 바뀌었거나 손상 — 다시 입력 필요
    }
  }
  if (unreadable.size) console.warn(`저장된 연결 키 ${unreadable.size}개를 읽을 수 없습니다(암호키 변경 가능성). 채널 설정에서 다시 입력하세요: ${[...unreadable].join(", ")}`);
  return { loaded, skippedEnv, unreadable: [...unreadable] };
}

export type SecretStatus = { key: string; source: "environment" | "screen" | "none" | "unreadable"; updatedAt: string | null; valueLength: number | null };

export async function secretStatuses(db: DB, keys: string[]): Promise<SecretStatus[]> {
  const rows = await db.select({ key: storedSecrets.key, updatedAt: storedSecrets.updatedAt, valueLength: storedSecrets.valueLength }).from(storedSecrets);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map((key) => {
    const row = byKey.get(key);
    const source: SecretStatus["source"] = isFromEnvironment(key) ? "environment" : unreadable.has(key) ? "unreadable" : row && process.env[key] ? "screen" : "none";
    return { key, source, updatedAt: row ? new Date(row.updatedAt).toISOString() : null, valueLength: row?.valueLength ?? null };
  });
}

export async function saveSecret(db: DB, key: string, value: string, actor: string) {
  if (isFromEnvironment(key)) throw new Error("ENV_OWNED");
  const enc = encryptValue(value);
  await db
    .insert(storedSecrets)
    .values({ key, ...enc, valueLength: value.length, updatedBy: actor })
    .onConflictDoUpdate({ target: storedSecrets.key, set: { ...enc, valueLength: value.length, updatedBy: actor, updatedAt: new Date() } });
  process.env[key] = value;
  fromStore.add(key);
  unreadable.delete(key);
}

export async function deleteSecret(db: DB, key: string) {
  if (isFromEnvironment(key)) throw new Error("ENV_OWNED");
  await db.delete(storedSecrets).where(eq(storedSecrets.key, key));
  if (fromStore.has(key)) delete process.env[key];
  fromStore.delete(key);
  unreadable.delete(key);
}

/** 테스트 전용: 시작 시점 환경변수 목록을 흉내 */
export function __setOriginalEnvForTest(keys: string[]) {
  ORIGINAL_ENV_KEYS.clear();
  keys.forEach((k) => ORIGINAL_ENV_KEYS.add(k));
  fromStore.clear();
  unreadable.clear();
}

