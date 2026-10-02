/**
 * 아이맘 스튜디오 DB 스키마 (PostgreSQL + Drizzle)
 *
 * 원칙
 * - 채널 소유 데이터는 모두 channel_id를 가진다. 서버가 조회·변경 범위를 검증한다.
 * - 원문 캐시(source_documents)는 채널 공용, 해석·초안·승인·전송은 채널별로 분리한다.
 * - 샘플(fixture) 데이터는 is_sample 플래그로 실제 데이터와 격리한다.
 * - 중복 방지는 UI가 아니라 UNIQUE 제약으로 보장한다.
 */
import { sql } from "drizzle-orm";
import type { DiscoveryInfo, DiscoverySettings } from "./domain";
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

/* ───────────── 채널 ───────────── */
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  audience: text("audience").notNull().default("중학생과 부모"),
  contentType: text("content_type").notNull(), // notice | science_dialogue | current_dialogue
  accentColor: text("accent_color").notNull(),
  active: boolean("active").notNull().default(true),
  editorialGuide: text("editorial_guide").notNull().default(""),
  // 기본 카드 템플릿: "builtin:classic" | "custom:<id>" | "canva"
  cardTemplate: text("card_template").notNull().default("builtin:classic"),
  // Canva 자동 채우기용 브랜드 템플릿 ID(선택)
  canvaBrandTemplateId: text("canva_brand_template_id"),
  // 채널별 예산·한도 (호출 수, LLM 호출 수, 일일 게시 수 등)
  budget: jsonb("budget").$type<ChannelBudget>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ChannelBudget = {
  naverCallsPerRun: number;
  resultsPerRun: number;
  fetchTargetsPerRun: number;
  fetchCallsPerRun: number;
  llmCallsPerRun: number;
  dailyPublishLimit: number;
  llmInputTokenPriceUsdPerM?: number | null;
  llmOutputTokenPriceUsdPerM?: number | null;
  // 과학·시사 채널 자동 화제 발굴 설정(없으면 기본값)
  discovery?: Partial<DiscoverySettings>;
};

/* ───────────── 검색 규칙(키워드) ───────────── */
export const searchRules = pgTable(
  "search_rules",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    endpoint: text("endpoint").notNull(), // news | blog
    categoryHint: text("category_hint"),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    display: integer("display").notNull().default(10),
    excludeTerms: jsonb("exclude_terms").$type<string[]>().notNull().default([]),
    excludeScope: text("exclude_scope").notNull().default("title"), // title | title_and_snippet
    memo: text("memo").notNull().default(""),
    version: integer("version").notNull().default(1),
    lastRunAt: ts("last_run_at"),
    lastRunStatus: text("last_run_status"),
    lastRunNewCount: integer("last_run_new_count"),
    lastRunError: text("last_run_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    // 같은 채널+endpoint에서 정규화된 검색어 중복 금지(삭제된 것은 제외)
    uniqueIndex("search_rules_unique_active")
      .on(t.channelId, t.endpoint, t.normalizedQuery)
      .where(sql`deleted_at is null`),
  ],
);

/* ───────────── 공식 출처 ───────────── */
export const officialSources = pgTable(
  "official_sources",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    name: text("name").notNull(), // 학교/기관 정식명
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    schoolType: text("school_type"), // national_autonomous | gifted | science_high | org
    domain: text("domain"), // 확인한 도메인 (확인 전이면 null)
    boardUrl: text("board_url"),
    adapter: text("adapter"), // 구현된 어댑터 이름. 없으면 null = 미연결
    adapterConfig: jsonb("adapter_config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(false),
    verifiedAt: ts("verified_at"),
    verificationNote: text("verification_note").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("official_sources_channel_name").on(t.channelId, t.name)],
);

/* ───────────── 원문 캐시(채널 공용) ───────────── */
export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: serial("id").primaryKey(),
    normalizedUrl: text("normalized_url").notNull(),
    originalUrl: text("original_url").notNull(),
    kind: text("kind").notNull(), // naver_news | naver_blog | official | manual
    title: text("title").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    // 원본 날짜 문자열과 정규화값, 정밀도
    publishedRaw: text("published_raw"),
    publishedAt: ts("published_at"),
    publishedPrecision: text("published_precision"), // datetime | date | unknown
    fetchStatus: text("fetch_status").notNull().default("not_fetched"), // not_fetched | ok | failed | unsupported | blocked
    fetchError: text("fetch_error"),
    fetchedText: text("fetched_text"),
    contentHash: text("content_hash"),
    attachments: jsonb("attachments").$type<Array<{ url: string; name: string; kind: string; status: string; reason?: string }>>().notNull().default([]),
    lastFetchedAt: ts("last_fetched_at"),
    isSample: boolean("is_sample").notNull().default(false),
    firstSeenAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("source_documents_url_sample").on(t.normalizedUrl, t.isSample)],
);

