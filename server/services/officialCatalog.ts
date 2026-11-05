import { officialSources, channels, type OfficialSource } from "../../shared/schema";
import type { DB } from "../db";
import type { BoardConfig } from "./boardAdapter";
import { validSubcategory } from "../../shared/channelCategories";

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
];

export async function seedOfficialCatalog(db: DB) {
  for (const ch of await db.select().from(channels)) {
    const sources = OFFICIAL_CATALOG.filter(s => s.channel === ch.slug);
    if (!sources.length) continue;
    await db.insert(officialSources).values(sources.map(s => ({ channelId: ch.id, name: s.name, schoolType: s.schoolType,
      domain: s.domain, boardUrl: s.boardUrl, adapter: "generic_board", adapterConfig: s.config,
      enabled: s.enabled !== false, verifiedAt: s.enabled === false ? null : new Date("2026-11-06T00:00:00Z"),
      verificationNote: s.verificationNote ?? "공식 공개 목록·기관 RSS. 원문과 첨부를 확인한 뒤 접수 여부를 판단하세요. 목록 범위 밖의 과거 공고는 수동 확인이 필요합니다.",
    }))).onConflictDoNothing({ target: [officialSources.channelId, officialSources.name] });
  }
}

export function officialConfig(source: Pick<OfficialSource, "name" | "adapterConfig">): BoardConfig {
  return { ...OFFICIAL_CATALOG.find(s => s.name === source.name)?.config, ...source.adapterConfig } as BoardConfig;
}

export function officialCategory(slug: string, source: Pick<OfficialSource, "name" | "adapterConfig" | "schoolType">, title = "", categories?: readonly string[] | null) {
  const config = officialConfig(source);
  let value = config.subcategory ?? null;
  if (slug === "opportunities") {
    if (/캠프|체험|영재교육원|사사과정|사사연구|과학실험교실|선교육/.test(title)) value = "캠프·체험 선발모집";
    else if (/올림피아드|경시|공모전|경진대회|코드페어/.test(title)) value = "전국대회";
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
  return healthyBoards > 0 ? Math.min(configured, contentType === "notice" ? 8 : 20) : configured;
}
