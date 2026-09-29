/**
 * "연결 확인" — 입력한 키로 실제 서비스에 최소한의 요청을 보내 확인
 * 게시나 메시지 발송처럼 밖에 흔적이 남는 요청은 최소화한다(텔레그램은 검토 알림 채팅에만 확인 메시지 1건).
 */
import { env } from "../env";
import { naverSearch, NaverError } from "./naver";
import { getClient } from "./llm";
import { ensureCloudinary, CloudinaryNotConfigured } from "./cloudinary";

export type TestResult = { ok: boolean; message: string };

export async function testNaver(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  try {
    const items = await naverSearch("과학고 입학설명회", "news", 1, { naver: 0, limit: 1 }, fetchImpl);
    return { ok: true, message: `검색 성공(결과 ${items.length}건 수신)` };
  } catch (e) {
    const ne = e as NaverError;
    return { ok: false, message: ne.kind === "auth" ? "인증 실패 — Client ID/Secret을 확인하세요(네이버 앱에 '검색' API가 추가돼 있어야 함)" : ne.message };
  }
}

export async function testAnthropic(): Promise<TestResult> {
  if (!env.anthropicKey) return { ok: false, message: "API 키가 없습니다." };
  if (!env.anthropicModel) return { ok: false, message: "모델 ID가 없습니다." };
  try {
    const r = await getClient().messages.create({ model: env.anthropicModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
    return { ok: true, message: `호출 성공(모델: ${r.model})` };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return {
      ok: false,
      message:
        status === 401 ? "API 키 인증 실패" :
        status === 404 ? `모델을 찾을 수 없음: ${env.anthropicModel}` :
        status === 400 ? "요청 거부(모델 ID 또는 계정 상태 확인)" :
        status === 429 ? "호출 한도 초과 또는 크레딧 부족" :
        `호출 실패${status ? ` (HTTP ${status})` : ""}`,
    };
  }
}

export async function testTelegram(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const token = env.telegramBotToken;
  if (!token) return { ok: false, message: "봇 토큰이 없습니다." };
  try {
    const me = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) });
    const j = (await me.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!j.ok) return { ok: false, message: `봇 토큰 확인 실패: ${j.description ?? me.status}` };
    const bot = `@${j.result?.username}`;
    if (!env.telegramReviewChatId) return { ok: true, message: `봇 ${bot} 확인. 검토 알림 채팅 ID는 아직 없습니다.` };
    const s = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.telegramReviewChatId, text: "✅ 아이맘 스튜디오 연결 확인 메시지입니다." }),
      signal: AbortSignal.timeout(10_000),
    });
    const sj = (await s.json()) as { ok?: boolean; description?: string };
    if (!sj.ok) return { ok: false, message: `봇 ${bot}는 정상이지만 검토 알림 발송 실패: ${sj.description ?? s.status} — 봇과의 대화에서 /start를 먼저 보냈는지, 채팅 ID가 맞는지 확인하세요.` };
    return { ok: true, message: `봇 ${bot} 확인, 검토 알림 채팅으로 확인 메시지를 보냈습니다.` };
  } catch {
    return { ok: false, message: "텔레그램에 연결할 수 없습니다." };
  }
}

export async function testCloudinary(): Promise<TestResult> {
  try {
    const c = ensureCloudinary();
    await c.api.ping();
    return { ok: true, message: "Cloudinary 인증 성공" };
  } catch (e) {
    if (e instanceof CloudinaryNotConfigured) return { ok: false, message: "Cloud name, API Key, API Secret 세 값이 모두 필요합니다." };
    const msg = (e as { error?: { message?: string }; message?: string }).error?.message ?? (e as Error).message ?? "";
    return { ok: false, message: `인증 실패: ${String(msg).slice(0, 200)}` };
  }
}

export async function testInstagram(tokenKey: string, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const token = process.env[tokenKey];
  if (!env.instagramApiVersion) return { ok: false, message: "인스타그램 API 버전을 먼저 입력하세요." };
  if (!token) return { ok: false, message: "액세스 토큰이 없습니다." };
  try {
    const url = new URL(`https://graph.instagram.com/${env.instagramApiVersion}/me`);
    url.searchParams.set("fields", "user_id,username");
    url.searchParams.set("access_token", token);
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { username?: string; user_id?: string; error?: { message?: string; code?: number } };
    if (!r.ok || j.error) return { ok: false, message: j.error?.code === 190 ? "토큰이 만료되었거나 올바르지 않습니다." : `확인 실패: ${j.error?.message ?? r.status}` };
    return { ok: true, message: `계정 @${j.username} 확인 (user_id ${j.user_id})` };
  } catch {
    return { ok: false, message: "인스타그램에 연결할 수 없습니다." };
  }
}
