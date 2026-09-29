import path from "node:path";
import fs from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { env } from "./env";
import { dbHealth } from "./db";
import { authConfigured, demoAllowed, installAuthRoutes, installSession, requireOperator } from "./auth";
import { channelRoutes } from "./routes/channels";
import { ruleRoutes } from "./routes/rules";
import { itemRoutes } from "./routes/items";
import { opsRoutes } from "./routes/ops";
import { secretRoutes } from "./routes/secrets";
import { templateRoutes } from "./routes/templates";
import { HttpError } from "./routes/util";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render 등 프록시 뒤에서 secure 쿠키·IP 인식
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "512kb" }));

  // 공개: 헬스체크(비밀값 없음)
  app.get("/api/health", async (_req, res) => {
    const db = await dbHealth();
    res.status(db.ok ? 200 : 503).json({ ok: db.ok, db: db.ok ? "connected" : db.error, auth: authConfigured() ? "configured" : "not_configured" });
  });

  const sessionOk = env.databaseUrl ? installSession(app) : false;
  if (!sessionOk) {
    app.use("/api", (_req, res) =>
      res.status(503).json({ error: env.databaseUrl ? "운영자 인증이 설정되지 않아 운영 API를 차단했습니다." : "DB 미연결: APP_DATABASE_URL을 설정하세요.", code: env.databaseUrl ? "auth_not_configured" : "db_not_configured" }),
    );
  } else {
    installAuthRoutes(app);
    // 인증 미설정 + 샘플 모드 불가 → 운영 API 차단
    app.use("/api", (req, res, next) => {
      if (!authConfigured() && !demoAllowed()) return res.status(503).json({ error: "운영자 인증이 설정되지 않아 운영 API를 차단했습니다.", code: "auth_not_configured" });
      next();
    });
    app.use("/api", requireOperator, channelRoutes, ruleRoutes, itemRoutes, opsRoutes, secretRoutes, templateRoutes);
  }
  app.use("/api", (_req, res) => res.status(404).json({ error: "없는 API입니다." }));

  // 프런트엔드(빌드 결과)
  const publicDir = [path.resolve(process.cwd(), "dist/public"), path.resolve(import.meta.dirname ?? ".", "../public")].find((p) => fs.existsSync(path.join(p, "index.html")));
  if (publicDir) {
    app.use(express.static(publicDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if ((err as { type?: string }).type === "entity.parse.failed") return res.status(400).json({ error: "요청 형식(JSON)이 올바르지 않습니다." });
    console.error("[서버 오류]", (err as Error)?.stack || err);
    res.status(500).json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요." });
  });
  return app;
}
