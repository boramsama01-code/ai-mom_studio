/**
 * "연결 확인" — 입력한 키로 실제 서비스에 최소한의 요청을 보내 확인
 * 게시나 메시지 발송처럼 밖에 흔적이 남는 요청은 최소화한다(텔레그램은 검토 알림 채팅에만 확인 메시지 1건).
 */
import { env } from "../env";
import { naverSearch, NaverError, naverProviderInUse } from "./naver";
import { getClient } from "./llm";
import { ensureCloudinary, CloudinaryNotConfigured } from "./cloudinary";
import { openaiFailureMessage } from "./openaiError";
import { geminiFailureMessage, geminiModelUrl } from "./gemini";
import { accountIdentity, type InstagramAuthMode } from "./instagram";
import { getNotionConnectionStatus, NOTION_API_VERSION } from "./notionClient";

export type TestResult = { ok: boolean; message: string };

/** One read-only data-source query. Does not import, edit or publish a document. */
export async function testNotion(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const status = getNotionConnectionStatus();
  if (!status.configured) return { ok: false, message: "노션 연결 키와 콘텐츠 제작표 설정을 먼저 확인해 주세요." };
  try {
    const response = await fetchImpl(`https://api.notion.com/v1/data_sources/${status.dataSourceId}/query`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(18_000),
      headers: { Authorization: `Bearer ${process.env.NOTION_API_TOKEN!.trim()}`, "Notion-Version": NOTION_API_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 1 }),
    });
    await response.body?.cancel();
    if (!response.ok) return { ok: false, message: response.status === 401 || response.status === 403 ? "노션 연결 권한을 확인해 주세요. 콘텐츠 제작표를 이 연결에 공유해야 합니다."
      : response.status === 404 ? "연결에서 콘텐츠 제작표를 찾지 못했습니다. 공유 여부와 데이터 소스 설정을 확인해 주세요."
        : response.status === 429 ? "노션 요청이 잠시 많습니다. 잠시 후 다시 확인해 주세요." : "노션 제작표 조회를 완료하지 못했습니다. 잠시 후 다시 확인해 주세요." };
    return { ok: true, message: "노션 제작표 조회에 성공했습니다. 원고·사진을 가져오거나 수정하지 않았습니다. 쓰기 권한은 원고 반영 시 확인합니다." };
  } catch { return { ok: false, message: "노션에 연결할 수 없습니다. 연결 키와 네트워크 상태를 확인해 주세요." }; }
}

/** Model metadata only: does not generate tokens or verify billing/free-tier enrollment. */
export async function testGemini(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  if (!env.geminiKey) return { ok: false, message: "Gemini API 키가 없습니다." };
  try {
    const response = await fetchImpl(geminiModelUrl(), {
      headers: { "x-goog-api-key": env.geminiKey }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) return { ok: false, message: geminiFailureMessage(response.status) };
    return { ok: true, message: "Gemini 모델 조회에 성공했습니다. 글을 생성하지 않았습니다. 무료 등급·남은 한도는 AI Studio 프로젝트에서 별도로 확인하세요." };
  } catch { return { ok: false, message: "Gemini에 연결할 수 없습니다. 키와 모델 ID를 확인하세요." }; }
}

export async function testNaver(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  try {
    const items = await naverSearch("과학고 입학설명회", "news", 1, { naver: 0, limit: 2 }, fetchImpl);
    const how = naverProviderInUse() === "developers" ? "기존 개발자센터 키" : "NAVER API HUB 키";
    return { ok: true, message: `검색 성공(${how}, 결과 ${items.length}건 수신)` };
  } catch (e) {
    const ne = e as NaverError;
    return { ok: false, message: ne.kind === "auth" ? "인증 실패 — Client ID/Secret을 확인하세요. 네이버 클라우드 NAVER API HUB에서 '검색' 상품을 이용 신청하고 Application을 등록해 받은 값이어야 합니다." : ne.message };
  }
}

/** Model lookup checks credentials/access without generating billable content. */
export async function testOpenai(fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  if (!env.openaiKey) return { ok: false, message: "OpenAI API 키가 없습니다." };
  try {
    for (const model of [env.openaiModel, env.openaiImageModel]) {
      const response = await fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { authorization: `Bearer ${env.openaiKey}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
      });
      if (!response.ok) return { ok: false, message: await openaiFailureMessage(response) };
      await response.body?.cancel();
    }
    return { ok: true, message: "글·이미지 모델 조회에 성공했습니다. 생성 권한·잔액까지 검증한 것은 아닙니다. 생성에는 Model Capabilities 요청 권한도 필요합니다." };
  } catch { return { ok: false, message: "OpenAI에 연결할 수 없습니다." }; }
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
      body: JSON.stringify({ chat_id: env.telegramReviewChatId, text: "✅ 우주펭귄상회 스튜디오 연결 확인 메시지입니다." }),
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

export async function testInstagram(tokenKey: string, fetchImpl: typeof fetch = fetch, options: { authMode?: InstagramAuthMode; expectedUsername?: string } = {}): Promise<TestResult> {
  const token = process.env[tokenKey];
  if (!env.instagramApiVersion) return { ok: false, message: "인스타그램 API 버전을 먼저 입력하세요." };
  if (!token) return { ok: false, message: "액세스 토큰이 없습니다." };
  try {
    const identity = await accountIdentity(token, options.authMode ?? "instagram", options.expectedUsername, fetchImpl);
    if (!identity.ok) return { ok: false, message: identity.error };
    if (options.expectedUsername && identity.username.toLowerCase() !== options.expectedUsername.replace(/^@/, "").toLowerCase()) return { ok: false, message: "지정한 채널과 토큰의 인스타그램 계정이 다릅니다." };
    return { ok: true, message: `계정 @${identity.username} 확인` };
  } catch {
    return { ok: false, message: "인스타그램에 연결할 수 없습니다." };
  }
}
