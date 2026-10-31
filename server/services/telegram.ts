/**
 * Telegram Bot API
 * - 개인 검토 알림(TELEGRAM_REVIEW_CHAT_ID)과 공개 채널 게시(목적지별 chatId)를 분리
 * - HTTP 상태와 JSON ok를 모두 확인, 성공 시 message_id 저장
 * - 응답 유실(타임아웃 등)은 게시됐을 수 있으므로 "unknown" — 자동 재전송하지 않는다
 * 문서: https://core.telegram.org/bots/api
 */
import { env } from "../env";

export type TgResult =
  | { ok: true; messageId: number; chatUsername?: string }
  | { ok: false; kind: "not_configured" | "auth" | "rate_limit" | "terminal" | "unknown" | "transient"; error: string; retryAfter?: number };

async function call(method: string, body: FormData | Record<string, unknown>, token = env.telegramBotToken): Promise<TgResult> {
  if (!token) return { ok: false, kind: "not_configured", error: "텔레그램 봇 토큰 미연결(TELEGRAM_BOT_TOKEN)" };
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
      headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // 요청이 전달된 뒤 응답만 유실됐을 수 있음
    return { ok: false, kind: "unknown", error: "응답을 받지 못함(게시 여부 불명)" };
  }
  type Message = { message_id?: number; chat?: { username?: string } };
  let json: { ok?: boolean; result?: Message | Message[]; description?: string; parameters?: { retry_after?: number } } = {};
  try {
    json = await res.json();
  } catch {
    return { ok: false, kind: res.ok ? "unknown" : "transient", error: `응답 해석 실패(HTTP ${res.status})` };
  }
  const message = Array.isArray(json.result) ? json.result[0] : json.result;
  if (res.ok && json.ok && message?.message_id) {
    return { ok: true, messageId: message.message_id, chatUsername: message.chat?.username };
  }
  const desc = (json.description || `HTTP ${res.status}`).slice(0, 300);
  if (res.status === 401) return { ok: false, kind: "auth", error: `봇 인증 실패: ${desc}` };
  if (res.status === 403) return { ok: false, kind: "auth", error: `권한 없음(봇을 채널 관리자로 추가했는지 확인): ${desc}` };
  if (res.status === 429) return { ok: false, kind: "rate_limit", error: desc, retryAfter: json.parameters?.retry_after };
  if (res.status >= 500) return { ok: false, kind: "transient", error: desc };
  return { ok: false, kind: "terminal", error: desc };
}

export async function sendReviewMessage(text: string): Promise<TgResult> {
  if (!env.telegramReviewChatId) return { ok: false, kind: "not_configured", error: "검토 알림 대상 미설정(TELEGRAM_REVIEW_CHAT_ID)" };
  return call("sendMessage", { chat_id: env.telegramReviewChatId, text: text.slice(0, 4000), disable_web_page_preview: true });
}

export async function sendPhotoToChannel(chatId: string, jpeg: Buffer, caption: string): Promise<TgResult> {
  const fd = new FormData();
  fd.set("chat_id", chatId);
  fd.set("caption", caption);
  fd.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "card.jpg");
  return call("sendPhoto", fd);
}

export async function sendAlbumToChannel(chatId: string, pages: Buffer[], caption: string): Promise<TgResult> {
  if (pages.length < 2 || pages.length > 10) return { ok: false, kind: "terminal", error: "앨범은 2~10장이어야 합니다." };
  const fd = new FormData();
  fd.set("chat_id", chatId);
  fd.set("media", JSON.stringify(pages.map((_, i) => ({ type: "photo", media: `attach://page${i}`, ...(i === 0 ? { caption } : {}) }))));
  pages.forEach((bytes, i) => fd.set(`page${i}`, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), `page-${i + 1}.jpg`));
  return call("sendMediaGroup", fd);
}

export function telegramPostUrl(chatUsername: string | undefined, messageId: number): string | null {
  return chatUsername ? `https://t.me/${chatUsername}/${messageId}` : null;
}

