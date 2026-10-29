import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, chmod, open, rename, unlink, readdir, stat } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { isDate, validateExpense, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES } from "../src/ledger.ts";

const scrypt = promisify(scryptCallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const EXPENSE_COLUMNS = "id, paid_on AS paidOn, category, child, title, amount, version, created_at AS createdAt";
const RECEIPT_COLUMNS = "id, expense_id AS expenseId, object_key AS objectKey, name, mime, size";
const NO_CACHE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function equalSecret(a, b) {
  return typeof a === "string" && typeof b === "string" && timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
}
function usernameValue(value) {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw new ApiError("아이디는 영문·숫자·밑줄·마침표·하이픈으로 3~40자 입력해 주세요.");
  return username;
}
function passwordValue(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) throw new ApiError("비밀번호는 12~128자로 입력해 주세요.");
  return value;
}
async function passwordHash(password, salt = randomBytes(24).toString("hex")) {
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${result.toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const [, salt, hash] = (stored || "").split("$");
  const expected = salt && /^[a-f0-9]{128}$/.test(hash || "") ? stored : `scrypt$${"0".repeat(48)}$${"0".repeat(128)}`;
  const candidate = await passwordHash(password, expected.split("$")[1]);
  return !!stored && equalSecret(candidate, expected);
}
function cookieValue(req, name) {
  const cookie = req.headers.cookie || "";
  if (cookie.length > 16_384) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) { const token = value.join("="); return TOKEN_PATTERN.test(token) ? token : null; }
  }
  return null;
}
function safeFileName(value) {
  let name = value || "receipt";
  // Multipart filenames can arrive as latin-1 bytes containing UTF-8.
  if (/[\u0080-\u00ff]/.test(name) && [...name].every(char => char.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (!decoded.includes("\uFFFD")) name = decoded;
  }
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180);
}
function assertId(value) { if (typeof value !== "string" || !UUID.test(value)) throw new ApiError("내역을 찾을 수 없어요.", 404); }
function transact(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}
function migrate(db) {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1) throw new Error("Database schema is newer than this application.");
  if (version === 0) transact(db, () => db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE CHECK(slot = 1),
      username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_user_idx ON sessions(user_id, created_at);
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), paid_on TEXT NOT NULL,
      category TEXT NOT NULL, child TEXT, title TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX expenses_owner_date_idx ON expenses(owner_id, paid_on);
    CREATE TABLE receipts (
      id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id), object_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX receipts_expense_idx ON receipts(expense_id);
    CREATE TABLE file_cleanup (object_key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    PRAGMA user_version = 1;
  `));
}

export async function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || ".data");
  const staticDir = path.resolve(options.staticDir || "dist");
  const setupKey = options.setupKey ?? process.env.OWNER_SETUP_KEY ?? "";
  const production = options.production ?? process.env.NODE_ENV === "production";
  const appOrigin = options.appOrigin || process.env.APP_ORIGIN || "";
  const logger = options.logger || console;
  const incomingDir = path.join(dataDir, "incoming");
  const receiptDir = path.join(dataDir, "receipts");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(incomingDir, { recursive: true, mode: 0o700 });
  await mkdir(receiptDir, { recursive: true, mode: 0o700 });
  const databaseFile = path.join(dataDir, "ledger.sqlite");
  const db = new DatabaseSync(databaseFile);
  migrate(db);
  await chmod(databaseFile, 0o600);
  const cookieName = production ? "__Host-ledger_session" : "ledger_session";
  const cookieOptions = { httpOnly: true, secure: production, sameSite: "strict", path: "/", maxAge: SESSION_MS };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" });
    if (production) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set(NO_CACHE); res.vary("Cookie");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected = appOrigin || `${req.protocol}://${req.get("host")}`;
      if (req.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) return next(new ApiError("이 페이지에서 다시 시도해 주세요.", 403));
    }
    next();
  });
  app.use(express.json({ limit: "32kb", strict: true }));

  const hasOwner = () => !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
  function session(req) {
    const token = cookieValue(req, cookieName);
    if (!token) return null;
    return db.prepare("SELECT u.id, u.username, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?").get(digest(token), Date.now()) || null;
  }
  function requireUser(req, res, next) {
    const user = session(req);
    if (!user) return next(new ApiError("로그인이 필요해요.", 401));
    req.ledgerUser = user; next();
  }
  function issueSession(req, res, user) {
    const old = cookieValue(req, cookieName);
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    transact(db, () => {
      if (old) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(old));
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(digest(token), user.id, now + SESSION_MS, now);
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20)").run(user.id, user.id);
    });
    res.cookie(cookieName, token, cookieOptions);
  }
  const attempts = new Map();
  function authLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    const previous = attempts.get(key);
    const entry = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60_000 };
    entry.count += 1; attempts.set(key, entry);
    if (attempts.size > 5000) {
      for (const [ip, item] of attempts) { if (item.until <= now) attempts.delete(ip); }
      while (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
    }
    if (entry.count > 15) { res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000))); return next(new ApiError("시도가 너무 많아요. 잠시 후 다시 시도해 주세요.", 429)); }
    next();
  }
  function resetLimit(req) { attempts.delete(req.ip || "unknown"); }

  app.get("/api/health", (req, res) => { db.prepare("SELECT 1").get(); res.json({ ok: true }); });
  app.get("/api/session", (req, res) => {
    const user = session(req);
    res.json({ authenticated: !!user, setupRequired: !hasOwner(), ...(user ? { user: { name: user.name, username: user.username } } : {}) });
  });
  app.post("/api/setup", authLimit, async (req, res) => {
    if (hasOwner()) throw new ApiError("이미 설정된 가계부예요. 로그인해 주세요.", 409);
    if (setupKey.length < 32) throw new ApiError("초기 설정 키가 준비되지 않았어요. 배포 설정을 확인해 주세요.", 503);
    if (!equalSecret(req.body?.setupKey, setupKey)) throw new ApiError("초기 설정 링크를 확인해 주세요.", 401);
    const username = usernameValue(req.body?.username);
    const password = passwordValue(req.body?.password);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (name.length > 40) throw new ApiError("이름은 40자 이내로 입력해 주세요.");
    const hash = await passwordHash(password);
    const user = { id: randomUUID(), username, name: name || "가계부" };
    transact(db, () => {
      if (hasOwner()) throw new ApiError("이미 설정된 가계부예요. 로그인해 주세요.", 409);
      db.prepare("INSERT INTO users (id, slot, username, name, password_hash, created_at) VALUES (?, 1, ?, ?, ?, ?)").run(user.id, user.username, user.name, hash, new Date().toISOString());
    });
    issueSession(req, res, user); resetLimit(req);
    res.status(201).json({ authenticated: true, setupRequired: false, user: { name: user.name, username: user.username } });
  });
  app.post("/api/login", authLimit, async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase().slice(0, 40) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length > 128) throw new ApiError("아이디 또는 비밀번호를 확인해 주세요.", 401);
    const user = db.prepare("SELECT id, username, name, password_hash FROM users WHERE username = ?").get(username);
    if (!await passwordMatches(password, user?.password_hash)) throw new ApiError("아이디 또는 비밀번호를 확인해 주세요.", 401);
    issueSession(req, res, user); resetLimit(req);
    res.json({ authenticated: true, setupRequired: false, user: { name: user.name, username: user.username } });
  });
  app.post("/api/logout", (req, res) => {
    const token = cookieValue(req, cookieName);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
    const { maxAge, ...clearOptions } = cookieOptions;
    res.clearCookie(cookieName, clearOptions); res.json({ ok: true });
  });

  const storage = {
    _handleFile(req, file, callback) {
      const filename = randomUUID();
      const filePath = path.join(incomingDir, filename);
      let size = 0;
      const limit = new Transform({ transform(chunk, encoding, done) {
        size += chunk.length; req.ledgerUploadBytes = (req.ledgerUploadBytes || 0) + chunk.length;
        if (req.ledgerUploadBytes > MAX_TOTAL_FILE_BYTES) return done(new ApiError("영수증 합계는 20MB 이하여야 해요.", 413));
        done(null, chunk);
      } });
      pipeline(file.stream, limit, createWriteStream(filePath, { flags: "wx", mode: 0o600 }))
        .then(() => callback(null, { path: filePath, filename, size }))
        .catch(async error => { await unlink(filePath).catch(() => {}); callback(error); });
    },
    _removeFile(req, file, callback) { unlink(file.path).then(() => callback(null)).catch(error => callback(error.code === "ENOENT" ? null : error)); },
  };
  const upload = multer({ storage, limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 1, fieldSize: 16_384, parts: MAX_FILES + 1 },
    fileFilter(req, file, callback) {
      if (!/\.(jpe?g|png|webp|pdf)$/i.test(file.originalname)) return callback(new ApiError("JPG·PNG·WebP 이미지 또는 PDF를 선택해 주세요."));
      callback(null, true);
    },
  }).array("files", MAX_FILES);
  function uploadGuard(req, res, next) {
    if (!req.is("multipart/form-data")) return next(new ApiError("입력 형식을 확인해 주세요."));
    if (Number(req.get("content-length") || 0) > MAX_TOTAL_FILE_BYTES + 256 * 1024) return next(new ApiError("영수증 합계는 20MB 이하여야 해요.", 413));
    upload(req, res, next);
  }
  function expenseFor(owner, id) { return db.prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE id = ? AND owner_id = ?`).get(id, owner); }
  function sameExpense(existing, input) {
    return ["paidOn", "category", "child", "title", "amount"].every(field => existing[field] === input[field]);
  }
  function receiptsFor(owner, id) { return db.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE expense_id = ? AND owner_id = ? ORDER BY created_at, id`).all(id, owner); }
  function receiptPath(key) { assertId(key); return path.join(receiptDir, key); }
  async function cleanUnreferenced(keys) {
    for (const key of keys) {
      try {
        if (db.prepare("SELECT 1 FROM receipts WHERE object_key = ?").get(key)) continue;
        await unlink(receiptPath(key)).catch(error => { if (error.code !== "ENOENT") throw error; });
        db.prepare("DELETE FROM file_cleanup WHERE object_key = ?").run(key);
      } catch {
        try { db.prepare("INSERT OR IGNORE INTO file_cleanup (object_key, created_at) VALUES (?, ?)").run(key, new Date().toISOString()); } catch {}
      }
    }
  }
  async function flushCleanup() {
    try { await cleanUnreferenced(db.prepare("SELECT object_key FROM file_cleanup ORDER BY created_at LIMIT 30").all().map(r => r.object_key)); } catch {}
  }
  async function inspect(file) {
    if (!file.size || file.size > MAX_FILE_BYTES) throw new ApiError("각 영수증은 0바이트보다 크고 10MB 이하여야 해요.");
    const handle = await open(file.path, "r");
    const buffer = Buffer.alloc(16);
    try { await handle.read(buffer, 0, 16, 0); } finally { await handle.close(); }
    let mime;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) mime = "image/jpeg";
    else if (Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(buffer.subarray(0, 8))) mime = "image/png";
    else if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
    else if (buffer.toString("ascii", 0, 5) === "%PDF-") mime = "application/pdf";
    const name = safeFileName(file.originalname);
    const expected = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
    if (!mime || expected[name.split(".").pop().toLowerCase()] !== mime) throw new ApiError("파일 내용이 올바른 JPG·PNG·WebP·PDF인지 확인해 주세요.");
    return { file, name, mime, size: file.size, id: randomUUID(), objectKey: randomUUID() };
  }

  app.get("/api/expenses", requireUser, (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if ((from && !isDate(from)) || (to && !isDate(to))) throw new ApiError("조회 날짜를 확인해 주세요.");
    if (from && to && from > to) throw new ApiError("시작일은 종료일보다 늦을 수 없어요.");
    const clauses = ["e.owner_id = ?"], args = [req.ledgerUser.id];
    if (from) { clauses.push("e.paid_on >= ?"); args.push(from); }
    if (to) { clauses.push("e.paid_on <= ?"); args.push(to); }
    const where = clauses.join(" AND ");
    const expenses = db.prepare(`SELECT e.id, e.paid_on AS paidOn, e.category, e.child, e.title, e.amount, e.version, e.created_at AS createdAt FROM expenses e WHERE ${where} ORDER BY e.paid_on DESC, e.created_at DESC, e.id DESC`).all(...args);
    const receipts = db.prepare(`SELECT r.id, r.expense_id AS expenseId, r.name, r.mime, r.size FROM receipts r JOIN expenses e ON e.id = r.expense_id AND e.owner_id = r.owner_id WHERE ${where} ORDER BY r.created_at, r.id`).all(...args);
    const groups = new Map();
    for (const { expenseId, ...receipt } of receipts) { if (!groups.has(expenseId)) groups.set(expenseId, []); groups.get(expenseId).push(receipt); }
    res.json({ expenses: expenses.map(e => ({ ...e, receipts: groups.get(e.id) || [] })) });
  });
  async function save(req, res) {
    const files = req.files || [];
    const moved = [];
    let committed = false;
    try {
      let input;
      try { input = validateExpense(JSON.parse(req.body?.payload)); }
      catch (error) { throw new ApiError(error instanceof SyntaxError ? "입력 형식을 확인해 주세요." : error.message); }
      const owner = req.ledgerUser.id;
      const updating = req.method === "PUT";
      if (updating) { assertId(req.params.id); if (input.id !== req.params.id) throw new ApiError("수정할 내역을 다시 선택해 주세요."); }
      if (!updating && input.retainedReceiptIds.length) throw new ApiError("새 지출의 영수증을 다시 선택해 주세요.");
      if (files.length + input.retainedReceiptIds.length > MAX_FILES) throw new ApiError("영수증은 최대 5개까지 첨부할 수 있어요.");
      const existing = expenseFor(owner, input.id);
      if (!updating && existing) {
        if (!sameExpense(existing, input)) throw new ApiError("이 지출은 이미 저장되었어요. 목록에서 수정해 주세요.", 409);
        return res.json({ ok: true, id: input.id });
      }
      if (updating && !existing) throw new ApiError("내역을 찾을 수 없어요.", 404);
      if (updating && input.version !== existing.version) throw new ApiError("내역이 변경되었어요. 목록을 새로고침한 뒤 다시 수정해 주세요.", 409);
      const checked = await Promise.all(files.map(inspect));
      for (const item of checked) {
        await rename(item.file.path, receiptPath(item.objectKey));
        moved.push(item.objectKey);
        const handle = await open(receiptPath(item.objectKey), "r");
        try { await handle.sync(); } finally { await handle.close(); }
      }
      const now = new Date().toISOString();
      const result = transact(db, () => {
        const current = expenseFor(owner, input.id);
        if (!updating && current) {
          if (!sameExpense(current, input)) throw new ApiError("이 지출은 이미 저장되었어요. 목록에서 수정해 주세요.", 409);
          return { duplicate: true };
        }
        if (updating && !current) throw new ApiError("내역을 찾을 수 없어요.", 404);
        if (updating && current.version !== input.version) throw new ApiError("다른 창에서 내역이 변경되었어요. 다시 불러와 주세요.", 409);
        const old = current ? receiptsFor(owner, input.id) : [];
        const keep = new Set(input.retainedReceiptIds);
        if (input.retainedReceiptIds.some(id => !old.some(r => r.id === id))) throw new ApiError("영수증 목록이 변경되었어요. 내역을 다시 열어 주세요.", 409);
        const retained = old.filter(r => keep.has(r.id));
        if (retained.reduce((sum, r) => sum + r.size, 0) + checked.reduce((sum, r) => sum + r.size, 0) > MAX_TOTAL_FILE_BYTES) throw new ApiError("기존·새 영수증을 합쳐 20MB 이하로 첨부해 주세요.");
        if (updating) db.prepare("UPDATE expenses SET paid_on = ?, category = ?, child = ?, title = ?, amount = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?").run(input.paidOn, input.category, input.child, input.title, input.amount, now, input.id, owner, input.version);
        else db.prepare("INSERT INTO expenses (id, owner_id, paid_on, category, child, title, amount, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(input.id, owner, input.paidOn, input.category, input.child, input.title, input.amount, now, now);
        for (const receipt of old.filter(r => !keep.has(r.id))) {
          db.prepare("INSERT OR IGNORE INTO file_cleanup (object_key, created_at) VALUES (?, ?)").run(receipt.objectKey, now);
          db.prepare("DELETE FROM receipts WHERE id = ? AND owner_id = ?").run(receipt.id, owner);
        }
        for (const receipt of checked) db.prepare("INSERT INTO receipts (id, expense_id, owner_id, object_key, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(receipt.id, input.id, owner, receipt.objectKey, receipt.name, receipt.mime, receipt.size, now);
        return { duplicate: false };
      });
      committed = !result.duplicate;
      if (result.duplicate) await cleanUnreferenced(moved);
      await flushCleanup();
      res.status(updating || result.duplicate ? 200 : 201).json({ ok: true, id: input.id });
    } catch (error) {
      if (!committed) await cleanUnreferenced(moved);
      throw error;
    } finally {
      await Promise.all(files.map(file => unlink(file.path).catch(() => {})));
    }
  }
  app.post("/api/expenses", requireUser, uploadGuard, save);
  app.put("/api/expenses/:id", requireUser, uploadGuard, save);
  app.delete("/api/expenses/:id", requireUser, async (req, res) => {
    assertId(req.params.id);
    const owner = req.ledgerUser.id;
    const version = Number(req.query.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new ApiError("목록을 새로고침한 뒤 다시 삭제해 주세요.");
    transact(db, () => {
      const current = expenseFor(owner, req.params.id);
      if (!current) return;
      if (current.version !== version) throw new ApiError("내역이 변경되었어요. 목록을 새로고침한 뒤 다시 삭제해 주세요.", 409);
      for (const receipt of receiptsFor(owner, req.params.id)) db.prepare("INSERT OR IGNORE INTO file_cleanup (object_key, created_at) VALUES (?, ?)").run(receipt.objectKey, new Date().toISOString());
      db.prepare("DELETE FROM expenses WHERE id = ? AND owner_id = ? AND version = ?").run(req.params.id, owner, version);
    });
    await flushCleanup(); res.json({ ok: true });
  });
  app.get("/api/receipts/:id", requireUser, (req, res, next) => {
    assertId(req.params.id);
    const receipt = db.prepare("SELECT r.object_key AS objectKey, r.name, r.mime, r.size FROM receipts r JOIN expenses e ON e.id = r.expense_id AND e.owner_id = r.owner_id WHERE r.id = ? AND r.owner_id = ?").get(req.params.id, req.ledgerUser.id);
    if (!receipt) throw new ApiError("영수증을 찾을 수 없어요.", 404);
    const filename = encodeURIComponent(receipt.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
    const extension = receipt.mime === "application/pdf" ? "pdf" : receipt.mime === "image/jpeg" ? "jpg" : receipt.mime.split("/")[1];
    res.set({
      ...NO_CACHE,
      "Content-Type": receipt.mime,
      "Content-Disposition": `${req.query.download === "1" ? "attachment" : "inline"}; filename="receipt.${extension}"; filename*=UTF-8''${filename}`,
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.sendFile(receiptPath(receipt.objectKey), { cacheControl: false, lastModified: false }, error => { if (error) next(error.code === "ENOENT" ? new ApiError("영수증 파일을 찾을 수 없어요.", 404) : error); });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "요청한 경로를 찾을 수 없어요." }));
  app.use(express.static(staticDir, { index: false, maxAge: production ? "1y" : 0, immutable: production, dotfiles: "deny" }));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
    if (path.extname(req.path) || !existsSync(path.join(staticDir, "index.html"))) return res.status(404).send("Not found");
    res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(staticDir, "index.html"));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) return res.status(400).json({ error: "영수증은 최대 5개, 파일당 10MB까지 첨부할 수 있어요. 첨부 내용을 확인해 주세요." });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "요청 크기가 너무 커요." });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "입력 형식을 확인해 주세요." });
    logger.error("Ledger request failed", error.code || error.name || "Error");
    res.status(500).json({ error: "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." });
  });

  // Reclaim old crash leftovers only after confirming they have no DB reference.
  for (const [directory, final] of [[incomingDir, false], [receiptDir, true]]) {
    for (const name of await readdir(directory)) {
      if (!UUID.test(name)) continue;
      const file = path.join(directory, name);
      const info = await stat(file).catch(() => null);
      if (!info || info.mtimeMs > Date.now() - 60 * 60_000) continue;
      if (final) await cleanUnreferenced([name]);
      else await unlink(file).catch(() => {});
    }
  }
  await flushCleanup();
  let closed = false;
  return { app, db, dataDir, close() { if (!closed) { closed = true; db.close(); } } };
}
