/**
 * 자동 화제 발굴 — 검색어를 사람이 고르지 않아도 "지금 여러 언론이 함께 다루는 일"을 찾는다.
 *
 * 1) 탐색 주제(넓은 검색어)로 최신 뉴스를 주제당 최대 100건 가져온다(네이버 뉴스 검색, 최신순).
 * 2) 제목·요약의 핵심 낱말이 많이 겹치는 기사끼리 같은 사건으로 묶는다.
 * 3) 묶음마다 "서로 다른 언론사 수"를 화제도로 센다. 한 곳만 쓴 기사보다 여러 곳이 쓴 기사가 화제다.
 * 4) 중학생과 이야기하기 부적절한 주제(강력범죄·자살·마약 등)는 미리 뺀다.
 * 최종 선정은 Claude가(연결 시) 채널 성격에 맞춰 하고, 없으면 화제도 순으로 고른다.
 */
import type { NaverItem } from "./naver";

export type Article = NaverItem & { query: string; outlet: string; tokens: Set<string>; titleTokens: Set<string> };

export type Cluster = {
  id: number;
  articles: Article[];
  outlets: string[];
  score: number; // 서로 다른 언론사 수
  representative: Article;
  latest: string | null;
  query: string;
};

/* ───────── 낱말 추출 ───────── */

const PARTICLES = [
  "에서는", "으로는", "에게서", "까지는", "에서도", "이라는", "라는", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "마저", "조차",
  "이다", "했다", "한다", "된다", "됐다", "하는", "되는", "하고", "이며", "이고", "으며",
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만", "서", "들",
];
const STOP = new Set([
  "기자", "뉴스", "단독", "속보", "종합", "포토", "영상", "사진", "오늘", "내일", "어제", "올해", "지난해", "지난", "이번", "관련", "위해", "대한", "통해",
  "따르면", "밝혔다", "있다", "없다", "것으로", "이날", "등의", "가운데", "이후", "최근", "전망", "발표", "공개", "진행", "예정", "확인", "가능",
  "연합뉴스", "뉴시스", "뉴스1", "머니투데이", "한국경제", "매일경제", "있는", "없는", "했다", "한다", "된다", "그리고", "하지만", "또한",
]);

function stripParticle(w: string): string {
  for (const p of PARTICLES) {
    if (w.length - p.length >= 2 && w.endsWith(p)) return w.slice(0, -p.length);
  }
  return w;
}

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text
    .normalize("NFC")
    .replace(/\[[^\]]{0,12}\]|【[^】]{0,12}】|<[^>]*>/g, " ") // [단독] 같은 머리말
    .replace(/[^0-9A-Za-z가-힣]+/g, " ")
    .toLowerCase();
  for (const raw of cleaned.split(" ")) {
    if (raw.length < 2) continue;
    const w = stripParticle(raw);
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

export function outletOf(it: Pick<NaverItem, "originallink" | "link" | "publisher" | "publisherUrl">): string {
  if (it.publisher && !it.publisherUrl) return it.publisher;
  const u = it.publisherUrl || it.originallink || it.link;
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^(www|m|news|n)\./, "");
    // 언론사 대표 도메인(마지막 두 단계, co.kr 등은 세 단계)
    const parts = h.split(".");
    const n = /\.(co|or|go|ac|ne|re)\.kr$/.test(h) ? 3 : 2;
    return parts.slice(-n).join(".");
  } catch {
    return "unknown";
  }
}

export function toArticle(it: NaverItem, query: string): Article {
  const titleTokens = tokenize(it.title);
  const tokens = new Set([...titleTokens, ...tokenize(it.description)]);
  return { ...it, query, outlet: outletOf(it), tokens, titleTokens };
}

/* ───────── 같은 사건인지 판단 ───────── */

