/**
 * 카드 템플릿 · 글자 내보내기 · 일괄 처리 · Canva(가짜 응답) 통합 테스트
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { login, resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb, getPool } = await import("../server/db");
const canva = await import("../server/services/canva");
const store = await import("../server/secretStore");

let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  await resetDb();
  app = createApp();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

const payload = {
  relevance: "relevant", irrelevance_reason: null, title: "OO과학고 입학설명회", organization: "OO과학고", notice_type: "입학설명회",
  category: "영재학교·과학고 입시", school_type: "science_high", academic_year: "2027학년도", audience: "중3", eligibility: null,
  schedules: [{ kind: "apply", label: "원서접수", start: { date: "2099-10-20" }, end: { date: "2099-10-24" }, raw: null }],
  deadline_type: "fixed", key_details: "사전 예약, \"선착순\"", one_line_summary: "10월 접수", uncertainties: [], has_conflict: false, evidence: [],
};

async function makeItem(agent: import("supertest").Agent, H: Record<string, string>, title: string) {
  const c = await agent.post("/api/channels/1/items").set(H).send({ title });
  const d = (await agent.get(`/api/channels/1/items/${c.body.id}`)).body;
  const e = await agent.patch(`/api/channels/1/items/${c.body.id}`).set(H).send({ version: d.item.version, payload: { ...payload, title } });
  return { id: c.body.id as number, version: e.body.version as number };
}

describe("카드 템플릿", () => {
  it("완성 세트 37종과 기존 컬러 33가지 목록, 새 컬러 생성과 이전 디자인 호환", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const list = await agent.get("/api/channels/1/templates");
    expect(list.body.items).toHaveLength(37);
    expect(new Set(list.body.items.map((t: { key: string }) => t.key)).size).toBe(37);
    expect(list.body.items.filter((t: { cardCopyVersion: number }) => t.cardCopyVersion === 2)).toHaveLength(16);
    expect(list.body.items.filter((t: { key: string }) => t.key.startsWith("set:"))).toHaveLength(21);
    for (const item of list.body.items.filter((t: { key: string }) => ["set:r01", "set:r05", "set:n01", "set:n03", "set:n04", "set:f01"].includes(t.key))) expect(item.colors).toHaveLength(item.key === "set:f01" ? 3 : 6);
    expect(list.body.current).toBe("builtin:classic");
    const pv = await agent.get("/api/channels/1/templates/preview?key=builtin:header&size=sm");
    expect(pv.status).toBe(200);
    expect((await sharp(pv.body).metadata()).width).toBe(360);
    expect((await agent.get("/api/channels/1/templates/preview?key=builtin:nope")).status).toBe(404);

    expect((await agent.put("/api/channels/1/design").set(H).send({ cardTemplate: "builtin:magazine" })).status).toBe(200);
    expect((await agent.put("/api/channels/1/design").set(H).send({ cardTemplate: "custom:9999" })).status).toBe(400);
    const { id } = await makeItem(agent, H, "템플릿 테스트");
    const a = await agent.post(`/api/channels/1/items/${id}/card`).set(H).send({});
    expect(a.body.templateKey).toBe("builtin:magazine");
    const b = await agent.post(`/api/channels/1/items/${id}/card`).set(H).send({ templateKey: "builtin:minimal" });
    expect(b.body.templateKey).toBe("builtin:minimal");
    expect(b.body.sha256).not.toBe(a.body.sha256);
    const collection = await agent.post(`/api/channels/1/items/${id}/card`).set(H).send({ templateKey: "set:r03", coverMode: "typography" });
    expect(collection.status).toBe(200);
    expect(collection.body.templateKey).toBe("set:r03");
    expect(collection.body.carousel.pages).toHaveLength(5);
    expect((await agent.put("/api/channels/1/design").set(H).send({ cardTemplate: "set:r01-blue" })).status).toBe(200);
    const colored = await agent.post(`/api/channels/1/items/${id}/card`).set(H).send({ coverMode: "typography" });
    expect(colored.status).toBe(200);
    expect(colored.body.templateKey).toBe("set:r01-blue");
    expect(colored.body.carousel.pages).toHaveLength(5);
    const colorPreview = await agent.get("/api/channels/1/templates/preview?key=set:r01-blue&page=4&size=sm");
    expect(colorPreview.status).toBe(200);
    const bodyPreview = await agent.get("/api/channels/1/templates/preview?key=set:r03&page=4&size=sm");
    expect(bodyPreview.status).toBe(200);
    expect((await sharp(bodyPreview.body).metadata()).width).toBe(360);
    expect((await agent.get("/api/channels/1/templates/preview?key=set:r03&page=5")).status).toBe(400);
    const eighth = await agent.get("/api/channels/1/templates/preview?key=cardnews14-cinematic-v1&page=7&size=sm");
    expect(eighth.status).toBe(200);
    expect((await sharp(eighth.body).metadata()).width).toBe(360);
    expect((await agent.get("/api/channels/1/templates/preview?key=cardnews14-cinematic-v1&page=8")).status).toBe(400);
    expect((await agent.put("/api/channels/1/design").set(H).send({ cardTemplate: "set:missing" })).status).toBe(400);
  });

  it("배경 이미지 업로드 → 정규화(1080×1350) → 카드 생성 → 삭제 시 기본값 복귀", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const png = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#203040" } }).png().toBuffer();
    const up = await agent.post("/api/channels/1/templates?name=어두운배경&layout=classic&tone=light&overlay=20").set(H).set("content-type", "image/png").send(png);
    expect(up.status).toBe(201);
    const key = up.body.key as string;
    const [row] = (await getPool().query("select background from card_templates where id = $1", [Number(key.split(":")[1])])).rows;
    const meta = await sharp(row.background).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, "jpeg"]);
    // 너무 작은 이미지·이미지 아님 거부
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await agent.post("/api/channels/1/templates?name=x").set(H).set("content-type", "image/png").send(tiny)).status).toBe(400);
    expect((await agent.post("/api/channels/1/templates?name=x").set(H).set("content-type", "image/png").send(Buffer.from("not image"))).status).toBe(400);
    // CSRF 없으면 거부
    expect((await agent.post("/api/channels/1/templates?name=x").set("content-type", "image/png").send(png)).status).toBe(403);

    await agent.put("/api/channels/1/design").set(H).send({ cardTemplate: key });
    const { id } = await makeItem(agent, H, "배경 템플릿 카드");
    const card = await agent.post(`/api/channels/1/items/${id}/card`).set(H).send({});
    expect(card.body.source).toBe("custom");
    const img = await agent.get(`/api/channels/1/media/${card.body.id}`);
    const m = await sharp(img.body).metadata();
    expect([m.width, m.height, m.channels]).toEqual([1080, 1350, 3]);
    // 다른 채널에서는 이 채널 전용 템플릿을 못 씀
    expect((await agent.put("/api/channels/2/design").set(H).send({ cardTemplate: key })).status).toBe(400);
    expect((await agent.post(`/api/channels/1/templates/${key.split(":")[1]}/delete`).set(H)).status).toBe(200);
    expect((await agent.get("/api/channels/1/templates")).body.current).toBe("builtin:classic");
  });
});

describe("글자 내보내기·일괄 처리", () => {
  it("필드 JSON, CSV(BOM·따옴표 이스케이프)", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const { id, version } = await makeItem(agent, H, "CSV, \"따옴표\" 제목");
    const f = await agent.get(`/api/channels/1/items/${id}/fields`);
    expect(f.body.fields.find((x: { key: string }) => x.key === "schedule").value).toContain("2099-10-20");
    await agent.post(`/api/channels/1/items/${id}/review`).set(H).send({ version, status: "reviewed" });
    const csv = await agent.get("/api/channels/1/export/fields.csv").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const text = (csv.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")[0]).toBe("﻿title,category,audience,schedule,summary,details,source,checked,channel");
    expect(text).toContain('"CSV, ""따옴표"" 제목"');
  });

  it("수집함 일괄 보류·제외(다른 채널 항목은 건드리지 않음)", async () => {
    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    const a = await makeItem(agent, H, "일괄1");
    const b = await makeItem(agent, H, "일괄2");
    const r = await agent.post("/api/channels/1/items/bulk").set(H).send({ ids: [a.id, b.id], action: "hold" });
    expect(r.body.updated).toBe(2);
    const other = await agent.post("/api/channels/2/items/bulk").set(H).send({ ids: [a.id], action: "exclude" });
    expect(other.body.updated).toBe(0);
    const d = (await agent.get(`/api/channels/1/items/${a.id}`)).body;
    expect([d.item.reviewStatus, d.item.excluded]).toEqual(["held", false]);
  });
});

describe("Canva(가짜 응답)", () => {
  it("PKCE·인증 주소", () => {
    process.env.CANVA_CLIENT_ID = "OC-test";
    const { verifier, challenge } = canva.pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(canva.buildAuthUrl({ challenge, state: "s1", redirectUri: "https://x.example/api/canva/callback" }));
    expect(u.origin + u.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
    expect(u.searchParams.get("scope")).toContain("design:content:write");
  });

  it("토큰 교환 → 자동 채우기(이름 맞는 글자 칸만) → 내보내기 → 카드로 가져오기", async () => {
    store.__setOriginalEnvForTest(Object.keys(process.env).filter((k) => process.env[k] && !k.startsWith("CANVA_")));
    process.env.CANVA_CLIENT_SECRET = "sec";
    const calls: Array<{ url: string; body?: string; auth?: string }> = [];
    const png = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#ff8800" } }).png().toBuffer();
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? String(init.body) : undefined, auth: (init?.headers as Record<string, string>)?.authorization });
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
      if (u.endsWith("/oauth/token")) return json({ access_token: "AT1", refresh_token: "RT1", expires_in: 3600, token_type: "Bearer" });
      if (u.includes("/brand-templates/BT1/dataset")) return json({ dataset: { title: { type: "text" }, schedule: { type: "text" }, photo: { type: "image" }, extra: { type: "text" } } });
      if (u.endsWith("/autofills")) return json({ job: { id: "J1", status: "in_progress" } });
      if (u.endsWith("/autofills/J1")) return json({ job: { id: "J1", status: "success", result: { type: "create_design", design: { id: "D1", url: "https://canva.com/d/D1", urls: { edit_url: "https://canva.com/d/D1/edit", view_url: "https://canva.com/d/D1/view" } } } } });
      if (u.endsWith("/exports")) return json({ job: { id: "E1", status: "success", urls: ["https://export-download.canva.test/e1.png"] } });
      throw new Error(`unexpected ${u}`);
    });
    await canva.exchangeCode(getDb(), { code: "C1", verifier: "V", redirectUri: "https://x/cb" });
    expect(calls[0].auth).toBe("Basic " + Buffer.from("OC-test:sec").toString("base64"));
    expect(calls[0].body).toContain("grant_type=authorization_code");
    expect(process.env.CANVA_REFRESH_TOKEN).toBe("RT1");
    // 토큰은 DB에 암호화 저장
    const raw = (await getPool().query("select ciphertext from stored_secrets where key='CANVA_REFRESH_TOKEN'")).rows[0].ciphertext;
    expect(raw).not.toContain("RT1");

    const { agent, csrf } = await login(app);
    const H = { "x-csrf-token": csrf };
    await agent.put("/api/channels/1/design").set(H).send({ canvaBrandTemplateId: "BT1" });
    const { id } = await makeItem(agent, H, "Canva 테스트");
    const r = await agent.post(`/api/channels/1/items/${id}/canva`).set(H).send({});
    expect(r.status).toBe(200);
    expect(r.body.usedFields.sort()).toEqual(["schedule", "title"]);
    expect(r.body.unusedTemplateFields.sort()).toEqual(["extra", "photo"]);
    expect(r.body.editUrl).toBe("https://canva.com/d/D1/edit");
    const sent = JSON.parse(calls.find((c) => c.url.endsWith("/autofills"))!.body!);
    expect(sent.type).toBe("create_from_brand_template");
    expect(Object.keys(sent.data).sort()).toEqual(["schedule", "title"]);

    // 가져오기: 내려받기는 safeFetch(undici) → 모듈 모킹 대신 exportDesignPng 결과 URL만 확인하고, 내용 변경 시 거부 확인
    const d = (await agent.get(`/api/channels/1/items/${id}`)).body;
    await agent.patch(`/api/channels/1/items/${id}`).set(H).send({ version: d.item.version, payload: { ...payload, title: "바뀐 제목" } });
    const stale = await agent.post(`/api/channels/1/items/${id}/canva/import`).set(H).send({});
    expect(stale.status).toBe(409);
    expect(png.length).toBeGreaterThan(0);
  });

  it("리프레시 토큰은 1회용 — 만료 시 새 토큰 저장, 동시 요청은 한 번만 갱신", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (String(url).endsWith("/oauth/token")) {
        n++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ access_token: `AT${n + 1}`, refresh_token: `RT${n + 1}`, expires_in: 3600 }), { status: 200 });
      }
      throw new Error("unexpected");
    });
    process.env.CANVA_TOKEN_EXPIRES_AT = String(Date.now() - 1000);
    const [a, b] = await Promise.all([canva.accessToken(getDb()), canva.accessToken(getDb())]);
    expect(n).toBe(1);
    expect(a).toBe("AT2");
    expect(b).toBe("AT2");
    expect(process.env.CANVA_REFRESH_TOKEN).toBe("RT2");
  });
});

