import { officialSources, channels, searchRules, type OfficialSource } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { normalizeQuery } from "../../shared/domain";
import type { DB } from "../db";
import type { BoardConfig } from "./boardAdapter";
import { validSubcategory } from "../../shared/channelCategories";

// Education Ministry directory plus legacy regional endpoints, checked 2026-11-06.
// Direct adapters are enabled only after a public-list check. Naver web queries
// cover every region; failed/direct-unavailable boards remain visible for repair.
export const EDUCATION_OFFICES = [
  ["서울특별시교육청", "sen.go.kr"], ["부산광역시교육청", "pen.go.kr"],
  ["대구광역시교육청", "dge.go.kr"], ["인천광역시교육청", "ice.go.kr"],
  ["광주광역시교육청", "gen.go.kr"], ["대전광역시교육청", "dje.go.kr"],
  ["울산광역시교육청", "use.go.kr"], ["세종특별자치시교육청", "sje.go.kr"],
  ["경기도교육청", "goe.go.kr"], ["강원특별자치도교육청", "gwe.go.kr"],
  ["충청북도교육청", "cbe.go.kr"], ["충청남도교육청", "cne.go.kr"],
  ["전북특별자치도교육청", "jbe.go.kr"], ["전라남도교육청", "jne.go.kr"],
  ["경상북도교육청", "gbe.kr"], ["경상남도교육청", "gne.go.kr"],
  ["제주특별자치도교육청", "jje.go.kr"], ["전남광주통합특별시교육청", "jge.go.kr"],
] as const;
const EDUCATION_BOARDS: Record<string, { url: string; config: Partial<BoardConfig> }> = {
  "sen.go.kr": { url: "https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1100", config: { linkSelector: 'td.bbs_title a[href*="q_bbsDocNo="]', dateSelector: ".bbs_date" } },
  "goe.go.kr": { url: "https://goe.go.kr/goe/na/ntt/selectNttList.do?bbsId=2012&mi=10100", config: { format: "school_ntt", linkSelector: "a.nttInfoBtn[data-id]", dateSelector: 'td[data-table="date"]', titleSelector: "em" } },
  "dje.go.kr": { url: "https://www.dje.go.kr/boardCnts/list.do?boardID=450&m=030101&s=dje", config: { format: "dje_board", linkSelector: 'td.link a[onclick*="goView("]', dateSelector: "td:last-child", useTitleAttribute: true } },
  "pen.go.kr": { url: "https://www.pen.go.kr/dep08/na/ntt/selectNttList.do?mi=31184&bbsId=2555", config: { format: "school_ntt", linkSelector: "a.nttInfoBtn[data-id]", dateSelector: 'td:contains("등록일")', subcategory: "캠프·체험 선발모집" } },
  "ice.go.kr": { url: "https://www.ice.go.kr/ice/na/ntt/selectNttList.do?mi=10840&bbsId=1482", config: { format: "school_ntt", linkSelector: "a.nttInfoBtn[data-id]", dateSelector: 'td[data-table="date"]', useTitleAttribute: true } },
  "cbe.go.kr": { url: "https://www.cbe.go.kr/cbe/na/ntt/selectNttList.do?mi=11576&bbsId=1762", config: { format: "school_ntt", linkSelector: "a.nttInfoBtn[data-id]", dateSelector: 'td[data-table="date"]' } },
  "jbe.go.kr": { url: "https://www.jbe.go.kr/index.jbe?menuCd=DOM_000000103001000000", config: { linkSelector: 'td.title a[href*="/board/view.jbe"][href*="dataSid="]', dateSelector: 'td[data-cell-header="등록일 :"]' } },
  "gne.go.kr": { url: "https://highschool.gne.go.kr/s10/hsa/archive/notice.do", config: { linkSelector: 'td.td-title a[href*="noticeDetail.do?boardSeq="]', dateSelector: 'td:nth-child(4)', subcategory: "고등입시" } },
};
export const YOUTH_WEB_QUERIES = [
  ...EDUCATION_OFFICES.map(([name]) => `${name} 학생 모집`),
  "중학생 공모전", "고등학생 공모전", "청소년 과학 캠프 모집", "영재교육원 모집요강", "링커리어 청소년", "사이언스올 청소년",
];

