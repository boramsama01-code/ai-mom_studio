import { env } from "../env";
import { AiServiceError } from "./llm";

export function geminiFailureMessage(status: number): string {
  const reason = status === 429 ? "호출 한도에 도달했습니다. AI Studio에서 프로젝트 한도를 확인하고 나중에 다시 시도하세요. 다른 AI로 자동 전환하지 않았습니다." :
    status === 401 || status === 403 ? "API 키·모델 접근 권한·이용 가능 지역을 확인하세요." :
    status === 404 ? "모델을 찾을 수 없습니다. 설정의 모델 ID를 확인하세요." :
    status === 400 ? "키 또는 요청 형식을 확인하세요. 무료 등급 이용 가능 여부도 AI Studio에서 확인하세요." :
    "요청을 완료하지 못했습니다. 자동으로 재호출하지 않았습니다.";
  return `Gemini HTTP ${status}: ${reason}`;
}

export function geminiModelUrl(): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,119}$/.test(env.geminiModel)) throw new AiServiceError("Gemini 모델 ID 형식이 올바르지 않습니다.", "not_configured");
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}`;
}

/** Key stays in a header on a fixed origin. No redirects, paid tools, retries or provider fallback. */
export async function geminiRequest(body: Record<string, unknown>): Promise<Record<string, any>> {
  if (!env.geminiKey) throw new AiServiceError("설정에서 Gemini API 키를 먼저 입력하세요.", "not_configured");
  try {
    const response = await fetch(`${geminiModelUrl()}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": env.geminiKey, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90_000), redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiServiceError(geminiFailureMessage(response.status));
    }
    const limit = 2_000_000;
    if (Number(response.headers.get("content-length") || 0) > limit) {
      await response.body?.cancel();
      throw new AiServiceError("Gemini 응답이 저장 한도를 초과했습니다.", "parse");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AiServiceError("Gemini 응답이 비어 있습니다.", "parse");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new AiServiceError("Gemini 응답이 저장 한도를 초과했습니다.", "parse"); }
      chunks.push(value);
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      return parsed as Record<string, any>;
    } catch { throw new AiServiceError("Gemini 응답 형식을 읽을 수 없습니다.", "parse"); }
  } catch (e) {
    if (e instanceof AiServiceError) throw e;
    throw new AiServiceError("Gemini 연결 오류입니다. 자동으로 재호출하지 않았습니다.");
  }
}
