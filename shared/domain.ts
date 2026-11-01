import { CHANNEL_BRANDS } from "./branding";
/**
 * 도메인 상수·라벨·정규화 함수 (클라이언트/서버 공용)
 */

export const CHANNEL_SEEDS = [
  {
    slug: "opportunities",
    name: CHANNEL_BRANDS.highway.name,
    description: "특목고·자사고·영재학교 입시와 STEM 캠프·대회·영재교육원 공고를 모아 확인합니다.",
    contentType: "notice",
    accentColor: "#0B766E",
  },
  {
    slug: "science-dialogue",
    name: `${CHANNEL_BRANDS.news.name} · 과학`,
    description: "중학생과 부모가 5~10분 과학 질문을 근거로 이야기합니다.",
    contentType: "science_dialogue",
    accentColor: "#6550A6",
  },
  {
    slug: "current-dialogue",
    name: CHANNEL_BRANDS.news.name,
    description: "뉴스·과학·AI·사회 등 다양한 이슈를 아이와 함께 이야기합니다.",
    contentType: "current_dialogue",
    accentColor: "#285FAD",
  },
] as const;

export type ChannelSlug = (typeof CHANNEL_SEEDS)[number]["slug"];
export type ContentKind = "notice" | "science_dialogue" | "current_dialogue";

export const DEFAULT_BUDGET = {
  naverCallsPerRun: 12,
  resultsPerRun: 60,
  fetchTargetsPerRun: 20,
  fetchCallsPerRun: 40,
  llmCallsPerRun: 20,
  dailyPublishLimit: 3,
  llmInputTokenPriceUsdPerM: null,
  llmOutputTokenPriceUsdPerM: null,
};

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  notice: "공고",
  science_dialogue: "과학 대화",
  current_dialogue: "시사 대화",
};

export const NOTICE_CATEGORIES = [
  "전국단위 자사고 입시",
  "영재학교·과학고 입시",
  "STEM 캠프",
  "STEM 대회",
  "영재교육원",
] as const;

export const SCHOOL_TYPE_LABEL: Record<string, string> = {
  national_autonomous: "전국단위 자사고",
  gifted: "영재학교",
  science_high: "과학고",
  org: "기관·대학",
};

export const RELEVANCE_LABEL: Record<string, string> = {
  relevant: "관련 있음",
  irrelevant: "관련 없음",
  uncertain: "판단 필요",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  official_confirmed: "공식 원문 확인",
  secondary_only: "보도·2차 자료만",
  needs_review: "근거 확인 필요",
  conflict: "근거 충돌",
  fetch_failed: "원문 확보 실패",
};

export const SCHEDULE_LABEL: Record<string, string> = {
  upcoming: "접수 예정",
  open: "접수 중",
  closed: "마감",
  unknown: "일정 미확인",
  not_applicable: "해당 없음",
};

export const REVIEW_LABEL: Record<string, string> = {
  pending: "검토 대기",
  reviewed: "검토 완료",
  held: "보류",
  rejected: "제외",
  review_required: "재검토 필요",
};

export const PUBLISH_LABEL: Record<string, string> = {
  waiting: "발행 전",
  scheduled: "예약됨",
  processing: "처리 중",
  succeeded: "게시 성공",
  failed: "게시 실패",
  unknown: "결과 불명",
  cancelled: "취소됨",
  dry_run: "모의 실행(게시 안 함)",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "실행 중",
  ok: "정상",
  ok_zero: "정상 · 신규 0건",
  partial: "부분 실패",
  failed: "실패",
  aborted: "중단",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "대기 중",
  running: "처리 중",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소",
};

/* ───────────── 검색어 정규화 ───────────── */

