import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isPrivateIp, normalizeUrl } from "../server/services/url";
import { safeFetch } from "../server/services/safeFetch";
import { cleanQuery, normalizeQuery, parseBulkQueries } from "../shared/domain";
import { applyExcludeTerms, mapNaverItem } from "../server/services/naver";
import { preferReadableUrl, extractHtml } from "../server/services/extract";
import { matchOfficialSource, computeEvidenceStatus } from "../server/worker/evidence";
import { allowedSecretName, resolveSecrets } from "../server/services/secrets";

describe("URL 정규화", () => {
  it("추적 파라미터만 제거하고 게시물 ID는 보존", () => {
    expect(normalizeUrl("https://School.hs.kr/board/view.do?bbsId=12&nttId=345&utm_source=naver&fbclid=x#top")).toBe(
      "https://school.hs.kr/board/view.do?bbsId=12&nttId=345",
    );
    expect(normalizeUrl("https://n.news.naver.com:443/mnews/article/001/0000000001?sid=102")).toBe("https://n.news.naver.com/mnews/article/001/0000000001?sid=102");
  });
});

describe("SSRF 차단", () => {
  it("사설·메타데이터 주소 판별", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "211.234.10.1", "2001:4860:4860::8888"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("localhost·메타데이터·사설로 풀리는 호스트 차단", async () => {
    await expect(assertPublicHttpUrl("http://localhost/x")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicHttpUrl("ftp://example.com/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://user:pw@example.com/")).rejects.toThrow();
    const fakeLookup = (async () => [{ address: "10.0.0.5", family: 4 }]) as never;
    await expect(assertPublicHttpUrl("https://evil.example/", fakeLookup)).rejects.toThrow(/사설/);
    const okLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;
    await expect(assertPublicHttpUrl("https://ok.example/", okLookup)).resolves.toBeInstanceOf(URL);
  });
  it("safeFetch는 내부 주소 요청을 보내지 않음", async () => {
    await expect(safeFetch("http://127.0.0.1:5433/")).rejects.toMatchObject({ kind: "blocked" });
    await expect(safeFetch("http://[::1]/")).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("검색어 정규화·대량 추가", () => {
  it("Unicode·공백 정규화로 같은 검색어 판별", () => {
    expect(normalizeQuery("  하나고   입학설명회 ")).toBe(normalizeQuery("하나고 입학설명회"));
    expect(normalizeQuery("KAIST 캠프")).toBe(normalizeQuery("kaist 캠프"));
    expect(normalizeQuery("ＫＡＩＳＴ 캠프")).toBe(normalizeQuery("KAIST 캠프")); // 전각 → 반각
    expect(cleanQuery("  KAIST   캠프 ")).toBe("KAIST 캠프");
  });
  it("쉼표로 임의 분할하지 않고, 줄 단위로만 나눔", () => {
    expect(parseBulkQueries("서울대, 과학캠프\n\n하나고 입학설명회\n하나고  입학설명회")).toEqual(["서울대, 과학캠프", "하나고 입학설명회"]);
  });
  it("제외어는 범위에 따라 적용하고 사유를 남김", () => {
    const it1 = { title: "하나고 입학설명회 대비반 모집", description: "OO학원" };
    expect(applyExcludeTerms(it1, ["대비반"], "title")).toMatch(/대비반/);
    expect(applyExcludeTerms(it1, ["학원"], "title")).toBeNull();
    expect(applyExcludeTerms(it1, ["학원"], "title_and_snippet")).toMatch(/학원/);
  });
});

describe("네이버 응답 매핑", () => {
  it("태그·엔티티 정리, 뉴스/블로그 날짜 형식 구분", () => {
    const n = mapNaverItem("news", { title: "<b>하나고</b> &quot;설명회&quot;", description: "a&amp;b", link: "https://n.news.naver.com/x", originallink: "https://press.example/1", pubDate: "Mon, 28 Sep 2026 10:00:00 +0900" });
    expect(n.title).toBe('하나고 "설명회"');
    expect(n.description).toBe("a&b");
    expect(n.published.precision).toBe("datetime");
    const b = mapNaverItem("blog", { title: "t", description: "d", link: "https://blog.naver.com/abc/123", bloggername: "x", bloggerlink: "y", postdate: "20260927" });
    expect(b.published.precision).toBe("date");
    expect(b.originallink).toBeUndefined();
  });
});

describe("원문 추출", () => {
  it("네이버 블로그 PC 주소를 모바일 주소로", () => {
    expect(preferReadableUrl("https://blog.naver.com/abc/223456")).toBe("https://m.blog.naver.com/abc/223456");
    expect(preferReadableUrl("https://blog.naver.com/PostView.naver?blogId=abc&logNo=1")).toBe("https://m.blog.naver.com/abc/1");
  });
  it("본문과 첨부(PDF/HWP) 분리, HWP는 수동 확인", () => {
    const html = `<html><head><title>공지</title></head><body><nav>메뉴</nav><div class="board_view">${"2027학년도 입학전형 요강을 안내합니다. ".repeat(5)}<a href="/file/a.pdf">요강.pdf</a><a href="/down?f=1">신청서.hwp</a></div></body></html>`;
    const r = extractHtml(html, "https://school.hs.kr/board/1");
    expect(r.text).toContain("입학전형 요강");
    expect(r.text).not.toContain("메뉴");
    expect(r.attachments.map((a) => [a.kind, a.status])).toEqual([["pdf", "pending"], ["hwp", "manual_check"]]);
    expect(r.attachments[0].url).toBe("https://school.hs.kr/file/a.pdf");
  });
});

describe("공식 근거 판정", () => {
  const src = (over: Record<string, unknown>) => ({ id: 1, channelId: 1, name: "경기과학고등학교", aliases: [], schoolType: "gifted", domain: "gs.hs.kr", boardUrl: null, adapter: null, adapterConfig: {}, enabled: false, verifiedAt: new Date(), verificationNote: "", version: 1, createdAt: new Date(), updatedAt: new Date(), ...over }) as never;
  it("확인한 도메인의 공고 단위 URL만 공식", () => {
    expect(matchOfficialSource("https://gs.hs.kr/board/view?id=3", [src({})])).not.toBeNull();
    expect(matchOfficialSource("https://www.gs.hs.kr/x", [src({})])).not.toBeNull();
    expect(matchOfficialSource("https://gs.hs.kr.evil.com/x", [src({})])).toBeNull();
    expect(matchOfficialSource("https://gs.hs.kr/x", [src({ verifiedAt: null })])).toBeNull(); // 미확인 도메인
    expect(matchOfficialSource("https://example.edu/x", [src({ domain: null })])).toBeNull();
  });
  it("원문 확보 실패·충돌·근거 없음 구분", () => {
    const payload = { has_conflict: false, evidence: [{ field: "title", source_id: 1, quote: "x" }] } as never;
    expect(computeEvidenceStatus({ fetchStatus: "failed", normalizedUrl: "https://gs.hs.kr/1", kind: "official" }, payload, [src({})])).toBe("fetch_failed");
    expect(computeEvidenceStatus({ fetchStatus: "ok", normalizedUrl: "https://gs.hs.kr/1", kind: "official" }, payload, [src({})])).toBe("official_confirmed");
    expect(computeEvidenceStatus({ fetchStatus: "ok", normalizedUrl: "https://news.example/1", kind: "naver_news" }, payload, [src({})])).toBe("secondary_only");
    expect(computeEvidenceStatus({ fetchStatus: "ok", normalizedUrl: "https://news.example/1", kind: "naver_news" }, { has_conflict: true, evidence: [] } as never, [])).toBe("conflict");
    expect(computeEvidenceStatus({ fetchStatus: "ok", normalizedUrl: "https://news.example/1", kind: "naver_news" }, { has_conflict: false, evidence: [] } as never, [])).toBe("needs_review");
  });
});

describe("비밀값 참조 검증", () => {
  it("채널 slug에 묶인 허용 이름만 읽음", () => {
    expect(allowedSecretName("instagram", "opportunities", "accessToken", "IG_OPPORTUNITIES_ACCESS_TOKEN")).toBe(true);
    expect(allowedSecretName("instagram", "opportunities", "accessToken", "ANTHROPIC_API_KEY")).toBe(false);
    expect(allowedSecretName("instagram", "opportunities", "accessToken", "IG_SCIENCE_DIALOGUE_ACCESS_TOKEN")).toBe(false);
    expect(allowedSecretName("telegram_channel", "science-dialogue", "chatId", "TG_SCIENCE_DIALOGUE_CHAT_ID")).toBe(true);
    process.env.DATABASE_URL_X = "secret";
    const r = resolveSecrets("telegram_channel", "opportunities", { chatId: "DATABASE_URL_X" });
    expect(r.values).toEqual({});
    expect(r.invalid).toEqual(["chatId"]);
  });
});
