/**
 * 연결 키 입력·확인 API — 값은 절대 응답하지 않는다(비밀이 아닌 값만 예외적으로 표시)
 */
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db";
import { appSettings, channels, destinations } from "../../shared/schema";
import { ah, HttpError, parse } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { SECRET_GROUPS, isAllowedSecretKey, isSecretKey } from "../../shared/secretsCatalog";
import { deleteSecret, saveSecret, secretStatuses, SecretKeyMissing } from "../secretStore";
import { testGemini, testOpenai, testAnthropic, testCloudinary, testInstagram, testNaver, testTelegram, type TestResult } from "../services/connectionTest";

export const secretRoutes = Router();

async function slugs() {
  return (await getDb().select({ slug: channels.slug }).from(channels)).map((c) => c.slug);
}

async function destinationKeys(): Promise<string[]> {
  const rows = await getDb().select({ refs: destinations.secretRefs }).from(destinations);
  return [...new Set(rows.flatMap((r) => Object.values(r.refs)))];
}

secretRoutes.get(
  "/secrets",
  ah(async (_req, res) => {
    const db = getDb();
    const keys = [...SECRET_GROUPS.flatMap((g) => g.fields.map((f) => f.key)), ...(await destinationKeys())];
    const statuses = await secretStatuses(db, keys);
    const tests = await db.select().from(appSettings);
    const testMap = Object.fromEntries(tests.filter((t) => t.key.startsWith("conn_test:")).map((t) => [t.key.slice(10), { ...(t.value as TestResult), at: t.updatedAt }]));
    res.json({
      groups: SECRET_GROUPS,
      statuses: statuses.map((s) => ({
        ...s,
        secret: isSecretKey(s.key),
        // 비밀이 아닌 값(모델 ID, 채팅 ID 등)만 보여준다
        value: !isSecretKey(s.key) && s.source !== "none" && s.source !== "unreadable" ? process.env[s.key] ?? null : null,
      })),
      tests: testMap,
    });
  }),
);

const putSchema = z.object({ value: z.string().trim().min(1, "값을 입력하세요").max(4000) });

secretRoutes.put(
  "/secrets/:key",
  ah(async (req, res) => {
    const key = String(req.params.key);
    if (!isAllowedSecretKey(key, await slugs())) throw new HttpError(400, "입력할 수 없는 항목입니다.");
    const { value } = parse(putSchema, req.body);
    if (key === "AI_PROVIDER" && !["auto", "gemini", "openai", "anthropic"].includes(value)) throw new HttpError(400, "AI는 auto, gemini, openai, anthropic 중에서 선택하세요.");
    if (key === "GEMINI_MODEL" && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,119}$/.test(value)) throw new HttpError(400, "Gemini 모델 ID 형식이 올바르지 않습니다.");
    if (["OPENAI_MODEL", "OPENAI_IMAGE_MODEL", "ANTHROPIC_MODEL"].includes(key) && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$/.test(value)) throw new HttpError(400, "모델 ID 형식이 올바르지 않습니다.");
    if (/[\r\n]/.test(value)) throw new HttpError(400, "값에 줄바꿈이 들어 있습니다. 한 줄로 붙여 넣으세요.");
    try {
      await saveSecret(getDb(), key, value, actorOf(req));
    } catch (e) {
      if ((e as Error).message === "ENV_OWNED") throw new HttpError(409, "이 항목은 Render(또는 GitHub) 환경변수에 이미 값이 있어 그 값이 우선합니다. 화면에서 관리하려면 Render의 Environment에서 이 항목을 지운 뒤 다시 입력하세요.");
      if (e instanceof SecretKeyMissing) throw new HttpError(503, e.message);
      throw e;
    }
    await audit(getDb(), { actor: actorOf(req), action: "set_secret", entity: "secret", entityId: key }); // 값은 기록하지 않음
    res.json({ ok: true });
  }),
);

secretRoutes.delete(
  "/secrets/:key",
  ah(async (req, res) => {
    const key = String(req.params.key);
    if (!isAllowedSecretKey(key, await slugs())) throw new HttpError(400, "지울 수 없는 항목입니다.");
    try {
      await deleteSecret(getDb(), key);
    } catch (e) {
      if ((e as Error).message === "ENV_OWNED") throw new HttpError(409, "Render 환경변수의 값은 화면에서 지울 수 없습니다.");
      throw e;
    }
    await audit(getDb(), { actor: actorOf(req), action: "delete_secret", entity: "secret", entityId: key });
    res.json({ ok: true });
  }),
);

secretRoutes.post(
  "/secrets/test/:service",
  ah(async (req, res) => {
    const service = String(req.params.service);
    let r: TestResult;
    if (service === "naver") r = await testNaver();
    else if (service === "openai") r = await testOpenai();
    else if (service === "gemini") r = await testGemini();
    else if (service === "anthropic") r = await testAnthropic();
    else if (service === "telegram") r = await testTelegram();
    else if (service === "cloudinary") r = await testCloudinary();
    else if (service.startsWith("instagram:")) {
      const tokenKey = service.slice(10);
      if (!/_ACCESS_TOKEN$/.test(tokenKey) || !isAllowedSecretKey(tokenKey, await slugs())) throw new HttpError(400, "알 수 없는 항목");
      r = await testInstagram(tokenKey);
    } else throw new HttpError(400, "알 수 없는 서비스");
    const db = getDb();
    await db
      .insert(appSettings)
      .values({ key: `conn_test:${service}`, value: r })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: r, updatedAt: new Date() } });
    await audit(db, { actor: actorOf(req), action: "test_connection", entity: "secret", entityId: service, detail: { ok: r.ok } });
    res.json(r);
  }),
);