/* ───────────── 수집 실행 기록 ───────────── */
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").references(() => channels.id),
    kind: text("kind").notNull(), // collect | generate | render | publish | trial_search
    // ok | ok_zero | partial | failed | aborted | running
    status: text("status").notNull().default("running"),
    trigger: text("trigger").notNull().default("manual"), // manual | worker | cli | schedule
    // 실행 시작 시점 설정 스냅샷(검색 규칙·예산)
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    plannedCalls: jsonb("planned_calls").$type<Record<string, number>>().notNull().default({}),
    actualCalls: jsonb("actual_calls").$type<Record<string, number>>().notNull().default({}),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    unconnectedSources: jsonb("unconnected_sources").$type<string[]>().notNull().default([]),
    errors: jsonb("errors").$type<Array<{ scope: string; message: string }>>().notNull().default([]),
    llmUsage: jsonb("llm_usage").$type<{ inputTokens: number; outputTokens: number; calls: number }>().notNull().default({ inputTokens: 0, outputTokens: 0, calls: 0 }),
    startedAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("runs_channel_started").on(t.channelId, t.startedAt)],
);

/* ───────────── 콘텐츠(수집함 항목 + 초안) ───────────── */
export const contentItems = pgTable(
  "content_items",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    kind: text("kind").notNull(), // notice | science_dialogue | current_dialogue
    origin: text("origin").notNull().default("collected"), // collected | discovered | manual | evergreen
    primarySourceId: integer("primary_source_id").references(() => sourceDocuments.id),
    ruleId: integer("rule_id").references(() => searchRules.id),
    runId: integer("run_id").references(() => runs.id),
    title: text("title").notNull(),
    category: text("category"),
    schoolType: text("school_type"),
    // 상태 축 분리
    relevance: text("relevance").notNull().default("uncertain"), // relevant | irrelevant | uncertain
    evidenceStatus: text("evidence_status").notNull().default("needs_review"), // official_confirmed | secondary_only | needs_review | conflict | fetch_failed
    scheduleStatus: text("schedule_status").notNull().default("unknown"), // upcoming | open | closed | unknown | not_applicable
    reviewStatus: text("review_status").notNull().default("pending"), // pending | reviewed | held | rejected | review_required
    publishStatus: text("publish_status").notNull().default("waiting"), // waiting | scheduled | processing | succeeded | failed | unknown | cancelled
    excluded: boolean("excluded").notNull().default(false),
    excludedReason: text("excluded_reason"),
    // 가장 최근 LLM 추출값(참고용)과 운영자 편집값(우선)은 분리해 보관
    extracted: jsonb("extracted").$type<Record<string, unknown> | null>(),
    edited: jsonb("edited").$type<Record<string, unknown> | null>(),
    currentRevisionId: integer("current_revision_id"),
    nextActionAt: ts("next_action_at"),
    lastUsedAt: ts("last_used_at"),
    topicKey: text("topic_key"),
    // Canva 자동 채우기로 만든 디자인(편집 링크는 Canva 기준 30일 유효)
    // 자동 화제 발굴로 들어온 항목의 화제도·선정 이유
    discovery: jsonb("discovery").$type<DiscoveryInfo | null>(),
    canvaDesign: jsonb("canva_design").$type<{ designId: string; editUrl: string | null; viewUrl: string | null; revisionId: number; createdAt: string } | null>(),
    isSample: boolean("is_sample").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_items_channel_source").on(t.channelId, t.primarySourceId),
    index("content_items_channel_status").on(t.channelId, t.reviewStatus, t.createdAt),
  ],
);

/* 콘텐츠 ↔ 근거 원문 연결(동일 공고의 복수 기사) */
export const contentSources = pgTable(
  "content_sources",
  {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
    sourceDocumentId: integer("source_document_id").notNull().references(() => sourceDocuments.id),
    role: text("role").notNull().default("primary"), // primary | supporting | official
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_sources_unique").on(t.contentItemId, t.sourceDocumentId)],
);

/* 콘텐츠 버전 */
export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
    revisionNo: integer("revision_no").notNull(),
    author: text("author").notNull(), // llm | operator | system
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number } | null>(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_revisions_unique").on(t.contentItemId, t.revisionNo)],
);

/* ───────────── 카드 이미지 ───────────── */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
    revisionId: integer("revision_id").notNull().references(() => contentRevisions.id),
    kind: text("kind").notNull().default("card"),
    source: text("source").notNull().default("builtin"), // builtin | custom | canva
    templateKey: text("template_key"),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull().default("image/jpeg"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: bytea("bytes").notNull(),
    cloudinaryPublicId: text("cloudinary_public_id"),
    cloudinaryUrl: text("cloudinary_url"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("media_assets_revision_hash").on(t.revisionId, t.sha256)],
);

