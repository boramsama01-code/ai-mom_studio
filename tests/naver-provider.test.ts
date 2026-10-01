import { beforeEach, describe, expect, it } from "vitest";
import { naverSearch, naverProviderInUse, __resetNaverProviderForTest, NaverError } from "../server/services/naver";

const ok = () => new Response(JSON.stringify({ items: [{ title: "<b>과학고</b> 설명회", description: "", link: "https://n.news.naver.com/a/1", originallink: "https://press.example/1", pubDate: "Mon, 28 Sep 2026 10:00:00 +0900" }] }), { status: 200, headers: { "content-type": "application/json" } });
type Call = { url: string; headers: Record<string, string> };

function fake(accept: "apihub" | "developers" | "none") {
  const calls: Call[] = [];
  const f = (async (u: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url: String(u), headers });
    const isHub = String(u).startsWith("https://naverapihub.apigw.ntruss.com/search/v1/");
    if ((accept === "apihub" && isHub) || (accept === "developers" && !isHub)) return ok();
    return new Response("{}", { status: 401 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("네이버 검색 — API HUB / 기존 개발자센터 키 자동 판별", () => {
  beforeEach(() => {
    process.env.NAVER_CLIENT_ID = "id-1";
    process.env.NAVER_CLIENT_SECRET = "secret-1";
    __resetNaverProviderForTest();
  });

  it("API HUB 키: 새 주소·헤더로 한 번에 성공", async () => {
    const { f, calls } = fake("apihub");
    const items = await naverSearch("과학고", "news", 5, { naver: 0, limit: 5 }, f);
    expect(items[0].title).toBe("과학고 설명회");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("https://naverapihub.apigw.ntruss.com/search/v1/news?");
    expect(calls[0].headers).toEqual({ "X-NCP-APIGW-API-KEY-ID": "id-1", "X-NCP-APIGW-API-KEY": "secret-1" });
    expect(naverProviderInUse()).toBe("apihub");
  });

  it("기존 키: API HUB 인증 거부 후 기존 주소로 성공, 다음부터는 기존 주소부터", async () => {
    const { f, calls } = fake("developers");
    await naverSearch("과학고", "blog", 5, { naver: 0, limit: 5 }, f);
    expect(calls.map((c) => new URL(c.url).origin)).toEqual(["https://naverapihub.apigw.ntruss.com", "https://openapi.naver.com"]);
    expect(calls[1].url).toContain("/v1/search/blog.json");
    expect(naverProviderInUse()).toBe("developers");
    await naverSearch("과학고", "news", 5, { naver: 0, limit: 5 }, f);
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain("https://openapi.naver.com/v1/search/news.json");
  });

  it("둘 다 거부하면 인증 오류", async () => {
    const { f } = fake("none");
    await expect(naverSearch("과학고", "news", 5, { naver: 0, limit: 5 }, f)).rejects.toMatchObject({ kind: "auth" } satisfies Partial<NaverError>);
  });

  it("키가 바뀌면 다시 API HUB부터 시도", async () => {
    const a = fake("developers");
    await naverSearch("q", "news", 1, { naver: 0, limit: 5 }, a.f);
    process.env.NAVER_CLIENT_ID = "id-2";
    expect(naverProviderInUse()).toBeNull();
    const b = fake("apihub");
    await naverSearch("q", "news", 1, { naver: 0, limit: 5 }, b.f);
    expect(b.calls).toHaveLength(1);
  });
});