/** Unicode NFC + 공백 정리 + 소문자(영문) — 중복 판별 키 */
export function normalizeQuery(q: string): string {
  return q.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 표시용: NFC + 공백 정리만(대소문자 유지). 쉼표로 분할하지 않는다. */
export function cleanQuery(q: string): string {
  return q.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** 줄 단위 대량 추가 파싱. 빈 줄과 같은 입력 안의 중복은 제거. */
export function parseBulkQueries(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const q = cleanQuery(line);
    if (!q) continue;
    const key = normalizeQuery(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/* ───────────── 초기 조사 목록(공식 확인 전) ───────────── */

export const SCHOOL_SEEDS: Array<{ name: string; aliases: string[]; schoolType: string }> = [
  // 전국단위 자사고
  { name: "하나고등학교", aliases: ["하나고"], schoolType: "national_autonomous" },
  { name: "용인한국외국어대학교부설고등학교", aliases: ["외대부고", "용인외대부고"], schoolType: "national_autonomous" },
  { name: "상산고등학교", aliases: ["상산고"], schoolType: "national_autonomous" },
  { name: "민족사관고등학교", aliases: ["민사고"], schoolType: "national_autonomous" },
  { name: "현대청운고등학교", aliases: ["현대청운고"], schoolType: "national_autonomous" },
  { name: "포항제철고등학교", aliases: ["포항제철고"], schoolType: "national_autonomous" },
  { name: "광양제철고등학교", aliases: ["광양제철고"], schoolType: "national_autonomous" },
  { name: "북일고등학교", aliases: ["북일고"], schoolType: "national_autonomous" },
  { name: "김천고등학교", aliases: ["김천고"], schoolType: "national_autonomous" },
  { name: "인천하늘고등학교", aliases: ["인천하늘고"], schoolType: "national_autonomous" },
  // 영재학교
  { name: "서울과학고등학교", aliases: ["서울과고"], schoolType: "gifted" },
  { name: "경기과학고등학교", aliases: ["경기과고"], schoolType: "gifted" },
  { name: "한국과학영재학교", aliases: ["한과영"], schoolType: "gifted" },
  { name: "대전과학고등학교", aliases: ["대전과고"], schoolType: "gifted" },
  { name: "대구과학고등학교", aliases: ["대구과고"], schoolType: "gifted" },
  { name: "광주과학고등학교", aliases: ["광주과고"], schoolType: "gifted" },
  { name: "세종과학예술영재학교", aliases: ["세종영재", "세종과학예술영재학교"], schoolType: "gifted" },
  { name: "인천과학예술영재학교", aliases: ["인천영재", "인천과학예술영재학교"], schoolType: "gifted" },
  // 과학고
  ...[
    "한성", "세종", "경기북", "인천", "인천진산", "부산", "부산일", "대구일", "대전동신", "울산",
    "강원", "충북", "충남", "전북", "전남", "경북", "경산", "경남", "창원", "제주",
  ].map((p) => ({ name: `${p}과학고등학교`, aliases: [`${p}과학고`, `${p}과고`], schoolType: "science_high" })),
];

export const ADMISSION_KEYWORDS = ["입학설명회", "모집요강", "신입생", "원서접수", "전형일정", "추가모집", "정정공고"];

export const INITIAL_ACTIVE_RULES: Array<{ query: string; endpoint: "news" | "blog"; categoryHint: string }> = [
  { query: "하나고 입학설명회", endpoint: "news", categoryHint: "전국단위 자사고 입시" },
  { query: "경기과학고 모집요강", endpoint: "news", categoryHint: "영재학교·과학고 입시" },
  { query: "세종과학예술영재학교 모집요강", endpoint: "news", categoryHint: "영재학교·과학고 입시" },
  { query: "KAIST 청소년 캠프", endpoint: "news", categoryHint: "STEM 캠프" },
  { query: "중학생 올림피아드 모집", endpoint: "news", categoryHint: "STEM 대회" },
  { query: "청소년 영재교육원 모집", endpoint: "blog", categoryHint: "영재교육원" },
];

export const CANDIDATE_RULES: Array<{ query: string; endpoint: "news" | "blog"; categoryHint: string }> = [
  { query: "POSTECH 중학생 캠프", endpoint: "news", categoryHint: "STEM 캠프" },
  { query: "서울대 청소년 과학캠프", endpoint: "news", categoryHint: "STEM 캠프" },
  { query: "우주의 조약돌 모집", endpoint: "news", categoryHint: "STEM 캠프" },
  { query: "청소년 과학캠프 모집", endpoint: "news", categoryHint: "STEM 캠프" },
  { query: "청소년 과학경시대회 접수", endpoint: "news", categoryHint: "STEM 대회" },
  { query: "영재교육원 접수", endpoint: "news", categoryHint: "영재교육원" },
];

export function categoryForSchoolType(t: string): string {
  return t === "national_autonomous" ? "전국단위 자사고 입시" : "영재학교·과학고 입시";
}

/** 학교 × 입시 키워드 조합 후보 생성(저장 전 미리보기용) */
export function buildSchoolRuleCandidates(schoolTypes: string[], keywords: string[]) {
  const out: Array<{ query: string; endpoint: "news"; categoryHint: string }> = [];
  for (const s of SCHOOL_SEEDS) {
    if (!schoolTypes.includes(s.schoolType)) continue;
    const alias = s.aliases[0];
    for (const k of keywords) out.push({ query: `${alias} ${k}`, endpoint: "news", categoryHint: categoryForSchoolType(s.schoolType) });
  }
  return out;
}

export const SCIENCE_EVERGREEN_TOPICS = [
  "도시의 나무는 어디에 먼저 심어야 할까?",
  "같은 힘으로 밀었는데 왜 움직임이 다를까?",
];

export const CURRENT_EDITORIAL_TOPICS = ["학교의 스마트폰 사용 규칙", "공공도서관 예산 우선순위"];

/* ───────────── 자동 화제 발굴(과학·시사 채널) ─────────────
 * 사용자가 검색어를 넣지 않아도 아래 "탐색 주제"로 최신 뉴스를 넓게 훑고,
 * 여러 언론사가 함께 다루는 기사 묶음을 화제로 본다. 주제는 채널 설정에서 바꿀 수 있다.
 */
export const DISCOVERY_DEFAULT_QUERIES: Record<"science_dialogue" | "current_dialogue", string[]> = {
  science_dialogue: ["연구팀 발견", "우주 탐사", "인공지능 기술", "기후 환경 연구"],
  current_dialogue: ["정부 발표", "국회 법안", "교육부", "국제 정상"],
};

export type DiscoverySettings = { enabled: boolean; queries: string[]; picksPerRun: number; autoDraft: boolean };

export function discoveryDefaults(contentType: string): DiscoverySettings | null {
  if (contentType !== "science_dialogue" && contentType !== "current_dialogue") return null;
  return { enabled: true, queries: [...DISCOVERY_DEFAULT_QUERIES[contentType]], picksPerRun: 3, autoDraft: true };
}

/** 저장된 값이 없거나 일부만 있으면 기본값으로 채운다 */
export function resolveDiscovery(contentType: string, stored: Partial<DiscoverySettings> | null | undefined): DiscoverySettings | null {
  const d = discoveryDefaults(contentType);
  if (!d) return null;
  return {
    enabled: stored?.enabled ?? d.enabled,
    queries: stored?.queries?.length ? stored.queries : d.queries,
    picksPerRun: stored?.picksPerRun ?? d.picksPerRun,
    autoDraft: stored?.autoDraft ?? d.autoDraft,
  };
}

/** 화제 발굴 결과(콘텐츠 항목에 저장) */
export type DiscoveryInfo = {
  score: number; // 같은 사건을 다룬 서로 다른 언론사 수
  articleCount: number;
  outlets: string[];
  pickedBy: "claude" | "openai" | "buzz";
  reason: string | null; // 고른 이유(Claude)
  angle: string | null; // 대화 질문 제안(Claude)
  query: string; // 어떤 탐색 주제에서 나왔는지
  headline: string; // 대표 기사 제목(초안 생성 후 제목이 바뀌어도 같은 사건 판별에 사용)
  discoveredAt: string;
};