/* ───────────── 내 카드 템플릿(배경 이미지) ───────────── */
export const cardTemplates = pgTable("card_templates", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").references(() => channels.id), // null = 모든 채널
  name: text("name").notNull(),
  layout: text("layout").notNull().default("classic"), // 글자 배치 기준 레이아웃
  textTone: text("text_tone").notNull().default("dark"), // dark | light
  overlay: integer("overlay").notNull().default(0), // 0~80 (%) 가독성용 반투명 막
  background: bytea("background").notNull(), // 1080×1350 JPEG로 정규화해 저장
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  deletedAt: ts("deleted_at"),
});

/* ───────────── 최종 발행 승인 ───────────── */
export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
    revisionId: integer("revision_id").notNull().references(() => contentRevisions.id),
    mediaAssetId: integer("media_asset_id").notNull().references(() => mediaAssets.id),
    cardSha256: text("card_sha256").notNull(),
    captions: jsonb("captions").$type<{ instagram: string; telegram: string }>().notNull(),
    scheduledAt: ts("scheduled_at").notNull(),
    status: text("status").notNull().default("active"), // active | invalidated | cancelled | completed
    invalidatedReason: text("invalidated_reason"),
    approvedBy: text("approved_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approvals_content").on(t.contentItemId)],
);

/* ───────────── 게시 목적지 ───────────── */
export const destinations = pgTable(
  "destinations",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    platform: text("platform").notNull(), // instagram | telegram_channel
    label: text("label").notNull(),
    // 비밀값 자체가 아니라 환경변수 "이름"만 저장. 허용 패턴 검증 후 사용
    secretRefs: jsonb("secret_refs").$type<Record<string, string>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("destinations_channel_platform_label").on(t.channelId, t.platform, t.label)],
);

/* ───────────── 목적지별 전송 ───────────── */
export const deliveries = pgTable(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id),
    approvalId: integer("approval_id").notNull().references(() => approvals.id),
    destinationId: integer("destination_id").notNull().references(() => destinations.id),
    // waiting | scheduled | processing | succeeded | failed | unknown | cancelled | dry_run
    status: text("status").notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    externalContainerId: text("external_container_id"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    lastError: text("last_error"),
    errorKind: text("error_kind"), // auth | rate_limit | terminal | transient | timeout | unknown
    requestStartedAt: ts("request_started_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("deliveries_unique").on(t.approvalId, t.destinationId)],
);

/* ───────────── 작업 큐(워커가 한 번 실행하고 종료) ───────────── */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: integer("channel_id").references(() => channels.id),
    type: text("type").notNull(), // collect | generate | render | publish | fetch_source
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | cancelled
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    heartbeatAt: ts("heartbeat_at"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    lastError: text("last_error"),
    requestedBy: text("requested_by"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_claim").on(t.status, t.runAfter),
    uniqueIndex("jobs_dedupe_active")
      .on(t.dedupeKey)
      .where(sql`dedupe_key is not null and status in ('queued','running')`),
  ],
);

/* ───────────── 워커 실행 기록 ───────────── */
export const workerRuns = pgTable("worker_runs", {
  id: serial("id").primaryKey(),
  workerId: text("worker_id").notNull(),
  command: text("command").notNull(),
  status: text("status").notNull().default("running"), // running | ok | partial | failed
  processed: integer("processed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  note: text("note").notNull().default(""),
  startedAt: createdAt(),
  finishedAt: ts("finished_at"),
});

/* ───────────── 감사 로그 ───────────── */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    channelId: integer("channel_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity").on(t.entity, t.entityId)],
);

/* ───────────── 전역 설정(자동화 스위치 등) ───────────── */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/* ───────────── 화면에서 입력한 연결 키(암호화 저장) ───────────── */
export const storedSecrets = pgTable("stored_secrets", {
  key: text("key").primaryKey(), // 환경변수와 같은 이름(예: NAVER_CLIENT_ID)
  ciphertext: text("ciphertext").notNull(), // AES-256-GCM, base64
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  keyFingerprint: text("key_fingerprint").notNull(), // 어떤 암호키로 잠갔는지(값 아님)
  valueLength: integer("value_length").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: updatedAt(),
  lastTestAt: ts("last_test_at"),
  lastTestOk: boolean("last_test_ok"),
  lastTestMessage: text("last_test_message"),
});

/* ───────────── 로그인 시도 제한 ───────────── */
export const loginAttempts = pgTable("login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username: text("username").notNull(),
  ip: text("ip").notNull(),
  success: boolean("success").notNull(),
  createdAt: createdAt(),
});

export type Channel = typeof channels.$inferSelect;
export type SearchRule = typeof searchRules.$inferSelect;
export type OfficialSource = typeof officialSources.$inferSelect;
export type SourceDocument = typeof sourceDocuments.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type ContentRevision = typeof contentRevisions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Destination = typeof destinations.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type CardTemplate = typeof cardTemplates.$inferSelect;
