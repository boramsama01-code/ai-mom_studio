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
import { studioRoutes } from "./routes/studio";
import { collectionRoutes } from "./routes/collection";
import { HttpError } from "./routes/util";
import { isPrivateStudioAssetPath } from "./studioAssetPath";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render 등 프록시 뒤에서 secure 쿠키·IP 인식
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          mediaSrc: ["'self'", "blob:"],
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

  // 공개: 헬스체크(비밀값 없음). Resolver version verifies the actual running backend.
  app.get("/api/health", async (_req, res) => {
    const db = await dbHealth();
    res.status(db.ok ? 200 : 503).json({ ok: db.ok, db: db.ok ? "connected" : db.error, auth: authConfigured() ? "configured" : "not_configured", sourceResolver: "publisher-direct-v4", studioDrafts: "complete-fields-v2", cardRenderer: "adaptive-body-v1", studioPublishing: "finished-deck-v1", studioPoses: "family-v2-100" });
  });

  const sessionOk = env.databaseUrl ? installSession(app) : false;
  if (!sessionOk) {
    app.use("/api", (_req, res) =>
      res.status(503).json({ error: env.databaseUrl ? "운영자 인증이 설정되지 않아 운영 API를 차단했습니다." : "DB 미연결: APP_DATABASE_URL을 설정하세요.", code: env.databaseUrl ? "auth_not_configured" : "db_not_configured" }),
    );
  } else {
    installAuthRoutes(app);
    app.use("/api", (req, res, next) => {
      if (!authConfigured() && !demoAllowed()) return res.status(503).json({ error: "운영자 인증이 설정되지 않아 운영 API를 차단했습니다.", code: "auth_not_configured" });
      next();
    });
    app.use("/api", requireOperator, channelRoutes, ruleRoutes, itemRoutes, opsRoutes, secretRoutes, templateRoutes, studioRoutes, collectionRoutes);
  }
  app.use("/api", (_req, res) => res.status(404).json({ error: "없는 API입니다." }));

  // New family artwork is private, including direct file downloads and Vite's dev middleware.
  app.use((req, res, next) => {
    if (!isPrivateStudioAssetPath(req.path)) return next();
    res.set("Cache-Control", "private, no-store");
    return requireOperator(req, res, next);
  });

  // Keep API callbacks and media links working on the previous address. Only
  // browser navigation moves, with paths/query strings preserved and no host-derived target.
  app.use((req, res, next) => {
    const canonical = env.canonicalRedirectUrl;
    if (canonical && (req.method === "GET" || req.method === "HEAD") && req.get("host") !== new URL(canonical).host) {
      return res.redirect(308, `${canonical}${req.originalUrl}`);
    }
    next();
  });

  const publicDir = [path.resolve(process.cwd(), "dist/public"), path.resolve(import.meta.dirname ?? ".", "../public")].find((p) => fs.existsSync(path.join(p, "index.html")));
  if (publicDir) {
    app.use(express.static(publicDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if ((err as { type?: string }).type === "entity.too.large") return res.status(413).json({ error: "요청 용량이 너무 큽니다. ZIP은 100MB, 사진은 12MB, 후기 영상은 25MB 이하로 선택해 주세요." });
    if ((err as { type?: string }).type === "entity.parse.failed") return res.status(400).json({ error: "요청 형식(JSON)이 올바르지 않습니다." });
    console.error("[서버 오류]", (err as Error)?.stack || err);
    res.status(500).json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요." });
  });
  return app;
}