function inter(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** 0~1. 제목 핵심 낱말이 많이 겹치거나, 제목+요약 낱말이 충분히 겹치면 같은 사건 */
export function similarity(a: Pick<Article, "tokens" | "titleTokens">, b: Pick<Article, "tokens" | "titleTokens">): number {
  const tShared = inter(a.titleTokens, b.titleTokens);
  const tMin = Math.min(a.titleTokens.size, b.titleTokens.size) || 1;
  const titleScore = tShared >= 2 ? tShared / tMin : 0;
  const aShared = inter(a.tokens, b.tokens);
  const union = a.tokens.size + b.tokens.size - aShared || 1;
  const bodyScore = aShared >= 3 ? aShared / union : 0;
  return Math.max(titleScore, bodyScore * 2); // 요약은 낱말이 많아 겹침 비율이 낮게 나오므로 보정
}

export const SAME_STORY = 0.5;

/** 최신 기사부터 차례로, 가장 비슷한 묶음(대표 기사 기준)에 넣는다 */
export function clusterArticles(articles: Article[]): Cluster[] {
  const sorted = [...articles].sort((a, b) => (b.published.iso ?? "").localeCompare(a.published.iso ?? ""));
  const groups: Article[][] = [];
  const seenUrl = new Set<string>();
  for (const a of sorted) {
    const key = a.originallink || a.link;
    if (seenUrl.has(key)) continue; // 같은 기사가 여러 탐색 주제에 걸린 경우
    seenUrl.add(key);
    let best = -1;
    let bestSim = 0;
    for (let i = 0; i < groups.length; i++) {
      // 대표(첫 기사)와 두 번째 기사 중 더 비슷한 쪽으로 비교 — 한 기사에만 의존해 엇나가는 것 방지
      const g = groups[i];
      const s = Math.max(similarity(a, g[0]), g[1] ? similarity(a, g[1]) : 0);
      if (s > bestSim) {
        bestSim = s;
        best = i;
      }
    }
    if (best >= 0 && bestSim >= SAME_STORY) groups[best].push(a);
    else groups.push([a]);
  }
  return groups.map((arts, i) => {
    const outlets = [...new Set(arts.map((a) => a.outlet))];
    // 대표 기사: 네이버 뉴스 주소(원문 읽기가 안정적)가 있는 기사 우선, 다음은 요약이 긴 기사
    const representative =
      [...arts].sort((x, y) => Number(/n\.news\.naver\.com/.test(y.link)) - Number(/n\.news\.naver\.com/.test(x.link)) || y.description.length - x.description.length)[0];
    const queries = arts.map((a) => a.query);
    const query = queries.sort((a, b) => queries.filter((q) => q === b).length - queries.filter((q) => q === a).length)[0];
    return { id: i + 1, articles: arts, outlets, score: outlets.length, representative, latest: arts[0].published.iso ?? null, query };
  });
}

/* ───────── 부적절 주제 거르기 ───────── */

// 중학생 대화 소재로 쓰지 않는 주제(제목·요약 기준). Claude가 없을 때도 같은 기준을 적용한다.
const BLOCK = [
  "성폭행", "성범죄", "성추행", "성착취", "불법촬영", "음란", "마약", "필로폰", "자살", "극단적 선택", "투신", "살해", "살인", "시신", "흉기",
  "도박", "불륜", "열애", "이혼", "음주운전", "학대", "부고", "별세",
];
// 화제는 맞지만 이 채널 성격과 거리가 먼 주제(Claude 없을 때만 적용 — Claude는 맥락으로 판단)
const OFF_TOPIC = ["주가", "코스피", "코인", "비트코인", "아이돌", "드라마", "예능", "컴백", "야구", "축구", "골프", "프로농구", "프로배구"];

export function blockedReason(c: Pick<Cluster, "articles">, strictTopic: boolean): string | null {
  const text = c.articles.slice(0, 5).map((a) => `${a.title} ${a.description}`).join(" ");
  for (const w of BLOCK) if (text.includes(w)) return `부적절 주제어 "${w}"`;
  if (strictTopic) for (const w of OFF_TOPIC) if (text.includes(w)) return `채널과 거리가 먼 주제어 "${w}"`;
  return null;
}

/** 화제 후보 순위: 언론사 수 → 기사 수 → 최신순. 1곳만 다룬 기사는 화제로 보지 않는다(후보가 모자라면 포함). */
export function rankClusters(clusters: Cluster[], opts: { strictTopic: boolean; minOutlets?: number }): Cluster[] {
  const min = opts.minOutlets ?? 2;
  const ok = clusters.filter((c) => !blockedReason(c, opts.strictTopic));
  const sorted = ok.sort((a, b) => b.score - a.score || b.articles.length - a.articles.length || (b.latest ?? "").localeCompare(a.latest ?? ""));
  const hot = sorted.filter((c) => c.score >= min);
  return hot.length ? hot : sorted;
}

/** 최근에 이미 고른 화제와 같은 사건이면 다시 고르지 않는다 */
export function isRecentlyCovered(c: Cluster, recentTitles: string[]): boolean {
  const recent = recentTitles.map((t) => {
    const tt = tokenize(t);
    return { tokens: tt, titleTokens: tt };
  });
  return c.articles.slice(0, 3).some((a) => recent.some((r) => similarity(a, r) >= SAME_STORY));
}

