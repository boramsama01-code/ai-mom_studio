import type { CreativeProfile } from "./creativeProfile";
/**
 * 우주펭귄상회 스튜디오 DB 스키마 (PostgreSQL + Drizzle)
 *
 * 원칙
 * - 채널 소유 데이터는 모두 channel_id를 가진다. 서버가 조회·변경 범위를 검증한다.
 * - 원문 캐시(source_documents)는 채널 공용, 해석·초안·승인·전송은 채널별로 분리한다.
 * - 샘플(fixture) 데이터는 is_sample 플래그로 실제 데이터와 격리한다.
 * - 중복 방지는 UI가 아니라 UNIQUE 제약으로 보장한다.
 */
import { sql } from "drizzle-orm";
import type { DiscoveryInfo, DiscoverySettings } from "./domain";
import type { StudioContent } from "./studio";
import type { PublicationDraft, StudioPublicationDraft } from "./publicationDraft";
import type { SavedChannelAiSettings } from "./channelAi";
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
  contentType: text("content_type").notNull(), // notice | science_dialogue | current_dialogue | manual
  // null keeps the historical built-in defaults; [] intentionally disables categories.
  categories: jsonb("categories").$type<string[] | null>(),
  aiSettings: jsonb("ai_settings").$type<SavedChannelAiSettings | null>(),
  creativeProfile: jsonb("creative_profile").$type<CreativeProfile | null>(),
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
    endpoint: text("endpoint").notNull(), // news | blog | webkr
    categoryHint: text("category_hint"),
    subcategory: text("subcategory"),
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
    lastCheckedAt: ts("last_checked_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    lastNewCount: integer("last_new_count").notNull().default(0),
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
    kind: text("kind").notNull(), // naver_news | naver_blog | naver_web | opportunity_listing | official | manual
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
    llmUsage: jsonb("llm_usage").$type<{ inputTokens: number; outputTokens: number; calls: number; usageStatus?: "known" | "usage_unknown" }>().notNull().default({ inputTokens: 0, outputTokens: 0, calls: 0 }),
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
    subcategory: text("subcategory"),
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
    // Saved publication copy is independent from an immutable approval snapshot.
    publicationDraft: jsonb("publication_draft").$type<PublicationDraft | null>(),
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
    carousel: jsonb("carousel").$type<import("./carousel").CardCarousel>(),
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
    captions: jsonb("captions").$type<{ instagram: string; telegram: string; altTexts?: string[] }>().notNull(),
    requestId: text("request_id"),
    requestHash: text("request_hash"),
    scheduledAt: ts("scheduled_at").notNull(),
    status: text("status").notNull().default("active"), // active | invalidated | cancelled | completed
    invalidatedReason: text("invalidated_reason"),
    approvedBy: text("approved_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approvals_content").on(t.contentItemId), uniqueIndex("approvals_request_id").on(t.requestId)],
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
/** Non-secret identity that the operator approved. Token rotation is not an identity change. */
export type PublicationDestinationSnapshot = {
  version: 1;
  destinationId: number;
  destinationVersion: number;
  platform: string;
  label: string;
  accountId: string;
  username: string | null;
  authMode?: "instagram" | "facebook";
  configuredAddress?: string;
  verifiedAt: string;
};
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
    destinationSnapshot: jsonb("destination_snapshot").$type<PublicationDestinationSnapshot | null>(),
    // Null is deliberately retained for legacy rows: their dispatch phase is unknown.
    phase: text("phase"), // queued | preparing | container_wait | dispatching | finished | unknown
    lastAttemptId: text("last_attempt_id"),
    leaseToken: text("lease_token"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    dispatchStartedAt: ts("dispatch_started_at"),
    outcomeSource: text("outcome_source"), // provider_verified | operator_confirmed | operator_not_posted
    resolutionNote: text("resolution_note"),
    needsReconciliation: boolean("needs_reconciliation").notNull().default(false),
    externalContainerId: text("external_container_id"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    lastError: text("last_error"),
    errorKind: text("error_kind"), // auth | rate_limit | terminal | transient | timeout | unknown
    requestStartedAt: ts("request_started_at"),
    completedAt: ts("completed_at"),
    // List organization is independent from immutable publication evidence/status.
    listState: text("list_state").$type<"active" | "archived" | "trashed">().notNull().default("active"),
    listVersion: integer("list_version").notNull().default(1),
    listUpdatedAt: ts("list_updated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("deliveries_unique").on(t.approvalId, t.destinationId), index("deliveries_recovery").on(t.status, t.leaseExpiresAt), index("deliveries_list").on(t.channelId, t.listState)],
);

/** Append-only attempt headers; mutable progress lives on deliveries, never here. */
export const deliveryAttempts = pgTable("delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryId: integer("delivery_id").notNull().references(() => deliveries.id),
  attemptNo: integer("attempt_no").notNull(),
  actor: text("actor").notNull(),
  createdAt: createdAt(),
}, t => [uniqueIndex("delivery_attempts_number").on(t.deliveryId, t.attemptNo)]);

/** Append-only evidence, including results returned by a worker that lost its lease. */
export const deliveryAttemptEvents = pgTable("delivery_attempt_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  deliveryId: integer("delivery_id").notNull().references(() => deliveries.id),
  attemptId: text("attempt_id").references(() => deliveryAttempts.id),
  event: text("event").notNull(),
  phase: text("phase"),
  status: text("status"),
  source: text("source").notNull(),
  actor: text("actor").notNull(),
  externalContainerId: text("external_container_id"),
  externalId: text("external_id"),
  externalUrl: text("external_url"),
  errorKind: text("error_kind"),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, t => [index("delivery_attempt_events_delivery").on(t.deliveryId, t.id), index("delivery_attempt_events_attempt").on(t.attemptId, t.id)]);

/** Dedicated publisher liveness: collection/AI workers cannot make this healthy. */
export const publisherHeartbeats = pgTable("publisher_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  heartbeatAt: ts("heartbeat_at").notNull(),
  lastSweepAt: ts("last_sweep_at"),
  lastError: text("last_error"),
  startedAt: ts("started_at").notNull().defaultNow(),
});

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
export const operatorCredentials = pgTable("operator_credentials", {
  username: text("username").primaryKey(),
  passwordHash: text("password_hash"), // null uses the existing Render bootstrap hash
  version: integer("version").notNull().default(0),
  blockedPrivateLinkHash: text("blocked_private_link_hash"),
  updatedAt: updatedAt(),
});

