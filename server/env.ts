/**
 * 환경변수 읽기. 비밀값은 절대 로그·응답에 출력하지 않는다.
 */
function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  get appEnv() {
    return process.env.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
  },
  get isProduction() {
    return this.appEnv === "production";
  },
  get port() {
    return Number(process.env.PORT || 5000);
  },
  get baseUrl() {
    // APP_BASE_URL이 없으면 Render가 자동으로 넣는 주소를 사용
    const render = process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "");
    return (process.env.APP_BASE_URL || render || `http://localhost:${this.port}`).replace(/\/$/, "");
  },
  /** APP_DATABASE_URL 우선, 없으면 DATABASE_URL (README 참고) */
  get databaseUrl() {
    return process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "";
  },
  get sessionSecret() {
    return process.env.APP_SESSION_SECRET || "";
  },
  get adminUsername() {
    return process.env.ADMIN_USERNAME || "";
  },
  get adminPasswordHash() {
    return process.env.ADMIN_PASSWORD_HASH || "";
  },
  get demoMode() {
    return bool(process.env.DEMO_MODE, false);
  },
  get dryRun() {
    return bool(process.env.DRY_RUN, true);
  },
  get autoCollect() {
    return bool(process.env.AUTO_COLLECT, false);
  },
  /** "지금 수집"을 웹 서버에서 바로 처리(기본 켬). false면 GitHub Actions 워커가 처리 */
  get inlineWorker() {
    return bool(process.env.INLINE_WORKER, true);
  },
  get autoGenerate() {
    return bool(process.env.AUTO_GENERATE, false);
  },
  get autoPublish() {
    return bool(process.env.AUTO_PUBLISH, false);
  },
  get naverClientId() {
    return process.env.NAVER_CLIENT_ID || "";
  },
  get naverClientSecret() {
    return process.env.NAVER_CLIENT_SECRET || "";
  },
  get openaiKey() {
    return process.env.OPENAI_API_KEY || "";
  },
  get openaiModel() {
    return process.env.OPENAI_MODEL || "gpt-6.1-sol";
  },
  get openaiImageModel() {
    return process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
  },
  get aiProvider(): "openai" | "anthropic" {
    if (process.env.AI_PROVIDER === "anthropic") return "anthropic";
    if (process.env.AI_PROVIDER === "openai") return "openai";
    return this.openaiKey || !this.anthropicKey ? "openai" : "anthropic";
  },
  get aiConfigured(): boolean {
    return this.aiProvider === "openai" ? !!this.openaiKey : !!this.anthropicKey;
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  },
  get cloudinaryConfigured() {
    return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  },
  get instagramApiVersion() {
    // "26.0", "V26.0", " v26 " 처럼 넣어도 주소에 쓰는 형식(v26.0)으로 맞춘다
    const raw = (process.env.INSTAGRAM_API_VERSION || "").trim();
    if (!raw) return "";
    const m = raw.match(/^v?(\d+)(?:\.(\d+))?$/i);
    return m ? `v${m[1]}.${m[2] ?? "0"}` : raw;
  },
  get telegramBotToken() {
    return process.env.TELEGRAM_BOT_TOKEN || "";
  },
  get telegramReviewChatId() {
    return process.env.TELEGRAM_REVIEW_CHAT_ID || "";
  },
};

/** 연결 상태 요약(값 대신 설정 여부만) */
export function integrationStatus() {
  return {
    database: !!env.databaseUrl,
    auth: !!(env.adminUsername && env.adminPasswordHash && env.sessionSecret),
    naver: !!(env.naverClientId && env.naverClientSecret),
    anthropic: !!(env.anthropicKey && env.anthropicModel),
    openai: !!env.openaiKey,
    aiProvider: env.aiProvider,
    aiConfigured: env.aiConfigured,
    cloudinary: env.cloudinaryConfigured,
    telegramBot: !!env.telegramBotToken,
    telegramReview: !!(env.telegramBotToken && env.telegramReviewChatId),
    instagramApiVersion: !!env.instagramApiVersion,
    flags: {
      demoMode: env.demoMode,
      dryRun: env.dryRun,
      autoCollect: env.autoCollect,
      autoGenerate: env.autoGenerate,
      autoPublish: env.autoPublish,
    },
  };
}

