/**
 * 단일 운영자 인증
 * - 비밀번호는 bcrypt 해시(ADMIN_PASSWORD_HASH)만 환경변수에 둔다. 평문 저장 금지.
 * - 세션: Postgres 저장(connect-pg-simple), httpOnly 쿠키, 운영 환경에서 secure.
 * - 허용 목록: ADMIN_USERNAME과 일치하는 계정만 운영자.
 * - CSRF: 로그인 시 발급한 토큰을 변경 요청 헤더(X-CSRF-Token)로 검증 + Origin 검사.
 * - 로그인 시도 제한: 15분 내 실패 5회 → 잠시 차단.
 * - 인증 설정이 없으면 운영 API를 차단한다(개발 환경 + DEMO_MODE=true일 때만 샘플 모드 로그인 허용).
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { rateLimit } from "express-rate-limit";
import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { env } from "./env";
import { getDb, getPool } from "./db";
import { loginAttempts } from "../shared/schema";
import { audit } from "./audit";
import { z } from "zod";
import { ah, parse } from "./routes/util";
import { checkPasswordReset, operatorCredential, setOperatorPassword } from "./services/operatorPassword";
import { isPrivateStudioAssetPath } from "./studioAssetPath";

declare module "express-session" {
  interface SessionData {
    user?: string;
    csrf?: string;
    demo?: boolean;
    privateLinkHash?: string;
    credentialVersion?: number;
    instagramOauth?: import("./services/instagramOAuth").PendingInstagramOAuth;
  }
}

export function authConfigured() {
  return !!(env.adminUsername && env.adminPasswordHash && env.sessionSecret);
}

export function demoAllowed() {
  return !env.isProduction && env.demoMode;
}

export function installSession(app: Express) {
  const PgStore = connectPg(session);
  const secret = env.sessionSecret || (demoAllowed() || env.appEnv === "test" ? crypto.randomBytes(32).toString("hex") : "");
  if (!secret) return false;
  app.use(
    session({
      store: new PgStore({ pool: getPool(), tableName: "user_sessions", createTableIfMissing: true }),
      name: "spacepenguin.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: "lax", secure: env.isProduction, maxAge: 12 * 60 * 60 * 1000 },
    }),
  );
  // Password versions are checked against shared DB state on both Render services.
  app.use(ah(async (req, _res, next) => {
    if (!(req.path.startsWith("/api") || isPrivateStudioAssetPath(req.path)) || !req.session?.user || req.session.demo) return next();
    const credential = await operatorCredential(getDb());
    if ((req.session.credentialVersion ?? 0) !== credential.version || (req.session.privateLinkHash && (req.session.privateLinkHash !== env.privateLinkHash || req.session.privateLinkHash === credential.blockedPrivateLinkHash))) {
      delete req.session.user;
      delete req.session.csrf;
      delete req.session.privateLinkHash;
      delete req.session.credentialVersion;
    }
    next();
  }));
  return true;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireOperator(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (req.session.user !== env.adminUsername && !(req.session.demo && demoAllowed()))
    return res.status(403).json({ error: "운영자 권한이 없습니다." });
  if (MUTATING.has(req.method)) {
    const token = req.get("x-csrf-token");
    if (!token || !req.session.csrf || !timingSafeEq(token, req.session.csrf)) return res.status(403).json({ error: "보안 토큰이 유효하지 않습니다. 새로고침 후 다시 시도하세요." });
    if (!originOk(req)) return res.status(403).json({ error: "허용되지 않은 출처의 요청입니다." });
  }
  next();
}

function timingSafeEq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function originOk(req: Request) {
  const origin = req.get("origin");
  if (!origin) return true; // 동일 출처 fetch는 Origin이 없을 수 있음(SameSite 쿠키로 보완)
  try {
    const o = new URL(origin);
    const allowed = new URL(env.baseUrl);
    if (o.host === allowed.host) return true;
    return o.host === req.get("host");
  } catch {
    return false;
  }
}

export function installAuthRoutes(app: Express) {
  app.use("/api/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post("/api/auth/private-link", rateLimit({
    windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "접속 시도가 많습니다. 잠시 후 전용 링크를 다시 열어 주세요." },
  }), async (req, res) => {
    if (!authConfigured() || !env.privateLinkHash) return res.status(404).json({ error: "사용할 수 없는 전용 링크입니다." });
    if (!originOk(req)) return res.status(403).json({ error: "허용되지 않은 출처의 요청입니다." });
    const credential = await operatorCredential(getDb());
    if (credential.blockedPrivateLinkHash === env.privateLinkHash) return res.status(404).json({ error: "사용할 수 없는 전용 링크입니다." });
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(401).json({ error: "전용 링크가 올바르지 않거나 만료되었습니다." });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    if (!timingSafeEq(hash, env.privateLinkHash)) return res.status(401).json({ error: "전용 링크가 올바르지 않거나 만료되었습니다." });
    await new Promise<void>((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = env.adminUsername;
    req.session.csrf = crypto.randomBytes(24).toString("hex");
    req.session.privateLinkHash = hash;
    req.session.credentialVersion = credential.version;
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    await audit(getDb(), { actor: env.adminUsername, action: "login_private_link", entity: "session" });
    res.json({ user: req.session.user, csrf: req.session.csrf });
  });
  app.get("/api/auth/me", (req, res) => {
    res.json({
      user: req.session?.user ?? null,
      demo: !!req.session?.demo,
      csrf: req.session?.user ? req.session.csrf : null,
      authConfigured: authConfigured(),
      demoAllowed: demoAllowed(),
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    if (!authConfigured()) return res.status(503).json({ error: "운영자 인증이 설정되지 않았습니다(ADMIN_USERNAME, ADMIN_PASSWORD_HASH, APP_SESSION_SECRET)." });
    if (!originOk(req)) return res.status(403).json({ error: "허용되지 않은 출처의 요청입니다." });
    const username = String(req.body?.username ?? "").slice(0, 100);
    const password = String(req.body?.password ?? "").slice(0, 200);
    const ip = req.ip || "unknown";
    const db = getDb();
    const credential = await operatorCredential(db);
    // A successful password reset also releases failures for the superseded password.
    const since = new Date(Math.max(Date.now() - 15 * 60_000, credential.changedAt?.getTime() ?? 0));
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since), sql`(${loginAttempts.username} = ${username} or ${loginAttempts.ip} = ${ip})`))) as Array<{ n: number }>;
    if (n >= 5) return res.status(429).json({ error: "로그인 실패가 많아 잠시 차단되었습니다. 15분 후 다시 시도하세요." });
    const userOk = timingSafeEq(username, env.adminUsername);
    const pwOk = await bcrypt.compare(password, credential.passwordHash);
    await db.insert(loginAttempts).values({ username, ip, success: userOk && pwOk });
    if (!(userOk && pwOk)) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "세션 생성 실패" });
      req.session.user = env.adminUsername;
      req.session.csrf = crypto.randomBytes(24).toString("hex");
      req.session.credentialVersion = credential.version;
      req.session.save(async () => {
        await audit(db, { actor: username, action: "login", entity: "session" });
        res.json({ user: req.session.user, csrf: req.session.csrf });
      });
    });
  });

  const resetInput = z.object({ token: z.string().max(100) }).strict();
  const newPassword = z.string().max(200);
  const resetLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." } });
  const changeLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "변경 시도가 많습니다. 잠시 후 다시 시도해 주세요." } });
  const resetAllowed = (req: Request, res: Response, next: NextFunction) => {
    if (!authConfigured()) return res.status(503).json({ error: "로그인 설정을 확인해 주세요." });
    if (!originOk(req)) return res.status(403).json({ error: "허용되지 않은 출처의 요청입니다." });
    next();
  };
  app.post("/api/auth/password-reset/check", resetLimit, resetAllowed, ah(async (req, res) => {
    const { token } = parse(resetInput, req.body);
    res.json(await checkPasswordReset(getDb(), token));
  }));
  app.post("/api/auth/password-reset", resetLimit, resetAllowed, ah(async (req, res) => {
    const input = parse(resetInput.extend({ password: newPassword }), req.body);
    await setOperatorPassword(getDb(), input);
    req.session?.destroy(() => {});
    res.clearCookie("spacepenguin.sid");
    res.json({ ok: true });
  }));
  app.post("/api/auth/password", changeLimit, requireOperator, ah(async (req, res) => {
    if (req.session.demo || !authConfigured()) return res.status(403).json({ error: "운영자 로그인 후 변경해 주세요." });
    const input = parse(z.object({ currentPassword: z.string().min(1).max(200), password: newPassword }).strict(), req.body);
    await setOperatorPassword(getDb(), { ...input, expectedVersion: req.session.credentialVersion ?? 0 });
    req.session.destroy(() => {});
    res.clearCookie("spacepenguin.sid");
    res.json({ ok: true });
  }));

  // 개발 환경 + DEMO_MODE=true 전용 샘플 모드(운영 환경에서는 절대 동작하지 않음)
  app.post("/api/auth/demo", (req, res) => {
    if (!demoAllowed()) return res.status(404).json({ error: "사용할 수 없습니다." });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "세션 생성 실패" });
      req.session.user = "demo";
      req.session.demo = true;
      req.session.csrf = crypto.randomBytes(24).toString("hex");
      req.session.save(() => res.json({ user: "demo", csrf: req.session.csrf, demo: true }));
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session?.destroy(() => {
      res.clearCookie("spacepenguin.sid");
      res.json({ ok: true });
    });
  });
}

export function actorOf(req: Request) {
  return req.session?.user ?? "unknown";
}