export const operatorPasswordResets = pgTable("operator_password_resets", {
  tokenHash: text("token_hash").primaryKey(), // never store the original link/token
  username: text("username").notNull(),
  credentialVersion: integer("credential_version").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

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

/* 통합 제작 보드 — 기존 입시 수집/승인/전송 테이블과 독립, 삭제 없는 추가 마이그레이션 */
export const studioCards = pgTable("studio_cards", {
  id: serial("id").primaryKey(),
  content: jsonb("content").$type<StudioContent>().notNull(),
  version: integer("version").notNull().default(1),
  sourceItemId: integer("source_item_id").references(() => contentItems.id).unique(),
  externalId: text("external_id").unique(),
  importedMeta: jsonb("imported_meta").$type<Record<string, unknown>>(),
  publicationDraft: jsonb("publication_draft").$type<StudioPublicationDraft | null>(),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const studioRevisions = pgTable("studio_revisions", {
  id: serial("id").primaryKey(), cardId: integer("card_id").notNull().references(() => studioCards.id),
  version: integer("version").notNull(), snapshot: jsonb("snapshot").$type<StudioContent>().notNull(),
  instruction: text("instruction").notNull().default(""), provider: text("provider"), model: text("model"),
  applied: boolean("applied").notNull().default(true), createdAt: createdAt(),
}, t => [index("studio_revisions_card").on(t.cardId, t.id)]);
export const studioImages = pgTable("studio_images", {
  id: serial("id").primaryKey(), cardId: integer("card_id").notNull().references(() => studioCards.id),
  panelIndex: integer("panel_index").notNull(), bytes: bytea("bytes").notNull(),
  mimeType: text("mime_type").notNull().default("image/png"), model: text("model").notNull(), createdAt: createdAt(),
});
export const studioRequests = pgTable("studio_requests", {
  requestId: text("request_id").primaryKey(), cardId: integer("card_id").notNull().references(() => studioCards.id),
  inputHash: text("input_hash").notNull(), jobId: integer("job_id").references(() => jobs.id), createdAt: createdAt(),
});



export const studioMedia = pgTable("studio_media", {
  id: serial("id").primaryKey(), cardId: integer("card_id").notNull().references(() => studioCards.id),
  name: text("name").notNull(), kind: text("kind").notNull(), mimeType: text("mime_type").notNull(),
  bytes: bytea("bytes").notNull(), preview: bytea("preview"), frameTime: integer("frame_time_ms"),
  createdAt: createdAt(),
}, t => [index("studio_media_card").on(t.cardId)]);

/* Notion ↔ Studio bindings; source originals and imported photos remain separate. */
export const notionSyncLinks = pgTable('notion_sync_links', {
  id: serial('id').primaryKey(),
  notionPageId: text('notion_page_id').notNull().unique(),
  notionUrl: text('notion_url').notNull(),
  channelId: integer('channel_id').notNull().references(()=>channels.id),
  contentItemId: integer('content_item_id').notNull().references(()=>contentItems.id).unique(),
  sourceHash: text('source_hash').notNull(),
  baseCopyHash: text('base_copy_hash').notNull(),
  sourceEditedAt: text('source_edited_at').notNull(),
  sourceSnapshot: jsonb('source_snapshot').$type<Record<string,unknown>>().notNull(),
  photoOrder: jsonb('photo_order').$type<number[]>().notNull().default([]),
  coverStyle: text('cover_style').notNull().default('A'),
  autoSync: boolean('auto_sync').notNull().default(true), lastCheckedAt:ts('last_checked_at'),
  canva: jsonb('canva').$type<import('./notionStudio').NotionCanvaState>().notNull().default({phase:'idle'}),
  operationToken: text('operation_token'), operationUntil: ts('operation_until'),
  lastError: text('last_error'), version: integer('version').notNull().default(1),
  lastSyncedAt: ts('last_synced_at').notNull().defaultNow(), createdAt:createdAt(),updatedAt:updatedAt(),
}, t=>[index('notion_sync_links_channel').on(t.channelId)]);
export const notionSyncPhotos=pgTable('notion_sync_photos',{
 id:serial('id').primaryKey(),linkId:integer('link_id').notNull().references(()=>notionSyncLinks.id),
 sourceKey:text('source_key').notNull(),name:text('name').notNull(),mimeType:text('mime_type').notNull(),
 bytes:bytea('bytes').notNull(),sha256:text('sha256').notNull(),width:integer('width').notNull(),height:integer('height').notNull(),createdAt:createdAt(),
},t=>[uniqueIndex('notion_sync_photos_source').on(t.linkId,t.sourceKey),index('notion_sync_photos_link').on(t.linkId)]);


/* ───────────── Canva 8-page masters and durable render jobs ───────────── */
export const canvaMasters = pgTable("canva_masters", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull().references(() => channels.id),
  formatId: text("format_id").notNull().default("family_dialogue_8"),
  conceptMode: text("concept_mode").notNull(),
  hasExternalActivity: boolean("has_external_activity").notNull(),
  templateVersion: text("template_version").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceUpdatedAt: text("source_updated_at").notNull(),
  principal: text("principal").notNull(),
  dataset: jsonb("dataset").$type<Record<string, { type: string }>>().notNull(),
  datasetHash: text("dataset_hash").notNull(),
  pageIds: jsonb("page_ids").$type<string[]>().notNull(),
  editUrl: text("edit_url"),
  status: text("status").notNull().default("ready"),
  validatedAt: ts("validated_at").notNull(),
  createdAt: createdAt(),
}, t => [uniqueIndex("canva_master_variant_version").on(t.channelId, t.formatId, t.conceptMode, t.hasExternalActivity, t.templateVersion)]);

export const canvaRenderJobs = pgTable("canva_render_jobs", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull().references(() => channels.id),
  contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
  sourceRevisionId: integer("source_revision_id").notNull().references(() => contentRevisions.id),
  sourceVersion: integer("source_version").notNull(),
  masterId: integer("master_id").references(() => canvaMasters.id),
  requestId: text("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  purpose: text("purpose").notNull().default("create"),
  principal: text("principal").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"),
  phase: text("phase").notNull().default("validate"),
  autofillJobId: text("autofill_job_id"),
  exportJobId: text("export_job_id"),
  designId: text("design_id"),
  designUpdatedAt: text("design_updated_at"),
  editUrl: text("edit_url"),
  outputAssetId: integer("output_asset_id").references(() => mediaAssets.id),
  outputRevisionId: integer("output_revision_id").references(() => contentRevisions.id),
  result: jsonb("result").$type<Record<string, unknown>>(),
  leaseOwner: text("lease_owner"),
  leaseUntil: ts("lease_until"),
  nextRunAt: ts("next_run_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex("canva_render_request").on(t.channelId, t.requestId), index("canva_render_queue").on(t.status, t.nextRunAt)]);

export const canvaAssetUploads = pgTable("canva_asset_uploads", {
  id: serial("id").primaryKey(),
  principal: text("principal").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull().default("queued"),
  uploadJobId: text("upload_job_id"),
  assetId: text("asset_id"),
  errorCode: text("error_code"),
  updatedAt: updatedAt(),
}, t => [uniqueIndex("canva_asset_principal_hash").on(t.principal, t.sha256)]);

/* Canva folder catalog. Content revisions and published assets remain immutable. */
export type CanvaLibraryStoredPage = { id: string | null; pageNumber: number; width: number | null; height: number | null };
export const canvaLibraryDesigns = pgTable('canva_library_designs', {
  id: serial('id').primaryKey(), principal: text('principal').notNull(),
  folderId: text('folder_id').notNull(), sourceType: text('source_type').notNull(), sourceId: text('source_id').notNull(),
  title: text('title').notNull(), sourceUpdatedAt: text('source_updated_at'), metadataVersion: text('metadata_version'),
  editUrl: text('edit_url'), pageCount: integer('page_count'),
  pages: jsonb('pages').$type<CanvaLibraryStoredPage[]>().notNull().default([]),
  dataset: jsonb('dataset').$type<Record<string, { type: string }>>().notNull().default({}),
  datasetHash: text('dataset_hash'), status: text('status').notNull().default('unavailable'), reason: text('reason'),
  seenAt: ts('seen_at').notNull(), syncedAt: ts('synced_at'),
  previewVersion: text('preview_version'), previewStatus: text('preview_status').notNull().default('pending'),
  previewUpdatedAt: ts('preview_updated_at'), previewErrorCode: text('preview_error_code'), previewErrorMessage: text('preview_error_message'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('canva_library_design_source').on(t.principal, t.sourceType, t.sourceId), index('canva_library_folder').on(t.principal, t.folderId)]);

export const canvaLibraryPreviewJobs = pgTable('canva_library_preview_jobs', {
  id: serial('id').primaryKey(), designId: integer('design_id').notNull().references(() => canvaLibraryDesigns.id),
  sourceVersion: text('source_version').notNull(), pages: jsonb('pages').$type<CanvaLibraryStoredPage[]>().notNull(),
  status: text('status').notNull().default('queued'), phase: text('phase').notNull().default('prepare'),
  exportJobId: text('export_job_id'), previousExportJobIds: jsonb('previous_export_job_ids').$type<string[]>().notNull().default([]), leaseOwner: text('lease_owner'), leaseUntil: ts('lease_until'),
  nextRunAt: ts('next_run_at').notNull().defaultNow(), errorCode: text('error_code'), errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('canva_library_preview_version').on(t.designId, t.sourceVersion), index('canva_library_preview_queue').on(t.status, t.nextRunAt)]);

export const canvaLibraryPreviews = pgTable('canva_library_previews', {
  id: serial('id').primaryKey(), designId: integer('design_id').notNull().references(() => canvaLibraryDesigns.id),
  page: integer('page').notNull(), sourceVersion: text('source_version').notNull(), mime: text('mime').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(), sha256: text('sha256').notNull(),
  bytes: bytea('bytes').notNull(), updatedAt: updatedAt(),
}, t => [uniqueIndex('canva_library_preview_page').on(t.designId, t.page)]);

/** A lost create response must resolve to the same resource, including after restart. */
export const creationReceipts = pgTable("creation_receipts", {
  key: text("key").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  resourceId: integer("resource_id").notNull().references(() => studioCards.id),
  createdAt: createdAt(),
});

/** Durable receipts for explicit manual source-backed first eight-page saves. */
export const familyManualRequests=pgTable('family_manual_requests',{
  requestId:text('request_id').primaryKey(),channelId:integer('channel_id').notNull().references(()=>channels.id),
  requestHash:text('request_hash').notNull(),contentItemId:integer('content_item_id').notNull().references(()=>contentItems.id),
  result:jsonb('result').$type<import('./familyManual').FamilyManualReceipt>().notNull(),createdAt:createdAt(),
});