// Public endpoints, independently checked by scripts/check-official-sources.ts.
// A verified listing is not proof that applications are open.
export const OFFICIAL_CATALOG: Array<{ channel: string; name: string; domain: string; boardUrl: string; schoolType: string; config: BoardConfig; enabled?: boolean; verificationNote?: string }> = [
  { channel: "opportunities", name: "GED 영재선발 공고", schoolType: "org", domain: "ged.kedi.re.kr", boardUrl: "https://ged.kedi.re.kr/slct/noti/slctNotiStat.do", config: { format: "ged_selection", linkSelector: "a.sdown[onclick]", maxItems: 100, subcategory: "캠프·체험 선발모집" } },
  { channel: "opportunities", name: "사이언스올 교육·캠프", schoolType: "org", domain: "scienceall.com", boardUrl: "https://www.scienceall.com/brd/board/407/L/menu/293", config: { linkSelector: 'a[href*="bbsSn="]:has(.cate:contains("교육·캠프"))', titleSelector: "div > p", maxItems: 20, subcategory: "캠프·체험 선발모집" } },
  { channel: "opportunities", name: "한국정보올림피아드 공지", schoolType: "org", domain: "koi.or.kr", boardUrl: "https://koi.or.kr/feed.xml", config: { format: "rss", linkSelector: "entry", maxItems: 30, subcategory: "전국대회", maxAgeDays: 180 } },
  { channel: "opportunities", name: "한국과학영재학교 공개 공지", schoolType: "gifted", domain: "ksa.hs.kr", boardUrl: "https://ksa.hs.kr/Home/Board/78", config: { linkSelector: 'a[href*="BoardRead/78"]', dateSelector: "td:last-child", maxItems: 30, maxAgeDays: 180, recruitmentOnly: true } },
  { channel: "opportunities", name: "동국대학교 과학영재교육원 입학 공지", schoolType: "org", domain: "gifted.dongguk.edu", boardUrl: "https://gifted.dongguk.edu/bbs/board.php?bo_table=gifted4_3", config: { linkSelector: 'a[href*="wr_id="]', dateSelector: ".td_datetime", maxItems: 30, subcategory: "캠프·체험 선발모집", maxAgeDays: 180 } },
  { channel: "current-dialogue", name: "KAIST 연구 뉴스", schoolType: "org", domain: "kaist.ac.kr", boardUrl: "https://www.kaist.ac.kr/news/html/news/", config: { linkSelector: 'a[href*="mng_no="]', titleSelector: ".tis", maxItems: 20, subcategory: "과학", maxAgeDays: 30 } },
  { channel: "current-dialogue", name: "과기정통부 과학·기술 보도자료", schoolType: "org", domain: "msit.go.kr", boardUrl: "https://www.msit.go.kr/user/rss/rss.do?bbsSeqNo=94", enabled: false, verificationNote: "공식 안내에 있는 RSS이지만 2026-11-06 반복 시간 초과로 비활성화했습니다. 시험 읽기와 개별 원문 연결을 다시 확인한 뒤 활성화하세요.", config: { format: "rss", linkSelector: "item", articleBaseUrl: "https://www.msit.go.kr/bbs/view.do?mId=307&mPid=208", maxItems: 20, subcategory: "과학", maxAgeDays: 30 } },
  { channel: "current-dialogue", name: "문체부 문화·관광 보도자료", schoolType: "org", domain: "mcst.go.kr", boardUrl: "https://www.mcst.go.kr/common/rss/press.jsp", config: { format: "rss", linkSelector: "item", maxItems: 20, subcategory: "예술", maxAgeDays: 30 } },
  ...EDUCATION_OFFICES.map(([name, domain]) => ({ channel: "opportunities", name: `${name} 공지`, schoolType: "org", domain,
    boardUrl: EDUCATION_BOARDS[domain]?.url ?? `https://www.${domain}/`, enabled: !!EDUCATION_BOARDS[domain],
    config: { linkSelector: "a", maxItems: 30, maxAgeDays: 90, recruitmentOnly: true, youthOnly: true, ...EDUCATION_BOARDS[domain]?.config },
    verificationNote: EDUCATION_BOARDS[domain] ? "공개 공지 목록 직접 확인. 학생 모집·입시·공모전 후보만 저장하며 대상·일정은 원문 확인이 필요합니다."
      : "2026-11-06 직접 목록 수집 미검증·접속 오류로 비활성. 지역별 네이버 웹문서 검색으로 보완합니다. 도메인 이전 또는 게시판 구조를 확인한 뒤 시험 읽기를 거쳐 연결하세요.",
  })),
  { channel: "opportunities", name: "링커리어 청소년 활동·공모전", schoolType: "org", domain: "linkareer.com", boardUrl: "https://linkareer.com/search?direction=DESC&page=1&q=%EC%B2%AD%EC%86%8C%EB%85%84&sort=RELEVANCE&tab=open-activity", config: { format: "linkareer", linkSelector: 'a[href^="/activity/"]', maxItems: 40, sourceRole: "discovery", youthOnly: true } },
  { channel: "opportunities", name: "위비티 청소년 공모전", schoolType: "org", domain: "wevity.com", boardUrl: "https://www.wevity.com/index.php?c=find&cidx=30&gp=1&gub=2&mode=future&s=1", config: { linkSelector: 'a[href*="gbn=view"][href*="ix="]', maxItems: 30, sourceRole: "discovery", youthOnly: true, subcategory: "전국대회" } },
  { channel: "opportunities", name: "콘테스트코리아 청소년 공모전", schoolType: "org", domain: "contestkorea.com", boardUrl: "https://www.contestkorea.com/sub/list.php?int_gbn=1&Txt_code1[0]=28&Txt_code1[1]=29", config: { linkSelector: 'a[href*="/sub/view.php"][href*="str_no="]', maxItems: 30, sourceRole: "discovery", youthOnly: true, subcategory: "전국대회" } },

];

