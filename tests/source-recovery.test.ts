import { describe, expect, it } from "vitest";
import { sourceRecovery } from "../shared/sourceRecovery";
const source = { originalUrl: "https://news.google.com/rss/articles/opaque", title: "같은 기사 제목", fetchStatus: "failed", fetchError: "본문을 찾지 못함(동적 페이지·차단 가능성)", meta: { publisherUrl: "https://press.example/" } };
describe("actionable source recovery", () => {
  it("explains legacy Google failures without claiming the publisher is blocked", () => {
    const r = sourceRecovery(source);
    expect(r.code).toBe("legacy_unresolved"); expect(r.reason).toContain("차단 여부는 확인되지 않았습니다");
    expect(r.nextStep).toContain("원문 다시 확보");
    expect(r.links.map(l => l.label)).toEqual(["Google 뉴스에서 원문 열기", "언론사 사이트 열기", "제목으로 원문 찾기"]);
    expect(new URL(r.links[2].url).searchParams.get("q")).toBe('site:press.example "같은 기사 제목"');
  });
  it("distinguishes publisher restriction, rate limit, unsupported body and unresolved link", () => {
    for (const [fetchStatus, fetchError, code] of [["blocked", "HTTP 403", "restricted"], ["blocked", "HTTP 429", "rate_limit"], ["unsupported", "공개 HTML에서 본문 없음", "unsupported_body"], ["unsupported", "제목이 일치하는 원문 없음", "unresolved_link"]])
      expect(sourceRecovery({ ...source, fetchStatus, fetchError }).code).toBe(code);
  });
  it("never renders a javascript or credential-bearing link", () => {
    expect(sourceRecovery({ ...source, originalUrl: "javascript:alert(1)", meta: { publisherUrl: "https://u:p@press.example/", finalUrl: "data:text/html,x" } }).links).toEqual([]);
  });
});