export async function seedOfficialCatalog(db: DB) {
  for (const ch of await db.select().from(channels)) {
    const sources = OFFICIAL_CATALOG.filter(s => s.channel === ch.slug);
    if (!sources.length) continue;
    await db.insert(officialSources).values(sources.map(s => ({ channelId: ch.id, name: s.name, schoolType: s.schoolType,
      domain: s.domain, boardUrl: s.boardUrl, adapter: "generic_board", adapterConfig: s.config,
      enabled: s.enabled !== false, verifiedAt: s.enabled === false ? null : new Date("2026-11-06T00:00:00Z"),
      verificationNote: s.verificationNote ?? (s.config.sourceRole === "discovery" ? "청소년 공모전·활동 발굴용. 주최기관 공식 공고에서 실제 참가 대상·일정·비용을 확인하세요." : "공식 공개 목록·기관 RSS. 원문과 첨부를 확인한 뒤 접수 여부를 판단하세요. 목록 범위 밖의 과거 공고는 수동 확인이 필요합니다."),
    }))).onConflictDoNothing({ target: [officialSources.channelId, officialSources.name] });
    if (ch.slug === "opportunities") {
      const existing = await db.select().from(searchRules).where(eq(searchRules.channelId, ch.id));
      const missing = YOUTH_WEB_QUERIES.filter(query => !existing.some(r => r.endpoint === "webkr" && r.normalizedQuery === normalizeQuery(query)));
      if (missing.length) await db.insert(searchRules).values(missing.map((query, i) => ({ channelId: ch.id, query, normalizedQuery: normalizeQuery(query), endpoint: "webkr", enabled: true, priority: 30 + i, display: 10,
        memo: "교육청·청소년 활동 보완 검색. 네이버 웹문서는 게시일 미제공 — 원문에서 일정 확인. 직접 게시판의 전체 자료 수집을 보장하지 않습니다.",
      }))).onConflictDoNothing();
    }
  }
}

export function officialConfig(source: Pick<OfficialSource, "name" | "adapterConfig">): BoardConfig {
  return { ...OFFICIAL_CATALOG.find(s => s.name === source.name)?.config, ...source.adapterConfig } as BoardConfig;
}

export function officialCategory(slug: string, source: Pick<OfficialSource, "name" | "adapterConfig" | "schoolType">, title = "", categories?: readonly string[] | null) {
  const config = officialConfig(source);
  let value = config.subcategory ?? null;
  if (slug === "opportunities") {
    if (/캠프|체험|영재교육원|사사과정|사사연구|과학실험교실|선교육|서포터즈|동아리|청소년운영위원회/.test(title)) value = "캠프·체험 선발모집";
    else if (/올림피아드|경시|공모전|경진대회|코드페어/.test(title)) value = "전국대회";
    else if (/중학교.{0,10}(입학|신입생)/.test(title)) value = "중등입시";
    else if (/고등학교.{0,15}(입학|신입생)|고입/.test(title)) value = "고등입시";
    else if (!value && ["gifted", "science_high", "national_autonomous"].includes(source.schoolType ?? "")) value = "고등입시";
  } else if (slug === "current-dialogue" && /여행|관광/.test(title)) value = "여행";
  return value && validSubcategory(slug, value, categories) ? value : null;
}

export function boardMatchesCategory(slug: string, source: Pick<OfficialSource, "name" | "adapterConfig" | "schoolType">, category?: string, categories?: readonly string[] | null) {
  if (!category) return true;
  const known = officialCategory(slug, source, "", categories);
  // General school boards can include both admissions and open camps. Filter entries after reading.
  return !known || known === category || (slug === "opportunities" && known === "고등입시" && category === "캠프·체험 선발모집") || (slug === "current-dialogue" && known === "예술" && category === "여행");
}

export function officialFirstSearchLimit(contentType: string, configured: number, healthyBoards: number) {
  return healthyBoards > 0 ? Math.min(configured, contentType === "notice" ? 24 : 20) : configured;
}
